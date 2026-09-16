/**
 * Evaluation: the thing that turns "it seemed fine when I tried it" into a
 * number you can put in a release decision.
 *
 * Three rules this framework follows, and they are the whole design:
 *
 *  1. **Deterministic.** No model judges another model. Every verdict comes
 *     from the same seeded quality simulation, so the same suite on the same
 *     seed gives the same answer on every machine, forever. An eval you cannot
 *     reproduce is an anecdote with a percentage sign.
 *  2. **Three outcomes, not two.** PASS / PARTIAL / FAIL. The middle one is the
 *     important one: a turn the caller can recover from with one more sentence
 *     is categorically different from a turn that silently books the wrong
 *     date, and a binary pass rate hides exactly that distinction.
 *  3. **Regressions over absolutes.** A 78% pass rate means nothing on its own.
 *     "These four cases passed last week and fail now" is actionable. The
 *     comparison, not the score, is the product.
 *
 * Severity is assigned by what the caller can do about it, not by how wrong the
 * agent was. That is why a hallucination is a FAIL and a misunderstanding is a
 * PARTIAL, even though the misunderstanding looks worse in a transcript.
 */

import { round } from '../engine/simulation'
import type { QualityConfig, QualityFailureKind, TurnCase, TurnOutcome } from './agentQuality'
import { FAILURE_META, TURN_CASES, runQuality } from './agentQuality'

export type Verdict = 'PASS' | 'PARTIAL' | 'FAIL'

/**
 * How each failure kind maps to a verdict.
 *
 * The rule: can the caller recover within the same call, without knowing that
 * anything went wrong? If they can, PARTIAL. If the failure is silent, or
 * mutates state, or strands the caller, FAIL.
 */
const SEVERITY: Record<QualityFailureKind, { verdict: Verdict; because: string }> = {
  misunderstood: {
    verdict: 'PARTIAL',
    because:
      'The caller hears an answer to the wrong question and repeats themselves. It costs a turn and it is visible, which means it is self-correcting.',
  },
  'lost-state': {
    verdict: 'PARTIAL',
    because:
      'Being asked twice is annoying and recoverable. The caller supplies the fact again and the call continues.',
  },
  'over-escalation': {
    verdict: 'PARTIAL',
    because:
      'The caller still gets helped, by a person, at your expense. Bad economics rather than a bad outcome.',
  },
  'wrong-tool': {
    verdict: 'FAIL',
    because:
      'An action was taken that the caller did not ask for. Even when they notice, something has already happened.',
  },
  'bad-arguments': {
    verdict: 'FAIL',
    because:
      'The call succeeded with the wrong values. Nothing in the conversation signals an error, so nobody looks — this is the failure that reaches a customer.',
  },
  hallucination: {
    verdict: 'FAIL',
    because:
      'A confident, specific, unfounded answer. The caller acts on it and finds out later, which is the worst possible discovery path.',
  },
  'missed-escalation': {
    verdict: 'FAIL',
    because:
      'A caller who needed a person did not get one. This is where complaints and public escalations come from.',
  },
}

export interface CaseResult {
  case: TurnCase
  verdict: Verdict
  failure: QualityFailureKind | null
  /** Why this verdict, in the learner's words. */
  reason: string
  /** What the simulation actually did on this turn. */
  detail: string
}

export interface SuiteResult {
  label: string
  seed: string
  results: CaseResult[]
  pass: number
  partial: number
  fail: number
  /** Share of cases that are not FAIL. Reported, never used as a single score. */
  passRate: number
  /** The release gate: no FAIL on a mutating case. */
  gate: { ok: boolean; blocking: CaseResult[] }
}

export function runSuite(cfg: QualityConfig, label = 'Current configuration', cases: TurnCase[] = TURN_CASES): SuiteResult {
  const run = runQuality(cfg, cases)
  const results = run.outcomes.map(toCaseResult)
  const pass = results.filter((r) => r.verdict === 'PASS').length
  const partial = results.filter((r) => r.verdict === 'PARTIAL').length
  const fail = results.filter((r) => r.verdict === 'FAIL').length
  const blocking = results.filter((r) => r.verdict === 'FAIL' && r.case.mutating)
  return {
    label,
    seed: cfg.seed,
    results,
    pass,
    partial,
    fail,
    passRate: round(pass / Math.max(1, results.length), 4),
    gate: { ok: blocking.length === 0, blocking },
  }
}

function toCaseResult(o: TurnOutcome): CaseResult {
  if (!o.failure) {
    return {
      case: o.case,
      verdict: 'PASS',
      failure: null,
      reason: 'Handled as specified.',
      detail: o.explanation,
    }
  }
  const sev = SEVERITY[o.failure]
  return {
    case: o.case,
    verdict: sev.verdict,
    failure: o.failure,
    reason: `${FAILURE_META[o.failure].label}. ${sev.because}`,
    detail: o.explanation,
  }
}

// ---------------------------------------------------------------------------
// Regression comparison
// ---------------------------------------------------------------------------

