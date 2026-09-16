import { describe, expect, it } from 'vitest'
import {
  analysePipeline,
  bitrateBps,
  bytesForSeconds,
  bytesPerFrame,
  classifyConversion,
  FORMATS,
  framesPerSecond,
  nyquistHz,
  samplesPerFrame,
  telephonyPipeline,
  usableBandwidthHz,
  wastefulPipeline,
} from './audio'
import { computeLatency, DEFAULT_LATENCY_PARAMS, streamingComparison } from './latency'
import { computeCost, costLevers, DEFAULT_COST_INPUTS } from './cost'
import { runReliabilitySim, STRATEGY_PRESETS } from './reliability'
import { generateEnergyTrack, runVad } from './vad'
import { CONVERSATION_SM, HANDOFF_SM, STATE_MACHINES, TELEPHONY_SM } from './stateMachines'
import {
  computeResources,
  connectionComparison,
  detectBottlenecks,
  DEFAULT_TRAFFIC_OPTS,
  planInfrastructure,
  simulateRegions,
  simulateTraffic,
} from './scaling'
import { PATTERNS } from '../patterns/library'
import type { Requirements } from '../domain/types'

const req = (over: Partial<Requirements> = {}): Requirements => ({
  name: 'test',
  callsPerDay: 5000,
  avgCallSeconds: 240,
  peakCallsPerMinute: 100,
  peakConcurrentCalls: 500,
  latencyTargetMs: 800,
  availabilityTarget: 0.999,
  languages: ['en-US'],
  regions: ['us-east'],
  direction: 'inbound',
  channel: 'phone',
  humanHandoff: false,
  recording: false,
  toolUsage: 0.5,
  budgetPosture: 'balanced',
  compliance: [],
  ...over,
})

// ---------------------------------------------------------------------------

describe('audio model', () => {
  it('computes PCM bitrate from the format arithmetic', () => {
    // 16 kHz * 16 bits * 1 channel = 256 kbit/s
    expect(bitrateBps(FORMATS.pcm16k)).toBe(256_000)
    // 8 kHz * 16 bits = 128 kbit/s
    expect(bitrateBps(FORMATS.pcm8k)).toBe(128_000)
  })

  it('computes G.711 at the canonical 64 kbit/s', () => {
    expect(bitrateBps(FORMATS.telephonyMulaw)).toBe(64_000)
    expect(bitrateBps(FORMATS.telephonyAlaw)).toBe(64_000)
  })

  it('computes 160 bytes per 20 ms mu-law frame (the telephony constant)', () => {
    expect(bytesPerFrame(FORMATS.telephonyMulaw)).toBe(160)
    expect(samplesPerFrame(FORMATS.telephonyMulaw)).toBe(160)
    expect(framesPerSecond(FORMATS.telephonyMulaw)).toBe(50)
  })

  it('computes 640 bytes per 20 ms 16 kHz PCM16 frame', () => {
    expect(bytesPerFrame(FORMATS.pcm16k)).toBe(640)
  })

  it('computes total bytes for a call duration', () => {
    // 60 s of mu-law at 8 kB/s = 480 kB
    expect(bytesForSeconds(FORMATS.telephonyMulaw, 60)).toBe(480_000)
  })

  it('applies Nyquist and the telephony band limit', () => {
    expect(nyquistHz(16000)).toBe(8000)
    expect(usableBandwidthHz(FORMATS.telephonyMulaw)).toBe(3400)
    expect(usableBandwidthHz(FORMATS.pcm16k)).toBe(8000)
  })

  it('classifies conversions correctly', () => {
    expect(classifyConversion(FORMATS.pcm16k, FORMATS.pcm16k)).toEqual(['none'])
    expect(classifyConversion(FORMATS.telephonyMulaw, FORMATS.pcm8k)).toContain('decode')
    expect(classifyConversion(FORMATS.pcm8k, FORMATS.pcm16k)).toContain('resample-up')
    expect(classifyConversion(FORMATS.pcm24k, FORMATS.pcm8k)).toContain('resample-down')
    expect(classifyConversion(FORMATS.pcm16k, FORMATS.opusWebrtc)).toContain('encode')
  })

  it('rates the clean telephony pipeline better than the wasteful one', () => {
    const clean = analysePipeline(telephonyPipeline())
    const bad = analysePipeline(wastefulPipeline())
    expect(bad.totalLatencyMs).toBeGreaterThan(clean.totalLatencyMs)
    expect(bad.endToEndQuality).toBeLessThan(clean.endToEndQuality)
    expect(bad.verdict).toBe('wasteful')
    expect(bad.warnings.length).toBeGreaterThan(clean.warnings.length)
  })

  it('detects an unnecessary sample-rate round trip', () => {
    const bad = analysePipeline(wastefulPipeline())
    expect(bad.warnings.some((w) => w.toLowerCase().includes('ends where it started'))).toBe(true)
  })

  it('detects multiple lossy encodes', () => {
    const bad = analysePipeline(wastefulPipeline())
    expect(bad.warnings.some((w) => w.includes('lossy encodes'))).toBe(true)
  })

  it('reports pass-through when formats match exactly', () => {
    const analysis = analysePipeline([
      { id: 'a', label: 'A', role: 'x', format: FORMATS.pcm16k },
      { id: 'b', label: 'B', role: 'y', format: FORMATS.pcm16k },
    ])
    expect(analysis.conversions[0].kinds).toEqual(['none'])
    expect(analysis.conversions[0].latencyMs).toBe(0)
    expect(analysis.totalLatencyMs).toBe(0)
  })

  it('warns that upsampling adds no information', () => {
    const analysis = analysePipeline([
      { id: 'a', label: 'A', role: 'x', format: FORMATS.pcm8k },
      { id: 'b', label: 'B', role: 'y', format: FORMATS.pcm16k },
    ])
    expect(analysis.warnings.some((w) => w.includes('does not add information'))).toBe(true)
  })

  it('effective bandwidth is capped by the narrowest stage', () => {
    const analysis = analysePipeline(telephonyPipeline())
    expect(analysis.effectiveBandwidthHz).toBe(3400)
  })
})

