import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEARNER_STATE,
  MAX_PREDICTIONS,
  MAX_SAVED_ARCHITECTURES,
  fromRow,
  mergeLearnerState,
  needsPush,
  toRow,
  type LearnerState,
  type SavedArchitectureRecord,
} from './sync'
import { looksLikeServiceRoleKey } from '../lib/supabase'
import type { PredictionRecordEntry } from '../domain/prediction'
import type { Architecture } from '../domain/types'

const arch = (id: string): Architecture => ({
  id,
  name: id,
  description: '',
  nodes: [],
  edges: [],
  assumptions: [],
  version: 1,
})

const saved = (id: string, at: string): SavedArchitectureRecord => ({
  id,
  name: id,
  savedAt: at,
  architecture: arch(id),
})

const prediction = (questionId: string, at: number, correct = true): PredictionRecordEntry => ({
  questionId,
  correct,
  distance: correct ? 0 : 2,
  route: '/latency',
  at,
})

const state = (over: Partial<LearnerState> = {}): LearnerState => ({
  ...EMPTY_LEARNER_STATE,
  ...over,
})

describe('progress merges as a union', () => {
  it('signing in on a fresh device keeps everything the account already had', () => {
    const local = state({ progress: {} })
    const remote = state({ progress: { 'ran-first-call': true, 'tuned-vad': true }, updatedAt: 100 })
    expect(mergeLearnerState(local, remote).progress).toEqual(remote.progress)
  })

  it('signing in with local work keeps that too', () => {
    const local = state({ progress: { 'latency-predicted': true }, updatedAt: 200 })
    const remote = state({ progress: { 'ran-first-call': true }, updatedAt: 100 })
    expect(mergeLearnerState(local, remote).progress).toEqual({
      'ran-first-call': true,
      'latency-predicted': true,
    })
  })

  it('never removes a flag, whichever side is older', () => {
    // The whole point of a union: an older device coming back online cannot
    // subtract work done on a newer one.
    const stale = state({ progress: { a: true }, updatedAt: 1 })
    const fresh = state({ progress: { b: true }, updatedAt: 9_999 })
    expect(mergeLearnerState(stale, fresh).progress).toEqual({ a: true, b: true })
    expect(mergeLearnerState(fresh, stale).progress).toEqual({ a: true, b: true })
  })

  it('is order-independent for progress', () => {
    const a = state({ progress: { x: true }, updatedAt: 5 })
    const b = state({ progress: { y: true }, updatedAt: 7 })
    expect(mergeLearnerState(a, b).progress).toEqual(mergeLearnerState(b, a).progress)
  })
})

describe('predictions merge as an append-only log', () => {
  it('keeps entries from both sides', () => {
    const local = state({ predictions: [prediction('perceived-latency', 2)] })
    const remote = state({ predictions: [prediction('cost-per-call', 1)] })
    const merged = mergeLearnerState(local, remote)
    expect(merged.predictions.map((p) => p.questionId)).toEqual(['cost-per-call', 'perceived-latency'])
  })

  it('dedupes the same prediction arriving from both copies', () => {
    const one = prediction('perceived-latency', 42)
    const merged = mergeLearnerState(state({ predictions: [one] }), state({ predictions: [one] }))
    expect(merged.predictions).toHaveLength(1)
  })

  it('treats two predictions on the same question at different times as different', () => {
    const merged = mergeLearnerState(
      state({ predictions: [prediction('saturation', 1, false)] }),
      state({ predictions: [prediction('saturation', 2, true)] }),
    )
    expect(merged.predictions).toHaveLength(2)
  })

  it('orders by when they were made', () => {
    const merged = mergeLearnerState(
      state({ predictions: [prediction('a', 30), prediction('b', 10)] }),
      state({ predictions: [prediction('c', 20)] }),
    )
    expect(merged.predictions.map((p) => p.at)).toEqual([10, 20, 30])
  })

  it('caps the log and keeps the most recent', () => {
    const many = Array.from({ length: MAX_PREDICTIONS + 50 }, (_, i) => prediction('q', i))
    const merged = mergeLearnerState(state({ predictions: many }), state())
    expect(merged.predictions).toHaveLength(MAX_PREDICTIONS)
    expect(merged.predictions[merged.predictions.length - 1].at).toBe(MAX_PREDICTIONS + 49)
  })
})

describe('the prompt is one coherent choice, not a blend', () => {
  it('the newer side wins whole', () => {
    const local = state({ promptSelection: { role: 'scoped', tools: 'contracted' }, updatedAt: 200 })
    const remote = state({ promptSelection: { role: 'vague', uncertainty: 'readback' }, updatedAt: 100 })
    expect(mergeLearnerState(local, remote).promptSelection).toEqual(local.promptSelection)
  })

  it('an older local copy yields to a newer remote one', () => {
    const local = state({ promptSelection: { role: 'none' }, updatedAt: 10 })
    const remote = state({ promptSelection: { role: 'scoped' }, updatedAt: 900 })
    expect(mergeLearnerState(local, remote).promptSelection).toEqual(remote.promptSelection)
  })

  it('never produces a section combination neither side chose', () => {
    const local = state({ promptSelection: { role: 'scoped' }, updatedAt: 2 })
    const remote = state({ promptSelection: { tools: 'contracted' }, updatedAt: 1 })
    const merged = mergeLearnerState(local, remote).promptSelection
    expect(merged).toEqual(local.promptSelection)
    expect(merged.tools).toBeUndefined()
  })
})

