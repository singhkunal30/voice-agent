/**
 * Reliability patterns, simulated head-to-head.
 *
 * The Reliability Lab runs the same failure sequence against a set of toggled
 * strategies (retry, backoff, circuit breaker, fallback, timeout) and shows
 * what each caller experienced. Deterministic: the failure schedule and the
 * request stream derive from the seed.
 */

import { Rng } from '../engine/rng'
import { round } from '../engine/simulation'

export interface ReliabilityStrategy {
  timeoutMs: number
  retries: number
  backoff: 'none' | 'fixed' | 'exponential'
  backoffBaseMs: number
  jitter: boolean
  circuitBreaker: boolean
  breakerFailureThreshold: number
  breakerWindow: number
  breakerCooldownMs: number
  fallback: boolean
  fallbackLatencyMs: number
}

export const STRATEGY_PRESETS: Record<string, ReliabilityStrategy> = {
  naive: {
    timeoutMs: 30000, retries: 0, backoff: 'none', backoffBaseMs: 0, jitter: false,
    circuitBreaker: false, breakerFailureThreshold: 5, breakerWindow: 10, breakerCooldownMs: 5000,
    fallback: false, fallbackLatencyMs: 350,
  },
  retries: {
    timeoutMs: 1200, retries: 2, backoff: 'exponential', backoffBaseMs: 100, jitter: true,
    circuitBreaker: false, breakerFailureThreshold: 5, breakerWindow: 10, breakerCooldownMs: 5000,
    fallback: false, fallbackLatencyMs: 350,
  },
  production: {
    timeoutMs: 1200, retries: 1, backoff: 'exponential', backoffBaseMs: 100, jitter: true,
    circuitBreaker: true, breakerFailureThreshold: 5, breakerWindow: 10, breakerCooldownMs: 4000,
    fallback: true, fallbackLatencyMs: 350,
  },
}

export interface ProviderProfile {
  /** Healthy latency median. */
  latencyMs: number
  /** Failure window: requests inside it fail or hang. */
  outage: { startMs: number; endMs: number; mode: 'error' | 'hang' | 'slow' }
}

export interface RequestOutcome {
  id: number
  atMs: number
  outcome: 'ok' | 'ok-retry' | 'ok-fallback' | 'failed' | 'shed-by-breaker-to-fallback' | 'failed-fast'
  totalMs: number
  attempts: number
  notes: string[]
}

export interface ReliabilityRunResult {
  requests: RequestOutcome[]
  successRate: number
  p50Ms: number
  p95Ms: number
  breakerEvents: { atMs: number; state: 'open' | 'half-open' | 'closed' }[]
  summary: string[]
}

