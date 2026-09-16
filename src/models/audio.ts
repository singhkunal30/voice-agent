/**
 * Audio format model.
 *
 * Voice engineers spend a surprising amount of their time on format mismatches:
 * telephony hands you 8 kHz mu-law, your STT wants 16 kHz PCM, your TTS emits
 * 24 kHz, and the return path has to be 8 kHz mu-law again. Each conversion
 * costs CPU, adds buffering latency, and — when it involves a lossy codec —
 * throws away information that never comes back.
 *
 * This module computes the arithmetic behind all of that, and grades a pipeline
 * so the learner can *see* an unnecessary transcode rather than be told about it.
 *
 * All figures are SIMULATION ASSUMPTIONS derived from the format arithmetic;
 * conversion CPU costs in particular are illustrative orders of magnitude.
 */

import type { AudioEncoding, AudioFormat } from '../domain/types'

export interface EncodingInfo {
  id: AudioEncoding
  name: string
  lossy: boolean
  /** Compressed formats have a nominal bitrate; PCM is computed from the format. */
  compressed: boolean
  /** Bits per sample for uncompressed formats. */
  bitsPerSample?: number
  /** Relative CPU cost to encode/decode one second of audio. Assumption. */
  cpuCostPerAudioSecond: number
  /** Algorithmic delay the codec itself introduces, in ms. Assumption. */
  algorithmicDelayMs: number
  /** Formats it is commonly seen carrying. */
  typicalUse: string
  description: string
  /** Why you would choose it. */
  whyChoose: string
  /** What it costs you. */
  cost: string
}

