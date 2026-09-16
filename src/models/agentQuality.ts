/**
 * Agent quality: whether the thing actually works.
 *
 * Latency, uptime and cost are the easy properties — they are numbers, they
 * have dashboards, and a graph going the wrong way is unambiguous. Quality is
 * the property that decides whether anyone keeps using the agent, and it is
 * the one that most voice-agent projects never measure until a customer
 * complains.
 *
 * This model simulates a turn going wrong in the six ways that matter:
 *
 *   misunderstood      the transcript was wrong and the meaning changed with it
 *   wrong-tool         the right intent, the wrong function
 *   bad-arguments      the right function, arguments that do not mean what the
 *                      caller said (this is the expensive one — it succeeds)
 *   hallucination      a confident answer with no tool result behind it
 *   lost-state         asked for something the caller already gave
 *   missed-escalation  kept a caller who needed a person
 *   over-escalation    transferred a caller it could have helped
 *
 * The probabilities are ASSUMPTIONS derived from prompt factors, model tier,
 * recognition error rate and context strategy. Nothing here measures any real
 * model. What it does is make the *couplings* visible and reproducible: raise
 * the word error rate and watch bad-arguments rise even though nothing about
 * the agent changed; drop the tool documentation and watch wrong-tool separate
 * from bad-arguments in a way a single "accuracy" number would hide.
 *
 * Deterministic: same config + same seed => same failing turns, every time.
 */

import { Rng } from '../engine/rng'
import { round } from '../engine/simulation'
import type { PromptFactors } from './prompt'
import { ZERO_FACTORS } from './prompt'

export type QualityFailureKind =
  | 'misunderstood'
  | 'wrong-tool'
  | 'bad-arguments'
  | 'hallucination'
  | 'lost-state'
  | 'missed-escalation'
  | 'over-escalation'

export const FAILURE_META: Record<
  QualityFailureKind,
  { label: string; whatCallerSees: string; whyItHappens: string; costsYou: string }
> = {
  misunderstood: {
    label: 'Misunderstood',
    whatCallerSees: 'The agent answers a different question, or asks them to repeat themselves.',
    whyItHappens:
      'The transcript was wrong in a way that changed the meaning. Nothing downstream of recognition can recover this — the agent is reasoning correctly about the wrong sentence.',
    costsYou: 'A turn, sometimes two. Recoverable, and the most visible failure, which makes it the one people over-index on.',
  },
  'wrong-tool': {
    label: 'Wrong tool chosen',
    whatCallerSees: 'An answer about something adjacent — a return when they asked about delivery.',
    whyItHappens:
      'Two tool descriptions overlapped, or the descriptions said what the tools do without saying when not to use them. Tool selection is a disambiguation problem, not a comprehension one.',
    costsYou: 'A wrong action, sometimes a state change. Usually caught by the caller, occasionally not.',
  },
  'bad-arguments': {
    label: 'Right tool, wrong arguments',
    whatCallerSees: 'Nothing wrong at all — until the wrong order is cancelled or the wrong date is booked.',
    whyItHappens:
      'A misheard identifier passed straight through, or an argument format the prompt never pinned down. The tool call succeeds, which is exactly why this is the expensive one.',
    costsYou: 'The most expensive failure in the list. It is silent, it mutates state, and it is discovered by the customer.',
  },
  hallucination: {
    label: 'Answered without evidence',
    whatCallerSees: 'A confident, specific, wrong answer. A delivery date that was never looked up.',
    whyItHappens:
      'The prompt asked the agent to be helpful and never told it what to do when it does not know. Under a "be helpful" instruction, inventing is the locally correct move.',
    costsYou: 'Trust, and occasionally a refund. This is the failure people mean when they say they do not trust AI on the phone.',
  },
  'lost-state': {
    label: 'Forgot what it was told',
    whatCallerSees: 'Being asked for their order number a second time.',
    whyItHappens:
      'The turn carrying the fact fell out of the context window, or the prompt never said to carry confirmed facts forward. Usually a context-strategy bug wearing a prompt costume.',
    costsYou: 'A turn, and a lot of goodwill. Callers read it — correctly — as not being listened to.',
  },
  'missed-escalation': {
    label: 'Should have transferred, did not',
    whatCallerSees: 'Being kept in a loop they have already failed twice.',
    whyItHappens: 'No named escalation triggers, so the model decides case by case, and its default is to keep trying.',
    costsYou: 'The angriest calls you will ever review, and the ones that end up on social media.',
  },
  'over-escalation': {
    label: 'Transferred unnecessarily',
    whatCallerSees: 'A hold queue for something the agent could have answered.',
    whyItHappens: 'Escalation defined only as a safety valve, with no counter-instruction about when not to use it.',
    costsYou: 'Your entire business case. An agent that escalates freely is a expensive phone menu.',
  },
}

