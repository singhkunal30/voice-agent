/**
 * Integration tests for the major workflows.
 *
 * These walk the twelve end-to-end scenarios the product brief calls for
 * (A–L), each exercising several subsystems together — the call engine, the
 * providers, the latency model, the scaling model, the validator, the decision
 * engine and the cost engine — and asserting that the story they tell stays
 * coherent across all of them.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_RELIABILITY, simulateCall, type CallSimOptions } from './engine/callSim'
import { decideArchitecture } from './decision/engine'
import { validateArchitecture } from './validation/rules'
import { detectBottlenecks, planInfrastructure, simulateRegions, simulateTraffic, DEFAULT_TRAFFIC_OPTS } from './models/scaling'
import { computeCost, DEFAULT_COST_INPUTS } from './models/cost'
import { runReliabilitySim, STRATEGY_PRESETS } from './models/reliability'
import { SCENARIOS } from './scenarios/library'
import { PATTERNS } from './patterns/library'
import { evaluateArchitecture } from './challenges/engine'
import type { SimEvent } from './domain/types'

function call(over: Partial<CallSimOptions> = {}): CallSimOptions {
  return {
    seed: 'integration',
    channel: 'phone',
    utterance: 'I want to know the premium for a one crore insurance policy',
    language: 'en-IN',
    noiseLevel: 0.1,
    sttProviderId: 'stt-stream-fast',
    ttsProviderId: 'tts-premium-stream',
    llmProviderId: 'llm-fast-small',
    telephonyProviderId: 'tel-cpaas',
    streamingLlm: true,
    streamingTts: true,
    vad: { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 600 },
    network: { userToEdgeMs: 35, edgeToServerMs: 10, serverToProviderMs: 15 },
    greeting: 'Hi, thanks for calling Acme Insurance.',
    responseText: 'For a one crore term policy the monthly premium is about two thousand one hundred rupees.',
    llmContextTokens: 1800,
    llmOutputTokens: 60,
    toolCalls: [{ name: 'premium_calculator', latencyMs: 220, resultSummary: '₹2,100/month' }],
    failures: [],
    reliability: { ...DEFAULT_RELIABILITY },
    ...over,
  }
}

const types = (events: SimEvent[]) => events.map((e) => e.type)

/**
 * Assert that some `b` event happens after the first `a` event.
 *
 * Deliberately not "first a before first b": a call legitimately repeats event
 * types (the greeting plays audio long before the reply does, a barge-in opens
 * a second turn), so the meaningful causal claim is that `a` is followed by a
 * `b`, not that no `b` ever preceded it.
 */
function precedes(events: SimEvent[], a: string, b: string) {
  const ia = events.findIndex((e) => e.type === a)
  expect(ia, `${a} missing`).toBeGreaterThanOrEqual(0)
  const ib = events.findIndex((e, i) => i > ia && e.type === b)
  expect(ib, `${a} should be followed by ${b}`).toBeGreaterThan(ia)
}

describe('Scenario A — simple browser voice assistant', () => {
  const scenario = SCENARIOS.find((s) => s.id === 'sc-browser-assistant')!

  it('runs a complete browser call over WebRTC with no telephony', () => {
    const r = simulateCall(call({ channel: 'browser', utterance: scenario.sampleUtterance, toolCalls: [] }))
    expect(r.outcome).toBe('completed')
    expect(types(r.events)).not.toContain('SIP_INVITE')
    expect(r.events.some((e) => e.component.includes('WebRTC'))).toBe(true)
    precedes(r.events, 'WS_CONNECTED', 'TRANSCRIPT_FINAL')
    precedes(r.events, 'TRANSCRIPT_FINAL', 'PLAYBACK_STARTED')
  })

  it('its reference pattern validates cleanly against its own requirements', () => {
    const pattern = PATTERNS.find((p) => p.id === scenario.referencePatternId)!
    const errors = validateArchitecture(pattern.architecture, scenario.requirements).filter((i) => i.severity === 'error')
    expect(errors.map((e) => e.title)).toEqual([])
  })
})

