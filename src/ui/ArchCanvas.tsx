/**
 * The shared architecture canvas — a React Flow wrapper that renders an
 * `Architecture` and (in editable mode) lets the user drag, connect, select
 * and delete components. The `Architecture` value in the parent remains the
 * single source of truth; this component translates and reports changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Architecture, ArchEdge, ArchNode, ComponentCategory } from '../domain/types'
import { getSpec } from '../registry/components'

export const CATEGORY_COLORS: Record<ComponentCategory, string> = {
  endpoint: 'rgb(var(--ink-300))',
  telephony: 'rgb(var(--series-amber))',
  transport: 'rgb(var(--media))',
  media: 'rgb(var(--accent))',
  speech: 'rgb(var(--good))',
  intelligence: 'rgb(var(--control))',
  runtime: 'rgb(var(--series-fuchsia))',
  state: 'rgb(var(--series-rose))',
  data: 'rgb(var(--series-orange))',
  infrastructure: 'rgb(var(--series-indigo))',
  observability: 'rgb(var(--series-green))',
  human: 'rgb(var(--series-yellow))',
  external: 'rgb(var(--ink-400))',
}

export interface CanvasHighlights {
  activeNodeIds?: string[]
  failedNodeIds?: string[]
  warnNodeIds?: string[]
  activeEdgeIds?: string[]
  failedEdgeIds?: string[]
  /** nodeId -> small caption below the label (e.g. utilisation). */
  nodeCaptions?: Record<string, string>
}

type ArchNodeData = {
  arch: ArchNode
  caption?: string
  state: 'normal' | 'active' | 'failed' | 'warn' | 'dim'
  [key: string]: unknown
}