// ---------------------------------------------------------------------------

describe('latency model', () => {
  it('streaming beats batch under identical settings', () => {
    const { batch, streaming, savedMs } = streamingComparison(DEFAULT_LATENCY_PARAMS)
    expect(streaming.perceivedLatencyMs).toBeLessThan(batch.perceivedLatencyMs)
    expect(savedMs).toBeGreaterThan(500)
  })

  it('segments sum to the perceived latency (critical path is serial)', () => {
    const b = computeLatency(DEFAULT_LATENCY_PARAMS)
    const sum = b.segments.reduce((s, x) => s + x.ms, 0)
    expect(Math.abs(sum - b.perceivedLatencyMs)).toBeLessThan(1)
  })

  it('endpointing directly increases perceived latency', () => {
    const fast = computeLatency({ ...DEFAULT_LATENCY_PARAMS, endpointingMs: 300 })
    const slow = computeLatency({ ...DEFAULT_LATENCY_PARAMS, endpointingMs: 900 })
    expect(slow.perceivedLatencyMs - fast.perceivedLatencyMs).toBeCloseTo(600, 0)
  })

  it('endpointing and STT run in parallel — the later one gates the turn', () => {
    // STT finalization well inside the endpoint window: endpointing gates.
    const endpointGated = computeLatency({ ...DEFAULT_LATENCY_PARAMS, endpointingMs: 800, sttFinalizeMs: 100 })
    expect(endpointGated.segments.find((s) => s.key === 'stt-final')).toBeUndefined()
    // STT finalization longer than the endpoint window: STT gates and adds an overrun segment.
    const sttGated = computeLatency({ ...DEFAULT_LATENCY_PARAMS, endpointingMs: 200, sttFinalizeMs: 900 })
    expect(sttGated.segments.find((s) => s.key === 'stt-final')).toBeDefined()
  })

  it('batch STT cost scales with utterance length; streaming does not', () => {
    const shortBatch = computeLatency({ ...DEFAULT_LATENCY_PARAMS, sttStreaming: false, utteranceSeconds: 2, endpointingMs: 150 })
    const longBatch = computeLatency({ ...DEFAULT_LATENCY_PARAMS, sttStreaming: false, utteranceSeconds: 12, endpointingMs: 150 })
    expect(longBatch.perceivedLatencyMs).toBeGreaterThan(shortBatch.perceivedLatencyMs + 1000)

    const shortStream = computeLatency({ ...DEFAULT_LATENCY_PARAMS, sttStreaming: true, utteranceSeconds: 2 })
    const longStream = computeLatency({ ...DEFAULT_LATENCY_PARAMS, sttStreaming: true, utteranceSeconds: 12 })
    expect(longStream.perceivedLatencyMs).toBe(shortStream.perceivedLatencyMs)
  })

  it('a blocking tool call lands on the critical path', () => {
    const noTool = computeLatency({ ...DEFAULT_LATENCY_PARAMS, toolMs: 0 })
    const withTool = computeLatency({ ...DEFAULT_LATENCY_PARAMS, toolMs: 800 })
    expect(withTool.perceivedLatencyMs).toBeGreaterThan(noTool.perceivedLatencyMs + 800)
    expect(withTool.segments.some((s) => s.key === 'tool')).toBe(true)
  })

  it('network latency is paid twice (in and out)', () => {
    const near = computeLatency({ ...DEFAULT_LATENCY_PARAMS, userToEdgeMs: 20 })
    const far = computeLatency({ ...DEFAULT_LATENCY_PARAMS, userToEdgeMs: 120 })
    expect(far.perceivedLatencyMs - near.perceivedLatencyMs).toBeCloseTo(200, 0)
  })

  it('flags budget compliance', () => {
    const ok = computeLatency({ ...DEFAULT_LATENCY_PARAMS, budgetMs: 3000 })
    expect(ok.withinBudget).toBe(true)
    const over = computeLatency({ ...DEFAULT_LATENCY_PARAMS, budgetMs: 200 })
    expect(over.withinBudget).toBe(false)
  })

  it('non-streaming TTS delays first audio more than streaming', () => {
    const stream = computeLatency({ ...DEFAULT_LATENCY_PARAMS, ttsStreaming: true })
    const batch = computeLatency({ ...DEFAULT_LATENCY_PARAMS, ttsStreaming: false, responseAudioSeconds: 10 })
    expect(batch.perceivedLatencyMs).toBeGreaterThan(stream.perceivedLatencyMs)
  })
})

