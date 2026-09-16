import { describe, expect, it } from 'vitest'
import { ArchBuilder } from '../domain/builder'
import { PATTERNS } from '../patterns/library'
import type { Architecture, Requirements } from '../domain/types'
import {
  PRESSURE_TESTS,
  runAllPressureTests,
  runPressureTest,
  summarisePressure,
  headroom,
  costInputsFor,
  latencyParamsFor,
} from './pressure'
import {
  CODE_SWITCH_EXAMPLES,
  DEFAULT_RECOGNITION,
  LANGUAGES,
  corrupt,
  getLanguage,
  recognitionQuality,
  wordErrorRate,
} from './language'
import {
  MAXIMAL_SELECTION,
  MINIMAL_SELECTION,
  PROMPT_SECTIONS,
  composePrompt,
  instructionQuality,
} from './prompt'
import {
  DEFAULT_QUALITY_CONFIG,
  FAILURE_META,
  TURN_CASES,
  expectedByKind,
  expectedFailureRate,
  explainCase,
  runQuality,
  type QualityConfig,

} from './agentQuality'
import {
  DEFAULT_SWEEP_SEEDS,
  VERDICT_MEANING,
  compareSuites,
  runSuite,
  sweepSeeds,
} from './evaluation'
import { rankByLoadBearing, removalConsequence, withoutNode } from './whatIf'
import { DATA_ARTEFACTS, REGIMES, checkCompliance, sensitiveNodes } from './compliance'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A full streaming architecture with redundancy — the "good" fixture. */
function solidArch(): Architecture {
  const b = new ArchBuilder('solid', 'Solid', 'redundant streaming stack')
  const user = b.node('user')
  const tel = b.node('telephony')
  const lb = b.node('load-balancer', { replicas: 2 })
  const gw = b.node('media-gateway', { replicas: 8 })
  const stt = b.node('stt', { replicas: 2 })
  const stt2 = b.node('stt', { replicas: 2, label: 'Fallback STT' })
  const rt = b.node('agent-runtime', { replicas: 6 })
  const llm = b.node('llm', { replicas: 2 })
  const tts = b.node('tts', { replicas: 2 })
  const redis = b.node('redis', { replicas: 2 })
  const pg = b.node('postgres', { replicas: 2 })
  const q = b.node('queue', { replicas: 2 })
  const mon = b.node('monitoring')
  b.connect(user, tel, { protocol: 'PSTN', direction: 'bi' })
  b.connect(tel, lb, { type: 'persistent', plane: 'media', direction: 'bi' })
  b.connect(lb, gw, { type: 'persistent', plane: 'media', direction: 'bi' })
  b.connect(gw, stt, { type: 'streaming', plane: 'media', direction: 'bi' })
  b.connect(gw, stt2, { type: 'streaming', plane: 'media', direction: 'bi' })
  b.connect(stt, rt, { type: 'streaming', plane: 'media', direction: 'uni' })
  b.connect(rt, llm, { type: 'streaming', plane: 'media', direction: 'bi' })
  b.connect(rt, tts, { type: 'streaming', plane: 'media', direction: 'uni' })
  b.connect(tts, gw, { type: 'streaming', plane: 'media', direction: 'uni' })
  b.connect(rt, redis, { type: 'sync', plane: 'control' })
  b.connect(rt, q, { type: 'async', plane: 'control' })
  b.connect(q, pg, { type: 'async', plane: 'control' })
  b.connect(rt, mon, { type: 'async', plane: 'control' })
  return b.build()
}

/** One box, one of everything, no redundancy — the "fragile" fixture. */
function fragileArch(): Architecture {
  const b = new ArchBuilder('fragile', 'Fragile', 'single instance everything')
  const user = b.node('user')
  const tel = b.node('telephony')
  const gw = b.node('media-gateway')
  const stt = b.node('stt')
  const llm = b.node('llm')
  const tts = b.node('tts')
  const pg = b.node('postgres')
  b.connect(user, tel, { protocol: 'PSTN', direction: 'bi' })
  b.connect(tel, gw, { type: 'persistent', plane: 'media', direction: 'bi' })
  b.connect(gw, stt, { type: 'sync', plane: 'media', streaming: false })
  b.connect(stt, llm, { type: 'sync', plane: 'media', streaming: false })
  b.connect(llm, tts, { type: 'sync', plane: 'media', streaming: false })
  b.connect(tts, gw, { type: 'sync', plane: 'media', streaming: false })
  b.connect(gw, pg, { type: 'async', plane: 'control' })
  return b.build()
}

// ---------------------------------------------------------------------------
// Pressure testing
// ---------------------------------------------------------------------------

