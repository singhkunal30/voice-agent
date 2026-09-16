/**
 * Architecture validation.
 *
 * Every rule encodes a real engineering principle, and every finding explains
 * itself: what was detected, why it matters in a voice system specifically,
 * how to fix it, and the principle behind the rule. The validator is used by
 * the Architecture Builder, the Challenge evaluator and the Decision Lab.
 */

import type { Architecture, Requirements, ValidationIssue } from '../domain/types'
import { getSpec } from '../registry/components'
import { detectBottlenecks } from '../models/scaling'

type Rule = (arch: Architecture, req?: Requirements) => ValidationIssue[]

const bySpec = (arch: Architecture, specId: string) => arch.nodes.filter((n) => n.specId === specId)
const has = (arch: Architecture, specId: string) => bySpec(arch, specId).length > 0

function neighbours(arch: Architecture, nodeId: string): { inbound: string[]; outbound: string[] } {
  return {
    inbound: arch.edges.filter((e) => e.target === nodeId).map((e) => e.source),
    outbound: arch.edges.filter((e) => e.source === nodeId).map((e) => e.target),
  }
}

/** Nodes reachable from media-path endpoints following media-plane edges. */
function mediaPathNodes(arch: Architecture): Set<string> {
  const media = new Set<string>()
  const starts = arch.nodes.filter((n) => {
    const s = getSpec(n.specId)
    return s.category === 'endpoint' || s.id === 'telephony'
  })
  const queue = starts.map((n) => n.id)
  while (queue.length) {
    const id = queue.pop()!
    if (media.has(id)) continue
    media.add(id)
    for (const e of arch.edges) {
      if (e.plane !== 'media') continue
      if (e.source === id && !media.has(e.target)) queue.push(e.target)
      if (e.direction === 'bi' && e.target === id && !media.has(e.source)) queue.push(e.source)
    }
  }
  return media
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const ruleSinglePointOfFailure: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  for (const node of arch.nodes) {
    const spec = getSpec(node.specId)
    if (spec.category === 'endpoint' || spec.category === 'human') continue
    if (spec.scaling.axis === 'managed-external') continue // provider redundancy is a separate rule
    const critical = spec.onMediaPath || ['redis', 'postgres', 'load-balancer'].includes(spec.id)
    if (node.replicas <= 1 && critical) {
      issues.push({
        ruleId: 'spof',
        severity: 'warning',
        title: `Single point of failure: ${node.label}`,
        targets: [node.id],
        detected: `${node.label} runs as a single replica and sits on a critical path.`,
        why:
          spec.onMediaPath
            ? `Voice connections are long-lived: when this instance dies, every call it carries drops mid-sentence — the blast radius is its concurrent call count, not "a few failed requests" like a web app.`
            : `${node.label} holds state or routing that live calls depend on; one instance means one failure away from platform-wide impact.`,
        fix: `Run at least 2 replicas${spec.scaling.stickySessions ? ' and keep session state external so calls can be re-adopted' : ' behind the load balancer'}.`,
        principle: 'Anything on a critical path must survive the loss of any single instance (N+1).',
      })
    }
  }
  return issues
}

const ruleDbOnMediaPath: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  const media = mediaPathNodes(arch)
  for (const node of arch.nodes) {
    const spec = getSpec(node.specId)
    if (!['postgres', 'kafka', 'queue', 'object-storage'].includes(spec.id)) continue
    const onMedia = arch.edges.some(
      (e) => e.plane === 'media' && (e.source === node.id || e.target === node.id),
    ) || (media.has(node.id) && spec.id === 'postgres')
    if (onMedia) {
      issues.push({
        ruleId: 'db-on-media-path',
        severity: 'error',
        title: `${node.label} is wired into the real-time media path`,
        targets: [node.id],
        detected: `A media-plane connection touches ${node.label}.`,
        why:
          `Audio frames arrive every 20 ms and must be processed in under 20 ms. ${node.label} has millisecond-to-second tail latencies and can stall entirely — one slow query becomes stuttering audio for every caller on that server. Real-time media must never wait on slow storage.`,
        fix: `Move ${node.label} to the control plane: media components read session state from memory/Redis at turn boundaries, and durable writes go through the queue asynchronously.`,
        principle: 'Real-time media should not wait on slow database operations.',
      })
    }
  }
  return issues
}

