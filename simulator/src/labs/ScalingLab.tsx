import { useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  connectionComparison,
  DEFAULT_TRAFFIC_OPTS,
  INTER_REGION_MS,
  planInfrastructure,
  REGIONS,
  SCALE_PRESETS,
  simulateRegions,
  simulateTraffic,
} from '../models/scaling'
import { getSpec } from '../registry/components'
import type { RegionId, Requirements } from '../domain/types'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs, fmtNum } from '../ui/primitives'
import { NumberInput, Segmented, Select, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'

type Tab = 'sizing' | 'connections' | 'autoscaling' | 'regions'

export default function ScalingLab() {
  const [tab, setTab] = useState<Tab>('sizing')
  const markProgress = useAppStore((s) => s.markProgress)
  const activeReq = useAppStore((s) => s.activeRequirements)

  const [concurrent, setConcurrent] = useState(activeReq?.peakConcurrentCalls ?? 1000)
  const [callsPerDay, setCallsPerDay] = useState(activeReq?.callsPerDay ?? 50000)
  const [avgCallMin, setAvgCallMin] = useState(4)
  const [latencyTarget, setLatencyTarget] = useState(activeReq?.latencyTargetMs ?? 900)
  const [availability, setAvailability] = useState<'0.99' | '0.995' | '0.999' | '0.9995'>('0.999')
  const [handoff, setHandoff] = useState(activeReq?.humanHandoff ?? false)
  const [recording, setRecording] = useState(activeReq?.recording ?? true)
  const [languages, setLanguages] = useState(2)
  const [geography, setGeography] = useState<'in' | 'us' | 'global'>('in')

  const req: Requirements = useMemo(
    () => ({
      name: 'Scaling lab',
      callsPerDay,
      avgCallSeconds: avgCallMin * 60,
      peakCallsPerMinute: Math.round(concurrent / Math.max(1, avgCallMin)),
      peakConcurrentCalls: concurrent,
      latencyTargetMs: latencyTarget,
      availabilityTarget: Number(availability) as Requirements['availabilityTarget'],
      languages: Array.from({ length: languages }, (_, i) => ['en-IN', 'hi-IN', 'ta-IN', 'bn-IN', 'mr-IN'][i % 5]),
      regions: geography === 'in' ? ['in-mumbai'] : geography === 'us' ? ['us-east'] : ['in-mumbai', 'us-east', 'eu-west'],
      direction: 'both',
      channel: 'phone',
      humanHandoff: handoff,
      recording,
      toolUsage: 0.5,
      budgetPosture: 'balanced',
      compliance: [],
    }),
    [callsPerDay, avgCallMin, concurrent, latencyTarget, availability, handoff, recording, languages, geography],
  )

  const plan = useMemo(() => planInfrastructure(req), [req])

  // The default load already sits in the thousands, so ticking on the current
  // value would complete steps 8 and 9 the moment the page opened. Only count
  // a figure the learner actually dialled in.
  const initialConcurrent = useRef(concurrent)
  useEffect(() => {
    if (concurrent === initialConcurrent.current) return
    if (concurrent >= 100) markProgress('scaled-hundreds')
    if (concurrent >= 1000) markProgress('scaled-thousands')
  }, [concurrent, markProgress])

  return (
    <div className="p-4">
      <PageHeader
        title="Scaling"
        steps={[
          "Step the load presets: 10 → 100 → 1,000 → 10,000, and watch the bill of materials rewrite itself.",
          "At each step, note which component count grows fastest. That is your bottleneck and your bill.",
          "Then open “Autoscaling” and watch demand outrun the warmup gap.",
        ]}
        subtitle="Sizing is arithmetic on labelled assumptions: concurrent calls ÷ capacity per instance + headroom."
        right={
          <Segmented value={tab} onChange={setTab} ariaLabel="Scaling view"
            options={[
              { value: 'sizing', label: 'Sizing' },
              { value: 'connections', label: 'Long-lived connections' },
              { value: 'autoscaling', label: 'Autoscaling' },
              { value: 'regions', label: 'Multi-region' },
            ]} />
        }
      />

      {tab === 'sizing' && (
        <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
          <div className="space-y-3">
            <Panel title="Load presets">
              <div className="flex flex-wrap gap-1.5">
                {SCALE_PRESETS.map((p) => (
                  <button key={p}
                    className={`btn btn-sm ${concurrent === p ? 'border-accent-dim text-accent' : ''}`}
                    onClick={() => { setConcurrent(p); setCallsPerDay(p * 60) }}>
                    {fmtNum(p)}
                  </button>
                ))}
                <span className="self-center text-2xs text-ink-500">concurrent calls</span>
              </div>
            </Panel>
            <Panel title="Requirements">
              <div className="space-y-3">
                <NumberInput label="Peak concurrent calls" value={concurrent} min={1} max={100000} onChange={setConcurrent} />
                <NumberInput label="Calls / day" value={callsPerDay} min={10} max={5000000} step={100} onChange={setCallsPerDay} />
                <Slider label="Average call duration" value={avgCallMin} onChange={setAvgCallMin} min={0.5} max={30} step={0.5} unit="min" />
                <Slider label="Latency target" value={latencyTarget} onChange={setLatencyTarget} min={400} max={2000} step={50} unit="ms" />
                <Select label="Availability target" value={availability} onChange={setAvailability}
                  options={[
                    { value: '0.99', label: '99% (~7.3 h down/month)' },
                    { value: '0.995', label: '99.5% (~3.7 h/month)' },
                    { value: '0.999', label: '99.9% (~44 min/month)' },
                    { value: '0.9995', label: '99.95% (~22 min/month)' },
                  ]} />
                <Select label="Geography" value={geography} onChange={setGeography}
                  options={[
                    { value: 'in', label: 'India only' },
                    { value: 'us', label: 'US only' },
                    { value: 'global', label: 'India + US + Europe' },
                  ]} />
                <Slider label="Languages" value={languages} onChange={setLanguages} min={1} max={5} step={1} />
                <Toggle label="Human handoff" checked={handoff} onChange={setHandoff} />
                <Toggle label="Call recording" checked={recording} onChange={setRecording} />
              </div>
            </Panel>
          </div>

          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              <Stat label="Tier" value={plan.tierLabel} tone="accent" />
              <Stat label="Media instances" value={plan.components.find((c) => c.specId === 'media-gateway')?.instances ?? 1}
                hint="concurrent ÷ 50/instance ÷ 0.7 headroom (assumptions)" />
              <Stat label="Total components" value={plan.components.length} />
              <Stat label="Blast radius / instance" value={`≤ ${Math.min(concurrent, 50)} calls`} tone={concurrent > 50 ? 'warn' : 'good'}
                hint="Calls dropped if one media instance dies. A number you CHOOSE via instance sizing." />
            </div>

            <Panel title={`What ${fmtNum(concurrent)} concurrent calls requires — and why`}>
              <div className="space-y-2">
                {plan.narrative.map((n, i) => (
                  <p key={i} className="text-sm text-ink-300">{n}</p>
                ))}
              </div>
            </Panel>

            <Panel title="Bill of materials" right={<Assumption>Educational sizing model</Assumption>}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                    <th className="py-1.5">Component</th>
                    <th className="text-right">Instances</th>
                    <th className="text-right">Capacity each</th>
                    <th>Why this many</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.components.map((c) => (
                    <tr key={c.specId} className="border-b border-ink-850 align-top">
                      <td className="py-1.5">
                        <span className="text-ink-200">{getSpec(c.specId).name}</span>
                      </td>
                      <td className="text-right font-mono text-accent">{fmtNum(c.instances)}</td>
                      <td className="text-right font-mono text-ink-400">{fmtNum(c.perInstanceCapacity)}</td>
                      <td className="max-w-md text-xs text-ink-400">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-3 space-y-1 text-2xs text-ink-500">
                {plan.assumptions.map((a, i) => <li key={i}>· {a}</li>)}
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'connections' && <ConnectionsTab concurrent={concurrent} avgCallMin={avgCallMin} />}
      {tab === 'autoscaling' && <AutoscalingTab />}
      {tab === 'regions' && <RegionsTab concurrent={concurrent} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ConnectionsTab({ concurrent, avgCallMin }: { concurrent: number; avgCallMin: number }) {
  const cmp = useMemo(() => connectionComparison(concurrent, avgCallMin), [concurrent, avgCallMin])
  const [serverDies, setServerDies] = useState(false)
  const callsPerServer = 50

  return (
    <div className="space-y-4">
      <Callout tone="info" title="Why voice backends are not web backends">
        An HTTP request lives ~100 ms and any server can answer it. A voice connection lives {avgCallMin} minutes, streams 50
        frames a second both ways, and is welded to one specific server holding its audio buffers and conversation state.
        Everything difficult about voice infrastructure follows from this one difference.
      </Callout>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="HTTP request/response — request → response → done">
          <ComparisonList rows={cmp.http} />
          <div className="mt-3 rounded-md bg-ink-950 p-3 font-mono text-2xs text-ink-500">
            <div>req ▏ 120ms ▕ done</div>
            <div>req ▏ 85ms ▕ done</div>
            <div>req ▏ 210ms ▕ done</div>
          </div>
        </Panel>
        <Panel title={`Voice — one connection, ${avgCallMin} continuous minutes`}>
          <ComparisonList rows={cmp.voice} />
          <div className="mt-3 overflow-hidden rounded-md bg-ink-950 p-3 font-mono text-2xs text-media">
            <div className="truncate">call ▐{'█'.repeat(60)}▌ {avgCallMin} min</div>
            <div className="mt-1 text-ink-500">50 fps up · 50 fps down · state pinned · deploy must drain</div>
          </div>
        </Panel>
      </div>

      <Panel title="Server death during live calls" right={<Toggle label="Kill one media server" checked={serverDies} onChange={setServerDies} />}>
        <div className="flex flex-wrap items-center gap-3">
          {Array.from({ length: Math.min(8, Math.max(2, Math.ceil(concurrent / callsPerServer / 0.7))) }, (_, i) => (
            <div key={i}
              className={`rounded-md border px-3 py-2 text-center text-xs transition-all ${
                serverDies && i === 1 ? 'border-bad bg-bad/10 text-bad' : 'border-ink-700 bg-ink-850 text-ink-300'
              }`}>
              <div className="font-mono">server-{i + 1}</div>
              <div className="text-2xs text-ink-500">{serverDies && i === 1 ? '✕ DEAD' : `${Math.min(callsPerServer, concurrent)} calls`}</div>
            </div>
          ))}
          {Math.ceil(concurrent / callsPerServer / 0.7) > 8 && <span className="text-xs text-ink-500">… {Math.ceil(concurrent / callsPerServer / 0.7) - 8} more</span>}
        </div>
        {serverDies ? (
          <div className="mt-3 space-y-2 text-sm text-ink-300">
            <p>💥 <b className="text-bad">{Math.min(callsPerServer, concurrent)} live calls drop simultaneously</b> — every caller mid-sentence on server-2 hears the line die. No retry can hide it; the audio socket is gone.</p>
            <p>What a prepared system does next (all visible in the Live Call Simulator's reconnect path):</p>
            <ul className="ml-5 list-disc space-y-1 text-xs text-ink-400">
              <li>Health check ejects the corpse from the load balancer within seconds — <em>new</em> calls are placed on survivors.</li>
              <li>Carrier-side redial/redirect brings dropped callers back; the LB lands them on healthy instances.</li>
              <li>Session state was in Redis at last turn boundary, so the adopting server restores context: “Sorry, we got cut off — you were asking about the premium.”</li>
              <li>Postmortem math: blast radius was {Math.min(callsPerServer, concurrent)} because YOU capped calls-per-instance at {callsPerServer}. Bigger instances would have been cheaper — and worse.</li>
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-500">Flip the toggle to drop a server carrying live calls.</p>
        )}
      </Panel>
    </div>
  )
}

function ComparisonList({ rows }: { rows: { label: string; value: string; note: string }[] }) {
  return (
    <dl className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="text-sm">
          <dt className="text-ink-500">{r.label}</dt>
          <dd className="text-ink-200">{r.value} <span className="text-xs text-ink-500">— {r.note}</span></dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------

function AutoscalingTab() {
  const [enabled, setEnabled] = useState(true)
  const [cpuTarget, setCpuTarget] = useState(65)
  const [warmup, setWarmup] = useState(90)
  const [spikeMult, setSpikeMult] = useState(2.6)
  const [scaleInDelay, setScaleInDelay] = useState(120)

  const points = useMemo(
    () =>
      simulateTraffic({
        ...DEFAULT_TRAFFIC_OPTS,
        seed: 'autoscale-lab',
        spike: { startS: 120, endS: 300, multiplier: spikeMult },
        autoscale: { ...DEFAULT_TRAFFIC_OPTS.autoscale, enabled, cpuTargetPct: cpuTarget, warmupS: warmup, scaleInDelayS: scaleInDelay },
      }),
    [enabled, cpuTarget, warmup, spikeMult, scaleInDelay],
  )

  const peakP95 = Math.max(...points.map((p) => p.p95LatencyMs))
  const dropped = points[points.length - 1]?.droppedCalls ?? 0

  return (
    <div className="grid gap-4 xl:grid-cols-[300px,1fr]">
      <div className="space-y-3">
        <Panel title="Autoscaling policy">
          <div className="space-y-3">
            <Toggle label="Autoscaling enabled" checked={enabled} onChange={setEnabled} />
            <Slider label="CPU target" value={cpuTarget} onChange={setCpuTarget} min={40} max={90} step={5} unit="%"
              help="Scale out when CPU exceeds target+10. Lower target = more headroom = more idle cost." />
            <Slider label="Instance warmup" value={warmup} onChange={setWarmup} min={15} max={300} step={15} unit="s"
              help="Image pull + boot + model load + LB registration. The gap the spike exploits." />
            <Slider label="Scale-in delay" value={scaleInDelay} onChange={setScaleInDelay} min={30} max={600} step={30} unit="s"
              help="Voice can only scale in by draining — and flapping is worse than waste." />
            <Slider label="Spike multiplier" value={spikeMult} onChange={setSpikeMult} min={1.2} max={5} step={0.2} format={(v) => `${v.toFixed(1)}× at t=120s`} />
          </div>
        </Panel>
        <Callout tone="info" title="The rule: CPU > 70% OR connections > threshold → add server">
          But new servers take {warmup}s to serve traffic. A spike faster than the warmup must be absorbed by standing
          headroom or by the queue — the simulation shows exactly which, and what each costs.
        </Callout>
      </div>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Peak p95 latency" value={fmtMs(peakP95)} tone={peakP95 > 1500 ? 'bad' : peakP95 > 900 ? 'warn' : 'good'} />
          <Stat label="Calls dropped" value={fmtNum(dropped)} tone={dropped > 0 ? 'bad' : 'good'} />
          <Stat label="Peak fleet" value={`${Math.max(...points.map((p) => p.instances))} instances`} />
        </div>
        <Panel title="Fleet vs load — watch the warmup gap" pad={false}>
          <div className="h-64 p-2">
            <ResponsiveContainer>
              <LineChart data={points}>
                <CartesianGrid stroke="rgb(var(--ink-750))" />
                <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="l" stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis yAxisId="r" orientation="right" stroke="rgb(var(--ink-500))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="l" name="offered calls" dataKey="offeredCalls" stroke="rgb(var(--ink-300))" dot={false} isAnimationActive={false} />
                <Line yAxisId="l" name="active calls" dataKey="activeCalls" stroke="rgb(var(--accent))" dot={false} isAnimationActive={false} />
                <Line yAxisId="r" name="instances (serving)" dataKey="instances" stroke="rgb(var(--good))" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line yAxisId="r" name="instances (desired)" dataKey="desiredInstances" stroke="rgb(var(--good))" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="What the users felt" pad={false}>
          <div className="h-56 p-2">
            <ResponsiveContainer>
              <AreaChart data={points}>
                <CartesianGrid stroke="rgb(var(--ink-750))" />
                <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
                <YAxis stroke="rgb(var(--ink-500))" fontSize={11} />
                <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area name="p95 latency (ms)" dataKey="p95LatencyMs" stroke="rgb(var(--warn))" fill="rgb(var(--warn) / 0.13)" isAnimationActive={false} />
                <Area name="queue depth" dataKey="queueDepth" stroke="rgb(var(--bad))" fill="none" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="px-3 pb-3 text-xs text-ink-500">
            The classic shape: load jumps at t=120s → CPU pins → scale-out fires → for {warmup}s (warmup) latency and queue absorb
            the difference → new capacity lands → recovery. Scale-in waits {scaleInDelay}s and drains one instance at a time, because
            evicting live calls is worse than idle capacity.
          </p>
        </Panel>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function RegionsTab({ concurrent }: { concurrent: number }) {
  const [failRegion, setFailRegion] = useState<RegionId | 'none'>('in-mumbai')
  const regions: RegionId[] = ['in-mumbai', 'us-east', 'eu-west']
  const points = useMemo(
    () =>
      simulateRegions({
        seed: 'regions',
        regions,
        callShare: { 'in-mumbai': 0.5, 'us-east': 0.3, 'eu-west': 0.2 },
        totalConcurrent: concurrent,
        failure: failRegion === 'none' ? undefined : { region: failRegion, startS: 60, endS: 180 },
        durationS: 260,
        baseLatencyMs: 650,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [concurrent, failRegion],
  )

  const chartData = points.map((p) => ({
    t: p.t,
    ...Object.fromEntries(Object.entries(p.perRegion).map(([r, v]) => [`${r}-lat`, v.latencyMs])),
  }))
  const colors: Record<string, string> = { 'in-mumbai': 'rgb(var(--accent))', 'us-east': 'rgb(var(--control))', 'eu-west': 'rgb(var(--good))' }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select label="Fail a region (t=60s → 180s)" value={failRegion} onChange={(v) => setFailRegion(v as RegionId | 'none')}
          options={[{ value: 'none', label: 'No failure' }, ...regions.map((r) => ({ value: r, label: `${REGIONS.find((x) => x.id === r)?.name} DOWN` }))]} />
        <div className="text-xs text-ink-500">
          Traffic: 50% India · 30% US · 20% Europe · media terminates in-region · session state region-local · durable data replicated
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {regions.map((r) => {
          const last = points[Math.min(points.length - 1, 12)]?.perRegion[r]
          const failed = failRegion === r
          return (
            <div key={r} className={`panel px-3 py-2.5 ${failed ? 'border-bad/50' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-100">{REGIONS.find((x) => x.id === r)?.name}</span>
                <Badge tone={failed ? 'bad' : 'good'}>{failed ? 'fails at t=60s' : 'healthy'}</Badge>
              </div>
              <div className="mt-1 text-xs text-ink-400">
                {last ? `${fmtNum(last.servingCalls)} calls · baseline ${fmtMs(650)}` : ''}
                {failed && <span className="block text-warn">→ users re-route to nearest region; +{INTER_REGION_MS[r][regions.filter((x) => x !== r).sort((a, b) => INTER_REGION_MS[r][a] - INTER_REGION_MS[r][b])[0]] * 2} ms per turn</span>}
              </div>
            </div>
          )
        })}
      </div>

      <Panel title="Perceived latency by user region" pad={false}>
        <div className="h-64 p-2">
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid stroke="rgb(var(--ink-750))" />
              <XAxis dataKey="t" tickFormatter={(t) => `${t}s`} stroke="rgb(var(--ink-500))" fontSize={11} />
              <YAxis stroke="rgb(var(--ink-500))" fontSize={11} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }} labelFormatter={(t) => `t = ${t}s`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {regions.map((r) => (
                <Line key={r} name={`${r} users`} dataKey={`${r}-lat`} stroke={colors[r]} dot={false} strokeWidth={2} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Callout tone="info" title="What the failover changes — and what it cannot">
          Calls survive (users redial/re-route within seconds), capacity holds <em>if surviving regions were sized for N-1</em>,
          but latency physics is non-negotiable: Mumbai users served from Singapore pay +~60 ms per round trip on every single
          turn until recovery. Failover keeps you up; it does not keep you fast.
        </Callout>
        <Callout tone="warn" title="Data locality decisions you must make BEFORE this happens">
          Session state: region-local (calls are region-sticky — replicating live audio state across oceans is a mistake).
          Durable data: pick a story — regional primaries, or one primary + replicas — and write down what happens during a
          partition. Recordings: region-local buckets (residency). Cross-region traffic should be analytics and replication,
          never live media.
        </Callout>
      </div>

      <Panel title="Inter-region round-trip matrix (simulation assumptions, ms)">
        <table className="w-full max-w-xl font-mono text-xs">
          <thead>
            <tr><th className="p-1 text-left text-ink-500">from \ to</th>{regions.map((r) => <th key={r} className="p-1 text-right text-ink-500">{r}</th>)}</tr>
          </thead>
          <tbody>
            {regions.map((a) => (
              <tr key={a}>
                <td className="p-1 text-ink-400">{a}</td>
                {regions.map((b) => (
                  <td key={b} className={`p-1 text-right ${a === b ? 'text-good' : INTER_REGION_MS[a][b] > 80 ? 'text-warn' : 'text-ink-300'}`}>
                    {INTER_REGION_MS[a][b] * 2}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-500">Every millisecond here lands directly on perceived latency for cross-region turns — twice (there and back).</p>
      </Panel>
    </div>
  )
}
