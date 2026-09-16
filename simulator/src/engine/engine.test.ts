import { describe, expect, it } from 'vitest'
import { Rng, hashString } from './rng'
import { EventQueue } from './queue'
import { Simulation } from './simulation'

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng('seed-1')
    const b = new Rng('seed-1')
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = new Rng('seed-1')
    const b = new Rng('seed-2')
    expect(a.next()).not.toBe(b.next())
  })

  it('stays within [0, 1)', () => {
    const rng = new Rng(42)
    for (let i = 0; i < 2000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('range and int respect bounds', () => {
    const rng = new Rng('bounds')
    for (let i = 0; i < 500; i++) {
      const r = rng.range(5, 10)
      expect(r).toBeGreaterThanOrEqual(5)
      expect(r).toBeLessThan(10)
      const n = rng.int(1, 6)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(6)
      expect(Number.isInteger(n)).toBe(true)
    }
  })

  it('chance(0) is never and chance(1) is always', () => {
    const rng = new Rng('chance')
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false)
      expect(rng.chance(1)).toBe(true)
    }
  })

  it('chance(p) is approximately p over many draws', () => {
    const rng = new Rng('freq')
    let hits = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (rng.chance(0.3)) hits++
    expect(hits / n).toBeGreaterThan(0.28)
    expect(hits / n).toBeLessThan(0.32)
  })

  it('normal clamps to +/- 4 sigma', () => {
    const rng = new Rng('normal')
    for (let i = 0; i < 5000; i++) {
      const v = rng.normal(100, 10)
      expect(v).toBeGreaterThanOrEqual(100 - 4 * 10 - 1e-9)
      expect(v).toBeLessThanOrEqual(100 + 4 * 10 + 1e-9)
    }
  })

  it('logNormal is always positive and centred near the median', () => {
    const rng = new Rng('lognormal')
    const values = Array.from({ length: 4000 }, () => rng.logNormal(200, 0.3))
    expect(Math.min(...values)).toBeGreaterThan(0)
    const sorted = [...values].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(median).toBeGreaterThan(170)
    expect(median).toBeLessThan(235)
  })

  it('fork produces an independent but deterministic stream', () => {
    const base1 = new Rng('base')
    const base2 = new Rng('base')
    const f1 = base1.fork('label')
    const f2 = base2.fork('label')
    expect(f1.next()).toBe(f2.next())
    expect(base1.fork('a').next()).not.toBe(base1.fork('b').next())
  })

  it('hashString is stable', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('EventQueue', () => {
  it('pops in time order', () => {
    const q = new EventQueue<string>()
    q.push(30, 'c')
    q.push(10, 'a')
    q.push(20, 'b')
    expect(q.pop()?.payload).toBe('a')
    expect(q.pop()?.payload).toBe('b')
    expect(q.pop()?.payload).toBe('c')
    expect(q.pop()).toBeUndefined()
  })

  it('breaks ties by insertion order (total ordering)', () => {
    const q = new EventQueue<string>()
    q.push(10, 'first')
    q.push(10, 'second')
    q.push(10, 'third')
    expect(q.pop()?.payload).toBe('first')
    expect(q.pop()?.payload).toBe('second')
    expect(q.pop()?.payload).toBe('third')
  })

  it('maintains heap order under random insertion', () => {
    const rng = new Rng('heap')
    const q = new EventQueue<number>()
    const times: number[] = []
    for (let i = 0; i < 500; i++) {
      const t = rng.range(0, 1000)
      times.push(t)
      q.push(t, i)
    }
    times.sort((a, b) => a - b)
    const popped: number[] = []
    for (;;) {
      const item = q.pop()
      if (!item) break
      popped.push(item.time)
    }
    expect(popped).toEqual(times)
  })

  it('removeWhere drops matching items and keeps the rest ordered', () => {
    const q = new EventQueue<{ tag: string }>()
    q.push(10, { tag: 'keep' })
    q.push(20, { tag: 'drop' })
    q.push(30, { tag: 'keep' })
    q.push(40, { tag: 'drop' })
    const removed = q.removeWhere((p) => p.tag === 'drop')
    expect(removed).toBe(2)
    expect(q.size).toBe(2)
    expect(q.pop()?.time).toBe(10)
    expect(q.pop()?.time).toBe(30)
  })

  it('peek does not consume', () => {
    const q = new EventQueue<string>()
    q.push(5, 'x')
    expect(q.peek()?.payload).toBe('x')
    expect(q.size).toBe(1)
  })
})

describe('Simulation kernel', () => {
  it('advances the virtual clock to each scheduled action', () => {
    const sim = new Simulation('clock')
    const seen: number[] = []
    sim.schedule(100, () => seen.push(sim.now))
    sim.schedule(50, () => seen.push(sim.now))
    sim.schedule(250, () => seen.push(sim.now))
    sim.run()
    expect(seen).toEqual([50, 100, 250])
  })

  it('actions can schedule further actions', () => {
    const sim = new Simulation('cascade')
    const times: number[] = []
    const chain = (n: number) => {
      times.push(sim.now)
      if (n > 0) sim.schedule(10, () => chain(n - 1))
    }
    sim.schedule(0, () => chain(4))
    sim.run()
    expect(times).toEqual([0, 10, 20, 30, 40])
  })

  it('emits events in virtual-time order with unique sequence numbers', () => {
    const sim = new Simulation('emit')
    sim.schedule(30, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'third' }))
    sim.schedule(10, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'first' }))
    sim.schedule(20, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'second' }))
    const events = sim.run()
    expect(events.map((e) => e.summary)).toEqual(['first', 'second', 'third'])
    expect(new Set(events.map((e) => e.seq)).size).toBe(3)
  })

  it('sorts events emitted with a future `at` timestamp', () => {
    const sim = new Simulation('at')
    sim.schedule(0, () => {
      sim.emit({ type: 'NOTE', component: 'c', summary: 'later', at: 500 })
      sim.emit({ type: 'NOTE', component: 'c', summary: 'now' })
    })
    const events = sim.run()
    expect(events.map((e) => e.summary)).toEqual(['now', 'later'])
    expect(events[1].t).toBe(500)
  })

  it('never emits an event before the current clock', () => {
    const sim = new Simulation('past')
    sim.schedule(100, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'x', at: 10 }))
    const events = sim.run()
    expect(events[0].t).toBe(100)
  })

  it('cancelTag removes pending tagged actions (barge-in mechanism)', () => {
    const sim = new Simulation('cancel')
    const fired: string[] = []
    sim.schedule(10, () => fired.push('chunk1'), 'tts')
    sim.schedule(20, () => fired.push('chunk2'), 'tts')
    sim.schedule(30, () => fired.push('chunk3'), 'tts')
    sim.schedule(15, () => {
      const n = sim.cancelTag('tts')
      fired.push(`cancelled:${n}`)
    })
    sim.run()
    expect(fired).toEqual(['chunk1', 'cancelled:2'])
  })

  it('step() processes exactly one queued action', () => {
    const sim = new Simulation('step')
    sim.schedule(10, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'a' }))
    sim.schedule(20, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'b' }))
    expect(sim.step()).toBe(true)
    expect(sim.eventLog.length).toBe(1)
    expect(sim.now).toBe(10)
    expect(sim.step()).toBe(true)
    expect(sim.eventLog.length).toBe(2)
    expect(sim.step()).toBe(false)
  })

  it('run(untilMs) stops at the boundary and leaves the rest queued', () => {
    const sim = new Simulation('until')
    sim.schedule(10, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'a' }))
    sim.schedule(500, () => sim.emit({ type: 'NOTE', component: 'c', summary: 'b' }))
    sim.run(100)
    expect(sim.eventLog.length).toBe(1)
    expect(sim.pending).toBe(1)
  })

  it('counters accumulate', () => {
    const sim = new Simulation('counters')
    sim.count('turns')
    sim.count('turns', 2)
    expect(sim.getCount('turns')).toBe(3)
    expect(sim.allCounters).toEqual({ turns: 3 })
  })

  it('honours the step limit rather than spinning forever', () => {
    const sim = new Simulation('runaway', { maxSteps: 100 })
    const loop = () => sim.schedule(1, loop)
    sim.schedule(0, loop)
    const events = sim.run()
    expect(events.some((e) => e.summary.includes('Step limit'))).toBe(true)
  })

  it('refuses re-entrant run()', () => {
    const sim = new Simulation('reentrant')
    sim.schedule(0, () => {
      expect(() => sim.run()).toThrow(/already running/)
    })
    sim.run()
  })
})
