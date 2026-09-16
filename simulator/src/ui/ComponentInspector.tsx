/**
 * The component inspection panel: everything the brief demands when a
 * component is clicked — what it is, the problem it solves, I/O, protocols,
 * formats, latency, scaling, failure modes, alternatives, why an architect
 * chooses it, what happens when it fails — plus the six learning levels and
 * (in editable mode) the live configuration knobs.
 */

import { useMemo, useState } from 'react'
import type { ArchNode } from '../domain/types'
import { getSpec } from '../registry/components'
import { formatLabel } from '../models/audio'
import { Assumption, Badge, KV, fmtMs, fmtUsd } from './primitives'
import { LearnBox } from './LearnBox'
import { NumberInput, Select, Toggle } from './controls'
import { useAppStore } from '../state/store'
import { removalConsequence } from '../models/whatIf'

export function ComponentInspector({
  node,
  onClose,
  onConfigChange,
  onReplicasChange,
  onDelete,
}: {
  node: ArchNode
  onClose: () => void
  onConfigChange?: (key: string, value: number | boolean | string) => void
  onReplicasChange?: (replicas: number) => void
  onDelete?: () => void
}) {
  const spec = getSpec(node.specId)
  const viewMode = useAppStore((s) => s.viewMode)
  const engineering = viewMode === 'engineering'
  const arch = useAppStore((s) => s.workingArchitecture)
  const requirements = useAppStore((s) => s.activeRequirements)
  const [whatIfOpen, setWhatIfOpen] = useState(false)

  // Computed only when asked for: the removal analysis re-runs the validator
  // and the cost model, and the inspector opens on every node click.
  const consequence = useMemo(() => {
    if (!whatIfOpen) return null
    try {
      return removalConsequence(arch, node.id, requirements ?? undefined)
    } catch {
      // The node is not in the working architecture (a pattern preview, say).
      return null
    }
  }, [whatIfOpen, arch, node.id, requirements])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-ink-800 p-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-100">{spec.name}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>{spec.category}</Badge>
            <Badge tone={spec.plane === 'media' ? 'media' : spec.plane === 'control' ? 'control' : 'neutral'}>
              {spec.plane} plane
            </Badge>
            {spec.onMediaPath && <Badge tone="media" title="Latency-critical: audio flows through here">real-time path</Badge>}
          </div>
        </div>
        <button className="text-ink-500 hover:text-ink-200" onClick={onClose} aria-label="Close inspector">✕</button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section>
          <h3 className="label">What is it?</h3>
          <p className="text-sm text-ink-200">{spec.description}</p>
        </section>

        {/* Subtraction teaches what addition cannot. Every box on a diagram
            looks necessary because it is there; the only way to find out which
            ones are load-bearing is to take one away. */}
        <section className="rounded-md border border-ink-750 bg-ink-850/40 p-2.5">
          <button
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setWhatIfOpen((o) => !o)}
            aria-expanded={whatIfOpen}
          >
            <span className={`text-xs text-ink-500 transition-transform ${whatIfOpen ? 'rotate-90' : ''}`} aria-hidden>
              ▶
            </span>
            <span className="text-sm font-semibold text-ink-100">What if this were not here?</span>
          </button>
          {whatIfOpen &&
            (consequence ? (
              <div className="mt-2.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`chip ${
                      consequence.severity === 'fatal'
                        ? 'tone-bad'
                        : consequence.severity === 'degraded'
                          ? 'tone-warn'
                          : 'tone-neutral'
                    }`}
                  >
                    {consequence.severity === 'fatal'
                      ? '✕ load-bearing'
                      : consequence.severity === 'degraded'
                        ? '▲ costly to remove'
                        : '· removable here'}
                  </span>
                  {consequence.costDeltaPerMonth < 0 && (
                    <span className="chip tone-good">saves {fmtUsd(-consequence.costDeltaPerMonth, 0)}/mo</span>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-ink-200">{consequence.headline}</p>
                <div>
                  <h4 className="label">What stops working</h4>
                  <ul className="space-y-1">
                    {consequence.breaks.map((b, i) => (
                      <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-300">
                        <span className="text-bad" aria-hidden>
                          ✕
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="label">What genuinely improves</h4>
                  <ul className="space-y-1">
                    {consequence.gains.map((g, i) => (
                      <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-400">
                        <span className="text-good" aria-hidden>
                          ✓
                        </span>
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="label">What you would do instead</h4>
                  <p className="text-xs leading-relaxed text-ink-300">{consequence.insteadYouWould}</p>
                </div>
                {consequence.newIssues.length > 0 && (
                  <div>
                    <h4 className="label">Rules this removal would break</h4>
                    <ul className="space-y-1">
                      {consequence.newIssues.slice(0, 4).map((issue) => (
                        <li key={issue.ruleId} className="text-xs leading-relaxed text-ink-400">
                          <b className="text-ink-200">{issue.title}</b> — {issue.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {consequence.shiftsLoadTo.length > 0 && (
                  <p className="text-2xs leading-relaxed text-ink-500">
                    Load this component absorbed moves to: {consequence.shiftsLoadTo.join(', ')}.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-500">
                This component is not part of the working architecture, so there is nothing to remove it from. Open it
                on the canvas to run the analysis.
              </p>
            ))}
        </section>

        <section>
          <h3 className="label">What problem does it solve?</h3>
          <p className="text-sm text-ink-300">{spec.problemSolved}</p>
        </section>

        <LearnBox learn={spec.learn} compact />

        <section>
          <h3 className="label">Interface</h3>
          <KV
            items={[
              { k: 'Input', v: spec.inputs.join(' · ') },
              { k: 'Output', v: spec.outputs.join(' · ') },
              { k: 'Protocols', v: spec.protocols.join(', ') },
              ...(spec.audioIn ? [{ k: 'Audio in', v: formatLabel(spec.audioIn) }] : []),
              ...(spec.audioOut ? [{ k: 'Audio out', v: formatLabel(spec.audioOut) }] : []),
            ]}
          />
        </section>

        <section>
          <h3 className="label">Typical latency <Assumption /></h3>
          <KV
            items={[
              { k: 'Fixed', v: fmtMs(spec.latency.fixedMs) },
              ...(spec.latency.firstByteMs ? [{ k: 'First output', v: fmtMs(spec.latency.firstByteMs) }] : []),
              ...(spec.latency.perUnitMs ? [{ k: `Per ${spec.latency.unit}`, v: `${spec.latency.perUnitMs} ms` }] : []),
              ...(spec.latency.jitterMs ? [{ k: 'Jitter', v: `±${spec.latency.jitterMs} ms` }] : []),
              { k: 'Streaming', v: spec.latency.streamingCapable ? 'yes — emits output before input completes' : 'no' },
            ]}
          />
        </section>

        <section>
          <h3 className="label">Scaling</h3>
          <KV
            items={[
              { k: 'Model', v: spec.scaling.axis },
              { k: 'Capacity / instance', v: <span>{spec.scaling.capacityPerInstance.toLocaleString()} <Assumption /></span> },
              ...(spec.scaling.warmupSeconds ? [{ k: 'Warmup', v: `${spec.scaling.warmupSeconds}s` }] : []),
              ...(spec.scaling.stickySessions ? [{ k: 'Sessions', v: 'sticky — connections pin to instances' }] : []),
            ]}
          />
          {engineering && spec.scaling.notes && <p className="mt-1.5 text-xs text-ink-400">{spec.scaling.notes}</p>}
        </section>

        <section>
          <h3 className="label">Failure modes</h3>
          <div className="space-y-2">
            {spec.failureModes.map((f) => (
              <details key={f.id} className="rounded-md border border-ink-750 bg-ink-850 px-2.5 py-1.5">
                <summary className="cursor-pointer text-sm text-ink-200">
                  <Badge tone="bad">{f.kind}</Badge> <span className="ml-1">{f.name}</span>
                </summary>
                <div className="mt-2 space-y-1.5 text-xs">
                  <p><span className="font-medium text-ink-300">Caller experiences:</span> <span className="text-ink-400">{f.callerImpact}</span></p>
                  <p><span className="font-medium text-ink-300">You see:</span> <span className="text-ink-400">{f.signal}</span></p>
                  <p className="font-medium text-ink-300">Mitigations:</p>
                  <ul className="ml-4 list-disc text-ink-400">
                    {f.mitigations.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </section>

        <section>
          <h3 className="label">Why would an architect choose it?</h3>
          <p className="text-sm text-ink-300">{spec.whyChoose}</p>
        </section>

        <section>
          <h3 className="label">What happens if it fails?</h3>
          <p className="text-sm text-ink-300">{spec.ifItFails}</p>
        </section>

        {spec.alternatives.length > 0 && (
          <section>
            <h3 className="label">Alternatives</h3>
            <ul className="ml-4 list-disc text-sm text-ink-300">
              {spec.alternatives.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </section>
        )}

        {(onConfigChange || onReplicasChange) && (
          <section className="rounded-md border border-accent/20 bg-accent/5 p-3">
            <h3 className="label">Configuration (drives the simulation)</h3>
            <div className="space-y-3">
              {onReplicasChange && spec.category !== 'endpoint' && (
                <NumberInput label="Replicas" value={node.replicas} min={1} max={500} onChange={onReplicasChange}
                  help="How many instances of this component run. Drives capacity, cost and blast radius." />
              )}
              {spec.config?.map((f) => {
                const current = node.config[f.key] ?? f.default
                if (f.type === 'select') {
                  return (
                    <Select key={f.key} label={f.label} value={String(current)}
                      options={(f.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
                      onChange={(v) => onConfigChange?.(f.key, v)} help={f.help} />
                  )
                }
                if (f.type === 'boolean') {
                  return (
                    <Toggle key={f.key} label={f.label} checked={Boolean(current)}
                      onChange={(v) => onConfigChange?.(f.key, v)} help={f.help} />
                  )
                }
                return (
                  <NumberInput key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} value={Number(current)}
                    min={f.min} max={f.max} step={f.step} onChange={(v) => onConfigChange?.(f.key, v)} help={f.help} />
                )
              })}
              {onDelete && (
                <button className="btn btn-sm w-full justify-center border-bad/40 text-bad hover:bg-bad/10" onClick={onDelete}>
                  Remove from architecture
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