describe('saved architectures merge by id', () => {
  it('unions designs saved on different devices', () => {
    const merged = mergeLearnerState(
      state({ savedArchitectures: [saved('one', '2026-01-02T00:00:00Z')] }),
      state({ savedArchitectures: [saved('two', '2026-01-01T00:00:00Z')] }),
    )
    expect(merged.savedArchitectures.map((s) => s.id).sort()).toEqual(['one', 'two'])
  })

  it('keeps the newer version of the same design', () => {
    const merged = mergeLearnerState(
      state({ savedArchitectures: [{ ...saved('one', '2026-05-01T00:00:00Z'), name: 'newer' }] }),
      state({ savedArchitectures: [{ ...saved('one', '2026-01-01T00:00:00Z'), name: 'older' }] }),
    )
    expect(merged.savedArchitectures).toHaveLength(1)
    expect(merged.savedArchitectures[0].name).toBe('newer')
  })

  it('caps at the same limit the local store uses, newest first', () => {
    const many = Array.from({ length: MAX_SAVED_ARCHITECTURES + 5 }, (_, i) =>
      saved(`s${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    )
    const merged = mergeLearnerState(state({ savedArchitectures: many }), state())
    expect(merged.savedArchitectures).toHaveLength(MAX_SAVED_ARCHITECTURES)
    expect(merged.savedArchitectures[0].id).toBe(`s${MAX_SAVED_ARCHITECTURES + 4}`)
  })
})

describe('deciding whether to write', () => {
  it('does not push when the merge changed nothing', () => {
    const remote = state({ progress: { a: true }, predictions: [prediction('q', 1)], updatedAt: 5 })
    const merged = mergeLearnerState(state(), remote)
    expect(needsPush(merged, remote)).toBe(false)
  })

  it('pushes when local work is not in the remote copy', () => {
    const remote = state({ progress: { a: true } })
    const local = state({ progress: { b: true }, updatedAt: 9 })
    expect(needsPush(mergeLearnerState(local, remote), remote)).toBe(true)
  })

  it('pushes when only the prompt changed', () => {
    const remote = state({ promptSelection: { role: 'none' } })
    const local = state({ promptSelection: { role: 'scoped' }, updatedAt: 9 })
    expect(needsPush(mergeLearnerState(local, remote), remote)).toBe(true)
  })
})

describe('the wire format', () => {
  it('round-trips through a row', () => {
    const before = state({
      progress: { a: true },
      predictions: [prediction('q', 1)],
      promptSelection: { role: 'scoped' },
      savedArchitectures: [saved('one', '2026-01-01T00:00:00Z')],
      updatedAt: Date.parse('2026-03-04T05:06:07.000Z'),
    })
    const after = fromRow(toRow('user-1', before))
    expect(after).toEqual(before)
  })

  it('starts empty rather than throwing on a missing row', () => {
    expect(fromRow(null)).toEqual(EMPTY_LEARNER_STATE)
    expect(fromRow(undefined)).toEqual(EMPTY_LEARNER_STATE)
  })

  it('survives junk in the jsonb columns', () => {
    // Anything could be in there: an older client, a hand-edited row, a
    // half-finished migration. Starting empty beats a white screen.
    const junk = {
      progress: 'not an object',
      predictions: { nope: true },
      prompt_selection: null,
      saved_architectures: 'nope',
      updated_at: 'not a date',
    } as never
    const s = fromRow(junk)
    expect(s.progress).toEqual({})
    expect(s.predictions).toEqual([])
    expect(s.promptSelection).toEqual({})
    expect(s.savedArchitectures).toEqual([])
    expect(s.updatedAt).toBe(0)
  })

  it('names the user on every row it writes', () => {
    expect(toRow('user-9', state()).user_id).toBe('user-9')
  })
})

describe('the key guard', () => {
  const jwt = (payload: object) =>
    ['eyJhbGciOiJIUzI1NiJ9', btoa(JSON.stringify(payload)).replace(/=+$/, ''), 'signature'].join('.')

  it('catches a service-role key, which must never reach a browser bundle', () => {
    expect(looksLikeServiceRoleKey(jwt({ iss: 'supabase', role: 'service_role' }))).toBe(true)
  })

  it('lets the anon key through', () => {
    expect(looksLikeServiceRoleKey(jwt({ iss: 'supabase', role: 'anon' }))).toBe(false)
  })

  it('lets the newer opaque publishable keys through', () => {
    expect(looksLikeServiceRoleKey('sb_publishable_abc123')).toBe(false)
  })

  it('does not throw on anything unparseable', () => {
    for (const k of ['', 'a.b.c', 'not-a-key', '...']) {
      expect(() => looksLikeServiceRoleKey(k)).not.toThrow()
      expect(looksLikeServiceRoleKey(k)).toBe(false)
    }
  })
})
