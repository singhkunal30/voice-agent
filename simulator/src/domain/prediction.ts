/**
 * Predict → Simulate → Observe → Explain → Redesign.
 *
 * The single biggest difference between reading a simulator and learning from
 * one is whether you committed to an answer before pressing Run. A number you
 * predicted wrongly is remembered; a number you merely read is not.
 *
 * So every serious lab gates its Run button behind a prediction. The learner
 * picks a band ("I think this lands in 600–1000 ms"), the simulation runs, and
 * the result is shown *next to* the prediction with the distance between them
 * named in engineering terms — not as a score, as a diagnosis.
 *
 * This module is pure: questions in, outcomes out, no React and no clock. The
 * "actual" value always comes from a simulation the learner can re-run with
 * the same seed, so a surprising result is reproducible rather than magic.
 */

export interface PredictionOption {
  id: string
  label: string
  /** Optional numeric interpretation, for ordering and near-miss distance. */
  hint?: string
}

export interface PredictionQuestion {
  id: string
  /** What the learner commits to before running. */
  prompt: string
  /** Why this particular guess is worth making. */
  why: string
  /** Ordered from "least" to "most" so distance means something. */
  options: PredictionOption[]
}

export interface PredictionOutcome {
  questionId: string
  prompt: string
  /** null when the learner ran without committing (allowed, but not evidence). */
  predicted: string | null
  actual: string
  predictedLabel: string | null
  actualLabel: string
  correct: boolean
  /**
   * How far apart the two answers sit on the ordered option list.
   * 0 = exact, 1 = adjacent band (a near miss, usually a tuning error),
   * 2+ = the wrong end of the scale (usually a mental-model error).
   */
  distance: number
  /** What the gap between prediction and measurement actually tells you. */
  diagnosis: string
}

/**
 * Map a numeric measurement onto an ordered set of bands.
 * `bands` must be ordered ascending by `max`; the last band should be Infinity.
 */
export function bandFor<T extends { id: string; max: number }>(value: number, bands: T[]): T {
  return bands.find((b) => value <= b.max) ?? bands[bands.length - 1]
}

const DIAGNOSIS_EXACT =
  'Your model of this system produced the right answer. Change an input and predict again — a model is only proven by the cases it gets right for the right reason.'
const DIAGNOSIS_NEAR =
  'One band out. The shape of your model is right; a constant is wrong. Look at which single stage contributed most and check the number you assumed for it.'
const DIAGNOSIS_FAR =
  'Several bands out. This is not a tuning error — something in the causal chain is not where you think it is. Read the breakdown from the top and find the first stage that surprised you.'
const DIAGNOSIS_NONE =
  'You ran this without committing to an answer, so it produced information but no evidence about what you knew. Predict first on the next run.'

export function scorePrediction(
  q: PredictionQuestion,
  predicted: string | null,
  actual: string,
): PredictionOutcome {
  const pi = q.options.findIndex((o) => o.id === predicted)
  const ai = q.options.findIndex((o) => o.id === actual)
  const distance = pi < 0 || ai < 0 ? -1 : Math.abs(pi - ai)
  const correct = predicted !== null && predicted === actual
  return {
    questionId: q.id,
    prompt: q.prompt,
    predicted,
    actual,
    predictedLabel: pi >= 0 ? q.options[pi].label : null,
    actualLabel: ai >= 0 ? q.options[ai].label : actual,
    correct,
    distance,
    diagnosis:
      predicted === null
        ? DIAGNOSIS_NONE
        : correct
          ? DIAGNOSIS_EXACT
          : distance === 1
            ? DIAGNOSIS_NEAR
            : DIAGNOSIS_FAR,
  }
}

// ---------------------------------------------------------------------------
// The standard question set
// ---------------------------------------------------------------------------

/** Latency bands, aligned with the perception scale in domain/numbers.ts. */
export const LATENCY_BANDS = [
  { id: 'immediate', max: 300, label: 'Under 300 ms — indistinguishable from a person' },
  { id: 'natural', max: 600, label: '300–600 ms — natural turn-taking' },
  { id: 'noticeable', max: 1000, label: '600 ms–1 s — a noticeable beat' },
  { id: 'awkward', max: 2000, label: '1–2 s — awkward, callers repeat themselves' },
  { id: 'broken', max: Infinity, label: 'Over 2 s — the turn structure collapses' },
]

export const PERCEIVED_LATENCY_Q: PredictionQuestion = {
  id: 'perceived-latency',
  prompt: 'Before you run it: where will perceived latency land?',
  why: 'Perceived latency is not the sum of the stage durations — streaming stages overlap. Guessing forces you to decide which stages you think actually gate the turn.',
  options: LATENCY_BANDS.map((b) => ({ id: b.id, label: b.label })),
}

export const OUTCOME_Q: PredictionQuestion = {
  id: 'call-outcome',
  prompt: 'Before you run it: how does this call end?',
  why: 'A failure that the caller never notices and a failure that drops the call look identical in a status page. Committing to one forces you to trace the mitigation path.',
  options: [
    { id: 'completed', label: 'Completes normally — the caller notices nothing' },
    { id: 'degraded', label: 'Completes, but slower or worse than intended' },
    { id: 'handed-off', label: 'Escalates to a human' },
    { id: 'failed', label: 'Fails — the caller is left without an answer' },
  ],
}