export type ContextStrategy = 'full-history' | 'summarised' | 'last-n' | 'none'

export const CONTEXT_STRATEGIES: { id: ContextStrategy; label: string; note: string }[] = [
  {
    id: 'full-history',
    label: 'Replay the whole call every turn',
    note: 'Nothing is ever forgotten and every turn costs more than the last. Time-to-first-token grows through the call, so the agent gets slower the longer someone talks to it.',
  },
  {
    id: 'summarised',
    label: 'Summarise older turns, keep confirmed facts verbatim',
    note: 'The only strategy that holds up on long calls. Costs an extra model call off the critical path, and the summariser itself can drop a fact — so confirmed identifiers are kept verbatim, never summarised.',
  },
  {
    id: 'last-n',
    label: 'Keep the last few turns only',
    note: 'Cheap, predictable, and it will drop the order number the caller gave at the start of a long call. Fine for short transactional calls, actively wrong for anything that meanders.',
  },
  {
    id: 'none',
    label: 'No history — each turn stands alone',
    note: 'Not a real option for conversation, included because it makes the cost of memory visible. Every turn is a first turn.',
  },
]

export type ModelTier = 'small' | 'mid' | 'frontier'

export const MODEL_TIERS: { id: ModelTier; label: string; note: string }[] = [
  {
    id: 'small',
    label: 'Small / fast model',
    note: 'Lowest latency and cost. Follows simple instructions well, and is the first to invent an answer when the instructions run out.',
  },
  {
    id: 'mid',
    label: 'Mid-tier model',
    note: 'The usual production choice for voice: fast enough for a turn budget, reliable enough on tool selection.',
  },
  {
    id: 'frontier',
    label: 'Frontier model',
    note: 'Best reasoning and instruction-following, worst time-to-first-token. On voice, the latency is often the deciding factor rather than the quality.',
  },
]

export interface QualityConfig {
  factors: PromptFactors
  modelTier: ModelTier
  contextStrategy: ContextStrategy
  /** Turns retained by the last-n strategy. */
  contextTurns: number
  /** Word error rate arriving from recognition. */
  wer: number
  /** Whether the tool catalogue contains near-duplicate functions. */
  overlappingTools: boolean
  /** Sampling temperature. Higher = more variation, more invention. */
  temperature: number
  seed: string
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  factors: { ...ZERO_FACTORS, clarity: 0.3 },
  modelTier: 'mid',
  contextStrategy: 'last-n',
  contextTurns: 4,
  wer: 0.09,
  overlappingTools: true,
  temperature: 0.7,
  seed: 'quality-1',
}

// ---------------------------------------------------------------------------
// The case library
// ---------------------------------------------------------------------------

export interface TurnCase {
  id: string
  /** What the caller says. */
  utterance: string
  /** What correct handling looks like, in one line. */
  expected: string
  /** Tool the turn should call, if any. */
  tool?: string
  /** True when a near-identical tool exists and could be confused with it. */
  ambiguousTool?: boolean
  /** True when the turn contains an identifier that recognition can mangle. */
  carriesIdentifier?: boolean
  /** Turn index in the call at which the needed fact was first given. */
  statedAtTurn?: number
  /** Turn index this case occurs at. */
  atTurn: number
  /** True when the correct action is to transfer to a human. */
  shouldEscalate?: boolean
  /** True when the request is outside the agent's stated scope. */
  outOfScope?: boolean
  /** True when getting this wrong changes stored state rather than just a reply. */
  mutating?: boolean
  /** Which part of the system this case is really probing. */
  probes: string
}

