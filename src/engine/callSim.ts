/**
 * The live-call simulation.
 *
 * Builds one complete voice-agent call as a discrete-event simulation: carrier
 * signalling, audio frames, VAD, streaming STT partials, LLM tokens, tool
 * calls, streaming TTS, barge-in, human handoff, failures and recovery. The
 * output is a totally-ordered event log plus latency markers; every lab that
 * shows "a call" renders this log.
 *
 * Deterministic: same CallSimOptions + same seed => identical event log.
 */

import type { LatencyBreakdown, LatencySegment, SimEvent } from '../domain/types'
import { Simulation, round } from './simulation'
import { getLlm, getStt, getTelephony, getTts, S2S_PROVIDERS } from '../providers/simulated'
import { bytesPerFrame, FORMATS } from '../models/audio'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type FailureTarget =
  | 'stt'
  | 'tts'
  | 'llm'
  | 'tool'
  | 'database'
  | 'redis'
  | 'websocket'
  | 'network-latency'
  | 'packet-loss'
  | 'rate-limit'
  | 'cpu-overload'
  | 'human-unavailable'

export interface FailureInjection {
  target: FailureTarget
  /** 1 forces the failure; values in between are a per-call probability. */
  probability: number
  /** Extra ms for degradation-style failures. */
  extraMs?: number
}

export interface ReliabilityOptions {
  sttFallback: boolean
  ttsFallback: boolean
  llmRetry: boolean
  toolRetry: boolean
  wsReconnect: boolean
  /** Client-side budgets. When exceeded, TIMEOUT fires and recovery begins. */
  llmTimeoutMs: number
  toolTimeoutMs: number
  ttsTimeoutMs: number
  sttTimeoutMs: number
  /** Speak a filler phrase when a tool takes longer than this. */
  fillerAfterMs: number
}

export interface CallSimOptions {
  seed: string
  channel: 'phone' | 'browser'
  utterance: string
  /** Speaking rate for deriving audio duration. */
  wordsPerMinute?: number
  language: string
  noiseLevel: number
  sttProviderId: string
  ttsProviderId: string
  llmProviderId: string
  telephonyProviderId: string
  /** Use a single speech-to-speech model instead of the composed pipeline. */
  s2sMode?: boolean
  streamingLlm: boolean
  streamingTts: boolean
  vad: { speechThreshold: number; minSpeechMs: number; silenceTimeoutMs: number }
  network: {
    /** User <-> edge (carrier or browser to your region), one way, ms. */
    userToEdgeMs: number
    /** Edge <-> media gateway, one way, ms. */
    edgeToServerMs: number
    /** Gateway <-> AI providers, one way, ms. */
    serverToProviderMs: number
  }
  greeting?: string
  /** The agent's reply once the turn completes (before tool phrasing). */
  responseText: string
  llmContextTokens: number
  llmOutputTokens: number
  toolCalls: { name: string; latencyMs: number; resultSummary: string }[]
  interruption?: {
    /** Ms into agent playback when the user barges in. */
    afterPlaybackMs: number
    utterance: string
  }
  handoff?: {
    /** Agent decides to transfer after this turn completes. */
    requested: boolean
    agentAvailable: boolean
    queueWaitMs: number
    acceptDelayMs: number
  }
  failures: FailureInjection[]
  reliability: ReliabilityOptions
}

export const DEFAULT_RELIABILITY: ReliabilityOptions = {
  sttFallback: true,
  ttsFallback: true,
  llmRetry: true,
  toolRetry: true,
  wsReconnect: true,
  llmTimeoutMs: 4000,
  toolTimeoutMs: 1500,
  ttsTimeoutMs: 2500,
  sttTimeoutMs: 3000,
  fillerAfterMs: 900,
}

