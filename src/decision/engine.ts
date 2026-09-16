/**
 * The Architecture Decision Engine.
 *
 * Given requirements, it derives an architecture — but the deliverable is not
 * the diagram, it is the chain of reasoning: every component enters the design
 * through an explicit Requirement → Constraint → Decision → Tradeoff record,
 * with the alternatives that were rejected and why. This is the mental model
 * the whole simulator exists to teach.
 */

import type { Architecture, DecisionRecord, Requirements } from '../domain/types'
import { ArchBuilder } from '../domain/builder'
import { planInfrastructure } from '../models/scaling'
import { getSpec } from '../registry/components'

export interface DecisionResult {
  decisions: DecisionRecord[]
  architecture: Architecture
  assumptions: string[]
  summary: string
}

export function decideArchitecture(req: Requirements): DecisionResult {
  const decisions: DecisionRecord[] = []
  const d = (rec: Omit<DecisionRecord, 'id'>) => decisions.push({ id: `d${decisions.length + 1}`, ...rec })

  const c = req.peakConcurrentCalls
  const tight = req.latencyTargetMs <= 1000
  const veryTight = req.latencyTargetMs <= 700
  const ha = req.availabilityTarget >= 0.999
  const premium = req.budgetPosture === 'premium'
  const cheap = req.budgetPosture === 'low-cost'
  const phone = req.channel !== 'browser'
  const browser = req.channel !== 'phone'
  const india = req.regions.includes('in-mumbai')
  const multiRegion = req.regions.length > 1 || c > 5000

  // -- Channel / edge --------------------------------------------------------
  if (phone) {
    d({
      requirement: `Reach users over ordinary phone calls (${req.direction}).`,
      constraint: 'PSTN interconnect requires carrier relationships, numbers, SIP and regulatory compliance you cannot containerise.',
      decision: c > 2000 && cheap
        ? 'Direct SIP trunking with your own SBCs.'
        : 'Managed telephony provider (CPaaS) with media streaming.',
      tradeoff: c > 2000 && cheap
        ? 'Roughly half the per-minute cost, but you now operate SBCs, debug carrier quirks and own DTMF/transfer plumbing.'
        : 'Per-minute premium and a hairpin through the provider\'s edge, in exchange for zero telecom operations.',
      addsComponents: ['telephony'],
      alternatives: [
        { option: c > 2000 && cheap ? 'CPaaS' : 'Direct SIP trunk', whyNot: c > 2000 && cheap ? 'At this volume the per-minute markup exceeds the cost of operating trunks.' : 'Below ~500k min/month the ops burden outweighs the per-minute savings (assumption — the Cost Simulator lets you find your own crossover).' },
        { option: 'WebRTC only', whyNot: 'Requirements demand phone reach; browsers alone cannot dial the PSTN.' },
      ],
      confidence: 'high',
    })
  }
  if (browser) {
    d({
      requirement: 'Serve users in the browser with no app install.',
      constraint: 'Browser audio on unknown networks needs NAT traversal, echo cancellation and loss concealment.',
      decision: 'WebRTC transport with STUN/TURN, terminating at your media gateway.',
      tradeoff: 'You run TURN servers and media termination, but gain 48 kHz clean audio — measurably better STT accuracy than any 8 kHz phone line.',
      addsComponents: ['browser', 'webrtc'],
      alternatives: [
        { option: 'WebSocket + PCM from an AudioWorklet', whyNot: 'Simpler, but TCP head-of-line blocking degrades badly on lossy networks, and you lose built-in AEC and FEC.' },
      ],
      confidence: 'high',
    })
  }

  // -- Pipeline architecture -------------------------------------------------
  const s2sCandidate = veryTight && premium && !req.compliance.length && req.toolUsage < 0.4
  if (s2sCandidate) {
    d({
      requirement: `Perceived latency ≤ ${req.latencyTargetMs} ms with a premium, natural feel.`,
      constraint: 'A composed pipeline\'s floor is roughly endpointing + STT final + LLM first-sentence + TTS first-audio; going far below ~700 ms requires removing hops.',
      decision: 'Speech-to-speech realtime model for the conversational shell, with a composed pipeline kept warm as fallback.',
      tradeoff: 'Best-in-class latency and prosody, but provider lock-in, per-minute pricing that runs during silence, and no intermediate transcript to inspect or filter.',
      addsComponents: ['s2s'],
      alternatives: [
        { option: 'Composed streaming pipeline', whyNot: 'Chosen as the FALLBACK: it survives an S2S outage and keeps an auditable transcript path.' },
      ],
      confidence: 'contextual',
    })
  }
  d({
    requirement: `Response must feel conversational (target ${req.latencyTargetMs} ms).`,
    constraint: tight
      ? 'The budget cannot afford any stage that waits for the previous stage to fully finish.'
      : 'Latency budget is loose, but users still abandon calls that feel sluggish.',
    decision: tight
      ? 'Fully streaming pipeline: streaming STT partials → streaming LLM tokens → sentence-chunked streaming TTS.'
      : 'Streaming STT and TTS; batch LLM acceptable for simple turns.',
    tradeoff: 'Streaming everything means managing partial results, revision, sentence chunking and barge-in cancellation — real orchestration complexity that a batch pipeline never sees.',
    addsComponents: ['stt', 'llm', 'tts', 'vad', 'agent-runtime', 'media-gateway'],
    alternatives: [
      { option: 'Batch STT → LLM → batch TTS', whyNot: `Serialises everything: the simulator's Latency Lab shows this adds 1.5–3 s versus streaming — ${tight ? 'unreachable under' : 'uncomfortably against'} the ${req.latencyTargetMs} ms target.` },
    ],
    confidence: 'high',
  })

  // -- Language / region STT choice -----------------------------------------
  if (req.languages.some((l) => l.toLowerCase().startsWith('hi')) && india) {
    d({
      requirement: `Recognise ${req.languages.join(' + ')}, including code-switched speech, for India-based callers.`,
      constraint: 'Generic global STT models measurably underperform on Hindi/English code-switching and Indian English accents (simulation assumption reflecting a common finding).',
      decision: 'India-focused multilingual STT profile as primary, deployed against the Mumbai endpoint.',
      tradeoff: 'A smaller vendor than the hyperscalers: verify their quota headroom and their own redundancy story.',
      addsComponents: [],
      alternatives: [
        { option: 'Hyperscaler STT', whyNot: 'Broader language menu but weaker code-switching in this profile; keep it as the fallback provider.' },
      ],
      confidence: 'contextual',
    })
  }

  // -- State ----------------------------------------------------------------
  const needsRedis = c > 100 || ha
  if (needsRedis) {
    d({
      requirement: `${c.toLocaleString()} concurrent conversations must survive server deploys and crashes${ha ? ` at ${(req.availabilityTarget * 100).toFixed(2)}% availability` : ''}.`,
      constraint: 'Session state trapped in process memory dies with the process; with replicas, no other instance can adopt a dropped call.',
      decision: 'Redis as the ephemeral session store: conversation state written at turn boundaries, TTL-guarded, replica + failover.',
      tradeoff: 'Another infrastructure dependency to run, monitor and fail over — and a discipline: the media loop must read it at turn boundaries only, never per audio frame.',
      addsComponents: ['redis'],
      alternatives: [
        { option: 'In-process memory', whyNot: 'Fine below ~100 concurrent where dropping in-flight calls on deploy is an accepted, written-down risk. Not here.' },
        { option: 'Postgres for session state', whyNot: 'Durable but 10–50× slower and connection-hungry at voice concurrency; wrong tool for ephemeral hot state.' },
      ],
      confidence: 'high',
    })
  }
  d({
    requirement: 'Bookings, customer records and call outcomes must survive anything.',
    constraint: 'Transactional invariants (no double-booking) need a store with constraints and transactions.',
    decision: 'PostgreSQL as the durable system of record' + (ha ? ', primary + HA standby with automatic failover' : '') + '; connection pooler in transaction mode.',
    tradeoff: 'Vertical-ish write scaling and a pooler to operate — accepted, because the query volume here is modest compared to the media plane.',
    addsComponents: ['postgres'],
    alternatives: [
      { option: 'NoSQL KV store', whyNot: 'Scale you do not need at the price of the transactions you do need (booking uniqueness).' },
    ],
    confidence: 'high',
  })

  // -- Async / queue ---------------------------------------------------------
  const needsQueue = c > 50 || req.recording
  if (needsQueue) {
    d({
      requirement: 'Transcripts, CRM updates' + (req.recording ? ', recording uploads' : '') + ' and analytics must happen without slowing live calls.',
      constraint: 'Async workloads must not block the real-time media path; spikes must be absorbed, not amplified.',
      decision: 'Message queue between the runtime and all side-effect workers; consumers autoscale on queue depth.',
      tradeoff: 'Additional operational complexity and eventual consistency for side effects: the CRM lags the call by seconds. Idempotent consumers become mandatory.',
      addsComponents: ['queue'],
      alternatives: [
        { option: 'Synchronous writes from the call path', whyNot: 'Every CRM hiccup becomes caller-audible latency; the Chaos Lab demonstrates this failure directly.' },
      ],
      confidence: 'high',
    })
  }

  // -- Scale tier ------------------------------------------------------------
  const plan = planInfrastructure(req)
  if (c > 25) {
    d({
      requirement: `${c.toLocaleString()} peak concurrent calls (${req.callsPerDay.toLocaleString()}/day).`,
      constraint: `A media server instance carries ~50 concurrent calls (editable assumption); persistent connections pin calls to instances.`,
      decision: `${plan.tierLabel}: ~${plan.components.find((x) => x.specId === 'media-gateway')?.instances ?? 1} media instances behind a connection-aware load balancer, autoscaling on connection count with warmup headroom.`,
      tradeoff: 'Deploys become drain operations (minutes, not seconds), and blast-radius-per-instance becomes a number you explicitly choose.',
      addsComponents: ['load-balancer', 'kubernetes'],
      alternatives: [
        { option: 'Fewer, bigger instances', whyNot: 'Cheaper per call but each failure drops more live conversations; blast radius is a product decision.' },
      ],
      confidence: 'high',
    })
  }
  if (multiRegion) {
    d({
      requirement: req.regions.length > 1
        ? `Users in ${req.regions.join(', ')} with a ${req.latencyTargetMs} ms feel.`
        : `${c.toLocaleString()} concurrent calls exceeds a comfortable single-region blast radius.`,
      constraint: 'Cross-continent media adds 100–200 ms per round trip that no code removes; a single region is also a single failure domain.',
      decision: 'Multi-region deployment: media terminates in the nearest region; session state is region-local; only durable data and analytics replicate across regions.',
      tradeoff: 'Consistency and operational cost: two+ of everything, regional failover drills, and an explicit answer to “what is the source of truth during a partition”.',
      addsComponents: [],
      alternatives: [
        { option: 'Single region + global anycast', whyNot: 'Helps signalling, cannot fix media physics for far users.' },
      ],
      confidence: 'high',
    })
  }

  // -- Reliability -----------------------------------------------------------
  if (ha) {
    d({
      requirement: `${(req.availabilityTarget * 100).toFixed(2)}% availability (${downtimeBudget(req.availabilityTarget)}).`,
      constraint: 'Your availability is capped by your weakest single-instance dependency and by every external provider without a fallback.',
      decision: 'Defense in depth: fallback STT and TTS vendors pre-connected, LLM retry-then-fallback, circuit breakers on all providers, N+1 on every internal tier, health-checked failover.',
      tradeoff: 'High availability introduces additional complexity: every fallback is code to test, a config to rot, and a mode to monitor. The Reliability Lab exists to show each mechanism earning its keep.',
      addsComponents: ['monitoring'],
      alternatives: [
        { option: 'Single providers + apology script', whyNot: `Caps availability at the provider's own (usually ~99.9% at best) minus your own failures — arithmetic, not pessimism.` },
      ],
      confidence: 'high',
    })
  } else {
    d({
      requirement: `${(req.availabilityTarget * 100).toFixed(1)}% availability.`,
      constraint: 'Still ~7 hours of allowed downtime a month — but callers experience every minute of it live.',
      decision: 'Timeouts and retries everywhere, one fallback TTS (silence is the worst failure), monitoring from day one; accept single vendors for STT/LLM.',
      tradeoff: 'A bad provider day becomes your bad day. Written down and accepted.',
      addsComponents: ['monitoring'],
      alternatives: [{ option: 'Full multi-vendor redundancy', whyNot: 'Cost and complexity the availability target does not justify yet.' }],
      confidence: 'medium',
    })
  }

  // -- Handoff ---------------------------------------------------------------
  if (req.humanHandoff) {
    d({
      requirement: 'Escalate to humans when the AI reaches its limits.',
      constraint: 'Handoff is a distributed transaction across routing (find an agent), media (move audio) and context (move the conversation) — each leg fails independently.',
      decision: 'Human agent tier with skill-based routing, queue with honest wait estimates, warm transfer (bridge + whisper), context screen-pop, and an explicit no-agent fallback (callback booking).',
      tradeoff: 'Humans are the most expensive component per minute in the system (~50× the AI cost, assumption) and scale by hiring, not autoscaling. The escalation threshold becomes a core cost lever.',
      addsComponents: ['human-agent'],
      alternatives: [
        { option: 'Blind transfer (SIP REFER and hope)', whyNot: 'No availability check, no context: the two ingredients of the worst customer experience in telephony.' },
      ],
      confidence: 'high',
    })
  }

  // -- Recording -------------------------------------------------------------
  if (req.recording) {
    d({
      requirement: 'Record calls' + (req.compliance.length ? ` (${req.compliance.join(', ')} labelled as educational considerations)` : '') + '.',
      constraint: 'Recordings are large, long-lived, and must never block the live path or die with a server.',
      decision: 'Fork media at the gateway into a local ring buffer → async upload to object storage via the queue → lifecycle policies for retention.',
      tradeoff: 'Storage accumulates as volume × retention: the Cost Simulator shows retention policy as a first-class budget dial.',
      addsComponents: ['object-storage'],
      alternatives: [{ option: 'Provider-side recording', whyNot: 'Simplest with a CPaaS — take it if offered; the pipeline above is for when you terminate media yourself.' }],
      confidence: 'high',
    })
  }

  // -- Cost posture ----------------------------------------------------------
  if (cheap) {
    d({
      requirement: 'Low-cost posture at ' + req.callsPerDay.toLocaleString() + ' calls/day.',
      constraint: 'Per-minute meters (STT, TTS characters, telephony, LLM tokens) dominate at volume; capacity costs dominate at low volume.',
      decision: 'Standard-tier TTS voice, small fast LLM with ruthless context trimming, self-hosted STT evaluated at the volume crossover, shortest-path prompts to cut call length.',
      tradeoff: 'A less premium voice and less reasoning headroom. A/B answer-rates before locking it in.',
      addsComponents: [],
      alternatives: [{ option: 'Premium voices + flagship LLM', whyNot: 'The Cost Simulator shows these two lines dominating the per-call cost at this volume.' }],
      confidence: 'medium',
    })
  }

  // -- Build the architecture ------------------------------------------------
  const architecture = buildFromDecisions(req, decisions, plan)

  return {
    decisions,
    architecture,
    assumptions: [
      ...plan.assumptions,
      'Latency and price figures used in this reasoning are simulation assumptions — the chains of reasoning survive different numbers; re-run with your own.',
    ],
    summary: `${plan.tierLabel} · ${decisions.length} explicit decisions · every component traces to a requirement`,
  }
}