export type ChangeKind = 'fixed' | 'regressed' | 'unchanged' | 'moved'

export interface CaseChange {
  caseId: string
  utterance: string
  before: Verdict
  after: Verdict
  change: ChangeKind
  /** What the change means for a release decision. */
  note: string
}

export interface SuiteComparison {
  baseline: SuiteResult
  candidate: SuiteResult
  changes: CaseChange[]
  fixed: number
  regressed: number
  /** True when the candidate introduces no new FAIL. */
  safeToShip: boolean
  /** The sentence a reviewer actually needs. */
  verdict: string
}

const RANK: Record<Verdict, number> = { PASS: 2, PARTIAL: 1, FAIL: 0 }

export function compareSuites(baseline: SuiteResult, candidate: SuiteResult): SuiteComparison {
  const byId = new Map(baseline.results.map((r) => [r.case.id, r]))
  const changes: CaseChange[] = []

  for (const after of candidate.results) {
    const before = byId.get(after.case.id)
    if (!before) continue
    const delta = RANK[after.verdict] - RANK[before.verdict]
    const change: ChangeKind =
      delta > 0 ? 'fixed' : delta < 0 ? 'regressed' : before.failure === after.failure ? 'unchanged' : 'moved'
    changes.push({
      caseId: after.case.id,
      utterance: after.case.utterance,
      before: before.verdict,
      after: after.verdict,
      change,
      note:
        change === 'fixed'
          ? `Improved from ${before.verdict} to ${after.verdict}. ${after.reason}`
          : change === 'regressed'
            ? `Regressed from ${before.verdict} to ${after.verdict}. ${after.reason} This is the change to explain before shipping.`
            : change === 'moved'
              ? `Same verdict, different failure: ${before.failure ?? 'none'} → ${after.failure ?? 'none'}. The change moved the problem rather than fixing it.`
              : 'No change.',
    })
  }

  const regressed = changes.filter((c) => c.change === 'regressed').length
  const fixed = changes.filter((c) => c.change === 'fixed').length
  const newFails = changes.filter((c) => c.after === 'FAIL' && c.before !== 'FAIL').length

  return {
    baseline,
    candidate,
    changes,
    fixed,
    regressed,
    safeToShip: newFails === 0 && candidate.gate.ok,
    verdict:
      newFails > 0
        ? `${newFails} case${newFails > 1 ? 's' : ''} that did not fail before fail now. Whatever else improved, this is a regression and it needs a reason before it ships.`
        : !candidate.gate.ok
          ? 'No new failures, but a state-changing case is still failing. The gate blocks on those regardless of the trend.'
          : fixed > 0
            ? `${fixed} case${fixed > 1 ? 's' : ''} improved, nothing regressed, and no state-changing case fails. This is what a shippable change looks like.`
            : 'Nothing changed. Either the edit did not affect behaviour, or the suite does not cover what the edit touched — and the second is worth checking.',
  }
}

/**
 * Compare across several seeds rather than one.
 *
 * A single seed compares two configurations on twelve coin flips. Running the
 * same suite over several seeds and reporting the spread is the difference
 * between an evaluation and an anecdote — and it is cheap here, because the
 * whole thing is deterministic arithmetic.
 */
export interface SeedSweep {
  seeds: string[]
  perSeed: { seed: string; pass: number; partial: number; fail: number }[]
  meanPassRate: number
  worstSeed: { seed: string; fail: number }
  bestSeed: { seed: string; fail: number }
  /** How much the verdict depends on which seed you happened to run. */
  spread: number
}

export function sweepSeeds(cfg: QualityConfig, seeds: string[], cases: TurnCase[] = TURN_CASES): SeedSweep {
  const perSeed = seeds.map((seed) => {
    const r = runSuite({ ...cfg, seed }, seed, cases)
    return { seed, pass: r.pass, partial: r.partial, fail: r.fail }
  })
  const rates = perSeed.map((p) => p.pass / Math.max(1, cases.length))
  const worst = perSeed.reduce((a, b) => (a.fail >= b.fail ? a : b), perSeed[0])
  const best = perSeed.reduce((a, b) => (a.fail <= b.fail ? a : b), perSeed[0])
  return {
    seeds,
    perSeed,
    meanPassRate: round(rates.reduce((a, b) => a + b, 0) / Math.max(1, rates.length), 4),
    worstSeed: { seed: worst.seed, fail: worst.fail },
    bestSeed: { seed: best.seed, fail: best.fail },
    spread: worst.fail - best.fail,
  }
}

export const DEFAULT_SWEEP_SEEDS = ['eval-a', 'eval-b', 'eval-c', 'eval-d', 'eval-e']

/** What each verdict means, for the legend. */
export const VERDICT_MEANING: Record<Verdict, string> = {
  PASS: 'The turn was handled as specified.',
  PARTIAL:
    'Something went wrong that the caller can see and recover from within the call. It costs a turn and some patience, not an outcome.',
  FAIL: 'Something went wrong that the caller cannot see, cannot recover from, or that changed state incorrectly.',
}