const ruleBlockingInMediaPath: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  for (const edge of arch.edges) {
    if (edge.plane !== 'media') continue
    if (edge.type === 'sync' && !edge.streaming) {
      const src = arch.nodes.find((n) => n.id === edge.source)
      const tgt = arch.nodes.find((n) => n.id === edge.target)
      if (!src || !tgt) continue
      const tgtSpec = getSpec(tgt.specId)
      if (['stt', 'tts', 'llm', 's2s'].includes(tgtSpec.id)) {
        issues.push({
          ruleId: 'blocking-media',
          severity: 'warning',
          title: `Non-streaming connection to ${tgt.label} on the media path`,
          targets: [edge.id, tgt.id],
          detected: `${src.label} → ${tgt.label} is request/response instead of streaming.`,
          why: `A batch hop here serialises work that streaming would overlap: for STT it means nothing happens until the user finishes; for TTS it means silence until the whole reply is synthesised. Perceived latency pays the full price.`,
          fix: `Use the streaming variant of ${tgt.label} (WebSocket/gRPC stream) so downstream stages start before upstream ones finish.`,
          principle: 'Streaming should be used when latency requirements justify it — and on the media path they almost always do.',
        })
      }
    }
  }
  return issues
}

const ruleFormatMismatch: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  for (const edge of arch.edges) {
    if (edge.plane !== 'media') continue
    const src = arch.nodes.find((n) => n.id === edge.source)
    const tgt = arch.nodes.find((n) => n.id === edge.target)
    if (!src || !tgt) continue
    const out = getSpec(src.specId).audioOut
    const inn = getSpec(tgt.specId).audioIn
    if (out && inn && (out.encoding !== inn.encoding || out.sampleRate !== inn.sampleRate)) {
      const hasGateway = [src.specId, tgt.specId].includes('media-gateway')
      if (!hasGateway) {
        issues.push({
          ruleId: 'audio-format-mismatch',
          severity: 'warning',
          title: `Audio format mismatch: ${src.label} → ${tgt.label}`,
          targets: [edge.id],
          detected: `${src.label} emits ${out.encoding} @ ${out.sampleRate / 1000} kHz but ${tgt.label} expects ${inn.encoding} @ ${inn.sampleRate / 1000} kHz, with no gateway between them.`,
          why: `Someone must convert — implicitly (a hidden resample inside an SDK, unaccounted latency) or not at all (garbled audio, silent failures). Sample-rate mismatches are the classic “it works but accuracy is mysteriously bad” bug.`,
          fix: `Route this hop through the media gateway, which owns format conversion explicitly, or configure both ends to a common format.`,
          principle: 'Audio format conversions have consequences; make every conversion explicit and owned.',
        })
      }
    }
  }
  return issues
}

const ruleNoFallbackForProviders: Rule = (arch, req) => {
  const issues: ValidationIssue[] = []
  const wantHighAvailability = (req?.availabilityTarget ?? 0.99) >= 0.999
  for (const specId of ['stt', 'tts', 'llm']) {
    const nodes = bySpec(arch, specId)
    if (nodes.length === 1 && wantHighAvailability) {
      const spec = getSpec(specId)
      issues.push({
        ruleId: 'no-provider-fallback',
        severity: 'warning',
        title: `No fallback for ${spec.short}`,
        targets: nodes.map((n) => n.id),
        detected: `One ${spec.short} provider, and the availability target is ${((req?.availabilityTarget ?? 0.999) * 100).toFixed(2)}%.`,
        why: `External providers fail — routinely, and independently of you. A single ${spec.short} dependency caps your availability at theirs; 99.9% needs every critical dependency to be either redundant or better than 99.9% itself.`,
        fix: `Add a second ${spec.short} node as fallback (different vendor), pre-connected, with an automatic switch on error/timeout.`,
        principle: 'External providers can fail; every one of them on the critical path needs a fallback or an accepted, written-down risk.',
      })
    }
  }
  return issues
}

