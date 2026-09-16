/**
 * Challenge mode: scenario generation, question sets and architecture
 * evaluation. Evaluation reuses the same validator, bottleneck detector,
 * latency and cost models as everything else — a submitted design is judged
 * by the same physics the rest of the app teaches.
 */

import type {
  Architecture,
  Challenge,
  ChallengeQuestion,
  EvaluationFinding,
  EvaluationResult,
  Requirements,
} from '../domain/types'
import { Rng } from '../engine/rng'
import { validateArchitecture } from '../validation/rules'
import { detectBottlenecks, planInfrastructure } from '../models/scaling'
import { computeCost, DEFAULT_COST_INPUTS } from '../models/cost'
import { computeLatency, DEFAULT_LATENCY_PARAMS } from '../models/latency'

// ---------------------------------------------------------------------------
// Question bank (parameterised by requirements)
// ---------------------------------------------------------------------------

export function questionsFor(req: Requirements): ChallengeQuestion[] {
  const qs: ChallengeQuestion[] = []
  const tight = req.latencyTargetMs <= 1000

  qs.push({
    id: 'transport',
    prompt: `Which transport carries user audio for this ${req.channel} product?`,
    kind: 'choice',
    options: [
      { id: 'cpaas-ws', label: 'Managed telephony + WebSocket media stream' },
      { id: 'sip-trunk', label: 'Direct SIP trunk + own SBC' },
      { id: 'webrtc', label: 'WebRTC to your media server' },
      { id: 'http-post', label: 'HTTP POST of recorded clips' },
    ],
    goodAnswers:
      req.channel === 'browser' ? ['webrtc'] :
      req.peakConcurrentCalls > 2000 && req.budgetPosture === 'low-cost' ? ['sip-trunk', 'cpaas-ws'] : ['cpaas-ws', 'sip-trunk'],
    badAnswers: req.channel === 'browser' ? ['http-post', 'cpaas-ws', 'sip-trunk'] : ['http-post', 'webrtc'],
    feedback: {
      'cpaas-ws': 'Managed telephony: fastest to ship, carrier ops outsourced, a per-minute premium and a provider hop on the media path.',
      'sip-trunk': `Own trunks: ~half-price minutes at volume, and you now operate SBCs. Defensible ${req.peakConcurrentCalls > 2000 ? 'at this volume' : 'only once minute-volume pays for the ops'}.`,
      webrtc: req.channel === 'browser' ? 'Right: browsers cannot dial PSTN, and WebRTC brings AEC, FEC and 48 kHz audio for free.' : 'WebRTC alone cannot reach phone users — the requirement says phone.',
      'http-post': 'Posting recorded clips is not a live conversation: multi-second turn latency by construction and no barge-in. It fails the latency requirement outright.',
    },
    principle: 'The channel requirement decides the left edge of the architecture; everything else hangs off it.',
  })

  qs.push({
    id: 'streaming',
    prompt: `Streaming or batch pipeline for a ${req.latencyTargetMs} ms perceived-latency target?`,
    kind: 'choice',
    options: [
      { id: 'batch', label: 'Batch: each stage completes, then the next starts' },
      { id: 'stream', label: 'Streaming: STT partials, LLM tokens, chunked TTS, overlapped' },
      { id: 's2s', label: 'Speech-to-speech realtime model' },
    ],
    goodAnswers: tight ? (req.latencyTargetMs <= 600 ? ['stream', 's2s'] : ['stream']) : ['stream', 'batch'],
    badAnswers: tight ? ['batch'] : [],
    feedback: {
      batch: tight
        ? `The Latency Lab arithmetic: batch serialisation alone typically costs 1.5–3 s — the ${req.latencyTargetMs} ms target is unreachable before you tune anything.`
        : 'Defensible at a relaxed target, and much simpler to build — but users still prefer faster.',
      stream: 'The standard answer: overlap recognition with speech and synthesis with generation. You buy the latency with orchestration complexity.',
      s2s: req.latencyTargetMs <= 600
        ? 'Defensible at this aggressive target — accepting provider lock-in, opaque transcripts and per-minute session pricing.'
        : 'Works, but you pay lock-in and opacity for latency headroom the target does not demand.',
    },
    principle: 'Streaming should be used when the latency requirement justifies it — and the requirement here is explicit.',
  })

  qs.push({
    id: 'state',
    prompt: `Where does live conversation state live, at ${req.peakConcurrentCalls.toLocaleString()} peak concurrent calls?`,
    kind: 'choice',
    options: [
      { id: 'memory', label: 'In the media server process memory' },
      { id: 'redis', label: 'Redis, written at turn boundaries' },
      { id: 'postgres', label: 'PostgreSQL, written every event' },
      { id: 'client', label: 'On the client, replayed on reconnect' },
    ],
    goodAnswers: req.peakConcurrentCalls <= 50 ? ['memory', 'redis'] : ['redis'],
    badAnswers: ['postgres', 'client'],
    feedback: {
      memory: req.peakConcurrentCalls <= 50
        ? 'Acceptable at this scale IF you write down that deploys/crashes drop in-flight calls. Cheap and fast.'
        : `At ${req.peakConcurrentCalls.toLocaleString()} concurrent, a deploy would lobotomise hundreds of live conversations. State must survive the process.`,
      redis: 'The standard: microsecond reads, TTL hygiene, survives instance death, lets any server adopt a reconnecting call.',
      postgres: 'Durable, but per-event writes at voice concurrency exhaust connections and put a disk in your conversational loop. Postgres is the record, not the scratchpad.',
      client: 'Phones cannot hold your session state, and browsers lie. Server-side ownership with resume tokens is the pattern.',
    },
    principle: 'State needs an explicit owner whose lifetime exceeds the process serving the call.',
  })

  qs.push({
    id: 'interruption',
    prompt: 'The agent is mid-sentence and the caller says "wait, stop". What must happen, in order?',
    kind: 'choice',
    options: [
      { id: 'full', label: 'VAD detects speech → confirm past min-duration → cancel TTS upstream → flush transport audio buffer → new turn' },
      { id: 'stt-only', label: 'Wait for STT to transcribe "wait stop", then stop speaking' },
      { id: 'ignore', label: 'Finish the sentence (it is short), then listen' },
    ],
    goodAnswers: ['full'],
    badAnswers: ['stt-only', 'ignore'],
    feedback: {
      full: 'Correct, and the buffer flush is the step everyone forgets: cancelling TTS without clearing queued audio means the agent "keeps talking" for seconds.',
      'stt-only': 'STT confirmation adds 300–800 ms during which the agent talks over the caller. Barge-in triggers on VAD (is there sound?), not on semantics.',
      ignore: 'The behaviour users describe as "it does not listen". Interruption support is a hard requirement of natural conversation.',
    },
    principle: 'Barge-in is a media-plane reflex (fast, dumb) followed by a control-plane decision (slower, smart).',
  })

  qs.push({
    id: 'stt-fail',
    prompt: 'Your streaming STT provider starts refusing connections mid-day. The design response?',
    kind: 'choice',
    options: [
      { id: 'fallback', label: 'Auto-switch to a pre-connected second provider; accept degraded accuracy' },
      { id: 'retry', label: 'Retry the same provider with exponential backoff until it recovers' },
      { id: 'apologise', label: 'Play "we are experiencing difficulties" and hang up' },
      { id: 'queue-audio', label: 'Buffer caller audio until the provider returns' },
    ],
    goodAnswers: ['fallback'],
    badAnswers: ['queue-audio'],
    feedback: {
      fallback: 'Right: a worse transcript beats a dead call. The switch must be automatic and rehearsed — a fallback first exercised during an outage is a second outage.',
      retry: 'Backoff is polite for batch jobs; a live caller cannot wait out your retry schedule. Retry once, then fall back.',
      apologise: 'Honest but maximally expensive: 100% failure of every call for the outage duration. Acceptable only if you truly have no second provider.',
      'queue-audio': 'Buffering live conversation audio for later transcription abandons the conversation while pretending not to. The caller is still there, waiting.',
    },
    principle: 'External providers fail; the critical path needs a rehearsed fallback, not hope.',
  })

  if (req.peakConcurrentCalls >= 200) {
    qs.push({
      id: 'scale-gw',
      prompt: `How do you scale the media gateway tier for ${req.peakConcurrentCalls.toLocaleString()} concurrent calls?`,
      kind: 'choice',
      options: [
        { id: 'aware', label: 'Many small instances, LB at connect time, autoscale on connections, drain on deploy' },
        { id: 'vertical', label: 'One very large server with capacity for all calls' },
        { id: 'requests', label: 'Standard request autoscaling on CPU, like a web app' },
      ],
      goodAnswers: ['aware'],
      badAnswers: ['vertical'],
      feedback: {
        aware: `Correct: connection-aware scaling. ~${Math.ceil(req.peakConcurrentCalls / 50 / 0.7)} instances at 50 calls each (assumption) with 30% headroom, scaled on connection count because CPU lags the spike, drained on deploys because calls last minutes.`,
        vertical: `One box carrying ${req.peakConcurrentCalls.toLocaleString()} live calls is ${req.peakConcurrentCalls.toLocaleString()} dropped calls when it fails — and it will. Blast radius is the reason small instances win even when big ones are cheaper.`,
        requests: 'Web autoscaling assumes short requests and interchangeable servers. Voice connections are neither: scaling in cannot evict live calls, and CPU rises only after connections are already accepted.',
      },
      principle: 'Persistent connections require connection-aware scaling; blast radius per instance is a chosen number.',
    })
  }

  if (req.humanHandoff) {
    qs.push({
      id: 'handoff',
      prompt: 'Design the human handoff path. Which sequence is production-shaped?',
      kind: 'choice',
      options: [
        { id: 'checked', label: 'Check availability → queue w/ honest ETA → warm transfer + context screen-pop → no-agent fallback (callback)' },
        { id: 'blind', label: 'SIP REFER to the support queue number' },
        { id: 'never', label: 'AI handles everything; no handoff needed' },
      ],
      goodAnswers: ['checked'],
      badAnswers: ['never'],
      feedback: {
        checked: 'Right: handoff is a state machine with failure branches, and the no-agent branch is the one that saves your reviews.',
        blind: 'Transfer-and-hope: no availability check (dead-end queues), no context (caller repeats everything). It is a phone feature, not a design.',
        never: 'The requirement says handoff. Beyond that: every AI has an edge, and the caller finds it while angry.',
      },
      principle: 'Human handoff is a state transition across media, routing and context — each with failure branches.',
    })
  }

  return qs
}