export const ENCODINGS: Record<AudioEncoding, EncodingInfo> = {
  pcm16: {
    id: 'pcm16',
    name: 'PCM 16-bit (linear)',
    lossy: false,
    compressed: false,
    bitsPerSample: 16,
    cpuCostPerAudioSecond: 0.0001,
    algorithmicDelayMs: 0,
    typicalUse: 'The lingua franca inside a voice pipeline; what STT engines want.',
    description:
      'Raw signed 16-bit samples, little-endian. No compression, no framing, no header — just numbers. A 16 kHz mono stream is 32,000 bytes per second.',
    whyChoose:
      'Zero decode cost, zero quality loss, every library understands it. Inside your own process this is almost always the right representation.',
    cost: 'Large on the wire. 16 kHz mono PCM16 is 256 kbit/s — fine on a LAN, wasteful across the internet.',
  },
  pcm24: {
    id: 'pcm24',
    name: 'PCM 24-bit (linear)',
    lossy: false,
    compressed: false,
    bitsPerSample: 24,
    cpuCostPerAudioSecond: 0.0001,
    algorithmicDelayMs: 0,
    typicalUse: 'Studio capture. Rare in voice agents.',
    description: '24-bit linear samples. More dynamic range than any voice pipeline needs.',
    whyChoose: 'Headroom for heavy post-processing.',
    cost: '50% more bytes than PCM16 for no benefit a phone line can carry.',
  },
  pcmf32: {
    id: 'pcmf32',
    name: 'PCM 32-bit float',
    lossy: false,
    compressed: false,
    bitsPerSample: 32,
    cpuCostPerAudioSecond: 0.0001,
    algorithmicDelayMs: 0,
    typicalUse: 'Model input tensors; browser Web Audio API.',
    description:
      'Floating point samples normalised to [-1, 1]. What `AudioWorklet` hands you in the browser and what most ML models consume internally.',
    whyChoose: 'No clipping during DSP; matches ML framework tensors directly.',
    cost: 'Twice the bytes of PCM16. Convert before you put it on a socket.',
  },
  mulaw: {
    id: 'mulaw',
    name: 'G.711 mu-law',
    lossy: true,
    compressed: true,
    bitsPerSample: 8,
    cpuCostPerAudioSecond: 0.0005,
    algorithmicDelayMs: 0,
    typicalUse: 'North American / Japanese PSTN, Twilio Media Streams.',
    description:
      'Logarithmic 8-bit companding of a 14-bit signal. Fixed 64 kbit/s at 8 kHz. Lossy, but the loss is in quantisation noise, not bandwidth.',
    whyChoose:
      'It is what the phone network gives you. Table-driven conversion to PCM16 is essentially free.',
    cost:
      'Locked to 8 kHz, so everything above ~3.4 kHz is already gone before your system sees it. That ceiling is why phone STT accuracy trails browser STT.',
  },
  alaw: {
    id: 'alaw',
    name: 'G.711 A-law',
    lossy: true,
    compressed: true,
    bitsPerSample: 8,
    cpuCostPerAudioSecond: 0.0005,
    algorithmicDelayMs: 0,
    typicalUse: 'European / international PSTN.',
    description:
      'The other G.711 companding law. Same 64 kbit/s, slightly different curve — better on small signals, marginally worse SNR at the top.',
    whyChoose: 'Required by European carriers.',
    cost: 'Same 8 kHz ceiling as mu-law. Transcoding A-law <-> mu-law at a border gateway costs a little quality.',
  },
  opus: {
    id: 'opus',
    name: 'Opus',
    lossy: true,
    compressed: true,
    cpuCostPerAudioSecond: 0.004,
    algorithmicDelayMs: 26.5,
    typicalUse: 'WebRTC (mandatory to implement), modern real-time media.',
    description:
      'Modern low-latency codec. Handles 6–510 kbit/s, narrowband to fullband, with in-band FEC and packet-loss concealment. Default frame size 20 ms.',
    whyChoose:
      'Best quality per bit for real-time speech, and its loss concealment is what keeps WebRTC calls intelligible on bad networks.',
    cost:
      '~26.5 ms of algorithmic delay you cannot remove, and real CPU to encode. Transcoding Opus -> PCM -> mu-law loses twice.',
  },
  mp3: {
    id: 'mp3',
    name: 'MP3',
    lossy: true,
    compressed: true,
    cpuCostPerAudioSecond: 0.006,
    algorithmicDelayMs: 150,
    typicalUse: 'Stored audio, podcast files, some TTS APIs default to it.',
    description:
      'Frame-based perceptual codec designed for music files, not conversations. Encoder lookahead plus frame size gives it well over 100 ms of delay.',
    whyChoose: 'Small files, universal playback support. Fine for recordings.',
    cost:
      'Its delay alone can blow a real-time budget. If a TTS provider offers MP3 and PCM, take PCM for live calls and MP3 only for storage.',
  },
  aac: {
    id: 'aac',
    name: 'AAC',
    lossy: true,
    compressed: true,
    cpuCostPerAudioSecond: 0.006,
    algorithmicDelayMs: 120,
    typicalUse: 'Streaming media, recordings.',
    description: 'Successor to MP3; better quality per bit, similar latency profile.',
    whyChoose: 'Good archival codec with broad support.',
    cost: 'Same story as MP3 — too much algorithmic delay for the live path.',
  },
  wav: {
    id: 'wav',
    name: 'WAV (PCM container)',
    lossy: false,
    compressed: false,
    bitsPerSample: 16,
    cpuCostPerAudioSecond: 0.0001,
    algorithmicDelayMs: 0,
    typicalUse: 'Files, batch STT uploads.',
    description:
      'A 44-byte RIFF header wrapped around PCM. The header declares length, which is exactly why it is awkward for streaming — you do not know the length yet.',
    whyChoose: 'Self-describing; batch STT endpoints accept it directly.',
    cost:
      'Streaming WAV means either lying in the header or chunked framing. Prefer raw PCM plus an out-of-band format declaration for live audio.',
  },
  flac: {
    id: 'flac',
    name: 'FLAC',
    lossy: false,
    compressed: true,
    cpuCostPerAudioSecond: 0.003,
    algorithmicDelayMs: 40,
    typicalUse: 'Lossless archival of recordings.',
    description: 'Lossless compression, typically 50–60% of PCM size.',
    whyChoose: 'Halves recording storage cost with zero quality loss.',
    cost: 'Encode CPU and delay; not a real-time transport codec.',
  },
}

// ---------------------------------------------------------------------------
// Format arithmetic
// ---------------------------------------------------------------------------

/** Bits per second carried by a format. */
export function bitrateBps(fmt: AudioFormat): number {
  const info = ENCODINGS[fmt.encoding]
  if (info.compressed && !info.bitsPerSample) {
    // Opus/MP3/AAC/FLAC carry an explicit bitrate; fall back to a sane default.
    return fmt.bitrateBps ?? defaultCompressedBitrate(fmt)
  }
  const bits = fmt.bitDepth ?? info.bitsPerSample ?? 16
  return fmt.sampleRate * bits * fmt.channels
}