// ---------------------------------------------------------------------------

describe('cost model', () => {
  it('line items sum to the totals', () => {
    const r = computeCost(DEFAULT_COST_INPUTS)
    const sum = r.lineItems.reduce((s, li) => s + li.usdPerCall, 0)
    expect(Math.abs(sum - r.usdPerCall)).toBeLessThan(1e-6)
    expect(r.usdPerDay).toBeCloseTo(r.usdPerCall * DEFAULT_COST_INPUTS.callsPerDay, 1)
    expect(r.usdPerYear).toBeCloseTo(r.usdPerMonth * 12, 1)
  })

  it('usage costs scale linearly with call volume', () => {
    const base = computeCost(DEFAULT_COST_INPUTS)
    const double = computeCost({ ...DEFAULT_COST_INPUTS, callsPerDay: DEFAULT_COST_INPUTS.callsPerDay * 2 })
    const sttBase = base.lineItems.find((l) => l.key === 'stt')!
    const sttDouble = double.lineItems.find((l) => l.key === 'stt')!
    // Per-call cost identical, per-day doubled.
    expect(sttDouble.usdPerCall).toBeCloseTo(sttBase.usdPerCall, 6)
    expect(sttDouble.usdPerDay).toBeCloseTo(sttBase.usdPerDay * 2, 2)
  })

  it('compute cost scales with PEAK concurrency, not call volume', () => {
    const low = computeCost({ ...DEFAULT_COST_INPUTS, peakConcurrent: 100 })
    const high = computeCost({ ...DEFAULT_COST_INPUTS, peakConcurrent: 1000 })
    const lowCompute = low.lineItems.find((l) => l.key === 'compute')!
    const highCompute = high.lineItems.find((l) => l.key === 'compute')!
    expect(highCompute.usdPerMonth).toBeGreaterThan(lowCompute.usdPerMonth * 5)
  })

  it('per-call cost falls as volume amortises fixed capacity', () => {
    const small = computeCost({ ...DEFAULT_COST_INPUTS, callsPerDay: 200, peakConcurrent: 50 })
    const large = computeCost({ ...DEFAULT_COST_INPUTS, callsPerDay: 200_000, peakConcurrent: 50 })
    expect(large.usdPerCall).toBeLessThan(small.usdPerCall)
  })

  it('storage scales with retention', () => {
    const short = computeCost({ ...DEFAULT_COST_INPUTS, recordingEnabled: true, retentionMonths: 1 })
    const long = computeCost({ ...DEFAULT_COST_INPUTS, recordingEnabled: true, retentionMonths: 12 })
    const s = short.lineItems.find((l) => l.key === 'recording')!
    const l = long.lineItems.find((l) => l.key === 'recording')!
    expect(l.usdPerMonth).toBeCloseTo(s.usdPerMonth * 12, 1)
  })

  it('disabling recording removes the storage line', () => {
    const r = computeCost({ ...DEFAULT_COST_INPUTS, recordingEnabled: false })
    expect(r.lineItems.find((l) => l.key === 'recording')).toBeUndefined()
  })

  it('halving context tokens reduces monthly cost', () => {
    const levers = costLevers(DEFAULT_COST_INPUTS)
    const contextLever = levers.find((l) => l.label.includes('context'))!
    expect(contextLever.deltaPerMonth).toBeLessThan(0)
  })

  it('always carries labelled assumptions', () => {
    const r = computeCost(DEFAULT_COST_INPUTS)
    expect(r.assumptions.length).toBeGreaterThan(2)
    expect(r.assumptions.join(' ')).toMatch(/ASSUMPTION/i)
  })
})

