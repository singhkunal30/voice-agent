/**
 * Provider abstractions.
 *
 * Everything in the simulator runs against these interfaces, never against a
 * concrete vendor. That is a design choice with two payoffs:
 *
 *  1. The simulator needs no API keys and no network. Every provider here is a
 *     deterministic model driven by the run's seed.
 *  2. Swapping in a real provider later is a matter of implementing the same
 *     interface — `transcribe`, `synthesize`, `complete`, `placeCall` — and
 *     registering it. Nothing above the provider layer knows the difference.
 *
 * The characteristics attached to each simulated provider (latency, accuracy,
 * price) are EXAMPLE ASSUMPTIONS chosen to be order-of-magnitude plausible and
 * to make the tradeoffs between provider *classes* legible. They are editable
 * in the UI and are not measurements of any vendor's service.
 */

import type { AudioFormat, CostModel, LatencyModel } from '../domain/types'
import type { Rng } from '../engine/rng'

export type Deployment = 'managed' | 'self-hosted'
export type ComputeClass = 'cpu' | 'gpu-shared' | 'gpu-dedicated'

export interface ProviderMeta {
  id: string
  name: string
  /** Which real-world family this models, stated as a simulation profile. */
  profileOf: string
  deployment: Deployment
  compute: ComputeClass
  cost: CostModel
  /** Free-form notes surfaced in the inspector. */
  notes: string[]
  /** Editable knobs exposed in the labs. */
  tunables: string[]
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export interface SttRequest {
  /** Transcript the user actually said (ground truth for the simulation). */
  utterance: string
  /** Seconds of speech. */
  audioSeconds: number
  format: AudioFormat
  /** 0 = studio clean, 1 = unusable. Drives simulated error injection. */
  noiseLevel: number
  /** Language tag, e.g. 'en-IN'. */
  language: string
  /** Simulated speaker accent strength, 0..1. */
  accentStrength?: number
  /** True when the audio came off an 8 kHz phone line. */
  narrowband?: boolean
}

export interface SttPartial {
  /** Virtual ms after speech start when this partial is emitted. */
  atMs: number
  text: string
  isFinal: boolean
  /** Simulated confidence, 0..1. */
  confidence: number
  /** True when this partial revised earlier words (streaming instability). */
  revised: boolean
}

export interface SttResult {
  partials: SttPartial[]
  finalText: string
  /** Simulated word error rate for this utterance, 0..1. */
  wer: number
  /** Ms from end-of-speech to the final transcript being available. */
  finalizeMs: number
  /** Ms from start-of-speech to the first partial. Infinity for batch STT. */
  firstPartialMs: number
  /** Ms of compute charged, used by the cost model. */
  audioSecondsBilled: number
  degraded: boolean
  notes: string[]
}

export interface SttProvider extends ProviderMeta {
  kind: 'stt'
  streaming: boolean
  languages: string[]
  /** Base word error rate on clean, wideband audio. Assumption. */
  baseWer: number
  /** Extra WER when the audio is 8 kHz narrowband. Assumption. */
  narrowbandWerPenalty: number
  /** Ms to first partial hypothesis once speech starts. */
  firstPartialMs: number
  /** Ms between subsequent partials. */
  partialIntervalMs: number
  /**
   * Ms from end-of-speech to a final transcript. For batch engines this also
   * includes processing the whole utterance (see `realtimeFactor`).
   */
  finalizeMs: number
  /**
   * Batch engines process at some multiple of real time. 0.15 means a 10 s
   * utterance takes 1.5 s to transcribe. Ignored for streaming engines.
   */
  realtimeFactor?: number
  maxConcurrentStreamsPerInstance: number
  transcribe(req: SttRequest, rng: Rng): SttResult
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

export interface TtsRequest {
  text: string
  language: string
  format: AudioFormat
  /** True when the caller consumes audio as it is produced. */
  streaming: boolean
  /** Words per minute of the synthesised voice. */
  rateWpm?: number
}

export interface TtsChunk {
  atMs: number
  bytes: number
  /** Seconds of audio in this chunk. */
  audioSeconds: number
  index: number
}

export interface TtsResult {
  chunks: TtsChunk[]
  /** Ms until the first byte of audio is available to play. */
  firstAudioMs: number
  /** Ms until the whole utterance has been generated. */
  totalGenerationMs: number
  /** Seconds of audio produced. */
  audioSeconds: number
  charactersBilled: number
  totalBytes: number
  degraded: boolean
  notes: string[]
}

export interface TtsProvider extends ProviderMeta {
  kind: 'tts'
  streaming: boolean
  languages: string[]
  /** Ms to first audio chunk. The number that decides perceived latency. */
  firstAudioMs: number
  /**
   * Generation speed as a multiple of real time. 4 means it synthesises 4 s of
   * audio per second of wall clock.
   */
  realtimeFactor: number
  /** Ms of audio per streamed chunk. */
  chunkMs: number
  /** Subjective quality band. */
  quality: 'basic' | 'natural' | 'premium'
  /** Voice characteristics surfaced in the lab. */
  voice: { style: string; pitch: string; expressiveness: number }
  maxConcurrentStreamsPerInstance: number
  synthesize(req: TtsRequest, rng: Rng): TtsResult
}

// ---------------------------------------------------------------------------
// Large language model
// ---------------------------------------------------------------------------

export interface LlmRequest {
  /** Tokens of system prompt + history + current turn. */
  inputTokens: number
  /** Tokens the model is expected to produce. */
  expectedOutputTokens: number
  streaming: boolean
  /** True when the turn is expected to emit a tool call. */
  toolCallExpected: boolean
  temperature?: number
}

export interface LlmResult {
  firstTokenMs: number
  /** Ms until generation completes. */
  completionMs: number
  outputTokens: number
  inputTokens: number
  /** Ms at which a tool call becomes visible, if any. */
  toolCallAtMs?: number
  degraded: boolean
  notes: string[]
}

export interface LlmProvider extends ProviderMeta {
  kind: 'llm'
  streaming: boolean
  /** Ms to first token (prefill + queue). Assumption. */
  timeToFirstTokenMs: number
  /** Tokens per second during generation. Assumption. */
  tokensPerSecond: number
  contextWindow: number
  /** Relative instruction-following / tool-calling reliability, 0..1. */
  capability: number
  /** True when the model supports native function calling. */
  functionCalling: boolean
  outputCost: CostModel
  complete(req: LlmRequest, rng: Rng): LlmResult
}

// ---------------------------------------------------------------------------
// Speech to speech (single model, audio in / audio out)
// ---------------------------------------------------------------------------

export interface S2sProvider extends ProviderMeta {
  kind: 's2s'
  /** Ms from end-of-user-speech to first audio out. */
  firstAudioMs: number
  /** Native turn detection quality, 0..1. */
  turnDetectionQuality: number
  functionCalling: boolean
  /** True when the provider exposes the intermediate transcript. */
  transcriptVisible: boolean
  languages: string[]
}

// ---------------------------------------------------------------------------
// Telephony
// ---------------------------------------------------------------------------

export interface CallRequest {
  to: string
  from: string
  direction: 'inbound' | 'outbound'
  region: string
}

export interface CallResult {
  /** Ms from dial to the far end answering. */
  setupMs: number
  connected: boolean
  failureReason?: string
  /** Format the carrier hands us. */
  mediaFormat: AudioFormat
  /** Signalling steps, for the Telephony Lab. */
  signalling: { atMs: number; message: string; direction: 'out' | 'in'; note: string }[]
}

export interface TelephonyProvider extends ProviderMeta {
  kind: 'telephony'
  /** 'sip' for a trunk you operate, 'cpaas' for a hosted API. */
  style: 'sip-trunk' | 'cpaas' | 'webrtc-gateway'
  mediaFormat: AudioFormat
  /** Mean ms for call setup (INVITE -> 200 OK -> ACK). Assumption. */
  setupMs: number
  /** Probability an outbound call fails to connect. Assumption. */
  failureRate: number
  /** Concurrent channels available. */
  channelCapacity: number
  supportsTransfer: boolean
  supportsDtmf: boolean
  supportsRecording: boolean
  latency: LatencyModel
  placeCall(req: CallRequest, rng: Rng): CallResult
}

export type AnyProvider = SttProvider | TtsProvider | LlmProvider | TelephonyProvider | S2sProvider
