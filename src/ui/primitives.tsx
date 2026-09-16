import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { LAB_BY_ROUTE } from '../nav'
import { useAppStore } from '../state/store'
import { KIND_ACTION, KIND_MEANING, type NumberKind } from '../domain/numbers'

export function Panel({ title, right, children, className = '', pad = true }: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-2 border-b border-ink-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
          {right && <div className="flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

const GUIDE_KEY = 'voice-sim:guide-seen'

function guideSeen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(GUIDE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function markGuideSeen(route: string): void {
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify({ ...guideSeen(), [route]: true }))
  } catch {
    /* storage unavailable — the guide just re-opens next time */
  }
}

/**
 * Page header for every lab.
 *
 * Leads with the *question* the lab answers rather than a paragraph of prose,
 * and tucks the detailed explanation plus a numbered "try this" list into a
 * briefing that opens automatically the first time you visit a lab and stays
 * shut afterwards. First visit gets a tour; the tenth visit gets out of the way.
 */
export function PageHeader({ title, subtitle, question, steps, right }: {
  title: string
  /** Longer explanation — moved into the briefing, not shown up top. */
  subtitle?: ReactNode
  /** One line: what you walk away knowing. Falls back to the nav metadata. */
  question?: string
  /** Concrete first actions, in order. */
  steps?: ReactNode[]
  right?: ReactNode
}) {
  const { pathname } = useLocation()
  const lead = question ?? LAB_BY_ROUTE[pathname]?.question
  const hasBriefing = Boolean(subtitle || steps?.length)
  const [open, setOpen] = useState(() => hasBriefing && !guideSeen()[pathname])

  useEffect(() => {
    if (open) markGuideSeen(pathname)
  }, [open, pathname])

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink-100">{title}</h1>
          {lead && <p className="mt-1 max-w-2xl text-sm text-ink-400">{lead}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right}
          {hasBriefing && (
            <button
              className="btn btn-sm"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              title="How this lab works and what to try first"
            >
              {open ? '✕ Hide guide' : '? How to use this'}
            </button>
          )}
        </div>
      </div>

      {hasBriefing && open && (
        <div className="mt-3 animate-slide-in rounded-lg border border-accent/25 bg-accent/[0.04] p-4">
          {subtitle && <div className="max-w-3xl text-sm leading-relaxed text-ink-300">{subtitle}</div>}
          {steps && steps.length > 0 && (
            <div className={subtitle ? 'mt-3' : ''}>
              <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-accent">Try this first</div>
              <ol className="space-y-1.5">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-ink-200">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-deep/50 font-mono text-2xs text-accent">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The same briefing as PageHeader's, as a popover — for full-bleed tool pages
 * (the canvas) that cannot spare a header block but still owe a first-time
 * visitor an explanation.
 */
export function LabGuide({ title, steps, note }: { title?: string; steps: ReactNode[]; note?: ReactNode }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(() => !guideSeen()[pathname])

  useEffect(() => {
    if (open) markGuideSeen(pathname)
  }, [open, pathname])

  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? '✕ Hide guide' : '? How to use this'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(28rem,80vw)] animate-slide-in rounded-lg border border-accent/30 bg-ink-900 p-4 shadow-2xl">
          {title && <div className="mb-1.5 text-sm font-semibold text-ink-100">{title}</div>}
          {note && <p className="mb-3 text-sm leading-relaxed text-ink-400">{note}</p>}
          <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-accent">Try this first</div>
          <ol className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-ink-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-deep/50 font-mono text-2xs text-accent">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

/**
 * A collapsible section. Labs with a long tail of parameters put the tail in
 * here so the page opens with only the controls that teach something.
 * `defaultOpen` is overridden by Engineering detail mode when `advanced` is set.
 */
export function Disclosure({ summary, hint, children, defaultOpen = false, advanced = false, className = '' }: {
  summary: ReactNode
  hint?: string
  children: ReactNode
  defaultOpen?: boolean
  /** Marks this as detail-mode content: open by default in Engineering mode. */
  advanced?: boolean
  className?: string
}) {
  const engineering = useAppStore((s) => s.viewMode) === 'engineering'
  const [open, setOpen] = useState(defaultOpen || (advanced && engineering))
  const [touched, setTouched] = useState(false)

  // Flipping the global detail switch re-opens/closes advanced sections the
  // learner has not manually overridden — that is what makes the switch real.
  useEffect(() => {
    if (advanced && !touched) setOpen(defaultOpen || engineering)
  }, [advanced, engineering, defaultOpen, touched])

  return (
    <div className={`panel overflow-hidden ${className}`}>
      <button
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-ink-850"
        onClick={() => {
          setTouched(true)
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        title={hint}
      >
        <span className={`text-xs text-ink-500 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-sm font-semibold text-ink-100">{summary}</span>
        {hint && !open && <span className="ml-auto truncate text-2xs text-ink-500">{hint}</span>}
      </button>
      {open && <div className="border-t border-ink-800 p-4">{children}</div>}
    </div>
  )
}

/**
 * Named experiments. Each one sets the controls to a configuration that makes
 * a specific point, so a learner can see the lesson before understanding the
 * knobs — the single biggest difference between a toy and a teaching tool.
 */
export function Experiments<T extends string>({ title = 'Experiments', items, active, onPick }: {
  title?: string
  items: { id: T; label: string; teaches: string }[]
  active?: T | null
  onPick: (id: T) => void
}) {
  return (
    <div className="panel p-3">
      <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-500">{title}</div>
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => onPick(it.id)}
            className={`rounded-md border px-3 py-2 text-left transition-colors ${
              active === it.id
                ? 'border-accent-dim bg-accent-deep/25'
                : 'border-ink-750 bg-ink-850 hover:border-ink-600 hover:bg-ink-800'
            }`}
          >
            <div className={`text-sm font-medium ${active === it.id ? 'text-accent' : 'text-ink-100'}`}>{it.label}</div>
            <div className="mt-0.5 text-xs leading-snug text-ink-400">{it.teaches}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

/** The one thing the learner should take away from what is on screen. */
export function Takeaway({ children, title = 'What this shows' }: { children: ReactNode; title?: string }) {
  return (
    <div className="rounded-lg border border-good/25 bg-good/[0.05] px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-good">
        <span>◆</span>
        {title}
      </div>
      <div className="text-sm leading-relaxed text-ink-200">{children}</div>
    </div>
  )
}

export function Stat({ label, value, unit, tone = 'default', hint }: {
  label: string
  value: ReactNode
  unit?: string
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent'
  hint?: string
}) {
  const tones = {
    default: 'text-ink-100',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
    accent: 'text-accent',
  }
  return (
    <div className="panel px-3 py-2.5" title={hint}>
      <div className="flex items-center gap-1 text-2xs font-medium text-ink-500">
        <span className="truncate">{label}</span>
        {hint && <span className="shrink-0 cursor-help text-ink-600">ⓘ</span>}
      </div>
      <div className={`mt-0.5 font-mono text-lg font-semibold ${tones[tone]}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-ink-400">{unit}</span>}
      </div>
    </div>
  )
}

export function Badge({ children, tone = 'neutral', title }: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'media' | 'control'
  title?: string
}) {
  const tones = {
    neutral: 'border-ink-600 bg-ink-800 text-ink-300',
    good: 'border-good/40 bg-good/10 text-good',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    bad: 'border-bad/40 bg-bad/10 text-bad',
    accent: 'border-accent/40 bg-accent/10 text-accent',
    media: 'border-media/40 bg-media/10 text-media',
    control: 'border-control/40 bg-control/10 text-control',
  }
  return (
    <span className={`chip ${tones[tone]}`} title={title}>
      {children}
    </span>
  )
}

/** Marks a number as a simulation assumption — used everywhere per the brief. */
export function Assumption({ children = 'Simulation assumption' }: { children?: ReactNode }) {
  return (
    <span
      className="chip border-ink-600 bg-ink-850 italic text-ink-500"
      title="This value is an editable modelling assumption, not a measured fact about any vendor or production system. The relationships between values are the lesson."
    >
      ≈ {children}
    </span>
  )
}

export function KV({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-ink-500">{it.k}</dt>
          <dd className="text-ink-200">{it.v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Callout({ tone = 'info', title, children }: {
  tone?: 'info' | 'warn' | 'bad' | 'good'
  title?: ReactNode
  children: ReactNode
}) {
  const tones = {
    info: 'border-accent/30 bg-accent/5',
    warn: 'border-warn/30 bg-warn/5',
    bad: 'border-bad/30 bg-bad/5',
    good: 'border-good/30 bg-good/5',
  }
  const icons = { info: 'ℹ', warn: '⚠', bad: '✕', good: '✓' }
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>
      {title && (
        <div className="mb-0.5 font-medium text-ink-100">
          <span className="mr-1.5">{icons[tone]}</span>
          {title}
        </div>
      )}
      <div className="text-ink-300">{children}</div>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-ink-700 p-6 text-center text-sm text-ink-500">
      {children}
    </div>
  )
}

export function fmtMs(ms: number): string {
  if (!isFinite(ms)) return '—'
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)} s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.round(ms)} ms`
}

export function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${Math.round(b)} B`
}

export function fmtUsd(v: number, digits = 2): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function fmtNum(v: number): string {
  return v.toLocaleString()
}

// ---------------------------------------------------------------------------
// Number provenance
// ---------------------------------------------------------------------------

/**
 * Where a number came from, as a chip you can put beside it.
 *
 * V1 labelled everything "simulation assumption", which was honest and
 * flattening: learners tune an assumption, look up a reference and reproduce a
 * measurement, and calling all three the same thing taught them to discount all
 * three. See domain/numbers.ts for the distinction.
 *
 * The glyph differs as well as the colour, so the three are separable without
 * relying on hue.
 */
export function NumberChip({ kind, source, seed, children }: {
  kind: NumberKind
  /** The standard, the seed, or the reasoning behind the guess. */
  source?: string
  seed?: string
  children?: ReactNode
}) {
  const style: Record<NumberKind, { cls: string; glyph: string; word: string }> = {
    ASSUMPTION: { cls: 'border-ink-600 bg-ink-850 text-ink-400', glyph: '≈', word: 'assumption' },
    REFERENCE: { cls: 'border-control/40 bg-control/10 text-control', glyph: '§', word: 'reference' },
    MEASURED: { cls: 'border-media/40 bg-media/10 text-media', glyph: '◉', word: 'measured' },
  }
  const s = style[kind]
  return (
    <span
      className={`chip ${s.cls}`}
      title={`${KIND_MEANING[kind]}\n\nWhat to do with it: ${KIND_ACTION[kind]}${source ? `\n\nSource: ${source}` : ''}${
        seed ? `\nSeed: ${seed}` : ''
      }`}
    >
      <span aria-hidden>{s.glyph}</span>
      {children ?? s.word}
    </span>
  )
}

/** The three-kind legend, for labs that show all of them at once. */
export function ProvenanceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-ink-500">
      <span>Numbers on this page are:</span>
      {(['ASSUMPTION', 'REFERENCE', 'MEASURED'] as NumberKind[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5">
          <NumberChip kind={k} />
          <span className="hidden xl:inline">{KIND_ACTION[k]}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * A three-way verdict pill: holds / degrades / breaks.
 *
 * Used by the pressure tests and anywhere else with the same trichotomy. The
 * word is the signal; the colour is reinforcement.
 */
export function Verdict({ value, size = 'md' }: { value: 'holds' | 'degrades' | 'breaks'; size?: 'sm' | 'md' }) {
  const map = {
    holds: { cls: 'tone-good', glyph: '✓', label: 'Holds' },
    degrades: { cls: 'tone-warn', glyph: '▲', label: 'Degrades' },
    breaks: { cls: 'tone-bad', glyph: '✕', label: 'Breaks' },
  } as const
  const v = map[value]
  return (
    <span className={`chip ${v.cls} ${size === 'md' ? 'px-2.5 py-1 text-xs' : ''}`}>
      <span aria-hidden>{v.glyph}</span>
      {v.label}
    </span>
  )
}

/** PASS / PARTIAL / FAIL, for the evaluation suite. */
export function VerdictTag({ value }: { value: 'PASS' | 'PARTIAL' | 'FAIL' }) {
  const map = {
    PASS: 'tone-good',
    PARTIAL: 'tone-warn',
    FAIL: 'tone-bad',
  } as const
  return <span className={`chip ${map[value]} font-mono`}>{value}</span>
}

/**
 * A horizontal proportion bar with its value written out.
 *
 * Bars are read faster than numbers and numbers are read more precisely than
 * bars, so both appear. `tone` is chosen by the caller because "high is bad"
 * for utilisation and "high is good" for coverage.
 */
export function Meter({ value, label, tone = 'accent', caption }: {
  /** 0..1. Values above 1 overflow the track deliberately — saturation is visible. */
  value: number
  label?: ReactNode
  tone?: 'accent' | 'good' | 'warn' | 'bad'
  caption?: ReactNode
}) {
  const pct = Math.max(0, Math.min(1.25, value)) * 100
  const fill = { accent: 'bg-accent', good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' }[tone]
  return (
    <div>
      {(label || caption) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-2xs">
          <span className="text-ink-400">{label}</span>
          <span className="font-mono text-ink-500">{caption}</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

/** A quiet heading for a group of controls inside a panel. */
export function SectionLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-500" title={hint}>
      {children}
      {hint && <span className="cursor-help text-ink-600">ⓘ</span>}
    </div>
  )
}
