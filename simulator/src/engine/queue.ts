/**
 * Binary min-heap priority queue used as the simulation's event queue.
 *
 * Ordering is (time, insertion sequence). The sequence tiebreak is what makes
 * the engine *totally* ordered rather than merely time-ordered: two events
 * scheduled for the same virtual millisecond always come out in the order they
 * were scheduled, so a run is reproducible down to the event index.
 */

export interface Scheduled<T> {
  time: number
  seq: number
  payload: T
}

export class EventQueue<T> {
  private heap: Scheduled<T>[] = []
  private counter = 0

  get size(): number {
    return this.heap.length
  }

  /** Returns the assigned sequence number. */
  push(time: number, payload: T): number {
    const item: Scheduled<T> = { time, seq: this.counter++, payload }
    this.heap.push(item)
    this.siftUp(this.heap.length - 1)
    return item.seq
  }

  peek(): Scheduled<T> | undefined {
    return this.heap[0]
  }

  pop(): Scheduled<T> | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop() as Scheduled<T>
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.siftDown(0)
    }
    return top
  }

  clear(): void {
    this.heap = []
    this.counter = 0
  }

  /** Drop every queued item matching the predicate (used to cancel TTS). */
  removeWhere(pred: (payload: T) => boolean): number {
    const before = this.heap.length
    const kept = this.heap.filter((i) => !pred(i.payload))
    if (kept.length !== before) {
      this.heap = kept
      // Re-heapify: cheaper and less error-prone than patching holes.
      for (let i = (this.heap.length >> 1) - 1; i >= 0; i--) this.siftDown(i)
    }
    return before - this.heap.length
  }

  private less(a: Scheduled<T>, b: Scheduled<T>): boolean {
    return a.time !== b.time ? a.time < b.time : a.seq < b.seq
  }

  private siftUp(idx: number): void {
    let i = idx
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(this.heap[i], this.heap[parent])) break
      this.swap(i, parent)
      i = parent
    }
  }

  private siftDown(idx: number): void {
    let i = idx
    const n = this.heap.length
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let smallest = i
      if (l < n && this.less(this.heap[l], this.heap[smallest])) smallest = l
      if (r < n && this.less(this.heap[r], this.heap[smallest])) smallest = r
      if (smallest === i) break
      this.swap(i, smallest)
      i = smallest
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]
    this.heap[a] = this.heap[b]
    this.heap[b] = tmp
  }
}