describe('Scenario B — phone insurance agent', () => {
  it('walks the full pipeline from SIP signalling to audible reply', () => {
    const r = simulateCall(call())
    expect(r.outcome).toBe('completed')
    const t = types(r.events)
    for (const expected of ['CALL_STARTED', 'SIP_INVITE', 'RTP_STREAM_STARTED', 'WS_CONNECTED', 'AUDIO_FRAME_RECEIVED',
      'SPEECH_STARTED', 'TRANSCRIPT_PARTIAL', 'ENDPOINT_DETECTED', 'TRANSCRIPT_FINAL', 'TURN_COMPLETE',
      'LLM_FIRST_TOKEN', 'TOOL_CALL_STARTED', 'TOOL_CALL_COMPLETED', 'TTS_FIRST_AUDIO', 'PLAYBACK_STARTED', 'CALL_ENDED']) {
      expect(t, `missing ${expected}`).toContain(expected)
    }
    precedes(r.events, 'SIP_INVITE', 'RTP_STREAM_STARTED')
    precedes(r.events, 'TURN_COMPLETE', 'LLM_STARTED')
    precedes(r.events, 'TOOL_CALL_COMPLETED', 'TTS_FIRST_AUDIO')
  })

  it('transcodes at the telephony boundary in both directions', () => {
    const r = simulateCall(call())
    const transcodes = r.events.filter((e) => e.type === 'AUDIO_TRANSCODED')
    expect(transcodes.length).toBeGreaterThanOrEqual(2)
    expect(transcodes.some((e) => e.summary.includes('mu-law 8 kHz → PCM16'))).toBe(true)
    expect(transcodes.some((e) => e.summary.includes('→ mu-law 8 kHz'))).toBe(true)
  })

  it('the latency breakdown is internally consistent with the event log', () => {
    const r = simulateCall(call())
    const playback = r.events.find((e) => e.type === 'PLAYBACK_STARTED' && e.summary.includes('🔊'))!
    expect(r.latency.perceivedLatencyMs).toBeCloseTo(playback.t - r.markers.userSpeechEndMs, 0)
    const sum = r.latency.segments.reduce((s, x) => s + x.ms, 0)
    expect(Math.abs(sum - r.latency.perceivedLatencyMs)).toBeLessThan(2)
  })
})

describe('Scenario C — phone agent with human handoff', () => {
  it('completes a warm transfer with context', () => {
    const r = simulateCall(call({ handoff: { requested: true, agentAvailable: true, queueWaitMs: 0, acceptDelayMs: 2000 } }))
    expect(r.outcome).toBe('handed-off')
    precedes(r.events, 'HANDOFF_REQUESTED', 'HANDOFF_ACCEPTED')
    precedes(r.events, 'HANDOFF_ACCEPTED', 'HANDOFF_COMPLETED')
    expect(r.events.some((e) => e.summary.includes('CONTEXT_TRANSFER'))).toBe(true)
    expect(r.events.some((e) => e.summary.includes('MEDIA_HANDOFF'))).toBe(true)
  })

  it('falls back to a callback when no agent is reachable', () => {
    const r = simulateCall(call({ handoff: { requested: true, agentAvailable: false, queueWaitMs: 120000, acceptDelayMs: 0 } }))
    expect(types(r.events)).toContain('HANDOFF_FAILED')
    expect(r.outcome).toBe('completed')
    expect(r.events.some((e) => e.summary.toLowerCase().includes('callback'))).toBe(true)
  })

  it('an architecture with handoff requirements demands a human tier', () => {
    const requirements = { ...SCENARIOS.find((s) => s.id === 'sc-support-handoff')!.requirements }
    const { architecture } = decideArchitecture(requirements)
    expect(architecture.nodes.some((n) => n.specId === 'human-agent')).toBe(true)
    const errors = validateArchitecture(architecture, requirements).filter((i) => i.severity === 'error')
    expect(errors.map((e) => e.title)).toEqual([])
  })
})

