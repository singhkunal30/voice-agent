import { useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, Cell, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { computeCost, costLevers, DEFAULT_COST_INPUTS, DEFAULT_PRICING, type CostInputs } from '../models/cost'
import { Assumption, Callout, PageHeader, Panel, Stat, fmtNum, fmtUsd } from '../ui/primitives'
import { NumberInput, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'

const CATEGORY_COLORS: Record<string, string> = {
  speech: 'rgb(var(--good))',
  intelligence: 'rgb(var(--control))',
  telephony: 'rgb(var(--series-amber))',
  compute: 'rgb(var(--accent))',
  data: 'rgb(var(--series-rose))',
  storage: 'rgb(var(--series-orange))',
  observability: 'rgb(var(--series-green))',
}

export default function CostLab() {
  const activeReq = useAppStore((s) => s.activeRequirements)
  const markProgress = useAppStore((s) => s.markProgress)
  const [inputs, setInputs] = useState<CostInputs>(() => ({
    ...DEFAULT_COST_INPUTS,
    pricing: { ...DEFAULT_PRICING },
    ...(activeReq
      ? {
          callsPerDay: activeReq.callsPerDay,
          avgCallMinutes: activeReq.avgCallSeconds / 60,
          peakConcurrent: activeReq.peakConcurrentCalls,
          recordingEnabled: activeReq.recording,
        }
      : {}),
  }))

  const set = <K extends keyof CostInputs>(k: K, v: CostInputs[K]) => setInputs((s) => ({ ...s, [k]: v }))
  const setPrice = <K extends keyof CostInputs['pricing']>(k: K, v: number) =>
    setInputs((s) => ({ ...s, pricing: { ...s.pricing, [k]: v } }))

  const result = useMemo(() => computeCost(inputs), [inputs])
  const levers = useMemo(() => costLevers(inputs), [inputs])

  // Step 11 is about *moving* a number, so tick on the first real edit rather
  // than on arrival.
  const firstInputs = useRef(inputs)
  useEffect(() => {
    if (inputs !== firstInputs.current) markProgress('optimized-cost')
  }, [inputs, markProgress])

  // Cost vs volume curve — shows fixed-cost amortisation.
  const volumeCurve = useMemo(
    () =>
      [100, 500, 1000, 5000, 10000, 50000, 100000, 500000].map((cpd) => {
        const r = computeCost({ ...inputs, callsPerDay: cpd, peakConcurrent: Math.max(5, Math.round((cpd / 86400) * inputs.avgCallMinutes * 60 * 3)) })
        return { callsPerDay: cpd, usdPerCall: r.usdPerCall, usdPerMonth: r.usdPerMonth }
      }),
    [inputs],
  )

  const pieData = result.lineItems.map((li) => ({ name: li.label, value: Math.max(li.usdPerMonth, 0), category: li.category }))

  return (
    <div className="p-4">
      <PageHeader
        title="Cost"
        steps={[
          "Find the biggest slice in “Where the money goes”. It is rarely the one people worry about.",
          "Apply the optimisation levers and check the annual delta, not the per-call one.",
          "Watch cost per call fall as volume rises — that curve is why fixed infrastructure hurts small products.",
        ]}
        subtitle="Per-call unit economics, and the levers that actually move the annual number."
        right={<Assumption>Example pricing, not vendor quotes</Assumption>}
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Cost / call" value={fmtUsd(result.usdPerCall, 4)} tone="accent" />
        <Stat label="Cost / minute" value={fmtUsd(result.usdPerMinute, 4)} />
        <Stat label="Daily" value={fmtUsd(result.usdPerDay)} />
        <Stat label="Monthly" value={fmtUsd(result.usdPerMonth)} tone="accent" />
        <Stat label="Annual" value={fmtUsd(result.usdPerYear)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px,1fr]">
        <div className="space-y-3">
          <Panel title="Volume & shape">
            <div className="space-y-3">
              <NumberInput label="Calls / day" value={inputs.callsPerDay} min={1} max={2000000} step={100} onChange={(v) => set('callsPerDay', v)} />
              <Slider label="Average call duration" value={inputs.avgCallMinutes} onChange={(v) => set('avgCallMinutes', v)} min={0.25} max={30} step={0.25} unit="min" />
              <NumberInput label="Peak concurrent calls" value={inputs.peakConcurrent} min={1} max={100000} onChange={(v) => set('peakConcurrent', v)}
                help="Drives COMPUTE cost, which is billed 24/7 regardless of how quiet 3 am is." />
              <Slider label="STT duty cycle" value={inputs.sttDutyCycle} onChange={(v) => set('sttDutyCycle', v)} min={0.1} max={1} step={0.05}
                format={(v) => `${Math.round(v * 100)}% of call minutes`} help="Fraction of the call where audio is actually streamed for recognition." />
              <Slider label="Turns per call" value={inputs.turnsPerCall} onChange={(v) => set('turnsPerCall', v)} min={1} max={40} step={1} />
              <NumberInput label="LLM input tokens / turn" value={inputs.llmInputTokensPerTurn} min={100} max={30000} step={100} onChange={(v) => set('llmInputTokensPerTurn', v)}
                help="Context is re-sent every turn — usually the dominant LLM cost." />
              <NumberInput label="LLM output tokens / turn" value={inputs.llmOutputTokensPerTurn} min={10} max={1000} step={10} onChange={(v) => set('llmOutputTokensPerTurn', v)} />
              <NumberInput label="TTS characters / turn" value={inputs.ttsCharsPerTurn} min={20} max={2000} step={10} onChange={(v) => set('ttsCharsPerTurn', v)} />
              <Toggle label="Call recording" checked={inputs.recordingEnabled} onChange={(v) => set('recordingEnabled', v)} />
              {inputs.recordingEnabled && (
                <Slider label="Retention" value={inputs.retentionMonths} onChange={(v) => set('retentionMonths', v)} min={1} max={84} step={1} unit="months"
                  help="Storage = monthly inflow × retention. This slider is a pure budget dial." />
              )}
            </div>
          </Panel>

          <Panel title="Pricing sheet (editable)" right={<Assumption />}>
            <div className="space-y-2.5">
              <NumberInput label="STT $/min" value={inputs.pricing.sttPerMinute} min={0} max={1} step={0.0005} onChange={(v) => setPrice('sttPerMinute', v)} />
              <NumberInput label="TTS $/1k chars" value={inputs.pricing.ttsPer1kChars} min={0} max={1} step={0.001} onChange={(v) => setPrice('ttsPer1kChars', v)} />
              <NumberInput label="LLM $/1k input tokens" value={inputs.pricing.llmPer1kInputTokens} min={0} max={0.1} step={0.00005} onChange={(v) => setPrice('llmPer1kInputTokens', v)} />
              <NumberInput label="LLM $/1k output tokens" value={inputs.pricing.llmPer1kOutputTokens} min={0} max={0.2} step={0.0001} onChange={(v) => setPrice('llmPer1kOutputTokens', v)} />
              <NumberInput label="Telephony $/min" value={inputs.pricing.telephonyPerMinute} min={0} max={1} step={0.001} onChange={(v) => setPrice('telephonyPerMinute', v)} />
              <NumberInput label="Compute $/instance-hour" value={inputs.pricing.mediaServerPerInstanceHour} min={0} max={20} step={0.01} onChange={(v) => setPrice('mediaServerPerInstanceHour', v)} />
              <NumberInput label="Calls per instance" value={inputs.pricing.mediaServerCallsPerInstance} min={1} max={2000} step={5} onChange={(v) => setPrice('mediaServerCallsPerInstance', v)} />
              <NumberInput label="Storage $/GB-month" value={inputs.pricing.storagePerGbMonth} min={0} max={1} step={0.001} onChange={(v) => setPrice('storagePerGbMonth', v)} />
              <NumberInput label="Observability $/GB" value={inputs.pricing.observabilityPerGbIngest} min={0} max={10} step={0.05} onChange={(v) => setPrice('observabilityPerGbIngest', v)} />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Where the money goes">
            <div className="grid gap-4 lg:grid-cols-[1fr,280px]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                    <th className="py-1.5">Line item</th>
                    <th className="text-right">$/call</th>
                    <th className="text-right">$/month</th>
                    <th className="text-right">% </th>
                    <th>Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lineItems.map((li) => {
                    const pct = result.usdPerCall > 0 ? (li.usdPerCall / result.usdPerCall) * 100 : 0
                    return (
                      <tr key={li.key} className="border-b border-ink-850 align-top">
                        <td className="py-1.5">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[li.category] }} />
                          <span className="text-ink-200">{li.label}</span>
                        </td>
                        <td className="text-right font-mono text-ink-300">{fmtUsd(li.usdPerCall, 4)}</td>
                        <td className="text-right font-mono text-ink-200">{fmtUsd(li.usdPerMonth)}</td>
                        <td className="text-right font-mono text-ink-400">{pct.toFixed(1)}%</td>
                        <td className="max-w-sm text-2xs text-ink-500">{li.basis}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={78} paddingAngle={2}>
                      {pieData.map((d, i) => <Cell key={i} fill={CATEGORY_COLORS[d.category]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }}
                      formatter={(v: number) => fmtUsd(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Panel>

          <Panel title="Cost per call vs volume — where fixed costs stop hurting">
            <div className="h-56">
              <ResponsiveContainer>
                <LineChart data={volumeCurve}>
                  <CartesianGrid stroke="rgb(var(--ink-750))" />
                  <XAxis dataKey="callsPerDay" scale="log" domain={['auto', 'auto']} type="number"
                    tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))} stroke="rgb(var(--ink-500))" fontSize={11} />
                  <YAxis stroke="rgb(var(--ink-500))" fontSize={11} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }}
                    formatter={(v: number) => fmtUsd(v, 4)} labelFormatter={(v) => `${fmtNum(v as number)} calls/day`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line name="$/call" dataKey="usdPerCall" stroke="rgb(var(--accent))" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              At low volume, per-call cost is dominated by capacity you must run anyway (compute, Redis, Postgres) — the curve
              falls steeply. Past a few thousand calls/day it flattens onto the usage floor (STT + TTS + LLM + telephony), and
              only per-unit optimisations move it further.
            </p>
          </Panel>

          <Panel title="Optimisation levers — computed against your current settings">
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={levers} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="rgb(var(--ink-750))" />
                  <XAxis type="number" stroke="rgb(var(--ink-500))" fontSize={11} tickFormatter={(v) => `$${Math.round(v)}`} />
                  <YAxis type="category" dataKey="label" width={230} stroke="rgb(var(--ink-500))" fontSize={10} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }}
                    formatter={(v: number) => [`${v < 0 ? '−' : '+'}${fmtUsd(Math.abs(v))}/month`, 'change']} />
                  <Bar dataKey="deltaPerMonth" isAnimationActive={false}>
                    {levers.map((l, i) => <Cell key={i} fill={l.deltaPerMonth < 0 ? 'rgb(var(--good))' : 'rgb(var(--bad))'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1 text-xs text-ink-400">
              {levers.map((l) => (
                <li key={l.label}>
                  <span className={l.deltaPerMonth < 0 ? 'font-medium text-good' : 'text-ink-300'}>
                    {l.deltaPerMonth < 0 ? `saves ${fmtUsd(-l.deltaPerMonth)}/mo` : `costs ${fmtUsd(l.deltaPerMonth)}/mo`}
                  </span>{' '}
                  — {l.label}. <span className="text-ink-500">{l.note}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Callout tone="info" title="Assumptions behind every number above">
            <ul className="ml-4 list-disc space-y-0.5 text-xs">
              {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </Callout>
        </div>
      </div>
    </div>
  )
}