function defaultCompressedBitrate(fmt: AudioFormat): number {
  switch (fmt.encoding) {
    case 'opus':
      return fmt.sampleRate >= 24000 ? 32000 : 24000
    case 'mp3':
      return 64000
    case 'aac':
      return 64000
    case 'flac':
      return Math.round(fmt.sampleRate * 16 * fmt.channels * 0.55)
    default:
      return fmt.sampleRate * 16 * fmt.channels
  }
}

export function bytesPerSecond(fmt: AudioFormat): number {
  return bitrateBps(fmt) / 8
}

/** Bytes in one packetisation frame. */
export function bytesPerFrame(fmt: AudioFormat): number {
  const frameMs = fmt.frameMs ?? 20
  return Math.round((bytesPerSecond(fmt) * frameMs) / 1000)
}

export function framesPerSecond(fmt: AudioFormat): number {
  return 1000 / (fmt.frameMs ?? 20)
}

/** Samples in one frame (per channel). */
export function samplesPerFrame(fmt: AudioFormat): number {
  return Math.round((fmt.sampleRate * (fmt.frameMs ?? 20)) / 1000)
}

/** Total bytes for N seconds of this format. */
export function bytesForSeconds(fmt: AudioFormat, seconds: number): number {
  return Math.round(bytesPerSecond(fmt) * seconds)
}

export function formatLabel(fmt: AudioFormat): string {
  const info = ENCODINGS[fmt.encoding]
  const ch = fmt.channels === 1 ? 'mono' : 'stereo'
  const khz = (fmt.sampleRate / 1000).toFixed(fmt.sampleRate % 1000 === 0 ? 0 : 2)
  return `${info.name} · ${khz} kHz · ${ch}`
}

export function shortFormatLabel(fmt: AudioFormat): string {
  const khz = (fmt.sampleRate / 1000).toFixed(fmt.sampleRate % 1000 === 0 ? 0 : 2)
  return `${fmt.encoding} ${khz}k`
}

/** Nyquist: the highest frequency a sample rate can represent. */
export function nyquistHz(sampleRate: number): number {
  return sampleRate / 2
}

/**
 * Effective speech bandwidth. Telephony additionally band-limits to ~3.4 kHz
 * regardless of the Nyquist limit, which is why 8 kHz audio sounds "phone-like".
 */
export function usableBandwidthHz(fmt: AudioFormat): number {
  const nyq = nyquistHz(fmt.sampleRate)
  if (fmt.encoding === 'mulaw' || fmt.encoding === 'alaw') return Math.min(nyq, 3400)
  return Math.min(nyq, 8000)
}

// ---------------------------------------------------------------------------
// Pipeline analysis
// ---------------------------------------------------------------------------

export interface PipelineStage {
  id: string
  label: string
  format: AudioFormat
  /** What this stage is (gateway, STT, TTS ...). */
  role: string
}

export type ConversionKind =
  | 'none'
  | 'decode'
  | 'encode'
  | 'transcode'
  | 'resample-up'
  | 'resample-down'
  | 'channel-mix'
  | 'bit-depth'

export interface Conversion {
  from: PipelineStage
  to: PipelineStage
  kinds: ConversionKind[]
  /** Added latency in ms from buffering + codec delay. Assumption. */
  latencyMs: number
  /** Relative CPU cost per second of audio. Assumption. */
  cpuCostPerAudioSecond: number
  /** True when information is permanently destroyed. */
  lossy: boolean
  /** Quality score after this conversion, 0..1, monotonically non-increasing. */
  qualityAfter: number
  explanation: string
  warnings: string[]
}

export interface PipelineAnalysis {
  stages: PipelineStage[]
  conversions: Conversion[]
  totalLatencyMs: number
  totalCpuPerAudioSecond: number
  /** Final quality relative to the original capture, 0..1. */
  endToEndQuality: number
  /** Ceiling imposed by the narrowest point in the chain. */
  effectiveBandwidthHz: number
  lossyHops: number
  resampleHops: number
  warnings: string[]
  verdict: 'clean' | 'acceptable' | 'wasteful'
  verdictReason: string
}

/**
 * Compare two formats and describe what a converter between them must do.
 */
