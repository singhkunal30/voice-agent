/**
 * Architecture pressure testing.
 *
 * A design is not "good"; it is good *for a set of conditions*. Every
 * architecture in this simulator was chosen under assumptions its author
 * probably never wrote down — that traffic stays near today's peak, that the
 * speech vendor stays up, that one language is enough, that the database
 * answers in 20 ms. Pressure testing is the act of removing one of those
 * assumptions and seeing what is left.
 *
 * Each test takes the working architecture plus its requirements, applies one
 * named change, and re-runs the *existing* models — capacity from
 * models/scaling, the latency waterfall from models/latency, unit economics
 * from models/cost, structural rules from validation/rules. Nothing here is a
 * second opinion about those models; it is the same models asked a harder
 * question.
 *
 * The verdict is deliberately coarse:
 *
 *   holds    — absorbs the change with no structural work
 *   degrades — survives, but misses a stated target, or costs a redesign of
 *              something that is not the architecture (staffing, budget)
 *   breaks   — needs a different shape, not a bigger one
 *
 * "Bigger" and "different" is the distinction that matters. Adding replicas is
 * a purchase order. Moving session state out of process memory is a project.
 */

import type { Architecture, Requirements, RegionId } from '../domain/types'
import { getSpec } from '../registry/components'
import { computeResources, detectBottlenecks, INTER_REGION_MS } from './scaling'
import { computeLatency, DEFAULT_LATENCY_PARAMS } from './latency'
import { computeCost, DEFAULT_COST_INPUTS } from './cost'
import { validateArchitecture } from '../validation/rules'
import { round } from '../engine/simulation'

export type PressureId =
  | 'traffic-10x'
  | 'provider-outage'
  | 'latency-increase'
  | 'budget-cut'
  | 'new-language'
  | 'availability-up'
  | 'more-handoffs'
  | 'regional-expansion'
  | 'db-slowdown'
  | 'queue-saturation'

export type PressureVerdict = 'holds' | 'degrades' | 'breaks'

export interface PressureTest {
  id: PressureId
  name: string
  /** The single change this test applies. */
  change: string
  /** The real-world event that causes it. */
  trigger: string
  /** What the test is really probing for. */
  probes: string
}

export interface PressureFinding {
  severity: PressureVerdict
  title: string
  /** What the model observed, with the numbers that moved. */
  detail: string
  /** The concrete change that would survive this pressure. */
  remedy: string
  /** Node ids to highlight on the canvas. */
  targets: string[]
}

export interface PressureDelta {
  label: string
  before: string
  after: string
  /** True when the change moved in the wrong direction. */
  worse: boolean
}

export interface PressureResult {
  test: PressureTest
  verdict: PressureVerdict
  /** One sentence a learner could repeat to a colleague. */
  headline: string
  findings: PressureFinding[]
  deltas: PressureDelta[]
  /** The requirements as this pressure rewrote them. */
  stressed: Requirements
}

export const PRESSURE_TESTS: PressureTest[] = [
  {
    id: 'traffic-10x',
    name: '10× the traffic',
    change: 'Peak concurrent calls and daily volume both multiply by ten.',
    trigger: 'A marketing campaign lands, a competitor goes down, or the product simply works.',
    probes: 'Whether growth is a purchase order or a rewrite. Connection-bound components and single instances decide which.',
  },
  {
    id: 'provider-outage',
    name: 'The speech vendor goes down',
    change: 'The primary STT provider returns errors for every request, for an hour.',
    trigger: 'A regional outage at a vendor you do not control, during your busiest hour.',
    probes: 'Whether a single external dependency can take the whole product with it.',
  },
  {
    id: 'latency-increase',
    name: 'Every provider hop gets 150 ms slower',
    change: 'Server → provider round trips grow by 150 ms one way.',
    trigger: 'A vendor moves a region, a peering route changes, or a model gets bigger.',
    probes: 'How much of the latency budget was actually headroom, and which stages were hiding inside others.',
  },
  {
    id: 'budget-cut',
    name: 'The budget is cut by 40%',
    change: 'Cost per call must fall to 60% of today with the same call volume.',
    trigger: 'A funding round that did not happen, or a margin target that did.',
    probes: 'Whether you know which line item actually dominates, and what quality you are willing to trade.',
  },
  {
    id: 'new-language',
    name: 'A second language is required',
    change: 'Hindi is added alongside English, with code-switching mid-sentence.',
    trigger: 'Expansion into a market where people simply do not speak one language at a time.',
    probes: 'Whether language was a configuration value or a structural assumption.',
  },
  {
    id: 'availability-up',
    name: 'Availability target rises to 99.99%',
    change: 'The allowed downtime drops from ~43 minutes a month to ~4.',
    trigger: 'An enterprise contract with a penalty clause attached.',
    probes: 'Whether any single component on the critical path caps your availability below the new target.',
  },
  {
    id: 'more-handoffs',
    name: 'Escalations triple',
    change: 'The share of calls handed to a human rises from 10% to 30%.',
    trigger: 'A product change, a bad model update, or a class of question the agent was never able to answer.',
    probes: 'Whether the human tier was sized as infrastructure (it is not — it is hiring).',
  },
  {
    id: 'regional-expansion',
    name: 'A second region is required',
    change: 'Calls must be served from a region on the other side of the world.',
    trigger: 'A customer in another market, or a data-residency clause.',
    probes: 'Whether session state and media termination assumed a single region.',
  },
  {
    id: 'db-slowdown',
    name: 'The database gets 40× slower',
    change: 'Tool-backing queries go from ~20 ms to ~800 ms at p99.',
    trigger: 'A missing index, a table that grew, or a noisy neighbour.',
    probes: 'Whether slow backend calls stall the conversation or get covered.',
  },
  {
    id: 'queue-saturation',
    name: 'The async queue backs up',
    change: 'Consumers fall behind; queue depth grows without bound for 20 minutes.',
    trigger: 'A downstream CRM rate-limits you, or a consumer deploy goes wrong.',
    probes: 'Whether "asynchronous" was real, or a synchronous write with a queue-shaped name.',
  },
]

