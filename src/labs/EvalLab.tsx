/**
 * Evaluation: turning "it seemed fine when I tried it" into a release decision.
 *
 * Three ideas, and they are the whole lab:
 *
 *  1. Three outcomes, not two. A turn the caller can recover from is
 *     categorically different from one that silently books the wrong date, and
 *     a binary pass rate hides exactly that distinction.
 *  2. Regressions over absolutes. 78% means nothing; "these four cases passed
 *     last week and fail now" is a decision.
 *  3. Several seeds, not one. A single seed compares two configurations on
 *     twelve coin flips.
 *
 * No model judges another model. Every verdict comes from the same seeded
 * simulation, so the same suite gives the same answer on every machine.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../state/store'
import { composePrompt, MAXIMAL_SELECTION, MINIMAL_SELECTION } from '../models/prompt'
import { DEFAULT_QUALITY_CONFIG, type ContextStrategy, type ModelTier, type QualityConfig } from '../models/agentQuality'
import {
  DEFAULT_SWEEP_SEEDS,
  VERDICT_MEANING,
  compareSuites,
  runSuite,
  sweepSeeds,
  type SuiteResult,
} from '../models/evaluation'
import {
  Badge,
  Callout,
  NumberChip,
  PageHeader,
  Panel,
  SectionLabel,
  Stat,
  Takeaway,
  VerdictTag,
} from '../ui/primitives'
import { Select, Segmented } from '../ui/controls'

/** The named baselines a candidate is compared against. */
const BASELINES = [
  { id: 'minimal', label: 'A careless prompt', note: 'Every section on its weakest setting: no scope, no read-back, no escalation policy.' },
  { id: 'maximal', label: 'A fully engineered prompt', note: 'Every section on its strongest setting, with the token cost that implies.' },
  { id: 'current', label: 'Your current prompt', note: 'Whatever is set in the Prompt Engineering lab right now.' },
] as const

type BaselineId = (typeof BASELINES)[number]['id']

