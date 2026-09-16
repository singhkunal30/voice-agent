/**
 * Simulated provider implementations.
 *
 * Each provider is a deterministic model: given the same request and the same
 * Rng stream it produces the same partials, the same timings, the same
 * corrupted words. The profiles ("fast managed streaming STT", "self-hosted
 * batch STT", "premium streaming TTS"...) are EXAMPLE ASSUMPTIONS designed to
 * make the differences between provider *classes* visible; every number is
 * editable in the labs and none of them is a measurement of a real vendor.
 */

import type { Rng } from '../engine/rng'
import { bytesPerSecond } from '../models/audio'
import type {
  CallRequest,
  CallResult,
  LlmProvider,
  LlmRequest,
  LlmResult,
  S2sProvider,
  SttPartial,
  SttProvider,
  SttRequest,
  SttResult,
  TelephonyProvider,
  TtsChunk,
  TtsProvider,
  TtsRequest,
  TtsResult,
} from './types'
import { FORMATS } from '../models/audio'

// ---------------------------------------------------------------------------
// Word corruption — makes WER visible instead of abstract
// ---------------------------------------------------------------------------

/** Plausible mishearings for the demo domain, so errors look like STT errors. */
const CONFUSIONS: Record<string, string[]> = {
  one: ['won'],
  crore: ['karor', 'crow'],
  lakh: ['lac', 'lock'],
  premium: ['premier', 'premiums'],
  policy: ['policies', 'polish'],
  insurance: ['assurance'],
  know: ['no'],
  want: ['wont'],
  for: ['four'],
  to: ['two'],
  book: ['brook'],
  appointment: ['appointments'],
  order: ['odour', 'older'],
  status: ['state as'],
  claim: ['clam'],
  renew: ['re new'],
  term: ['turn'],
  cover: ['covered'],
  quote: ['coat'],
  wait: ['weight'],
  eight: ['ate'],
  agent: ['asian t'],
  human: ['humane'],
}

function corruptWord(word: string, rng: Rng): string {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '')
  const options = CONFUSIONS[lower]
  if (options && options.length) return rng.pick(options)
  if (word.length <= 3) return word // short words: dropped instead — handled by caller
  // Generic corruption: drop or double an interior character.
  const i = rng.int(1, word.length - 2)
  return rng.chance(0.5) ? word.slice(0, i) + word.slice(i + 1) : word.slice(0, i) + word[i] + word.slice(i)
}

export interface CorruptedTranscript {
  text: string
  substitutions: number
  deletions: number
  wer: number
}

export function corruptTranscript(utterance: string, targetWer: number, rng: Rng): CorruptedTranscript {
  const words = utterance.split(/\s+/).filter(Boolean)
  if (words.length === 0) return { text: '', substitutions: 0, deletions: 0, wer: 0 }
  let substitutions = 0
  let deletions = 0
  const out: string[] = []
  for (const w of words) {
    if (rng.chance(targetWer)) {
      if (w.length <= 3 && rng.chance(0.4)) {
        deletions++
        continue // word dropped entirely
      }
      out.push(corruptWord(w, rng))
      substitutions++
    } else {
      out.push(w)
    }
  }
  const wer = (substitutions + deletions) / words.length
  return { text: out.join(' '), substitutions, deletions, wer: Math.round(wer * 1000) / 1000 }
}

// ---------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------

