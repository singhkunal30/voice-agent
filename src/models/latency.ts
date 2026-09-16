/**
 * Analytic latency model for the Latency Lab.
 *
 * Unlike the call simulation (which samples jitter from a seed), this model is
 * a pure closed-form pipeline: change any variable and the entire waterfall
 * recomputes. It exists so the learner can move one slider and see exactly
 * which downstream numbers move and why.
 *
 * The critical insight it encodes: perceived latency is NOT the sum of all
 * stage durations. Streaming stages overlap — STT partials arrive during
 * speech, the LLM can start on a final transcript while TTS speaks sentence
 * one of the reply. The model computes both the naive serial sum and the
 * true overlapped critical path, because the difference IS the lesson.
 */

import type { LatencyBreakdown, LatencySegment } from '../domain/types'
import { round } from '../engine/simulation'

export interface LatencyParams {
  /** One-way network legs, ms. */
  userToEdgeMs: number
  edgeToServerMs: number
  serverToProviderMs: number
  /** Audio frame size — you buffer half a frame on average before acting. */
  frameMs: number
  /** Jitter buffer depth at the playout side. */
  jitterBufferMs: number
  /** VAD processing overhead per decision. */
  vadMs: number
  /** Silence needed to declare end of turn. */
  endpointingMs: number
  /** STT: streaming or batch. */
  sttStreaming: boolean
  /** Streaming: ms from end-of-speech to final transcript. */
  sttFinalizeMs: number
  /** Batch: multiple of real time to process the utterance. */
  sttBatchRtf: number
  /** Length of the user utterance in seconds (matters for batch STT). */
  utteranceSeconds: number
  /** LLM time to first token. */
  llmFirstTokenMs: number
  /** LLM generation rate. */
  llmTokensPerSecond: number
  /** Total response tokens. */
  responseTokens: number
  /** Tokens needed before the first sentence can go to TTS. */
  firstSentenceTokens: number
  llmStreaming: boolean
  /** Tool call on the critical path (0 = no tool). */
  toolMs: number
  /** TTS time to first audio chunk. */
  ttsFirstAudioMs: number
  /** TTS generation speed vs real time (for the batch case). */
  ttsRtf: number
  /** Spoken reply length in seconds (matters for batch TTS). */
  responseAudioSeconds: number
  ttsStreaming: boolean
  /** Audio encode/transcode overhead on the return path. */
  encodeMs: number
  budgetMs: number
}

export const DEFAULT_LATENCY_PARAMS: LatencyParams = {
  userToEdgeMs: 35,
  edgeToServerMs: 10,
  serverToProviderMs: 15,
  frameMs: 20,
  jitterBufferMs: 40,
  vadMs: 10,
  endpointingMs: 600,
  sttStreaming: true,
  sttFinalizeMs: 150,
  sttBatchRtf: 0.18,
  utteranceSeconds: 4,
  llmFirstTokenMs: 220,
  llmTokensPerSecond: 120,
  responseTokens: 60,
  firstSentenceTokens: 15,
  llmStreaming: true,
  toolMs: 0,
  ttsFirstAudioMs: 180,
  ttsRtf: 5,
  responseAudioSeconds: 6,
  ttsStreaming: true,
  encodeMs: 5,
  budgetMs: 800,
}