// ---------------------------------------------------------------------------
// Challenge generation (deterministic from seed)
// ---------------------------------------------------------------------------

/**
 * A cost ceiling the design has to come in under.
 *
 * Derived from what a reasonable reference design costs for these exact
 * requirements, then tightened or loosened by the brief's budget posture. That
 * keeps it always achievable and never generous: a low-cost brief cannot also
 * buy a premium voice and a flagship model, which is precisely the trade the
 * challenge exists to force.
 */
export function budgetFor(req: Requirements): number {
  const reference = computeCost({
    ...DEFAULT_COST_INPUTS,
    callsPerDay: req.callsPerDay,
    avgCallMinutes: req.avgCallSeconds / 60,
    peakConcurrent: req.peakConcurrentCalls,
    recordingEnabled: req.recording,
    turnsPerCall: Math.max(2, Math.round(req.avgCallSeconds / 30)),
  })
  const posture = req.budgetPosture === 'low-cost' ? 0.7 : req.budgetPosture === 'premium' ? 1.6 : 1
  return Math.round(reference.usdPerCall * posture * 10000) / 10000
}

/**
 * Does a design fit the brief's budget?
 *
 * Separate from `evaluateArchitecture` because the budget belongs to the
 * challenge, not to the requirements — two briefs can want the same system at
 * different prices, and that difference is the whole exercise.
 */