export const SATURATION_BANDS = [
  { id: 'fine', max: 0.6, label: 'Comfortable — under 60% on everything' },
  { id: 'tight', max: 0.85, label: 'Tight — something is past 60% but nothing is saturated' },
  { id: 'warning', max: 1.0, label: 'At the edge — something is above 85%' },
  { id: 'saturated', max: Infinity, label: 'Saturated — at least one component is over capacity' },
]

export const SATURATION_Q: PredictionQuestion = {
  id: 'saturation',
  prompt: 'Before you raise the load: how close to the edge does this fleet get?',
  why: 'Capacity failures are rarely where people expect. Connection-bound components saturate long before CPU-bound ones, and the human tier saturates before either.',
  options: SATURATION_BANDS.map((b) => ({ id: b.id, label: b.label })),
}

/** Which component gives out first — options are generated from the architecture. */
export function firstBottleneckQuestion(labels: { id: string; label: string }[]): PredictionQuestion {
  return {
    id: 'first-bottleneck',
    prompt: 'Before you run it: which component runs out of room first?',
    why: 'The answer is almost never the component doing the most obvious work. Capacity is per-connection for some components and per-request for others, and the two saturate at wildly different loads.',
    options: [
      ...labels.map((l) => ({ id: l.id, label: l.label })),
      { id: 'none', label: 'Nothing saturates at this load' },
    ],
  }
}

export const COST_BANDS = [
  { id: 'cheap', max: 0.02, label: 'Under 2¢ per call' },
  { id: 'moderate', max: 0.08, label: '2–8¢ per call' },
  { id: 'pricey', max: 0.2, label: '8–20¢ per call' },
  { id: 'expensive', max: Infinity, label: 'Over 20¢ per call' },
]

export const COST_Q: PredictionQuestion = {
  id: 'cost-per-call',
  prompt: 'Before you compute it: what does one call cost?',
  why: 'Most people guess the model and get the telephony minutes wrong, or guess the minutes and forget that TTS is billed per character of a reply nobody reads.',
  options: COST_BANDS.map((b) => ({ id: b.id, label: b.label })),
}

export const PRESSURE_Q: PredictionQuestion = {
  id: 'pressure-verdict',
  prompt: 'Before you apply the pressure: does this architecture hold?',
  why: 'Architectures are chosen for the conditions their authors imagined. Committing to a verdict first is how you find out which condition you quietly assumed would never change.',
  options: [
    { id: 'holds', label: 'Holds — it absorbs this without a redesign' },
    { id: 'degrades', label: 'Degrades — it survives, but misses a target' },
    { id: 'breaks', label: 'Breaks — it needs a structural change' },
  ],
}

export const QUALITY_BANDS = [
  { id: 'reliable', max: 0.05, label: 'Under 5% of turns go wrong' },
  { id: 'rough', max: 0.15, label: '5–15% of turns go wrong' },
  { id: 'unusable', max: Infinity, label: 'Over 15% of turns go wrong' },
]

export const QUALITY_Q: PredictionQuestion = {
  id: 'agent-quality',
  prompt: 'Before you run the suite: how many turns go wrong?',
  why: 'Latency and uptime are easy to measure and easy to fix. Whether the agent understood, picked the right tool and passed the right arguments is the part that decides if anyone keeps using it.',
  options: QUALITY_BANDS.map((b) => ({ id: b.id, label: b.label })),
}

/** Every built-in question, for tests and for the prediction record. */
export const ALL_QUESTIONS: PredictionQuestion[] = [
  PERCEIVED_LATENCY_Q,
  OUTCOME_Q,
  SATURATION_Q,
  COST_Q,
  PRESSURE_Q,
  QUALITY_Q,
]

// ---------------------------------------------------------------------------
// The prediction record
// ---------------------------------------------------------------------------

/**
 * A learner's history of predictions, kept so the app can say "you have been
 * wrong about capacity three times and right about latency four" — which is
 * useful — without ever turning that into a score, a level or a leaderboard,
 * which would not be.
 */
export interface PredictionRecordEntry {
  questionId: string
  correct: boolean
  distance: number
  /** Which lab it was made in, so the record can point back at the work. */
  route: string
  at: number
}

export interface TopicCalibration {
  questionId: string
  prompt: string
  attempts: number
  exact: number
  near: number
  far: number
}

export function calibration(entries: PredictionRecordEntry[]): TopicCalibration[] {
  const byQuestion = new Map<string, PredictionRecordEntry[]>()
  for (const e of entries) {
    const list = byQuestion.get(e.questionId) ?? []
    list.push(e)
    byQuestion.set(e.questionId, list)
  }
  return [...byQuestion.entries()].map(([questionId, list]) => ({
    questionId,
    prompt: ALL_QUESTIONS.find((q) => q.id === questionId)?.prompt ?? questionId,
    attempts: list.length,
    exact: list.filter((e) => e.distance === 0).length,
    near: list.filter((e) => e.distance === 1).length,
    far: list.filter((e) => e.distance > 1).length,
  }))
}

/** How many predictions the learner has committed to at all. */
export function predictionCount(entries: PredictionRecordEntry[]): number {
  return entries.length
}

/**
 * Distinct questions the learner has predicted correctly at least once.
 * This is what the course uses as evidence — not a hit rate, because a hit
 * rate rewards predicting the same easy thing repeatedly.
 */
export function topicsProven(entries: PredictionRecordEntry[]): string[] {
  return [...new Set(entries.filter((e) => e.correct).map((e) => e.questionId))]
}