export const TURN_CASES: TurnCase[] = [
  {
    id: 'status-simple',
    utterance: 'Where is my order five five three seven?',
    expected: 'Read the id back, call lookup_order with 5537, state the status in one sentence.',
    tool: 'lookup_order',
    carriesIdentifier: true,
    atTurn: 1,
    probes: 'The happy path, and whether an identifier survives recognition intact.',
  },
  {
    id: 'status-partial-id',
    utterance: 'Where is order five five three?',
    expected: 'Notice the id is three digits, not four, and ask for the missing digit. Do not guess.',
    tool: 'lookup_order',
    carriesIdentifier: true,
    atTurn: 1,
    probes: 'Whether the tool contract specified a format, and whether the agent checks input before acting.',
  },
  {
    id: 'reschedule',
    utterance: 'Can you move that delivery to Thursday?',
    expected: 'Reuse the order id from earlier in the call, confirm which Thursday, then call reschedule_delivery.',
    tool: 'reschedule_delivery',
    ambiguousTool: true,
    statedAtTurn: 1,
    atTurn: 5,
    mutating: true,
    probes: 'Memory across turns, plus a relative date that has to become an absolute one.',
  },
  {
    id: 'return-reason',
    utterance: 'It showed up smashed, I want my money back.',
    expected: 'Map "smashed" to the damaged reason code, confirm the order, call start_return.',
    tool: 'start_return',
    ambiguousTool: true,
    statedAtTurn: 1,
    atTurn: 6,
    mutating: true,
    probes: 'Whether a free-form reason gets mapped to a constrained enum, or invented.',
  },
  {
    id: 'no-tool-needed',
    utterance: 'What are your delivery hours?',
    expected: 'Answer from the prompt if it is stated there; otherwise say you do not have that and offer to transfer. Do not call a tool.',
    atTurn: 3,
    probes: 'Whether the agent calls a tool because tools exist, and whether it invents an answer when it has none.',
  },
  {
    id: 'out-of-scope',
    utterance: 'Why is your delivery fee more expensive than it was last year?',
    expected: 'Say this is outside what you can help with, then offer a transfer. Do not speculate about pricing.',
    outOfScope: true,
    atTurn: 4,
    probes: 'The scope boundary — and whether "be helpful" overrides it.',
  },
  {
    id: 'repeat-identifier',
    utterance: 'So what is happening with it?',
    expected: 'Use the order id already confirmed earlier. Do not ask for it again.',
    tool: 'lookup_order',
    statedAtTurn: 1,
    atTurn: 7,
    probes: 'Context strategy, directly. This is the case last-n drops on a long call.',
  },
  {
    id: 'angry-escalate',
    utterance: 'This is the third time I have called about this. Get me a person.',
    expected: 'Transfer immediately, and hand over what has already been established.',
    shouldEscalate: true,
    atTurn: 5,
    probes: 'The explicit escalation request — the easy half of escalation.',
  },
  {
    id: 'stuck-escalate',
    utterance: 'No, that is still not right. It is not what I said.',
    expected: 'Recognise the second consecutive failure and offer a person rather than trying a third time.',
    shouldEscalate: true,
    atTurn: 6,
    probes: 'The hard half of escalation: nobody asked, but the call has failed.',
  },
  {
    id: 'simple-answerable',
    utterance: 'Sorry, can you say that again?',
    expected: 'Repeat the last statement more briefly. Do not transfer, do not call a tool.',
    atTurn: 4,
    probes: 'Over-escalation and over-tooling on a turn that needs neither.',
  },
  {
    id: 'code-switch',
    utterance: 'मेरा order कहाँ है — five five three seven',
    expected: 'Handle the mixed-language sentence, extract the identifier, call lookup_order.',
    tool: 'lookup_order',
    carriesIdentifier: true,
    atTurn: 1,
    probes: 'Whether code-switching was designed for, or configured away.',
  },
  {
    id: 'high-value-mutation',
    utterance: 'Just cancel the whole thing and refund me, it was forty thousand rupees.',
    expected: 'Confirm explicitly before any mutation, and escalate because the amount is over the threshold.',
    tool: 'start_return',
    shouldEscalate: true,
    mutating: true,
    atTurn: 8,
    probes: 'Whether high-value actions have a different path from ordinary ones.',
  },
]