export interface CallSimResult {
  events: SimEvent[]
  latency: LatencyBreakdown
  outcome: 'completed' | 'failed' | 'handed-off' | 'dropped'
  outcomeReason: string
  finalTranscript: string
  wer: number
  markers: {
    callStartMs: number
    mediaReadyMs: number
    userSpeechStartMs: number
    userSpeechEndMs: number
    turnCompleteMs: number
    firstTranscriptMs: number
    finalTranscriptMs: number
    firstLlmTokenMs: number
    firstTtsAudioMs: number
    playbackStartMs: number
    callEndMs: number
  }
  failuresEncountered: string[]
  recoveries: string[]
  counters: Record<string, number>
  seed: string
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export function simulateCall(opts: CallSimOptions): CallSimResult {
  const sim = new Simulation(opts.seed)
  const rng = sim.rng
  const failuresEncountered: string[] = []
  const recoveries: string[] = []

  const armed = new Map<FailureTarget, FailureInjection>()
  for (const f of opts.failures) armed.set(f.target, f)
  /** Deterministically decide whether an armed failure fires on this call. */
  const fires = (target: FailureTarget): boolean => {
    const f = armed.get(target)
    if (!f) return false
    return rng.fork(`fail-${target}`).chance(f.probability)
  }
  const extraMs = (target: FailureTarget): number => armed.get(target)?.extraMs ?? 0

  // Network model. A latency injection stretches every hop.
  const netStretch = fires('network-latency') ? 1 : 0
  const lossy = fires('packet-loss')
  const hop = {
    userEdge: opts.network.userToEdgeMs + (netStretch ? extraMs('network-latency') || 150 : 0),
    edgeServer: opts.network.edgeToServerMs + (netStretch ? (extraMs('network-latency') || 150) / 2 : 0),
    serverProvider: opts.network.serverToProviderMs + (netStretch ? (extraMs('network-latency') || 150) / 2 : 0),
  }
  if (netStretch) failuresEncountered.push('network-latency')
  if (lossy) failuresEncountered.push('packet-loss')

  const cpuOverloaded = fires('cpu-overload')
  if (cpuOverloaded) failuresEncountered.push('cpu-overload')
  /** Overload multiplies every server-side processing delay. */
  const load = (ms: number) => (cpuOverloaded ? ms * 2.5 + 40 : ms)

  const telephony = getTelephony(opts.telephonyProviderId)
  const stt = getStt(opts.sttProviderId)
  const tts = getTts(opts.ttsProviderId)
  const llm = getLlm(opts.llmProviderId)
  const s2s = S2S_PROVIDERS[0]

  const phone = opts.channel === 'phone'
  const callerFormat = phone ? telephony.mediaFormat : FORMATS.opusWebrtc
  const wpm = opts.wordsPerMinute ?? 150
  const words = opts.utterance.split(/\s+/).filter(Boolean)
  const speechSeconds = Math.max(0.6, (words.length / wpm) * 60)

  const markers = {
    callStartMs: 0,
    mediaReadyMs: 0,
    userSpeechStartMs: 0,
    userSpeechEndMs: 0,
    turnCompleteMs: 0,
    firstTranscriptMs: 0,
    finalTranscriptMs: 0,
    firstLlmTokenMs: 0,
    firstTtsAudioMs: 0,
    playbackStartMs: 0,
    callEndMs: 0,
  }
  let outcome: CallSimResult['outcome'] = 'completed'
  let outcomeReason = 'Call completed normally.'
  let finalTranscript = ''
  let wer = 0

  // =========================================================================
  // 1. Call setup — signalling
  // =========================================================================
  sim.emit({
    type: 'CALL_STARTED',
    component: phone ? 'Caller / PSTN' : 'Browser',
    plane: 'control',
    summary: phone ? 'Inbound call arrives at the carrier' : 'User clicks “Start call”',
    detail: { channel: opts.channel, seed: opts.seed },
  })

  let mediaReadyAt = 0
  if (phone) {
    const call = telephony.placeCall(
      { to: 'agent', from: '+91-98xxxx', direction: 'inbound', region: 'in-mumbai' },
      rng.fork('telephony'),
    )
    for (const s of call.signalling) {
      const type =
        s.message.startsWith('INVITE') ? 'SIP_INVITE'
        : s.message.startsWith('200') ? 'SIP_200_OK'
        : s.message.startsWith('ACK') ? 'SIP_ACK'
        : s.message.startsWith('RTP') ? 'RTP_STREAM_STARTED'
        : 'NOTE'
      sim.emit({
        type,
        at: s.atMs,
        component: 'SIP signalling',
        plane: s.message.startsWith('RTP') ? 'media' : 'control',
        summary: `${s.direction === 'in' ? '⇐' : '⇒'} ${s.message}`,
        detail: { note: s.note },
        payloadType: s.message.startsWith('RTP') ? 'RTP/UDP audio packets' : 'SIP text message',
      })
    }
    mediaReadyAt = call.setupMs * 0.45 // inbound answer path is quick
  } else {
    sim.emit({
      at: 40,
      type: 'NOTE',
      component: 'WebRTC',
      plane: 'control',
      summary: 'SDP offer/answer exchanged via signalling server',
      detail: { codecs: 'opus/48000, negotiated 32 kbps', note: 'Signalling picks the codec; ICE finds the path.' },
    })
    sim.emit({
      at: 180,
      type: 'NOTE',
      component: 'WebRTC / ICE',
      plane: 'control',
      summary: 'ICE connectivity checks complete — candidate pair selected',
      detail: { path: rng.chance(0.85) ? 'srflx ↔ host (direct via STUN)' : 'relay via TURN', note: 'TURN relay adds one media hop when direct paths fail.' },
    })
    mediaReadyAt = 220
  }

  // WebSocket from edge to media gateway (Twilio media stream or browser WS path).
  const wsConnectAt = mediaReadyAt + hop.edgeServer + 15
  sim.emit({
    at: wsConnectAt,
    type: 'WS_CONNECTED',
    component: 'Media gateway',
    plane: 'media',
    summary: phone
      ? 'Carrier media stream WebSocket connected to media gateway'
      : 'Media path established to voice server',
    detail: {
      transport: phone ? 'WSS (mu-law 8 kHz, 20 ms frames)' : 'SRTP (Opus 48 kHz, 20 ms frames)',
      persistent: true,
      note: 'This single connection now lives for the entire call — the defining trait of voice backends.',
    },
  })
  markers.mediaReadyMs = round(wsConnectAt)

  sim.emit({
    at: wsConnectAt + 5,
    type: 'CALL_CONNECTED',
    component: 'Agent runtime',
    plane: 'control',
    summary: 'Call session created; conversation state initialised',
    detail: { state: 'IDLE → LISTENING', sessionStore: 'Redis (session key, TTL 1h)' },
  })

  // =========================================================================
  // 2. Greeting (optional)
  // =========================================================================
  let userStartsAt = wsConnectAt + 60
  if (opts.greeting) {
    const g = tts.synthesize(
      { text: opts.greeting, language: opts.language, format: FORMATS.pcm24k, streaming: opts.streamingTts && tts.streaming },
      rng.fork('greet'),
    )
    const gStart = wsConnectAt + 40
    sim.emit({
      at: gStart, type: 'TTS_STARTED', component: 'TTS', plane: 'media',
      summary: `Greeting sent to TTS: “${truncate(opts.greeting, 40)}”`,
      detail: { streaming: opts.streamingTts && tts.streaming, provider: tts.name },
    })
    const gFirst = gStart + hop.serverProvider + g.firstAudioMs
    sim.emit({
      at: gFirst, type: 'TTS_FIRST_AUDIO', component: 'TTS', plane: 'media',
      summary: 'First greeting audio chunk ready', durationMs: g.firstAudioMs,
    })
    sim.emit({
      at: gFirst + hop.serverProvider + hop.edgeServer + hop.userEdge,
      type: 'PLAYBACK_STARTED', component: 'User (caller)', plane: 'media',
      summary: 'Caller hears the greeting',
      detail: { perceived: 'Answer-to-greeting is the first latency the caller judges.' },
    })
    userStartsAt = gFirst + g.audioSeconds * 1000 + 250 // user replies shortly after greeting ends
  }

  // =========================================================================
  // 3. User speaks — audio frames, VAD, streaming STT
  // =========================================================================
  const speechStart = userStartsAt
  const speechEnd = speechStart + speechSeconds * 1000
  markers.userSpeechStartMs = round(speechStart)
  markers.userSpeechEndMs = round(speechEnd)

  // Audio frames: emit a sampled subset so the timeline stays readable.
  const frameB = bytesPerFrame(callerFormat)
  const frameMs = callerFormat.frameMs ?? 20
  const totalFrames = Math.round((speechSeconds * 1000) / frameMs)
  const sampleEvery = Math.max(1, Math.round(totalFrames / 6))
  for (let i = 0; i < totalFrames; i += sampleEvery) {
    const at = speechStart + i * frameMs + hop.userEdge + hop.edgeServer
    const dropped = lossy && rng.chance(0.18)
    sim.emit({
      at,
      type: 'AUDIO_FRAME_RECEIVED',
      component: 'Media gateway',
      plane: 'media',
      status: dropped ? 'warn' : 'ok',
      summary: dropped
        ? `Audio frames ${i}–${Math.min(i + sampleEvery, totalFrames)} — packet loss, concealment engaged`
        : `Audio frames ${i}–${Math.min(i + sampleEvery, totalFrames)} of ${totalFrames}`,
      payloadType: `${callerFormat.encoding} @ ${callerFormat.sampleRate / 1000} kHz`,
      bytes: frameB * Math.min(sampleEvery, totalFrames - i),
      detail: { frameMs, bytesPerFrame: frameB, note: 'Sampled: one event shown per batch of frames.' },
    })
  }
  if (phone) {
    sim.emit({
      at: speechStart + hop.userEdge + hop.edgeServer + 2,
      type: 'AUDIO_TRANSCODED',
      component: 'Media gateway',
      plane: 'media',
      summary: 'mu-law 8 kHz → PCM16 16 kHz for STT (table decode + 2× upsample)',
      detail: { addedLatencyMs: 3, note: 'Cheap but not free; every conversion is in the budget.' },
    })
  }

  // VAD — speech onset detection.
  const vadDetectMs = load(30 + opts.vad.minSpeechMs)
  sim.emit({
    at: speechStart + hop.userEdge + hop.edgeServer + vadDetectMs,
    type: 'SPEECH_STARTED',
    component: 'VAD',
    plane: 'media',
    summary: `Speech detected (threshold ${opts.vad.speechThreshold}, min ${opts.vad.minSpeechMs} ms)`,
    detail: { confidence: round(0.7 + rng.fork('vadc').next() * 0.25), gate: `${opts.vad.minSpeechMs} ms minimum-duration filter` },
  })

  // STT — streaming partials or batch silence.
  const sttDown = fires('stt')
  const sttRateLimited = fires('rate-limit')
  let usedSttFallback = false
  let usedTtsFallback = false

  if (sttDown || sttRateLimited) {
    failuresEncountered.push(sttDown ? 'stt-unavailable' : 'stt-rate-limit')
    sim.emit({
      at: speechStart + hop.serverProvider + 40,
      type: 'PROVIDER_ERROR',
      component: 'STT',
      plane: 'media',
      status: 'error',
      summary: sttDown ? `${stt.name}: connection refused (provider outage)` : `${stt.name}: 429 rate limited (concurrency quota)`,
      detail: { provider: stt.name, error: sttDown ? 'ECONNREFUSED' : 'HTTP 429' },
    })
    if (opts.reliability.sttFallback) {
      usedSttFallback = true
      recoveries.push('stt-fallback')
      sim.emit({
        at: speechStart + 180,
        type: 'FALLBACK_ENGAGED',
        component: 'Agent runtime',
        plane: 'control',
        status: 'warn',
        summary: 'Fallback STT engaged (secondary provider, slightly slower + less accurate)',
        detail: { note: 'A cheaper/slower transcript beats a dead call. Fallbacks are pre-connected, not cold-started.' },
      })
    } else {
      // No fallback: the call dies after a retry window.
      sim.emit({
        at: speechEnd + opts.reliability.sttTimeoutMs,
        type: 'TIMEOUT',
        component: 'Agent runtime',
        plane: 'control',
        status: 'error',
        summary: `No transcript after ${opts.reliability.sttTimeoutMs} ms — no fallback configured`,
      })
      const endAt = speechEnd + opts.reliability.sttTimeoutMs + 400
      sim.emit({
        at: endAt, type: 'CALL_ENDED', component: 'Agent runtime', plane: 'control', status: 'error',
        summary: 'Call failed: agent is deaf and has no fallback. Caller hears an apology prompt and is disconnected.',
      })
      markers.callEndMs = round(endAt)
      markers.turnCompleteMs = markers.finalTranscriptMs = markers.userSpeechEndMs
      sim.run()
      return finish('failed', 'STT unavailable with no fallback provider — the call could not continue.')
    }
  }

  const sttResult = stt.transcribe(
    {
      utterance: opts.utterance,
      audioSeconds: speechSeconds,
      format: phone ? FORMATS.pcm16k : FORMATS.pcm16k,
      noiseLevel: opts.noiseLevel,
      language: opts.language,
      narrowband: phone,
    },
    rng.fork('stt'),
  )
  // Apply fallback penalties to timings.
  const partialShift = usedSttFallback ? 180 : 0
  const sttProcessingBase = speechStart + hop.userEdge + hop.edgeServer + hop.serverProvider

  let firstPartialEmitted = false
  for (const p of sttResult.partials) {
    const at = sttProcessingBase + load(p.atMs + partialShift) + (p.isFinal ? 0 : 0)
    if (!p.isFinal) {
      if (!firstPartialEmitted) {
        markers.firstTranscriptMs = round(at + hop.serverProvider)
        firstPartialEmitted = true
      }
      sim.emit({
        at: at + hop.serverProvider,
        type: 'TRANSCRIPT_PARTIAL',
        component: 'STT',
        plane: 'media',
        summary: `“${truncate(p.text, 52)}”${p.revised ? '  (revised earlier words)' : ''}`,
        payloadType: 'JSON over WebSocket',
        bytes: p.text.length + 90,
        detail: { confidence: p.confidence, stable: !p.revised },
      })
    }
  }
  if (!firstPartialEmitted) {
    markers.firstTranscriptMs = 0 // batch STT: no partials at all
  }

  sim.emit({
    at: speechEnd + hop.userEdge + hop.edgeServer + 20,
    type: 'SPEECH_ENDED',
    component: 'VAD',
    plane: 'media',
    summary: 'Audio energy dropped below threshold — silence begins',
  })

  // Endpointing: VAD waits silenceTimeout; STT finalization runs in parallel.
  const endpointAt = speechEnd + hop.userEdge + hop.edgeServer + load(opts.vad.silenceTimeoutMs)
  sim.emit({
    at: endpointAt,
    type: 'ENDPOINT_DETECTED',
    component: 'VAD',
    plane: 'media',
    summary: `${opts.vad.silenceTimeoutMs} ms of silence — the user has probably finished their thought`,
    detail: { note: '“Stopped making sound” (VAD) vs “finished the thought” (turn detection). This gate is the tradeoff between interrupting and feeling slow.' },
  })

  const finalAt = sttProcessingBase + load(speechSeconds * 1000 + sttResult.finalizeMs + partialShift) + hop.serverProvider
  markers.finalTranscriptMs = round(finalAt)
  finalTranscript = sttResult.finalText
  wer = usedSttFallback ? Math.min(0.9, sttResult.wer + 0.05) : sttResult.wer
  sim.emit({
    at: finalAt,
    type: 'TRANSCRIPT_FINAL',
    component: 'STT',
    plane: 'media',
    status: wer > 0.2 ? 'warn' : 'ok',
    summary: `Final: “${truncate(finalTranscript, 60)}”`,
    payloadType: 'JSON over WebSocket',
    bytes: finalTranscript.length + 120,
    detail: { simulatedWER: wer, confidence: round(1 - wer, 2), finalizeMs: sttResult.finalizeMs },
  })

  const turnCompleteAt = Math.max(endpointAt, finalAt)
  markers.turnCompleteMs = round(turnCompleteAt)
  sim.emit({
    at: turnCompleteAt,
    type: 'TURN_COMPLETE',
    component: 'Agent runtime',
    plane: 'control',
    summary: 'Turn committed: endpoint + final transcript both in. State: LISTENING → PROCESSING',
    detail: {
      gatedBy: endpointAt >= finalAt ? 'VAD silence timeout' : 'STT finalization',
      note: 'Whichever of the two arrives later gates the turn — a key tuning insight.',
    },
  })

  // =========================================================================
  // 4. Agent runtime → LLM (with tools) — or S2S short-circuit
  // =========================================================================
  let ttsTextReadyAt: number // when the first speakable sentence exists

  if (opts.s2sMode) {
    // Speech-to-speech: model consumed audio directly; it needs no transcript.
    const firstAudio = turnCompleteAt + hop.serverProvider + load(s2s.firstAudioMs)
    sim.emit({
      at: turnCompleteAt + 5, type: 'LLM_STARTED', component: 'S2S model', plane: 'media',
      summary: `${s2s.name}: generating audio response directly from speech`,
      detail: { note: 'No STT/TTS hops — and no intermediate transcript to inspect.' },
    })
    ttsTextReadyAt = firstAudio
    void firstAudio
    markers.firstLlmTokenMs = round(firstAudio)
  } else {
    sim.emit({
      at: turnCompleteAt + load(8),
      type: 'CONTEXT_BUILT',
      component: 'Agent runtime',
      plane: 'control',
      summary: `Prompt assembled: system + history + tools = ~${opts.llmContextTokens} tokens`,
      bytes: opts.llmContextTokens * 4,
      detail: { note: 'Context size is a per-turn latency and cost tax. Trim ruthlessly.' },
    })

    const llmDown = fires('llm')
    const llmCall = (label: string, at: number, expectTool: boolean, retryUsed: boolean): { firstTok: number; done: number; toolAt?: number; failed: boolean } => {
      const r = llm.complete(
        {
          inputTokens: opts.llmContextTokens,
          expectedOutputTokens: expectTool ? 30 : opts.llmOutputTokens,
          streaming: opts.streamingLlm,
          toolCallExpected: expectTool,
        },
        rng.fork(`llm-${label}`),
      )
      const start = at + hop.serverProvider
      sim.emit({
        at, type: 'LLM_STARTED', component: 'LLM', plane: 'media',
        summary: `${llm.name}: ${expectTool ? 'deciding action (tools available)' : 'generating response'}${retryUsed ? ' — retry attempt' : ''}`,
        detail: { inputTokens: opts.llmContextTokens, streaming: opts.streamingLlm, provider: llm.name },
      })

      if (llmDown && !retryUsed) {
        // First attempt hangs until the client timeout.
        const to = at + opts.reliability.llmTimeoutMs
        failuresEncountered.push('llm-timeout')
        sim.emit({
          at: to, type: 'TIMEOUT', component: 'Agent runtime', plane: 'control', status: 'error',
          summary: `LLM exceeded ${opts.reliability.llmTimeoutMs} ms budget — aborting attempt`,
          detail: { note: 'Without an explicit timeout this call would hang forever. The budget IS the design.' },
        })
        return { firstTok: to, done: to, failed: true }
      }

      const firstTok = start + load(r.firstTokenMs)
      sim.emit({
        at: firstTok, type: 'LLM_FIRST_TOKEN', component: 'LLM', plane: 'media',
        summary: `First token after ${Math.round(firstTok - at)} ms (prefill ${r.firstTokenMs} ms + network)`,
        durationMs: r.firstTokenMs,
      })
      // Sampled token events.
      const tokens = r.outputTokens
      const tokenSpanMs = r.completionMs - r.firstTokenMs
      for (const frac of [0.33, 0.66]) {
        sim.emit({
          at: firstTok + tokenSpanMs * frac, type: 'LLM_TOKEN', component: 'LLM', plane: 'media',
          summary: `~${Math.round(tokens * frac)} of ${tokens} tokens streamed`,
          payloadType: 'SSE token deltas',
        })
      }
      const done = firstTok + tokenSpanMs
      sim.emit({
        at: done, type: 'LLM_COMPLETED', component: 'LLM', plane: 'media',
        summary: `Generation complete: ${tokens} tokens in ${Math.round(done - at)} ms total`,
        durationMs: done - at,
        detail: { outputTokens: tokens, tokensPerSecond: llm.tokensPerSecond },
      })
      return {
        firstTok,
        done,
        toolAt: expectTool ? at + hop.serverProvider + load(r.toolCallAtMs ?? r.completionMs) : undefined,
        failed: false,
      }
    }

    // First LLM round (tool decision if tools configured).
    const expectTool = opts.toolCalls.length > 0
    let round1 = llmCall('r1', turnCompleteAt + load(12), expectTool, false)
    if (round1.failed) {
      if (opts.reliability.llmRetry) {
        recoveries.push('llm-retry')
        sim.emit({
          at: round1.done + 30, type: 'RETRY', component: 'Agent runtime', plane: 'control', status: 'warn',
          summary: 'Retrying LLM request (attempt 2, fresh connection)',
          detail: { backoff: '30 ms + jitter — voice budgets do not allow polite exponential waits on turn 1' },
        })
        round1 = llmCall('r1b', round1.done + 40, expectTool, true)
      } else {
        const endAt = round1.done + 500
        sim.emit({
          at: endAt, type: 'CALL_ENDED', component: 'Agent runtime', plane: 'control', status: 'error',
          summary: 'Call failed: LLM timeout with retries disabled. Caller hears “I\'m having trouble right now.”',
        })
        markers.callEndMs = round(endAt)
        sim.run()
        return finish('failed', 'LLM timed out and retry was disabled.')
      }
    }
    markers.firstLlmTokenMs = round(round1.firstTok)

    // Tool calls.
    let afterTools = round1.done
    if (expectTool && round1.toolAt !== undefined) {
      let toolClock = round1.toolAt
      for (const tool of opts.toolCalls) {
        const span = sim.openSpan('tool')
        sim.emit({
          at: toolClock, type: 'TOOL_CALL_STARTED', component: 'Tool: ' + tool.name, plane: 'control',
          summary: `LLM requested ${tool.name}(…) — arguments validated against schema`,
          spanId: span.id,
          detail: { note: 'Validate before executing: models emit malformed arguments under pressure.' },
        })
        const toolFails = fires('tool') || fires('database')
        const dbDown = fires('database')
        sim.emit({
          at: toolClock + 15, type: 'DB_QUERY', component: dbDown ? 'Database' : 'Tool: ' + tool.name, plane: 'control',
          status: dbDown ? 'error' : 'ok',
          summary: dbDown ? 'Database unavailable — connection refused' : `Backend query for ${tool.name}`,
          detail: { timeoutBudgetMs: opts.reliability.toolTimeoutMs },
        })

        if (toolFails) {
          failuresEncountered.push(dbDown ? 'database-unavailable' : 'tool-timeout')
          const toAt = toolClock + opts.reliability.toolTimeoutMs
          // Filler speech while waiting, if the wait exceeds the filler budget.
          if (opts.reliability.fillerAfterMs < opts.reliability.toolTimeoutMs) {
            sim.emit({
              at: toolClock + opts.reliability.fillerAfterMs, type: 'TTS_STARTED', component: 'TTS', plane: 'media', status: 'info',
              summary: 'Filler spoken: “One moment, let me check that for you…”',
              detail: { note: 'Dead air over ~1 s reads as a broken call. Filler buys the backend time.' },
            })
          }
          sim.emit({
            at: toAt, type: 'TIMEOUT', component: 'Tool: ' + tool.name, plane: 'control', status: 'error',
            summary: `${tool.name} exceeded its ${opts.reliability.toolTimeoutMs} ms budget`, spanId: span.id,
          })
          if (opts.reliability.toolRetry && !dbDown) {
            recoveries.push('tool-retry')
            sim.emit({
              at: toAt + 50, type: 'RETRY', component: 'Agent runtime', plane: 'control', status: 'warn',
              summary: `Retrying ${tool.name} once (idempotent read)`,
            })
            const retryDone = toAt + 50 + load(tool.latencyMs * 0.8)
            sim.emit({
              at: retryDone, type: 'TOOL_CALL_COMPLETED', component: 'Tool: ' + tool.name, plane: 'control',
              summary: `${tool.name} → ${tool.resultSummary} (retry succeeded)`, spanId: span.id,
              durationMs: retryDone - toolClock,
            })
            toolClock = retryDone + 10
          } else {
            sim.emit({
              at: toAt + 60, type: 'TOOL_CALL_COMPLETED', component: 'Agent runtime', plane: 'control', status: 'warn',
              summary: `${tool.name} abandoned — agent will apologise and offer a callback`, spanId: span.id,
              detail: { degraded: true, note: dbDown ? 'Database down: reads have no source of truth. Writes should queue for later.' : 'Tool failure becomes conversation design: acknowledge, offer alternative.' },
            })
            toolClock = toAt + 70
          }
        } else {
          const done = toolClock + 15 + load(rng.fork(`tool-${tool.name}`).logNormal(tool.latencyMs, 0.3))
          sim.emit({
            at: done, type: 'TOOL_CALL_COMPLETED', component: 'Tool: ' + tool.name, plane: 'control',
            summary: `${tool.name} → ${tool.resultSummary}`, spanId: span.id, durationMs: done - toolClock,
            bytes: 350,
          })
          toolClock = done + 10
        }
        sim.emit({
          at: toolClock, type: 'STATE_WRITTEN', component: 'Redis', plane: 'control',
          summary: 'Conversation state updated with tool result (session hash, TTL refreshed)',
          detail: { latencyMs: 1 },
        })
        toolClock += 5
      }

      // Second LLM round to phrase the answer.
      const round2 = llmCall('r2', toolClock, false, false)
      afterTools = round2.done
      ttsTextReadyAt = opts.streamingLlm
        ? round2.firstTok + load((15 / llm.tokensPerSecond) * 1000) // first sentence ≈ 15 tokens
        : round2.done
    } else {
      ttsTextReadyAt = opts.streamingLlm
        ? round1.firstTok + load((15 / llm.tokensPerSecond) * 1000)
        : round1.done
    }
    void afterTools
  }

  // =========================================================================
  // 5. TTS — streaming synthesis and playback
  // =========================================================================
  const ttsDown = !opts.s2sMode && fires('tts')
  let ttsStartAt = ttsTextReadyAt + 5

  if (ttsDown) {
    failuresEncountered.push('tts-unavailable')
    sim.emit({
      at: ttsStartAt, type: 'PROVIDER_ERROR', component: 'TTS', plane: 'media', status: 'error',
      summary: `${tts.name}: connection refused (provider outage)`,
      detail: { provider: tts.name },
    })
    if (opts.reliability.ttsFallback) {
      usedTtsFallback = true
      recoveries.push('tts-fallback')
      sim.emit({
        at: ttsStartAt + 120, type: 'FALLBACK_ENGAGED', component: 'Agent runtime', plane: 'control', status: 'warn',
        summary: 'Fallback TTS engaged — cheaper voice, same words',
        detail: { note: 'The caller hears a different voice mid-call. Jarring, but infinitely better than silence.' },
      })
      ttsStartAt += 140
    } else {
      const endAt = ttsStartAt + opts.reliability.ttsTimeoutMs
      sim.emit({
        at: endAt, type: 'CALL_ENDED', component: 'Agent runtime', plane: 'control', status: 'error',
        summary: 'Call failed: the agent composed a reply but has no voice and no fallback.',
      })
      markers.callEndMs = round(endAt)
      sim.run()
      return finish('failed', 'TTS unavailable with no fallback — reply generated but never spoken.')
    }
  }

  const speakText = opts.responseText
  const ttsFmt = phone ? FORMATS.pcm24k : FORMATS.pcm24k
  const effTts = usedTtsFallback ? { penaltyMs: 120 } : { penaltyMs: 0 }
  const ttsRes = tts.synthesize(
    { text: speakText, language: opts.language, format: ttsFmt, streaming: opts.streamingTts && tts.streaming },
    rng.fork('tts-main'),
  )

  sim.emit({
    at: ttsStartAt, type: 'TTS_STARTED', component: 'TTS', plane: 'media',
    summary: `Synthesis started: “${truncate(speakText, 46)}”`,
    detail: {
      provider: usedTtsFallback ? 'Fallback voice' : tts.name,
      streaming: opts.streamingTts && tts.streaming,
      firstSentenceOnly: opts.streamingLlm && !opts.s2sMode,
    },
  })

  const firstAudioAt = ttsStartAt + hop.serverProvider + load(ttsRes.firstAudioMs + effTts.penaltyMs)
  markers.firstTtsAudioMs = round(firstAudioAt)
  sim.emit({
    at: firstAudioAt, type: 'TTS_FIRST_AUDIO', component: 'TTS', plane: 'media',
    summary: `First audio chunk ready (${Math.round(ttsRes.firstAudioMs + effTts.penaltyMs)} ms time-to-first-audio)`,
    bytes: ttsRes.chunks[0]?.bytes ?? 0,
    payloadType: `${ttsFmt.encoding} @ ${ttsFmt.sampleRate / 1000} kHz`,
  })

  if (phone) {
    sim.emit({
      at: firstAudioAt + hop.serverProvider + 2, type: 'AUDIO_TRANSCODED', component: 'Media gateway', plane: 'media',
      summary: 'PCM 24 kHz → mu-law 8 kHz for the carrier (downsample + companding)',
      detail: { note: 'The premium 24 kHz voice is band-limited to 3.4 kHz by the phone network. Paying for studio quality on a phone call buys less than it seems.' },
    })
  }

  const playbackStartAt = firstAudioAt + hop.serverProvider + hop.edgeServer + hop.userEdge + 10
  markers.playbackStartMs = round(playbackStartAt)
  sim.emit({
    at: playbackStartAt, type: 'PLAYBACK_STARTED', component: 'User (caller)', plane: 'media',
    summary: '🔊 Caller hears the agent — perceived latency clock stops here',
    detail: {
      perceivedLatencyMs: round(playbackStartAt - speechEnd),
      note: 'Measured from end of user speech to first audible agent audio.',
    },
  })
  sim.count('turns', 1)

  // Stream remaining chunks (tagged so barge-in can cancel them).
  const agentAudioSeconds = ttsRes.audioSeconds
  for (const c of ttsRes.chunks.slice(1, 5)) {
    sim.emit({
      at: ttsStartAt + hop.serverProvider + load(c.atMs + effTts.penaltyMs), type: 'TTS_AUDIO_CHUNK', component: 'TTS', plane: 'media',
      summary: `Audio chunk ${c.index + 1}/${ttsRes.chunks.length} (${c.audioSeconds}s)`,
      bytes: c.bytes,
    })
  }

  // =========================================================================
  // 6. Interruption (barge-in), handoff, call end
  // =========================================================================
  let callEndAt: number
  let handoffOutcome: 'completed' | 'failed-fallback' | null = null

  if (opts.interruption) {
    const bargeAt = playbackStartAt + opts.interruption.afterPlaybackMs
    sim.emit({
      at: bargeAt, type: 'SPEECH_STARTED', component: 'VAD', plane: 'media', status: 'warn',
      summary: `Speech detected WHILE agent audio is playing: “${truncate(opts.interruption.utterance, 30)}”`,
      detail: { playbackActive: true },
    })
    sim.emit({
      at: bargeAt + load(40), type: 'USER_INTERRUPTION', component: 'Agent runtime', plane: 'control', status: 'warn',
      summary: 'Barge-in confirmed (speech sustained past the accidental-noise gate). State: SPEAKING → INTERRUPTED',
    })
    sim.emit({
      at: bargeAt + load(45), type: 'TTS_CANCELLED', component: 'TTS', plane: 'media',
      summary: 'Synthesis cancelled upstream — stop paying for words nobody will hear',
    })
    sim.emit({
      at: bargeAt + load(50), type: 'BUFFER_CLEARED', component: 'Media gateway', plane: 'media',
      summary: 'Outbound audio buffer flushed — without this the agent keeps talking for seconds after “stopping”',
      detail: { note: 'The #1 barge-in bug: cancelling TTS but not clearing already-buffered audio at the transport.' },
    })
    sim.emit({
      at: bargeAt + load(60), type: 'NOTE', component: 'Agent runtime', plane: 'control',
      summary: 'State: INTERRUPTED → LISTENING. New user turn begins; partial agent reply logged in history.',
    })
    // Quick second turn: short ack response.
    const t2SpeechSec = Math.max(0.5, (opts.interruption.utterance.split(/\s+/).length / wpm) * 60)
    const t2End = bargeAt + t2SpeechSec * 1000
    const t2Final = t2End + hop.userEdge + hop.edgeServer + hop.serverProvider + load(stt.streaming ? stt.finalizeMs : 700)
    sim.emit({
      at: t2Final, type: 'TRANSCRIPT_FINAL', component: 'STT', plane: 'media',
      summary: `Final: “${truncate(opts.interruption.utterance, 50)}”`,
    })
    const t2llm = llm.complete(
      { inputTokens: opts.llmContextTokens + 80, expectedOutputTokens: 25, streaming: opts.streamingLlm, toolCallExpected: false },
      rng.fork('llm-t2'),
    )
    const t2Turn = Math.max(t2Final, t2End + hop.userEdge + hop.edgeServer + load(opts.vad.silenceTimeoutMs))
    const t2First = t2Turn + hop.serverProvider + load(t2llm.firstTokenMs)
    sim.emit({ at: t2Turn, type: 'TURN_COMPLETE', component: 'Agent runtime', plane: 'control', summary: 'Interruption turn committed' })
    const t2ttsAt = (opts.streamingLlm ? t2First + load((12 / llm.tokensPerSecond) * 1000) : t2Turn + load(t2llm.completionMs)) + 5
    const t2Play = t2ttsAt + hop.serverProvider + load(tts.firstAudioMs) + hop.serverProvider + hop.edgeServer + hop.userEdge
    sim.emit({
      at: t2Play, type: 'PLAYBACK_STARTED', component: 'User (caller)', plane: 'media',
      summary: '🔊 Agent answers the interruption',
      detail: { perceivedLatencyMs: round(t2Play - t2End) },
    })
    callEndAt = t2Play + 2500
  } else {
    callEndAt = playbackStartAt + agentAudioSeconds * 1000 + 600
  }

  if (opts.handoff?.requested) {
    const h = opts.handoff
    const hStart = callEndAt - 300
    sim.emit({
      at: hStart, type: 'HANDOFF_REQUESTED', component: 'Agent runtime', plane: 'control',
      summary: 'Escalation triggered — agent requests human transfer. State: AI_ACTIVE → TRANSFERRING',
      detail: { reason: 'Policy: premium quote above threshold requires a licensed human agent (example rule).' },
    })
    const humanDown = fires('human-unavailable') || !h.agentAvailable
    sim.emit({
      at: hStart + 60, type: 'NOTE', component: 'Handoff service', plane: 'control',
      summary: `CHECK_AGENT_AVAILABILITY → ${humanDown ? 'no agents free' : 'agent found in “insurance” queue'}`,
    })
    if (humanDown) {
      failuresEncountered.push('human-unavailable')
      sim.emit({
        at: hStart + 100, type: 'HANDOFF_QUEUED', component: 'Handoff service', plane: 'control', status: 'warn',
        summary: `All human agents busy — caller queued (est. wait ${Math.round(h.queueWaitMs / 1000)}s, position told honestly)`,
      })
      const resolved = hStart + 100 + h.queueWaitMs
      if (h.queueWaitMs > 45_000) {
        sim.emit({
          at: hStart + 30_000, type: 'HANDOFF_FAILED', component: 'Handoff service', plane: 'control', status: 'error',
          summary: 'Queue wait exceeds policy — falling back: AI offers scheduled callback + voicemail',
          detail: { note: '“Transfer and hope” is not a design. Every handoff needs a no-agent branch the caller can hear.' },
        })
        callEndAt = hStart + 34_000
        sim.emit({ at: callEndAt - 1200, type: 'NOTE', component: 'Agent runtime', plane: 'control', summary: 'Callback booked for 4:30 pm; confirmation SMS queued (async job)' })
        finishHandoffOutcome('failed-fallback')
      } else {
        emitHandoffSuccess(resolved)
        callEndAt = resolved + 4600
      }
    } else {
      emitHandoffSuccess(hStart + 120 + h.acceptDelayMs)
      callEndAt = hStart + 120 + h.acceptDelayMs + 4600
    }
  }

  function finishHandoffOutcome(kind: 'completed' | 'failed-fallback') {
    handoffOutcome = kind
  }
  function emitHandoffSuccess(acceptAt: number) {
    sim.emit({
      at: acceptAt, type: 'HANDOFF_ACCEPTED', component: 'Human agent', plane: 'control',
      summary: 'Human agent accepted — screen-pop with transcript, intent and CRM record',
    })
    sim.emit({
      at: acceptAt + 350, type: 'NOTE', component: 'Handoff service', plane: 'media',
      summary: 'MEDIA_HANDOFF: conference bridge joins human leg; caller audio re-anchored (SIP REFER / bridge)',
    })
    sim.emit({
      at: acceptAt + 700, type: 'NOTE', component: 'Handoff service', plane: 'control',
      summary: 'CONTEXT_TRANSFER: transcript + collected slots + tool results attached to the agent desktop',
      detail: { note: 'A handoff without context transfer forces the caller to repeat everything — the #1 handoff complaint.' },
    })
    sim.emit({
      at: acceptAt + 1500, type: 'NOTE', component: 'Agent runtime', plane: 'control',
      summary: 'AI_LEAVES: AI media legs torn down; session marked human-active; billing meters switch',
    })
    sim.emit({
      at: acceptAt + 2500, type: 'HANDOFF_COMPLETED', component: 'Handoff service', plane: 'control',
      summary: 'HUMAN_CONTINUES: conversation proceeds human-to-human. State: TRANSFERRING → HUMAN_ACTIVE',
    })
    finishHandoffOutcome('completed')
  }

  // WebSocket mid-call disconnect (if armed and not already fatal elsewhere).
  if (fires('websocket')) {
    failuresEncountered.push('websocket-disconnect')
    const dropAt = markers.playbackStartMs > 0 ? markers.playbackStartMs - 200 : speechEnd + 100
    sim.emit({
      at: dropAt, type: 'NETWORK_ERROR', component: 'WebSocket', plane: 'media', status: 'error',
      summary: 'Media WebSocket dropped (close code 1006 — abnormal closure)',
    })
    if (opts.reliability.wsReconnect) {
      recoveries.push('ws-reconnect')
      sim.emit({
        at: dropAt + 320, type: 'RECONNECT', component: 'Media gateway', plane: 'media', status: 'warn',
        summary: 'Reconnected with session-resume token; ~320 ms of caller audio lost to the gap',
        detail: { note: 'Resume beats restart: session state in Redis lets any gateway instance adopt the call.' },
      })
    } else {
      sim.emit({
        at: dropAt + 100, type: 'CALL_ENDED', component: 'Media gateway', plane: 'control', status: 'error',
        summary: 'Call dropped: media path severed and no reconnect strategy exists.',
      })
      markers.callEndMs = round(dropAt + 100)
      sim.run()
      return finish('dropped', 'WebSocket disconnected mid-call with reconnect disabled.')
    }
  }

  sim.emit({
    at: callEndAt, type: 'CALL_ENDED', component: 'Agent runtime', plane: 'control',
    summary: handoffOutcome === 'completed'
      ? 'Call continues with the human agent — AI portion ends'
      : 'Call completed; session state persisted, transcript + recording enqueued (async)',
    detail: { asyncJobs: 'transcript→Postgres, recording→object storage, CRM update→queue' },
  })
  markers.callEndMs = round(callEndAt)

  sim.run()

  if (handoffOutcome === 'completed') {
    outcome = 'handed-off'
    outcomeReason = 'Escalated to a human agent with full context transfer.'
  } else if (handoffOutcome === 'failed-fallback') {
    outcome = 'completed'
    outcomeReason = 'Handoff impossible (no agents); AI fell back to callback scheduling.'
  }

  return finish(outcome, outcomeReason)

  // -------------------------------------------------------------------------

  function finish(oc: CallSimResult['outcome'], reason: string): CallSimResult {
    const latency = buildLatencyBreakdown(opts, markers, hop, { usedSttFallback, usedTtsFallback })
    return {
      events: [...sim.eventLog],
      latency,
      outcome: oc,
      outcomeReason: reason,
      finalTranscript,
      wer,
      markers,
      failuresEncountered: [...new Set(failuresEncountered)],
      recoveries: [...new Set(recoveries)],
      counters: sim.allCounters,
      seed: opts.seed,
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

interface HopModel {
  userEdge: number
  edgeServer: number
  serverProvider: number
}

// ---------------------------------------------------------------------------
// Latency breakdown from markers
// ---------------------------------------------------------------------------

function buildLatencyBreakdown(
  opts: CallSimOptions,
  m: {
    userSpeechStartMs: number
    userSpeechEndMs: number
    turnCompleteMs: number
    firstTranscriptMs: number
    finalTranscriptMs: number
    firstLlmTokenMs: number
    firstTtsAudioMs: number
    playbackStartMs: number
  },
  hop: HopModel,
  flags: { usedSttFallback: boolean; usedTtsFallback: boolean },
): LatencyBreakdown {
  const segments: LatencySegment[] = []
  const speechEnd = m.userSpeechEndMs
  const notes: string[] = []

  const push = (
    key: string,
    label: string,
    startMs: number,
    endMs: number,
    stage: LatencySegment['stage'],
    explanation: string,
    criticalPath = true,
  ) => {
    const ms = Math.max(0, round(endMs - startMs))
    if (ms <= 0) return
    segments.push({ key, label, ms, stage, criticalPath, explanation, startMs: round(startMs - speechEnd) })
  }

  if (m.playbackStartMs > 0 && speechEnd > 0) {
    const netIn = hop.userEdge + hop.edgeServer
    push('net-in', 'Inbound network', speechEnd, speechEnd + netIn, 'network',
      'Last audio frames travel user → edge → gateway. Physics: distance and hops.')
    push('endpoint', 'Endpointing wait', speechEnd + netIn, m.turnCompleteMs, 'detect',
      m.turnCompleteMs >= m.finalTranscriptMs
        ? `VAD waited ${opts.vad.silenceTimeoutMs} ms of silence to decide the turn was over — usually the single largest segment, and pure tuning.`
        : 'STT finalization arrived after the VAD endpoint and gated the turn.')
    if (m.firstLlmTokenMs > 0) {
      push('llm-ttft', 'LLM time-to-first-token', m.turnCompleteMs, m.firstLlmTokenMs, 'llm',
        'Prompt upload + prefill + queueing at the model. Context size taxes this on every turn.')
    }
    if (m.firstTtsAudioMs > m.firstLlmTokenMs && m.firstLlmTokenMs > 0) {
      push('llm-sentence', 'First sentence + TTS first audio', m.firstLlmTokenMs, m.firstTtsAudioMs, 'tts',
        'Enough tokens for a speakable sentence, then TTS time-to-first-audio. Streaming overlaps these; batch serialises them.')
    }
    push('net-out', 'Outbound network + jitter buffer', m.firstTtsAudioMs, m.playbackStartMs, 'network',
      'Audio chunk travels back gateway → edge → user, plus a small playout buffer.')
  }

  const perceived = m.playbackStartMs > 0 ? round(m.playbackStartMs - speechEnd) : Infinity
  if (flags.usedSttFallback) notes.push('STT fallback added ~150–300 ms this call — the price of surviving the outage.')
  if (flags.usedTtsFallback) notes.push('TTS fallback engaged: different voice, ~120 ms extra first-audio.')
  notes.push('All figures are simulation assumptions; the relationships between them are the lesson, not the absolute values.')

  return {
    segments,
    // Measured from speech START: how quickly words appear while talking.
    timeToFirstTranscriptMs: m.firstTranscriptMs > 0 ? round(m.firstTranscriptMs - m.userSpeechStartMs) : -1,
    timeToFinalTranscriptMs: round(m.finalTranscriptMs - speechEnd),
    timeToFirstLlmTokenMs: m.firstLlmTokenMs > 0 ? round(m.firstLlmTokenMs - speechEnd) : -1,
    timeToFirstTtsAudioMs: m.firstTtsAudioMs > 0 ? round(m.firstTtsAudioMs - speechEnd) : -1,
    perceivedLatencyMs: perceived,
    totalResponseMs: perceived,
    budgetMs: 800,
    withinBudget: perceived <= 800,
    notes,
  }
}
