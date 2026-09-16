/**
 * What-if: remove a component and find out what it was actually for.
 *
 * Reading that Redis "stores session state" teaches almost nothing. Deleting
 * Redis and discovering that no server can now adopt a call after a deploy —
 * that every rolling restart drops every live conversation — teaches the same
 * sentence in a way that sticks.
 *
 * This is deliberately a *subtractive* exercise. Architecture diagrams are
 * additive by nature: every box someone drew looks necessary because it is
 * there. The only way to find out which boxes are load-bearing is to take one
 * away and see what falls over, and the only safe place to do that is here.
 *
 * Everything is computed from models that already exist — the validator decides
 * what is broken, the capacity model decides what saturates, the cost model
 * decides what you saved. This file adds the diff and the narration.
 */

import type { Architecture, Requirements, ValidationIssue } from '../domain/types'
import { getSpec } from '../registry/components'
import { validateArchitecture } from '../validation/rules'
import { detectBottlenecks } from './scaling'
import { computeCost } from './cost'
import { costInputsFor } from './pressure'
import { round } from '../engine/simulation'

export type RemovalSeverity = 'fatal' | 'degraded' | 'survivable'

export interface RemovalConsequence {
  nodeId: string
  label: string
  specId: string
  severity: RemovalSeverity
  /** One line a learner could repeat. */
  headline: string
  /** What stops working, concretely. */
  breaks: string[]
  /** What genuinely improves. There is always something, or the box was free. */
  gains: string[]
  /** Validation issues that appear only after the removal. */
  newIssues: ValidationIssue[]
  /** Issues that disappear — sometimes removing a component removes a problem. */
  resolvedIssues: ValidationIssue[]
  /** Monthly cost difference, negative meaning cheaper. */
  costDeltaPerMonth: number
  /** What a real system does instead of this component, if anything. */
  insteadYouWould: string
  /** Components whose load increases because this one is gone. */
  shiftsLoadTo: string[]
}

/** The architecture with one node and all its edges removed. */
export function withoutNode(arch: Architecture, nodeId: string): Architecture {
  return {
    ...arch,
    nodes: arch.nodes.filter((n) => n.id !== nodeId),
    edges: arch.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  }
}

/**
 * Per-component consequences that the generic models cannot derive.
 *
 * The validator knows that removing Redis breaks a structural rule. It does
 * not know that the operational consequence is "every deploy drops every live
 * call", which is the sentence that makes the rule memorable. That knowledge
 * lives here, keyed by spec id.
 */
const CONSEQUENCES: Record<
  string,
  { breaks: string[]; gains: string[]; instead: string; shifts?: string[] }