// ---------------------------------------------------------------------------

describe('scaling model', () => {
  it('picks tiers by concurrency', () => {
    expect(planInfrastructure(req({ peakConcurrentCalls: 10 })).tier).toBe('single-box')
    expect(planInfrastructure(req({ peakConcurrentCalls: 100 })).tier).toBe('replicated')
    expect(planInfrastructure(req({ peakConcurrentCalls: 1000 })).tier).toBe('distributed')
    expect(planInfrastructure(req({ peakConcurrentCalls: 10000 })).tier).toBe('multi-region')
  })

  it('media instances scale with concurrency and include headroom', () => {
    const plan = planInfrastructure(req({ peakConcurrentCalls: 1000 }))
    const media = plan.components.find((c) => c.specId === 'media-gateway')!
    // 1000/50 = 20 at capacity; /0.7 headroom = 29
    expect(media.instances).toBe(29)
  })

  it('small deployments do not get Redis/queue/Kafka', () => {
    const plan = planInfrastructure(req({ peakConcurrentCalls: 10 }))
    const ids = plan.components.map((c) => c.specId)
    expect(ids).not.toContain('redis')
    expect(ids).not.toContain('kafka')
  })

  it('large deployments add distributed state and observability', () => {
    const ids = planInfrastructure(req({ peakConcurrentCalls: 3000 })).components.map((c) => c.specId)
    expect(ids).toContain('redis')
    expect(ids).toContain('queue')
    expect(ids).toContain('kafka')
    expect(ids).toContain('monitoring')
    expect(ids).toContain('kubernetes')
  })

  it('handoff requirement adds a staffed human tier', () => {
    const ids = planInfrastructure(req({ peakConcurrentCalls: 500, humanHandoff: true })).components.map((c) => c.specId)
    expect(ids).toContain('human-agent')
  })

  it('computes resource utilisation for an architecture', () => {
    const arch = PATTERNS.find((p) => p.id === 'pat-streaming')!.architecture
    const usage = computeResources(arch, 100)
    expect(usage.length).toBeGreaterThan(0)
    const media = usage.find((u) => u.label.includes('Media'))
    expect(media).toBeDefined()
    expect(media!.utilisation).toBeGreaterThan(0)
    // Sorted by utilisation descending.
    for (let i = 1; i < usage.length; i++) {
      expect(usage[i - 1].utilisation).toBeGreaterThanOrEqual(usage[i].utilisation)
    }
  })

  it('detects bottlenecks when offered load exceeds capacity', () => {
    const arch = PATTERNS.find((p) => p.id === 'pat-streaming')!.architecture
    expect(detectBottlenecks(arch, 10)).toHaveLength(0)
    const overloaded = detectBottlenecks(arch, 5000)
    expect(overloaded.length).toBeGreaterThan(0)
    expect(overloaded[0].severity).toBe('critical')
    expect(overloaded[0].consequences.length).toBeGreaterThan(0)
    expect(overloaded[0].remedies.length).toBeGreaterThan(0)
  })

  it('traffic simulation is deterministic', () => {
    const a = simulateTraffic(DEFAULT_TRAFFIC_OPTS)
    const b = simulateTraffic(DEFAULT_TRAFFIC_OPTS)
    expect(a).toEqual(b)
  })

  it('autoscaling adds instances during a spike', () => {
    const points = simulateTraffic({ ...DEFAULT_TRAFFIC_OPTS, spike: { startS: 120, endS: 300, multiplier: 3 } })
    const before = points.find((p) => p.t === 100)!
    const peak = points.reduce((m, p) => (p.instances > m.instances ? p : m))
    expect(peak.instances).toBeGreaterThan(before.instances)
  })

  it('without autoscaling, a spike causes queueing and drops', () => {
    const withAuto = simulateTraffic({ ...DEFAULT_TRAFFIC_OPTS, spike: { startS: 120, endS: 300, multiplier: 3 } })
    const without = simulateTraffic({
      ...DEFAULT_TRAFFIC_OPTS,
      spike: { startS: 120, endS: 300, multiplier: 3 },
      autoscale: { ...DEFAULT_TRAFFIC_OPTS.autoscale, enabled: false },
    })
    const droppedWith = withAuto[withAuto.length - 1].droppedCalls
    const droppedWithout = without[without.length - 1].droppedCalls
    expect(droppedWithout).toBeGreaterThan(droppedWith)
    // Peak p95 saturates in both runs (the queueing term is clamped), so compare
    // SUSTAINED latency across the spike window — that is what callers live through.
    const inSpike = (p: { t: number }) => p.t >= 120 && p.t <= 300
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
    const meanWith = mean(withAuto.filter(inSpike).map((p) => p.p95LatencyMs))
    const meanWithout = mean(without.filter(inSpike).map((p) => p.p95LatencyMs))
    expect(meanWithout).toBeGreaterThan(meanWith)
  })

  it('latency rises non-linearly as utilisation approaches saturation', () => {
    const points = simulateTraffic({ ...DEFAULT_TRAFFIC_OPTS, spike: { startS: 60, endS: 400, multiplier: 4 }, autoscale: { ...DEFAULT_TRAFFIC_OPTS.autoscale, enabled: false } })
    const calm = points.find((p) => p.t === 30)!
    const saturated = points.reduce((m, p) => (p.p95LatencyMs > m.p95LatencyMs ? p : m))
    expect(saturated.p95LatencyMs).toBeGreaterThan(calm.p95LatencyMs * 2)
  })

  it('region failure re-routes traffic and raises latency', () => {
    const points = simulateRegions({
      seed: 'r',
      regions: ['in-mumbai', 'us-east', 'eu-west'],
      callShare: { 'in-mumbai': 0.5, 'us-east': 0.3, 'eu-west': 0.2 },
      totalConcurrent: 1000,
      failure: { region: 'in-mumbai', startS: 60, endS: 180 },
      durationS: 240,
      baseLatencyMs: 650,
    })
    const before = points.find((p) => p.t === 30)!.perRegion['in-mumbai']
    const during = points.find((p) => p.t === 100)!.perRegion['in-mumbai']
    const after = points.find((p) => p.t === 220)!.perRegion['in-mumbai']
    expect(before.healthy).toBe(true)
    expect(during.healthy).toBe(false)
    expect(during.latencyMs).toBeGreaterThan(before.latencyMs)
    expect(during.servedFrom).not.toBe('in-mumbai')
    expect(after.healthy).toBe(true)
    expect(after.latencyMs).toBe(before.latencyMs)
  })

  it('contrasts HTTP and voice connection characteristics', () => {
    const cmp = connectionComparison(1000, 5)
    expect(cmp.http.length).toBeGreaterThan(3)
    expect(cmp.voice.length).toBe(cmp.http.length)
    expect(cmp.voice.some((r) => r.value.includes('min'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('reliability model', () => {
  const provider = { latencyMs: 250, outage: { startMs: 15000, endMs: 35000, mode: 'hang' as const } }
  const opts = { seed: 'test', requests: 100, spanMs: 60000 }

  it('is deterministic', () => {
    const a = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    const b = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    expect(a.requests).toEqual(b.requests)
  })

  it('production strategy serves more callers than naive during an outage', () => {
    const naive = runReliabilitySim(STRATEGY_PRESETS.naive, provider, opts)
    const production = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    expect(production.successRate).toBeGreaterThan(naive.successRate)
  })

  it('a long timeout produces catastrophic tail latency', () => {
    const naive = runReliabilitySim(STRATEGY_PRESETS.naive, provider, opts)
    const production = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    expect(naive.p95Ms).toBeGreaterThan(production.p95Ms * 2)
  })

  it('the circuit breaker opens during a sustained outage', () => {
    const run = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    expect(run.breakerEvents.some((e) => e.state === 'open')).toBe(true)
  })

  it('the breaker closes again after the outage ends', () => {
    const run = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    const lastState = run.breakerEvents[run.breakerEvents.length - 1]?.state
    expect(['closed', 'half-open']).toContain(lastState)
  })

  it('fallback converts failures into degraded successes', () => {
    const noFallback = runReliabilitySim({ ...STRATEGY_PRESETS.production, fallback: false }, provider, opts)
    const withFallback = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    expect(withFallback.successRate).toBeGreaterThan(noFallback.successRate)
  })

  it('healthy periods succeed regardless of strategy', () => {
    const healthy = { latencyMs: 250, outage: { startMs: 0, endMs: 0, mode: 'error' as const } }
    const run = runReliabilitySim(STRATEGY_PRESETS.naive, healthy, opts)
    expect(run.successRate).toBe(1)
  })

  it('retries recover from fast transient errors', () => {
    const flaky = { latencyMs: 200, outage: { startMs: 10000, endMs: 12000, mode: 'error' as const } }
    const noRetry = runReliabilitySim({ ...STRATEGY_PRESETS.production, retries: 0, fallback: false, circuitBreaker: false }, flaky, opts)
    const withRetry = runReliabilitySim({ ...STRATEGY_PRESETS.production, retries: 2, fallback: false, circuitBreaker: false }, flaky, opts)
    expect(withRetry.successRate).toBeGreaterThanOrEqual(noRetry.successRate)
  })
})

// ---------------------------------------------------------------------------

describe('VAD / turn detection model', () => {
  const track = generateEnergyTrack(0.1)

  it('generates a track containing speech, a thinking pause and a noise burst', () => {
    const truths = new Set(track.map((p) => p.truth))
    expect(truths.has('speech')).toBe(true)
    expect(truths.has('pause-within-thought')).toBe(true)
    expect(truths.has('noise-burst')).toBe(true)
  })

  it('is deterministic', () => {
    expect(generateEnergyTrack(0.1)).toEqual(generateEnergyTrack(0.1))
  })

  it('a short silence timeout commits the turn inside the thinking pause', () => {
    const out = runVad(track, { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 300 })
    expect(out.problems.some((p) => p.kind === 'premature')).toBe(true)
  })

  it('a long silence timeout survives the thinking pause', () => {
    const out = runVad(track, { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 1100 })
    expect(out.problems.some((p) => p.kind === 'premature')).toBe(false)
  })

  it('a low minimum-speech duration lets the cough through as phantom speech', () => {
    const out = runVad(track, { speechThreshold: 0.35, minSpeechMs: 30, silenceTimeoutMs: 600 })
    expect(out.problems.some((p) => p.kind === 'phantom')).toBe(true)
  })

  it('a high minimum-speech duration gates the cough out', () => {
    const out = runVad(track, { speechThreshold: 0.5, minSpeechMs: 300, silenceTimeoutMs: 600 })
    expect(out.problems.some((p) => p.kind === 'phantom')).toBe(false)
  })

  it('emits an ordered event log ending in a committed turn', () => {
    const out = runVad(track, { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 600 })
    expect(out.turnCommittedAt).not.toBeNull()
    for (let i = 1; i < out.events.length; i++) {
      expect(out.events[i].t).toBeGreaterThanOrEqual(out.events[i - 1].t)
    }
    expect(out.events.some((e) => e.type === 'SPEECH_STARTED')).toBe(true)
    expect(out.events.some((e) => e.type === 'TURN_COMPLETE')).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('state machines', () => {
  it('every transition references states that exist', () => {
    for (const m of STATE_MACHINES) {
      const ids = new Set(m.states.map((s) => s.id))
      for (const t of m.transitions) {
        expect(ids.has(t.from), `${m.id}: unknown from-state ${t.from}`).toBe(true)
        expect(ids.has(t.to), `${m.id}: unknown to-state ${t.to}`).toBe(true)
      }
    }
  })

  it('every machine has a valid initial state', () => {
    for (const m of STATE_MACHINES) {
      expect(m.states.some((s) => s.id === m.initial)).toBe(true)
    }
  })

  it('every non-initial state is reachable from the initial state', () => {
    for (const m of STATE_MACHINES) {
      const reachable = new Set([m.initial])
      let changed = true
      while (changed) {
        changed = false
        for (const t of m.transitions) {
          if (reachable.has(t.from) && !reachable.has(t.to)) {
            reachable.add(t.to)
            changed = true
          }
        }
      }
      for (const s of m.states) {
        expect(reachable.has(s.id), `${m.id}: ${s.id} unreachable`).toBe(true)
      }
    }
  })

  it('the conversation machine models the barge-in path', () => {
    const toInterrupted = CONVERSATION_SM.transitions.find((t) => t.from === 'SPEAKING' && t.to === 'INTERRUPTED')
    expect(toInterrupted).toBeDefined()
    const backToListening = CONVERSATION_SM.transitions.find((t) => t.from === 'INTERRUPTED' && t.to === 'LISTENING')
    expect(backToListening).toBeDefined()
    const interrupted = CONVERSATION_SM.states.find((s) => s.id === 'INTERRUPTED')!
    expect(interrupted.onEntry.join(' ')).toMatch(/CLEAR_AUDIO_BUFFER/)
  })

  it('the telephony machine can always reach ENDED', () => {
    for (const s of TELEPHONY_SM.states) {
      if (s.id === 'ENDED') continue
      const reachable = new Set([s.id])
      let changed = true
      while (changed) {
        changed = false
        for (const t of TELEPHONY_SM.transitions) {
          if (reachable.has(t.from) && !reachable.has(t.to)) {
            reachable.add(t.to)
            changed = true
          }
        }
      }
      expect(reachable.has('ENDED'), `${s.id} cannot reach ENDED`).toBe(true)
    }
  })

  it('the handoff machine has a no-agent fallback branch', () => {
    const queued = HANDOFF_SM.transitions.filter((t) => t.from === 'QUEUED')
    expect(queued.some((t) => t.event.includes('MAX_WAIT'))).toBe(true)
    const availability = HANDOFF_SM.transitions.filter((t) => t.from === 'CHECK_AVAILABILITY')
    expect(availability.some((t) => t.to === 'QUEUED')).toBe(true)
  })

  it('states carry timers, failures and cleanup where they matter', () => {
    const processing = CONVERSATION_SM.states.find((s) => s.id === 'PROCESSING')!
    expect(processing.timers.length).toBeGreaterThan(0)
    expect(processing.failures.length).toBeGreaterThan(0)
    const speaking = CONVERSATION_SM.states.find((s) => s.id === 'SPEAKING')!
    expect(speaking.cleanup.join(' ')).toMatch(/buffer/i)
  })
})