function downtimeBudget(a: number): string {
  const minutesPerMonth = (1 - a) * 30 * 24 * 60
  return minutesPerMonth >= 60
    ? `~${(minutesPerMonth / 60).toFixed(1)} h/month allowed downtime`
    : `~${minutesPerMonth.toFixed(0)} min/month allowed downtime`
}

function buildFromDecisions(
  req: Requirements,
  decisions: DecisionRecord[],
  plan: ReturnType<typeof planInfrastructure>,
): Architecture {
  const specs = new Set(decisions.flatMap((d) => d.addsComponents))
  const b = new ArchBuilder(
    `decided-${Date.now()}`,
    `Proposed: ${req.name}`,
    `Architecture derived from requirements by the decision engine. Every component traces to a decision record.`,
    req,
  )
  /**
   * How many units of a component the design needs.
   *
   * Prefer the infrastructure plan's figure; otherwise derive it from the
   * component's own capacity assumption with 30% headroom. The fallback matters:
   * the plan only names some tiers explicitly, and defaulting the rest to 1
   * silently produced architectures that the validator (correctly) flagged as
   * saturated the moment they were generated.
   *
   * For managed providers a "replica" reads as a unit of provisioned quota —
   * which is exactly the capacity conversation you must have with them.
   */
  const inst = (specId: string) => {
    const planned = plan.components.find((c) => c.specId === specId)?.instances
    if (planned) return planned
    const capacity = getSpec(specId).scaling.capacityPerInstance
    if (!capacity || capacity <= 0) return 1
    return Math.max(1, Math.ceil(req.peakConcurrentCalls / capacity / 0.7))
  }

  const phone = req.channel !== 'browser'
  const browser = req.channel !== 'phone'

  const user = phone ? b.node('user', { col: 0, row: 1 }) : null
  const brow = browser ? b.node('browser', { col: 0, row: phone ? 2 : 1 }) : null
  const tel = specs.has('telephony') ? b.node('telephony', { col: 1, row: 1, replicas: inst('telephony') }) : null
  const rtc = specs.has('webrtc') ? b.node('webrtc', { col: 1, row: phone ? 2 : 1, replicas: inst('webrtc') }) : null
  const lb = specs.has('load-balancer') ? b.node('load-balancer', { col: 2, row: 1, replicas: Math.max(2, Math.min(4, inst('load-balancer'))) }) : null
  const gw = b.node('media-gateway', { col: 3, row: 1, replicas: inst('media-gateway') })
  const vad = specs.has('vad') ? b.node('vad', { col: 4, row: 0, replicas: inst('vad') }) : null
  const s2s = specs.has('s2s') ? b.node('s2s', { col: 5, row: 2, replicas: inst('s2s') }) : null
  const stt = specs.has('stt') ? b.node('stt', { col: 4, row: 1, replicas: inst('stt'), config: req.regions.includes('in-mumbai') && req.languages.some((l) => l.startsWith('hi')) ? { provider: 'stt-indic' } : {} }) : null
  const rt = specs.has('agent-runtime') ? b.node('agent-runtime', { col: 5, row: 1, replicas: inst('agent-runtime') }) : null
  const llm = specs.has('llm') ? b.node('llm', { col: 6, row: 1, replicas: inst('llm'), config: req.budgetPosture === 'premium' ? { provider: 'llm-flagship' } : {} }) : null
  const tool = b.node('tool-api', { col: 6, row: 0, replicas: inst('tool-api') })
  const tts = specs.has('tts') ? b.node('tts', { col: 4, row: 2, replicas: inst('tts'), config: req.budgetPosture === 'low-cost' ? { provider: 'tts-cloud-standard' } : {} }) : null
  const redis = specs.has('redis') ? b.node('redis', { col: 7, row: 0, replicas: Math.max(2, inst('redis')) }) : null
  const pg = b.node('postgres', { col: 7, row: 1, replicas: req.availabilityTarget >= 0.999 ? 2 : 1 })
  const q = specs.has('queue') ? b.node('queue', { col: 7, row: 2, replicas: req.availabilityTarget >= 0.999 ? 2 : 1 }) : null
  const store = specs.has('object-storage') ? b.node('object-storage', { col: 8, row: 2 }) : null
  const mon = specs.has('monitoring') ? b.node('monitoring', { col: 8, row: 0 }) : null
  // Seats sized for ~75% target occupancy on the escalated share — staffing to
  // 100% occupancy makes queue waits explode (Erlang C), so it is never a plan.
  const human = specs.has('human-agent')
    ? b.node('human-agent', { col: 8, row: 1, replicas: Math.max(3, Math.ceil((req.peakConcurrentCalls * 0.1) / 0.75)) })
    : null
  const k8s = specs.has('kubernetes') ? b.node('kubernetes', { col: 2, row: 0 }) : null

  if (user && tel) b.connect(user, tel, { protocol: 'PSTN', type: 'streaming', direction: 'bi', label: 'phone call' })
  if (brow && rtc) b.connect(brow, rtc, { protocol: 'WebRTC', type: 'persistent', direction: 'bi', label: 'Opus/SRTP' })
  if (tel) b.connect(tel, lb ?? gw, { protocol: 'WebSocket', type: 'persistent', direction: 'bi', label: 'media stream' })
  if (rtc) b.connect(rtc, lb ?? gw, { protocol: 'RTP', type: 'streaming', direction: 'bi' })
  if (lb) b.connect(lb, gw, { protocol: 'WebSocket', type: 'persistent', direction: 'bi', label: 'sticky per call' })
  if (vad) b.connect(gw, vad, { type: 'streaming', direction: 'uni', label: 'PCM frames' })
  if (stt) b.connect(gw, stt, { protocol: 'WebSocket', type: 'streaming', direction: 'bi', label: 'audio ↑ / transcripts ↓' })
  if (s2s) b.connect(gw, s2s, { protocol: 'WebSocket', type: 'persistent', direction: 'bi', label: 'audio ↑ / audio ↓ (fallback: pipeline)' })
  if (stt && rt) b.connect(stt, rt, { type: 'streaming', direction: 'uni', label: 'transcripts' })
  if (rt && llm) b.connect(rt, llm, { protocol: 'HTTP/2', type: 'streaming', direction: 'bi', label: 'prompt / tokens' })
  if (rt) b.connect(rt, tool, { protocol: 'HTTP', type: 'sync', plane: 'control', label: 'tool calls (timeout 1.5s)' })
  if (llm && tts && rt) b.connect(rt, tts, { protocol: 'WebSocket', type: 'streaming', direction: 'uni', label: 'sentences' })
  if (tts) b.connect(tts, gw, { type: 'streaming', direction: 'uni', label: 'audio chunks' })
  if (rt && redis) b.connect(rt, redis, { protocol: 'Redis', type: 'sync', plane: 'control', label: 'session state @ turn boundaries' })
  if (rt) b.connect(rt, q ?? pg, q ? { protocol: 'AMQP', type: 'async', plane: 'control', label: 'side effects' } : { protocol: 'SQL', type: 'async', plane: 'control' })
  b.connect(tool, pg, { protocol: 'SQL', type: 'sync', plane: 'control', label: 'reads (pooled)' })
  if (q) {
    b.connect(q, pg, { protocol: 'SQL', type: 'async', plane: 'control', label: 'transcripts, CDRs' })
    if (store) b.connect(q, store, { protocol: 'HTTP', type: 'async', plane: 'control', label: 'recording uploads' })
  }
  if (gw && store && !q) b.connect(gw, store, { protocol: 'HTTP', type: 'async', plane: 'control', label: 'recordings (async)' })
  if (human) {
    b.connect(gw, human, { type: 'streaming', direction: 'bi', plane: 'media', label: 'warm transfer bridge' })
    if (rt) b.connect(rt, human, { type: 'control', plane: 'control', label: 'context packet / screen-pop' })
  }
  if (mon && rt) b.connect(rt, mon, { type: 'async', plane: 'control', label: 'metrics/traces (fire-and-forget)' })
  if (mon) b.connect(gw, mon, { type: 'async', plane: 'control' })
  if (k8s) b.connect(k8s, gw, { type: 'control', plane: 'control', label: 'orchestration' })

  b.assume(...plan.assumptions)
  return b.build()
}
