import { useState } from 'react'
import type { LatencyBreakdown, LatencySegment } from '../domain/types'
import { Assumption, Badge, fmtMs } from './primitives'

const STAGE_COLORS: Record<LatencySegment['stage'], string> = {
  network: 'rgb(var(--ink-500))',
  audio: 'rgb(var(--media))',
  detect: 'rgb(var(--warn))',
  stt: 'rgb(var(--accent))',
  llm: 'rgb(var(--control))',
  tool: 'rgb(var(--series-pink))',
  tts: 'rgb(var(--good))',
  playback: 'rgb(var(--ink-300))',
}

/**
 * The latency waterfall: each segment positioned at its start offset from end
 * of user speech, so overlap and serialization are visually obvious. Click a
 * segment to read where that time comes from.
 */
export function LatencyWaterfall({ breakdown, showBudget = true }: { breakdown: LatencyBreakdown; showBudget?: boolean }) {
  const [selected, setSelected] = useState<LatencySegment | null>(null)
  const total = Math.max(breakdown.perceivedLatencyMs, breakdown.budgetMs * 1.05, 1)
  const budgetPct = (breakdown.budgetMs / total) * 100

  return (
    <div>
      <div className="relative">
        {/* Budget line */}
        {showBudget && (
          <div
            className="absolute bottom-0 top-0 z-10 border-l-2 border-dashed border-warn/70"
            style={{ left: `${budgetPct}%` }}
            title={`Latency budget: ${breakdown.budgetMs} ms`}
          >
            <span className="absolute -top-0.5 left-1 whitespace-nowrap text-2xs text-warn">
              budget {breakdown.budgetMs} ms
            </span>
          </div>
        )}
        <div className="space-y-1 pt-4">
          {breakdown.segments.map((seg) => {
            const left = (seg.startMs / total) * 100
            const width = Math.max((seg.ms / total) * 100, 0.8)
            return (
              <div key={seg.key} className="group flex items-center gap-2">
                <div className="w-44 shrink-0 truncate text-right text-xs text-ink-400" title={seg.label}>
                  {seg.label}
                </div>
                <div className="relative h-5 flex-1 rounded-sm bg-ink-900">
                  <button
                    className={`absolute h-full rounded-sm transition-all hover:brightness-125 ${
                      selected?.key === seg.key ? 'ring-2 ring-white/60' : ''
                    }`}
                    style={{ left: `${left}%`, width: `${width}%`, background: STAGE_COLORS[seg.stage] }}
                    onClick={() => setSelected(selected?.key === seg.key ? null : seg)}
                    title={`${seg.label}: ${fmtMs(seg.ms)} — click for explanation`}
                  />
                </div>
                <div className="w-16 shrink-0 text-right font-mono text-xs text-ink-300">{fmtMs(seg.ms)}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-400">Perceived latency (end of speech → first agent audio):</span>
        <span className={`font-mono text-base font-semibold ${breakdown.withinBudget ? 'text-good' : 'text-bad'}`}>
          {fmtMs(breakdown.perceivedLatencyMs)}
        </span>
        <Badge tone={breakdown.withinBudget ? 'good' : 'bad'}>
          {breakdown.withinBudget ? 'within budget' : `${fmtMs(breakdown.perceivedLatencyMs - breakdown.budgetMs)} over budget`}
        </Badge>
        <Assumption />
      </div>

      {selected && (
        <div className="mt-3 animate-slide-in rounded-md border border-ink-750 bg-ink-850 p-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: STAGE_COLORS[selected.stage] }} />
            <span className="text-sm font-medium text-ink-100">{selected.label}</span>
            <span className="font-mono text-xs text-ink-400">
              {fmtMs(selected.ms)} · starts at +{fmtMs(selected.startMs)}
            </span>
          </div>
          <p className="text-sm text-ink-300">{selected.explanation}</p>
        </div>
      )}

      {breakdown.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-ink-500">
          {breakdown.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LatencyMilestones({ breakdown }: { breakdown: LatencyBreakdown }) {
  const rows = [
    { label: 'Time to first transcript (from speech start)', v: breakdown.timeToFirstTranscriptMs, hint: 'Streaming STT emits its first partial while the user is still talking. Batch STT never does (—).' },
    { label: 'Time to final transcript (from speech end)', v: breakdown.timeToFinalTranscriptMs, hint: 'When the committed text became available.' },
    { label: 'Time to first LLM token', v: breakdown.timeToFirstLlmTokenMs, hint: 'From speech end: turn gate + prefill.' },
    { label: 'Time to first TTS audio', v: breakdown.timeToFirstTtsAudioMs, hint: 'From speech end: the reply exists as sound, server-side.' },
    { label: 'Perceived conversational latency', v: breakdown.perceivedLatencyMs, hint: 'From speech end to first audio AT THE USER. The only number the caller feels.' },
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {rows.map((r) => (
        <div key={r.label} className="panel px-3 py-2" title={r.hint}>
          <div className="text-2xs uppercase tracking-wide text-ink-500">{r.label}</div>
          <div className="mt-0.5 font-mono text-base font-semibold text-ink-100">
            {r.v < 0 ? '—' : fmtMs(r.v)}
          </div>
        </div>
      ))}
    </div>
  )
}