export function classifyConversion(from: AudioFormat, to: AudioFormat): ConversionKind[] {
  const kinds: ConversionKind[] = []
  const fromInfo = ENCODINGS[from.encoding]
  const toInfo = ENCODINGS[to.encoding]

  if (from.encoding !== to.encoding) {
    if (fromInfo.compressed && toInfo.compressed) kinds.push('transcode')
    else if (fromInfo.compressed) kinds.push('decode')
    else if (toInfo.compressed) kinds.push('encode')
    else kinds.push('bit-depth')
  }
  if (from.sampleRate < to.sampleRate) kinds.push('resample-up')
  else if (from.sampleRate > to.sampleRate) kinds.push('resample-down')

  if (from.channels !== to.channels) kinds.push('channel-mix')

  if (
    from.encoding === to.encoding &&
    (from.bitDepth ?? fromInfo.bitsPerSample) !== (to.bitDepth ?? toInfo.bitsPerSample) &&
    !kinds.includes('bit-depth')
  ) {
    kinds.push('bit-depth')
  }

  return kinds.length ? kinds : ['none']
}

/**
 * Resampling between rates that are not simple integer ratios needs a
 * higher-order filter and is both more expensive and slightly worse. 8 -> 16 is
 * a clean 2x; 16 -> 22.05 is 441/320 and is where quality quietly leaks away.
 */
