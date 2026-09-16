/**
 * Programmatic architecture construction.
 *
 * A tiny DSL used by the pattern library, the decision engine and tests to
 * build `Architecture` values without hand-writing node coordinates. Layout is
 * columnar left-to-right in pipeline order, which reads naturally on the
 * canvas: user/edge on the left, intelligence in the middle, state on the
 * right, platform along the bottom.
 */

import type { Architecture, ArchEdge, ArchNode, ConnectionType, Plane, Protocol, Requirements } from './types'
import { getSpec } from '../registry/components'

let edgeCounter = 0

export interface NodeOpts {
  id?: string
  label?: string
  replicas?: number
  config?: Record<string, number | boolean | string>
  col?: number
  row?: number
  region?: ArchNode['region']
}

export class ArchBuilder {
  private nodes: ArchNode[] = []
  private edges: ArchEdge[] = []
  private assumptions: string[] = []
  private autoCol = 0

  constructor(
    private id: string,
    private name: string,
    private description: string,
    private requirements?: Requirements,
  ) {}

  node(specId: string, opts: NodeOpts = {}): string {
    const spec = getSpec(specId)
    const id = opts.id ?? `${specId}${this.nodes.some((n) => n.specId === specId) ? '-' + (this.nodes.filter((n) => n.specId === specId).length + 1) : ''}`
    const col = opts.col ?? this.autoCol++
    const row = opts.row ?? 0
    this.nodes.push({
      id,
      specId,
      label: opts.label ?? spec.short,
      // Column/row pitch is deliberately tight: architectures run 8–9 columns
      // wide, and a wider pitch forces the canvas to fit-zoom below readability.
      position: { x: 50 + col * 185, y: 70 + row * 120 },
      config: { ...Object.fromEntries((spec.config ?? []).map((c) => [c.key, c.default])), ...(opts.config ?? {}) },
      replicas: opts.replicas ?? 1,
      region: opts.region,
    })
    return id
  }

  connect(
    source: string,
    target: string,
    opts: Partial<Omit<ArchEdge, 'id' | 'source' | 'target'>> = {},
  ): this {
    const srcNode = this.nodes.find((n) => n.id === source)
    const tgtNode = this.nodes.find((n) => n.id === target)
    if (!srcNode || !tgtNode) throw new Error(`connect: unknown node ${!srcNode ? source : target}`)
    const srcSpec = getSpec(srcNode.specId)
    const tgtSpec = getSpec(tgtNode.specId)
    const plane: Plane =
      opts.plane ?? (srcSpec.onMediaPath && tgtSpec.onMediaPath ? 'media' : 'control')
    this.edges.push({
      id: `e${edgeCounter++}`,
      source,
      target,
      type: opts.type ?? (plane === 'media' ? 'streaming' : 'sync'),
      protocol: opts.protocol ?? defaultProtocol(srcNode.specId, tgtNode.specId, plane),
      direction: opts.direction ?? (plane === 'media' ? 'bi' : 'uni'),
      streaming: opts.streaming ?? plane === 'media',
      latencyMs: opts.latencyMs ?? (plane === 'media' ? 5 : 2),
      bandwidthKbps: opts.bandwidthKbps,
      label: opts.label,
      plane,
    })
    return this
  }

  /** Convenience: connect a linear chain of node ids. */
  chain(ids: string[], opts: Partial<Omit<ArchEdge, 'id' | 'source' | 'target'>> = {}): this {
    for (let i = 0; i < ids.length - 1; i++) this.connect(ids[i], ids[i + 1], opts)
    return this
  }

  assume(...notes: string[]): this {
    this.assumptions.push(...notes)
    return this
  }

  build(): Architecture {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      nodes: this.nodes,
      edges: this.edges,
      assumptions: this.assumptions,
      requirements: this.requirements,
      version: 1,
    }
  }
}

function defaultProtocol(srcSpec: string, tgtSpec: string, plane: Plane): Protocol {
  const pair = `${srcSpec}->${tgtSpec}`
  if (pair.includes('user->telephony') || pair.includes('telephony->user')) return 'PSTN'
  if (srcSpec === 'browser' || tgtSpec === 'browser') return 'WebRTC'
  if (srcSpec === 'telephony' || tgtSpec === 'telephony') return 'WebSocket'
  if (tgtSpec === 'stt' || srcSpec === 'stt' || tgtSpec === 'tts' || srcSpec === 'tts') return 'WebSocket'
  if (tgtSpec === 'llm' || srcSpec === 'llm' || tgtSpec === 's2s') return 'HTTP/2'
  if (tgtSpec === 'redis' || srcSpec === 'redis') return 'Redis'
  if (tgtSpec === 'postgres' || srcSpec === 'postgres') return 'SQL'
  if (tgtSpec === 'kafka' || srcSpec === 'kafka') return 'Kafka'
  if (tgtSpec === 'queue' || srcSpec === 'queue') return 'AMQP'
  if (plane === 'media') return 'WebSocket'
  return 'HTTP'
}

/** Deep-clone an architecture (for editing patterns without mutating the library). */
export function cloneArchitecture(arch: Architecture, newId?: string): Architecture {
  const copy: Architecture = JSON.parse(JSON.stringify(arch))
  if (newId) copy.id = newId
  return copy
}

export type EdgeType = ConnectionType