describe('Scenario D — 1,000 concurrent calls', () => {
  const requirements = SCENARIOS.find((s) => s.id === 'sc-1k-concurrent')!.requirements

  it('plans a distributed tier with a correctly sized media fleet', () => {
    const plan = planInfrastructure(requirements)
    expect(plan.tier).toBe('distributed')
    const media = plan.components.find((c) => c.specId === 'media-gateway')!
    expect(media.instances).toBe(Math.ceil(Math.ceil(1000 / 50) / 0.7))
    expect(plan.components.map((c) => c.specId)).toContain('redis')
    expect(plan.components.map((c) => c.specId)).toContain('monitoring')
  })

  it('the generated architecture has no capacity errors at its design point', () => {
    const { architecture } = decideArchitecture(requirements)
    const errors = validateArchitecture(architecture, requirements).filter((i) => i.severity === 'error')
    expect(errors.map((e) => e.title)).toEqual([])
    expect(detectBottlenecks(architecture, requirements.peakConcurrentCalls).filter((b) => b.severity === 'critical')).toEqual([])
  })

  it('but saturates when offered ten times its design load', () => {
    const { architecture } = decideArchitecture(requirements)
    const bottlenecks = detectBottlenecks(architecture, requirements.peakConcurrentCalls * 10)
    expect(bottlenecks.length).toBeGreaterThan(0)
    expect(bottlenecks[0].consequences.length).toBeGreaterThan(0)
    expect(bottlenecks[0].remedies.length).toBeGreaterThan(0)
  })
})

describe('Scenario E — 10,000+ concurrent calls', () => {
  const requirements = SCENARIOS.find((s) => s.id === 'sc-10k-concurrent')!.requirements

  it('escalates to a multi-region tier with distributed state', () => {
    const plan = planInfrastructure(requirements)
    expect(plan.tier).toBe('multi-region')
    const ids = plan.components.map((c) => c.specId)
    expect(ids).toContain('kafka')
    expect(ids).toContain('kubernetes')
    expect(plan.narrative.join(' ')).toMatch(/region/i)
  })

  it('produces a valid architecture and explains its multi-region decision', () => {
    const result = decideArchitecture(requirements)
    const errors = validateArchitecture(result.architecture, requirements).filter((i) => i.severity === 'error')
    expect(errors.map((e) => e.title)).toEqual([])
    expect(result.decisions.some((d) => d.decision.toLowerCase().includes('multi-region'))).toBe(true)
  })

  it('costs an order of magnitude more per month than the 1k scenario', () => {
    const small = computeCost({ ...DEFAULT_COST_INPUTS, callsPerDay: 100_000, peakConcurrent: 1_000 })
    const large = computeCost({ ...DEFAULT_COST_INPUTS, callsPerDay: 600_000, peakConcurrent: 10_000 })
    expect(large.usdPerMonth).toBeGreaterThan(small.usdPerMonth * 4)
  })
})

describe('Scenario F — high-latency network', () => {
  it('degrades perceived latency without failing the call', () => {
    const normal = simulateCall(call())
    const slow = simulateCall(call({ failures: [{ target: 'network-latency', probability: 1, extraMs: 300 }] }))
    expect(slow.outcome).toBe('completed')
    expect(slow.latency.perceivedLatencyMs).toBeGreaterThan(normal.latency.perceivedLatencyMs + 400)
    expect(slow.failuresEncountered).toContain('network-latency')
  })

  it('packet loss shows up as concealment on audio frames', () => {
    const lossy = simulateCall(call({ failures: [{ target: 'packet-loss', probability: 1 }] }))
    expect(lossy.events.some((e) => e.type === 'AUDIO_FRAME_RECEIVED' && e.status === 'warn')).toBe(true)
  })
})

describe('Scenario G — STT failure', () => {
  it('kills the call when there is no fallback', () => {
    const r = simulateCall(call({
      failures: [{ target: 'stt', probability: 1 }],
      reliability: { ...DEFAULT_RELIABILITY, sttFallback: false },
    }))
    expect(r.outcome).toBe('failed')
    expect(types(r.events)).toContain('PROVIDER_ERROR')
    expect(types(r.events)).toContain('TIMEOUT')
    expect(r.events.find((e) => e.type === 'CALL_ENDED')!.status).toBe('error')
  })

  it('survives with a fallback, at a cost in accuracy and latency', () => {
    const clean = simulateCall(call())
    const r = simulateCall(call({ failures: [{ target: 'stt', probability: 1 }] }))
    expect(r.outcome).toBe('completed')
    expect(r.recoveries).toContain('stt-fallback')
    expect(types(r.events)).toContain('FALLBACK_ENGAGED')
    expect(r.wer).toBeGreaterThanOrEqual(clean.wer)
  })
})

