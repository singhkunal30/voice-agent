import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { buildComparison } from '../decision/comparison'
import { DEFAULT_LATENCY_PARAMS, type LatencyParams } from '../models/latency'
import { Assumption, Badge, Callout, PageHeader, Panel, fmtMs } from '../ui/primitives'
import { Slider } from '../ui/controls'

const COLORS: Record<string, string> = { batch: 'rgb(var(--bad))', streaming: 'rgb(var(--good))', s2s: 'rgb(var(--control))', hybrid: 'rgb(var(--accent))' }

export default function ComparisonLab() {
  const [params, setParams] = useState<LatencyParams>({ ...DEFAULT_LATENCY_PARAMS })
  const data = useMemo(() => buildComparison(params), [params])

  const chartData = data.columns.map((c) => ({ name: c.name.split('·')[0].trim(), id: c.id, ms: c.perceivedLatencyMs }))

  return (
    <div className="p-4">
      <PageHeader
        title="Compare designs"
        steps={[
          "Pick two designs that are one step apart in scale.",
          "Read down each axis rather than across — you are comparing tradeoffs, not scoring a winner.",
          "Answer “Which would you pick?” for yourself before reading the note.",
        ]}
        subtitle="Two architectures on explicit axes, so you compare tradeoffs instead of picking a favourite."
        right={<Assumption>Numbers derive from the Latency Lab model</Assumption>}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.columns.map((c) => (
          <Panel key={c.id} className="h-full">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLORS[c.id] }} />
              <span className="text-sm font-semibold text-ink-100">{c.name}</span>
            </div>
            <p className="mb-2 text-xs text-ink-400">{c.pipeline}</p>
            <div className="font-mono text-2xl font-semibold" style={{ color: COLORS[c.id] }}>{fmtMs(c.perceivedLatencyMs)}</div>
            <div className="text-2xs text-ink-500">{c.latencyBasis}</div>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,300px]">
        <Panel title="Comparison on explicit axes">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left align-bottom">
                  <th className="w-36 py-2 text-2xs uppercase tracking-wide text-ink-500">Axis</th>
                  {data.columns.map((c) => (
                    <th key={c.id} className="px-2 py-2 text-xs font-semibold" style={{ color: COLORS[c.id] }}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.axis} className="border-b border-ink-850 align-top">
                    <th className="py-2.5 pr-2 text-left text-xs font-medium text-ink-200">{row.axis}</th>
                    {data.columns.map((c) => (
                      <td key={c.id} className="px-2 py-2.5 text-xs text-ink-400">{row.cells[c.id]}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th className="py-2.5 pr-2 text-left text-xs font-medium text-accent">Insight</th>
                  <td colSpan={4} className="px-2 py-2.5">
                    <ul className="space-y-1 text-xs text-ink-300">
                      {data.rows.map((r) => (
                        <li key={r.axis}><span className="text-ink-500">{r.axis}: </span>{r.insight}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel title="Perceived latency" pad={false}>
            <div className="h-56 p-2">
              <ResponsiveContainer>
                <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 30 }}>
                  <CartesianGrid stroke="rgb(var(--ink-750))" />
                  <XAxis type="number" stroke="rgb(var(--ink-500))" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(1)}s`} />
                  <YAxis type="category" dataKey="name" width={80} stroke="rgb(var(--ink-500))" fontSize={10} />
                  <Tooltip contentStyle={{ background: 'rgb(var(--ink-850))', border: '1px solid rgb(var(--ink-600))', fontSize: 12 }}
                    formatter={(v: number) => [fmtMs(v), 'perceived']} />
                  <Bar dataKey="ms" isAnimationActive={false}>
                    {chartData.map((d) => <Cell key={d.id} fill={COLORS[d.id]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Shared assumptions (edit to re-run)">
            <div className="space-y-3">
              <Slider label="Endpointing" value={params.endpointingMs} onChange={(v) => setParams((p) => ({ ...p, endpointingMs: v }))} min={150} max={1500} step={50} unit="ms" />
              <Slider label="LLM first token" value={params.llmFirstTokenMs} onChange={(v) => setParams((p) => ({ ...p, llmFirstTokenMs: v }))} min={80} max={1500} step={20} unit="ms" />
              <Slider label="TTS first audio" value={params.ttsFirstAudioMs} onChange={(v) => setParams((p) => ({ ...p, ttsFirstAudioMs: v }))} min={50} max={1200} step={10} unit="ms" />
              <Slider label="Network (user↔edge)" value={params.userToEdgeMs} onChange={(v) => setParams((p) => ({ ...p, userToEdgeMs: v }))} min={5} max={250} step={5} unit="ms" />
              <Slider label="Utterance length" value={params.utteranceSeconds} onChange={(v) => setParams((p) => ({ ...p, utteranceSeconds: v }))} min={1} max={15} step={0.5} unit="s"
                help="Batch STT scales with this; streaming does not." />
            </div>
          </Panel>

          <Callout tone="info" title="How to read this table">
            Latency is computed; everything else is argued. If a cell's judgment does not match your context, change it —
            and notice that doing so changes the recommendation, which is exactly the point. There are no aggregate scores
            here because summing incommensurable axes hides the decision instead of making it.
          </Callout>

          <Panel title="Assumptions">
            <ul className="ml-4 list-disc space-y-1 text-2xs text-ink-500">
              {data.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </Panel>

          <Panel title="Which would you pick?">
            <div className="space-y-2 text-xs text-ink-400">
              <p><Badge tone="bad">A</Badge> if you are prototyping, or the product tolerates multi-second replies (voicemail triage, callbacks).</p>
              <p><Badge tone="good">B</Badge> for almost every production conversational agent. Default answer; the rest of this simulator teaches it.</p>
              <p><Badge tone="control">C</Badge> when naturalness is the product and you accept lock-in + opacity — and you keep B warm as fallback.</p>
              <p><Badge tone="accent">D</Badge> when different turns have different needs: S2S shell for flow, text pipeline for regulated/tool-heavy turns.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
