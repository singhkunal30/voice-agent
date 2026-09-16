import type { ReactNode } from 'react'

export function Slider({ label, value, onChange, min, max, step = 1, unit = '', format, help }: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  format?: (v: number) => string
  help?: string
}) {
  return (
    <div title={help}>
      <div className="flex items-baseline justify-between">
        <label className="label !mb-0">{label}</label>
        <span className="font-mono text-xs text-accent">
          {format ? format(value) : `${value.toLocaleString()}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      <input
        type="range"
        className="mt-1 w-full accent-sky-400"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  )
}

export function Toggle({ label, checked, onChange, help }: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  help?: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink-200" title={help}>
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent-deep' : 'bg-ink-700'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-100 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}

export function Select<T extends string>({ label, value, onChange, options, help }: {
  label?: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  help?: string
}) {
  return (
    <div title={help}>
      {label && <label className="label">{label}</label>}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function NumberInput({ label, value, onChange, min, max, step = 1, unit, help }: {
  label?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  help?: string
}) {
  return (
    <div title={help}>
      {label && <label className="label">{label}</label>}
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          className="input"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
        />
        {unit && <span className="shrink-0 text-xs text-ink-500">{unit}</span>}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; title?: string }[]
  ariaLabel?: string
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-ink-700 text-xs" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          className={`px-2.5 py-1.5 transition-colors ${
            value === o.value ? 'bg-accent-deep/50 text-accent' : 'bg-ink-850 text-ink-400 hover:text-ink-200'
          }`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