export function getPressureTest(id: PressureId): PressureTest {
  const t = PRESSURE_TESTS.find((p) => p.id === id)
  if (!t) throw new Error(`Unknown pressure test: ${id}`)
  return t
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function has(arch: Architecture, specId: string): boolean {
  return arch.nodes.some((n) => n.specId === specId)
}

function nodesOf(arch: Architecture, specId: string): string[] {
  return arch.nodes.filter((n) => n.specId === specId).map((n) => n.id)
}

/**
 * Assumed per-component availability.
 *
 * ASSUMPTION, and a crude one: real availability depends on the operator, not
 * the component type. The point it teaches is nonetheless exact — availability
 * on a serial critical path multiplies, so the weakest single hop caps the
 * whole system no matter how good everything else is.
 */
function availabilityOf(specId: string, replicas: number): number {
  const spec = getSpec(specId)
  const base = (() => {
    switch (spec.scaling.axis) {
      case 'single-instance':
        return 0.99
      case 'vertical':
        return 0.995
      case 'managed-external':
        return 0.999
      case 'partitioned':
        return 0.999
      case 'connection-aware':
        return 0.998
      default:
        return 0.999
    }
  })()
  if (replicas <= 1) return base
  // Redundancy removes failure probability geometrically, but only down to a
  // floor: shared fate (one region, one control plane, one bad deploy) is not
  // removed by adding replicas, and pretending otherwise is how people promise
  // five nines on top of a single availability zone.
  const redundant = 1 - Math.pow(1 - base, Math.min(replicas, 3))
  return Math.min(redundant, 0.99995)
}

/** Components that sit on the serial critical path of a live turn. */
function criticalPathNodes(arch: Architecture) {
  return arch.nodes.filter((n) => {
    const spec = getSpec(n.specId)
    return spec.onMediaPath && spec.category !== 'endpoint' && spec.category !== 'human'
  })
}

function compositeAvailability(arch: Architecture): { value: number; weakest: { id: string; label: string; value: number } | null } {
  let product = 1
  let weakest: { id: string; label: string; value: number } | null = null
  for (const n of criticalPathNodes(arch)) {
    const a = availabilityOf(n.specId, n.replicas)
    product *= a
    if (!weakest || a < weakest.value) weakest = { id: n.id, label: n.label, value: a }
  }
  return { value: product, weakest }
}

function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`
}

function verdictOf(findings: PressureFinding[]): PressureVerdict {
  if (findings.some((f) => f.severity === 'breaks')) return 'breaks'
  if (findings.some((f) => f.severity === 'degrades')) return 'degrades'
  return 'holds'
}

/** Cost inputs derived from requirements, so the pressure tests and the Cost Lab agree. */
export function costInputsFor(req: Requirements) {
  return {
    ...DEFAULT_COST_INPUTS,
    callsPerDay: req.callsPerDay,
    avgCallMinutes: req.avgCallSeconds / 60,
    peakConcurrent: req.peakConcurrentCalls,
    recordingEnabled: req.recording,
    turnsPerCall: Math.max(2, Math.round(req.avgCallSeconds / 30)),
  }
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

export function runPressureTest(arch: Architecture, req: Requirements, id: PressureId): PressureResult {
  const test = getPressureTest(id)
  switch (id) {
    case 'traffic-10x':
      return traffic10x(arch, req, test)
    case 'provider-outage':
      return providerOutage(arch, req, test)
    case 'latency-increase':
      return latencyIncrease(arch, req, test)
    case 'budget-cut':
      return budgetCut(arch, req, test)
    case 'new-language':
      return newLanguage(arch, req, test)
    case 'availability-up':
      return availabilityUp(arch, req, test)
    case 'more-handoffs':
      return moreHandoffs(arch, req, test)
    case 'regional-expansion':
      return regionalExpansion(arch, req, test)
    case 'db-slowdown':
      return dbSlowdown(arch, req, test)
    case 'queue-saturation':
      return queueSaturation(arch, req, test)
  }
}

export function runAllPressureTests(arch: Architecture, req: Requirements): PressureResult[] {
  return PRESSURE_TESTS.map((t) => runPressureTest(arch, req, t.id))
}

// --- 1. 10× traffic --------------------------------------------------------

function traffic10x(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const before = req.peakConcurrentCalls
  const after = before * 10
  const stressed: Requirements = {
    ...req,
    peakConcurrentCalls: after,
    callsPerDay: req.callsPerDay * 10,
    peakCallsPerMinute: req.peakCallsPerMinute * 10,
  }

  const nowBottlenecks = detectBottlenecks(arch, before)
  const thenBottlenecks = detectBottlenecks(arch, after)
  const findings: PressureFinding[] = []

  for (const b of thenBottlenecks) {
    const node = arch.nodes.find((n) => n.id === b.nodeId)
    const axis = node ? getSpec(node.specId).scaling.axis : 'stateless-horizontal'
    const structural = axis === 'single-instance' || axis === 'vertical'
    findings.push({
      severity: structural ? 'breaks' : b.severity === 'critical' ? 'degrades' : 'degrades',
      title: `${b.label} is at ${Math.round(b.utilisation * 100)}% of capacity`,
      detail: `${b.offered} concurrent calls offered against ${b.capacity} of capacity. ${b.why}`,
      remedy: structural
        ? `${b.label} scales ${axis === 'single-instance' ? 'not at all' : 'only by getting a bigger box'}. Ten times the traffic is not a replica count here — it is a different component or a partitioning scheme. ${b.remedies[0] ?? ''}`
        : `Horizontally scalable: raise the replica count and make sure the autoscaler leads demand by its warmup time. ${b.remedies[0] ?? ''}`,
      targets: [b.nodeId],
    })
  }

  // Structural readiness, independent of today's utilisation.
  if (arch.nodes.length > 1 && !has(arch, 'load-balancer') && after > 25) {
    findings.push({
      severity: 'breaks',
      title: 'No load balancer, but more than one machine is now required',
      detail: `At ${after} concurrent calls this cannot be one box. Something has to place new calls onto healthy backends and stop placing them onto sick ones.`,
      remedy: 'Add a load balancer in front of the media tier, and remember it spreads *connections*, not requests — a voice LB balances a distribution of long-lived sessions, so even placement does not mean even load.',
      targets: [],
    })
  }
  if (!has(arch, 'redis') && after > 25) {
    findings.push({
      severity: 'breaks',
      title: 'Session state has nowhere to live once there is more than one server',
      detail: 'With the call\'s state in process memory, any server that dies takes its live calls with it and no other server can adopt them. That is survivable on one box; at this scale it is a daily event.',
      remedy: 'Move session state to an external store (Redis in this catalogue) so any runtime instance can adopt any call. This is the single biggest structural change between one server and many.',
      targets: [],
    })
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'holds',
      title: 'Nothing saturates at ten times the load',
      detail: `Every component stays under capacity at ${after} concurrent calls. The fleet is either genuinely elastic or was sized with a great deal of headroom.`,
      remedy: 'Check the cost of that headroom next — an architecture that never saturates is often one that is being paid for ten times over.',
      targets: [],
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'Ten times the traffic needs a different architecture, not a bigger one.'
        : verdict === 'degrades'
          ? 'Ten times the traffic is survivable, but only by buying capacity that is not there today.'
          : 'This design absorbs ten times the traffic without a structural change.',
    findings,
    deltas: [
      { label: 'Peak concurrent calls', before: before.toLocaleString(), after: after.toLocaleString(), worse: true },
      {
        label: 'Components over 85% utilisation',
        before: String(nowBottlenecks.length),
        after: String(thenBottlenecks.length),
        worse: thenBottlenecks.length > nowBottlenecks.length,
      },
    ],
    stressed,
  }
}

// --- 2. Provider outage ----------------------------------------------------

function providerOutage(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const findings: PressureFinding[] = []
  const sttNodes = nodesOf(arch, 'stt')
  const s2sNodes = nodesOf(arch, 's2s')
  const ttsNodes = nodesOf(arch, 'tts')
  const llmNodes = nodesOf(arch, 'llm')

  const speechPaths = sttNodes.length + s2sNodes.length

  if (speechPaths === 0) {
    findings.push({
      severity: 'breaks',
      title: 'There is no speech recognition in this design at all',
      detail: 'A vendor outage is not the problem here — there is no vendor. Add recognition before testing what happens when it fails.',
      remedy: 'Add an STT component, or a speech-to-speech model that subsumes it.',
      targets: [],
    })
  } else if (speechPaths === 1) {
    findings.push({
      severity: 'breaks',
      title: 'One recognition path, no alternative',
      detail: `Every call routes through a single ${sttNodes.length ? 'STT' : 'speech-to-speech'} component. When it returns errors, 100% of calls lose the ability to understand the caller. Replicas do not help: the failure is at the vendor, not at your instance count.`,
      remedy: 'Add a second recognition provider with different infrastructure and a circuit breaker in front of both. The fallback does not have to be as good — it has to be different, and it has to be wired up before the outage, because that is not the hour to discover the API shape.',
      targets: sttNodes.concat(s2sNodes),
    })
  } else {
    findings.push({
      severity: 'holds',
      title: `${speechPaths} independent recognition paths`,
      detail: 'A single vendor outage costs quality, not availability, provided the breaker actually trips and the fallback is warm.',
      remedy: 'Verify the fallback is exercised regularly. An untested fallback path is an outage with extra steps — the failure mode is usually a stale credential or a format mismatch, both of which only appear under load.',
      targets: sttNodes.concat(s2sNodes),
    })
  }

  for (const [label, nodes] of [
    ['Text-to-speech', ttsNodes],
    ['Language model', llmNodes],
  ] as const) {
    if (nodes.length === 1) {
      findings.push({
        severity: 'degrades',
        title: `${label}: single provider`,
        detail: `${label} has one path. An outage there is not as total as losing recognition — the agent can still hear — but it cannot answer, which the caller experiences as the same thing.`,
        remedy: `Add a second ${label.toLowerCase()} provider, or at minimum a pre-rendered holding message and an escalation path so the call ends with a human rather than silence.`,
        targets: nodes,
      })
    }
  }

  if (!has(arch, 'human-agent') && req.humanHandoff) {
    findings.push({
      severity: 'degrades',
      title: 'Human handoff is required but no human tier exists',
      detail: 'Escalation is the fallback of last resort when every automated path is failing. The requirements ask for it; the architecture has nowhere to send the call.',
      remedy: 'Add a human agent tier and a transfer path, then decide what happens when nobody is available — that is the case that actually occurs during a vendor outage, because everyone escalates at once.',
      targets: [],
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'A single vendor outage takes every call with it.'
        : verdict === 'degrades'
          ? 'Recognition survives a vendor outage; something else on the path does not.'
          : 'A vendor outage costs quality here, not availability.',
    findings,
    deltas: [
      { label: 'Recognition paths', before: String(speechPaths), after: String(Math.max(0, speechPaths - 1)), worse: true },
      { label: 'Calls affected without a fallback', before: '0%', after: speechPaths <= 1 ? '100%' : '0%', worse: speechPaths <= 1 },
    ],
    stressed: req,
  }
}

// --- 3. Latency increase ---------------------------------------------------

function latencyIncrease(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const added = 150
  const base = {
    ...DEFAULT_LATENCY_PARAMS,
    budgetMs: req.latencyTargetMs,
  }
  const before = computeLatency(base)
  const after = computeLatency({ ...base, serverToProviderMs: base.serverToProviderMs + added })

  const findings: PressureFinding[] = []
  const overBy = after.perceivedLatencyMs - req.latencyTargetMs

  // How many external provider round trips sit on the critical path? That
  // multiplier is the whole lesson: a composed pipeline pays the added latency
  // once per hop, so the cost of distance scales with how many vendors a single
  // turn has to visit.
  const providerHops = ['stt', 'llm', 'tts', 's2s'].filter((id) => has(arch, id)).length
  const growth = after.perceivedLatencyMs - before.perceivedLatencyMs

  if (overBy > 0) {
    findings.push({
      severity: before.withinBudget ? 'degrades' : 'breaks',
      title: `Perceived latency lands ${Math.round(overBy)} ms over the ${req.latencyTargetMs} ms target`,
      detail: `Adding ${added} ms to one network hop added ${Math.round(growth)} ms to the perceived response, because this design visits ${providerHops} external provider${
        providerHops === 1 ? '' : 's'
      } on a single turn and crosses that hop for each of them. ${
        before.withinBudget
          ? 'There was enough headroom to be inside the budget before, and not enough to stay there.'
          : 'This design was already over budget before the pressure was applied.'
      }`,
      remedy:
        'Cut hops or cut the endpointing wait. Co-locating the runtime with the providers removes the hop entirely; a speech-to-speech model removes two of them. Trimming the silence timeout is the cheapest lever and the one that costs you interruptions.',
      targets: [],
    })
  } else {
    findings.push({
      severity: 'holds',
      title: `Still inside the ${req.latencyTargetMs} ms target with ${Math.round(-overBy)} ms to spare`,
      detail: `Perceived latency moved from ${Math.round(before.perceivedLatencyMs)} ms to ${Math.round(after.perceivedLatencyMs)} ms — ${Math.round(growth)} ms for ${added} ms of added one-way distance.`,
      remedy: 'Note where the headroom came from. If it is a short endpointing window, you are paying for this latency budget in interruptions instead of milliseconds.',
      targets: [],
    })
  }

  const gating = after.segments.reduce((a, b) => (a.ms >= b.ms ? a : b), after.segments[0])
  if (gating) {
    findings.push({
      severity: 'holds',
      title: `The largest single stage is now "${gating.label}" at ${Math.round(gating.ms)} ms`,
      detail: gating.explanation,
      remedy:
        gating.key === 'endpoint'
          ? 'Endpointing is a product decision disguised as a parameter: every millisecond you remove is a millisecond of thinking pause you will cut people off in.'
          : 'Optimising anything other than the largest stage is a rounding error. Start here.',
      targets: [],
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'This design was already over its latency target; the extra distance simply makes it obvious.'
        : verdict === 'degrades'
          ? 'The latency budget had no room for a vendor moving 150 ms further away.'
          : 'The latency budget absorbs an extra 150 ms per hop.',
    findings,
    deltas: [
      {
        label: 'Perceived latency',
        before: `${Math.round(before.perceivedLatencyMs)} ms`,
        after: `${Math.round(after.perceivedLatencyMs)} ms`,
        worse: true,
      },
      {
        label: `Within the ${req.latencyTargetMs} ms target`,
        before: before.withinBudget ? 'yes' : 'no',
        after: after.withinBudget ? 'yes' : 'no',
        worse: before.withinBudget && !after.withinBudget,
      },
    ],
    stressed: req,
  }
}

// --- 4. Budget cut ---------------------------------------------------------

function budgetCut(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const inputs = costInputsFor(req)
  const cost = computeCost(inputs)
  const target = cost.usdPerCall * 0.6

  const ranked = [...cost.lineItems].sort((a, b) => b.usdPerCall - a.usdPerCall)
  const top = ranked[0]
  const topShare = top ? top.usdPerCall / cost.usdPerCall : 0

  const findings: PressureFinding[] = []

  findings.push({
    severity: 'holds',
    title: `${top?.label ?? 'Nothing'} is ${Math.round(topShare * 100)}% of the bill`,
    detail: `At ${req.callsPerDay.toLocaleString()} calls/day, one call costs $${cost.usdPerCall.toFixed(4)}. The target is $${target.toFixed(4)}. ${
      top ? `${top.label}: ${top.basis}` : ''
    }`,
    remedy:
      topShare > 0.4
        ? `A single line item dominates, which is the easy case: a 40% cut is achievable by attacking ${top.label.toLowerCase()} alone, and everything else can be left where it is.`
        : 'No single line dominates, which is the hard case: a 40% cut means several simultaneous compromises rather than one clean decision.',
    targets: [],
  })

  // Levers that exist in *this* architecture.
  const levers: { label: string; saving: number; cost: string }[] = []
  if (inputs.recordingEnabled) {
    const withoutRecording = computeCost({ ...inputs, recordingEnabled: false })
    levers.push({
      label: 'Stop recording, or shorten retention',
      saving: cost.usdPerCall - withoutRecording.usdPerCall,
      cost: 'You lose the QA and dispute-resolution evidence, and possibly a compliance obligation. Check before you cut.',
    })
  }
  const leanerContext = computeCost({ ...inputs, llmInputTokensPerTurn: Math.round(inputs.llmInputTokensPerTurn * 0.5) })
  levers.push({
    label: 'Halve the prompt context carried on every turn',
    saving: cost.usdPerCall - leanerContext.usdPerCall,
    cost: 'Summarise older turns instead of replaying them. Costs some continuity on long calls, and it is the cheapest real lever in most voice agents because context is paid for on every single turn.',
  })
  const shorterCalls = computeCost({ ...inputs, avgCallMinutes: inputs.avgCallMinutes * 0.8 })
  levers.push({
    label: 'Cut average call length by 20%',
    saving: cost.usdPerCall - shorterCalls.usdPerCall,
    cost: 'Every per-minute line falls together: telephony, recognition, media compute. This is a product problem, not an infrastructure one.',
  })

  // Structural levers depend on what this architecture actually contains.
  const composed = has(arch, 'stt') && has(arch, 'tts') && has(arch, 'llm')
  if (composed && !has(arch, 's2s')) {
    findings.push({
      severity: 'holds',
      title: 'A structural lever exists: collapse three vendors into one',
      detail:
        'This design pays separate recognition, generation and synthesis bills on every turn. A speech-to-speech model replaces all three with one, which changes the shape of the bill rather than trimming it.',
      remedy:
        'Worth modelling, not worth assuming: it removes two network hops and two vendor relationships, and it takes away the ability to inspect or correct the transcript between them. Price both and compare on quality, not only on cost.',
      targets: [...nodesOf(arch, 'stt'), ...nodesOf(arch, 'tts'), ...nodesOf(arch, 'llm')],
    })
  }

  const best = levers.reduce((a, b) => (a.saving >= b.saving ? a : b), levers[0])
  const combined = levers.reduce((sum, l) => sum + l.saving, 0)
  const gap = cost.usdPerCall - target

  if (combined < gap) {
    findings.push({
      severity: 'breaks',
      title: 'Every available lever together does not reach the target',
      detail: `A 40% cut needs $${gap.toFixed(4)} per call. Pulling every lever in this architecture at once saves about $${combined.toFixed(4)}. The remainder has to come from a structurally different design.`,
      remedy:
        'Structural options: a smaller or self-hosted model, a speech-to-speech model that removes a whole vendor, or accepting a lower-quality voice. All three are visible trades, not efficiencies — decide which quality you are selling.',
      targets: [],
    })
  } else if (best && best.saving < gap) {
    findings.push({
      severity: 'degrades',
      title: 'No single change gets there; it takes several at once',
      detail: `The largest single lever (${best.label.toLowerCase()}) saves $${best.saving.toFixed(4)} of the $${gap.toFixed(4)} needed. Reaching the target means stacking compromises.`,
      remedy: 'Stack the cheapest-in-quality levers first and re-measure after each one. Write down what each one cost you in capability, because the person who asks why quality dropped will not remember asking for the cut.',
      targets: [],
    })
  } else if (best) {
    findings.push({
      severity: 'holds',
      title: `One change reaches the target: ${best.label.toLowerCase()}`,
      detail: `It saves $${best.saving.toFixed(4)} per call against a $${gap.toFixed(4)} gap. ${best.cost}`,
      remedy: 'Make the change, then re-run the cost model and confirm the dominant line item has actually moved rather than being replaced by the next one down.',
      targets: [],
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'A 40% cut is not reachable by tuning; it needs a different architecture.'
        : verdict === 'degrades'
          ? 'A 40% cut is reachable, but only by stacking several quality compromises.'
          : 'A 40% cut is reachable with one deliberate trade.',
    findings,
    deltas: [
      { label: 'Cost per call', before: `$${cost.usdPerCall.toFixed(4)}`, after: `$${target.toFixed(4)} (required)`, worse: true },
      {
        label: 'Monthly spend',
        before: `$${Math.round(cost.usdPerMonth).toLocaleString()}`,
        after: `$${Math.round(cost.usdPerMonth * 0.6).toLocaleString()} (required)`,
        worse: true,
      },
    ],
    stressed: req,
  }
}

// --- 5. New language -------------------------------------------------------

function newLanguage(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const findings: PressureFinding[] = []
  const alreadyMultilingual = req.languages.length > 1
  const stressed: Requirements = {
    ...req,
    languages: alreadyMultilingual ? req.languages : [...req.languages, 'hi-IN'],
  }

  findings.push({
    severity: alreadyMultilingual ? 'holds' : 'degrades',
    title: alreadyMultilingual
      ? `Already designed for ${req.languages.length} languages`
      : 'Language was a single fixed value in this design',
    detail: alreadyMultilingual
      ? `The requirements already name ${req.languages.join(', ')}, so the components were chosen with more than one locale in mind.`
      : `The requirements name only ${req.languages[0] ?? 'one language'}. Recognition accuracy, voice selection and prompt wording were all chosen for it, and all three change.`,
    remedy: alreadyMultilingual
      ? 'Confirm the recognition model handles code-switching rather than merely supporting both languages separately — those are different features, and real bilingual speakers use the first one.'
      : 'Decide where language is selected: per call from the dialled number, per call from an opening detection turn, or per utterance. Only the third survives real code-switching, and it is the most expensive.',
    targets: nodesOf(arch, 'stt'),
  })

  findings.push({
    severity: 'degrades',
    title: 'Code-switching is not two languages, it is a third problem',
    detail:
      'A caller who says "मेरा order कहाँ है" is speaking one sentence. A per-call language setting gets the English words wrong in Hindi mode and the Hindi words wrong in English mode, and a per-utterance detector has no clean boundary to fire on. Recognition error rates rise in the mixed case even when both monolingual cases are good.',
    remedy:
      'Use a recognition model trained on the mixed variety rather than routing between two monolingual ones, and expect a measurably higher error rate than either language alone. Then change what the agent does about it: shorter confirmations, more explicit read-backs of numbers and names.',
    targets: nodesOf(arch, 'stt'),
  })

  if (!has(arch, 'tts') && !has(arch, 's2s')) {
    findings.push({
      severity: 'breaks',
      title: 'No synthesis component to give a second voice to',
      detail: 'A second language needs a voice that speaks it. There is no TTS in this architecture.',
      remedy: 'Add synthesis, and choose a voice per language rather than assuming one model covers both convincingly.',
      targets: [],
    })
  } else {
    findings.push({
      severity: 'degrades',
      title: 'Voice selection becomes runtime state, not configuration',
      detail:
        'With one language, the voice is a constant set at deploy time. With two, it is a per-call — sometimes per-utterance — decision that has to be carried in session state and applied to every synthesis request, including the ones generated by error paths and holding messages.',
      remedy: 'Put the active language in the session state next to the call id, and make the holding messages and escalation prompts language-aware too. Those are the ones that get forgotten and then appear in the wrong language during an incident.',
      targets: nodesOf(arch, 'tts'),
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'A second language cannot be added to this design without a synthesis path.'
        : verdict === 'degrades'
          ? 'A second language is addable, but language stops being configuration and becomes session state.'
          : 'Multilingual operation was designed in; code-switching is still worth measuring.',
    findings,
    deltas: [
      { label: 'Languages', before: String(req.languages.length), after: String(stressed.languages.length), worse: false },
      {
        label: 'Recognition accuracy (assumption)',
        before: 'baseline',
        after: 'lower on mixed-language utterances',
        worse: true,
      },
    ],
    stressed,
  }
}

// --- 6. Availability target ------------------------------------------------

function availabilityUp(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const target = 0.9999
  const { value, weakest } = compositeAvailability(arch)
  const stressed: Requirements = { ...req, availabilityTarget: 0.9999 }
  const findings: PressureFinding[] = []

  const minutesNow = (1 - value) * 30 * 24 * 60
  const minutesTarget = (1 - target) * 30 * 24 * 60

  if (value < target) {
    findings.push({
      severity: value < 0.999 ? 'breaks' : 'degrades',
      title: `The critical path multiplies out to ${pct(value)}`,
      detail: `Serial dependencies multiply: ${criticalPathNodes(arch).length} components on the live path give ${pct(
        value,
      )} composite availability, about ${Math.round(minutesNow)} minutes of downtime a month against the ${Math.round(
        minutesTarget,
      )} minutes the new target allows.${weakest ? ` The weakest single hop is ${weakest.label} at ${pct(weakest.value)} — no amount of redundancy elsewhere compensates for it.` : ''}`,
      remedy:
        'Two moves, in this order. First, remove components from the serial path — the cheapest availability win is a dependency that is no longer required to answer. Second, make the remaining ones redundant across failure domains, which only helps if the domains are genuinely independent.',
      targets: weakest ? [weakest.id] : [],
    })
  } else {
    findings.push({
      severity: 'holds',
      title: `The critical path already multiplies out to ${pct(value)}`,
      detail: `About ${Math.round(minutesNow)} minutes a month against an allowance of ${Math.round(minutesTarget)}.`,
      remedy: 'Confirm the redundancy is across real failure domains. Three replicas in one availability zone is one failure domain wearing a costume.',
      targets: [],
    })
  }

  const singletons = criticalPathNodes(arch).filter((n) => n.replicas <= 1)
  if (singletons.length > 0) {
    findings.push({
      severity: target > value ? 'breaks' : 'degrades',
      title: `${singletons.length} component${singletons.length > 1 ? 's are' : ' is'} unreplicated on the live path`,
      detail: `${singletons.map((n) => n.label).join(', ')} run${singletons.length > 1 ? '' : 's'} as a single instance. At four nines the allowance is about four minutes a month — roughly one unplanned restart.`,
      remedy:
        'Replicate, or get the component off the critical path. Note that for connection-aware components, replication alone is not enough: a replica that cannot adopt an existing call only helps the calls that have not started yet.',
      targets: singletons.map((n) => n.id),
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'Four nines is arithmetically out of reach on this critical path.'
        : verdict === 'degrades'
          ? 'Four nines is reachable, but only after the single-instance components are dealt with.'
          : 'The critical path already multiplies out above the new target.',
    findings,
    deltas: [
      { label: 'Composite availability', before: pct(value), after: pct(target) + ' (required)', worse: value < target },
      {
        label: 'Allowed downtime',
        before: `${Math.round(minutesNow)} min/month`,
        after: `${Math.round(minutesTarget)} min/month`,
        worse: true,
      },
    ],
    stressed,
  }
}

// --- 7. More handoffs ------------------------------------------------------

function moreHandoffs(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const beforeRate = 0.1
  const afterRate = 0.3
  const occupancy = 0.75
  const c = req.peakConcurrentCalls
  const seatsBefore = Math.max(3, Math.ceil((c * beforeRate) / occupancy))
  const seatsAfter = Math.max(3, Math.ceil((c * afterRate) / occupancy))

  const humanNodes = nodesOf(arch, 'human-agent')
  const seatsProvisioned = arch.nodes.filter((n) => n.specId === 'human-agent').reduce((s, n) => s + n.replicas, 0)

  const findings: PressureFinding[] = []

  if (humanNodes.length === 0) {
    findings.push({
      severity: req.humanHandoff ? 'breaks' : 'degrades',
      title: 'There is no human tier to escalate into',
      detail: `At ${afterRate * 100}% escalation and ${c} concurrent calls, roughly ${Math.round(
        c * afterRate,
      )} calls at any moment want a person. There is nowhere to send them.`,
      remedy:
        'Add a human agent tier, a queue, and — more importantly — a designed answer for "nobody is available". Callback, voicemail and an honest apology are all better than a queue that never ends.',
      targets: [],
    })
  } else if (seatsProvisioned < seatsAfter) {
    findings.push({
      severity: 'breaks',
      title: `${seatsProvisioned} seats provisioned, about ${seatsAfter} needed`,
      detail: `Tripling escalations triples the offered load on the human tier. Sized for ${occupancy * 100}% target occupancy — the ceiling Erlang C imposes, because queue waits grow without bound as occupancy approaches 1 — this needs roughly ${seatsAfter} seats against ${seatsBefore} today.`,
      remedy:
        'This is the one tier that does not autoscale. Seats are hiring, training and shift scheduling with weeks of lead time. The architectural answer is to reduce escalations or to make waiting tolerable (callbacks, position announcements), not to provision faster.',
      targets: humanNodes,
    })
  } else {
    findings.push({
      severity: 'holds',
      title: `${seatsProvisioned} seats covers the tripled escalation rate`,
      detail: `About ${seatsAfter} seats are needed at ${occupancy * 100}% target occupancy; ${seatsProvisioned} are provisioned.`,
      remedy: 'Check what those idle seats cost at the normal escalation rate. Human capacity sized for the peak is expensive in a way that idle servers are not.',
      targets: humanNodes,
    })
  }

  findings.push({
    severity: 'degrades',
    title: 'Escalation rate is a quality signal, not a capacity input',
    detail:
      'A tripling of handoffs usually means the agent got worse, not that callers changed. Sizing the human tier for it treats the symptom; the number itself is the most sensitive quality metric a voice agent has.',
    remedy:
      'Alert on escalation rate per intent rather than in aggregate. A rise concentrated in one intent is a prompt or tool regression; a rise spread evenly is usually a recognition or latency problem making the whole experience worse.',
    targets: [],
  })

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'Tripled escalations overrun the human tier, and seats cannot be autoscaled.'
        : 'The human tier absorbs tripled escalations — at a standing cost.',
    findings,
    deltas: [
      { label: 'Escalation rate', before: '10%', after: '30%', worse: true },
      { label: 'Seats required', before: String(seatsBefore), after: String(seatsAfter), worse: true },
      { label: 'Seats provisioned', before: String(seatsProvisioned), after: String(seatsProvisioned), worse: seatsProvisioned < seatsAfter },
    ],
    stressed: req,
  }
}

// --- 8. Regional expansion -------------------------------------------------

function regionalExpansion(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const home: RegionId = req.regions[0] ?? 'us-east'
  const candidates: RegionId[] = ['in-mumbai', 'us-east', 'eu-west', 'ap-singapore']
  const far = candidates
    .filter((r) => !req.regions.includes(r))
    .reduce<RegionId | null>((worst, r) => {
      if (!worst) return r
      return INTER_REGION_MS[home][r] > INTER_REGION_MS[home][worst] ? r : worst
    }, null)

  const stressed: Requirements = { ...req, regions: far ? [...req.regions, far] : req.regions }
  const rtt = far ? INTER_REGION_MS[home][far] : 0
  const findings: PressureFinding[] = []

  if (!far) {
    findings.push({
      severity: 'holds',
      title: 'Already deployed in every region this simulator models',
      detail: 'There is no further region to expand into here.',
      remedy: 'Check instead that each region is sized to absorb the loss of another — that is the harder multi-region property.',
      targets: [],
    })
  } else {
    findings.push({
      severity: 'breaks',
      title: `Serving ${far} from ${home} adds about ${rtt} ms each way`,
      detail: `Media that crosses this link pays ${rtt} ms in and ${rtt} ms out on every turn — roughly ${
        rtt * 2
      } ms added to a perceived latency budget of ${req.latencyTargetMs} ms. No amount of provider tuning recovers the speed of light.`,
      remedy:
        'Terminate media in the caller\'s region. Only durable data and analytics should cross the link, and nothing on a live turn may make a synchronous cross-region call.',
      targets: nodesOf(arch, 'media-gateway'),
    })

    const redisNodes = nodesOf(arch, 'redis')
    if (redisNodes.length > 0) {
      findings.push({
        severity: 'degrades',
        title: 'Session state has to become region-local',
        detail:
          'One shared session store means every state read on a live turn crosses the link. Replicating it synchronously across regions turns each write into a round trip; replicating it asynchronously means a failover can adopt a call with stale state.',
        remedy:
          'Keep sessions region-local and make calls region-sticky. Accept that a region failure drops its live calls rather than pretending live media state can migrate — then design what the caller hears when it happens.',
        targets: redisNodes,
      })
    }

    if (req.compliance.length > 0) {
      findings.push({
        severity: 'degrades',
        title: `Data residency now interacts with ${req.compliance.join(', ')}`,
        detail:
          'Recordings, transcripts and derived analytics each have a location. A second region turns "where does this live" from a default into a decision that has to be made per data type.',
        remedy:
          'Write down, per data type, which region is authoritative and which copies may exist elsewhere. Recordings are usually the strictest and the largest, which is an unhappy combination.',
        targets: nodesOf(arch, 'object-storage'),
      })
    }
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'A second region is a media-termination problem before it is a deployment problem.'
        : 'Expansion is workable; the state and residency stories need writing down.',
    findings,
    deltas: [
      { label: 'Regions', before: String(req.regions.length), after: String(stressed.regions.length), worse: false },
      { label: 'Added one-way latency if media stays home', before: '0 ms', after: `${rtt} ms`, worse: rtt > 0 },
    ],
    stressed,
  }
}

// --- 9. Database slowdown --------------------------------------------------

function dbSlowdown(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const beforeMs = 20
  const afterMs = 800
  const base = { ...DEFAULT_LATENCY_PARAMS, budgetMs: req.latencyTargetMs, toolMs: beforeMs }
  const before = computeLatency(base)
  const after = computeLatency({ ...base, toolMs: afterMs })

  const dbNodes = nodesOf(arch, 'postgres')
  const toolNodes = nodesOf(arch, 'tool-api')
  const findings: PressureFinding[] = []

  if (dbNodes.length === 0 && toolNodes.length === 0) {
    findings.push({
      severity: 'holds',
      title: 'Nothing in this design queries a backend during a turn',
      detail: 'With no tool or database on the conversational path, a slow database cannot stall a turn. That also means the agent cannot answer any question about the caller\'s actual data.',
      remedy: 'If that is deliberate, write it down as a scope decision. If it is an omission, adding the tool path is also adding this failure mode.',
      targets: [],
    })
  } else {
    const overBudget = after.perceivedLatencyMs > req.latencyTargetMs
    findings.push({
      severity: overBudget ? 'breaks' : 'degrades',
      title: `A turn that queries the database now takes ${Math.round(after.perceivedLatencyMs)} ms`,
      detail: `Tool latency sits inside the silent gap between the caller finishing and the agent starting. Going from ${beforeMs} ms to ${afterMs} ms moves perceived latency from ${Math.round(
        before.perceivedLatencyMs,
      )} ms to ${Math.round(after.perceivedLatencyMs)} ms against a ${req.latencyTargetMs} ms target. The caller hears nothing at all for that entire period.`,
      remedy:
        'Two independent fixes, and you need both. Cover the gap with spoken filler after ~600 ms so silence never exceeds a conversational pause, and put a hard timeout on the query with a defined answer for when it expires — "I can\'t reach that right now" is a better turn than a dead line.',
      targets: dbNodes.concat(toolNodes),
    })

    if (!has(arch, 'redis')) {
      findings.push({
        severity: 'degrades',
        title: 'No cache in front of the slow dependency',
        detail: 'Every turn that needs the same caller record pays the full query again. During a slowdown that multiplies the load on the component that is already struggling.',
        remedy: 'Cache the per-call record once at call start. Voice calls re-read the same few facts many times, which makes them unusually cache-friendly compared to web traffic.',
        targets: dbNodes,
      })
    }

    const pooled = arch.nodes.some((n) => n.specId === 'postgres' && n.replicas > 1)
    if (!pooled && dbNodes.length > 0) {
      findings.push({
        severity: 'degrades',
        title: 'A single database instance under a slowdown becomes a queue',
        detail:
          'When queries take 40× longer, connections are held 40× longer. Connection exhaustion arrives well before CPU saturation, and it presents as total unavailability rather than slowness.',
        remedy: 'Put a connection pooler in front and cap the pool below the server limit, so the failure is a fast rejection you can handle rather than a stall you cannot.',
        targets: dbNodes,
      })
    }
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'A slow database becomes dead air, and dead air ends calls.'
        : verdict === 'degrades'
          ? 'The turn survives a slow database, but only because something covers the gap.'
          : 'No backend sits on the conversational path here.',
    findings,
    deltas: [
      { label: 'Tool/database latency', before: `${beforeMs} ms`, after: `${afterMs} ms`, worse: true },
      {
        label: 'Perceived latency on a data turn',
        before: `${Math.round(before.perceivedLatencyMs)} ms`,
        after: `${Math.round(after.perceivedLatencyMs)} ms`,
        worse: true,
      },
    ],
    stressed: req,
  }
}

// --- 10. Queue saturation --------------------------------------------------

function queueSaturation(arch: Architecture, req: Requirements, test: PressureTest): PressureResult {
  const queueNodes = [...nodesOf(arch, 'queue'), ...nodesOf(arch, 'kafka')]
  const findings: PressureFinding[] = []

  if (queueNodes.length === 0) {
    findings.push({
      severity: 'degrades',
      title: 'There is no queue, which means the work it would carry is on the live path',
      detail:
        'Transcript persistence, CRM updates, analytics and recording uploads have to happen somewhere. Without a queue they happen inline, which means a slow CRM is a slow conversation.',
      remedy: 'Add an async path for everything that does not have to complete before the agent speaks. The test is simple: if the caller would not notice it being 30 seconds late, it does not belong in the turn.',
      targets: [],
    })
  } else {
    const mediaPathProducers = arch.edges.filter((e) => {
      const target = arch.nodes.find((n) => n.id === e.target)
      if (!target || (target.specId !== 'queue' && target.specId !== 'kafka')) return false
      const source = arch.nodes.find((n) => n.id === e.source)
      if (!source) return false
      return getSpec(source.specId).onMediaPath && e.type === 'sync'
    })

    if (mediaPathProducers.length > 0) {
      findings.push({
        severity: 'breaks',
        title: 'A media-path component writes to the queue synchronously',
        detail: `${mediaPathProducers.length} edge${
          mediaPathProducers.length > 1 ? 's are' : ' is'
        } marked as a synchronous call from a component on the live audio path into the queue. When the queue backs up, that write blocks, and the block lands inside a turn. The word "queue" did not make it asynchronous; the connection type did not change.`,
        remedy:
          'Make the publish fire-and-forget with a bounded local buffer, and decide explicitly what happens when the buffer fills — dropping analytics events is usually correct and should be a deliberate, logged decision rather than a stall.',
        targets: mediaPathProducers.map((e) => e.source),
      })
    } else {
      findings.push({
        severity: 'holds',
        title: 'The queue is genuinely off the live path',
        detail: 'No synchronous edge runs from a media-path component into the queue, so consumers falling behind delays reporting rather than conversation.',
        remedy: 'Alert on queue depth and consumer lag as a product signal, not just an infrastructure one: a 20-minute lag means your dashboards are 20 minutes stale during exactly the incident you need them for.',
        targets: queueNodes,
      })
    }

    findings.push({
      severity: 'degrades',
      title: 'Backlog becomes memory pressure somewhere',
      detail:
        'An unbounded queue is a promise to buy unbounded storage. Twenty minutes of backlog at this call volume is a large number of messages that have to live somewhere until consumers catch up.',
      remedy:
        'Bound the queue and choose a shedding policy. For analytics, drop the oldest; for billing events, refuse new work instead — the two have opposite correct answers and mixing them up is how you lose revenue data to a dashboard outage.',
      targets: queueNodes,
    })
  }

  const verdict = verdictOf(findings)
  return {
    test,
    verdict,
    headline:
      verdict === 'breaks'
        ? 'The async path is synchronous where it matters, so a backlog reaches the caller.'
        : verdict === 'degrades'
          ? 'A backlog stays off the conversation, but it has to be bounded somewhere.'
          : 'A queue backlog delays reporting, not conversation.',
    findings,
    deltas: [
      { label: 'Queue components', before: String(queueNodes.length), after: String(queueNodes.length), worse: false },
      { label: 'Consumer lag', before: '~0', after: '20 min', worse: true },
    ],
    stressed: req,
  }
}

// ---------------------------------------------------------------------------
// Summary across the whole suite
// ---------------------------------------------------------------------------

export interface PressureSummary {
  holds: number
  degrades: number
  breaks: number
  /** Ordered worst-first, for the "fix this next" list. */
  worst: PressureResult[]
}

export function summarisePressure(results: PressureResult[]): PressureSummary {
  const rank: Record<PressureVerdict, number> = { breaks: 0, degrades: 1, holds: 2 }
  return {
    holds: results.filter((r) => r.verdict === 'holds').length,
    degrades: results.filter((r) => r.verdict === 'degrades').length,
    breaks: results.filter((r) => r.verdict === 'breaks').length,
    worst: [...results].sort((a, b) => rank[a.verdict] - rank[b.verdict]),
  }
}

/** Utilisation headroom, used by the pressure lab's summary strip. */
export function headroom(arch: Architecture, concurrent: number): number {
  const usages = computeResources(arch, concurrent)
  if (usages.length === 0) return 1
  const worst = Math.max(...usages.map((u) => u.utilisation))
  return round(Math.max(0, 1 - worst), 3)
}

/** Structural issues that exist before any pressure is applied. */
export function baselineIssues(arch: Architecture, req: Requirements) {
  return validateArchitecture(arch, req)
}

/** Present for tests: every spec id the pressure suite reasons about. */
export const PRESSURE_RELEVANT_SPECS = [
  'stt',
  's2s',
  'tts',
  'llm',
  'redis',
  'postgres',
  'queue',
  'kafka',
  'human-agent',
  'load-balancer',
  'media-gateway',
  'object-storage',
] as const
