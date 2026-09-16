import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { decideArchitecture } from '../decision/engine'
import type { RegionId, Requirements } from '../domain/types'
import { ArchCanvas } from '../ui/ArchCanvas'
import { Assumption, Badge, Callout, PageHeader, Panel } from '../ui/primitives'
import { NumberInput, Select, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'
import { SCENARIOS } from '../scenarios/library'
import { getSpec } from '../registry/components'

export default function DecisionLab() {
  const activeReq = useAppStore((s) => s.activeRequirements)
  const setWorkingArchitecture = useAppStore((s) => s.setWorkingArchitecture)
  const setActiveRequirements = useAppStore((s) => s.setActiveRequirements)
  const markProgress = useAppStore((s) => s.markProgress)
  const navigate = useNavigate()

  const [req, setReq] = useState<Requirements>(
    activeReq ?? {
      name: 'My requirements',
      callsPerDay: 5000,
      avgCallSeconds: 240,
      peakCallsPerMinute: 125,
      peakConcurrentCalls: 500,
      latencyTargetMs: 800,
      availabilityTarget: 0.999,
      languages: ['hi-IN', 'en-IN'],
      regions: ['in-mumbai'],
      direction: 'inbound',
      channel: 'phone',
      humanHandoff: true,
      recording: true,
      toolUsage: 0.6,
      budgetPosture: 'balanced',
      compliance: [],
    },
  )

  const set = <K extends keyof Requirements>(k: K, v: Requirements[K]) => setReq((r) => ({ ...r, [k]: v }))
  const result = useMemo(() => decideArchitecture(req), [req])

  useEffect(() => {
    markProgress('used-decision-engine')
  }, [markProgress])

  return (
    <div className="p-4">
      <PageHeader
        title="Decision engine"
        steps={[
          "Load a scenario's requirements, or set them yourself.",
          "Read each decision's Requirement → Constraint → Decision → Tradeoff chain. Never accept a bare verdict.",
          "Change one requirement — availability 99% → 99.99% — and watch how much of the design it rewrites.",
        ]}
        subtitle="Every choice is shown as Requirement → Constraint → Decision → Tradeoff, never as a bare verdict."
        right={
          <div className="flex gap-2">
            <Select value="__none" onChange={(v) => { const sc = SCENARIOS.find((s) => s.id === v); if (sc) setReq(sc.requirements) }}
              options={[{ value: '__none', label: 'Load scenario requirements…' }, ...SCENARIOS.map((s) => ({ value: s.id, label: s.name }))]} />
            <button className="btn btn-primary" onClick={() => { setWorkingArchitecture({ ...result.architecture, id: 'working' }); setActiveRequirements(req); navigate('/canvas') }}>
              ⬡ Send to canvas
            </button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <Panel title="Requirements">
          <div className="space-y-3">
            <NumberInput label="Calls / day" value={req.callsPerDay} min={10} max={5000000} step={100} onChange={(v) => set('callsPerDay', v)} />
            <NumberInput label="Peak concurrent calls" value={req.peakConcurrentCalls} min={1} max={100000} onChange={(v) => set('peakConcurrentCalls', v)} />
            <Slider label="Average call duration" value={req.avgCallSeconds} onChange={(v) => set('avgCallSeconds', v)} min={30} max={1800} step={30} unit="s"
              format={(v) => `${(v / 60).toFixed(1)} min`} />
            <Slider label="Perceived latency target" value={req.latencyTargetMs} onChange={(v) => set('latencyTargetMs', v)} min={400} max={3000} step={50} unit="ms" />
            <Select label="Availability target" value={String(req.availabilityTarget)}
              onChange={(v) => set('availabilityTarget', Number(v) as Requirements['availabilityTarget'])}
              options={[
                { value: '0.99', label: '99%' },
                { value: '0.995', label: '99.5%' },
                { value: '0.999', label: '99.9%' },
                { value: '0.9995', label: '99.95%' },
                { value: '0.9999', label: '99.99%' },
              ]} />
            <Select label="Channel" value={req.channel} onChange={(v) => set('channel', v as Requirements['channel'])}
              options={[{ value: 'phone', label: 'Phone only' }, { value: 'browser', label: 'Browser only' }, { value: 'both', label: 'Phone + browser' }]} />
            <Select label="Direction" value={req.direction} onChange={(v) => set('direction', v as Requirements['direction'])}
              options={[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }, { value: 'both', label: 'Both' }]} />
            <div>
              <label className="label">Languages (comma separated)</label>
              <input className="input" value={req.languages.join(', ')}
                onChange={(e) => set('languages', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
            </div>
            <div>
              <label className="label">Regions</label>
              <div className="space-y-1">
                {(['in-mumbai', 'us-east', 'eu-west', 'ap-singapore'] as RegionId[]).map((r) => (
                  <Toggle key={r} label={r} checked={req.regions.includes(r)}
                    onChange={(on) => set('regions', on ? [...req.regions, r] : req.regions.filter((x) => x !== r))} />
                ))}
              </div>
            </div>
            <Select label="Budget posture" value={req.budgetPosture} onChange={(v) => set('budgetPosture', v as Requirements['budgetPosture'])}
              options={[{ value: 'low-cost', label: 'Low cost' }, { value: 'balanced', label: 'Balanced' }, { value: 'premium', label: 'Premium' }]} />
            <Slider label="Tool usage" value={req.toolUsage} onChange={(v) => set('toolUsage', v)} min={0} max={1} step={0.1}
              format={(v) => `${Math.round(v * 100)}% of turns`} />
            <Toggle label="Human handoff required" checked={req.humanHandoff} onChange={(v) => set('humanHandoff', v)} />
            <Toggle label="Call recording required" checked={req.recording} onChange={(v) => set('recording', v)} />
            <div>
              <label className="label">Compliance notes (educational)</label>
              <input className="input" placeholder="e.g. PII handling, audit logging"
                value={req.compliance.join(', ')}
                onChange={(e) => set('compliance', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Proposed architecture" right={<Badge tone="accent">{result.summary}</Badge>} pad={false}>
            <div className="h-[320px]">
              <ArchCanvas architecture={result.architecture} editable={false} fitKey={JSON.stringify(req).length + result.decisions.length} />
            </div>
          </Panel>

          <Panel title={`Decision records (${result.decisions.length})`} right={<Assumption />}>
            <p className="mb-3 text-sm text-ink-400">
              This is the part that transfers to real work. Each record is a chain you can challenge: if you disagree with a
              tradeoff, the decision changes — and the architecture with it.
            </p>
            <div className="space-y-3">
              {result.decisions.map((d) => (
                <div key={d.id} className="rounded-md border border-ink-750 bg-ink-850 p-3">
                  <div className="grid gap-2 md:grid-cols-4">
                    <Chain label="Requirement" tone="text-ink-200">{d.requirement}</Chain>
                    <Chain label="Constraint" tone="text-warn">{d.constraint}</Chain>
                    <Chain label="Decision" tone="text-accent">{d.decision}</Chain>
                    <Chain label="Tradeoff" tone="text-bad">{d.tradeoff}</Chain>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-ink-800 pt-2">
                    <Badge tone={d.confidence === 'high' ? 'good' : d.confidence === 'medium' ? 'warn' : 'accent'}>
                      {d.confidence} confidence
                    </Badge>
                    {d.addsComponents.map((c) => {
                      let label = c
                      try { label = getSpec(c).short } catch { /* spec may be virtual */ }
                      return <Badge key={c}>+ {label}</Badge>
                    })}
                  </div>
                  {d.alternatives.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">Alternatives considered ({d.alternatives.length})</summary>
                      <ul className="ml-4 mt-1 list-disc space-y-1 text-xs text-ink-400">
                        {d.alternatives.map((a, i) => (
                          <li key={i}><span className="font-medium text-ink-300">{a.option}</span> — {a.whyNot}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <Callout tone="info" title="Assumptions carried with this design">
            <ul className="ml-4 list-disc space-y-0.5 text-xs">
              {result.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </Callout>
        </div>
      </div>
    </div>
  )
}

function Chain({ label, children, tone }: { label: string; children: ReactNode; tone: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <p className={`text-xs ${tone}`}>{children}</p>
    </div>
  )
}