export default function EvalLab() {
  const promptSelection = useAppStore((s) => s.promptSelection)
  const markProgress = useAppStore((s) => s.markProgress)

  const [baselineId, setBaselineId] = useState<BaselineId>('minimal')
  const [modelTier, setModelTier] = useState<ModelTier>('mid')
  const [contextStrategy, setContextStrategy] = useState<ContextStrategy>('last-n')
  const [wer, setWer] = useState(0.09)
  const [view, setView] = useState<'compare' | 'sweep'>('compare')

  const factorsFor = (id: BaselineId) =>
    composePrompt(id === 'minimal' ? MINIMAL_SELECTION : id === 'maximal' ? MAXIMAL_SELECTION : promptSelection).factors

  // Both runs share every input except the prompt, and share the seed. That is
  // the only way the difference between them can be attributed to the prompt.
  const shared = useMemo(
    () => ({ modelTier, contextStrategy, contextTurns: 4, wer, overlappingTools: true, temperature: 0.7 }) as const,
    [modelTier, contextStrategy, wer],
  )
  const baselineCfg: QualityConfig = useMemo(
    () => ({ ...DEFAULT_QUALITY_CONFIG, ...shared, factors: factorsFor(baselineId), seed: 'eval-shared' }),
    // factorsFor closes over promptSelection for the 'current' baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shared, baselineId, promptSelection],
  )
  const candidateCfg: QualityConfig = useMemo(
    () => ({ ...DEFAULT_QUALITY_CONFIG, ...shared, factors: composePrompt(promptSelection).factors, seed: 'eval-shared' }),
    [shared, promptSelection],
  )

  const baseline = useMemo(
    () => runSuite(baselineCfg, BASELINES.find((b) => b.id === baselineId)!.label),
    [baselineCfg, baselineId],
  )
  const candidate = useMemo(() => runSuite(candidateCfg, 'Your current prompt'), [candidateCfg])
  const comparison = useMemo(() => compareSuites(baseline, candidate), [baseline, candidate])

  // The artefact this step wants is a shippable change: something improved,
  // nothing regressed, and the gate on state-changing cases is open.
  useEffect(() => {
    if (comparison.fixed > 0 && comparison.regressed === 0 && candidate.gate.ok) {
      markProgress('eval-clean-improvement')
    }
  }, [comparison, candidate.gate.ok, markProgress])

  const sweepBaseline = useMemo(() => sweepSeeds(baselineCfg, DEFAULT_SWEEP_SEEDS), [baselineCfg])
  const sweepCandidate = useMemo(() => sweepSeeds(candidateCfg, DEFAULT_SWEEP_SEEDS), [candidateCfg])

  return (
    <div className="p-5">
      <PageHeader
        title="Evaluation"
        steps={[
          'Compare your current prompt against "a careless prompt" and read the changed cases.',
          'Go to Prompt Engineering, turn on mandatory read-back, come back, and see which cases moved.',
          'Switch to the seed sweep and check whether the improvement survives five seeds or was one lucky run.',
          'Watch the release gate: it blocks on failing state-changing cases regardless of how good the trend looks.',
        ]}
        subtitle={
          <>
            Nothing here asks a model to grade another model. Every verdict comes from the same deterministic quality
            simulation, so the suite reproduces exactly on any machine. Severity is assigned by what the{' '}
            <i>caller</i> can do about it, not by how wrong the agent was — which is why a hallucination is a FAIL and a
            misunderstanding is only a PARTIAL, even though the misunderstanding looks worse in a transcript.
          </>
        }
        right={<NumberChip kind="MEASURED" seed="eval-shared" source="A seeded run of the quality model" />}
      />

      <div className="grid gap-4 xl:grid-cols-[19rem,minmax(0,1fr)]">
        <div className="space-y-3">
          <Panel title="What to compare against">
            <div className="space-y-2">
              {BASELINES.filter((b) => b.id !== 'current').map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBaselineId(b.id)}
                  aria-pressed={baselineId === b.id}
                  className={`block w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    baselineId === b.id ? 'border-accent-dim bg-accent-deep/20' : 'border-ink-800 bg-ink-850/40 hover:border-ink-600'
                  }`}
                >
                  <div className={`text-sm font-medium ${baselineId === b.id ? 'text-accent' : 'text-ink-100'}`}>{b.label}</div>
                  <div className="mt-0.5 text-xs leading-snug text-ink-400">{b.note}</div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Held constant across both runs">
            <div className="space-y-3">
              <Select
                label="Model tier"
                value={modelTier}
                onChange={setModelTier}
                options={[
                  { value: 'small', label: 'Small / fast' },
                  { value: 'mid', label: 'Mid-tier' },
                  { value: 'frontier', label: 'Frontier' },
                ]}
              />
              <Select
                label="Context strategy"
                value={contextStrategy}
                onChange={setContextStrategy}
                options={[
                  { value: 'full-history', label: 'Replay the whole call' },
                  { value: 'summarised', label: 'Summarise older turns' },
                  { value: 'last-n', label: 'Last 4 turns only' },
                  { value: 'none', label: 'No history' },
                ]}
              />
              <Select
                label="Recognition error rate"
                value={String(wer)}
                onChange={(v) => setWer(Number(v))}
                options={[
                  { value: '0.03', label: '3% — clean wideband' },
                  { value: '0.09', label: '9% — typical telephony' },
                  { value: '0.2', label: '20% — accent + noise + code-switching' },
                ]}
              />
              <p className="text-2xs leading-relaxed text-ink-500">
                Both runs share these and the seed, so any difference between them is the prompt and nothing else. That
                is the only way a comparison means anything.
              </p>
            </div>
          </Panel>

          <Panel title="What the verdicts mean">
            <dl className="space-y-2 text-xs">
              {(['PASS', 'PARTIAL', 'FAIL'] as const).map((v) => (
                <div key={v}>
                  <dt className="mb-0.5">
                    <VerdictTag value={v} />
                  </dt>
                  <dd className="leading-relaxed text-ink-400">{VERDICT_MEANING[v]}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Segmented
              value={view}
              onChange={setView}
              ariaLabel="View"
              options={[
                { value: 'compare', label: 'Regression comparison', title: 'Which cases changed verdict' },
                { value: 'sweep', label: 'Seed sweep', title: 'Does the result survive more than one seed?' },
              ]}
            />
            <Link to="/prompt" className="btn btn-sm">
              Change the prompt →
            </Link>
          </div>

          {view === 'compare' ? (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                <Stat label="Cases fixed" value={comparison.fixed} tone={comparison.fixed > 0 ? 'good' : 'default'} />
                <Stat
                  label="Cases regressed"
                  value={comparison.regressed}
                  tone={comparison.regressed > 0 ? 'bad' : 'good'}
                />
                <Stat
                  label="Release gate"
                  value={candidate.gate.ok ? 'open' : 'blocked'}
                  tone={candidate.gate.ok ? 'good' : 'bad'}
                  hint="Blocks whenever a state-changing case fails, regardless of the overall trend."
                />
                <Stat
                  label="Safe to ship"
                  value={comparison.safeToShip ? 'yes' : 'no'}
                  tone={comparison.safeToShip ? 'good' : 'bad'}
                />
              </div>

              <Callout tone={comparison.safeToShip ? 'good' : 'bad'} title="The sentence a reviewer needs">
                {comparison.verdict}
              </Callout>

              {!candidate.gate.ok && (
                <Callout tone="bad" title={`${candidate.gate.blocking.length} state-changing case${candidate.gate.blocking.length > 1 ? 's are' : ' is'} failing`}>
                  These turns mutate data — a delivery date, a return, a cancellation. A failure here is not visible in
                  the conversation and is discovered by the customer.{' '}
                  {candidate.gate.blocking.map((b) => `"${b.case.utterance}"`).join(' · ')}
                </Callout>
              )}

              <Panel title="Case by case" pad={false}>
                <table className="w-full text-sm">
                  <caption className="sr-only">Evaluation cases, with the verdict before and after</caption>
                  <thead>
                    <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                      <th className="px-4 py-2 font-medium">Turn</th>
                      <th className="px-2 py-2 font-medium">{baseline.label}</th>
                      <th className="px-2 py-2 font-medium">Your prompt</th>
                      <th className="px-4 py-2 font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-850">
                    {comparison.changes.map((c) => (
                      <tr key={c.caseId} className={c.change === 'regressed' ? 'bg-bad/[0.04]' : c.change === 'fixed' ? 'bg-good/[0.04]' : ''}>
                        <td className="max-w-md px-4 py-2 text-ink-200">
                          <div className="truncate">&ldquo;{c.utterance}&rdquo;</div>
                          <div className="truncate text-2xs text-ink-500">{c.note}</div>
                        </td>
                        <td className="px-2 py-2">
                          <VerdictTag value={c.before} />
                        </td>
                        <td className="px-2 py-2">
                          <VerdictTag value={c.after} />
                        </td>
                        <td className="px-4 py-2">
                          {c.change === 'fixed' ? (
                            <Badge tone="good">↑ fixed</Badge>
                          ) : c.change === 'regressed' ? (
                            <Badge tone="bad">↓ regressed</Badge>
                          ) : c.change === 'moved' ? (
                            <Badge tone="warn">→ moved</Badge>
                          ) : (
                            <span className="text-2xs text-ink-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>

              <Takeaway title="Why 'moved' is on this list">
                A case that stays at PARTIAL but changes <i>which</i> failure it hits has not improved — the problem has
                been relocated. A pass-rate chart shows that as a flat line, which is exactly why a pass-rate chart is
                not enough to review a change with.
              </Takeaway>
            </>
          ) : (
            <>
              <Callout tone="info" title="One seed compares two configurations on twelve coin flips">
                Running the same suite across five seeds and reporting the spread is the difference between an
                evaluation and an anecdote. It is cheap here because the whole thing is deterministic arithmetic — no
                API calls, no cost, no waiting.
              </Callout>

              <div className="grid gap-3 lg:grid-cols-2">
                {[
                  { title: baseline.label, sweep: sweepBaseline },
                  { title: 'Your current prompt', sweep: sweepCandidate },
                ].map(({ title, sweep }) => (
                  <Panel key={title} title={title}>
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <Stat label="Mean pass rate" value={`${(sweep.meanPassRate * 100).toFixed(0)}%`} />
                      <Stat
                        label="Seed-to-seed spread"
                        value={`${sweep.spread} case${sweep.spread === 1 ? '' : 's'}`}
                        tone={sweep.spread > 2 ? 'warn' : 'default'}
                        hint="How much the verdict depends on which seed you happened to run. A large spread means a single run proves nothing."
                      />
                    </div>
                    <SectionLabel>Per seed</SectionLabel>
                    <div className="space-y-1">
                      {sweep.perSeed.map((p) => (
                        <div key={p.seed} className="flex items-center gap-2 text-xs">
                          <span className="w-16 shrink-0 font-mono text-ink-500">{p.seed}</span>
                          <span className="flex h-3 flex-1 overflow-hidden rounded-sm">
                            <span className="bg-good" style={{ width: `${(p.pass / 12) * 100}%` }} title={`${p.pass} pass`} />
                            <span className="bg-warn" style={{ width: `${(p.partial / 12) * 100}%` }} title={`${p.partial} partial`} />
                            <span className="bg-bad" style={{ width: `${(p.fail / 12) * 100}%` }} title={`${p.fail} fail`} />
                          </span>
                          <span className="w-24 shrink-0 text-right font-mono text-ink-500">
                            {p.pass}/{p.partial}/{p.fail}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-2xs text-ink-500">
                      Worst seed <span className="font-mono">{sweep.worstSeed.seed}</span> ({sweep.worstSeed.fail}{' '}
                      failing) · best <span className="font-mono">{sweep.bestSeed.seed}</span> ({sweep.bestSeed.fail}).
                      Review the worst one, not the average.
                    </p>
                  </Panel>
                ))}
              </div>

              <Takeaway title="What a sweep is actually for">
                Not a better number — a <b>confidence interval you can argue with</b>. If your improvement is two cases
                and the seed-to-seed spread is three, you have not measured an improvement. You have measured a seed.
              </Takeaway>
            </>
          )}

          <div className="panel-pad flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink-100">Record this as evidence</div>
              <p className="text-xs text-ink-500">
                The course counts an evaluation you ran and read, not a page you visited. Mark this once you can say
                which case changed and why.
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => markProgress('ran-evaluation')}>
              ✓ I can name a case that changed, and why
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Re-exported for the suite table's benefit; keeps the type import honest. */
export type { SuiteResult }
