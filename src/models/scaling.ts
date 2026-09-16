/**
 * Infrastructure, resources, bottlenecks, autoscaling and traffic.
 *
 * Three related models live here:
 *
 *  1. `computeResources` — given an architecture and an offered load, work out
 *     per-node utilisation and detect bottlenecks.
 *  2. `planInfrastructure` — given requirements, derive the infrastructure
 *     tier and instance counts (the Scaling Lab's engine).
 *  3. `simulateTraffic` / autoscaling — a deterministic tick simulation that
 *     produces the time series behind the Observability dashboard, the chaos
 *     lab and the autoscaling lab.
 *
 * All capacities are SIMULATION ASSUMPTIONS from the component registry,
 * surfaced and editable in the UI.
 */

import type {
  Architecture,
  Bottleneck,
  Requirements,
  ResourceUsage,
  RegionId,
} from '../domain/types'
import { getSpec } from '../registry/components'
import { Rng } from '../engine/rng'
import { round } from '../engine/simulation'

// ---------------------------------------------------------------------------
// Resource usage & bottlenecks
// ---------------------------------------------------------------------------

/**
 * Components whose capacity is not denominated in concurrent calls at all.
 *
 * The orchestrator's capacity is pods per cluster; the observability stack's is
 * events per second. Dividing concurrent calls by those numbers produces a
 * meaningless "utilisation", so they are excluded from call-based capacity
 * analysis rather than being given a fictional share of the call load.
 */
const NOT_CALL_SCALED = new Set(['kubernetes', 'monitoring'])

/** Fraction of total call load that flows through a given component category. */
function loadShare(specId: string): number {
  // Tools/DB see a fraction of turns; everything on the media path sees all calls.
  switch (specId) {
    case 'postgres':
      return 0.4
    case 'queue':
    case 'kafka':
      return 1 // async events per call, but cheap per event
    case 'redis':
      return 1
    case 'tool-api':
      return 0.5
    case 'human-agent':
      return 0.1
    default:
      return 1
  }
}

export function computeResources(arch: Architecture, concurrentCalls: number): ResourceUsage[] {
  const usages: ResourceUsage[] = []
  for (const node of arch.nodes) {
    const spec = getSpec(node.specId)
    if (spec.category === 'endpoint') continue
    if (NOT_CALL_SCALED.has(spec.id)) continue
    const capPerInstance = Number(node.config['callsPerInstance'] ?? spec.scaling.capacityPerInstance)
    const instances = Math.max(1, node.replicas)
    const offered = concurrentCalls * loadShare(spec.id)
    const capacity = capPerInstance * instances
    const utilisation = capacity > 0 ? offered / capacity : Infinity
    const r = spec.resources
    usages.push({
      nodeId: node.id,
      label: node.label,
      instances,
      capacityPerInstance: capPerInstance,
      offered: round(offered, 0),
      capacity,
      utilisation: round(utilisation, 3),
      cpuCores: round((r.baseCpu ?? 0) * instances + (r.cpuPerCall ?? 0) * Math.min(offered, capacity), 1),
      memMb: Math.round((r.baseMemMb ?? 0) * instances + (r.memMbPerCall ?? 0) * Math.min(offered, capacity)),
      netKbps: Math.round((r.netKbpsPerCall ?? 0) * Math.min(offered, capacity)),
      connections: Math.round((r.fdPerCall ?? 0) * Math.min(offered, capacity)),
      bottleneck: utilisation > 0.8,
      scalingAxis: spec.scaling.axis,
    })
  }
  return usages.sort((a, b) => b.utilisation - a.utilisation)
}