function makeSttTranscribe(self: SttProvider) {
  return (req: SttRequest, rng: Rng): SttResult => {
    const notes: string[] = []
    let wer = self.baseWer
    if (req.narrowband || req.format.sampleRate <= 8000) {
      wer += self.narrowbandWerPenalty
      notes.push('8 kHz narrowband input: recognition accuracy penalty applied (simulation assumption).')
    }
    // Noise raises WER steeply once it passes "office background" levels.
    wer += req.noiseLevel * req.noiseLevel * 0.35
    wer += (req.accentStrength ?? 0) * 0.05
    if (!self.languages.includes(req.language) && !self.languages.includes('*')) {
      wer += 0.25
      notes.push(`Language ${req.language} is outside this engine's supported set — heavy accuracy penalty.`)
    }
    wer = Math.min(0.85, Math.max(0.005, wer))

    const words = req.utterance.split(/\s+/).filter(Boolean)
    const speechMs = req.audioSeconds * 1000
    const partials: SttPartial[] = []
    let firstPartialMs = Infinity

    if (self.streaming) {
      firstPartialMs = Math.max(40, rng.logNormal(self.firstPartialMs, 0.25))
      // Partial hypotheses accumulate words roughly in real time; some partials
      // revise earlier words, which is why UIs debounce them.
      let t = firstPartialMs
      let idx = Math.max(1, Math.round((firstPartialMs / speechMs) * words.length))
      while (idx < words.length && t < speechMs) {
        const revised = rng.chance(0.18)
        const soFar = corruptTranscript(words.slice(0, idx).join(' '), Math.min(wer * 1.6, 0.9), rng.fork(`p${idx}`))
        partials.push({
          atMs: Math.round(t),
          text: soFar.text,
          isFinal: false,
          confidence: Math.round((0.55 + 0.35 * (idx / words.length)) * 100) / 100,
          revised,
        })
        t += Math.max(80, rng.logNormal(self.partialIntervalMs, 0.2))
        idx = Math.min(words.length, idx + rng.int(1, 3))
      }
    }

    const finalCorrupt = corruptTranscript(req.utterance, wer, rng.fork('final'))
    let finalizeMs: number
    if (self.streaming) {
      finalizeMs = Math.max(30, rng.logNormal(self.finalizeMs, 0.3))
    } else {
      // Batch: the whole utterance is processed after it ends.
      const rtf = self.realtimeFactor ?? 0.3
      finalizeMs = Math.max(100, rng.logNormal(self.finalizeMs + speechMs * rtf, 0.2))
      notes.push(
        `Batch engine: ~${(rtf).toFixed(2)}x real time means a ${req.audioSeconds.toFixed(1)} s utterance adds ` +
          `~${Math.round(speechMs * rtf)} ms of processing after the user stops talking.`,
      )
    }

    partials.push({
      atMs: Math.round(speechMs + finalizeMs),
      text: finalCorrupt.text,
      isFinal: true,
      confidence: Math.round((1 - finalCorrupt.wer) * 0.95 * 100) / 100,
      revised: false,
    })

    return {
      partials,
      finalText: finalCorrupt.text,
      wer: finalCorrupt.wer,
      finalizeMs: Math.round(finalizeMs),
      firstPartialMs: self.streaming ? Math.round(firstPartialMs) : Infinity,
      audioSecondsBilled: Math.max(req.audioSeconds, self.deployment === 'managed' ? 1 : 0),
      degraded: finalCorrupt.wer > 0.18,
      notes,
    }
  }
}

function sttProvider(p: Omit<SttProvider, 'kind' | 'transcribe'>): SttProvider {
  const provider = { ...p, kind: 'stt' as const } as SttProvider
  provider.transcribe = makeSttTranscribe(provider)
  return provider
}

