/**
 * Where a number came from.
 *
 * V1 labelled every figure "simulation assumption", which was honest but
 * flattened three genuinely different things into one word:
 *
 *  - ASSUMPTION — a value *we* picked so the model has something to chew on.
 *    Editable, arguable, and the first thing to challenge when a conclusion
 *    looks wrong.
 *  - REFERENCE — a value fixed by a standard, a protocol or arithmetic. G.711
 *    is 64 kbit/s because the standard says 8000 samples × 8 bits. Arguing
 *    with it is arguing with the spec.
 *  - MEASURED — a value this simulator actually produced on a named seed.
 *    Re-run the same seed and you get the same number; it is a measurement of
 *    the model, not of any vendor's production system.
 *
 * The distinction matters because learners act on it differently. You tune an
 * ASSUMPTION, you look up a REFERENCE, and you reproduce a MEASURED value.
 * Calling all three "assumption" taught learners to discount all three.
 *
 * Nothing here is a claim about a real vendor. A MEASURED number is measured
 * *inside the simulation*; that is the strongest claim this app ever makes.
 */

export type NumberKind = 'ASSUMPTION' | 'REFERENCE' | 'MEASURED'

export interface Provenance {
  kind: NumberKind
  /** Where it came from: a standard's name, a seed, or the reasoning behind a guess. */
  source: string
  /** Present for MEASURED values: the seed that reproduces them. */
  seed?: string
}

export interface Tracked<T = number> {
  value: T
  provenance: Provenance
}

export function assumption<T>(value: T, source: string): Tracked<T> {
  return { value, provenance: { kind: 'ASSUMPTION', source } }
}

export function reference<T>(value: T, source: string): Tracked<T> {
  return { value, provenance: { kind: 'REFERENCE', source } }
}

export function measured<T>(value: T, seed: string, source = 'Produced by this simulator'): Tracked<T> {
  return { value, provenance: { kind: 'MEASURED', source, seed } }
}

/** One-line explanation of each kind, for tooltips and the legend. */
export const KIND_MEANING: Record<NumberKind, string> = {
  ASSUMPTION:
    'A value this simulator picked so the model has something to work with. Editable, arguable, and the first thing to question if a conclusion looks wrong. Not a measurement of any vendor.',
  REFERENCE:
    'Fixed by a published standard, a protocol definition or plain arithmetic. G.711 is 64 kbit/s because 8000 samples/s × 8 bits/sample is 64 kbit/s. You look this up; you do not tune it.',
  MEASURED:
    'Produced by a run of this simulator on a named seed. Re-run the same seed and the same number comes back. It measures the model, not any production system.',
}

/** What a learner should do with a number of each kind. */
export const KIND_ACTION: Record<NumberKind, string> = {
  ASSUMPTION: 'Change it and see whether the conclusion survives.',
  REFERENCE: 'Take it as given — design around it.',
  MEASURED: 'Reproduce it with the seed, then change an input and re-measure.',
}

/**
 * Standards-fixed values used across the simulator.
 *
 * These are REFERENCE numbers: arithmetic over published protocol constants,
 * not estimates. They are collected here so a lab can cite the same figure the
 * audio model computes from, and so the distinction from tunable assumptions
 * is visible in one place.
 */
export const REFERENCE_NUMBERS: { id: string; label: string; value: string; source: string; note: string }[] = [
  {
    id: 'g711-bitrate',
    label: 'G.711 bitrate',
    value: '64 kbit/s',
    source: 'ITU-T G.711',
    note: '8000 samples/s × 8 bits/sample. Both mu-law and A-law. This is why PSTN audio is 8 kHz and always will be.',
  },
  {
    id: 'rtp-frame',
    label: 'RTP packetisation interval',
    value: '20 ms',
    source: 'RFC 3551 default',
    note: '160 samples at 8 kHz per packet. Smaller frames cut latency and raise header overhead; 20 ms is the near-universal default.',
  },
  {
    id: 'rtp-header',
    label: 'RTP + UDP + IP header',
    value: '40 bytes',
    source: 'RFC 3550 / RFC 768 / RFC 791',
    note: '12 + 8 + 20. On a 160-byte G.711 payload that is 25% overhead before any audio is carried.',
  },
  {
    id: 'nyquist',
    label: 'Nyquist limit at 8 kHz',
    value: '4 kHz',
    source: 'Nyquist–Shannon sampling theorem',
    note: 'Half the sample rate. Everything above 4 kHz is gone before your STT ever sees it — which is why "S" and "F" are confusable on a phone call.',
  },
  {
    id: 'opus-range',
    label: 'Opus bitrate range',
    value: '6–510 kbit/s',
    source: 'RFC 6716',
    note: 'Voice typically runs 16–32 kbit/s. Wideband speech at a quarter of G.711 bitrate is why WebRTC sounds better than a phone call.',
  },
  {
    id: 'erlang-occupancy',
    label: 'Erlang C occupancy ceiling',
    value: '< 100%',
    source: 'Erlang C queueing model',
    note: 'Wait time goes to infinity as occupancy approaches 1. Staffing a human tier at 100% is arithmetic failure, not optimism.',
  },
  {
    id: 'availability-minutes',
    label: '99.9% availability',
    value: '43.2 min/month',
    source: 'Arithmetic: 0.001 × 30 days',
    note: 'A single 99.9% dependency on the critical path caps your own availability at 99.9% before you have written any code.',
  },
  {
    id: 'ws-frame',
    label: 'WebSocket frame header',
    value: '2–14 bytes',
    source: 'RFC 6455',
    note: 'Tiny next to RTP\'s 40 — but WebSocket rides TCP, so a lost packet stalls everything behind it.',
  },
]

/**
 * Human-perception thresholds.
 *
 * These are ASSUMPTIONS in this simulator — they are drawn from the general
 * conversational-turn-taking literature, but the exact boundaries vary by
 * person, language and context, and this app has measured none of them. They
 * are here because latency numbers are meaningless without a scale to read
 * them against, and a labelled approximate scale beats an unlabelled one.
 */
export const PERCEPTION_BANDS: { maxMs: number; label: string; feels: string }[] = [
  { maxMs: 300, label: 'Immediate', feels: 'Indistinguishable from a person who was already listening.' },
  { maxMs: 600, label: 'Natural', feels: 'Reads as normal conversational turn-taking. Nobody comments on it.' },
  { maxMs: 1000, label: 'Noticeable', feels: 'A beat of hesitation. Fine occasionally, tiring over a long call.' },
  { maxMs: 2000, label: 'Awkward', feels: 'Callers start repeating themselves or saying "hello?".' },
  { maxMs: Infinity, label: 'Broken', feels: 'Callers talk over the agent or hang up. The turn structure has collapsed.' },
]

export function perceptionBand(ms: number): { label: string; feels: string } {
  return PERCEPTION_BANDS.find((b) => ms <= b.maxMs) ?? PERCEPTION_BANDS[PERCEPTION_BANDS.length - 1]
}
