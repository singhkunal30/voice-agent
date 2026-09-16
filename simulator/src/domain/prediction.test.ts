import { describe, expect, it } from 'vitest'
import {
  ALL_QUESTIONS,
  COST_BANDS,
  LATENCY_BANDS,
  PERCEIVED_LATENCY_Q,
  SATURATION_BANDS,
  bandFor,
  calibration,
  firstBottleneckQuestion,
  predictionCount,
  scorePrediction,
  topicsProven,
  type PredictionRecordEntry,
} from './prediction'
import { KIND_ACTION, KIND_MEANING, PERCEPTION_BANDS, REFERENCE_NUMBERS, assumption, measured, perceptionBand, reference } from './numbers'

describe('prediction questions', () => {
  it('every question explains why the guess is worth making', () => {
    for (const q of ALL_QUESTIONS) {
      expect(q.prompt.length, q.id).toBeGreaterThan(20)
      expect(q.why.length, q.id).toBeGreaterThan(60)
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(3)
    }
  })

  it('option ids are unique within a question', () => {
    for (const q of ALL_QUESTIONS) {
      const ids = q.options.map((o) => o.id)
      expect(new Set(ids).size, q.id).toBe(ids.length)
    }
  })

  it('question ids are unique across the set', () => {
    const ids = ALL_QUESTIONS.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('builds a bottleneck question from whatever is on the canvas', () => {
    const q = firstBottleneckQuestion([{ id: 'n1', label: 'Media gateway' }])
    expect(q.options.map((o) => o.id)).toEqual(['n1', 'none'])
  })
})

describe('bands', () => {
  it('maps a measurement onto the band that contains it', () => {
    expect(bandFor(120, LATENCY_BANDS).id).toBe('immediate')
    expect(bandFor(450, LATENCY_BANDS).id).toBe('natural')
    expect(bandFor(900, LATENCY_BANDS).id).toBe('noticeable')
    expect(bandFor(9000, LATENCY_BANDS).id).toBe('broken')
  })

  it('every band set is ordered and ends open', () => {
    for (const bands of [LATENCY_BANDS, COST_BANDS, SATURATION_BANDS]) {
      for (let i = 1; i < bands.length; i++) expect(bands[i].max).toBeGreaterThan(bands[i - 1].max)
      expect(bands[bands.length - 1].max).toBe(Infinity)
    }
  })

  it('band ids line up with the question options that use them', () => {
    expect(PERCEIVED_LATENCY_Q.options.map((o) => o.id)).toEqual(LATENCY_BANDS.map((b) => b.id))
  })
})

describe('scoring a prediction', () => {
  it('an exact match is correct at distance zero', () => {
    const o = scorePrediction(PERCEIVED_LATENCY_Q, 'natural', 'natural')
    expect(o.correct).toBe(true)
    expect(o.distance).toBe(0)
    expect(o.diagnosis).toMatch(/right answer/i)
  })

  it('an adjacent band is diagnosed as a constant being wrong, not the model', () => {
    const o = scorePrediction(PERCEIVED_LATENCY_Q, 'natural', 'noticeable')
    expect(o.correct).toBe(false)
    expect(o.distance).toBe(1)
    expect(o.diagnosis).toMatch(/constant is wrong/i)
  })

  it('several bands out is diagnosed as a broken causal chain', () => {
    const o = scorePrediction(PERCEIVED_LATENCY_Q, 'immediate', 'broken')
    expect(o.distance).toBe(4)
    expect(o.diagnosis).toMatch(/causal chain/i)
  })

  it('running without committing produces information but not evidence', () => {
    const o = scorePrediction(PERCEIVED_LATENCY_Q, null, 'natural')
    expect(o.correct).toBe(false)
    expect(o.predictedLabel).toBeNull()
    expect(o.diagnosis).toMatch(/without committing/i)
  })

  it('carries both labels so the comparison can be rendered', () => {
    const o = scorePrediction(PERCEIVED_LATENCY_Q, 'natural', 'awkward')
    expect(o.predictedLabel).toContain('natural')
    expect(o.actualLabel).toContain('awkward')
  })
})

describe('the prediction record', () => {
  const entries: PredictionRecordEntry[] = [
    { questionId: 'perceived-latency', correct: true, distance: 0, route: '/latency', at: 1 },
    { questionId: 'perceived-latency', correct: false, distance: 2, route: '/latency', at: 2 },
    { questionId: 'saturation', correct: false, distance: 1, route: '/scaling', at: 3 },
  ]

  it('counts every prediction committed to', () => {
    expect(predictionCount(entries)).toBe(3)
    expect(predictionCount([])).toBe(0)
  })

  it('breaks calibration down per topic rather than into one score', () => {
    const c = calibration(entries)
    const latency = c.find((x) => x.questionId === 'perceived-latency')!
    expect(latency.attempts).toBe(2)
    expect(latency.exact).toBe(1)
    expect(latency.far).toBe(1)
    expect(latency.near).toBe(0)
  })

  it('counts a topic as proven once, however many times it is repeated', () => {
    const repeated = [...entries, { questionId: 'perceived-latency', correct: true, distance: 0, route: '/latency', at: 4 }]
    expect(topicsProven(repeated)).toEqual(['perceived-latency'])
  })

  it('proves nothing from an empty record', () => {
    expect(topicsProven([])).toEqual([])
    expect(calibration([])).toEqual([])
  })
})

describe('number provenance', () => {
  it('labels each kind with what it is and what to do about it', () => {
    for (const kind of ['ASSUMPTION', 'REFERENCE', 'MEASURED'] as const) {
      expect(KIND_MEANING[kind].length).toBeGreaterThan(80)
      expect(KIND_ACTION[kind].length).toBeGreaterThan(20)
    }
  })

  it('tags values with where they came from', () => {
    expect(assumption(50, 'sizing guess').provenance.kind).toBe('ASSUMPTION')
    expect(reference(64, 'ITU-T G.711').provenance.kind).toBe('REFERENCE')
    const m = measured(812, 'seed-4')
    expect(m.provenance.kind).toBe('MEASURED')
    expect(m.provenance.seed).toBe('seed-4')
  })

  it('every reference number cites its standard', () => {
    for (const n of REFERENCE_NUMBERS) {
      expect(n.source.length, n.id).toBeGreaterThan(5)
      expect(n.note.length, n.id).toBeGreaterThan(40)
    }
  })

  it('maps a latency onto a perception band', () => {
    expect(perceptionBand(100).label).toBe('Immediate')
    expect(perceptionBand(500).label).toBe('Natural')
    expect(perceptionBand(5000).label).toBe('Broken')
  })

  it('perception bands are ordered and cover every value', () => {
    for (let i = 1; i < PERCEPTION_BANDS.length; i++) {
      expect(PERCEPTION_BANDS[i].maxMs).toBeGreaterThan(PERCEPTION_BANDS[i - 1].maxMs)
    }
    expect(PERCEPTION_BANDS[PERCEPTION_BANDS.length - 1].maxMs).toBe(Infinity)
  })
})