> = {
  redis: {
    breaks: [
      'Session state falls back to process memory, so a call belongs to exactly one server for its whole life.',
      'Rolling deploys stop being routine: every restart drops the live calls on that instance, and voice calls last minutes rather than milliseconds.',
      'Any server crash loses its in-flight conversations with no possibility of recovery — there is nowhere for another instance to read the state from.',
    ],
    gains: [
      'One less component to run, monitor and pay for.',
      'One less network hop on every state read, which is genuinely worth something inside a turn budget.',
      'At a single-server scale this is the correct tradeoff, and pretending otherwise is cargo-culting.',
    ],
    instead:
      'Keep state in process memory and accept that the blast radius of one instance is all of its calls. Write the tradeoff down, and add drain-before-deploy so at least planned restarts are not destructive.',
    shifts: ['postgres'],
  },
  'load-balancer': {
    breaks: [
      'Nothing places new calls onto healthy instances, so traffic either goes to one machine or to a dead one.',
      'There is no health check, so a sick instance keeps receiving calls until a human notices.',
      'Adding capacity stops being useful: you can run ten servers and still send everything to one.',
    ],
    gains: [
      'One less hop, and one less thing that can be misconfigured at 3am.',
      'DNS round-robin can cover a very small deployment, which is a real option below a handful of instances.',
    ],
    instead:
      'DNS-based distribution, or a single instance. Both are fine at small scale; neither gives you health-aware placement, which is the property you will eventually need.',
    shifts: ['media-gateway'],
  },
  vad: {
    breaks: [
      'Nothing decides when the caller has stopped speaking, so turn-taking has to come from somewhere else entirely.',
      'Barge-in stops working: without speech detection during playback, the agent cannot know it has been interrupted.',
      'Recognition runs on the whole stream continuously, which costs more and produces transcripts with no turn boundaries.',
    ],
    gains: [
      'Removes a component whose misconfiguration causes most "the agent keeps interrupting me" complaints.',
      'Some speech-to-speech and end-to-end models do their own endpointing, making a separate VAD genuinely redundant.',
    ],
    instead:
      'Use the recogniser\'s own endpointing signal, or a model that handles turn-taking natively. You have not removed the problem — you have moved it inside a component you cannot tune.',
    shifts: ['stt'],
  },
  stt: {
    breaks: [
      'There is no text for the language model to read. The agent cannot understand anything a caller says.',
      'Every downstream feature — intent, tools, transcripts, QA, analytics — has nothing to work from.',
    ],
    gains: [
      'Two network hops and one vendor relationship disappear from the critical path.',
      'Only defensible alongside a speech-to-speech model that takes audio directly.',
    ],
    instead:
      'A speech-to-speech model. Note what you give up: there is no transcript to inspect, correct, log or search, which affects compliance and debugging far more than people expect.',
  },
  tts: {
    breaks: [
      'The agent has nothing to say out loud. Text answers on a phone call are not answers.',
      'Holding messages, error messages and escalation announcements all have no voice either.',
    ],
    gains: [
      'Removes the second-largest per-call cost line in most voice agents.',
      'Pre-recorded audio is dramatically cheaper and higher quality for fixed phrases.',
    ],
    instead:
      'Pre-recorded prompts for fixed phrases plus a speech-to-speech model for the rest. Pre-recorded audio is still the right answer for anything you say on every single call.',
  },
  llm: {
    breaks: [
      'Nothing decides what to say or which tool to call. The agent becomes a very expensive IVR.',
      'Anything not anticipated by a rule falls through with no answer.',
    ],
    gains: [
      'Removes the least predictable component in the system, along with its latency variance and its ability to invent things.',
      'A rule-based flow is testable, cheap and completely deterministic, which for a narrow task is a genuine advantage rather than a consolation.',
    ],
    instead:
      'A deterministic dialogue flow. For "press one for balance" this is better than a model in every respect. The moment you need to handle a sentence nobody scripted, it is not.',
  },
  postgres: {
    breaks: [
      'Nothing durable survives the call. Transcripts, outcomes and audit trails all vanish when the process ends.',
      'Compliance obligations that require a record of what was said cannot be met.',
      'There is no data to improve the agent with — no failure corpus, no eval set, no history.',
    ],
    gains: ['One less stateful component, which is the most operationally demanding kind.'],
    instead:
      'Write to object storage or an external system of record. You still need durability; you have only changed which component provides it.',
    shifts: ['object-storage'],
  },
  queue: {
    breaks: [
      'Work that was asynchronous becomes synchronous: CRM writes, transcript persistence and analytics now happen inside the turn.',
      'A slow downstream system becomes a slow conversation, with no buffer between them.',
    ],
    gains: [
      'One less component, and end-to-end latency for side effects drops to zero — the write has already happened when the call ends.',
      'Below a few hundred calls a day, a direct write is simpler and the failure modes are easier to reason about.',
    ],
    instead:
      'Write directly, with a short timeout and a fire-and-forget wrapper. Accept that some side effects will be lost, and log which ones so the loss is visible.',
    shifts: ['postgres'],
  },
  'human-agent': {
    breaks: [
      'There is no escalation path. A caller the agent cannot help has nowhere to go but away.',
      'Every automated failure becomes a terminal failure for that call.',
    ],
    gains: [
      'Removes the single largest ongoing cost in most contact-centre economics, and the only one that cannot be autoscaled.',
    ],
    instead:
      'A callback promise, a voicemail, or an honest "I cannot help with this" plus a channel that can. All three are better than a queue nobody answers.',
  },
  monitoring: {
    breaks: [
      'Failures become invisible until a customer reports them, which is the slowest and most expensive detection path available.',
      'There is no per-stage latency data, so every performance discussion becomes an argument about opinions.',
    ],
    gains: ['Removes an ingest bill that is genuinely large at scale, and one more thing to operate.'],
    instead:
      'Structured logs and a dashboard built from them. You have not removed the need to know what is happening — you have made answering it slower.',
  },
  'media-gateway': {
    breaks: [
      'Audio has nowhere to terminate. There is no pipeline between the caller and the speech components.',
      'Nothing transcodes, buffers or forwards media, so the call has no audio path at all.',
    ],
    gains: ['Only meaningful if a managed platform is taking over media entirely.'],
    instead:
      'A managed voice platform that terminates media for you. The component has not disappeared — you are renting someone else\'s, along with their region choices and their outage windows.',
  },
  'tool-api': {
    breaks: [
      'The agent cannot look anything up. It can converse and it cannot act, which callers identify within one turn.',
      'Every factual question becomes either a refusal or an invention, depending on how good the guardrails are.',
    ],
    gains: ['Removes the most common source of in-turn latency, and one whole class of failure.'],
    instead:
      'Answer only from the prompt, and be explicit about the narrower scope. An agent that admits it cannot check anything is more useful than one that pretends.',
  },
}

