/**
 * The discrete-event simulation kernel.
 *
 * This is the piece that makes the whole app trustworthy as a teaching tool.
 * There is a virtual clock and a priority queue of actions; running the
 * simulation means repeatedly popping the earliest action, advancing the clock
 * to its timestamp, and executing it. Actions may emit events and schedule
 * further actions. Nothing here touches `Date.now()`, `setTimeout` or
 * `Math.random()`, so a run is a pure function of (inputs, seed).
 *
 * The UI *animates* the resulting event log against a scaled wall clock, but
 * every number it displays was computed here first.
 */

import { EventQueue } from './queue'
import { Rng } from './rng'
import type { Plane, SimEvent, SimEventType, EventStatus } from '../domain/types'

export type Action = () => void

interface QueuedAction {
  action: Action
  /** Tag used to cancel groups of pending actions, e.g. queued TTS chunks. */
  tag?: string
}

export interface EmitInput {
  type: SimEventType
  component: string
  summary: string
  plane?: Plane
  status?: EventStatus
  nodeId?: string
  durationMs?: number
  payloadType?: string
  bytes?: number
  detail?: Record<string, string | number | boolean>
  spanId?: string
  callId?: string
  /** Emit at a specific virtual time instead of "now". Must be >= now. */
  at?: number
}

export interface SpanHandle {
  id: string
  startedAt: number
}

export class Simulation {
  readonly rng: Rng
  readonly seed: string

  private queue = new EventQueue<QueuedAction>()
  private events: SimEvent[] = []
  private clock = 0
  private seq = 0
  private spanCounter = 0
  private running = false
  /** Hard stop so a mis-specified model cannot spin forever. */
  private maxSteps: number
  private steps = 0
  private counters = new Map<string, number>()

  constructor(seed: string, opts: { maxSteps?: number } = {}) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.maxSteps = opts.maxSteps ?? 200_000
  }

  // -- clock -----------------------------------------------------------------

  /** Current virtual time in milliseconds. */
  get now(): number {
    return this.clock
  }

  get eventLog(): readonly SimEvent[] {
    return this.events
  }

  get pending(): number {
    return this.queue.size
  }

  // -- scheduling ------------------------------------------------------------

  /** Schedule `action` to run `delayMs` from now. */
  schedule(delayMs: number, action: Action, tag?: string): void {
    const at = this.clock + Math.max(0, delayMs)
    this.queue.push(at, { action, tag })
  }

  /** Schedule `action` at an absolute virtual time (clamped to >= now). */
  scheduleAt(time: number, action: Action, tag?: string): void {
    this.queue.push(Math.max(this.clock, time), { action, tag })
  }

  /**
   * Cancel every pending action carrying `tag`. This is how barge-in works:
   * when the user interrupts, all queued TTS chunk deliveries are dropped
   * rather than played out.
   */
  cancelTag(tag: string): number {
    return this.queue.removeWhere((q) => q.tag === tag)
  }

  // -- events ----------------------------------------------------------------

  emit(input: EmitInput): SimEvent {
    const t = input.at !== undefined ? Math.max(this.clock, input.at) : this.clock
    const event: SimEvent = {
      seq: this.seq++,
      t: round(t),
      type: input.type,
      component: input.component,
      plane: input.plane ?? 'media',
      status: input.status ?? 'ok',
      summary: input.summary,
      nodeId: input.nodeId,
      durationMs: input.durationMs === undefined ? undefined : round(input.durationMs),
      payloadType: input.payloadType,
      bytes: input.bytes === undefined ? undefined : Math.round(input.bytes),
      detail: input.detail,
      spanId: input.spanId,
      callId: input.callId,
    }
    this.events.push(event)
    return event
  }

  /** Open a correlation span; pair the id with the completing event. */
  openSpan(prefix: string): SpanHandle {
    return { id: `${prefix}-${this.spanCounter++}`, startedAt: this.clock }
  }

  // -- counters (metrics collected during the run) ---------------------------

  count(key: string, by = 1): void {
    this.counters.set(key, (this.counters.get(key) ?? 0) + by)
  }

  getCount(key: string): number {
    return this.counters.get(key) ?? 0
  }

  get allCounters(): Record<string, number> {
    return Object.fromEntries(this.counters)
  }

  // -- running ---------------------------------------------------------------

  /**
   * Execute one queued action (which may emit several events).
   * Returns false when the queue is empty.
   */
  step(): boolean {
    const next = this.queue.pop()
    if (!next) return false
    this.clock = next.time
    this.steps++
    next.payload.action()
    return true
  }

  /** Drain the queue, optionally stopping once virtual time passes `untilMs`. */
  run(untilMs = Infinity): readonly SimEvent[] {
    if (this.running) throw new Error('Simulation.run: already running')
    this.running = true
    try {
      for (;;) {
        const head = this.queue.peek()
        if (!head) break
        if (head.time > untilMs) break
        if (this.steps >= this.maxSteps) {
          this.emit({
            type: 'NOTE',
            component: 'Simulation kernel',
            plane: 'control',
            status: 'error',
            summary: `Step limit (${this.maxSteps}) reached — run truncated.`,
          })
          break
        }
        this.step()
      }
    } finally {
      this.running = false
    }
    // Events can be emitted with `at` in the future; sort so the log is always
    // in virtual-time order, with seq as the stable tiebreak.
    this.events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.seq - b.seq))
    return this.events
  }

  /** Advance virtual time without executing anything (used by tick-based models). */
  advanceTo(time: number): void {
    if (time > this.clock) this.clock = time
  }
}

export function round(n: number, places = 2): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}