export function detectBottlenecks(arch: Architecture, concurrentCalls: number): Bottleneck[] {
  const usages = computeResources(arch, concurrentCalls)
  const out: Bottleneck[] = []
  for (const u of usages) {
    if (u.utilisation <= 0.8) continue
    const node = arch.nodes.find((n) => n.id === u.nodeId)
    const spec = node ? getSpec(node.specId) : undefined
    const critical = u.utilisation >= 1
    const why =
      u.scalingAxis === 'single-instance'
        ? `${u.label} does not scale horizontally — its ceiling is a hard limit at ${u.capacity} concurrent units.`
        : u.scalingAxis === 'managed-external'
          ? `${u.label} is a managed dependency: ${u.capacity} is your quota assumption, and quota raises are a ticket, not a dial.`
          : `${u.label} has ${u.instances} instance(s) × ${u.capacityPerInstance} capacity = ${u.capacity}, but ${u.offered} is being offered.`
    out.push({
      nodeId: u.nodeId,
      label: u.label,
      utilisation: u.utilisation,
      offered: u.offered,
      capacity: u.capacity,
      severity: critical ? 'critical' : 'warning',
      why,
      consequences: critical
        ? [
            'Requests queue: latency climbs non-linearly (queueing theory, not bad luck).',
            'Queues overflow: new calls rejected or dropped.',
            spec?.onMediaPath
              ? 'This node is on the media path: overload degrades audio on EVERY live call, not just new ones.'
              : 'Off the media path: live audio survives, but turns that depend on this node stall.',
          ]
        : [
            'Above ~80% utilisation, queueing delay becomes noticeable well before saturation.',
            'No headroom for spikes or instance failure (N-1 capacity check fails).',
          ],
      remedies:
        u.scalingAxis === 'stateless-horizontal' || u.scalingAxis === 'connection-aware'
          ? [`Add replicas: ${Math.ceil(u.offered / (u.capacityPerInstance * 0.7))} instances puts utilisation at ~70%.`, 'Add autoscaling on this tier with headroom for warmup time.']
          : u.scalingAxis === 'partitioned'
            ? ['Shard by key (call/session id) across more nodes.', 'Check for hot keys defeating the sharding.']
            : u.scalingAxis === 'vertical'
              ? ['Bigger instance (short-term), read replicas / caching (medium), sharding (last resort).', 'Move read traffic to a cache tier.']
              : ['Raise the provider quota ahead of need.', 'Split traffic across a second provider or account.'],
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Infrastructure planning (requirements -> tier -> instance counts)
// ---------------------------------------------------------------------------

export interface PlannedTier {
  tier: 'single-box' | 'replicated' | 'distributed' | 'multi-region'
  tierLabel: string
  concurrent: number
  components: PlannedComponent[]
  narrative: string[]
  assumptions: string[]
}

export interface PlannedComponent {
  specId: string
  label: string
  instances: number
  reason: string
  perInstanceCapacity: number
}

export function planInfrastructure(req: Requirements): PlannedTier {
  const c = req.peakConcurrentCalls
  const assumptions = [
    `Media server capacity assumption: 50 concurrent calls / 4-vCPU instance (editable; a tuned native server does far better).`,
    `Headroom policy: plan for 70% peak utilisation so spikes and instance loss don't hit the ceiling.`,
    `These are educational sizing models, not guaranteed production numbers.`,
  ]

  const mediaCap = 50
  const withHeadroom = (n: number) => Math.max(1, Math.ceil(n / 0.7))
  const mediaServers = withHeadroom(Math.ceil(c / mediaCap))
  const components: PlannedComponent[] = []
  const narrative: string[] = []

  const add = (specId: string, instances: number, reason: string, cap = 0) => {
    components.push({
      specId,
      label: getSpec(specId).short,
      instances,
      reason,
      perInstanceCapacity: cap || getSpec(specId).scaling.capacityPerInstance,
    })
  }

  let tier: PlannedTier['tier']
  let tierLabel: string

  if (c <= 25) {
    tier = 'single-box'
    tierLabel = 'Single voice server'
    add('media-gateway', 1, `${c} concurrent calls fit on one instance with room to spare.`, mediaCap)
    add('postgres', 1, 'Durable record. One small instance; a managed offering removes ops.')
    narrative.push(
      `At ${c} concurrent calls, distribution buys you nothing but moving parts. One voice server process (media + agent runtime together), one database.`,
      'Session state can live in process memory — a crash loses in-flight calls, which at this scale is an accepted, visible tradeoff. Write it down.',
      'The skill at this tier is NOT scaling; it is timeouts, fallbacks and observability. A single box with great telemetry beats a distributed system without it.',
    )
  } else if (c <= 400) {
    tier = 'replicated'
    tierLabel = 'Load-balanced replica set'
    add('load-balancer', 1, 'More than one server means something must place new calls and eject dead backends.')
    add('media-gateway', mediaServers, `${c} calls / ${mediaCap} per instance, with 30% headroom → ${mediaServers} instances.`, mediaCap)
    add('redis', 1, 'Session state must leave process memory: any server must be able to adopt any call after a crash or deploy.')
    add('postgres', 1, 'Durable record; still comfortably one primary + standby at this query volume.')
    add('queue', 1, 'Transcripts, CRM writes and recordings move off the live path.')
    add('monitoring', 1, 'At tens of servers, "ssh and look" stops working. Latency percentiles per stage or you are blind.')
    narrative.push(
      `${c} concurrent calls exceeds one machine: a load balancer spreads *connections* (not requests) across ${mediaServers} media servers.`,
      'The qualitative change is state: with N servers, the call\'s brain can no longer live in one process\'s memory. Redis becomes the session store; Postgres stays the durable record.',
      'Deploys become drain operations: stop accepting calls, wait for live ones to end (minutes!), then replace. This is connection-aware scaling — the defining operational trait of voice.',
    )
  } else if (c <= 5000) {
    tier = 'distributed'
    tierLabel = 'Distributed single-region platform'
    add('load-balancer', 2, 'Redundant pair; the LB must never be the single point of failure it exists to prevent.')
    add('media-gateway', mediaServers, `${c} / ${mediaCap} per instance + headroom → ${mediaServers} instances across ≥2 AZs.`, mediaCap)
    add('agent-runtime', withHeadroom(Math.ceil(c / 80)), 'Split from media: media scales with bandwidth/DSP, runtime with conversation logic. Independent scaling, smaller blast radius.')
    add('redis', 2, 'Primary + replica with automatic failover; session loss now costs thousands of calls.')
    add('postgres', 2, 'Primary + HA standby; PgBouncer in front — this many calls exhausts naive connection handling.')
    add('queue', 2, 'Clustered; consumer autoscaling on queue depth.')
    add('kafka', 3, 'Event log for analytics/billing/QA — too many consumers now for point-to-point queues.')
    add('object-storage', 1, 'Recordings at this volume are terabytes/month; lifecycle policies are a budget line.')
    add('kubernetes', 1, 'Orchestration: humans cannot place, heal and roll ' + mediaServers + '+ media pods by hand.')
    add('monitoring', 1, 'Full metrics/logs/traces; per-stage latency percentiles drive every optimisation.')
    narrative.push(
      `At ${c} concurrent calls you are running a platform, not a server: ~${mediaServers} media instances, autoscaled, spread across availability zones.`,
      'Failure isolation appears: an AZ loss or a bad deploy must take out a slice, not the fleet. Blast radius per instance (calls-per-server) becomes a tuned number.',
      'Autoscaling must lead demand by its warmup time (~1–3 min): scale on connection count and call-arrival rate, not on CPU alone, which lags.',
    )
  } else {
    tier = 'multi-region'
    tierLabel = 'Multi-region, failure-isolated platform'
    const perRegion = Math.max(2, req.regions.length)
    const mediaPerRegion = withHeadroom(Math.ceil(c / perRegion / mediaCap))
    add('load-balancer', perRegion * 2, 'Per-region LB pairs + global routing (DNS/anycast) steering users to the nearest healthy region.')
    add('media-gateway', mediaPerRegion * perRegion, `${c} calls across ${perRegion} regions → ~${mediaPerRegion} media instances per region, sized so N-1 regions can absorb a failover.`, mediaCap)
    add('agent-runtime', withHeadroom(Math.ceil(c / 80)), 'Runtime fleet distributed with the media tier.')
    add('redis', perRegion * 2, 'Region-local session state. Calls are region-sticky; replicating live media state across oceans is a mistake.')
    add('postgres', perRegion + 1, 'Regional primaries or a primary + cross-region replicas — pick a consistency story and write it down.')
    add('kafka', perRegion * 3, 'Per-region clusters with cross-region mirroring for the analytical plane.')
    add('queue', perRegion * 2, 'Regional queues; consumers scale independently.')
    add('object-storage', 1, 'Recordings to region-local buckets (data residency), lifecycle to cold storage.')
    add('kubernetes', perRegion, 'One cluster per region; regions deploy independently, never in lockstep.')
    add('monitoring', 1, 'Global observability with per-region drill-down; SLOs measured per region.')
    narrative.push(
      `Beyond ~5,000 concurrent calls (${c} requested), one region is both a latency problem and a blast-radius problem.`,
      'Users terminate media in the nearest region: speech round-trips of >150 ms across oceans are audible. Media stays regional; only durable data and analytics cross regions.',
      'Region failure becomes a designed-for event: traffic re-routes, surviving regions absorb load (they must be sized for it), and cross-region latency temporarily rises. The simulator\'s Multi-Region mode plays this exact scenario.',
      'Distributed state is the intellectual core at this tier: session state region-local, durable state with an explicit replication/consistency story, and NOTHING that requires a synchronous cross-region call during a live turn.',
    )
  }

  if (req.humanHandoff && tier !== 'single-box') {
    // Humans are never staffed to 100% occupancy: Erlang C says queue waits blow
    // up well before saturation (≈80% occupancy roughly doubles the wait vs 70%).
    // Size the seat count for ~75% target occupancy on the escalated share.
    const escalationRate = 0.1
    const targetOccupancy = 0.75
    const seats = Math.max(3, Math.ceil((c * escalationRate) / targetOccupancy))
    add('human-agent', seats,
      `~${escalationRate * 100}% of calls escalate; seats sized for ${targetOccupancy * 100}% target occupancy (Erlang C: waits explode near 100%). Staffing is hiring and scheduling, not autoscaling.`)
  }

  return { tier, tierLabel, concurrent: c, components, narrative, assumptions }
}

export const SCALE_PRESETS = [10, 100, 1000, 10000, 50000] as const

// ---------------------------------------------------------------------------
// Traffic + autoscaling tick simulation
// ---------------------------------------------------------------------------

export interface TrafficPoint {
  /** Seconds of simulated wall clock. */
  t: number
  offeredCalls: number
  activeCalls: number
  instances: number
  desiredInstances: number
  cpuPct: number
  memPct: number
  queueDepth: number
  p50LatencyMs: number
  p95LatencyMs: number
  errorRatePct: number
  droppedCalls: number
  reconnects: number
  bandwidthMbps: number
  costPerHourUsd: number
  region?: RegionId
  phase: string
}

export interface TrafficSimOptions {
  seed: string
  durationS: number
  tickS: number
  baselineConcurrent: number
  /** Spike multiplier and window. */
  spike?: { startS: number; endS: number; multiplier: number }
  /** Kill capacity for a window (region loss / server death). */
  outage?: { startS: number; endS: number; capacityFraction: number; label: string }
  autoscale: {
    enabled: boolean
    cpuTargetPct: number
    scaleOutStepS: number
    /** Time for a new instance to become ready. */
    warmupS: number
    scaleInDelayS: number
    minInstances: number
    maxInstances: number
  }
  callsPerInstance: number
  baseLatencyMs: number
}

export const DEFAULT_TRAFFIC_OPTS: TrafficSimOptions = {
  seed: 'traffic-1',
  durationS: 600,
  tickS: 5,
  baselineConcurrent: 400,
  spike: { startS: 120, endS: 300, multiplier: 2.6 },
  autoscale: {
    enabled: true,
    cpuTargetPct: 65,
    scaleOutStepS: 15,
    warmupS: 90,
    scaleInDelayS: 120,
    minInstances: 4,
    maxInstances: 60,
  },
  callsPerInstance: 50,
  baseLatencyMs: 620,
}

/**
 * Deterministic tick-based fleet simulation. Models: offered load curve,
 * autoscaling with warmup lag, CPU-driven queueing latency, queue growth at
 * saturation, dropped calls beyond queue capacity, and recovery.
 */
export function simulateTraffic(opts: TrafficSimOptions): TrafficPoint[] {
  const rng = new Rng(opts.seed)
  const points: TrafficPoint[] = []
  const a = opts.autoscale

  let instances = Math.max(a.minInstances, Math.ceil(opts.baselineConcurrent / opts.callsPerInstance / 0.65))
  let warmingUp: { readyAt: number; count: number }[] = []
  let queueDepth = 0
  let lastScaleOut = -Infinity
  const overCapSince = -Infinity
  let underTargetSince = -Infinity
  let dropped = 0

  for (let t = 0; t <= opts.durationS; t += opts.tickS) {
    // Offered load curve: baseline + diurnal wiggle + optional spike + noise.
    let offered = opts.baselineConcurrent * (1 + 0.06 * Math.sin(t / 47))
    let phase = 'normal'
    if (opts.spike && t >= opts.spike.startS && t < opts.spike.endS) {
      // Ramp in/out over 30s rather than a step.
      const ramp = Math.min(1, (t - opts.spike.startS) / 30, Math.max(0.15, (opts.spike.endS - t) / 30))
      offered *= 1 + (opts.spike.multiplier - 1) * ramp
      phase = 'spike'
    }
    offered *= 1 + rng.jitter(0.03)
    offered = Math.max(0, Math.round(offered))

    // Outage: fraction of capacity vanishes.
    let effectiveInstances = instances
    if (opts.outage && t >= opts.outage.startS && t < opts.outage.endS) {
      effectiveInstances = Math.max(1, Math.floor(instances * opts.outage.capacityFraction))
      phase = opts.outage.label
    }

    // Mature warmups.
    warmingUp = warmingUp.filter((w) => {
      if (t >= w.readyAt) {
        instances += w.count
        return false
      }
      return true
    })
    if (opts.outage && t >= opts.outage.startS && t < opts.outage.endS) {
      effectiveInstances = Math.max(1, Math.floor(instances * opts.outage.capacityFraction))
    } else {
      effectiveInstances = instances
    }

    const capacity = effectiveInstances * opts.callsPerInstance
    const active = Math.min(offered, capacity)
    const overflow = Math.max(0, offered - capacity)

    // Queue: overflow accumulates, drains when capacity frees up.
    queueDepth = Math.max(0, queueDepth + overflow * opts.tickS * 0.18 - Math.max(0, capacity - offered) * opts.tickS * 0.3)
    // Queue cap: beyond it, calls drop.
    const queueCap = capacity * 0.5
    let droppedNow = 0
    if (queueDepth > queueCap) {
      droppedNow = Math.round(queueDepth - queueCap)
      queueDepth = queueCap
      dropped += droppedNow
    }

    const utilisation = capacity > 0 ? offered / capacity : 2
    // CPU tracks utilisation with per-call overhead; saturation pins it.
    const cpuPct = Math.min(100, round(utilisation * 78 + rng.jitter(3), 1))
    const memPct = Math.min(100, round(30 + utilisation * 45 + rng.jitter(2), 1))

    // Queueing latency: M/M/c-flavoured blow-up as utilisation -> 1.
    const rho = Math.min(utilisation, 0.995)
    const queueingMs = rho < 0.7 ? 0 : (rho - 0.7) * (rho - 0.7) * 4200 / Math.max(0.005, 1 - rho)
    const p50 = round(opts.baseLatencyMs + queueingMs * 0.6 + rng.jitter(15), 0)
    const p95 = round(opts.baseLatencyMs * 1.35 + queueingMs * 1.6 + rng.jitter(30), 0)
    const errorRatePct = round(Math.min(60, overflow > 0 ? (overflow / Math.max(1, offered)) * 100 : utilisation > 0.92 ? (utilisation - 0.92) * 40 : 0.2 + rng.jitter(0.15)), 2)

    // Autoscaling decision (on the *visible* metrics, like a real HPA).
    let desired = instances
    if (a.enabled) {
      const cpuForScaling = Math.min(100, utilisation * 78)
      if (cpuForScaling > a.cpuTargetPct + 10 && t - lastScaleOut >= a.scaleOutStepS) {
        const target = Math.ceil((offered / opts.callsPerInstance) / (a.cpuTargetPct / 100 / 0.78))
        const addition = Math.min(a.maxInstances - instances - warmingUp.reduce((s, w) => s + w.count, 0), Math.max(1, target - instances))
        if (addition > 0) {
          warmingUp.push({ readyAt: t + a.warmupS, count: addition })
          lastScaleOut = t
        }
        underTargetSince = -Infinity
      } else if (cpuForScaling < a.cpuTargetPct - 25 && instances > a.minInstances) {
        if (underTargetSince < 0) underTargetSince = t
        if (t - underTargetSince >= a.scaleInDelayS) {
          // Scale-in must drain: remove one instance at a time.
          instances = Math.max(a.minInstances, instances - 1)
          underTargetSince = t
        }
      } else {
        underTargetSince = -Infinity
      }
      desired = instances + warmingUp.reduce((s, w) => s + w.count, 0)
    }
    void overCapSince

    points.push({
      t,
      offeredCalls: offered,
      activeCalls: active,
      instances: effectiveInstances,
      desiredInstances: desired,
      cpuPct,
      memPct,
      queueDepth: Math.round(queueDepth),
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      errorRatePct,
      droppedCalls: dropped,
      reconnects: droppedNow > 0 ? Math.round(droppedNow * 0.7) : phase !== 'normal' && rng.chance(0.3) ? rng.int(1, 6) : 0,
      bandwidthMbps: round((active * 140) / 1000, 1),
      costPerHourUsd: round(effectiveInstances * 0.17 + active * 0.001, 2),
      phase,
    })
  }
  return points
}

// ---------------------------------------------------------------------------
// Multi-region model
// ---------------------------------------------------------------------------

export interface RegionInfo {
  id: RegionId
  name: string
  location: string
}

export const REGIONS: RegionInfo[] = [
  { id: 'in-mumbai', name: 'India (Mumbai)', location: 'Mumbai' },
  { id: 'us-east', name: 'US East (Virginia)', location: 'Virginia' },
  { id: 'eu-west', name: 'Europe (Ireland)', location: 'Dublin' },
  { id: 'ap-singapore', name: 'Asia (Singapore)', location: 'Singapore' },
]

/** One-way inter-region latency in ms. SIMULATION ASSUMPTION (fibre-path-ish). */
export const INTER_REGION_MS: Record<RegionId, Record<RegionId, number>> = {
  'in-mumbai': { 'in-mumbai': 2, 'us-east': 95, 'eu-west': 60, 'ap-singapore': 30 },
  'us-east': { 'in-mumbai': 95, 'us-east': 2, 'eu-west': 38, 'ap-singapore': 110 },
  'eu-west': { 'in-mumbai': 60, 'us-east': 38, 'eu-west': 2, 'ap-singapore': 85 },
  'ap-singapore': { 'in-mumbai': 30, 'us-east': 110, 'eu-west': 85, 'ap-singapore': 2 },
}

export interface RegionSimPoint {
  t: number
  perRegion: Record<string, { servingCalls: number; latencyMs: number; healthy: boolean; servedFrom: RegionId }>
  narrative?: string
}

export interface RegionSimOptions {
  seed: string
  regions: RegionId[]
  callShare: Record<string, number>
  totalConcurrent: number
  failure?: { region: RegionId; startS: number; endS: number }
  durationS: number
  baseLatencyMs: number
}

/** Simulate traffic distribution and a region failure with failover. */
export function simulateRegions(opts: RegionSimOptions): RegionSimPoint[] {
  const points: RegionSimPoint[] = []
  const tick = 10
  for (let t = 0; t <= opts.durationS; t += tick) {
    const failed = opts.failure && t >= opts.failure.startS && t < opts.failure.endS ? opts.failure.region : null
    const perRegion: RegionSimPoint['perRegion'] = {}
    let narrative: string | undefined
    for (const region of opts.regions) {
      const share = opts.callShare[region] ?? 1 / opts.regions.length
      const calls = Math.round(opts.totalConcurrent * share)
      if (region === failed) {
        // Users of this region fail over to the nearest healthy region.
        const alternatives = opts.regions.filter((r) => r !== failed)
        const nearest = alternatives.sort((a, b) => INTER_REGION_MS[region][a] - INTER_REGION_MS[region][b])[0]
        perRegion[region] = {
          servingCalls: calls,
          latencyMs: opts.baseLatencyMs + INTER_REGION_MS[region][nearest] * 2,
          healthy: false,
          servedFrom: nearest,
        }
        if (t === opts.failure!.startS) {
          narrative = `${region} DOWN — its users re-route to ${nearest}: calls continue, but every media round trip now pays +${INTER_REGION_MS[region][nearest] * 2} ms.`
        }
      } else {
        // Healthy region; may be absorbing a failed region's load.
        const absorbing = failed
          ? opts.regions.filter((r) => r === failed).some((f) => {
              const alternatives = opts.regions.filter((r) => r !== f)
              const nearest = alternatives.sort((a, b) => INTER_REGION_MS[f][a] - INTER_REGION_MS[f][b])[0]
              return nearest === region
            })
          : false
        const extra = absorbing ? Math.round(opts.totalConcurrent * (opts.callShare[failed as string] ?? 0)) : 0
        perRegion[region] = {
          servingCalls: calls + extra,
          latencyMs: opts.baseLatencyMs + (absorbing ? 40 : 0),
          healthy: true,
          servedFrom: region,
        }
      }
    }
    if (opts.failure && t === opts.failure.endS) {
      narrative = `${opts.failure.region} recovered — traffic drains back; latency returns to baseline.`
    }
    points.push({ t, perRegion, narrative })
  }
  return points
}

// ---------------------------------------------------------------------------
// Long-lived connection model (HTTP vs voice)
// ---------------------------------------------------------------------------

export interface ConnectionComparison {
  http: { label: string; value: string; note: string }[]
  voice: { label: string; value: string; note: string }[]
}

export function connectionComparison(concurrent: number, avgCallMinutes: number): ConnectionComparison {
  const rps = Math.round((concurrent / (avgCallMinutes * 60)) * 1.0)
  return {
    http: [
      { label: 'Connection lifetime', value: '~50–300 ms', note: 'Request in, response out, socket returned to the pool.' },
      { label: 'State between requests', value: 'None (by design)', note: 'Any server can answer any request; that is what makes web scaling easy.' },
      { label: `Servers for ${concurrent} "users"`, value: 'Sized by req/s', note: `${concurrent} users browsing ≈ ${Math.max(5, Math.round(concurrent / 20))} req/s — trivial for one box.` },
      { label: 'Deploy', value: 'Instant', note: 'Drain takes milliseconds; nobody notices a pod restarting.' },
      { label: 'Server death', value: 'A few failed requests', note: 'Retries mask it entirely.' },
    ],
    voice: [
      { label: 'Connection lifetime', value: `${avgCallMinutes} min (continuous)`, note: 'The socket lives for the entire call, streaming 50 frames/sec both ways.' },
      { label: 'State between frames', value: 'The whole conversation', note: 'Transcript, LLM context, audio buffers, VAD state — pinned to the serving instance.' },
      { label: `Servers for ${concurrent} calls`, value: `Sized by concurrency`, note: `${concurrent} concurrent calls at 50/instance ≈ ${Math.ceil(concurrent / 50 / 0.7)} instances with headroom — while call ARRIVALS are only ~${rps}/s.` },
      { label: 'Deploy', value: 'A drain operation', note: 'Stop accepting, wait up to a full call-length (minutes) for connections to end, then replace.' },
      { label: 'Server death', value: `~${Math.min(concurrent, 50)} calls drop at once`, note: 'Everyone mid-sentence on that instance hears the line die. Blast radius = calls-per-server, a number you choose.' },
    ],
  }
}