function resampleRatioPenalty(fromRate: number, toRate: number): { clean: boolean; ratio: string } {
  const g = gcd(fromRate, toRate)
  const up = toRate / g
  const down = fromRate / g
  const clean = up <= 8 && down <= 8
  return { clean, ratio: `${up}/${down}` }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function analyseConversion(from: PipelineStage, to: PipelineStage): Conversion {
  const kinds = classifyConversion(from.format, to.format)
  const fromInfo = ENCODINGS[from.format.encoding]
  const toInfo = ENCODINGS[to.format.encoding]

  let latencyMs = 0
  let cpu = 0
  let lossy = false
  let quality = 1
  const warnings: string[] = []
  const parts: string[] = []

  if (kinds.includes('none')) {
    return {
      from,
      to,
      kinds,
      latencyMs: 0,
      cpuCostPerAudioSecond: 0,
      lossy: false,
      qualityAfter: 1,
      explanation: 'Formats match — the buffer is passed through untouched. This is the ideal hop.',
      warnings: [],
    }
  }

  if (kinds.includes('decode') || kinds.includes('transcode')) {
    latencyMs += fromInfo.algorithmicDelayMs
    cpu += fromInfo.cpuCostPerAudioSecond
    parts.push(`decode ${fromInfo.name}`)
  }
  if (kinds.includes('encode') || kinds.includes('transcode')) {
    latencyMs += toInfo.algorithmicDelayMs
    cpu += toInfo.cpuCostPerAudioSecond
    parts.push(`encode ${toInfo.name}`)
    if (toInfo.lossy) {
      lossy = true
      // Each lossy generation costs quality. Perceptual codecs are designed to
      // survive one pass; the damage compounds on re-encode.
      quality *= toInfo.id === 'opus' ? 0.94 : 0.86
    }
  }

  if (kinds.includes('resample-up')) {
    const { clean, ratio } = resampleRatioPenalty(from.format.sampleRate, to.format.sampleRate)
    latencyMs += clean ? 2 : 5
    cpu += clean ? 0.0008 : 0.002
    parts.push(`resample ${from.format.sampleRate / 1000}k -> ${to.format.sampleRate / 1000}k (${ratio})`)
    warnings.push(
      `Upsampling ${from.format.sampleRate / 1000} kHz -> ${to.format.sampleRate / 1000} kHz does not add information. ` +
        `Content above ${nyquistHz(from.format.sampleRate)} Hz was already gone; this only makes the buffer bigger.`,
    )
    if (!clean) {
      quality *= 0.97
      warnings.push(`Non-integer ratio ${ratio} needs a polyphase filter — more CPU, slightly more artefacts.`)
    }
  }

  if (kinds.includes('resample-down')) {
    const { clean, ratio } = resampleRatioPenalty(from.format.sampleRate, to.format.sampleRate)
    latencyMs += clean ? 2 : 5
    cpu += clean ? 0.0008 : 0.002
    parts.push(`resample ${from.format.sampleRate / 1000}k -> ${to.format.sampleRate / 1000}k (${ratio})`)
    lossy = true
    quality *= 0.9
    warnings.push(
      `Downsampling to ${to.format.sampleRate / 1000} kHz permanently discards everything above ${nyquistHz(
        to.format.sampleRate,
      )} Hz.`,
    )
    if (!clean) quality *= 0.97
  }

  if (kinds.includes('channel-mix')) {
    cpu += 0.0002
    parts.push(from.format.channels > to.format.channels ? 'downmix to mono' : 'duplicate to stereo')
    if (from.format.channels > to.format.channels) {
      lossy = true
      quality *= 0.99
    } else {
      warnings.push('Duplicating mono into stereo doubles the bytes and adds nothing. Voice pipelines should stay mono.')
    }
  }

  if (kinds.includes('bit-depth')) {
    cpu += 0.0002
    parts.push(`${fromInfo.name} -> ${toInfo.name}`)
    if ((from.format.bitDepth ?? 16) > (to.format.bitDepth ?? 16)) {
      lossy = true
      quality *= 0.98
    }
  }

  // Buffering: you cannot convert a sample you have not received. The converter
  // waits for one frame of input before it can emit.
  const frameMs = to.format.frameMs ?? from.format.frameMs ?? 20
  latencyMs += frameMs / 2

  return {
    from,
    to,
    kinds,
    latencyMs: Math.round(latencyMs * 10) / 10,
    cpuCostPerAudioSecond: Math.round(cpu * 1e5) / 1e5,
    lossy,
    qualityAfter: Math.round(quality * 1000) / 1000,
    explanation: `${parts.join(', ')} (+ ~${(frameMs / 2).toFixed(0)} ms frame buffering).`,
    warnings,
  }
}

export function analysePipeline(stages: PipelineStage[]): PipelineAnalysis {
  const conversions: Conversion[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    conversions.push(analyseConversion(stages[i], stages[i + 1]))
  }

  const totalLatencyMs = conversions.reduce((s, c) => s + c.latencyMs, 0)
  const totalCpu = conversions.reduce((s, c) => s + c.cpuCostPerAudioSecond, 0)
  const endToEndQuality = conversions.reduce((q, c) => q * c.qualityAfter, 1)
  const lossyHops = conversions.filter((c) => c.lossy).length
  const resampleHops = conversions.filter((c) =>
    c.kinds.some((k) => k === 'resample-up' || k === 'resample-down'),
  ).length

  const effectiveBandwidthHz = Math.min(...stages.map((s) => usableBandwidthHz(s.format)))

  const warnings: string[] = []
  for (const c of conversions) warnings.push(...c.warnings)

  // The signature of a wasteful pipeline: the rate goes up and then comes back
  // down, or the same audio is compressed more than once.
  const rates = stages.map((s) => s.format.sampleRate)
  const roundTrip = detectRateRoundTrip(rates)
  if (roundTrip) {
    warnings.push(
      `Sample rate travels ${roundTrip} and ends where it started. Every hop past the minimum is pure cost — ` +
        `pick the highest rate any consumer needs and convert once.`,
    )
  }

  const lossyEncodes = conversions.filter((c) => c.kinds.includes('encode') || c.kinds.includes('transcode'))
    .filter((c) => ENCODINGS[c.to.format.encoding].lossy).length
  if (lossyEncodes > 1) {
    warnings.push(
      `${lossyEncodes} lossy encodes in one chain. Perceptual codecs are designed to survive one generation; ` +
        `each additional one removes detail the next one then tries to model.`,
    )
  }

  const highDelay = conversions.filter((c) => c.latencyMs > 60)
  for (const c of highDelay) {
    warnings.push(
      `${c.from.label} -> ${c.to.label} adds ${c.latencyMs} ms on its own. On the live path this comes straight out of your response budget.`,
    )
  }

  let verdict: PipelineAnalysis['verdict'] = 'clean'
  let verdictReason = 'Each hop converts only what the next consumer actually requires.'
  if (totalLatencyMs > 80 || lossyEncodes > 1 || roundTrip) {
    verdict = 'wasteful'
    verdictReason =
      'This chain spends latency, CPU and audio quality on conversions that no downstream consumer asked for.'
  } else if (totalLatencyMs > 35 || lossyHops > 2) {
    verdict = 'acceptable'
    verdictReason = 'Workable, but there is measurable latency and quality being spent on format plumbing.'
  }

  return {
    stages,
    conversions,
    totalLatencyMs: Math.round(totalLatencyMs * 10) / 10,
    totalCpuPerAudioSecond: Math.round(totalCpu * 1e5) / 1e5,
    endToEndQuality: Math.round(endToEndQuality * 1000) / 1000,
    effectiveBandwidthHz,
    lossyHops,
    resampleHops,
    warnings: dedupe(warnings),
    verdict,
    verdictReason,
  }
}

function detectRateRoundTrip(rates: number[]): string | null {
  if (rates.length < 3) return null
  const min = Math.min(...rates)
  const max = Math.max(...rates)
  if (max === min) return null
  const first = rates[0]
  const last = rates[rates.length - 1]
  if (first === last && max > first) {
    return rates.map((r) => `${r / 1000}k`).join(' -> ')
  }
  return null
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items))
}