const ruleConnectionAwareScaling: Rule = (arch, req) => {
  const issues: ValidationIssue[] = []
  const concurrent = req?.peakConcurrentCalls ?? 0
  for (const node of arch.nodes) {
    const spec = getSpec(node.specId)
    if (spec.scaling.axis !== 'connection-aware') continue
    const capacity = Number(node.config['callsPerInstance'] ?? spec.scaling.capacityPerInstance) * node.replicas
    if (concurrent > 0 && concurrent > capacity) {
      issues.push({
        ruleId: 'connection-capacity',
        severity: 'error',
        title: `${concurrent.toLocaleString()} persistent connections into ${node.replicas} × ${node.label}`,
        targets: [node.id],
        detected: `${node.label}: capacity ${capacity.toLocaleString()} (${node.replicas} × ${node.config['callsPerInstance'] ?? spec.scaling.capacityPerInstance}) < offered ${concurrent.toLocaleString()}.`,
        why: `Long-lived connections cannot be time-sliced like web requests: each concurrent call occupies memory, CPU and a socket for its entire duration. Offering more connections than capacity means refused or dropped calls, not graceful slowdown.`,
        fix: `Increase replicas to ~${Math.ceil(concurrent / (Number(node.config['callsPerInstance'] ?? spec.scaling.capacityPerInstance) * 0.7))} (70% headroom), and autoscale on connection count.`,
        principle: 'Persistent connections require connection-aware scaling.',
      })
    }
    if (concurrent > 200 && node.replicas > 1 && !has(arch, 'load-balancer')) {
      issues.push({
        ruleId: 'no-lb',
        severity: 'warning',
        title: 'Replicas without a load balancer',
        targets: [node.id],
        detected: `${node.label} has ${node.replicas} replicas but nothing distributes connections across them.`,
        why: 'Something must place each new call on a healthy replica and stop routing to dead ones.',
        fix: 'Add a load balancer (or connection broker) in front of the replicated tier.',
        principle: 'Horizontal scaling requires a distribution mechanism.',
      })
    }
  }
  return issues
}

const ruleMissingObservability: Rule = (arch, req) => {
  if (has(arch, 'monitoring')) return []
  if ((req?.peakConcurrentCalls ?? 0) < 25 && arch.nodes.length < 6) return []
  return [
    {
      ruleId: 'no-observability',
      severity: 'warning',
      title: 'No observability stack',
      targets: [],
      detected: 'The architecture has no monitoring/metrics/tracing component.',
      why:
        'Voice failures are latency failures: “the agent feels slow” is undiagnosable without per-stage latency histograms. You cannot tune endpointing, spot a degrading STT provider, or prove an SLO without telemetry.',
      fix: 'Add the observability component; instrument every pipeline stage with per-turn spans and per-call structured logs.',
      principle: 'Observability is required for diagnosing latency — it is part of the architecture, not an add-on.',
    },
  ]
}

const ruleMissingTimeouts: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  const toolNodes = bySpec(arch, 'tool-api')
  for (const node of toolNodes) {
    const timeout = Number(node.config['timeoutMs'] ?? 0)
    if (!timeout || timeout <= 0) {
      issues.push({
        ruleId: 'missing-timeout',
        severity: 'error',
        title: `${node.label} has no timeout`,
        targets: [node.id],
        detected: `Tool/external API node without a configured timeout budget.`,
        why: 'A hung dependency without a timeout hangs the conversation forever: the caller hears infinite silence, the session leaks, and the media server holds resources for a zombie call.',
        fix: 'Set an explicit timeout (voice budgets: 1–2 s for blocking reads), plus a spoken degradation path.',
        principle: 'Every external dependency must have timeout behavior.',
      })
    } else if (timeout > 4000) {
      issues.push({
        ruleId: 'timeout-too-long',
        severity: 'warning',
        title: `${node.label} timeout (${timeout} ms) exceeds any voice budget`,
        targets: [node.id],
        detected: `Timeout of ${timeout} ms on a tool that runs inside live turns.`,
        why: 'A timeout you cannot afford to wait for is not protection. If the budget fires, the caller has already sat through seconds of dead air.',
        fix: 'Cut the timeout to ≤2000 ms and add spoken filler at ~900 ms; move genuinely slow operations to async + callback.',
        principle: 'Timeouts must fit inside the conversational budget, not just exist.',
      })
    }
  }
  return issues
}