export const STT_PROVIDERS: SttProvider[] = [
  sttProvider({
    id: 'stt-stream-fast',
    name: 'FastStream STT',
    profileOf: 'Managed low-latency streaming STT (Deepgram-class profile)',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: true,
    languages: ['en-US', 'en-IN', 'hi-IN', 'es-ES', '*'],
    baseWer: 0.06,
    narrowbandWerPenalty: 0.04,
    firstPartialMs: 200,
    partialIntervalMs: 250,
    finalizeMs: 150,
    maxConcurrentStreamsPerInstance: 400,
    cost: { unit: 'per-minute', usdPerUnit: 0.0059, note: 'Example assumption; edit freely.' },
    notes: [
      'Optimised for time-to-first-partial: the agent can start thinking before the user finishes.',
      'WebSocket streaming API; you hold one connection per live call.',
    ],
    tunables: ['firstPartialMs', 'finalizeMs', 'baseWer'],
  }),
  sttProvider({
    id: 'stt-stream-bigcloud',
    name: 'CloudScale STT',
    profileOf: 'Hyperscaler streaming STT (Google/Azure-class profile)',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: true,
    languages: ['*'],
    baseWer: 0.055,
    narrowbandWerPenalty: 0.045,
    firstPartialMs: 320,
    partialIntervalMs: 300,
    finalizeMs: 280,
    maxConcurrentStreamsPerInstance: 1000,
    cost: { unit: 'per-minute', usdPerUnit: 0.016, note: 'Example assumption; edit freely.' },
    notes: [
      'Widest language coverage; per-region endpoints; enterprise auth and quotas.',
      'Quota increases are a support-ticket away — plan capacity ahead of launch.',
    ],
    tunables: ['firstPartialMs', 'finalizeMs', 'baseWer'],
  }),
  sttProvider({
    id: 'stt-whisper-batch',
    name: 'OpenWhisper (self-hosted, batch)',
    profileOf: 'Self-hosted Whisper-class batch model',
    deployment: 'self-hosted',
    compute: 'gpu-dedicated',
    streaming: false,
    languages: ['*'],
    baseWer: 0.045,
    narrowbandWerPenalty: 0.05,
    firstPartialMs: Infinity,
    partialIntervalMs: Infinity,
    finalizeMs: 250,
    realtimeFactor: 0.18,
    maxConcurrentStreamsPerInstance: 8,
    cost: { unit: 'per-instance-hour', usdPerUnit: 1.2, note: 'GPU node cost assumption; edit freely.' },
    notes: [
      'Excellent accuracy, no per-minute fees, data stays in your VPC.',
      'No partials: the agent cannot start reasoning until the user has completely finished. That silence is your latency budget draining.',
      'You own the GPU fleet: capacity planning, CUDA drivers, model updates.',
    ],
    tunables: ['realtimeFactor', 'baseWer'],
  }),
  sttProvider({
    id: 'stt-whisper-stream',
    name: 'OpenWhisper Streaming (self-hosted)',
    profileOf: 'Self-hosted Whisper-class model behind a streaming shim',
    deployment: 'self-hosted',
    compute: 'gpu-dedicated',
    streaming: true,
    languages: ['*'],
    baseWer: 0.055,
    narrowbandWerPenalty: 0.05,
    firstPartialMs: 450,
    partialIntervalMs: 500,
    finalizeMs: 400,
    maxConcurrentStreamsPerInstance: 24,
    cost: { unit: 'per-instance-hour', usdPerUnit: 1.2, note: 'GPU node cost assumption; edit freely.' },
    notes: [
      'Streaming bolted onto a batch model by re-running inference on a sliding window — partials are slower and less stable than a natively streaming engine.',
      'Common middle ground when data residency rules out managed STT.',
    ],
    tunables: ['firstPartialMs', 'finalizeMs'],
  }),
  sttProvider({
    id: 'stt-indic',
    name: 'IndicVoice STT',
    profileOf: 'India-focused multilingual streaming STT',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: true,
    languages: ['hi-IN', 'en-IN', 'ta-IN', 'te-IN', 'bn-IN', 'mr-IN'],
    baseWer: 0.07,
    narrowbandWerPenalty: 0.035,
    firstPartialMs: 260,
    partialIntervalMs: 280,
    finalizeMs: 200,
    maxConcurrentStreamsPerInstance: 300,
    cost: { unit: 'per-minute', usdPerUnit: 0.008, note: 'Example assumption; edit freely.' },
    notes: [
      'Trained on code-switched Hindi/English — the way people actually speak to Indian call centres.',
      'Regional endpoint keeps the media round trip inside India.',
    ],
    tunables: ['firstPartialMs', 'baseWer'],
  }),
]

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

