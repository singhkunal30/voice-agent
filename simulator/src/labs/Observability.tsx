import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { DEFAULT_TRAFFIC_OPTS, simulateTraffic, type TrafficPoint } from '../models/scaling'
import { computeCost, DEFAULT_COST_INPUTS } from '../models/cost'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs, fmtNum, fmtUsd } from '../ui/primitives'
import { Segmented, Slider, Toggle } from '../ui/controls'

type ScenarioKind = 'normal' | 'spike' | 'outage' | 'spike-no-autoscale'

const SCENARIO_LABEL: Record<ScenarioKind, string> = {
  normal: 'Steady state',
  spike: 'Traffic spike → autoscale → recovery',
  'spike-no-autoscale': 'Traffic spike, autoscaling OFF',
  outage: 'Capacity loss (AZ/region failure)',
}

export default function Observability() {
  const [scenario, setScenario] = useState<ScenarioKind>('spike')
  const [baseline, setBaseline] = useState(400)
  const [live, setLive] = useState(true)
  const [cursor, setCursor] = useState(0)
  const timer = useRef<number | null>(null)

  const points = useMemo(() => {
    const base = { ...DEFAULT_TRAFFIC_OPTS, seed: `obs-${scenario}`, baselineConcurrent: baseline }
    switch (scenario) {
      case 'normal':
        return simulateTraffic({ ...base, spike: undefined })
      case 'spike':
        return simulateTraffic({ ...base, spike: { startS: 120, endS: 320, multiplier: 2.8 } })
      case 'spike-no-autoscale':
        return simulateTraffic({ ...base, spike: { startS: 120, endS: 320, multiplier: 2.8 }, autoscale: { ...base.autoscale, enabled: false } })
      case 'outage':
        return simulateTraffic({ ...base, spike: undefined, outage: { startS: 150, endS: 330, capacityFraction: 0.45, label: 'AZ lost' } })
    }
  }, [scenario, baseline])

  // Animate a moving "now" cursor through the precomputed series.
  useEffect(() => {
    setCursor(0)
    if (timer.current) window.clearInterval(timer.current)
    if (!live) return
    timer.current = window.setInterval(() => {
      setCursor((c) => (c + 1 >= points.length ? 0 : c + 1))
    }, 120)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [points, live])

  const visible = live ? points.slice(0, Math.max(2, cursor + 1)) : points
  const now: TrafficPoint = visible[visible.length - 1] ?? points[0]

  const cost = useMemo(
    () => computeCost({ ...DEFAULT_COST_INPUTS, callsPerDay: Math.round(now.activeCalls * 200), peakConcurrent: Math.max(1, now.activeCalls) }),
    [now],
  )

  const health = now.errorRatePct > 5 || now.p95LatencyMs > 2000 ? 'bad' : now.errorRatePct > 1 || now.p95LatencyMs > 1200 ? 'warn' : 'good'

  return (
    <div className="p-4">
      <PageHeader
        title="Observability"
        steps={[
          "Start on “Normal” and learn what healthy looks like — you cannot spot trouble without it.",
          "Switch to “Traffic spike” and find which chart moves first. That one is your alert.",
          "Try “AZ lost” and find the moment the system is genuinely in trouble.",
        ]}
        subtitle="The dashboards you would actually stare at during an incident."
        right={
          <div className="flex items-center gap-2">
            <Toggle label="Live" checked={live} onChange={setLive} />
            <Assumption />
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented value={scenario} onChange={setScenario} ariaLabel="Traffic scenario"
          options={(Object.keys(SCENARIO_LABEL) as ScenarioKind[]).map((k) => ({ value: k, label: SCENARIO_LABEL[k] }))} />
        <div className="w-56">
          <Slider label="Baseline concurrent calls" value={baseline} onChange={setBaseline} min={50} max={3000} step={50} />
        </div>
        <Badge tone={health === 'good' ? 'good' : health === 'warn' ? 'warn' : 'bad'}>
          {health === 'good' ? '● all systems nominal' : health === 'warn' ? '● degraded' : '● incident'}
        </Badge>
        <span className="font-mono text-2xs text-ink-500">t = {now.t}s · phase: {now.phase}</span>
      </div>

      {/* Metric cards */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active calls" value={fmtNum(now.activeCalls)} tone="accent" />
        <Stat label="Calls / min (offered)" value={fmtNum(Math.round(now.offeredCalls / 4))} hint="Arrival rate — much smaller than concurrency, because calls last minutes." />
        <Stat label="Concurrent connections" value={fmtNum(now.activeCalls * 3)} hint="≈3 per call: carrier WS + STT stream + TTS stream." />
        <Stat label="Instances serving" value={now.instances} tone={now.instances < now.desiredInstances ? 'warn' : 'default'}
          hint={now.instances < now.desiredInstances ? `${now.desiredInstances - now.instances} still warming up` : 'fleet at desired size'} />
        <Stat label="CPU" value={`${now.cpuPct}%`} tone={now.cpuPct > 85 ? 'bad' : now.cpuPct > 70 ? 'warn' : 'good'} />
        <Stat label="Memory" value={`${now.memPct}%`} tone={now.memPct > 85 ? 'bad' : 'default'} />
        <Stat label="STT latency p95" value={fmtMs(Math.round(now.p95LatencyMs * 0.28))} hint="Modelled as a share of end-to-end." />
        <Stat label="LLM latency p95" value={fmtMs(Math.round(now.p95LatencyMs * 0.34))} />
        <Stat label="TTS latency p95" value={fmtMs(Math.round(now.p95LatencyMs * 0.22))} />
        <Stat label="End-to-end p95" value={fmtMs(now.p95LatencyMs)} tone={now.p95LatencyMs > 1500 ? 'bad' : now.p95LatencyMs > 1000 ? 'warn' : 'good'} />
        <Stat label="Error rate" value={`${now.errorRatePct}%`} tone={now.errorRatePct > 5 ? 'bad' : now.errorRatePct > 1 ? 'warn' : 'good'} />
        <Stat label="Queue depth" value={fmtNum(now.queueDepth)} tone={now.queueDepth > 50 ? 'bad' : now.queueDepth > 0 ? 'warn' : 'good'} />
        <Stat label="Dropped calls" value={fmtNum(now.droppedCalls)} tone={now.droppedCalls > 0 ? 'bad' : 'good'} />
        <Stat label="Reconnects" value={fmtNum(now.reconnects)} tone={now.reconnects > 3 ? 'warn' : 'default'} />
        <Stat label="Bandwidth" value={`${now.bandwidthMbps}`} unit="Mbit/s" />
        <Stat label="Call success rate" value={`${(100 - now.errorRatePct).toFixed(1)}%`} tone={now.errorRatePct > 5 ? 'bad' : 'good'} />
        <Stat label="Infra cost / hour" value={fmtUsd(now.costPerHourUsd)} hint="Fleet + per-call marginal (assumption)." />
        <Stat label="Est. cost / call" value={fmtUsd(cost.usdPerCall, 4)} hint="From the Cost Simulator model at this concurrency." />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Load vs capacity" pad={false}>
          <div className="h-56 p-2">
            <ResponsiveContainer>
              <LineChart data={visible}>
                <CartesianGrid stroke="rgb(var(--ink-750))" />
                <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="l" stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="r" orientation="right" stroke="rgb(var(--ink-500))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="l" name="offered" dataKey="offeredCalls" stroke="rgb(var(--ink-300))" dot={false} isAnimationActive={false} />
                <Line yAxisId="l" name="active" dataKey="activeCalls" stroke="rgb(var(--accent))" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="r" name="instances" dataKey="instances" stroke="rgb(var(--good))" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Latency percentiles" pad={false}>
          <div className="h-56 p-2">
            <ResponsiveContainer>
              <AreaChart data={visible}>
                <CartesianGrid stroke="rgb(var(--ink-750))" />
                <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis stroke="rgb(var(--ink-500))" fontSize={11} tickFormatter={(v) => `${v}ms`} />
                <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area name="p95" dataKey="p95LatencyMs" stroke="rgb(var(--warn))" fill="rgb(var(--warn) / 0.13)" isAnimationActive={false} />
                <Area name="p50" dataKey="p50LatencyMs" stroke="rgb(var(--accent))" fill="none" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Saturation signals: CPU, queue depth, errors" pad={false}>
          <div className="h-56 p-2">
            <ResponsiveContainer>
              <LineChart data={visible}>
                <CartesianGrid stroke="rgb(var(--ink-750))" />
                <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="l" stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="r" orientation="right" stroke="rgb(var(--ink-500))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="l" name="CPU %" dataKey="cpuPct" stroke="rgb(var(--control))" dot={false} isAnimationActive={false} />
                <Line yAxisId="r" name="queue depth" dataKey="queueDepth" stroke="rgb(var(--bad))" dot={false} isAnimationActive={false} />
                <Line yAxisId="r" name="error %" dataKey="errorRatePct" stroke="rgb(var(--series-orange))" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Cost & bandwidth" pad={false}>
          <div className="h-56 p-2">
            <ResponsiveContainer>
              <AreaChart data={visible}>
                <CartesianGrid stroke="rgb(var(--ink-750))" />
                <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="l" stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="r" orientation="right" stroke="rgb(var(--ink-500))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="l" name="Mbit/s" dataKey="bandwidthMbps" stroke="rgb(var(--media))" fill="rgb(var(--media) / 0.13)" isAnimationActive={false} />
                <Area yAxisId="r" name="$/hour" dataKey="costPerHourUsd" stroke="rgb(var(--good))" fill="none" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="What you are watching" className="mt-4">
        <NarrativeStrip scenario={scenario} now={now} points={points} />
      </Panel>
    </div>
  )
}

function NarrativeStrip({ scenario, now, points }: { scenario: ScenarioKind; now: TrafficPoint; points: TrafficPoint[] }) {
  const peakP95 = Math.max(...points.map((p) => p.p95LatencyMs))
  const totalDropped = points[points.length - 1]?.droppedCalls ?? 0

  const stages: { at: number; label: string; detail: string }[] =
    scenario === 'spike' || scenario === 'spike-no-autoscale'
      ? [
          { at: 0, label: 'Normal', detail: 'Steady load, CPU comfortable, queue empty, latency at baseline.' },
          { at: 120, label: 'Traffic spike', detail: 'Offered load climbs 2.8×. Calls are accepted faster than the fleet can absorb them.' },
          { at: 135, label: 'CPU rises', detail: 'Existing instances saturate. Note CPU lags the connection count — it rises only after calls are already accepted.' },
          ...(scenario === 'spike'
            ? [
                { at: 150, label: 'Autoscaling triggers', detail: 'HPA requests more instances. Nothing improves yet — the new pods need ~90 s to pull, boot and register.' },
                { at: 165, label: 'Latency increases', detail: 'Queueing delay appears: p95 climbs non-linearly as utilisation approaches 1. This is queueing theory, not bad luck.' },
                { at: 200, label: 'Queue grows', detail: 'Excess calls queue. Beyond the queue cap they are dropped rather than served badly.' },
                { at: 245, label: 'New capacity lands', detail: 'Warmed instances join the LB; utilisation falls, queue drains, latency recovers.' },
                { at: 340, label: 'Recovery / scale-in', detail: 'Load subsides. Scale-in waits out the delay and drains one instance at a time — live calls cannot be evicted.' },
              ]
            : [
                { at: 150, label: 'No autoscaling', detail: 'The fleet is fixed. Utilisation pins at 100% and stays there.' },
                { at: 180, label: 'Queue saturates', detail: `Queue hits its cap; calls start dropping. Total dropped this run: ${fmtNum(totalDropped)}.` },
                { at: 320, label: 'Spike ends', detail: 'Only when offered load falls does the system recover. Every dropped call was a real caller.' },
              ]),
        ]
      : scenario === 'outage'
        ? [
            { at: 0, label: 'Normal', detail: 'Full fleet healthy across zones.' },
            { at: 150, label: 'Capacity loss', detail: '55% of instances vanish (AZ failure). Calls on them dropped instantly — blast radius = calls-per-instance × instances lost.' },
            { at: 160, label: 'Survivors saturate', detail: 'Remaining capacity absorbs the offered load it was never sized for. Latency and errors spike together.' },
            { at: 200, label: 'Autoscale responds', detail: 'Replacement instances launch in healthy zones — but warmup means minutes of degradation regardless.' },
            { at: 330, label: 'Recovery', detail: 'Capacity restored. The lesson: N-1 sizing turns this from an outage into a bad ten minutes.' },
          ]
        : [{ at: 0, label: 'Steady state', detail: 'This is what healthy looks like: flat CPU, empty queue, p95 close to p50, error rate near zero. Know this shape so deviations are obvious.' }]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        {stages.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`rounded-md border px-2 py-1 transition-colors ${
              now.t >= s.at ? 'border-accent-dim bg-accent-deep/25 text-accent' : 'border-ink-700 text-ink-500'
            }`}>
              {s.label}
            </span>
            {i < stages.length - 1 && <span className="text-ink-600">→</span>}
          </span>
        ))}
      </div>
      <div className="space-y-1.5">
        {stages.filter((s) => now.t >= s.at).slice(-3).map((s, i) => (
          <p key={i} className="text-sm text-ink-300"><span className="font-medium text-ink-100">{s.label}: </span>{s.detail}</p>
        ))}
      </div>
      <Callout tone="info" title="Alert on the user experience, not the causes">
        Peak p95 this run: <b>{fmtMs(peakP95)}</b>. The chart to page on is perceived latency and call success rate — CPU and
        queue depth explain <em>why</em>, but the caller only feels the p95. Every SimEvent type in this simulator maps to
        something a real deployment should emit; that is what makes this dashboard reproducible in production.
      </Callout>
    </div>
  )
}
