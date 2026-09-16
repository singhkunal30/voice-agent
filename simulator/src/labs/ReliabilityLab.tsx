import { useMemo, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { runReliabilitySim, STRATEGY_PRESETS, type ProviderProfile, type ReliabilityStrategy } from '../models/reliability'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { Segmented, Select, Slider, Toggle } from '../ui/controls'

const OUTCOME_COLORS: Record<string, string> = {
  ok: 'rgb(var(--good))',
  'ok-retry': 'rgb(var(--accent))',
  'ok-fallback': 'rgb(var(--warn))',
  'shed-by-breaker-to-fallback': 'rgb(var(--control))',
  failed: 'rgb(var(--bad))',
  'failed-fast': 'rgb(var(--series-rose))',
}

export default function ReliabilityLab() {
  const [strategy, setStrategy] = useState<ReliabilityStrategy>({ ...STRATEGY_PRESETS.production })
  const [presetName, setPresetName] = useState('production')
  const [outageMode, setOutageMode] = useState<'error' | 'hang' | 'slow'>('hang')
  const [outageSeconds, setOutageSeconds] = useState(20)

  const provider: ProviderProfile = useMemo(
    () => ({ latencyMs: 250, outage: { startMs: 15000, endMs: 15000 + outageSeconds * 1000, mode: outageMode } }),
    [outageMode, outageSeconds],
  )

  const set = <K extends keyof ReliabilityStrategy>(k: K, v: ReliabilityStrategy[K]) => {
    setStrategy((s) => ({ ...s, [k]: v }))
    setPresetName('custom')
  }

  const run = useMemo(
    () => runReliabilitySim(strategy, provider, { seed: 'rel-lab', requests: 120, spanMs: 60000 }),
    [strategy, provider],
  )

  // Compare all three presets under the identical failure.
  const comparison = useMemo(
    () =>
      Object.entries(STRATEGY_PRESETS).map(([name, s]) => ({
        name,
        result: runReliabilitySim(s, provider, { seed: 'rel-lab', requests: 120, spanMs: 60000 }),
      })),
    [provider],
  )

  const scatterData = run.requests.map((r) => ({ x: r.atMs / 1000, y: Math.min(r.totalMs, 12000), outcome: r.outcome, z: 1 }))

  return (
    <div className="p-4">
      <PageHeader
        title="Reliability patterns"
        steps={[
          "Keep the failure fixed and switch strategy: Naive → Retries → Production.",
          "Notice that retries alone can make the outage worse. That surprise is the point of this lab.",
          "Read the request trace during the outage window to see individual callers, not averages.",
        ]}
        subtitle="The same outage, handled three ways. Retries alone can make it worse."
        right={<Assumption>Deterministic request stream</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[330px,1fr]">
        <div className="space-y-3">
          <Panel title="The failure">
            <div className="space-y-3">
              <Select label="Provider failure mode" value={outageMode} onChange={(v) => setOutageMode(v as typeof outageMode)}
                options={[
                  { value: 'hang', label: 'Hangs (no response at all)' },
                  { value: 'error', label: 'Fast errors (5xx / refused)' },
                  { value: 'slow', label: 'Slow (8× latency, still succeeds)' },
                ]}
                help="Hangs are the most dangerous: without a timeout they consume the entire call." />
              <Slider label="Outage duration" value={outageSeconds} onChange={setOutageSeconds} min={5} max={40} step={5} unit="s" />
              <div className="text-xs text-ink-500">Outage runs t=15s → t={15 + outageSeconds}s of a 60 s window. Healthy latency ≈ 250 ms.</div>
            </div>
          </Panel>

          <Panel title="Strategy" right={<Badge tone="accent">{presetName}</Badge>}>
            <div className="mb-3">
              <Segmented
                value={presetName}
                onChange={(v) => {
                  if (v !== 'custom') {
                    setStrategy({ ...STRATEGY_PRESETS[v] })
                    setPresetName(v)
                  }
                }}
                ariaLabel="Strategy preset"
                options={[
                  { value: 'naive', label: 'Naive', title: '30 s timeout, no retry, no fallback' },
                  { value: 'retries', label: 'Retries', title: 'Timeout + exponential backoff' },
                  { value: 'production', label: 'Production', title: 'Timeout + retry + breaker + fallback' },
                ]}
              />
            </div>
            <div className="space-y-3">
              <Slider label="Timeout" value={strategy.timeoutMs} onChange={(v) => set('timeoutMs', v)} min={200} max={30000} step={100} unit="ms"
                help="In voice, a timeout you cannot afford to wait for is not protection." />
              <Slider label="Retries" value={strategy.retries} onChange={(v) => set('retries', v)} min={0} max={4} step={1} />
              <Select label="Backoff" value={strategy.backoff} onChange={(v) => set('backoff', v as ReliabilityStrategy['backoff'])}
                options={[
                  { value: 'none', label: 'None (hammer immediately)' },
                  { value: 'fixed', label: 'Fixed delay' },
                  { value: 'exponential', label: 'Exponential' },
                ]} />
              <Toggle label="Jitter on backoff" checked={strategy.jitter} onChange={(v) => set('jitter', v)}
                help="Without jitter, every client retries at the same instant and re-kills the recovering service." />
              <Toggle label="Circuit breaker" checked={strategy.circuitBreaker} onChange={(v) => set('circuitBreaker', v)} />
              {strategy.circuitBreaker && (
                <>
                  <Slider label="Failures to trip" value={strategy.breakerFailureThreshold} onChange={(v) => set('breakerFailureThreshold', v)} min={2} max={10} step={1} />
                  <Slider label="Cooldown before probe" value={strategy.breakerCooldownMs} onChange={(v) => set('breakerCooldownMs', v)} min={1000} max={15000} step={500} unit="ms" />
                </>
              )}
              <Toggle label="Fallback provider" checked={strategy.fallback} onChange={(v) => set('fallback', v)}
                help="A worse-but-working alternative. In voice: a cheaper voice beats silence, every time." />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Callers served" value={`${(run.successRate * 100).toFixed(0)}%`}
              tone={run.successRate > 0.95 ? 'good' : run.successRate > 0.8 ? 'warn' : 'bad'}
              hint="Requests that ended with the caller hearing something useful." />
            <Stat label="p50 latency" value={fmtMs(run.p50Ms)} tone={run.p50Ms < 600 ? 'good' : 'warn'} />
            <Stat label="p95 latency" value={fmtMs(run.p95Ms)} tone={run.p95Ms < 1500 ? 'good' : run.p95Ms < 5000 ? 'warn' : 'bad'}
              hint="The tail is the product: p95 of 10 s means 1 in 20 callers sat in silence for 10 seconds." />
            <Stat label="Breaker trips" value={run.breakerEvents.filter((e) => e.state === 'open').length}
              hint="Each trip converted slow timeout burns into instant fallbacks." />
          </div>

          <Panel title="Per-request outcome — each dot is one caller">
            <div className="h-64">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 16, bottom: 20, left: 4 }}>
                  <CartesianGrid stroke="rgb(var(--ink-750))" />
                  <XAxis type="number" dataKey="x" name="time" unit="s" stroke="rgb(var(--ink-500))" fontSize={11}
                    label={{ value: 'request time (s)', position: 'insideBottom', offset: -12, fill: 'rgb(var(--ink-500))', fontSize: 10 }} />
                  <YAxis type="number" dataKey="y" name="latency" unit="ms" stroke="rgb(var(--ink-500))" fontSize={11}
                    label={{ value: 'caller wait (ms)', angle: -90, position: 'insideLeft', fill: 'rgb(var(--ink-500))', fontSize: 10 }} />
                  <ZAxis type="number" dataKey="z" range={[28, 28]} />
                  <Tooltip
                    contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }}
                    formatter={(v: number, n: string) => (n === 'latency' ? [`${v} ms`, 'caller waited'] : [`${v}s`, 'at'])}
                  />
                  {Object.keys(OUTCOME_COLORS).map((oc) => (
                    <Scatter key={oc} name={oc} data={scatterData.filter((d) => d.outcome === oc)} fill={OUTCOME_COLORS[oc]} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-2xs">
              {Object.entries(OUTCOME_COLORS).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1 text-ink-400">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{k}
                </span>
              ))}
            </div>
            <div className="mt-2 space-y-1 text-xs text-ink-400">
              {run.summary.map((s, i) => <p key={i}>· {s}</p>)}
            </div>
          </Panel>

          <Panel title="Same outage, three strategies" right={<Assumption />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                  <th className="py-1.5">Strategy</th>
                  <th className="text-right">Callers served</th>
                  <th className="text-right">p50</th>
                  <th className="text-right">p95</th>
                  <th>What the caller experienced during the outage</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ name, result }) => (
                  <tr key={name} className={`border-b border-ink-850 align-top ${name === presetName ? 'bg-ink-850' : ''}`}>
                    <td className="py-1.5 capitalize text-ink-200">{name}</td>
                    <td className={`text-right font-mono ${result.successRate > 0.95 ? 'text-good' : result.successRate > 0.8 ? 'text-warn' : 'text-bad'}`}>
                      {(result.successRate * 100).toFixed(0)}%
                    </td>
                    <td className="text-right font-mono text-ink-300">{fmtMs(result.p50Ms)}</td>
                    <td className={`text-right font-mono ${result.p95Ms > 5000 ? 'text-bad' : result.p95Ms > 1500 ? 'text-warn' : 'text-good'}`}>{fmtMs(result.p95Ms)}</td>
                    <td className="max-w-md text-xs text-ink-400">
                      {name === 'naive' && 'Nothing to catch the failure: each caller waits out the full timeout, then gets nothing. A 30 s timeout during a live call is an eternity.'}
                      {name === 'retries' && 'Retries with backoff recover transient blips, but during a sustained outage they just multiply the waiting — and the load on a dying provider.'}
                      {name === 'production' && 'Breaker trips after a few failures, so subsequent callers skip straight to the fallback: fast, degraded, alive. This is the shape you want.'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <div className="grid gap-3 md:grid-cols-2">
            <Callout tone="info" title="Primary TTS ✕ → Fallback TTS → Customer">
              The canonical voice fallback. The caller hears a different voice mid-call — jarring, and infinitely better than
              silence. Fallbacks must be pre-connected and rehearsed: one first exercised during an outage is a second outage.
            </Callout>
            <Callout tone="warn" title="Bulkheads, health checks and graceful degradation">
              Bulkhead: cap concurrency per dependency so a slow tool cannot consume every worker. Health checks: eject bad
              instances before callers find them. Graceful degradation: decide in advance which features drop first
              (premium voice → standard, RAG → general answers, tools → “I'll text you that”).
            </Callout>
          </div>

          {run.requests.length > 0 && (
            <Panel title="Request trace (first 12 during the outage window)">
              <div className="max-h-56 space-y-1 overflow-y-auto font-mono text-2xs">
                {run.requests.filter((r) => r.atMs >= 14000 && r.atMs <= 15000 + outageSeconds * 1000).slice(0, 12).map((r) => (
                  <div key={r.id} className="border-b border-ink-850 pb-1">
                    <span className="text-ink-500">{(r.atMs / 1000).toFixed(1)}s</span>{' '}
                    <span style={{ color: OUTCOME_COLORS[r.outcome] }}>{r.outcome}</span>{' '}
                    <span className="text-ink-400">after {fmtMs(r.totalMs)}, {r.attempts} attempt(s)</span>
                    {r.notes.map((n, i) => <div key={i} className="ml-8 text-ink-500">↳ {n}</div>)}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