function makeTtsSynthesize(self: TtsProvider) {
  return (req: TtsRequest, rng: Rng): TtsResult => {
    const notes: string[] = []
    const wordCount = req.text.split(/\s+/).filter(Boolean).length
    const wpm = req.rateWpm ?? 150
    const audioSeconds = Math.max(0.4, (wordCount / wpm) * 60)
    const generationMs = (audioSeconds / self.realtimeFactor) * 1000
    const firstAudioMs = Math.max(30, rng.logNormal(self.firstAudioMs, 0.25))

    const chunks: TtsChunk[] = []
    const bps = bytesPerSecond(req.format)
    if (req.streaming && self.streaming) {
      const chunkSeconds = self.chunkMs / 1000
      const n = Math.max(1, Math.ceil(audioSeconds / chunkSeconds))
      // Chunks are produced at generation speed, not playback speed: a 4x
      // realtime engine emits audio 4x faster than the caller plays it.
      const msPerChunk = (chunkSeconds / self.realtimeFactor) * 1000
      for (let i = 0; i < n; i++) {
        const secs = Math.min(chunkSeconds, audioSeconds - i * chunkSeconds)
        chunks.push({
          index: i,
          atMs: Math.round(firstAudioMs + i * msPerChunk),
          audioSeconds: Math.round(secs * 100) / 100,
          bytes: Math.round(secs * bps),
        })
      }
    } else {
      // Non-streaming: nothing is playable until the whole utterance exists.
      const totalMs = Math.max(firstAudioMs, generationMs)
      chunks.push({
        index: 0,
        atMs: Math.round(totalMs),
        audioSeconds: Math.round(audioSeconds * 100) / 100,
        bytes: Math.round(audioSeconds * bps),
      })
      notes.push(
        `Non-streaming synthesis: the caller hears nothing for ${Math.round(totalMs)} ms while the full ` +
          `${audioSeconds.toFixed(1)} s utterance is generated, then playback starts all at once.`,
      )
    }

    const totalGenerationMs = Math.round(chunks[chunks.length - 1].atMs)
    return {
      chunks,
      firstAudioMs: Math.round(req.streaming && self.streaming ? firstAudioMs : totalGenerationMs),
      totalGenerationMs,
      audioSeconds: Math.round(audioSeconds * 100) / 100,
      charactersBilled: req.text.length,
      totalBytes: chunks.reduce((s, c) => s + c.bytes, 0),
      degraded: false,
      notes,
    }
  }
}

function ttsProvider(p: Omit<TtsProvider, 'kind' | 'synthesize'>): TtsProvider {
  const provider = { ...p, kind: 'tts' as const } as TtsProvider
  provider.synthesize = makeTtsSynthesize(provider)
  return provider
}