describe('pressure testing', () => {
  it('runs every test against every shipped pattern without throwing', () => {
    for (const p of PATTERNS) {
      const r = p.architecture.requirements ?? req()
      const results = runAllPressureTests(p.architecture, r)
      expect(results, p.id).toHaveLength(PRESSURE_TESTS.length)
      for (const res of results) {
        expect(['holds', 'degrades', 'breaks'], `${p.id}/${res.test.id}`).toContain(res.verdict)
        expect(res.findings.length, `${p.id}/${res.test.id} findings`).toBeGreaterThan(0)
        expect(res.headline.length, `${p.id}/${res.test.id} headline`).toBeGreaterThan(20)
      }
    }
  })

  it('every finding names both what happened and what to do about it', () => {
    for (const res of runAllPressureTests(solidArch(), req())) {
      for (const f of res.findings) {
        expect(f.detail.length, `${res.test.id}: ${f.title}`).toBeGreaterThan(40)
        expect(f.remedy.length, `${res.test.id}: ${f.title}`).toBeGreaterThan(30)
      }
    }
  })

  it('is deterministic — the same inputs give the same verdicts', () => {
    const a = runAllPressureTests(solidArch(), req()).map((r) => r.verdict)
    const b = runAllPressureTests(solidArch(), req()).map((r) => r.verdict)
    expect(a).toEqual(b)
  })

  it('a single-provider design breaks under a vendor outage', () => {
    const r = runPressureTest(fragileArch(), req(), 'provider-outage')
    expect(r.verdict).toBe('breaks')
    expect(r.findings.some((f) => f.severity === 'breaks')).toBe(true)
  })

  it('a two-provider design survives the same outage', () => {
    const r = runPressureTest(solidArch(), req(), 'provider-outage')
    expect(r.findings.find((f) => f.title.includes('recognition path'))?.severity).toBe('holds')
  })

  it('10x traffic on a stateless-less design demands external session state', () => {
    const r = runPressureTest(fragileArch(), req({ peakConcurrentCalls: 200 }), 'traffic-10x')
    expect(r.verdict).toBe('breaks')
    expect(r.findings.some((f) => f.title.toLowerCase().includes('session state'))).toBe(true)
  })

  it('10x traffic reports the load it actually applied', () => {
    const r = runPressureTest(solidArch(), req({ peakConcurrentCalls: 200 }), 'traffic-10x')
    expect(r.stressed.peakConcurrentCalls).toBe(2000)
    expect(r.deltas.some((d) => d.after.includes('2,000'))).toBe(true)
  })

  it('unreplicated components are named when the availability target rises', () => {
    const r = runPressureTest(fragileArch(), req(), 'availability-up')
    expect(r.verdict).toBe('breaks')
    expect(r.findings.some((f) => f.title.includes('unreplicated'))).toBe(true)
  })

  it('replicating the critical path improves the composite availability', () => {
    const fragile = runPressureTest(fragileArch(), req(), 'availability-up')
    const solid = runPressureTest(solidArch(), req(), 'availability-up')
    const pctOf = (s: string) => Number(s.replace('%', ''))
    expect(pctOf(solid.deltas[0].before)).toBeGreaterThan(pctOf(fragile.deltas[0].before))
  })

  it('a second region is a media-termination problem, not a deployment one', () => {
    const r = runPressureTest(solidArch(), req({ regions: ['us-east'] }), 'regional-expansion')
    expect(r.verdict).toBe('breaks')
    expect(r.stressed.regions.length).toBe(2)
    expect(r.deltas.some((d) => d.label.includes('latency') && d.worse)).toBe(true)
  })

  it('an already-global deployment has nothing left to expand into', () => {
    const r = runPressureTest(solidArch(), req({ regions: ['us-east', 'eu-west', 'in-mumbai', 'ap-singapore'] }), 'regional-expansion')
    expect(r.verdict).toBe('holds')
  })

  it('tripled escalations break a design with no human tier that requires one', () => {
    const r = runPressureTest(solidArch(), req({ humanHandoff: true }), 'more-handoffs')
    expect(r.verdict).toBe('breaks')
  })

  it('sizes the human tier below 100% occupancy, as Erlang C requires', () => {
    const r = runPressureTest(solidArch(), req({ peakConcurrentCalls: 1000, humanHandoff: true }), 'more-handoffs')
    const seats = Number(r.deltas.find((d) => d.label === 'Seats required')?.after ?? '0')
    // 30% of 1000 calls = 300 offered; at 75% target occupancy that is 400 seats.
    expect(seats).toBe(400)
    expect(seats).toBeGreaterThan(1000 * 0.3)
  })

  it('a queue written to synchronously from the media path is flagged as fake-async', () => {
    const b = new ArchBuilder('sync-q', 'Sync queue', 'queue on the hot path')
    const gw = b.node('media-gateway')
    const q = b.node('queue')
    b.connect(gw, q, { type: 'sync', plane: 'control' })
    const r = runPressureTest(b.build(), req(), 'queue-saturation')
    expect(r.verdict).toBe('breaks')
    expect(r.findings.some((f) => f.title.includes('synchronously'))).toBe(true)
  })

  it('a genuinely async queue keeps a backlog off the conversation', () => {
    const r = runPressureTest(solidArch(), req(), 'queue-saturation')
    expect(r.findings.some((f) => f.severity === 'holds')).toBe(true)
  })

  it('a slow database is dead air when a tool is on the turn path', () => {
    const b = new ArchBuilder('tooled', 'Tooled', 'has a tool')
    const rt = b.node('agent-runtime')
    const tool = b.node('tool-api')
    const pg = b.node('postgres')
    b.connect(rt, tool, { type: 'sync', plane: 'control' })
    b.connect(tool, pg, { type: 'sync', plane: 'control' })
    const r = runPressureTest(b.build(), req({ latencyTargetMs: 800 }), 'db-slowdown')
    expect(r.verdict).toBe('breaks')
    expect(r.deltas.some((d) => d.label.includes('Perceived latency'))).toBe(true)
  })

  it('reads the streaming configuration off the architecture, not from defaults', () => {
    // solidArch streams end to end; fragileArch is batch at every hop. Judging
    // the streaming design by the batch design's numbers is exactly the bug
    // this test exists to prevent.
    const streaming = latencyParamsFor(solidArch(), req())
    const batch = latencyParamsFor(fragileArch(), req())
    expect(streaming.sttStreaming).toBe(true)
    expect(streaming.ttsStreaming).toBe(true)
    expect(batch.sttStreaming).toBe(false)
    expect(batch.ttsStreaming).toBe(false)
    expect(streaming.budgetMs).toBe(req().latencyTargetMs)
  })

  it('only puts a tool on the critical path when something calls it synchronously', () => {
    const b = new ArchBuilder('async-tool', 'Async tool', 'tool off the turn path')
    const rt = b.node('agent-runtime')
    const tool = b.node('tool-api')
    b.connect(rt, tool, { type: 'async', plane: 'control' })
    expect(latencyParamsFor(b.build(), req()).toolMs).toBe(0)

    const c = new ArchBuilder('sync-tool', 'Sync tool', 'tool on the turn path')
    const rt2 = c.node('agent-runtime')
    const tool2 = c.node('tool-api')
    c.connect(rt2, tool2, { type: 'sync', plane: 'control' })
    expect(latencyParamsFor(c.build(), req()).toolMs).toBeGreaterThan(0)
  })

  it('a streaming design survives added distance that a batch design does not', () => {
    const streaming = runPressureTest(solidArch(), req({ latencyTargetMs: 1200 }), 'latency-increase')
    const batch = runPressureTest(fragileArch(), req({ latencyTargetMs: 1200 }), 'latency-increase')
    const ms = (r: typeof streaming) => Number(r.deltas[0].after.replace(/[^0-9]/g, ''))
    expect(ms(streaming)).toBeLessThan(ms(batch))
  })

  it('summarises the whole suite worst-first', () => {
    const s = summarisePressure(runAllPressureTests(fragileArch(), req()))
    expect(s.holds + s.degrades + s.breaks).toBe(PRESSURE_TESTS.length)
    const order = s.worst.map((r) => r.verdict)
    const rank = { breaks: 0, degrades: 1, holds: 2 } as const
    for (let i = 1; i < order.length; i++) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]])
    }
  })

  it('headroom falls as load rises', () => {
    const arch = solidArch()
    expect(headroom(arch, 50)).toBeGreaterThan(headroom(arch, 5000))
  })

  it('derives cost inputs from requirements rather than inventing them', () => {
    const r = req({ callsPerDay: 1234, avgCallSeconds: 120, recording: true })
    const inputs = costInputsFor(r)
    expect(inputs.callsPerDay).toBe(1234)
    expect(inputs.avgCallMinutes).toBe(2)
    expect(inputs.recordingEnabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Language & recognition
// ---------------------------------------------------------------------------

describe('language and code-switching', () => {
  it('every language profile carries hazards a designer can act on', () => {
    for (const l of LANGUAGES) {
      expect(l.hazards.length, l.id).toBeGreaterThan(0)
      expect(l.baseWer).toBeGreaterThan(0)
      expect(l.baseWer).toBeLessThan(0.5)
    }
  })

  it('telephony audio costs accuracy that wideband does not', () => {
    const phone = recognitionQuality({ ...DEFAULT_RECOGNITION, channel: 'phone' })
    const browser = recognitionQuality({ ...DEFAULT_RECOGNITION, channel: 'browser' })
    expect(phone.wer).toBeGreaterThan(browser.wer)
  })

  it('noise makes recognition monotonically worse', () => {
    const quiet = recognitionQuality({ ...DEFAULT_RECOGNITION, noiseLevel: 0 })
    const loud = recognitionQuality({ ...DEFAULT_RECOGNITION, noiseLevel: 0.8 })
    expect(loud.wer).toBeGreaterThan(quiet.wer)
  })

  it('handles code-switching best when the recogniser knows about it', () => {
    const base = { ...DEFAULT_RECOGNITION, codeSwitchRate: 0.5 }
    const naive = recognitionQuality({ ...base, codeSwitchAware: false, perUtteranceRouting: false })
    const routed = recognitionQuality({ ...base, perUtteranceRouting: true })
    const aware = recognitionQuality({ ...base, codeSwitchAware: true })
    expect(aware.codeSwitchedWer).toBeLessThan(routed.codeSwitchedWer)
    expect(routed.codeSwitchedWer).toBeLessThan(naive.codeSwitchedWer)
  })

  it('code-switched utterances are always at least as hard as monolingual ones', () => {
    for (const aware of [true, false]) {
      const q = recognitionQuality({ ...DEFAULT_RECOGNITION, codeSwitchAware: aware })
      expect(q.codeSwitchedWer).toBeGreaterThanOrEqual(q.monolingualWer)
    }
  })

  it('the effective rate sits between the monolingual and code-switched rates', () => {
    const q = recognitionQuality({ ...DEFAULT_RECOGNITION, codeSwitchRate: 0.4 })
    expect(q.wer).toBeGreaterThanOrEqual(q.monolingualWer)
    expect(q.wer).toBeLessThanOrEqual(q.codeSwitchedWer)
  })

  it('custom vocabulary helps rather than hurts', () => {
    const without = recognitionQuality({ ...DEFAULT_RECOGNITION, customVocabulary: false })
    const with_ = recognitionQuality({ ...DEFAULT_RECOGNITION, customVocabulary: true })
    expect(with_.wer).toBeLessThan(without.wer)
  })

  it('contributions are ordered by how much they matter', () => {
    const q = recognitionQuality(DEFAULT_RECOGNITION)
    const sizes = q.contributions.map((c) => Math.abs(c.deltaWer))
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1])
  })

  it('falls back to a real profile for an unknown language id', () => {
    expect(getLanguage('kl-ingon').id).toBe(LANGUAGES[0].id)
  })

  it('every code-switch example shows all three recognitions and the consequence', () => {
    for (const ex of CODE_SWITCH_EXAMPLES) {
      expect(ex.spoken.length).toBeGreaterThan(2)
      expect(ex.heardAsEnglish).not.toBe(ex.heardAsHindi)
      expect(ex.consequence.length).toBeGreaterThan(80)
    }
  })

  it('corrupts transcripts deterministically', () => {
    const a = corrupt('where is my order five five three seven', 0.3, 'seed-1')
    const b = corrupt('where is my order five five three seven', 0.3, 'seed-1')
    const c = corrupt('where is my order five five three seven', 0.3, 'seed-2')
    expect(a).toEqual(b)
    expect(a.text).not.toBe(c.text)
  })

  it('corrupts more at a higher error rate', () => {
    const light = corrupt('one two three four five six seven eight nine ten', 0.05, 's')
    const heavy = corrupt('one two three four five six seven eight nine ten', 0.8, 's')
    expect(heavy.errors).toBeGreaterThan(light.errors)
  })

  it('computes word error rate against a reference', () => {
    expect(wordErrorRate('a b c', 'a b c')).toBe(0)
    expect(wordErrorRate('a b c', 'a b')).toBeCloseTo(1 / 3, 4)
    expect(wordErrorRate('a b c', 'a x c')).toBeCloseTo(1 / 3, 4)
    expect(wordErrorRate('', '')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Prompt engineering
// ---------------------------------------------------------------------------

describe('prompt engineering', () => {
  it('every section option states what it costs you', () => {
    for (const s of PROMPT_SECTIONS) {
      expect(s.options.length).toBeGreaterThanOrEqual(2)
      for (const o of s.options) {
        expect(o.tradeoff.length, `${s.id}/${o.id}`).toBeGreaterThan(30)
      }
    }
  })

  it('a maximal prompt scores higher on every factor than a minimal one', () => {
    const min = composePrompt(MINIMAL_SELECTION)
    const max = composePrompt(MAXIMAL_SELECTION)
    for (const k of Object.keys(max.factors) as (keyof typeof max.factors)[]) {
      expect(max.factors[k], k).toBeGreaterThanOrEqual(min.factors[k])
    }
    expect(instructionQuality(max.factors)).toBeGreaterThan(instructionQuality(min.factors))
  })

  it('factors never exceed one however many sections reinforce them', () => {
    const max = composePrompt(MAXIMAL_SELECTION)
    for (const v of Object.values(max.factors)) expect(v).toBeLessThanOrEqual(1)
  })

  it('costs tokens for the instructions it adds', () => {
    const min = composePrompt(MINIMAL_SELECTION)
    const max = composePrompt(MAXIMAL_SELECTION)
    expect(max.tokens).toBeGreaterThan(min.tokens * 5)
    // The weakest option still lists the tools — an agent that does not know
    // its tools exist is not a weaker prompt, it is a different product.
    expect(min.tokens).toBeGreaterThan(0)
    expect(min.tokens).toBeLessThan(40)
  })

  it('warns about a prompt with no spoken-output constraint', () => {
    const w = composePrompt(MINIMAL_SELECTION).warnings
    expect(w.some((x) => x.title.includes('spoken-output'))).toBe(true)
  })

  it('warns when tools are documented but bad input is not handled', () => {
    const sel = { ...MINIMAL_SELECTION, tools: 'contracted' }
    expect(composePrompt(sel).warnings.some((x) => x.title.includes('no instruction about bad input'))).toBe(true)
  })

  it('warns that a long prompt is paid on every turn', () => {
    expect(composePrompt(MAXIMAL_SELECTION).warnings.some((x) => x.title.includes('Long prompt'))).toBe(true)
  })

  it('falls back to the first option for an unknown selection', () => {
    expect(() => composePrompt({ role: 'nonexistent' })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Agent quality
// ---------------------------------------------------------------------------

const goodConfig = (over: Partial<QualityConfig> = {}): QualityConfig => ({
  ...DEFAULT_QUALITY_CONFIG,
  factors: composePrompt(MAXIMAL_SELECTION).factors,
  modelTier: 'frontier',
  contextStrategy: 'summarised',
  wer: 0.03,
  overlappingTools: false,
  temperature: 0.3,
  ...over,
})

const badConfig = (over: Partial<QualityConfig> = {}): QualityConfig => ({
  ...DEFAULT_QUALITY_CONFIG,
  factors: composePrompt(MINIMAL_SELECTION).factors,
  modelTier: 'small',
  contextStrategy: 'last-n',
  contextTurns: 2,
  wer: 0.2,
  overlappingTools: true,
  temperature: 1,
  ...over,
})

describe('agent quality', () => {
  it('every failure kind explains what the caller sees and what it costs', () => {
    for (const [kind, meta] of Object.entries(FAILURE_META)) {
      expect(meta.whatCallerSees.length, kind).toBeGreaterThan(20)
      expect(meta.whyItHappens.length, kind).toBeGreaterThan(40)
      expect(meta.costsYou.length, kind).toBeGreaterThan(20)
    }
  })

  it('is deterministic for a given config and seed', () => {
    const a = runQuality(goodConfig())
    const b = runQuality(goodConfig())
    expect(a.outcomes.map((o) => o.failure)).toEqual(b.outcomes.map((o) => o.failure))
  })

  it('different seeds produce different runs', () => {
    const a = runQuality(badConfig({ seed: 'x' }))
    const b = runQuality(badConfig({ seed: 'y' }))
    expect(a.outcomes.map((o) => o.failure)).not.toEqual(b.outcomes.map((o) => o.failure))
  })

  it('a well-engineered configuration fails less often than a careless one', () => {
    expect(expectedFailureRate(goodConfig())).toBeLessThan(expectedFailureRate(badConfig()))
  })

  it('every turn carries an explanation, whether it passed or failed', () => {
    for (const o of runQuality(badConfig()).outcomes) {
      expect(o.explanation.length, o.case.id).toBeGreaterThan(40)
    }
  })

  it('a higher word error rate raises argument failures specifically', () => {
    const clean = expectedByKind(goodConfig({ wer: 0.01 }))
    const noisy = expectedByKind(goodConfig({ wer: 0.25 }))
    expect(noisy['bad-arguments']).toBeGreaterThan(clean['bad-arguments'])
  })

  it('read-back guardrails blunt the effect of a bad transcript', () => {
    const noGuard = { ...composePrompt(MINIMAL_SELECTION).factors }
    const guarded = { ...composePrompt({ ...MINIMAL_SELECTION, uncertainty: 'readback' }).factors }
    const a = expectedByKind({ ...badConfig(), factors: noGuard })
    const b = expectedByKind({ ...badConfig(), factors: guarded })
    expect(b['bad-arguments']).toBeLessThan(a['bad-arguments'])
  })

  it('a short context window loses facts stated early in the call', () => {
    const shortWindow = expectedByKind(goodConfig({ contextStrategy: 'last-n', contextTurns: 2 }))
    const summarised = expectedByKind(goodConfig({ contextStrategy: 'summarised' }))
    expect(shortWindow['lost-state']).toBeGreaterThan(summarised['lost-state'])
  })

  it('no history at all is worse than any retention strategy', () => {
    const none = expectedByKind(goodConfig({ contextStrategy: 'none' }))
    const full = expectedByKind(goodConfig({ contextStrategy: 'full-history' }))
    expect(none['lost-state']).toBeGreaterThan(full['lost-state'])
  })

  it('overlapping tool catalogues cause tool-selection errors', () => {
    const clean = expectedByKind(goodConfig({ overlappingTools: false }))
    const messy = expectedByKind(goodConfig({ overlappingTools: true }))
    expect(messy['wrong-tool']).toBeGreaterThan(clean['wrong-tool'])
  })

  it('an undefined escalation policy misses the caller who never asks', () => {
    const vague = expectedByKind({ ...goodConfig(), factors: { ...goodConfig().factors, escalationClarity: 0 } })
    const named = expectedByKind({ ...goodConfig(), factors: { ...goodConfig().factors, escalationClarity: 1 } })
    expect(vague['missed-escalation']).toBeGreaterThan(named['missed-escalation'])
    expect(vague['over-escalation']).toBeGreaterThan(named['over-escalation'])
  })

  it('higher temperature invents more', () => {
    const cold = expectedByKind(goodConfig({ temperature: 0 }))
    const hot = expectedByKind(goodConfig({ temperature: 1 }))
    expect(hot.hallucination).toBeGreaterThan(cold.hallucination)
  })

  it('per-kind expectations sum to the overall expected failure rate', () => {
    for (const cfg of [goodConfig(), badConfig()]) {
      const byKind = expectedByKind(cfg)
      const sum = (Object.values(byKind) as number[]).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(expectedFailureRate(cfg), 3)
    }
  })

  it('expected rates stay inside [0, 1] at both extremes', () => {
    for (const cfg of [goodConfig(), badConfig(), goodConfig({ wer: 0.9, temperature: 1 })]) {
      const r = expectedFailureRate(cfg)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })

  it('explains the risk profile of a single case', () => {
    const c = TURN_CASES.find((x) => x.id === 'reschedule')!
    const risks = explainCase(c, badConfig())
    expect(risks.length).toBeGreaterThan(1)
    for (const r of risks) {
      expect(r.probability).toBeGreaterThanOrEqual(0)
      expect(r.probability).toBeLessThanOrEqual(1)
      expect(r.why.length).toBeGreaterThan(30)
    }
  })

  it('counts a wrong argument on a state-changing turn as a silent mutation', () => {
    const run = runQuality(badConfig({ seed: 'mutations' }))
    const silent = run.outcomes.filter(
      (o) => o.case.mutating && (o.failure === 'bad-arguments' || o.failure === 'wrong-tool'),
    ).length
    expect(run.silentMutations).toBe(silent)
  })

  it('every case says what it is probing for', () => {
    for (const c of TURN_CASES) {
      expect(c.probes.length, c.id).toBeGreaterThan(30)
      expect(c.expected.length, c.id).toBeGreaterThan(30)
    }
  })
})

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

describe('evaluation framework', () => {
  it('assigns exactly one verdict per case', () => {
    const s = runSuite(badConfig())
    expect(s.pass + s.partial + s.fail).toBe(TURN_CASES.length)
    expect(s.results).toHaveLength(TURN_CASES.length)
  })

  it('reproduces exactly on the same seed', () => {
    const a = runSuite(badConfig({ seed: 'repro' }))
    const b = runSuite(badConfig({ seed: 'repro' }))
    expect(a.results.map((r) => r.verdict)).toEqual(b.results.map((r) => r.verdict))
  })

  it('treats recoverable failures as PARTIAL and silent ones as FAIL', () => {
    for (const r of runSuite(badConfig({ seed: 'severity' })).results) {
      if (r.failure === 'misunderstood' || r.failure === 'lost-state' || r.failure === 'over-escalation') {
        expect(r.verdict, r.case.id).toBe('PARTIAL')
      }
      if (r.failure === 'bad-arguments' || r.failure === 'hallucination' || r.failure === 'missed-escalation') {
        expect(r.verdict, r.case.id).toBe('FAIL')
      }
    }
  })

  it('every verdict carries a reason and a detail', () => {
    for (const r of runSuite(badConfig()).results) {
      expect(r.reason.length, r.case.id).toBeGreaterThan(10)
      expect(r.detail.length, r.case.id).toBeGreaterThan(30)
    }
  })

  it('the gate blocks only on failing state-changing cases', () => {
    const s = runSuite(badConfig({ seed: 'gate' }))
    for (const b of s.gate.blocking) {
      expect(b.verdict).toBe('FAIL')
      expect(b.case.mutating).toBe(true)
    }
    expect(s.gate.ok).toBe(s.gate.blocking.length === 0)
  })

  it('a better configuration passes more cases than a worse one', () => {
    const good = runSuite(goodConfig({ seed: 'cmp' }))
    const bad = runSuite(badConfig({ seed: 'cmp' }))
    expect(good.pass).toBeGreaterThan(bad.pass)
  })

  it('names every case whose verdict changed between two runs', () => {
    const cmp = compareSuites(runSuite(badConfig({ seed: 'cmp' })), runSuite(goodConfig({ seed: 'cmp' })))
    expect(cmp.changes).toHaveLength(TURN_CASES.length)
    expect(cmp.fixed).toBeGreaterThan(0)
    for (const c of cmp.changes) expect(c.note.length).toBeGreaterThan(8)
  })

  it('refuses to call a change safe when it introduces a new failure', () => {
    const cmp = compareSuites(runSuite(goodConfig({ seed: 'cmp' })), runSuite(badConfig({ seed: 'cmp' })))
    expect(cmp.regressed).toBeGreaterThan(0)
    expect(cmp.safeToShip).toBe(false)
    expect(cmp.verdict).toMatch(/regression/i)
  })

  it('an identical configuration compares as unchanged', () => {
    const a = runSuite(goodConfig({ seed: 'same' }))
    const b = runSuite(goodConfig({ seed: 'same' }))
    const cmp = compareSuites(a, b)
    expect(cmp.fixed).toBe(0)
    expect(cmp.regressed).toBe(0)
    expect(cmp.changes.every((c) => c.change === 'unchanged')).toBe(true)
  })

  it('a seed sweep shows how much the verdict depends on the seed', () => {
    const sweep = sweepSeeds(badConfig(), DEFAULT_SWEEP_SEEDS)
    expect(sweep.perSeed).toHaveLength(DEFAULT_SWEEP_SEEDS.length)
    expect(sweep.meanPassRate).toBeGreaterThanOrEqual(0)
    expect(sweep.meanPassRate).toBeLessThanOrEqual(1)
    expect(sweep.spread).toBeGreaterThanOrEqual(0)
    expect(sweep.worstSeed.fail).toBeGreaterThanOrEqual(sweep.bestSeed.fail)
  })

  it('a sweep of a good configuration beats a sweep of a bad one on average', () => {
    const good = sweepSeeds(goodConfig(), DEFAULT_SWEEP_SEEDS)
    const bad = sweepSeeds(badConfig(), DEFAULT_SWEEP_SEEDS)
    expect(good.meanPassRate).toBeGreaterThan(bad.meanPassRate)
  })

  it('explains each verdict in the legend', () => {
    for (const v of ['PASS', 'PARTIAL', 'FAIL'] as const) {
      expect(VERDICT_MEANING[v].length).toBeGreaterThan(20)
    }
  })
})

// ---------------------------------------------------------------------------
// What-if removal
// ---------------------------------------------------------------------------

describe('what-if removal', () => {
  it('drops the node and every edge attached to it', () => {
    const arch = solidArch()
    const victim = arch.nodes.find((n) => n.specId === 'redis')!
    const after = withoutNode(arch, victim.id)
    expect(after.nodes.some((n) => n.id === victim.id)).toBe(false)
    expect(after.edges.some((e) => e.source === victim.id || e.target === victim.id)).toBe(false)
    expect(arch.nodes.some((n) => n.id === victim.id)).toBe(true) // original untouched
  })

  it('removing recognition is fatal', () => {
    const arch = solidArch()
    const stt = arch.nodes.find((n) => n.specId === 'stt')!
    const c = removalConsequence(arch, stt.id, req())
    expect(c.severity).toBe('fatal')
    expect(c.breaks.length).toBeGreaterThan(0)
  })

  it('removing observability is survivable, and says what it costs anyway', () => {
    const arch = solidArch()
    const mon = arch.nodes.find((n) => n.specId === 'monitoring')!
    const c = removalConsequence(arch, mon.id, req())
    expect(c.severity).not.toBe('fatal')
    expect(c.breaks.some((b) => b.toLowerCase().includes('invisible'))).toBe(true)
  })

  it('always names a gain as well as a break — nothing is free', () => {
    for (const c of rankByLoadBearing(solidArch(), req())) {
      expect(c.gains.length, c.label).toBeGreaterThan(0)
      expect(c.breaks.length, c.label).toBeGreaterThan(0)
      expect(c.insteadYouWould.length, c.label).toBeGreaterThan(20)
    }
  })

  it('ranks the load-bearing components first', () => {
    const ranked = rankByLoadBearing(solidArch(), req())
    const rank = { fatal: 0, degraded: 1, survivable: 2 } as const
    for (let i = 1; i < ranked.length; i++) {
      expect(rank[ranked[i].severity]).toBeGreaterThanOrEqual(rank[ranked[i - 1].severity])
    }
  })

  it('reports a saving only where the cost model can actually price it', () => {
    const arch = solidArch()
    const redis = arch.nodes.find((n) => n.specId === 'redis')!
    const llm = arch.nodes.find((n) => n.specId === 'llm')!
    expect(removalConsequence(arch, redis.id, req()).costDeltaPerMonth).toBeLessThan(0)
    expect(removalConsequence(arch, llm.id, req()).costDeltaPerMonth).toBe(0)
  })

  it('surfaces validation issues that appear only after the removal', () => {
    const arch = solidArch()
    const redis = arch.nodes.find((n) => n.specId === 'redis')!
    const c = removalConsequence(arch, redis.id, req())
    expect(c.newIssues.length + c.breaks.length).toBeGreaterThan(0)
  })

  it('rejects an unknown node id rather than guessing', () => {
    expect(() => removalConsequence(solidArch(), 'nope', req())).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

describe('compliance awareness', () => {
  it('always states that it is not legal advice', () => {
    const r = checkCompliance(solidArch(), req())
    expect(r.disclaimer).toMatch(/not legal/i)
  })

  it('every regime names the voice-specific trap', () => {
    for (const regime of REGIMES) {
      expect(regime.voiceTrap.length, regime.id).toBeGreaterThan(80)
      expect(regime.demands.length, regime.id).toBeGreaterThan(1)
    }
  })

  it('picks up the regimes named in the requirements', () => {
    const r = checkCompliance(solidArch(), req({ compliance: ['PCI'] }))
    expect(r.applicable.some((x) => x.id === 'pci')).toBe(true)
  })

  it('treats card data plus recording as an error, not a warning', () => {
    const r = checkCompliance(solidArch(), req({ compliance: ['PCI'], recording: true }))
    const pci = r.findings.find((f) => f.regimes.includes('pci'))
    expect(pci?.severity).toBe('error')
  })

  it('flags recording with no storage as a lost record', () => {
    const r = checkCompliance(fragileArch(), req({ recording: true }))
    expect(r.findings.some((f) => f.severity === 'error' && f.title.includes('nowhere to put'))).toBe(true)
  })

  it('counts every external processor that receives caller speech', () => {
    const r = checkCompliance(solidArch(), req())
    expect(r.findings.some((f) => f.title.includes('external processor'))).toBe(true)
  })

  it('notices unencrypted media on the PSTN leg', () => {
    const r = checkCompliance(solidArch(), req())
    expect(r.findings.some((f) => f.title.includes('unencrypted'))).toBe(true)
  })

  it('raises residency once more than one region is in play', () => {
    const one = checkCompliance(solidArch(), req({ regions: ['us-east'] }))
    const two = checkCompliance(solidArch(), req({ regions: ['us-east', 'eu-west'] }))
    expect(one.findings.some((f) => f.title.includes('crosses'))).toBe(false)
    expect(two.findings.some((f) => f.title.includes('crosses'))).toBe(true)
  })

  it('every finding proposes a fix', () => {
    for (const f of checkCompliance(solidArch(), req({ compliance: ['PCI', 'GDPR'], recording: true })).findings) {
      expect(f.fix.length, f.title).toBeGreaterThan(40)
    }
  })

  it('lists only the data artefacts this architecture actually creates', () => {
    const withRecording = checkCompliance(solidArch(), req({ recording: true })).artefacts
    const without = checkCompliance(solidArch(), req({ recording: false })).artefacts
    expect(withRecording.some((a) => a.id === 'recording')).toBe(true)
    expect(without.some((a) => a.id === 'recording')).toBe(false)
    expect(DATA_ARTEFACTS.every((a) => a.easilyMissed.length > 40)).toBe(true)
  })

  it('names the components that carry sensitive data', () => {
    const nodes = sensitiveNodes(solidArch())
    expect(nodes.length).toBeGreaterThan(3)
  })
})
