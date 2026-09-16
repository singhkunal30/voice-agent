import type { ReactNode } from 'react'

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

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-ink-100">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-400">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
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
      <div className="text-2xs font-medium uppercase tracking-wider text-ink-500">{label}</div>
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