// ---------------------------------------------------------------------------
// Common formats used across the app
// ---------------------------------------------------------------------------

export const FORMATS = {
  telephonyMulaw: { encoding: 'mulaw', sampleRate: 8000, channels: 1, bitDepth: 8, frameMs: 20 } as AudioFormat,
  telephonyAlaw: { encoding: 'alaw', sampleRate: 8000, channels: 1, bitDepth: 8, frameMs: 20 } as AudioFormat,
  pcm8k: { encoding: 'pcm16', sampleRate: 8000, channels: 1, bitDepth: 16, frameMs: 20 } as AudioFormat,
  pcm16k: { encoding: 'pcm16', sampleRate: 16000, channels: 1, bitDepth: 16, frameMs: 20 } as AudioFormat,
  pcm24k: { encoding: 'pcm16', sampleRate: 24000, channels: 1, bitDepth: 16, frameMs: 20 } as AudioFormat,
  pcm48k: { encoding: 'pcm16', sampleRate: 48000, channels: 1, bitDepth: 16, frameMs: 20 } as AudioFormat,
  opusWebrtc: { encoding: 'opus', sampleRate: 48000, channels: 1, bitrateBps: 32000, frameMs: 20 } as AudioFormat,
  opusNarrow: { encoding: 'opus', sampleRate: 16000, channels: 1, bitrateBps: 24000, frameMs: 20 } as AudioFormat,
  mp3Tts: { encoding: 'mp3', sampleRate: 22050, channels: 1, bitrateBps: 64000, frameMs: 26 } as AudioFormat,
  browserFloat: { encoding: 'pcmf32', sampleRate: 48000, channels: 1, bitDepth: 32, frameMs: 20 } as AudioFormat,
} as const

/** The canonical, well-designed phone pipeline. */
export function telephonyPipeline(): PipelineStage[] {
  return [
    { id: 'pstn', label: 'PSTN / carrier', role: 'Telephony ingress', format: FORMATS.telephonyMulaw },
    { id: 'gw', label: 'Media gateway', role: 'Decode to linear', format: FORMATS.pcm8k },
    { id: 'stt', label: 'Streaming STT', role: 'Recognition input', format: FORMATS.pcm16k },
    { id: 'tts', label: 'Streaming TTS', role: 'Synthesis output', format: FORMATS.pcm24k },
    { id: 'gwout', label: 'Media gateway (return)', role: 'Encode for carrier', format: FORMATS.telephonyMulaw },
  ]
}

/** The deliberately bad pipeline from the brief, used to teach the lesson. */
export function wastefulPipeline(): PipelineStage[] {
  return [
    { id: 'pstn', label: 'PSTN / carrier', role: 'Telephony ingress', format: FORMATS.telephonyMulaw },
    { id: 'a', label: 'Gateway A', role: 'Decode', format: FORMATS.pcm8k },
    { id: 'b', label: 'Upsampler', role: 'Normalise to 16k', format: FORMATS.pcm16k },
    { id: 'c', label: 'Legacy service', role: 'Odd internal rate', format: { encoding: 'pcm16', sampleRate: 22050, channels: 1, bitDepth: 16, frameMs: 20 } },
    { id: 'd', label: 'Archive encoder', role: 'Compress', format: FORMATS.mp3Tts },
    { id: 'e', label: 'Decoder', role: 'Back to linear', format: FORMATS.pcm16k },
    { id: 'f', label: 'Carrier egress', role: 'Encode for PSTN', format: FORMATS.telephonyMulaw },
  ]
}

/** Browser/WebRTC pipeline. */
export function webrtcPipeline(): PipelineStage[] {
  return [
    { id: 'mic', label: 'Browser microphone', role: 'Capture', format: FORMATS.browserFloat },
    { id: 'opus', label: 'Opus encoder (WebRTC)', role: 'Transport codec', format: FORMATS.opusWebrtc },
    { id: 'sfu', label: 'Media server decode', role: 'Decode to linear', format: FORMATS.pcm48k },
    { id: 'stt', label: 'Streaming STT', role: 'Recognition input', format: FORMATS.pcm16k },
    { id: 'tts', label: 'Streaming TTS', role: 'Synthesis output', format: FORMATS.pcm24k },
    { id: 'back', label: 'Opus encoder (return)', role: 'Transport codec', format: FORMATS.opusWebrtc },
  ]
}