export function computeLatency(p: LatencyParams): LatencyBreakdown {
  const segments: LatencySegment[] = []
  const notes: string[] = []
  let t = 0 // ms after end of user speech

  const seg = (
    key: string,
    label: string,
    ms: number,
    stage: LatencySegment['stage'],
    explanation: string,
  ) => {
    if (ms <= 0) return
    segments.push({ key, label, ms: round(ms), stage, criticalPath: true, explanation, startMs: round(t) })
    t += ms
  }

  // 1. The tail of the user's audio must reach the server.
  seg('net-in', 'Inbound network', p.userToEdgeMs + p.edgeToServerMs, 'network',
    'The final syllable travels user → edge → server. Pure distance; only region placement changes it.')
  seg('framing', 'Frame buffering', p.frameMs / 2, 'audio',
    `Audio moves in ${p.frameMs} ms frames; on average the last half-frame is still in flight when speech ends.`)
  seg('vad-detect', 'VAD silence detection', p.vadMs, 'detect',
    'The VAD needs a few frames of silence before its score drops below threshold.')

  // 2. Endpointing vs STT finalization: they run in PARALLEL; the later gates.
  const endpointDone = t + p.endpointingMs
  let sttDone: number
  if (p.sttStreaming) {
    sttDone = t + p.serverToProviderMs + p.sttFinalizeMs + p.serverToProviderMs
  } else {
    const batchMs = p.utteranceSeconds * 1000 * p.sttBatchRtf
    sttDone = t + p.serverToProviderMs + batchMs + p.serverToProviderMs
    notes.push(
      `Batch STT: processing the ${p.utteranceSeconds}s utterance takes ~${Math.round(
        p.utteranceSeconds * 1000 * p.sttBatchRtf,
      )} ms AFTER the user finishes — streaming STT hides this inside the speech itself.`,
    )
  }
  const turnGate = Math.max(endpointDone, sttDone)
  if (endpointDone >= sttDone) {
    seg('endpoint', 'Endpointing (silence timeout)', p.endpointingMs, 'detect',
      `The system waits ${p.endpointingMs} ms of silence to decide the user is done. STT finalization (${Math.round(
        sttDone - t,
      )} ms) fit inside this window — endpointing gates the turn.`)
  } else {
    seg('endpoint', 'Endpointing (silence timeout)', p.endpointingMs, 'detect',
      `${p.endpointingMs} ms of silence confirms the turn is over…`)
    seg('stt-final', p.sttStreaming ? 'STT finalization (overrun)' : 'Batch STT processing', sttDone - endpointDone, 'stt',
      p.sttStreaming
        ? '…but the final transcript took longer than the endpoint wait, so recognition gates the turn.'
        : '…but batch recognition only STARTS at end of speech, so the whole utterance must now be processed.')
  }
  t = turnGate

  // 3. Tool call (serial, worst case: decided before the response is phrased).
  if (p.toolMs > 0) {
    seg('tool', 'Tool call (on critical path)', p.toolMs + 30, 'tool',
      'The LLM decided it needs data before answering: backend latency lands inside the silent gap. Anything slower than ~500 ms needs spoken filler.')
  }

  // 4. LLM.
  const ttft = p.serverToProviderMs + p.llmFirstTokenMs
  seg('llm-ttft', 'LLM time-to-first-token', ttft, 'llm',
    'Prompt upload + prefill + provider queueing. Grows with context size — every stale history token is paid for here, every turn.')
  const genMsFull = (p.responseTokens / p.llmTokensPerSecond) * 1000
  const genMsSentence = (p.firstSentenceTokens / p.llmTokensPerSecond) * 1000
  if (p.llmStreaming) {
    seg('llm-sentence', `First sentence (${p.firstSentenceTokens} tokens)`, genMsSentence, 'llm',
      'Streaming: TTS can start as soon as one speakable sentence exists — the rest generates while the agent is already talking.')
  } else {
    seg('llm-full', `Full response (${p.responseTokens} tokens)`, genMsFull, 'llm',
      'Non-streaming: the entire reply must finish before anything can be spoken. The whole generation is on the critical path.')
    notes.push(
      `Streaming the LLM would cut ~${Math.round(genMsFull - genMsSentence)} ms here: only the first sentence needs to exist before speech starts.`,
    )
  }

  // 5. TTS.
  if (p.ttsStreaming) {
    seg('tts-first', 'TTS time-to-first-audio', p.serverToProviderMs + p.ttsFirstAudioMs, 'tts',
      'The synthesis engine emits its first chunk while the rest of the utterance is still being generated.')
  } else {
    const full = p.serverToProviderMs + (p.responseAudioSeconds / p.ttsRtf) * 1000
    seg('tts-full', `TTS full generation (${p.responseAudioSeconds}s of audio)`, full, 'tts',
      'Non-streaming: the entire audio file must be rendered before the first sample plays.')
    notes.push(
      `Streaming TTS would replace ${Math.round((p.responseAudioSeconds / p.ttsRtf) * 1000)} ms of full generation with ~${p.ttsFirstAudioMs} ms to first chunk.`,
    )
  }

  // 6. Return path.
  seg('encode', 'Encode / transcode', p.encodeMs, 'audio',
    'Converting the TTS output to the caller\'s wire format (e.g. 24 kHz PCM → 8 kHz mu-law).')
  seg('net-out', 'Outbound network', p.edgeToServerMs + p.userToEdgeMs, 'network',
    'First audio chunk travels back server → edge → user.')
  seg('playout', 'Jitter buffer / playout', p.jitterBufferMs, 'playback',
    'The playout buffer smooths network arrival variance. Deeper = more robust and more latent.')

  const perceived = t

  const ttfTranscript = p.sttStreaming ? -(p.utteranceSeconds * 1000) + 300 : -1

  return {
    segments,
    timeToFirstTranscriptMs: p.sttStreaming ? 300 : -1,
    timeToFinalTranscriptMs: round(sttDone),
    timeToFirstLlmTokenMs: round(turnGate + (p.toolMs > 0 ? p.toolMs + 30 : 0) + ttft),
    timeToFirstTtsAudioMs: round(perceived - p.jitterBufferMs - p.userToEdgeMs - p.edgeToServerMs - p.encodeMs),
    perceivedLatencyMs: round(perceived),
    totalResponseMs: round(perceived),
    budgetMs: p.budgetMs,
    withinBudget: perceived <= p.budgetMs,
    notes: [
      ...(ttfTranscript !== -1 ? [] : []),
      ...notes,
      'Endpointing and STT finalization run in parallel; the later of the two gates the turn.',
      'Educational estimate — every input is an editable assumption.',
    ],
  }
}

/**
 * Compare streaming vs batch pipelines under identical settings — the numeric
 * backbone of the "why streaming" lesson and of Architecture Comparison.
 */
export function streamingComparison(base: LatencyParams): {
  batch: LatencyBreakdown
  streaming: LatencyBreakdown
  savedMs: number
} {
  const batch = computeLatency({ ...base, sttStreaming: false, llmStreaming: false, ttsStreaming: false })
  const streaming = computeLatency({ ...base, sttStreaming: true, llmStreaming: true, ttsStreaming: true })
  return {
    batch,
    streaming,
    savedMs: round(batch.perceivedLatencyMs - streaming.perceivedLatencyMs),
  }
}
