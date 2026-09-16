/**
 * Agent quality: whether the thing actually works.
 *
 * Latency and uptime have dashboards. Whether the agent understood, picked the
 * right function, passed the right arguments, remembered what it was told and
 * knew when to fetch a human — that is the part that decides whether anyone
 * keeps using it, and it is the part most voice projects never measure until a
 * customer complains.
 *
 * Twelve realistic turns run against the prompt built next door, with the six
 * failure modes separated out. Separating them is the whole point: a single
 * "accuracy" number hides that raising the word error rate makes *arguments*
 * wrong while leaving tool selection alone.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../state/store'
import { composePrompt } from '../models/prompt'
import {
  CONTEXT_STRATEGIES,
  DEFAULT_QUALITY_CONFIG,
  FAILURE_META,
  MODEL_TIERS,
  expectedByKind,
  expectedFailureRate,
  explainCase,
  runQuality,
  type ContextStrategy,
  type ModelTier,
  type QualityConfig,
  type QualityFailureKind,
} from '../models/agentQuality'
import { QUALITY_BANDS, QUALITY_Q } from '../domain/prediction'
import { bandFor } from '../domain/prediction'
import { PredictionGate } from '../ui/Prediction'
import {
  Badge,
  Callout,
  Meter,
  NumberChip,
  PageHeader,
  Panel,
  SectionLabel,
  Stat,
  Takeaway,
} from '../ui/primitives'
import { Select, Slider, Toggle } from '../ui/controls'

export default function QualityLab() {
  const promptSelection = useAppStore((s) => s.promptSelection)
  const markProgress = useAppStore((s) => s.markProgress)
  const factors = useMemo(() => composePrompt(promptSelection).factors, [promptSelection])

  const [modelTier, setModelTier] = useState<ModelTier>('mid')
  const [contextStrategy, setContextStrategy] = useState<ContextStrategy>('last-n')
  const [contextTurns, setContextTurns] = useState(4)
  const [wer, setWer] = useState(0.09)
  const [overlappingTools, setOverlappingTools] = useState(true)
  const [temperature, setTemperature] = useState(0.7)
  const [seed, setSeed] = useState(1)
  const [openCase, setOpenCase] = useState<string | null>(null)

  // Memoised so the three derived runs below see a stable object: a fresh
  // config on every render would re-run the whole suite on every keystroke.
  const cfg: QualityConfig = useMemo(
    () => ({
      ...DEFAULT_QUALITY_CONFIG,
      factors,
      modelTier,
      contextStrategy,
      contextTurns,
      wer,
      overlappingTools,
      temperature,
      seed: `quality-${seed}`,
    }),
    [factors, modelTier, contextStrategy, contextTurns, wer, overlappingTools, temperature, seed],
  )

  const run = useMemo(() => runQuality(cfg), [cfg])
  const expected = useMemo(() => expectedFailureRate(cfg), [cfg])
  const byKind = useMemo(() => expectedByKind(cfg), [cfg])

  // You have to see the problem before you can claim to have fixed it: the
  // step needs a run WITH silent mutations followed by one without.
  const sawSilentMutations = useRef(false)
  useEffect(() => {
    if (run.silentMutations > 0) sawSilentMutations.current = true
    else if (sawSilentMutations.current) markProgress('quality-no-silent-mutations')
  }, [run, markProgress])

  const actualBand = bandFor(expected, QUALITY_BANDS).id
  const kindsOrdered = (Object.keys(byKind) as QualityFailureKind[]).sort((a, b) => byKind[b] - byKind[a])

  return (
    <div className="p-5">
      <PageHeader
        title="Agent quality"
        steps={[
          'Predict how many of the twelve turns go wrong, then look.',
          'Drag the word error rate up and watch which failure kind moves — it is not the one most people expect.',
          'Switch the context strategy to "last 4 turns" and find the turn that now fails.',
          'Open a failing turn to see the probability the model assigned it and why.',
        ]}
        subtitle={
          <>
            Six ways a turn goes wrong, simulated deterministically from the prompt you built, the model tier, the
            recognition error rate and the context strategy. The failure that matters most is the quiet one:{' '}
            <b>right tool, wrong arguments</b>. It succeeds, nothing in the conversation signals an error, and it is
            discovered by the customer.
          </>
        }
        right={<NumberChip kind="MEASURED" seed={cfg.seed} source="A seeded run of this quality model" />}
      />

      <div className="grid gap-4 xl:grid-cols-[20rem,minmax(0,1fr)]">
        <div className="space-y-3">
          <Panel title="The agent under test">
            <div className="space-y-3">
              <div>
                <SectionLabel hint="Built in the Prompt Engineering lab and shared with Evaluation.">
                  Prompt
                </SectionLabel>
                <div className="rounded-md border border-ink-800 bg-ink-850/40 px-2.5 py-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ink-300">Instruction quality</span>
                    <span className="font-mono text-ink-400">
                      {Math.round(
                        ((factors.clarity + factors.toolGrounding + factors.guardrails + factors.stateDiscipline + factors.escalationClarity + factors.brevity) /
                          6) *
                          100,
                      )}
                      %
                    </span>
                  </div>
                  <Link to="/prompt" className="btn btn-sm mt-2 w-full justify-center">
                    Edit the prompt →
                  </Link>
                </div>
              </div>

              <Select
                label="Model tier"
                value={modelTier}
                onChange={setModelTier}
                options={MODEL_TIERS.map((m) => ({ value: m.id, label: m.label }))}
                help={MODEL_TIERS.find((m) => m.id === modelTier)?.note}
              />
              <p className="-mt-1 text-2xs leading-relaxed text-ink-500">{MODEL_TIERS.find((m) => m.id === modelTier)?.note}</p>

              <Select
                label="Context strategy"
                value={contextStrategy}
                onChange={setContextStrategy}
                options={CONTEXT_STRATEGIES.map((c) => ({ value: c.id, label: c.label }))}
              />
              <p className="-mt-1 text-2xs leading-relaxed text-ink-500">
                {CONTEXT_STRATEGIES.find((c) => c.id === contextStrategy)?.note}
              </p>

              {contextStrategy === 'last-n' && (
                <Slider
                  label="Turns retained"
                  value={contextTurns}
                  onChange={setContextTurns}
                  min={1}
                  max={12}
                  help="A caller who gave their order number on turn 1 and refers back to it on turn 7 needs six turns of history to still be understood."
                />
              )}

              <Slider
                label="Word error rate from recognition"
                value={wer}
                onChange={setWer}
                min={0}
                max={0.35}
                step={0.01}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                help="Comes out of the speech-to-text lab. Telephony audio, accent and code-switching all push this up."
              />
              <Slider
                label="Temperature"
                value={temperature}
                onChange={setTemperature}
                min={0}
                max={1}
                step={0.1}
                help="Higher temperature widens the range of things the model might say when the instructions run out."
              />
              <Toggle
                label="Tool catalogue has overlapping functions"
                checked={overlappingTools}
                onChange={setOverlappingTools}
                help="Two tools whose descriptions could both plausibly apply. The most common cause of tool-selection errors, and the easiest to fix."
              />

              <button className="btn w-full justify-center" onClick={() => setSeed((s) => s + 1)}>
                ⟳ Re-run with a new seed
              </button>
              <p className="text-2xs text-ink-500">
                One seed is twelve coin flips. If a change only shows up on one seed, it did not show up.
              </p>
            </div>
          </Panel>

          <Panel title="Where quality actually goes" right={<NumberChip kind="ASSUMPTION" />}>
            <div className="space-y-2.5">
              {kindsOrdered.map((k) => (
                <Meter
                  key={k}
                  value={byKind[k] * 4}
                  label={<span title={FACTOR_TITLE(k)}>{FAILURE_META[k].label}</span>}
                  caption={`${(byKind[k] * 100).toFixed(1)}%`}
                  tone={byKind[k] > 0.08 ? 'bad' : byKind[k] > 0.03 ? 'warn' : 'good'}
                />
              ))}
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-ink-500">
              Expected share of turns, per failure kind, across the whole case set. Bars are scaled ×4 so small
              differences are visible; the numbers are exact.
            </p>
          </Panel>
        </div>

        <PredictionGate
          question={QUALITY_Q}
          route="/quality"
          actual={actualBand}
          resetKey={`${modelTier}:${contextStrategy}:${contextTurns}:${wer}:${overlappingTools}:${temperature}`}
          note="You have the prompt, the model tier, the error rate and the context strategy in front of you. That is everything the model uses."
        >
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat
                label="Turns wrong on this seed"
                value={`${run.turnsWrong} of ${run.outcomes.length}`}
                tone={run.turnsWrong === 0 ? 'good' : run.turnsWrong > 3 ? 'bad' : 'warn'}
                hint="What actually happened on this run. Reproduce it with the same seed."
              />
              <Stat
                label="Expected failure rate"
                value={`${(expected * 100).toFixed(1)}%`}
                tone={expected < 0.05 ? 'good' : expected < 0.15 ? 'warn' : 'bad'}
                hint="What this configuration is worth, without sampling. Compare configurations on this, not on a single seed."
              />
              <Stat
                label="Silent state changes"
                value={run.silentMutations}
                tone={run.silentMutations === 0 ? 'good' : 'bad'}
                hint="Turns that changed stored data incorrectly while looking successful. The failures that reach a customer."
              />
            </div>

            {run.silentMutations > 0 && (
              <Callout tone="bad" title={`${run.silentMutations} turn${run.silentMutations > 1 ? 's' : ''} changed data incorrectly without signalling an error`}>
                Nothing in the conversation goes wrong. The tool call succeeds. A delivery is moved to the wrong date or
                the wrong order is returned, and it is discovered days later by the person it happened to. Read-back
                confirmation before any mutating call is the mitigation, and it costs a turn.
              </Callout>
            )}

            <Panel title="The twelve turns" pad={false}>
              <div className="divide-y divide-ink-850">
                {run.outcomes.map((o) => {
                  const open = openCase === o.case.id
                  return (
                    <div key={o.case.id}>
                      <button
                        className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-850/60"
                        onClick={() => setOpenCase(open ? null : o.case.id)}
                        aria-expanded={open}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs ${
                            o.ok ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'
                          }`}
                          aria-hidden
                        >
                          {o.ok ? '✓' : '✕'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink-100">&ldquo;{o.case.utterance}&rdquo;</span>
                          <span className="mt-0.5 block text-xs text-ink-500">
                            {o.ok ? o.case.expected : FAILURE_META[o.failure!].whatCallerSees}
                          </span>
                        </span>
                        <span className="shrink-0">
                          {o.ok ? (
                            <Badge tone="good">handled</Badge>
                          ) : (
                            <Badge tone={o.case.mutating ? 'bad' : 'warn'}>{FAILURE_META[o.failure!].label}</Badge>
                          )}
                        </span>
                      </button>
                      {open && (
                        <div className="animate-slide-in border-t border-ink-850 bg-ink-950/40 px-4 py-3">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <SectionLabel>What should have happened</SectionLabel>
                              <p className="text-sm leading-relaxed text-ink-300">{o.case.expected}</p>
                              <SectionLabel>What this case probes</SectionLabel>
                              <p className="text-sm leading-relaxed text-ink-400">{o.case.probes}</p>
                              {!o.ok && (
                                <>
                                  <SectionLabel>What it costs you</SectionLabel>
                                  <p className="text-sm leading-relaxed text-ink-400">{FAILURE_META[o.failure!].costsYou}</p>
                                </>
                              )}
                            </div>
                            <div>
                              <SectionLabel>Why the model went this way</SectionLabel>
                              <p className="text-sm leading-relaxed text-ink-300">{o.explanation}</p>
                              <SectionLabel>Every risk on this turn</SectionLabel>
                              <div className="space-y-1.5">
                                {explainCase(o.case, cfg).map((r) => (
                                  <div key={r.kind} className="flex items-center gap-2 text-xs">
                                    <span className="w-40 shrink-0 truncate text-ink-400" title={r.why}>
                                      {r.label}
                                    </span>
                                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink-800">
                                      <span
                                        className={`block h-full rounded-full ${r.probability > 0.25 ? 'bg-bad' : r.probability > 0.1 ? 'bg-warn' : 'bg-good'}`}
                                        style={{ width: `${Math.min(100, r.probability * 100)}%` }}
                                      />
                                    </span>
                                    <span className="w-10 shrink-0 text-right font-mono text-ink-500">
                                      {(r.probability * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Takeaway title="The coupling most people miss">
              Drag the word error rate from 3% to 25% and watch the bars on the left. Tool <i>selection</i> barely
              moves — the model still knows which function it wants. What rises is{' '}
              <b>right tool, wrong arguments</b>, because the identifier passed to the tool came straight out of a
              transcript that was wrong. Recognition quality is not a speech problem; it is a data-integrity problem
              wearing a speech costume.
            </Takeaway>

            <div className="panel-pad flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink-100">Turn this into a release decision</div>
                <p className="text-xs text-ink-500">
                  A failure rate is not shippable on its own. The evaluation lab sorts these into PASS / PARTIAL / FAIL,
                  gates on the ones that change data, and compares two configurations for regressions.
                </p>
              </div>
              <Link to="/eval" className="btn btn-primary" onClick={() => markProgress('measured-quality')}>
                Evaluation →
              </Link>
            </div>
          </div>
        </PredictionGate>
      </div>
    </div>
  )
}

function FACTOR_TITLE(k: QualityFailureKind): string {
  return `${FAILURE_META[k].whatCallerSees} ${FAILURE_META[k].whyItHappens}`
}
