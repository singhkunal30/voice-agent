import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PATTERNS } from '../patterns/library'
import { useAppStore } from '../state/store'
import { ArchCanvas } from '../ui/ArchCanvas'
import { Badge, KV, PageHeader, Panel } from '../ui/primitives'

export default function PatternLibrary() {
  const [selectedId, setSelectedId] = useState(PATTERNS[1].id)
  const loadPattern = useAppStore((s) => s.loadPattern)
  const navigate = useNavigate()
  const pattern = PATTERNS.find((p) => p.id === selectedId)!

  return (
    <div className="flex h-full flex-col p-4">
      <PageHeader
        title="Reference patterns"
        steps={[
          "Read them in order — they are roughly ordered by the scale they survive.",
          "For each step up, ask what forced the new component to exist. That is the whole lesson.",
          "Load one onto the canvas when you want to take it apart.",
        ]}
        subtitle="Ten reference architectures, ordered by the scale they survive. Load any one onto the canvas."
        right={
          <button className="btn btn-primary" onClick={() => { loadPattern(pattern.id); navigate('/canvas') }}>
            ⬡ Open in canvas (editable)
          </button>
        }
      />
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[300px,1fr]">
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {PATTERNS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`block w-full rounded-md border px-3 py-2 text-left transition-colors ${
                selectedId === p.id ? 'border-accent-dim bg-ink-800' : 'border-ink-750 bg-ink-900 hover:border-ink-600'
              }`}
            >
              <div className="text-sm font-medium text-ink-100">{p.name}</div>
              <div className="mt-0.5 text-xs text-ink-400">{p.summary}</div>
            </button>
          ))}
        </div>
        <div className="grid min-h-0 grid-rows-[1fr,auto] gap-3">
          <div className="min-h-[320px] overflow-hidden rounded-lg border border-ink-750 bg-ink-950">
            <ArchCanvas architecture={pattern.architecture} editable={false} fitKey={pattern.id} />
          </div>
          <Panel title={pattern.name}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="label">When to use</div>
                <p className="text-sm text-ink-300">{pattern.whenToUse}</p>
                <div className="label mt-3">When NOT to use</div>
                <p className="text-sm text-ink-300">{pattern.whenNotToUse}</p>
              </div>
              <div>
                <div className="label">Tradeoffs</div>
                <KV items={pattern.tradeoffs.map((t) => ({ k: t.axis, v: t.note }))} />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{pattern.architecture.nodes.length} components</Badge>
                  <Badge>{pattern.architecture.edges.length} connections</Badge>
                  {pattern.architecture.requirements && (
                    <Badge>{pattern.architecture.requirements.peakConcurrentCalls.toLocaleString()} concurrent design point</Badge>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
