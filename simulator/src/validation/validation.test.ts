import { describe, expect, it } from 'vitest'
import { validateArchitecture } from './rules'
import { ArchBuilder, cloneArchitecture } from '../domain/builder'
import { PATTERNS } from '../patterns/library'
import { COMPONENT_SPECS, getSpec, SPEC_BY_ID } from '../registry/components'
import { decideArchitecture } from '../decision/engine'
import { evaluateArchitecture, generateChallenge, questionsFor } from '../challenges/engine'
import { KNOWLEDGE_BY_ID, KNOWLEDGE_CARDS } from '../knowledge/cards'
import { SCENARIOS } from '../scenarios/library'
import type { Requirements } from '../domain/types'

const req = (over: Partial<Requirements> = {}): Requirements => ({
  name: 'test',
  callsPerDay: 5000,
  avgCallSeconds: 240,
  peakCallsPerMinute: 100,
  peakConcurrentCalls: 200,
  latencyTargetMs: 900,
  availabilityTarget: 0.99,
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

/** A minimal, sane streaming architecture used as the baseline for rule tests. */
function baseArch() {
  const b = new ArchBuilder('t', 'Test', 'test arch')
  const user = b.node('user')
  const tel = b.node('telephony')
  const gw = b.node('media-gateway', { replicas: 6 })
  const stt = b.node('stt')
  const rt = b.node('agent-runtime', { replicas: 4 })
  const llm = b.node('llm')
  const tts = b.node('tts', { replicas: 2 })
  const redis = b.node('redis', { replicas: 2 })
  const pg = b.node('postgres', { replicas: 2 })
  const lb = b.node('load-balancer', { replicas: 2 })
  const mon = b.node('monitoring')
  b.connect(user, tel, { protocol: 'PSTN', type: 'streaming', direction: 'bi', plane: 'media' })
  b.connect(tel, lb, { type: 'persistent', plane: 'media', direction: 'bi' })
  b.connect(lb, gw, { type: 'persistent', plane: 'media', direction: 'bi' })
  b.connect(gw, stt, { type: 'streaming', plane: 'media', direction: 'bi' })
  b.connect(stt, rt, { type: 'streaming', plane: 'media', direction: 'uni' })
  b.connect(rt, llm, { type: 'streaming', plane: 'media', direction: 'bi' })
  b.connect(rt, tts, { type: 'streaming', plane: 'media', direction: 'uni' })
  b.connect(tts, gw, { type: 'streaming', plane: 'media', direction: 'uni' })
  b.connect(rt, redis, { type: 'sync', plane: 'control' })
  b.connect(rt, pg, { type: 'async', plane: 'control' })
  b.connect(rt, mon, { type: 'async', plane: 'control' })
  return b.build()
}

const hasRule = (issues: { ruleId: string }[], id: string) => issues.some((i) => i.ruleId === id)

// ---------------------------------------------------------------------------

describe('component registry', () => {
  it('has unique spec ids', () => {
    const ids = COMPONENT_SPECS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every spec carries the full teaching payload', () => {
    for (const s of COMPONENT_SPECS) {
      expect(s.description.length, `${s.id} description`).toBeGreaterThan(20)
      expect(s.problemSolved.length, `${s.id} problemSolved`).toBeGreaterThan(20)
      expect(s.whyChoose.length, `${s.id} whyChoose`).toBeGreaterThan(10)
      expect(s.ifItFails.length, `${s.id} ifItFails`).toBeGreaterThan(10)
      expect(s.failureModes.length, `${s.id} failureModes`).toBeGreaterThan(0)
      expect(s.inputs.length + s.outputs.length, `${s.id} io`).toBeGreaterThan(0)
      for (const level of ['beginner', 'engineering', 'architecture', 'infrastructure', 'production', 'architect'] as const) {
        expect(s.learn[level].length, `${s.id}.learn.${level}`).toBeGreaterThan(20)
      }
    }
  })

  it('every failure mode explains caller impact, signal and mitigations', () => {
    for (const s of COMPONENT_SPECS) {
      for (const f of s.failureModes) {
        expect(f.callerImpact.length, `${s.id}/${f.id}`).toBeGreaterThan(10)
        expect(f.signal.length, `${s.id}/${f.id}`).toBeGreaterThan(5)
        expect(f.mitigations.length, `${s.id}/${f.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('declared dependencies and config defaults are valid', () => {
    for (const s of COMPONENT_SPECS) {
      for (const dep of s.dependencies ?? []) {
        expect(SPEC_BY_ID[dep], `${s.id} depends on unknown ${dep}`).toBeDefined()
      }
      for (const f of s.config ?? []) {
        if (f.type === 'select') {
          expect(f.options?.some((o) => o.value === f.default), `${s.id}.${f.key} default not in options`).toBe(true)
        }
      }
    }
  })

  it('component concept references resolve to knowledge cards', () => {
    for (const s of COMPONENT_SPECS) {
      for (const c of s.concepts ?? []) {
        expect(KNOWLEDGE_BY_ID[c], `${s.id} references unknown concept ${c}`).toBeDefined()
      }
    }
  })

  it('getSpec throws for unknown ids', () => {
    expect(() => getSpec('nope')).toThrow()
  })
})

describe('knowledge base', () => {
  it('has unique ids and complete cards', () => {
    const ids = KNOWLEDGE_CARDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of KNOWLEDGE_CARDS) {
      expect(c.whatIsIt.length, c.id).toBeGreaterThan(20)
      expect(c.whyExists.length, c.id).toBeGreaterThan(20)
      expect(c.problemSolved.length, c.id).toBeGreaterThan(10)
      expect(c.whereInVoice.length, c.id).toBeGreaterThan(20)
      expect(c.limitations.length, c.id).toBeGreaterThan(0)
      expect(c.failureModes.length, c.id).toBeGreaterThan(0)
      expect(c.scaling.length, c.id).toBeGreaterThan(10)
    }
  })

  it('related links resolve', () => {
    for (const c of KNOWLEDGE_CARDS) {
      for (const r of c.related) {
        expect(KNOWLEDGE_BY_ID[r], `${c.id} -> ${r}`).toBeDefined()
      }
    }
  })
})

// ---------------------------------------------------------------------------

describe('architecture validation rules', () => {
  it('a sound architecture produces no errors at its design scale', () => {
    const issues = validateArchitecture(baseArch(), req({ peakConcurrentCalls: 200 }))
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })

  it('every issue explains detection, rationale, fix and principle', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.filter((n) => n.specId !== 'monitoring')
    const issues = validateArchitecture(arch, req({ peakConcurrentCalls: 5000 }))
    expect(issues.length).toBeGreaterThan(0)
    for (const i of issues) {
      expect(i.detected.length, i.ruleId).toBeGreaterThan(10)
      expect(i.why.length, i.ruleId).toBeGreaterThan(20)
      expect(i.fix.length, i.ruleId).toBeGreaterThan(10)
      expect(i.principle.length, i.ruleId).toBeGreaterThan(10)
    }
  })

  it('detects a database on the real-time media path', () => {
    const arch = baseArch()
    const gw = arch.nodes.find((n) => n.specId === 'media-gateway')!
    const pg = arch.nodes.find((n) => n.specId === 'postgres')!
    arch.edges.push({
      id: 'bad', source: gw.id, target: pg.id, type: 'sync', protocol: 'SQL',
      direction: 'uni', streaming: false, latencyMs: 20, plane: 'media',
    })
    const issues = validateArchitecture(arch, req())
    expect(hasRule(issues, 'db-on-media-path')).toBe(true)
    expect(issues.find((i) => i.ruleId === 'db-on-media-path')!.severity).toBe('error')
  })

  it('detects a single point of failure on a critical component', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.map((n) => (n.specId === 'media-gateway' ? { ...n, replicas: 1 } : n))
    expect(hasRule(validateArchitecture(arch, req()), 'spof')).toBe(true)
  })

  it('detects insufficient connection capacity', () => {
    const arch = baseArch()
    const issues = validateArchitecture(arch, req({ peakConcurrentCalls: 50000 }))
    expect(hasRule(issues, 'connection-capacity')).toBe(true)
  })

  it('detects a non-streaming hop to a speech service on the media path', () => {
    const arch = baseArch()
    arch.edges = arch.edges.map((e) =>
      e.target === arch.nodes.find((n) => n.specId === 'stt')!.id
        ? { ...e, type: 'sync' as const, streaming: false }
        : e,
    )
    expect(hasRule(validateArchitecture(arch, req()), 'blocking-media')).toBe(true)
  })

  it('demands provider fallbacks only at high availability targets', () => {
    const arch = baseArch()
    expect(hasRule(validateArchitecture(arch, req({ availabilityTarget: 0.99 })), 'no-provider-fallback')).toBe(false)
    expect(hasRule(validateArchitecture(arch, req({ availabilityTarget: 0.999 })), 'no-provider-fallback')).toBe(true)
  })

  it('detects missing session state for replicated call servers', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.filter((n) => n.specId !== 'redis')
    arch.edges = arch.edges.filter((e) => arch.nodes.some((n) => n.id === e.source) && arch.nodes.some((n) => n.id === e.target))
    expect(hasRule(validateArchitecture(arch, req({ peakConcurrentCalls: 500 })), 'state-ownership')).toBe(true)
  })

  it('detects a missing timeout on a tool', () => {
    const arch = baseArch()
    const b = new ArchBuilder('t2', 'T', 'd')
    const toolId = b.node('tool-api', { config: { timeoutMs: 0 } })
    arch.nodes.push(b.build().nodes.find((n) => n.id === toolId)!)
    expect(hasRule(validateArchitecture(arch, req()), 'missing-timeout')).toBe(true)
  })

  it('flags a tool timeout that no conversation can afford', () => {
    const arch = baseArch()
    const b = new ArchBuilder('t3', 'T', 'd')
    const toolId = b.node('tool-api', { config: { timeoutMs: 8000 } })
    arch.nodes.push(b.build().nodes.find((n) => n.id === toolId)!)
    expect(hasRule(validateArchitecture(arch, req()), 'timeout-too-long')).toBe(true)
  })

  it('detects a queue with no consumers', () => {
    const arch = baseArch()
    const b = new ArchBuilder('t4', 'T', 'd')
    const qId = b.node('queue')
    arch.nodes.push(b.build().nodes.find((n) => n.id === qId)!)
    const rt = arch.nodes.find((n) => n.specId === 'agent-runtime')!
    arch.edges.push({ id: 'toq', source: rt.id, target: qId, type: 'async', protocol: 'AMQP', direction: 'uni', streaming: false, latencyMs: 2, plane: 'control' })
    expect(hasRule(validateArchitecture(arch, req()), 'unbounded-queue')).toBe(true)
  })

  it('demands a human tier when handoff is required', () => {
    expect(hasRule(validateArchitecture(baseArch(), req({ humanHandoff: true })), 'missing-handoff')).toBe(true)
    expect(hasRule(validateArchitecture(baseArch(), req({ humanHandoff: false })), 'missing-handoff')).toBe(false)
  })

  it('demands storage when recording is required', () => {
    expect(hasRule(validateArchitecture(baseArch(), req({ recording: true })), 'missing-recording-storage')).toBe(true)
  })

  it('demands observability once the system is non-trivial', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.filter((n) => n.specId !== 'monitoring')
    expect(hasRule(validateArchitecture(arch, req()), 'no-observability')).toBe(true)
  })

  it('rejects batch STT against a tight latency target', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.map((n) => (n.specId === 'stt' ? { ...n, config: { ...n.config, provider: 'stt-whisper-batch' } } : n))
    expect(hasRule(validateArchitecture(arch, req({ latencyTargetMs: 450 })), 'batch-stt-latency')).toBe(true)
  })

  it('flags a single-region deployment for multi-region requirements', () => {
    expect(hasRule(validateArchitecture(baseArch(), req({ regions: ['in-mumbai', 'us-east'] })), 'single-region-for-multi')).toBe(true)
  })

  it('detects a broken pipeline (STT cannot reach the LLM)', () => {
    const arch = baseArch()
    const stt = arch.nodes.find((n) => n.specId === 'stt')!
    arch.edges = arch.edges.filter((e) => e.source !== stt.id)
    expect(hasRule(validateArchitecture(arch, req()), 'pipeline-break')).toBe(true)
  })

  it('detects a missing user endpoint and missing intelligence', () => {
    const b = new ArchBuilder('empty', 'Empty', 'no endpoints')
    b.node('media-gateway')
    const issues = validateArchitecture(b.build(), req())
    expect(hasRule(issues, 'no-endpoint')).toBe(true)
    expect(hasRule(issues, 'no-intelligence')).toBe(true)
  })

  it('detects orphan components', () => {
    const arch = baseArch()
    const b = new ArchBuilder('t5', 'T', 'd')
    const kafkaId = b.node('kafka')
    arch.nodes.push(b.build().nodes.find((n) => n.id === kafkaId)!)
    expect(hasRule(validateArchitecture(arch, req()), 'orphan')).toBe(true)
  })

  it('detects unnecessary transcoding from chained gateways', () => {
    const arch = baseArch()
    const b = new ArchBuilder('t6', 'T', 'd')
    arch.nodes.push(
      { ...b.build().nodes[0], id: 'gw2', specId: 'media-gateway', label: 'GW2', position: { x: 0, y: 0 }, config: {}, replicas: 1 },
      { ...b.build().nodes[0], id: 'gw3', specId: 'media-gateway', label: 'GW3', position: { x: 0, y: 0 }, config: {}, replicas: 1 },
    )
    expect(hasRule(validateArchitecture(arch, req()), 'unnecessary-transcoding')).toBe(true)
  })

  it('never throws, even on a malformed architecture', () => {
    const broken = { id: 'x', name: 'x', description: '', nodes: [], edges: [{ id: 'e', source: 'nope', target: 'also-nope', type: 'sync' as const, protocol: 'HTTP' as const, direction: 'uni' as const, streaming: false, latencyMs: 1, plane: 'media' as const }], assumptions: [], version: 1 as const }
    expect(() => validateArchitecture(broken, req())).not.toThrow()
  })

  it('sorts errors before warnings before info', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.filter((n) => n.specId !== 'monitoring')
    const issues = validateArchitecture(arch, req({ peakConcurrentCalls: 50000, humanHandoff: true }))
    const order = { error: 0, warning: 1, info: 2 }
    for (let i = 1; i < issues.length; i++) {
      expect(order[issues[i].severity]).toBeGreaterThanOrEqual(order[issues[i - 1].severity])
    }
  })
})

// ---------------------------------------------------------------------------

describe('pattern library', () => {
  it('every pattern has unique ids and resolvable specs', () => {
    const ids = PATTERNS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PATTERNS) {
      for (const n of p.architecture.nodes) {
        expect(SPEC_BY_ID[n.specId], `${p.id}: unknown spec ${n.specId}`).toBeDefined()
      }
    }
  })

  it('every pattern edge references existing nodes', () => {
    for (const p of PATTERNS) {
      const ids = new Set(p.architecture.nodes.map((n) => n.id))
      for (const e of p.architecture.edges) {
        expect(ids.has(e.source), `${p.id}: edge from unknown ${e.source}`).toBe(true)
        expect(ids.has(e.target), `${p.id}: edge to unknown ${e.target}`).toBe(true)
      }
    }
  })

  it('every pattern validates without throwing and carries guidance', () => {
    for (const p of PATTERNS) {
      expect(() => validateArchitecture(p.architecture, p.architecture.requirements)).not.toThrow()
      expect(p.whenToUse.length).toBeGreaterThan(20)
      expect(p.whenNotToUse.length).toBeGreaterThan(20)
      expect(p.tradeoffs.length).toBeGreaterThan(0)
    }
  })

  it('the simple batch pattern is flagged for its batch stages under a tight target', () => {
    const simple = PATTERNS.find((p) => p.id === 'pat-simple')!
    const issues = validateArchitecture(simple.architecture, req({ latencyTargetMs: 600 }))
    expect(hasRule(issues, 'batch-stt-latency') || hasRule(issues, 'blocking-media')).toBe(true)
  })

  it('cloning a pattern does not mutate the library', () => {
    const original = PATTERNS[1].architecture
    const copy = cloneArchitecture(original, 'copy')
    copy.nodes[0].label = 'MUTATED'
    copy.nodes.push({ ...copy.nodes[0], id: 'extra' })
    expect(original.nodes[0].label).not.toBe('MUTATED')
    expect(original.nodes.length).not.toBe(copy.nodes.length)
  })
})

// ---------------------------------------------------------------------------

describe('decision engine', () => {
  it('produces decisions with a full Requirement→Constraint→Decision→Tradeoff chain', () => {
    const r = decideArchitecture(req({ peakConcurrentCalls: 500, humanHandoff: true, recording: true }))
    expect(r.decisions.length).toBeGreaterThan(5)
    for (const d of r.decisions) {
      expect(d.requirement.length, d.id).toBeGreaterThan(10)
      expect(d.constraint.length, d.id).toBeGreaterThan(20)
      expect(d.decision.length, d.id).toBeGreaterThan(10)
      expect(d.tradeoff.length, d.id).toBeGreaterThan(20)
    }
  })

  it('is deterministic for identical requirements', () => {
    const a = decideArchitecture(req())
    const b = decideArchitecture(req())
    expect(a.decisions).toEqual(b.decisions)
    expect(a.architecture.nodes.map((n) => n.specId)).toEqual(b.architecture.nodes.map((n) => n.specId))
  })

  it('scales the media tier with concurrency', () => {
    const small = decideArchitecture(req({ peakConcurrentCalls: 50 }))
    const large = decideArchitecture(req({ peakConcurrentCalls: 5000 }))
    const smallGw = small.architecture.nodes.find((n) => n.specId === 'media-gateway')!
    const largeGw = large.architecture.nodes.find((n) => n.specId === 'media-gateway')!
    expect(largeGw.replicas).toBeGreaterThan(smallGw.replicas * 10)
  })

  it('adds Redis only when scale or availability demands it', () => {
    const tiny = decideArchitecture(req({ peakConcurrentCalls: 20, availabilityTarget: 0.99 }))
    const big = decideArchitecture(req({ peakConcurrentCalls: 2000 }))
    expect(tiny.architecture.nodes.some((n) => n.specId === 'redis')).toBe(false)
    expect(big.architecture.nodes.some((n) => n.specId === 'redis')).toBe(true)
  })

  it('adds the human tier when handoff is required', () => {
    const withHandoff = decideArchitecture(req({ humanHandoff: true }))
    const without = decideArchitecture(req({ humanHandoff: false }))
    expect(withHandoff.architecture.nodes.some((n) => n.specId === 'human-agent')).toBe(true)
    expect(without.architecture.nodes.some((n) => n.specId === 'human-agent')).toBe(false)
  })

  it('adds object storage when recording is required', () => {
    expect(decideArchitecture(req({ recording: true })).architecture.nodes.some((n) => n.specId === 'object-storage')).toBe(true)
    expect(decideArchitecture(req({ recording: false })).architecture.nodes.some((n) => n.specId === 'object-storage')).toBe(false)
  })

  it('chooses the browser edge for browser channels and telephony for phone', () => {
    const browser = decideArchitecture(req({ channel: 'browser' }))
    expect(browser.architecture.nodes.some((n) => n.specId === 'webrtc')).toBe(true)
    expect(browser.architecture.nodes.some((n) => n.specId === 'telephony')).toBe(false)
    const phone = decideArchitecture(req({ channel: 'phone' }))
    expect(phone.architecture.nodes.some((n) => n.specId === 'telephony')).toBe(true)
  })

  it('picks the India-focused STT for Hindi + Mumbai requirements', () => {
    const r = decideArchitecture(req({ languages: ['hi-IN', 'en-IN'], regions: ['in-mumbai'] }))
    const stt = r.architecture.nodes.find((n) => n.specId === 'stt')!
    expect(stt.config.provider).toBe('stt-indic')
  })

  it('reaches for speech-to-speech only under an aggressive premium target', () => {
    const premiumFast = decideArchitecture(req({ latencyTargetMs: 500, budgetPosture: 'premium', toolUsage: 0.1 }))
    expect(premiumFast.decisions.some((d) => d.decision.toLowerCase().includes('speech-to-speech'))).toBe(true)
    const ordinary = decideArchitecture(req({ latencyTargetMs: 1200, budgetPosture: 'balanced' }))
    expect(ordinary.decisions.some((d) => d.decision.toLowerCase().includes('speech-to-speech'))).toBe(false)
  })

  it('generated architectures pass their own validator without errors', () => {
    for (const concurrent of [20, 200, 1500, 12000]) {
      const requirements = req({ peakConcurrentCalls: concurrent, humanHandoff: true, recording: true, availabilityTarget: 0.999 })
      const { architecture } = decideArchitecture(requirements)
      const errors = validateArchitecture(architecture, requirements).filter((i) => i.severity === 'error')
      expect(errors.map((e) => e.title), `errors at ${concurrent} concurrent`).toEqual([])
    }
  })

  it('every decision records at least one rejected alternative', () => {
    const r = decideArchitecture(req({ humanHandoff: true, recording: true }))
    const withAlternatives = r.decisions.filter((d) => d.alternatives.length > 0)
    expect(withAlternatives.length).toBeGreaterThan(r.decisions.length / 2)
  })
})

// ---------------------------------------------------------------------------

describe('scenarios', () => {
  it('have unique ids and reference existing patterns', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SCENARIOS) {
      expect(PATTERNS.some((p) => p.id === s.referencePatternId), `${s.id} -> ${s.referencePatternId}`).toBe(true)
    }
  })

  it('carry a story, crux and sample utterance', () => {
    for (const s of SCENARIOS) {
      expect(s.story.length, s.id).toBeGreaterThan(50)
      expect(s.crux.length, s.id).toBeGreaterThan(1)
      expect(s.sampleUtterance.length, s.id).toBeGreaterThan(5)
      expect(s.requirements.peakConcurrentCalls, s.id).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------

describe('challenge engine', () => {
  it('generates deterministic challenges from a seed', () => {
    expect(generateChallenge('abc')).toEqual(generateChallenge('abc'))
    expect(generateChallenge('abc').requirements).not.toEqual(generateChallenge('xyz').requirements)
  })

  it('questions adapt to the requirements', () => {
    const browserQs = questionsFor(req({ channel: 'browser' }))
    const transport = browserQs.find((q) => q.id === 'transport')!
    expect(transport.goodAnswers).toContain('webrtc')

    const phoneQs = questionsFor(req({ channel: 'phone' }))
    expect(phoneQs.find((q) => q.id === 'transport')!.badAnswers).toContain('webrtc')
  })

  it('every question option has feedback', () => {
    for (const seed of ['a', 'b', 'c']) {
      for (const q of generateChallenge(seed).questions) {
        for (const o of q.options ?? []) {
          expect(q.feedback[o.id], `${q.id}/${o.id}`).toBeDefined()
        }
        expect(q.principle.length).toBeGreaterThan(10)
      }
    }
  })

  it('a tight latency target marks batch pipelines as wrong', () => {
    const qs = questionsFor(req({ latencyTargetMs: 700 }))
    const streaming = qs.find((q) => q.id === 'streaming')!
    expect(streaming.badAnswers).toContain('batch')
    expect(streaming.goodAnswers).toContain('stream')
  })

  it('handoff questions appear only when handoff is required', () => {
    expect(questionsFor(req({ humanHandoff: true })).some((q) => q.id === 'handoff')).toBe(true)
    expect(questionsFor(req({ humanHandoff: false })).some((q) => q.id === 'handoff')).toBe(false)
  })

  it('evaluates a good architecture favourably', () => {
    const requirements = req({ peakConcurrentCalls: 200 })
    const result = evaluateArchitecture(baseArch(), requirements)
    expect(result.findings.some((f) => f.kind === 'satisfies')).toBe(true)
    expect(result.findings.some((f) => f.kind === 'assumption')).toBe(true)
    expect(result.cost).toBeDefined()
    expect(result.latency).toBeDefined()
  })

  it('flags a missing phone edge as a violation', () => {
    const arch = baseArch()
    arch.nodes = arch.nodes.filter((n) => n.specId !== 'telephony')
    arch.edges = arch.edges.filter((e) => arch.nodes.some((n) => n.id === e.source) && arch.nodes.some((n) => n.id === e.target))
    const result = evaluateArchitecture(arch, req({ channel: 'phone' }))
    expect(result.findings.some((f) => f.kind === 'violates' && f.title.includes('Phone reach'))).toBe(true)
  })

  it('reports bottlenecks when the design is undersized', () => {
    const result = evaluateArchitecture(baseArch(), req({ peakConcurrentCalls: 50000 }))
    expect(result.bottlenecks.length).toBeGreaterThan(0)
    expect(result.findings.some((f) => f.kind === 'bottleneck')).toBe(true)
    expect(result.scoreLabel).toMatch(/blocking/)
  })

  it('expected components reflect the brief', () => {
    const c = generateChallenge('seed-with-handoff')
    if (c.requirements.humanHandoff) expect(c.expectedComponents).toContain('human-agent')
    if (c.requirements.recording) expect(c.expectedComponents).toContain('object-storage')
    expect(c.rubric.length).toBeGreaterThan(3)
  })
})