const ruleUnboundedQueue: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  for (const node of bySpec(arch, 'queue')) {
    const consumers = neighbours(arch, node.id).outbound
    if (consumers.length === 0) {
      issues.push({
        ruleId: 'unbounded-queue',
        severity: 'warning',
        title: `${node.label} has producers but no consumers`,
        targets: [node.id],
        detected: 'Messages flow into the queue and nothing drains it.',
        why: 'A queue without consumers is an unbounded buffer: depth grows monotonically until retention limits drop data or the broker falls over. Queues defer work; they do not perform it.',
        fix: 'Connect worker/consumer components (or the systems that process the messages) downstream of the queue.',
        principle: 'Async workloads need consumers scaled to the production rate; queue depth must have an equilibrium.',
      })
    }
  }
  return issues
}

const ruleHandoffState: Rule = (arch, req) => {
  if (!req?.humanHandoff) return []
  const issues: ValidationIssue[] = []
  if (!has(arch, 'human-agent')) {
    issues.push({
      ruleId: 'missing-handoff',
      severity: 'error',
      title: 'Requirements demand human handoff; architecture has no human tier',
      targets: [],
      detected: 'humanHandoff = true in the requirements, no Human Agent component in the graph.',
      why: 'Handoff is a state transition with routing, media re-anchoring and context transfer — it needs a destination (agents), a queue policy and failure branches. It cannot be bolted on at the end.',
      fix: 'Add the Human Agent component, connect the media gateway (media plane) and the agent runtime (context, control plane) to it.',
      principle: 'Human handoff is a state transition, not merely a phone transfer.',
    })
  } else {
    const human = bySpec(arch, 'human-agent')[0]
    const n = neighbours(arch, human.id)
    const connected = n.inbound.length + n.outbound.length
    if (connected < 2) {
      issues.push({
        ruleId: 'handoff-context',
        severity: 'warning',
        title: 'Human agent connected on one plane only',
        targets: [human.id],
        detected: `Human Agent has ${connected} connection(s); a working handoff needs both the media leg AND the context/CRM leg.`,
        why: 'Media without context = the caller repeats everything (the #1 handoff complaint). Context without media = a screen-pop and no call.',
        fix: 'Connect the media gateway to the human (media plane) and the runtime/CRM to the human (control plane).',
        principle: 'A handoff moves audio and conversation state; both paths must exist.',
      })
    }
  }
  return issues
}

const ruleRecording: Rule = (arch, req) => {
  if (!req?.recording) return []
  if (has(arch, 'object-storage')) return []
  return [
    {
      ruleId: 'missing-recording-storage',
      severity: 'warning',
      title: 'Recording required but no object storage present',
      targets: [],
      detected: 'requirements.recording = true; no storage component for the recordings.',
      why: 'Recordings are large, long-lived blobs with retention obligations. Without a designed store they end up on server disks — which fill, and die with the instance.',
      fix: 'Add object storage; fork media at the gateway and upload asynchronously via the queue.',
      principle: 'Recording is a data pipeline (fork → buffer → async upload → lifecycle), not a checkbox.',
    },
  ]
}

const ruleSessionState: Rule = (arch, req) => {
  const concurrent = req?.peakConcurrentCalls ?? 0
  const gateways = [...bySpec(arch, 'media-gateway'), ...bySpec(arch, 'agent-runtime')]
  const replicated = gateways.some((g) => g.replicas > 1)
  if ((concurrent > 100 || replicated) && !has(arch, 'redis')) {
    return [
      {
        ruleId: 'state-ownership',
        severity: 'warning',
        title: 'Replicated call servers with no external session state',
        targets: gateways.map((g) => g.id),
        detected: `${replicated ? 'Multiple gateway/runtime replicas' : `${concurrent} concurrent calls`} and no Redis/state tier.`,
        why: 'With state trapped in process memory, every deploy and every crash lobotomises its calls, and no other instance can adopt a dropped connection. State needs an explicit owner that outlives the process.',
        fix: 'Add Redis; write session state at turn boundaries; treat any gateway instance as disposable.',
        principle: 'State should have explicit ownership — and for live calls, that owner must survive instance death.',
      },
    ]
  }
  return []
}