export const TTS_PROVIDERS: TtsProvider[] = [
  ttsProvider({
    id: 'tts-premium-stream',
    name: 'VelvetVoice TTS',
    profileOf: 'Premium neural streaming TTS (ElevenLabs-class profile)',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: true,
    languages: ['*'],
    firstAudioMs: 180,
    realtimeFactor: 5,
    chunkMs: 220,
    quality: 'premium',
    voice: { style: 'warm, human-like', pitch: 'natural contour', expressiveness: 0.9 },
    maxConcurrentStreamsPerInstance: 200,
    cost: { unit: 'per-1k-chars', usdPerUnit: 0.18, note: 'Example assumption; edit freely.' },
    notes: [
      'Time-to-first-audio under 200 ms makes streaming pipelines feel instant.',
      'Premium pricing: at scale, TTS characters become a visible line item.',
    ],
    tunables: ['firstAudioMs', 'realtimeFactor', 'chunkMs'],
  }),
  ttsProvider({
    id: 'tts-cloud-standard',
    name: 'CloudNeural TTS',
    profileOf: 'Hyperscaler neural TTS (Azure/Google-class profile)',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: true,
    languages: ['*'],
    firstAudioMs: 300,
    realtimeFactor: 4,
    chunkMs: 250,
    quality: 'natural',
    voice: { style: 'clear, broadcast-neutral', pitch: 'steady', expressiveness: 0.6 },
    maxConcurrentStreamsPerInstance: 500,
    cost: { unit: 'per-1k-chars', usdPerUnit: 0.016, note: 'Example assumption; edit freely.' },
    notes: ['An order of magnitude cheaper than premium voices; the default for high-volume support lines.'],
    tunables: ['firstAudioMs', 'realtimeFactor'],
  }),
  ttsProvider({
    id: 'tts-selfhosted',
    name: 'PiperLocal TTS (self-hosted)',
    profileOf: 'Self-hosted open-source TTS (Piper/Coqui-class profile)',
    deployment: 'self-hosted',
    compute: 'cpu',
    streaming: true,
    languages: ['en-US', 'en-IN', 'hi-IN', 'de-DE', 'es-ES'],
    firstAudioMs: 90,
    realtimeFactor: 8,
    chunkMs: 200,
    quality: 'basic',
    voice: { style: 'slightly robotic but crisp', pitch: 'flat-ish', expressiveness: 0.3 },
    maxConcurrentStreamsPerInstance: 40,
    cost: { unit: 'per-instance-hour', usdPerUnit: 0.25, note: 'CPU node cost assumption; edit freely.' },
    notes: [
      'Runs on CPU, costs almost nothing per call, never rate-limits you.',
      'Noticeably synthetic voice — fine for utility calls, wrong for a premium brand.',
    ],
    tunables: ['firstAudioMs', 'realtimeFactor'],
  }),
  ttsProvider({
    id: 'tts-batch-mp3',
    name: 'BatchVoice TTS',
    profileOf: 'File-oriented TTS API returning complete MP3s',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: false,
    languages: ['*'],
    firstAudioMs: 900,
    realtimeFactor: 3,
    chunkMs: 0,
    quality: 'natural',
    voice: { style: 'pleasant', pitch: 'natural', expressiveness: 0.5 },
    maxConcurrentStreamsPerInstance: 300,
    cost: { unit: 'per-1k-chars', usdPerUnit: 0.03, note: 'Example assumption; edit freely.' },
    notes: [
      'Returns a finished MP3 per request. Great for voicemail drops and IVR prompts; painful for live conversation.',
      'Use it in the Latency Lab to see what non-streaming TTS does to perceived latency.',
    ],
    tunables: ['firstAudioMs', 'realtimeFactor'],
  }),
]

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

function makeLlmComplete(self: LlmProvider) {
  return (req: LlmRequest, rng: Rng): LlmResult => {
    const notes: string[] = []
    // Prefill scales (weakly) with input size: a bloated context costs latency
    // before the first token, not just money.
    const prefillMs = self.timeToFirstTokenMs + (req.inputTokens / 1000) * 40
    const firstTokenMs = Math.max(60, rng.logNormal(prefillMs, 0.3))
    const outputTokens = Math.max(4, Math.round(rng.normal(req.expectedOutputTokens, req.expectedOutputTokens * 0.15)))
    const genMs = (outputTokens / self.tokensPerSecond) * 1000
    const completionMs = firstTokenMs + genMs

    let toolCallAtMs: number | undefined
    if (req.toolCallExpected) {
      if (!self.functionCalling) {
        notes.push('Model lacks native function calling — tool use must be parsed out of raw text, which is slower and error-prone.')
        toolCallAtMs = completionMs
      } else {
        // A tool call is usually short: emitted soon after the first tokens.
        toolCallAtMs = firstTokenMs + Math.min(genMs, (24 / self.tokensPerSecond) * 1000)
      }
    }
    if (req.inputTokens > self.contextWindow) {
      notes.push(`Input (${req.inputTokens} tokens) exceeds the ${self.contextWindow}-token context window — history must be truncated or summarised.`)
    }
    return {
      firstTokenMs: Math.round(firstTokenMs),
      completionMs: Math.round(completionMs),
      outputTokens,
      inputTokens: req.inputTokens,
      toolCallAtMs: toolCallAtMs === undefined ? undefined : Math.round(toolCallAtMs),
      degraded: false,
      notes,
    }
  }
}

