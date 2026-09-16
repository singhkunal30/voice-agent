import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toPng, toSvg } from 'html-to-image'
import { ArchCanvas } from '../ui/ArchCanvas'
import { ComponentInspector } from '../ui/ComponentInspector'
import { Assumption, Badge, Callout, EmptyState, LabGuide, Panel } from '../ui/primitives'
import { NumberInput, Select } from '../ui/controls'
import { useAppStore } from '../state/store'
import { COMPONENT_SPECS, CATEGORY_LABELS, getSpec } from '../registry/components'
import { PATTERNS } from '../patterns/library'
import { validateArchitecture } from '../validation/rules'
import { detectBottlenecks, computeResources } from '../models/scaling'
import type { ArchEdge, ArchNode, ValidationIssue } from '../domain/types'

export default function ArchitectureCanvas() {
  const arch = useAppStore((s) => s.workingArchitecture)
  const setArch = useAppStore((s) => s.setWorkingArchitecture)
  const loadPattern = useAppStore((s) => s.loadPattern)
  const saveArchitecture = useAppStore((s) => s.saveArchitecture)
  const savedArchitectures = useAppStore((s) => s.savedArchitectures)
  const loadSaved = useAppStore((s) => s.loadSaved)
  const deleteSaved = useAppStore((s) => s.deleteSaved)
  const requirements = useAppStore((s) => s.activeRequirements)
  const markProgress = useAppStore((s) => s.markProgress)

  const [selectedNode, setSelectedNode] = useState<ArchNode | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<ArchEdge | null>(null)
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null)
  const [concurrency, setConcurrency] = useState(requirements?.peakConcurrentCalls ?? 200)
  const [fitKey, setFitKey] = useState(0)
  const [paletteCat, setPaletteCat] = useState<string>('all')
  const [inspectCount, setInspectCount] = useState(0)
  const canvasRef = useRef<HTMLDivElement>(null)

  // Keep selection in sync with the architecture object.
  const liveSelectedNode = useMemo(
    () => (selectedNode ? arch.nodes.find((n) => n.id === selectedNode.id) ?? null : null),
    [selectedNode, arch],
  )

  useEffect(() => {
    if (inspectCount >= 5) markProgress('inspected-components')
  }, [inspectCount, markProgress])

  const addComponent = useCallback(
    (specId: string) => {
      const spec = getSpec(specId)
      const count = arch.nodes.filter((n) => n.specId === specId).length
      const node: ArchNode = {
        id: `${specId}-${Date.now() % 100000}`,
        specId,
        label: count ? `${spec.short} ${count + 1}` : spec.short,
        position: { x: 120 + (arch.nodes.length % 6) * 60, y: 80 + (arch.nodes.length % 5) * 70 },
        config: Object.fromEntries((spec.config ?? []).map((c) => [c.key, c.default])),
        replicas: 1,
      }
      setArch({ ...arch, nodes: [...arch.nodes, node] })
    },
    [arch, setArch],
  )

  const updateNode = useCallback(
    (id: string, patch: Partial<ArchNode>) => {
      setArch({ ...arch, nodes: arch.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })
    },
    [arch, setArch],
  )

  const deleteNode = useCallback(
    (id: string) => {
      setArch({
        ...arch,
        nodes: arch.nodes.filter((n) => n.id !== id),
        edges: arch.edges.filter((e) => e.source !== id && e.target !== id),
      })
      setSelectedNode(null)
    },
    [arch, setArch],
  )

  const runValidation = useCallback(() => {
    const req = requirements ? { ...requirements, peakConcurrentCalls: concurrency } : undefined
    setIssues(validateArchitecture(arch, req))
  }, [arch, requirements, concurrency])

  const bottleneckCaptions = useMemo(() => {
    const captions: Record<string, string> = {}
    for (const u of computeResources(arch, concurrency)) {
      if (u.utilisation > 0.5) captions[u.nodeId] = `${Math.round(u.utilisation * 100)}% util`
    }
    return captions
  }, [arch, concurrency])

  const warnNodes = useMemo(
    () => detectBottlenecks(arch, concurrency).map((b) => b.nodeId),
    [arch, concurrency],
  )

  const issueNodeIds = useMemo(
    () => (issues ?? []).filter((i) => i.severity === 'error').flatMap((i) => i.targets),
    [issues],
  )

  // ---- Export ----------------------------------------------------------
  const exportJson = () => {
    const payload = {
      ...arch,
      requirements: requirements ?? arch.requirements,
      simulationParameters: { concurrency },
      assumptions: [
        ...arch.assumptions,
        'Capacities, latencies and prices in this export are simulation assumptions from the Voice Agent Architecture Simulator.',
      ],
      exportedAt: new Date().toISOString(),
    }
    download(`${arch.name.replace(/\W+/g, '-')}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  }

  const exportImage = async (kind: 'png' | 'svg') => {
    const el = canvasRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null
    const root = canvasRef.current
    if (!el || !root) return
    try {
      const opts = { backgroundColor: 'rgb(var(--ink-950))', width: root.clientWidth, height: root.clientHeight }
      const dataUrl = kind === 'png' ? await toPng(root, opts) : await toSvg(root, opts)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${arch.name.replace(/\W+/g, '-')}.${kind}`
      a.click()
    } catch (err) {
      console.error('export failed', err)
    }
  }

  const importJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          setArch({ ...parsed, id: 'working', version: 1 })
          setFitKey((k) => k + 1)
          setIssues(null)
        }
      } catch {
        alert('Not a valid architecture JSON file.')
      }
    }
    reader.readAsText(file)
  }

  const visibleSpecs = COMPONENT_SPECS.filter((s) => paletteCat === 'all' || s.category === paletteCat)

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-[240px] font-medium"
          value={arch.name}
          onChange={(e) => setArch({ ...arch, name: e.target.value })}
          aria-label="Architecture name"
        />
        <Select
          value="__none"
          onChange={(v) => {
            if (v !== '__none') {
              loadPattern(v)
              setIssues(null)
              setSelectedNode(null)
              setFitKey((k) => k + 1)
            }
          }}
          options={[{ value: '__none', label: 'Load pattern…' }, ...PATTERNS.map((p) => ({ value: p.id, label: p.name }))]}
        />
        <button className="btn" onClick={() => saveArchitecture(arch.name)} title="Save to browser storage">💾 Save</button>
        {savedArchitectures.length > 0 && (
          <Select
            value="__none"
            onChange={(v) => {
              if (v.startsWith('del:')) deleteSaved(v.slice(4))
              else if (v !== '__none') {
                loadSaved(v)
                setFitKey((k) => k + 1)
              }
            }}
            options={[
              { value: '__none', label: `Saved (${savedArchitectures.length})…` },
              ...savedArchitectures.map((s) => ({ value: s.id, label: `↺ ${s.name}` })),
              ...savedArchitectures.map((s) => ({ value: `del:${s.id}`, label: `✕ delete ${s.name}` })),
            ]}
          />
        )}
        <LabGuide
          title="Architecture canvas"
          note="Drag components in, wire them up, and a set of engineering rules critiques what you drew."
          steps={[
            "Start from “Load pattern…” — critiquing something is far easier than inventing it.",
            "Click any component to read what it does, how it scales, and how it fails.",
            "Delete something load-bearing (try Redis) and watch the findings react.",
          ]}
        />
        <div className="mx-2 h-5 w-px bg-ink-700" />
        <button className="btn" onClick={exportJson} title="Export architecture + assumptions as JSON">⇩ JSON</button>
        <button className="btn" onClick={() => exportImage('png')}>⇩ PNG</button>
        <button className="btn" onClick={() => exportImage('svg')}>⇩ SVG</button>
        <label className="btn cursor-pointer">
          ⇧ Import
          <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </label>
        <div className="mx-2 h-5 w-px bg-ink-700" />
        <NumberInput value={concurrency} min={1} max={100000} onChange={setConcurrency} unit="concurrent calls" />
        <button className="btn btn-primary" onClick={runValidation}>✓ Validate architecture</button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[210px,1fr,340px]">
        {/* Palette */}
        <Panel title="Components" pad={false} className="hidden min-h-0 overflow-hidden xl:flex xl:flex-col">
          <div className="border-b border-ink-800 p-2">
            <Select
              value={paletteCat}
              onChange={setPaletteCat}
              options={[{ value: 'all', label: 'All categories' }, ...Object.entries(CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {visibleSpecs.map((s) => (
              <button
                key={s.id}
                className="mb-1 w-full rounded-md border border-ink-750 bg-ink-850 px-2 py-1.5 text-left text-xs text-ink-200 transition-colors hover:border-accent-dim hover:bg-ink-800"
                onClick={() => addComponent(s.id)}
                title={`${s.description}\n\nClick to add to the canvas.`}
              >
                <div className="font-medium">{s.short}</div>
                <div className="text-2xs text-ink-500">{s.category}</div>
              </button>
            ))}
          </div>
        </Panel>

        {/* Canvas */}
        <div ref={canvasRef} className="relative min-h-[420px] overflow-hidden rounded-lg border border-ink-750 bg-ink-950">
          <ArchCanvas
            architecture={arch}
            onChange={setArch}
            onSelectNode={(n) => {
              setSelectedNode(n)
              setSelectedEdge(null)
              if (n) setInspectCount((c) => c + 1)
            }}
            onSelectEdge={(e) => {
              setSelectedEdge(e)
              setSelectedNode(null)
            }}
            highlights={{ warnNodeIds: warnNodes, failedNodeIds: issueNodeIds, nodeCaptions: bottleneckCaptions }}
            fitKey={fitKey}
          />
          <div className="pointer-events-none absolute bottom-2 left-2 text-2xs text-ink-500">
            Drag from a node's right handle to connect · Delete/Backspace removes selection · <span className="text-media">▮ solid = media plane</span> · <span className="text-control">▯ dashed = control plane</span>
          </div>
        </div>

        {/* Right panel: inspector or validation results */}
        <div className="min-h-0 overflow-hidden">
          {liveSelectedNode ? (
            <div className="panel h-full overflow-hidden">
              <ComponentInspector
                node={liveSelectedNode}
                onClose={() => setSelectedNode(null)}
                onConfigChange={(key, value) => updateNode(liveSelectedNode.id, { config: { ...liveSelectedNode.config, [key]: value } })}
                onReplicasChange={(replicas) => updateNode(liveSelectedNode.id, { replicas })}
                onDelete={() => deleteNode(liveSelectedNode.id)}
              />
            </div>
          ) : selectedEdge ? (
            <Panel title="Connection" className="h-full overflow-y-auto">
              <EdgeInspector
                edge={selectedEdge}
                arch={arch}
                onChange={(patch) => {
                  setArch({ ...arch, edges: arch.edges.map((e) => (e.id === selectedEdge.id ? { ...e, ...patch } : e)) })
                  setSelectedEdge({ ...selectedEdge, ...patch })
                }}
                onDelete={() => {
                  setArch({ ...arch, edges: arch.edges.filter((e) => e.id !== selectedEdge.id) })
                  setSelectedEdge(null)
                }}
              />
            </Panel>
          ) : (
            <Panel title={issues ? `Validation — ${issues.length} finding${issues.length === 1 ? '' : 's'}` : 'Validation'} className="flex h-full flex-col overflow-hidden" pad={false}>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {!issues && (
                  <EmptyState>
                    Click <span className="mx-1 font-medium text-accent">Validate architecture</span> to run {'>'}15 engineering rules against this design — single points of failure, media-path violations, format mismatches, capacity, timeouts, handoff completeness and more.
                  </EmptyState>
                )}
                {issues && issues.length === 0 && (
                  <Callout tone="good" title="No findings">
                    The validator has nothing to complain about at {concurrency.toLocaleString()} concurrent calls. Raise the concurrency, or try deleting a fallback, and run it again.
                  </Callout>
                )}
                {issues?.map((issue, i) => <IssueCard key={i} issue={issue} />)}
              </div>
              {issues && (
                <div className="border-t border-ink-800 p-2 text-2xs text-ink-500">
                  Rules encode real engineering principles; capacities are labelled assumptions. <Assumption />
                </div>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

function IssueCard({ issue }: { issue: ValidationIssue }) {
  const tone = issue.severity === 'error' ? 'bad' : issue.severity === 'warning' ? 'warn' : 'accent'
  return (
    <details className="rounded-md border border-ink-750 bg-ink-850 px-3 py-2" open={issue.severity === 'error'}>
      <summary className="cursor-pointer text-sm text-ink-100">
        <Badge tone={tone as 'bad' | 'warn' | 'accent'}>{issue.severity}</Badge>
        <span className="ml-2">{issue.title}</span>
      </summary>
      <div className="mt-2 space-y-1.5 text-xs text-ink-300">
        <p><span className="font-medium text-ink-200">Detected:</span> {issue.detected}</p>
        <p><span className="font-medium text-ink-200">Why it matters:</span> {issue.why}</p>
        <p><span className="font-medium text-ink-200">Fix:</span> {issue.fix}</p>
        <p className="italic text-ink-500">Principle: {issue.principle}</p>
      </div>
    </details>
  )
}

function EdgeInspector({ edge, arch, onChange, onDelete }: {
  edge: ArchEdge
  arch: { nodes: ArchNode[] }
  onChange: (patch: Partial<ArchEdge>) => void
  onDelete: () => void
}) {
  const src = arch.nodes.find((n) => n.id === edge.source)
  const tgt = arch.nodes.find((n) => n.id === edge.target)
  return (
    <div className="space-y-3">
      <div className="text-sm text-ink-200">
        <span className="font-medium">{src?.label}</span> → <span className="font-medium">{tgt?.label}</span>
      </div>
      <Select label="Plane" value={edge.plane} onChange={(v) => onChange({ plane: v as ArchEdge['plane'] })}
        options={[
          { value: 'media', label: 'Media plane (latency-critical audio)' },
          { value: 'control', label: 'Control plane (state, routing, config)' },
        ]}
        help="Media-plane hops carry audio and are held to real-time deadlines; control-plane hops may be slower but must never block media." />
      <Select label="Connection type" value={edge.type} onChange={(v) => onChange({ type: v as ArchEdge['type'], streaming: v === 'streaming' || v === 'persistent' })}
        options={[
          { value: 'streaming', label: 'Streaming (continuous frames)' },
          { value: 'persistent', label: 'Persistent session' },
          { value: 'sync', label: 'Synchronous request/response' },
          { value: 'async', label: 'Asynchronous event' },
          { value: 'control', label: 'Control / signalling' },
        ]} />
      <Select label="Protocol" value={edge.protocol} onChange={(v) => onChange({ protocol: v as ArchEdge['protocol'] })}
        options={['WebSocket', 'WebRTC', 'HTTP', 'HTTP/2', 'gRPC', 'SIP', 'RTP', 'SRTP', 'PSTN', 'Redis', 'SQL', 'AMQP', 'Kafka', 'TCP', 'UDP', 'internal'].map((p) => ({ value: p as ArchEdge['protocol'], label: p }))} />
      <NumberInput label="Hop latency (ms)" value={edge.latencyMs} min={0} max={500} onChange={(v) => onChange({ latencyMs: v })}
        help="One-way network latency this hop adds. An assumption you control." />
      <button className="btn btn-sm w-full justify-center border-bad/40 text-bad hover:bg-bad/10" onClick={onDelete}>
        Delete connection
      </button>
    </div>
  )
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
