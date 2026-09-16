import { useEffect, useRef, useState } from 'react'
import type { SimEvent } from '../domain/types'
import { Badge, fmtBytes, fmtMs, KV } from './primitives'

const STATUS_TONE: Record<SimEvent['status'], string> = {
  ok: 'text-ink-200',
  info: 'text-accent',
  warn: 'text-warn',
  error: 'text-bad',
}

const STATUS_DOT: Record<SimEvent['status'], string> = {
  ok: 'bg-ink-500',
  info: 'bg-accent',
  warn: 'bg-warn',
  error: 'bg-bad',
}

/**
 * The event timeline: every simulated event, in order, with plane, payload
 * and duration. Click an event to inspect its full detail. Autoscrolls during
 * playback.
 */
export function EventTimeline({ events, autoScroll = true, height = 'h-[420px]', emptyHint }: {
  events: SimEvent[]
  autoScroll?: boolean
  height?: string
  emptyHint?: string
}) {
  const [selected, setSelected] = useState<SimEvent | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [events.length, autoScroll])

  return (
    <div className={`grid gap-3 ${selected ? 'lg:grid-cols-[1fr,320px]' : ''}`}>
      <div ref={listRef} className={`${height} overflow-y-auto rounded-md border border-ink-800 bg-ink-950 font-mono text-xs`}>
        {events.length === 0 && (
          <div className="flex h-full items-center justify-center p-6 text-center font-sans text-sm text-ink-500">
            {emptyHint ?? 'Press ▶ Start to play the simulated call.'}
          </div>
        )}
        <table className="w-full border-collapse">
          <tbody>
            {events.map((e) => (
              <tr
                key={e.seq}
                onClick={() => setSelected(selected?.seq === e.seq ? null : e)}
                className={`cursor-pointer border-b border-ink-900 align-top transition-colors hover:bg-ink-900 ${
                  selected?.seq === e.seq ? 'bg-ink-850' : ''
                }`}
              >
                <td className="whitespace-nowrap py-1 pl-2 pr-2 text-right tabular-nums text-ink-500">
                  {(e.t / 1000).toFixed(3)}s
                </td>
                <td className="py-1 pr-1">
                  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[e.status]}`} />
                  <span className={e.plane === 'media' ? 'text-media' : 'text-control'} title={`${e.plane} plane`}>
                    {e.plane === 'media' ? '▮' : '▯'}
                  </span>
                </td>
                <td className="whitespace-nowrap py-1 pr-2 text-ink-400">{e.type}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-ink-500">{e.component}</td>
                <td className={`py-1 pr-2 ${STATUS_TONE[e.status]}`}>{e.summary}</td>
                <td className="whitespace-nowrap py-1 pr-2 text-right text-ink-600">
                  {e.durationMs !== undefined && `${Math.round(e.durationMs)}ms`}
                  {e.bytes !== undefined && ` ${fmtBytes(e.bytes)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <aside className="panel-pad h-fit animate-slide-in lg:sticky lg:top-0">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-mono text-xs text-ink-500">event #{selected.seq}</div>
              <h3 className="text-sm font-semibold text-ink-100">{selected.type}</h3>
            </div>
            <button className="text-ink-500 hover:text-ink-200" onClick={() => setSelected(null)} aria-label="Close event inspector">
              ✕
            </button>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <Badge tone={selected.plane === 'media' ? 'media' : 'control'}>{selected.plane} plane</Badge>
            <Badge tone={selected.status === 'error' ? 'bad' : selected.status === 'warn' ? 'warn' : 'neutral'}>
              {selected.status}
            </Badge>
          </div>
          <p className="mb-3 text-sm text-ink-200">{selected.summary}</p>
          <KV
            items={[
              { k: 'Timestamp', v: <span className="font-mono">{fmtMs(selected.t)}</span> },
              { k: 'Component', v: selected.component },
              ...(selected.durationMs !== undefined ? [{ k: 'Duration', v: <span className="font-mono">{fmtMs(selected.durationMs)}</span> }] : []),
              ...(selected.payloadType ? [{ k: 'Payload', v: selected.payloadType }] : []),
              ...(selected.bytes !== undefined ? [{ k: 'Size', v: <span className="font-mono">{fmtBytes(selected.bytes)}</span> }] : []),
              ...(selected.spanId ? [{ k: 'Span', v: <span className="font-mono">{selected.spanId}</span> }] : []),
            ]}
          />
          {selected.detail && (
            <div className="mt-3 rounded-md bg-ink-950 p-2.5">
              <div className="label">Detail</div>
              <dl className="space-y-1 text-xs">
                {Object.entries(selected.detail).map(([k, v]) => (
                  <div key={k}>
                    <dt className="inline font-medium text-ink-400">{k}: </dt>
                    <dd className="inline text-ink-200">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </aside>
      )}
    </div>
  )
}