function llmProvider(p: Omit<LlmProvider, 'kind' | 'complete'>): LlmProvider {
  const provider = { ...p, kind: 'llm' as const } as LlmProvider
  provider.complete = makeLlmComplete(provider)
  return provider
}

export const LLM_PROVIDERS: LlmProvider[] = [
  llmProvider({
    id: 'llm-fast-small',
    name: 'Swift-Mini LLM',
    profileOf: 'Small fast managed model tuned for voice (GPT-4o-mini/Haiku-class profile)',
    deployment: 'managed',
    compute: 'gpu-shared',
    streaming: true,
    timeToFirstTokenMs: 220,
    tokensPerSecond: 120,
    contextWindow: 128_000,
    capability: 0.78,
    functionCalling: true,
    cost: { unit: 'per-1k-input-tokens', usdPerUnit: 0.00015, note: 'Example assumption; edit freely.' },
    outputCost: { unit: 'per-1k-output-tokens', usdPerUnit: 0.0006, note: 'Example assumption; edit freely.' },
    notes: [
      'The default choice for voice: first token in ~200 ms and fast generation keep the conversation moving.',
      'Less headroom for complex multi-step reasoning; pair with tight prompts and tools.',
    ],
    tunables: ['timeToFirstTokenMs', 'tokensPerSecond'],
  }),
  llmProvider({
    id: 'llm-flagship',
    name: 'Atlas-Large LLM',
    profileOf: 'Frontier managed model (GPT-4/Claude Opus-class profile)',
    deployment: 'managed',
    compute: 'gpu-dedicated',
    streaming: true,
    timeToFirstTokenMs: 650,
    tokensPerSecond: 55,
    contextWindow: 200_000,
    capability: 0.97,
    functionCalling: true,
    cost: { unit: 'per-1k-input-tokens', usdPerUnit: 0.003, note: 'Example assumption; edit freely.' },
    outputCost: { unit: 'per-1k-output-tokens', usdPerUnit: 0.015, note: 'Example assumption; edit freely.' },
    notes: [
      'Best reasoning and tool discipline; the extra 400+ ms to first token is audible in conversation.',
      'A common pattern: fast model for chitchat and routing, flagship for the hard turns.',
    ],
    tunables: ['timeToFirstTokenMs', 'tokensPerSecond'],
  }),
  llmProvider({
    id: 'llm-selfhosted',
    name: 'Llama-Home (self-hosted)',
    profileOf: 'Self-hosted open-weights model on your own GPUs',
    deployment: 'self-hosted',
    compute: 'gpu-dedicated',
    streaming: true,
    timeToFirstTokenMs: 180,
    tokensPerSecond: 70,
    contextWindow: 32_000,
    capability: 0.7,
    functionCalling: true,
    cost: { unit: 'per-instance-hour', usdPerUnit: 2.5, note: 'GPU node cost assumption; edit freely.' },
    outputCost: { unit: 'per-instance-hour', usdPerUnit: 0, note: 'Output tokens are the same GPU-hour; no separate meter.' },
    notes: [
      'Latency you control, data that never leaves, no rate limits — and a GPU fleet you now operate.',
      'Throughput per GPU caps concurrency: batch scheduling vs latency is your new tradeoff.',
    ],
    tunables: ['timeToFirstTokenMs', 'tokensPerSecond'],
  }),
]

