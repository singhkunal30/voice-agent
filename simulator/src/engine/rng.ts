/**
 * Deterministic pseudo-random number generation.
 *
 * The whole simulator rests on this: for a given (configuration, seed) pair the
 * same input must produce the same result, every time, on every machine. That
 * rules out `Math.random()` anywhere in the engine. Instead every simulation
 * owns an `Rng` seeded from a string, and every draw advances that stream.
 *
 * Algorithm: SplitMix32 — small, fast, well-distributed, and trivially
 * reproducible across environments because it only uses 32-bit integer ops.
 */

export class Rng {
  private state: number

  constructor(seed: number | string) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashString(seed)
    // Avoid the degenerate all-zero state.
    if (this.state === 0) this.state = 0x9e3779b9
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0
    let z = this.state
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
    z = (z ^ (z >>> 15)) >>> 0
    return z / 4294967296
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  /** True with probability p. */
  chance(p: number): boolean {
    if (p <= 0) return false
    if (p >= 1) return true
    return this.next() < p
  }

  /** Symmetric jitter in [-amount, +amount]. */
  jitter(amount: number): number {
    if (amount <= 0) return 0
    return this.range(-amount, amount)
  }

  /**
   * Normal deviate via Box-Muller, clamped to +/- 4 sigma so a single unlucky
   * draw cannot produce an absurd latency and make a chart unreadable.
   */
  normal(mean: number, stdDev: number): number {
    const u1 = Math.max(this.next(), Number.EPSILON)
    const u2 = this.next()
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mean + stdDev * Math.max(-4, Math.min(4, z))
  }

  /**
   * Log-normal deviate. Real service latencies are right-skewed — a long tail
   * of slow responses with a floor at zero — so this is the default shape for
   * provider latency in the engine.
   */
  logNormal(medianMs: number, sigma = 0.35): number {
    return medianMs * Math.exp(this.normal(0, sigma))
  }

  /** Exponential deviate; used for inter-arrival times in the traffic model. */
  exponential(ratePerUnit: number): number {
    if (ratePerUnit <= 0) return Infinity
    return -Math.log(Math.max(this.next(), Number.EPSILON)) / ratePerUnit
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array')
    return items[this.int(0, items.length - 1)] as T
  }

  /**
   * Fork an independent stream, so adding a draw in one subsystem does not
   * shift every downstream subsystem's numbers.
   */
  fork(label: string): Rng {
    return new Rng((this.state ^ hashString(label)) >>> 0)
  }
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