// ---------------------------------------------------------------------------
// Running the model
// ---------------------------------------------------------------------------

export interface TurnOutcome {
  case: TurnCase
  ok: boolean
  failure: QualityFailureKind | null
  /** Why this turn went the way it did, citing the factor that drove it. */
  explanation: string
  /** The probability the model assigned to this failure, for inspection. */
  probability: number
}

export interface QualityRun {
  outcomes: TurnOutcome[]
  turnsWrong: number
  /** Share of turns that went wrong, 0..1. */
  failureRate: number
  byKind: Record<QualityFailureKind, number>
  /** Failures that silently changed state — the ones that cost real money. */
  silentMutations: number
  seed: string
}

const TIER_SKILL: Record<ModelTier, number> = { small: 0.45, mid: 0.72, frontier: 0.9 }

/**
 * Probability that a given case fails, and in which way.
 *
 * Each kind gets its own probability from the factors that actually drive it.
 * They are evaluated in order of how early in the turn they occur, because a
 * misunderstanding upstream makes everything downstream moot — a turn that was
 * misheard is not also independently a tool-selection failure.
 */
function failureProbabilities(c: TurnCase, cfg: QualityConfig): { kind: QualityFailureKind; p: number; why: string }[] {
  const skill = TIER_SKILL[cfg.modelTier]
  const f = cfg.factors
  const out: { kind: QualityFailureKind; p: number; why: string }[] = []

  // 1. Misunderstanding — driven by recognition, mitigated by read-back.
  if (c.carriesIdentifier || c.id === 'code-switch') {
    // An identifier is several tokens; any one of them being wrong ruins it.
    const tokensAtRisk = 4
    const raw = 1 - Math.pow(1 - cfg.wer, tokensAtRisk)
    const p = raw * (1 - f.guardrails * 0.8)
    out.push({
      kind: 'misunderstood',
      p,
      why: `A ${(cfg.wer * 100).toFixed(1)}% word error rate across ~${tokensAtRisk} identifier tokens gives a ${(raw * 100).toFixed(
        0,
      )}% chance at least one is wrong. ${
        f.guardrails > 0.5
          ? 'Mandatory read-back catches most of those before they reach a tool.'
          : 'Nothing in the prompt asks the agent to confirm what it heard, so the error passes straight through.'
      }`,
    })
  } else {
    const p = cfg.wer * 0.6 * (1 - skill * 0.5)
    out.push({
      kind: 'misunderstood',
      p,
      why: 'Ordinary words are more redundant than identifiers — a model can often recover the meaning of a sentence with one word wrong.',
    })
  }

  // 2. Tool selection — driven by tool documentation and catalogue overlap.
  if (c.tool) {
    const ambiguity = (c.ambiguousTool ? 0.25 : 0.08) + (cfg.overlappingTools ? 0.12 : 0)
    const p = ambiguity * (1 - f.toolGrounding * 0.85) * (1 - (skill - 0.45) * 0.4)
    out.push({
      kind: 'wrong-tool',
      p,
      why: `${c.ambiguousTool ? 'This case has a near-neighbour tool. ' : ''}${
        cfg.overlappingTools ? 'The catalogue contains overlapping functions. ' : 'The catalogue is clean. '
      }${
        f.toolGrounding > 0.6
          ? 'The tool contract says when NOT to call each one, which is what actually prevents this.'
          : 'The tools are described by what they do, not by when to use them — descriptions alone do not disambiguate.'
      }`,
    })

    // 3. Bad arguments — the silent one.
    const argRisk = (c.carriesIdentifier ? cfg.wer * 2.2 : 0.06) + (c.mutating ? 0.05 : 0)
    const p2 = argRisk * (1 - f.toolGrounding * 0.5) * (1 - f.guardrails * 0.7)
    out.push({
      kind: 'bad-arguments',
      p: p2,
      why: `${
        c.carriesIdentifier
          ? 'The argument comes straight from a transcript that can be wrong.'
          : 'The argument has to be derived rather than copied.'
      } ${
        f.guardrails > 0.5
          ? 'Read-back before the call is the mitigation, and it is working here.'
          : 'With no confirmation step, a wrong argument produces a successful call and a wrong outcome.'
      }`,
    })
  }

  // 4. Hallucination — driven by guardrails, scope and temperature.
  if (!c.tool || c.outOfScope) {
    const base = c.outOfScope ? 0.35 : 0.22
    const p = base * (1 - f.guardrails * 0.85) * (1 - f.clarity * 0.5) * (0.7 + cfg.temperature * 0.5)
    out.push({
      kind: 'hallucination',
      p,
      why: `${
        c.outOfScope ? 'The request is outside scope, which is where invention is most tempting. ' : 'There is no tool that answers this. '
      }${
        f.guardrails > 0.6
          ? 'An explicit "never state a fact you did not receive from a tool" is the instruction that prevents it.'
          : 'Without an explicit instruction to say "I do not know", a helpful model fills the gap.'
      } Temperature ${cfg.temperature.toFixed(1)} ${cfg.temperature > 0.8 ? 'widens' : 'narrows'} the range of things it might fill it with.`,
    })
  }

  // 5. Lost state — driven by the context strategy, not the prompt.
  if (c.statedAtTurn !== undefined) {
    const gap = c.atTurn - c.statedAtTurn
    let p: number
    let why: string
    switch (cfg.contextStrategy) {
      case 'none':
        p = 0.95
        why = 'With no history at all, a fact from an earlier turn simply does not exist.'
        break
      case 'last-n':
        p = gap >= cfg.contextTurns ? 0.85 : 0.05
        why =
          gap >= cfg.contextTurns
            ? `The fact was given ${gap} turns ago and only the last ${cfg.contextTurns} are kept. It is gone, and no prompt instruction can recover it.`
            : `The fact was given ${gap} turns ago and the last ${cfg.contextTurns} turns are kept, so it is still in context.`
        break
      case 'summarised':
        p = 0.12
        why = 'Summarisation keeps confirmed facts verbatim; the residual risk is the summariser dropping something it judged unimportant.'
        break
      default:
        p = 0.03
        why = 'Full history means the fact is present. The cost shows up in time-to-first-token, not in accuracy.'
    }
    p *= 1 - f.stateDiscipline * 0.4
    out.push({ kind: 'lost-state', p, why })
  }

  // 6. Escalation, both directions.
  if (c.shouldEscalate) {
    const explicit = c.id === 'angry-escalate'
    const base = explicit ? 0.12 : 0.45
    const p = base * (1 - f.escalationClarity * 0.9)
    out.push({
      kind: 'missed-escalation',
      p,
      why: explicit
        ? 'The caller asked outright, which even a vague policy usually catches.'
        : `Nobody asked for a human — the call has simply failed twice. ${
            f.escalationClarity > 0.6
              ? 'A named "same request failed twice" trigger catches this.'
              : 'Without a named trigger for repeated failure, the model keeps trying, because trying again is what helpfulness looks like from inside the turn.'
          }`,
    })
  } else if (!c.tool) {
    const p = 0.16 * (1 - f.escalationClarity * 0.8) * (1 - f.clarity * 0.4)
    out.push({
      kind: 'over-escalation',
      p,
      why:
        f.escalationClarity > 0.6
          ? 'The policy says when *not* to transfer, which is the half people forget to write.'
          : 'Escalation is defined only as a safety valve, so anything unfamiliar becomes a transfer. This is how an agent becomes an expensive phone menu.',
    })
  }

  return out
}