// ---------------------------------------------------------------------------
// Speech-to-speech
// ---------------------------------------------------------------------------

export const S2S_PROVIDERS: S2sProvider[] = [
  {
    kind: 's2s',
    id: 's2s-realtime',
    name: 'DuplexVoice S2S',
    profileOf: 'Native speech-to-speech realtime model (GPT-4o Realtime-class profile)',
    deployment: 'managed',
    compute: 'gpu-dedicated',
    firstAudioMs: 450,
    turnDetectionQuality: 0.85,
    functionCalling: true,
    transcriptVisible: true,
    languages: ['*'],
    cost: { unit: 'per-minute', usdPerUnit: 0.18, note: 'Example assumption; edit freely.' },
    notes: [
      'One model consumes and produces audio directly: no separate STT/TTS hop, natural prosody, native barge-in.',
      'You trade away control: no picking your own STT, no editing the transcript mid-pipeline, provider lock-in on the whole voice.',
      'Cost is per-minute of session, not per-token — the meter runs while the user is silent.',
    ],
    tunables: ['firstAudioMs'],
  },
]

// ---------------------------------------------------------------------------
// Telephony
// ---------------------------------------------------------------------------

function makePlaceCall(self: TelephonyProvider) {
  return (req: CallRequest, rng: Rng): CallResult => {
    const setupMs = Math.max(400, rng.logNormal(self.setupMs, 0.25))
    const connected = !rng.chance(self.failureRate)
    const t = (f: number) => Math.round(setupMs * f)
    const signalling =
      req.direction === 'outbound'
        ? [
            { atMs: 0, message: 'INVITE', direction: 'out' as const, note: 'We ask the carrier to set up a call: who we are, who we want, and an SDP body describing the media we can handle.' },
            { atMs: t(0.1), message: '100 Trying', direction: 'in' as const, note: 'Carrier acknowledges receipt; the far end has not rung yet.' },
            { atMs: t(0.35), message: '180 Ringing', direction: 'in' as const, note: 'Far end is ringing. Early media may already flow (ringback tone).' },
            ...(connected
              ? [
                  { atMs: t(0.9), message: '200 OK', direction: 'in' as const, note: 'Callee answered. Response carries their SDP: the negotiated codec and RTP endpoint.' },
                  { atMs: t(0.95), message: 'ACK', direction: 'out' as const, note: 'We confirm. The three-way handshake is complete; RTP media can flow.' },
                  { atMs: t(1.0), message: 'RTP media begins', direction: 'in' as const, note: 'Signalling (SIP) set the call up; media (RTP) is a separate UDP stream. Two planes, two paths.' },
                ]
              : [
                  { atMs: t(0.9), message: '486 Busy Here / 480 Unavailable', direction: 'in' as const, note: 'Call not answered. The dialer must decide: retry later, voicemail drop, or mark unreachable.' },
                ]),
          ]
        : [
            { atMs: 0, message: 'INVITE (from carrier)', direction: 'in' as const, note: 'A caller dialled your number; the carrier offers you the call with their SDP.' },
            { atMs: t(0.2), message: '200 OK', direction: 'out' as const, note: 'We accept and return our SDP: the codec and where to send RTP.' },
            { atMs: t(0.3), message: 'ACK', direction: 'in' as const, note: 'Carrier confirms; the dialog is established.' },
            { atMs: t(0.4), message: 'RTP media begins', direction: 'in' as const, note: 'Caller audio starts arriving as 20 ms RTP packets.' },
          ]
    return {
      setupMs: Math.round(setupMs),
      connected,
      failureReason: connected ? undefined : rng.pick(['busy', 'no-answer', 'carrier-reject', 'invalid-number']),
      mediaFormat: self.mediaFormat,
      signalling,
    }
  }
}