export function runReliabilitySim(
  strategy: ReliabilityStrategy,
  provider: ProviderProfile,
  opts: { seed: string; requests: number; spanMs: number },
): ReliabilityRunResult {
  const rng = new Rng(opts.seed)
  const results: RequestOutcome[] = []
  const breakerEvents: ReliabilityRunResult['breakerEvents'] = []

  // Circuit breaker state.
  let breakerState: 'closed' | 'open' | 'half-open' = 'closed'
  let recentResults: boolean[] = []
  let breakerOpenedAt = -Infinity

  const attemptCall = (at: number, attemptRng: Rng): { ok: boolean; ms: number; hung: boolean } => {
    const inOutage = at >= provider.outage.startMs && at < provider.outage.endMs
    if (!inOutage) {
      // Healthy: small tail of slow responses.
      const ms = attemptRng.logNormal(provider.latencyMs, 0.3)
      return { ok: true, ms, hung: false }
    }
    switch (provider.outage.mode) {
      case 'error':
        return { ok: false, ms: attemptRng.range(20, 80), hung: false }
      case 'hang':
        return { ok: false, ms: Infinity, hung: true }
      case 'slow':
        return { ok: true, ms: provider.latencyMs * 8 + attemptRng.range(0, 800), hung: false }
    }
  }

  for (let i = 0; i < opts.requests; i++) {
    const at = Math.round((i / opts.requests) * opts.spanMs)
    const reqRng = rng.fork(`req-${i}`)
    const notes: string[] = []
    let total = 0
    let attempts = 0
    let outcome: RequestOutcome['outcome'] = 'failed'

    // Breaker transitions driven by time.
    if (breakerState === 'open' && at - breakerOpenedAt >= strategy.breakerCooldownMs) {
      breakerState = 'half-open'
      breakerEvents.push({ atMs: at, state: 'half-open' })
      notes.push('Breaker half-open: this request is the probe.')
    }

    if (strategy.circuitBreaker && breakerState === 'open') {
      // Fail fast: no provider call at all.
      total = 2
      outcome = strategy.fallback ? 'shed-by-breaker-to-fallback' : 'failed-fast'
      if (strategy.fallback) {
        total = strategy.fallbackLatencyMs * (0.9 + reqRng.next() * 0.3)
        notes.push('Breaker open → straight to fallback. No timeout burned on a provider known to be down.')
      } else {
        notes.push('Breaker open → immediate failure. Fast, honest, but the caller still gets nothing.')
      }
      results.push({ id: i, atMs: at, outcome, totalMs: round(total, 0), attempts: 0, notes })
      continue
    }

    const maxAttempts = 1 + strategy.retries
    let succeeded = false
    for (attempts = 1; attempts <= maxAttempts; attempts++) {
      const res = attemptCall(at + total, reqRng.fork(`a${attempts}`))
      const effectiveMs = res.hung ? strategy.timeoutMs : Math.min(res.ms, strategy.timeoutMs)
      total += effectiveMs
      const timedOut = res.hung || res.ms > strategy.timeoutMs
      const ok = res.ok && !timedOut

      // Record into breaker window.
      recentResults.push(ok)
      if (recentResults.length > strategy.breakerWindow) recentResults.shift()

      if (ok) {
        succeeded = true
        outcome = attempts > 1 ? 'ok-retry' : 'ok'
        if (attempts > 1) notes.push(`Attempt ${attempts} succeeded after ${attempts - 1} failure(s).`)
        if (breakerState === 'half-open') {
          breakerState = 'closed'
          recentResults = []
          breakerEvents.push({ atMs: at + total, state: 'closed' })
          notes.push('Probe succeeded → breaker closes; traffic resumes.')
        }
        break
      }

      notes.push(
        timedOut
          ? `Attempt ${attempts}: no response within ${strategy.timeoutMs} ms (timeout).`
          : `Attempt ${attempts}: provider error after ${Math.round(res.ms)} ms.`,
      )

      if (breakerState === 'half-open') {
        breakerState = 'open'
        breakerOpenedAt = at + total
        breakerEvents.push({ atMs: at + total, state: 'open' })
        notes.push('Probe failed → breaker re-opens.')
        break
      }

      // Breaker trip check.
      if (strategy.circuitBreaker && breakerState === 'closed') {
        const fails = recentResults.filter((r) => !r).length
        if (fails >= strategy.breakerFailureThreshold) {
          breakerState = 'open'
          breakerOpenedAt = at + total
          breakerEvents.push({ atMs: at + total, state: 'open' })
          notes.push(`${fails} failures in window → breaker OPENS. Subsequent requests stop hammering the dying provider.`)
          break
        }
      }

      // Backoff before next attempt.
      if (attempts < maxAttempts) {
        let wait = 0
        if (strategy.backoff === 'fixed') wait = strategy.backoffBaseMs
        if (strategy.backoff === 'exponential') wait = strategy.backoffBaseMs * 2 ** (attempts - 1)
        if (strategy.jitter && wait > 0) wait *= 0.5 + reqRng.next()
        total += wait
        if (wait > 0) notes.push(`Backoff ${Math.round(wait)} ms${strategy.jitter ? ' (jittered — prevents synchronized retry stampedes)' : ''}.`)
      }
    }

    if (!succeeded && outcome === 'failed') {
      if (strategy.fallback) {
        total += strategy.fallbackLatencyMs * (0.9 + reqRng.next() * 0.3)
        outcome = 'ok-fallback'
        notes.push('All attempts failed → fallback provider answered. Degraded but alive.')
      } else {
        notes.push('All attempts failed and no fallback exists. The caller eats the failure.')
      }
    }

    results.push({ id: i, atMs: at, outcome, totalMs: round(total, 0), attempts: Math.min(attempts, maxAttempts), notes })
  }

  const okOutcomes = results.filter((r) => r.outcome.startsWith('ok') || r.outcome === 'shed-by-breaker-to-fallback')
  const lat = results.map((r) => r.totalMs).sort((a, b) => a - b)
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] ?? 0

  const summary: string[] = []
  summary.push(`${okOutcomes.length}/${results.length} requests ended with the caller hearing *something* useful.`)
  if (!strategy.fallback) summary.push('No fallback: every exhausted retry chain became a caller-visible failure.')
  if (strategy.timeoutMs >= 10000) summary.push(`Timeout of ${strategy.timeoutMs} ms means a hung provider freezes the caller for ${Math.round(strategy.timeoutMs / 1000)}s — in voice, that IS an outage.`)
  if (strategy.circuitBreaker) summary.push('Breaker converted mid-outage requests into fast fallbacks instead of slow timeout burns — compare p95 with the breaker off.')
  if (strategy.retries > 0 && strategy.backoff === 'none') summary.push('Retries without backoff hammer a struggling provider exactly when it can least afford it.')

  return {
    requests: results,
    successRate: round(okOutcomes.length / results.length, 3),
    p50Ms: pct(0.5),
    p95Ms: pct(0.95),
    breakerEvents,
    summary,
  }
}