export function runQuality(cfg: QualityConfig, cases: TurnCase[] = TURN_CASES): QualityRun {
  const outcomes: TurnOutcome[] = []
  const byKind = {
    misunderstood: 0,
    'wrong-tool': 0,
    'bad-arguments': 0,
    hallucination: 0,
    'lost-state': 0,
    'missed-escalation': 0,
    'over-escalation': 0,
  } as Record<QualityFailureKind, number>
  let silentMutations = 0

  for (const c of cases) {
    // Fork per case so adding a case does not shift every other case's draw.
    const rng = new Rng(`${cfg.seed}:${c.id}`)
    const probs = failureProbabilities(c, cfg)
    let failure: QualityFailureKind | null = null
    let explanation = ''
    let probability = 0

    for (const p of probs) {
      if (rng.chance(p.p)) {
        failure = p.kind
        explanation = p.why
        probability = p.p
        break
      }
    }

    if (failure) {
      byKind[failure]++
      if (c.mutating && (failure === 'bad-arguments' || failure === 'wrong-tool')) silentMutations++
    } else {
      const worst = probs.reduce((a, b) => (a.p >= b.p ? a : b), probs[0])
      probability = worst?.p ?? 0
      explanation = worst
        ? `Handled correctly. The closest thing to a risk here was ${FAILURE_META[worst.kind].label.toLowerCase()} at about ${(
            worst.p * 100
          ).toFixed(0)}%. ${worst.why}`
        : 'Handled correctly; this case has no modelled failure path.'
    }

    outcomes.push({ case: c, ok: !failure, failure, explanation, probability })
  }

  const turnsWrong = outcomes.filter((o) => !o.ok).length
  return {
    outcomes,
    turnsWrong,
    failureRate: round(turnsWrong / Math.max(1, outcomes.length), 4),
    byKind,
    silentMutations,
    seed: cfg.seed,
  }
}