function telephonyProvider(p: Omit<TelephonyProvider, 'kind' | 'placeCall'>): TelephonyProvider {
  const provider = { ...p, kind: 'telephony' as const } as TelephonyProvider
  provider.placeCall = makePlaceCall(provider)
  return provider
}

export const TELEPHONY_PROVIDERS: TelephonyProvider[] = [
  telephonyProvider({
    id: 'tel-cpaas',
    name: 'TwiFlow CPaaS',
    profileOf: 'Hosted telephony API with media streaming (Twilio-class profile)',
    deployment: 'managed',
    compute: 'cpu',
    style: 'cpaas',
    mediaFormat: FORMATS.telephonyMulaw,
    setupMs: 2500,
    failureRate: 0.03,
    channelCapacity: 5000,
    supportsTransfer: true,
    supportsDtmf: true,
    supportsRecording: true,
    latency: { fixedMs: 25, jitterMs: 10 },
    cost: { unit: 'per-minute', usdPerUnit: 0.014, note: 'Example assumption; edit freely.' },
    notes: [
      'Numbers, carriers, SIP and regulation handled for you; you get webhooks and a WebSocket of mu-law audio.',
      'Media hairpins through the provider\'s region — check where their edge is relative to your servers.',
    ],
    tunables: ['setupMs', 'failureRate'],
  }),
  telephonyProvider({
    id: 'tel-sip-trunk',
    name: 'Direct SIP Trunk',
    profileOf: 'Your own SIP trunk into a carrier, self-operated media',
    deployment: 'self-hosted',
    compute: 'cpu',
    style: 'sip-trunk',
    mediaFormat: FORMATS.telephonyAlaw,
    setupMs: 2200,
    failureRate: 0.02,
    channelCapacity: 1000,
    supportsTransfer: true,
    supportsDtmf: true,
    supportsRecording: true,
    latency: { fixedMs: 12, jitterMs: 6 },
    cost: { unit: 'per-minute', usdPerUnit: 0.006, note: 'Example assumption; edit freely.' },
    notes: [
      'Half the per-minute cost and one less network hop — you now run SBCs, handle DTMF, and debug carrier quirks yourself.',
      'Channel capacity is a contract term: bursting past it drops calls.',
    ],
    tunables: ['setupMs', 'failureRate'],
  }),
  telephonyProvider({
    id: 'tel-webrtc',
    name: 'WebRTC Gateway',
    profileOf: 'Browser calls via WebRTC to your media server',
    deployment: 'self-hosted',
    compute: 'cpu',
    style: 'webrtc-gateway',
    mediaFormat: FORMATS.opusWebrtc,
    setupMs: 900,
    failureRate: 0.015,
    channelCapacity: 2000,
    supportsTransfer: false,
    supportsDtmf: false,
    supportsRecording: true,
    latency: { fixedMs: 18, jitterMs: 12 },
    cost: { unit: 'per-minute', usdPerUnit: 0.0, usdPerMonthFixed: 400, note: 'TURN/media server infra assumption; edit freely.' },
    notes: [
      'No per-minute carrier fees and 48 kHz Opus audio — far better STT input than any phone line.',
      'You need STUN/TURN for NAT traversal; ~10-20% of enterprise networks will relay through TURN.',
    ],
    tunables: ['setupMs', 'failureRate'],
  }),
]

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getStt(id: string): SttProvider {
  return STT_PROVIDERS.find((p) => p.id === id) ?? STT_PROVIDERS[0]
}
export function getTts(id: string): TtsProvider {
  return TTS_PROVIDERS.find((p) => p.id === id) ?? TTS_PROVIDERS[0]
}
export function getLlm(id: string): LlmProvider {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? LLM_PROVIDERS[0]
}
export function getTelephony(id: string): TelephonyProvider {
  return TELEPHONY_PROVIDERS.find((p) => p.id === id) ?? TELEPHONY_PROVIDERS[0]
}