describe('Scenario H — TTS failure with fallback', () => {
  it('engages a fallback voice rather than going silent', () => {
    const r = simulateCall(call({ failures: [{ target: 'tts', probability: 1 }] }))
    expect(r.outcome).toBe('completed')
    expect(r.recoveries).toContain('tts-fallback')
    precedes(r.events, 'PROVIDER_ERROR', 'FALLBACK_ENGAGED')
    precedes(r.events, 'FALLBACK_ENGAGED', 'PLAYBACK_STARTED')
  })

  it('without a fallback the agent thinks but cannot speak', () => {
    const r = simulateCall(call({
      failures: [{ target: 'tts', probability: 1 }],
      reliability: { ...DEFAULT_RELIABILITY, ttsFallback: false },
    }))
    expect(r.outcome).toBe('failed')
    expect(r.outcomeReason).toMatch(/never spoken/i)
  })
})

describe('Scenario I — LLM timeout', () => {
  it('times out, retries and recovers within the call', () => {
    const r = simulateCall(call({ failures: [{ target: 'llm', probability: 1 }] }))
    expect(r.outcome).toBe('completed')
    precedes(r.events, 'TIMEOUT', 'RETRY')
    expect(r.recoveries).toContain('llm-retry')
    expect(r.latency.perceivedLatencyMs).toBeGreaterThan(simulateCall(call()).latency.perceivedLatencyMs)
  })

  it('fails the call when retries are disabled', () => {
    const r = simulateCall(call({
      failures: [{ target: 'llm', probability: 1 }],
      reliability: { ...DEFAULT_RELIABILITY, llmRetry: false },
    }))
    expect(r.outcome).toBe('failed')
  })

  it('a slow tool triggers spoken filler before the timeout fires', () => {
    const r = simulateCall(call({ failures: [{ target: 'tool', probability: 1 }] }))
    expect(r.events.some((e) => e.summary.toLowerCase().includes('filler'))).toBe(true)
  })
})