/**
 * Expected failure rate without sampling — the analytic companion to runQuality.
 *
 * A single seeded run tells you what happened on twelve turns; this tells you
 * what the configuration is actually worth. Both matter: the run is what a
 * learner reads, the expectation is what a comparison should be judged on,
 * because comparing two configurations on one seed each compares the seeds.
 */
export function expectedFailureRate(cfg: QualityConfig, cases: TurnCase[] = TURN_CASES): number {
  let total = 0
  for (const c of cases) {
    const probs = failureProbabilities(c, cfg)
    // Probability that at least one failure fires, in evaluation order.
    let survive = 1
    for (const p of probs) survive *= 1 - Math.max(0, Math.min(1, p.p))
    total += 1 - survive
  }
  return round(total / Math.max(1, cases.length), 4)
}

/** Per-kind expected contribution, for the "where does quality actually go" chart. */
export function expectedByKind(cfg: QualityConfig, cases: TurnCase[] = TURN_CASES): Record<QualityFailureKind, number> {
  const acc = {
    misunderstood: 0,
    'wrong-tool': 0,
    'bad-arguments': 0,
    hallucination: 0,
    'lost-state': 0,
    'missed-escalation': 0,
    'over-escalation': 0,
  } as Record<QualityFailureKind, number>
  for (const c of cases) {
    const probs = failureProbabilities(c, cfg)
    let reach = 1
    for (const p of probs) {
      const clamped = Math.max(0, Math.min(1, p.p))
      acc[p.kind] += reach * clamped
      reach *= 1 - clamped
    }
  }
  for (const k of Object.keys(acc) as QualityFailureKind[]) acc[k] = round(acc[k] / Math.max(1, cases.length), 4)
  return acc
}

/** Exposed for the inspector: why this case has the risk profile it has. */
export function explainCase(c: TurnCase, cfg: QualityConfig) {
  return failureProbabilities(c, cfg).map((p) => ({
    kind: p.kind,
    label: FAILURE_META[p.kind].label,
    probability: round(p.p, 4),
    why: p.why,
  }))
}