export function evaluateBudget(
  req: Requirements,
  budgetUsdPerCall: number,
): { usdPerCall: number; budgetUsdPerCall: number; withinBudget: boolean; overBy: number; dominant: string } {
  const actual = computeCost({
    ...DEFAULT_COST_INPUTS,
    callsPerDay: req.callsPerDay,
    avgCallMinutes: req.avgCallSeconds / 60,
    peakConcurrent: req.peakConcurrentCalls,
    recordingEnabled: req.recording,
    turnsPerCall: Math.max(2, Math.round(req.avgCallSeconds / 30)),
  })
  const dominant = [...actual.lineItems].sort((a, b) => b.usdPerCall - a.usdPerCall)[0]
  return {
    usdPerCall: actual.usdPerCall,
    budgetUsdPerCall,
    withinBudget: actual.usdPerCall <= budgetUsdPerCall,
    overBy: Math.max(0, actual.usdPerCall - budgetUsdPerCall),
    dominant: dominant ? `${dominant.label} — ${dominant.basis}` : 'nothing priced',
  }
}

export function generateChallenge(seed: string): Challenge {
  const rng = new Rng(`challenge-${seed}`)
  const concurrentOptions = [200, 500, 1000, 2000, 5000, 10000]
  const concurrent = rng.pick(concurrentOptions)
  const callsPerDay = concurrent * rng.pick([40, 60, 100])
  const latency = rng.pick([500, 800, 1000, 1500])
  const langs = rng.pick([['en-US'], ['hi-IN', 'en-IN'], ['en-IN', 'hi-IN', 'ta-IN'], ['en-US', 'es-ES']])
  const india = langs.some((l) => l.endsWith('-IN'))
  const handoff = rng.chance(0.6)
  const recording = rng.chance(0.7)
  const availability = rng.pick([0.99, 0.995, 0.999, 0.9995] as const)
  const budget = rng.pick(['low-cost', 'balanced', 'premium'] as const)
  const direction = rng.pick(['inbound', 'outbound', 'both'] as const)

  const req: Requirements = {
    name: `Generated challenge ${seed}`,
    callsPerDay,
    avgCallSeconds: rng.pick([90, 180, 300]),
    peakCallsPerMinute: Math.round(concurrent / 4),
    peakConcurrentCalls: concurrent,
    latencyTargetMs: latency,
    availabilityTarget: availability,
    languages: langs,
    regions: india ? ['in-mumbai'] : concurrent > 5000 ? ['us-east', 'eu-west'] : ['us-east'],
    direction,
    channel: rng.chance(0.2) ? 'both' : 'phone',
    humanHandoff: handoff,
    recording,
    toolUsage: rng.pick([0.2, 0.5, 0.8]),
    budgetPosture: budget,
    compliance: recording && rng.chance(0.4) ? ['PII handling (educational)'] : [],
  }

  const expected: string[] = ['media-gateway', 'stt', 'llm', 'tts', 'agent-runtime']
  if (req.channel !== 'browser') expected.push('telephony')
  if (concurrent > 100) expected.push('redis', 'load-balancer')
  if (concurrent > 50 || recording) expected.push('queue')
  expected.push('postgres')
  if (recording) expected.push('object-storage')
  if (handoff) expected.push('human-agent')
  if (concurrent > 25) expected.push('monitoring')

  const discouraged: string[] = []
  if (latency <= 800) discouraged.push('stt-batch-profile') // marker checked via config
  if (budget === 'low-cost') discouraged.push('llm-flagship-everywhere')

  const budgetUsdPerCall = budgetFor(req)

  return {
    id: `gen-${seed}`,
    title: `Design: ${concurrent.toLocaleString()} concurrent, ${latency} ms, ${langs.join('+')}${handoff ? ', human transfer' : ''}`,
    requirements: req,
    budgetUsdPerCall,
    questions: questionsFor(req),
    expectedComponents: [...new Set(expected)],
    discouragedComponents: discouraged,
    rubric: [
      `Budget: under $${budgetUsdPerCall.toFixed(4)} per call at ${callsPerDay.toLocaleString()} calls/day — about $${Math.round(
        budgetUsdPerCall * callsPerDay * 30,
      ).toLocaleString()} a month. Every reliability question is easy when money is free.`,
      `Latency: a pipeline shape that can reach ${latency} ms (streaming ${latency <= 1000 ? 'required' : 'recommended'}).`,
      `Capacity: media tier sized for ${concurrent.toLocaleString()} concurrent with headroom.`,
      `Availability ${(-Math.log10(1 - availability)).toFixed(0)}-nines: ${availability >= 0.999 ? 'provider fallbacks + N+1 everywhere' : 'timeouts and monitoring at minimum'}.`,
      handoff ? 'Handoff: human tier wired on both media and context planes, with a no-agent fallback.' : 'No handoff required — do not add the human tier unless you argue for it.',
      recording ? 'Recording: async fork to object storage; retention as a stated policy.' : 'No recording required.',
    ],
  }
}