export function removalConsequence(
  arch: Architecture,
  nodeId: string,
  req?: Requirements,
): RemovalConsequence {
  const node = arch.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`No such node: ${nodeId}`)
  const spec = getSpec(node.specId)
  const after = withoutNode(arch, nodeId)

  const issuesBefore = validateArchitecture(arch, req)
  const issuesAfter = validateArchitecture(after, req)
  const beforeKeys = new Set(issuesBefore.map((i) => `${i.ruleId}:${i.title}`))
  const afterKeys = new Set(issuesAfter.map((i) => `${i.ruleId}:${i.title}`))
  const newIssues = issuesAfter.filter((i) => !beforeKeys.has(`${i.ruleId}:${i.title}`))
  const resolvedIssues = issuesBefore.filter((i) => !afterKeys.has(`${i.ruleId}:${i.title}`))

  const known = CONSEQUENCES[node.specId]
  const breaks = known?.breaks ?? [spec.ifItFails]
  const gains = known?.gains ?? ['One less component to run, monitor and pay for.']

  // Cost difference, where the component has a cost model we can price.
  let costDeltaPerMonth = 0
  if (req) {
    const inputs = costInputsFor(req)
    const before = computeCost(inputs)
    // The cost model is requirements-driven rather than graph-driven, so only
    // the components it explicitly prices can be zeroed out here. Saying "we
    // cannot price this one" is better than inventing a saving.
    const priced: Record<string, keyof typeof inputs.pricing> = {
      redis: 'redisPerNodeHour',
      postgres: 'postgresPerInstanceHour',
      queue: 'queuePerMillionMsgs',
      monitoring: 'observabilityPerGbIngest',
      'media-gateway': 'mediaServerPerInstanceHour',
    }
    const key = priced[node.specId]
    if (key) {
      const cheaper = computeCost({ ...inputs, pricing: { ...inputs.pricing, [key]: 0 } })
      costDeltaPerMonth = round(cheaper.usdPerMonth - before.usdPerMonth, 2)
    }
  }

  const errorCount = newIssues.filter((i) => i.severity === 'error').length
  const severity: RemovalSeverity =
    errorCount > 0 || spec.onMediaPath && ['stt', 'tts', 'llm', 'media-gateway', 's2s'].includes(node.specId)
      ? 'fatal'
      : newIssues.length > 0
        ? 'degraded'
        : 'survivable'

  // Load that this component was absorbing has to go somewhere.
  const shiftsLoadTo = (known?.shifts ?? []).filter((id) => after.nodes.some((n) => n.specId === id))
  const bottlenecksAfter = req ? detectBottlenecks(after, req.peakConcurrentCalls) : []

  const headline =
    severity === 'fatal'
      ? `Removing ${node.label} breaks the system: ${breaks[0]}`
      : severity === 'degraded'
        ? `${node.label} can be removed, but ${newIssues.length} new problem${newIssues.length > 1 ? 's appear' : ' appears'}.`
        : `${node.label} can be removed here without breaking a rule — which is worth understanding before you conclude it was useless.`

  return {
    nodeId,
    label: node.label,
    specId: node.specId,
    severity,
    headline,
    breaks,
    gains,
    newIssues,
    resolvedIssues,
    costDeltaPerMonth,
    insteadYouWould: known?.instead ?? spec.alternatives[0] ?? 'There is no direct substitute in this catalogue.',
    shiftsLoadTo: shiftsLoadTo.concat(
      bottlenecksAfter.filter((b) => !shiftsLoadTo.includes(b.nodeId)).map((b) => b.label),
    ),
  }
}

/** Every removable node, ranked by how much damage removal does. */
export function rankByLoadBearing(arch: Architecture, req?: Requirements): RemovalConsequence[] {
  const rank: Record<RemovalSeverity, number> = { fatal: 0, degraded: 1, survivable: 2 }
  return arch.nodes
    .filter((n) => getSpec(n.specId).category !== 'endpoint')
    .map((n) => removalConsequence(arch, n.id, req))
    .sort((a, b) => rank[a.severity] - rank[b.severity])
}