function ArchNodeView({ data, selected }: NodeProps<Node<ArchNodeData>>) {
  const spec = getSpec(data.arch.specId)
  const color = CATEGORY_COLORS[spec.category]
  const stateRing =
    data.state === 'active'
      ? 'ring-2 ring-warn shadow-[0_0_18px_rgba(251,191,36,0.35)]'
      : data.state === 'failed'
        ? 'ring-2 ring-bad shadow-[0_0_18px_rgba(248,113,113,0.4)]'
        : data.state === 'warn'
          ? 'ring-2 ring-warn/60'
          : selected
            ? 'ring-2 ring-accent'
            : ''
  return (
    <div
      className={`min-w-[120px] rounded-md border bg-ink-850 px-2.5 py-1.5 text-left transition-shadow ${stateRing} ${
        data.state === 'dim' ? 'opacity-40' : ''
      }`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-xs font-semibold text-ink-100">{data.arch.label}</span>
        {data.arch.replicas > 1 && (
          <span className="ml-auto rounded bg-ink-700 px-1 font-mono text-2xs text-ink-300" title={`${data.arch.replicas} replicas`}>
            ×{data.arch.replicas}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-2xs text-ink-500">
        {spec.category}
        {spec.onMediaPath && <span className="ml-1 text-media" title="On the real-time media path">▮ media</span>}
      </div>
      {data.caption && <div className="mt-0.5 font-mono text-2xs text-warn">{data.caption}</div>}
      {data.state === 'failed' && <div className="mt-0.5 text-2xs font-semibold text-bad">✕ FAILED</div>}
    </div>
  )
}

const nodeTypes = { arch: ArchNodeView }

/** Nominal card size, used to seed React Flow's pre-measurement dimensions. */
const NODE_W = 150
const NODE_H = 52

export function ArchCanvas({
  architecture,
  onChange,
  onSelectNode,
  onSelectEdge,
  highlights = {},
  editable = true,
  fitKey,
}: {
  architecture: Architecture
  onChange?: (a: Architecture) => void
  onSelectNode?: (node: ArchNode | null) => void
  onSelectEdge?: (edge: ArchEdge | null) => void
  highlights?: CanvasHighlights
  editable?: boolean
  /** Change this value to force a re-fit (e.g. after loading a pattern). */
  fitKey?: string | number
}) {
  // Callers build `highlights` inline, so its object identity changes on every
  // render. Memoising on that identity rebuilt every node object continuously,
  // which reset React Flow's measurement pass and left nodes permanently
  // `visibility: hidden`. Depend on the *content* instead.
  const activeKey = (highlights.activeNodeIds ?? []).join(',')
  const failedKey = (highlights.failedNodeIds ?? []).join(',')
  const warnKey = (highlights.warnNodeIds ?? []).join(',')
  const captionKey = JSON.stringify(highlights.nodeCaptions ?? {})
  const activeEdgeKey = (highlights.activeEdgeIds ?? []).join(',')
  const failedEdgeKey = (highlights.failedEdgeIds ?? []).join(',')

  const rfNodes: Node<ArchNodeData>[] = useMemo(
    () => {
      const failed = failedKey ? failedKey.split(',') : []
      const active = activeKey ? activeKey.split(',') : []
      const warn = warnKey ? warnKey.split(',') : []
      const captions: Record<string, string> = JSON.parse(captionKey)
      return architecture.nodes.map((n) => {
        const state: ArchNodeData['state'] = failed.includes(n.id)
          ? 'failed'
          : active.includes(n.id)
            ? 'active'
            : warn.includes(n.id)
              ? 'warn'
              : 'normal'
        return {
          id: n.id,
          type: 'arch',
          position: n.position,
          data: { arch: n, state, caption: captions[n.id] },
          draggable: editable,
          // React Flow hides a node until it has measured it. Seeding the
          // dimensions makes the graph paint on the first frame (and keeps it
          // painted in containers whose measurement pass is unreliable, such as
          // panels that mount at zero height inside a flex/grid layout).
          // React Flow replaces these with real measurements once it has them.
          initialWidth: NODE_W,
          initialHeight: NODE_H,
        }
      })
    },
    [architecture.nodes, activeKey, failedKey, warnKey, captionKey, editable],
  )

  const rfEdges: Edge[] = useMemo(
    () => {
      const activeEdges = activeEdgeKey ? activeEdgeKey.split(',') : []
      const failedEdges = failedEdgeKey ? failedEdgeKey.split(',') : []
      return architecture.edges.map((e) => {
        const cls = [
          e.plane === 'media' ? 'edge-media' : 'edge-control',
          activeEdges.includes(e.id) ? 'edge-active' : '',
          failedEdges.includes(e.id) ? 'edge-failed' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: e.streaming && activeEdges.length === 0,
          className: cls,
          labelStyle: { fill: 'rgb(var(--ink-300))', fontSize: 10 },
          labelBgStyle: { fill: 'rgb(var(--ink-900))', fillOpacity: 0.85 },
          style: { strokeWidth: 1.5 },
        }
      })
    },
    [architecture.edges, activeEdgeKey, failedEdgeKey],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node<ArchNodeData>>[]) => {
      if (!onChange) return
      let nodes = [...architecture.nodes]
      let removedAny = false
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          nodes = nodes.map((n) => (n.id === ch.id ? { ...n, position: { x: ch.position!.x, y: ch.position!.y } } : n))
        } else if (ch.type === 'remove' && editable) {
          nodes = nodes.filter((n) => n.id !== ch.id)
          removedAny = true
        }
      }
      const edges = removedAny
        ? architecture.edges.filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
        : architecture.edges
      onChange({ ...architecture, nodes, edges })
    },
    [architecture, onChange, editable],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!onChange || !editable) return
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removed.length) {
        onChange({ ...architecture, edges: architecture.edges.filter((e) => !removed.includes(e.id)) })
      }
    },
    [architecture, onChange, editable],
  )

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!onChange || !editable || !conn.source || !conn.target) return
      const src = architecture.nodes.find((n) => n.id === conn.source)
      const tgt = architecture.nodes.find((n) => n.id === conn.target)
      if (!src || !tgt) return
      const srcSpec = getSpec(src.specId)
      const tgtSpec = getSpec(tgt.specId)
      const media = srcSpec.onMediaPath && tgtSpec.onMediaPath
      const edge: ArchEdge = {
        id: `e-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
        source: conn.source,
        target: conn.target,
        type: media ? 'streaming' : 'sync',
        protocol: media ? 'WebSocket' : 'HTTP',
        direction: media ? 'bi' : 'uni',
        streaming: media,
        latencyMs: media ? 5 : 2,
        plane: media ? 'media' : 'control',
      }
      onChange({ ...architecture, edges: [...architecture.edges, edge] })
    },
    [architecture, onChange, editable],
  )

  // React Flow's `fitView` prop runs once on mount. Inside a flex/grid layout
  // the container often still measures 0×0 at that moment, which leaves every
  // node translated outside the visible viewport — a canvas that is populated
  // in the DOM but blank on screen. Re-fit once the element has real dimensions,
  // and again whenever it resizes or the graph is swapped.
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [instance, setInstance] = useState<ReactFlowInstance<Node<ArchNodeData>, Edge> | null>(null)

  useEffect(() => {
    const el = wrapperRef.current
    if (!instance || !el) return
    let frame = 0
    const refit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (el.clientWidth > 0 && el.clientHeight > 0) {
          instance.fitView({ padding: 0.15, maxZoom: 1.1 })
        }
      })
    }
    const observer = new ResizeObserver(refit)
    observer.observe(el)
    refit()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [instance, fitKey, architecture.nodes.length])

  return (
    <div ref={wrapperRef} className="h-full w-full">
    <ReactFlow
      key={fitKey}
      onInit={setInstance}
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      onNodeClick={(_, node) => onSelectNode?.(architecture.nodes.find((n) => n.id === node.id) ?? null)}
      onEdgeClick={(_, edge) => onSelectEdge?.(architecture.edges.find((e) => e.id === edge.id) ?? null)}
      onPaneClick={() => {
        onSelectNode?.(null)
        onSelectEdge?.(null)
      }}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
      minZoom={0.2}
      maxZoom={2}
      deleteKeyCode={editable ? ['Backspace', 'Delete'] : []}
      nodesConnectable={editable}
      proOptions={{ hideAttribution: false }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgb(var(--ink-750))" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => CATEGORY_COLORS[getSpec((n.data as ArchNodeData).arch.specId).category]}
        maskColor="rgba(8,11,18,0.75)"
      />
    </ReactFlow>
    </div>
  )
}