const ruleMultiRegionLatency: Rule = (arch, req) => {
  if (!req) return []
  const issues: ValidationIssue[] = []
  if (req.regions.length > 1) {
    const regionsUsed = new Set(arch.nodes.map((n) => n.region).filter(Boolean))
    if (regionsUsed.size <= 1) {
      issues.push({
        ruleId: 'single-region-for-multi',
        severity: 'warning',
        title: `Requirements span ${req.regions.length} regions; deployment is single-region`,
        targets: [],
        detected: `Users in ${req.regions.join(', ')} but all components in one region.`,
        why: `Cross-continent media round trips add 100–200 ms that no software can remove — straight onto perceived latency for the far users, on every single turn.`,
        fix: 'Deploy media gateways (at minimum) per region; keep media regional, replicate only durable data.',
        principle: 'Multi-region architecture trades operational complexity for physics; when users are global, physics wins.',
      })
    }
  }
  if (req.latencyTargetMs < 500 && bySpec(arch, 'stt').some((n) => String(n.config['provider'] ?? '').includes('batch'))) {
    issues.push({
      ruleId: 'batch-stt-latency',
      severity: 'error',
      title: 'Batch STT cannot meet the latency target',
      targets: bySpec(arch, 'stt').map((n) => n.id),
      detected: `Latency target ${req.latencyTargetMs} ms with a batch STT profile.`,
      why: 'Batch recognition starts only when the user stops talking and takes O(utterance length). The target is arithmetically unreachable.',
      fix: 'Use a streaming STT profile so recognition overlaps with speech.',
      principle: 'Streaming should be used when latency requirements justify it.',
    })
  }
  return issues
}

const ruleTranscodingWaste: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  const gws = bySpec(arch, 'media-gateway')
  if (gws.length > 2) {
    issues.push({
      ruleId: 'unnecessary-transcoding',
      severity: 'warning',
      title: `${gws.length} media gateways in one path`,
      targets: gws.map((g) => g.id),
      detected: 'Multiple media gateway hops chained together.',
      why: 'Each gateway hop is a decode/encode boundary: latency, CPU and (for lossy codecs) quality paid again. One gateway should own all conversions per region.',
      fix: 'Collapse to one gateway per media path; the Audio Lab shows exactly what each extra hop costs.',
      principle: 'Unnecessary transcoding spends latency and quality on nothing.',
    })
  }
  return issues
}

const ruleEndpointsPresent: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  const hasUser = has(arch, 'user') || has(arch, 'browser')
  if (!hasUser) {
    issues.push({
      ruleId: 'no-endpoint',
      severity: 'error',
      title: 'No user endpoint',
      targets: [],
      detected: 'The architecture has no User or Browser node.',
      why: 'Someone has to be on the call. Without an endpoint the media path has no source or sink and nothing can be simulated.',
      fix: 'Add a User (phone) or Browser endpoint and connect it to the edge (telephony or WebRTC).',
      principle: 'Architecture diagrams start from the user, always.',
    })
  }
  const hasBrain = has(arch, 'llm') || has(arch, 's2s')
  if (!hasBrain) {
    issues.push({
      ruleId: 'no-intelligence',
      severity: 'error',
      title: 'No intelligence component',
      targets: [],
      detected: 'Neither an LLM nor a speech-to-speech model is present.',
      why: 'Without a reasoning component this is an audio pipe, not an agent.',
      fix: 'Add an LLM (composed pipeline) or an S2S model.',
      principle: 'A voice agent = transport + speech + intelligence + state.',
    })
  }
  // Orphan check
  for (const node of arch.nodes) {
    const n = neighbours(arch, node.id)
    if (n.inbound.length === 0 && n.outbound.length === 0 && arch.nodes.length > 1) {
      issues.push({
        ruleId: 'orphan',
        severity: 'info',
        title: `${node.label} is not connected to anything`,
        targets: [node.id],
        detected: 'Component present but unwired.',
        why: 'Unconnected components do nothing in the simulation and usually indicate an unfinished thought.',
        fix: `Connect ${node.label} into the data/media flow, or remove it.`,
        principle: 'Every box earns its place by carrying a flow.',
      })
    }
  }
  return issues
}