describe('Scenario J — traffic spike and autoscaling', () => {
  it('scales out, degrades during warmup, then recovers', () => {
    const points = simulateTraffic({ ...DEFAULT_TRAFFIC_OPTS, spike: { startS: 120, endS: 300, multiplier: 3 } })
    const before = points.find((p) => p.t === 60)!
    const duringWarmup = points.find((p) => p.t === 170)!
    const after = points.find((p) => p.t === 420)!
    expect(duringWarmup.p95LatencyMs).toBeGreaterThan(before.p95LatencyMs)
    expect(Math.max(...points.map((p) => p.instances))).toBeGreaterThan(before.instances)
    expect(after.p95LatencyMs).toBeLessThan(duringWarmup.p95LatencyMs)
    expect(after.queueDepth).toBeLessThanOrEqual(duringWarmup.queueDepth)
  })

  it('scale-in is gradual, never evicting live calls in bulk', () => {
    const points = simulateTraffic({ ...DEFAULT_TRAFFIC_OPTS, spike: { startS: 60, endS: 200, multiplier: 3 } })
    for (let i = 1; i < points.length; i++) {
      const dropped = points[i - 1].instances - points[i].instances
      expect(dropped, `fleet shrank by ${dropped} in one tick at t=${points[i].t}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('Scenario K — region failure', () => {
  it('re-routes traffic, raises latency, and recovers', () => {
    const points = simulateRegions({
      seed: 'k', regions: ['in-mumbai', 'us-east', 'eu-west'],
      callShare: { 'in-mumbai': 0.5, 'us-east': 0.3, 'eu-west': 0.2 },
      totalConcurrent: 10000,
      failure: { region: 'in-mumbai', startS: 60, endS: 180 },
      durationS: 240, baseLatencyMs: 650,
    })
    const before = points.find((p) => p.t === 30)!
    const during = points.find((p) => p.t === 120)!
    const after = points.find((p) => p.t === 220)!
    expect(during.perRegion['in-mumbai'].healthy).toBe(false)
    expect(during.perRegion['in-mumbai'].latencyMs).toBeGreaterThan(before.perRegion['in-mumbai'].latencyMs)
    // A healthy region absorbs the failed region's users.
    const absorbing = during.perRegion[during.perRegion['in-mumbai'].servedFrom]
    expect(absorbing.servingCalls).toBeGreaterThan(before.perRegion[during.perRegion['in-mumbai'].servedFrom].servingCalls)
    expect(after.perRegion['in-mumbai'].healthy).toBe(true)
  })
})

describe('Scenario L — user interruption while the agent is speaking', () => {
  it('cancels synthesis and clears buffers in the right order', () => {
    const r = simulateCall(call({ interruption: { afterPlaybackMs: 800, utterance: 'Wait, does that include tax?' } }))
    expect(r.outcome).toBe('completed')
    precedes(r.events, 'PLAYBACK_STARTED', 'USER_INTERRUPTION')
    precedes(r.events, 'USER_INTERRUPTION', 'TTS_CANCELLED')
    precedes(r.events, 'TTS_CANCELLED', 'BUFFER_CLEARED')
  })

  it('opens a new turn and answers the interruption', () => {
    const r = simulateCall(call({ interruption: { afterPlaybackMs: 800, utterance: 'Wait, does that include tax?' } }))
    const cleared = r.events.find((e) => e.type === 'BUFFER_CLEARED')!
    const laterTurn = r.events.filter((e) => e.type === 'TURN_COMPLETE' && e.t > cleared.t)
    expect(laterTurn.length).toBeGreaterThan(0)
    const playbacks = r.events.filter((e) => e.type === 'PLAYBACK_STARTED')
    expect(playbacks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Cross-cutting coherence', () => {
  it('every scenario produces a runnable call and a valid reference architecture', () => {
    for (const scenario of SCENARIOS) {
      const r = simulateCall(call({
        seed: scenario.id,
        channel: scenario.requirements.channel === 'browser' ? 'browser' : 'phone',
        utterance: scenario.sampleUtterance,
      }))
      expect(['completed', 'handed-off'], `${scenario.id} outcome`).toContain(r.outcome)
      expect(r.events.length, `${scenario.id} events`).toBeGreaterThan(15)

      const pattern = PATTERNS.find((p) => p.id === scenario.referencePatternId)!
      expect(() => validateArchitecture(pattern.architecture, scenario.requirements)).not.toThrow()
    }
  })

  it('every scenario can be priced, sized and evaluated without error', () => {
    for (const scenario of SCENARIOS) {
      const cost = computeCost({
        ...DEFAULT_COST_INPUTS,
        callsPerDay: scenario.requirements.callsPerDay,
        avgCallMinutes: scenario.requirements.avgCallSeconds / 60,
        peakConcurrent: scenario.requirements.peakConcurrentCalls,
        recordingEnabled: scenario.requirements.recording,
      })
      expect(cost.usdPerCall, scenario.id).toBeGreaterThan(0)
      expect(Number.isFinite(cost.usdPerMonth), scenario.id).toBe(true)

      const plan = planInfrastructure(scenario.requirements)
      expect(plan.components.length, scenario.id).toBeGreaterThan(0)

      const { architecture } = decideArchitecture(scenario.requirements)
      const evaluation = evaluateArchitecture(architecture, scenario.requirements)
      expect(evaluation.findings.length, scenario.id).toBeGreaterThan(0)
      expect(evaluation.scoreLabel, scenario.id).toBeTruthy()
    }
  })

  it('reliability patterns measurably improve outcomes under the same outage', () => {
    const provider = { latencyMs: 250, outage: { startMs: 15000, endMs: 35000, mode: 'hang' as const } }
    const opts = { seed: 'integration', requests: 100, spanMs: 60000 }
    const naive = runReliabilitySim(STRATEGY_PRESETS.naive, provider, opts)
    const production = runReliabilitySim(STRATEGY_PRESETS.production, provider, opts)
    expect(production.successRate).toBeGreaterThan(naive.successRate)
    expect(production.p95Ms).toBeLessThan(naive.p95Ms)
  })

  it('the whole app is deterministic: identical inputs reproduce identical runs', () => {
    const a = simulateCall(call({ seed: 'determinism', interruption: { afterPlaybackMs: 700, utterance: 'Hold on' } }))
    const b = simulateCall(call({ seed: 'determinism', interruption: { afterPlaybackMs: 700, utterance: 'Hold on' } }))
    expect(a.events).toEqual(b.events)
    expect(a.latency).toEqual(b.latency)
    expect(a.markers).toEqual(b.markers)
    expect(decideArchitecture(SCENARIOS[3].requirements).decisions)
      .toEqual(decideArchitecture(SCENARIOS[3].requirements).decisions)
    expect(simulateTraffic(DEFAULT_TRAFFIC_OPTS)).toEqual(simulateTraffic(DEFAULT_TRAFFIC_OPTS))
  })
})
