import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SCENARIOS } from '../scenarios/library'
import { getPattern } from '../patterns/library'
import { useAppStore } from '../state/store'
import { Badge, KV, PageHeader, Panel } from '../ui/primitives'
import type { Scenario } from '../domain/types'

export default function ScenarioLab() {
  const activeScenario = useAppStore((s) => s.activeScenario)
  const setActiveScenario = useAppStore((s) => s.setActiveScenario)
  const loadPattern = useAppStore((s) => s.loadPattern)
  const [selected, setSelected] = useState<Scenario | null>(activeScenario)

  return (
    <div className="p-4">
      <PageHeader
        title="Scenario Lab"
        subtitle="Twelve realistic briefs. Activating a scenario threads its requirements through the whole app: the call simulator speaks its utterance, the canvas validates against its constraints, the decision engine designs for it."
      />
      <div className="grid gap-4 lg:grid-cols-[380px,1fr]">
        <div className="space-y-2">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              onClick={() => setSelected(sc)}
              className={`block w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                selected?.id === sc.id
                  ? 'border-accent-dim bg-ink-800'
                  : 'border-ink-750 bg-ink-900 hover:border-ink-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-100">{sc.name}</span>
                {activeScenario?.id === sc.id && <Badge tone="accent">active</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-ink-400">{sc.tagline}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Badge>{sc.requirements.peakConcurrentCalls.toLocaleString()} concurrent</Badge>
                <Badge>{sc.requirements.latencyTargetMs} ms target</Badge>
                <Badge>{sc.requirements.channel}</Badge>
                {sc.requirements.humanHandoff && <Badge tone="warn">handoff</Badge>}
              </div>
            </button>
          ))}
        </div>

        {selected ? (
          <div className="space-y-3">
            <Panel
              title={selected.name}
              right={
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setActiveScenario(selected)
                      loadPattern(selected.referencePatternId)
                    }}
                    title="Set as active scenario and load its reference architecture onto the canvas"
                  >
                    ⎈ Activate scenario
                  </button>
                </div>
              }
            >
              <p className="mb-3 text-sm text-ink-300">{selected.story}</p>
              <KV
                items={[
                  { k: 'Calls / day', v: selected.requirements.callsPerDay.toLocaleString() },
                  { k: 'Peak concurrent', v: selected.requirements.peakConcurrentCalls.toLocaleString() },
                  { k: 'Latency target', v: `${selected.requirements.latencyTargetMs} ms perceived` },
                  { k: 'Availability', v: `${(selected.requirements.availabilityTarget * 100).toFixed(2)}%` },
                  { k: 'Languages', v: selected.requirements.languages.join(', ') },
                  { k: 'Regions', v: selected.requirements.regions.join(', ') },
                  { k: 'Channel', v: selected.requirements.channel },
                  { k: 'Direction', v: selected.requirements.direction },
                  { k: 'Human handoff', v: selected.requirements.humanHandoff ? 'required' : 'not required' },
                  { k: 'Recording', v: selected.requirements.recording ? 'required' : 'not required' },
                  { k: 'Budget posture', v: selected.requirements.budgetPosture },
                  { k: 'Tools', v: selected.tools.join(', ') },
                ]}
              />
            </Panel>

            <Panel title="What makes this scenario interesting">
              <ul className="ml-4 list-disc space-y-1 text-sm text-ink-300">
                {selected.crux.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </Panel>

            <Panel title="Work the scenario">
              <div className="grid gap-2 sm:grid-cols-2">
                <Link to="/call" className="btn justify-center" onClick={() => setActiveScenario(selected)}>
                  ☎ Run its call — “{selected.sampleUtterance.slice(0, 32)}…”
                </Link>
                <Link to="/canvas" className="btn justify-center" onClick={() => { setActiveScenario(selected); loadPattern(selected.referencePatternId) }}>
                  ⬡ Open reference architecture ({getPattern(selected.referencePatternId)?.name})
                </Link>
                <Link to="/decisions" className="btn justify-center" onClick={() => setActiveScenario(selected)}>
                  ⇶ Derive the design from its requirements
                </Link>
                <Link to="/cost" className="btn justify-center" onClick={() => setActiveScenario(selected)}>
                  ＄ Price it out
                </Link>
              </div>
            </Panel>
          </div>
        ) : (
          <Panel title="Pick a scenario">
            <p className="text-sm text-ink-400">Select a brief on the left to see its requirements, its crux, and the labs that bring it to life.</p>
          </Panel>
        )}
      </div>
    </div>
  )
}