const rulePipelineOrder: Rule = (arch) => {
  const issues: ValidationIssue[] = []
  // STT must be able to reach the LLM; LLM must reach TTS (composed pipelines).
  if (has(arch, 'stt') && has(arch, 'llm')) {
    const reach = reachable(arch, bySpec(arch, 'stt')[0].id)
    if (!bySpec(arch, 'llm').some((n) => reach.has(n.id))) {
      issues.push({
        ruleId: 'pipeline-break',
        severity: 'error',
        title: 'Transcripts cannot reach the LLM',
        targets: [bySpec(arch, 'stt')[0].id],
        detected: 'No directed path from STT to the LLM.',
        why: 'The recognised text has nowhere to go; the agent hears but cannot think.',
        fix: 'Wire STT → agent runtime → LLM (or STT → LLM directly in a minimal design).',
        principle: 'Data flow must be complete: audio → text → reasoning → text → audio.',
      })
    }
  }
  if (has(arch, 'llm') && has(arch, 'tts')) {
    const reach = reachable(arch, bySpec(arch, 'llm')[0].id)
    if (!bySpec(arch, 'tts').some((n) => reach.has(n.id))) {
      issues.push({
        ruleId: 'pipeline-break-tts',
        severity: 'error',
        title: 'LLM output cannot reach the TTS',
        targets: [bySpec(arch, 'llm')[0].id],
        detected: 'No directed path from LLM to TTS.',
        why: 'The agent thinks but cannot speak.',
        fix: 'Wire LLM → TTS (usually via the agent runtime).',
        principle: 'Data flow must be complete: audio → text → reasoning → text → audio.',
      })
    }
  }
  return issues
}

function reachable(arch: Architecture, from: string): Set<string> {
  const seen = new Set<string>()
  const queue = [from]
  while (queue.length) {
    const id = queue.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of arch.edges) {
      if (e.source === id && !seen.has(e.target)) queue.push(e.target)
      if (e.direction === 'bi' && e.target === id && !seen.has(e.source)) queue.push(e.source)
    }
  }
  return seen
}

const ruleBottlenecks: Rule = (arch, req) => {
  if (!req) return []
  return detectBottlenecks(arch, req.peakConcurrentCalls).map((b) => ({
    ruleId: 'bottleneck',
    severity: b.severity === 'critical' ? ('error' as const) : ('warning' as const),
    title: `Bottleneck: ${b.label} at ${(b.utilisation * 100).toFixed(0)}% utilisation`,
    targets: [b.nodeId],
    detected: `Offered ${b.offered.toLocaleString()} vs capacity ${b.capacity.toLocaleString()}.`,
    why: b.why + ' ' + b.consequences[0],
    fix: b.remedies[0],
    principle: 'Concurrency matters heavily in voice systems: capacity is planned per concurrent call, with headroom.',
  }))
}

// ---------------------------------------------------------------------------

export const ALL_RULES: Rule[] = [
  ruleEndpointsPresent,
  rulePipelineOrder,
  ruleDbOnMediaPath,
  ruleBlockingInMediaPath,
  ruleFormatMismatch,
  ruleSinglePointOfFailure,
  ruleNoFallbackForProviders,
  ruleConnectionAwareScaling,
  ruleSessionState,
  ruleMissingTimeouts,
  ruleUnboundedQueue,
  ruleHandoffState,
  ruleRecording,
  ruleMissingObservability,
  ruleMultiRegionLatency,
  ruleTranscodingWaste,
  ruleBottlenecks,
]

export function validateArchitecture(arch: Architecture, req?: Requirements): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const rule of ALL_RULES) {
    try {
      issues.push(...rule(arch, req ?? arch.requirements))
    } catch {
      // A rule crashing must never take the validator down.
    }
  }
  const order = { error: 0, warning: 1, info: 2 }
  return issues.sort((a, b) => order[a.severity] - order[b.severity])
}