// ---------------------------------------------------------------------------
// Architecture evaluation against requirements
// ---------------------------------------------------------------------------

export function evaluateArchitecture(arch: Architecture, req: Requirements): EvaluationResult {
  const findings: EvaluationFinding[] = []
  const issues = validateArchitecture(arch, req)
  const bottlenecks = detectBottlenecks(arch, req.peakConcurrentCalls)
  const specIds = new Set(arch.nodes.map((n) => n.specId))

  // -- requirement satisfaction ---------------------------------------------
  const sat = (title: string, detail: string, targets?: string[]) =>
    findings.push({ kind: 'satisfies', title, detail, targets })
  const vio = (title: string, detail: string, targets?: string[]) =>
    findings.push({ kind: 'violates', title, detail, targets })

  // Channel edge.
  if (req.channel !== 'browser') {
    if (specIds.has('telephony')) sat('Phone reach', 'Telephony edge present for PSTN callers.')
    else vio('Phone reach missing', 'Requirements demand phone calls but there is no telephony component — phone users cannot reach this system at all.')
  }
  if (req.channel !== 'phone') {
    if (specIds.has('webrtc') || specIds.has('browser')) sat('Browser reach', 'WebRTC/browser edge present.')
    else vio('Browser reach missing', 'Requirements include browser users but no WebRTC/browser edge exists.')
  }

  // Latency shape.
  const sttNodes = arch.nodes.filter((n) => n.specId === 'stt')
  const batchStt = sttNodes.some((n) => String(n.config['provider'] ?? '').includes('batch'))
  const est = computeLatency({
    ...DEFAULT_LATENCY_PARAMS,
    sttStreaming: !batchStt,
    llmStreaming: true,
    ttsStreaming: !arch.nodes.some((n) => n.specId === 'tts' && String(n.config['provider'] ?? '').includes('batch')),
    budgetMs: req.latencyTargetMs,
  })
  if (est.withinBudget) {
    sat(`Latency shape can meet ${req.latencyTargetMs} ms`, `Estimated ~${est.perceivedLatencyMs} ms perceived with default assumptions. Endpointing and provider choice decide the rest.`)
  } else {
    vio(`Latency target ${req.latencyTargetMs} ms at risk`, `Estimated ~${est.perceivedLatencyMs} ms perceived with the chosen pipeline shape (${batchStt ? 'batch STT is the main cost' : 'see the waterfall for the dominant term'}).`, sttNodes.map((n) => n.id))
  }

  // Capacity.
  const criticalBn = bottlenecks.filter((b) => b.severity === 'critical')
  if (criticalBn.length === 0) {
    sat(`Capacity for ${req.peakConcurrentCalls.toLocaleString()} concurrent`, 'No component is offered more than its modelled capacity.')
  } else {
    for (const b of criticalBn) {
      findings.push({ kind: 'bottleneck', title: `Bottleneck: ${b.label}`, detail: `${b.why} Consequences: ${b.consequences.join(' ')}`, targets: [b.nodeId] })
    }
  }

  // Availability posture.
  if (req.availabilityTarget >= 0.999) {
    const fallbacks = ['stt', 'tts', 'llm'].filter((s) => arch.nodes.filter((n) => n.specId === s).length > 1)
    if (fallbacks.length >= 2) sat('High-availability posture', `Redundant providers for ${fallbacks.join(', ')}.`)
    else findings.push({ kind: 'tradeoff', title: 'Availability depends on single vendors', detail: `${(req.availabilityTarget * 100).toFixed(2)}% target with single ${['stt', 'tts', 'llm'].filter((s) => arch.nodes.filter((n) => n.specId === s).length === 1).join('/')} providers caps your availability at theirs. Either add fallbacks or write the risk down.` })
  }

  // Handoff & recording (also covered by validator; summarised here).
  if (req.humanHandoff && specIds.has('human-agent')) sat('Human handoff path exists', 'Human tier present; check both media and context connections in the issue list.')
  if (req.recording && specIds.has('object-storage')) sat('Recording storage present', 'Object storage present for recordings.')

  // Cost estimate.
  const cost = computeCost({
    ...DEFAULT_COST_INPUTS,
    callsPerDay: req.callsPerDay,
    avgCallMinutes: req.avgCallSeconds / 60,
    peakConcurrent: req.peakConcurrentCalls,
    recordingEnabled: req.recording,
  })
  findings.push({
    kind: 'assumption',
    title: `Estimated ~$${cost.usdPerCall.toFixed(3)}/call · $${Math.round(cost.usdPerMonth).toLocaleString()}/month`,
    detail: 'Computed from the default pricing sheet (example assumptions) with this scenario\'s volume. Open the Cost Simulator to edit prices and see the line items.',
  })

  // Tradeoffs & suggestions from the plan comparison.
  const plan = planInfrastructure(req)
  const mediaNode = arch.nodes.find((n) => n.specId === 'media-gateway')
  const planned = plan.components.find((c) => c.specId === 'media-gateway')?.instances ?? 1
  if (mediaNode && planned > mediaNode.replicas * 1.5) {
    findings.push({
      kind: 'suggestion',
      title: `Media tier likely undersized (${mediaNode.replicas} vs ~${planned} planned)`,
      detail: `The sizing model suggests ~${planned} instances for ${req.peakConcurrentCalls.toLocaleString()} concurrent at 50 calls/instance with headroom. Your ${mediaNode.replicas} may work with a bigger per-instance assumption — state it explicitly.`,
      targets: [mediaNode.id],
    })
  }
  findings.push({
    kind: 'assumption',
    title: 'Evaluation assumptions',
    detail: 'Capacities (50 calls/media instance, provider quotas), latencies and prices are simulation assumptions. The reasoning chain — not the constants — is what transfers to reality.',
  })

  const errors = issues.filter((i) => i.severity === 'error').length + findings.filter((f) => f.kind === 'violates').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const scoreLabel =
    errors > 0 ? `${errors} blocking issue${errors > 1 ? 's' : ''} to resolve` :
    warnings > 2 ? 'Sound shape, rough edges' :
    'Production-shaped design'

  return { scoreLabel, findings, latency: est, cost, bottlenecks, issues }
}
