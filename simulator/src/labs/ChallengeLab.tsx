import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { evaluateArchitecture, evaluateBudget, generateChallenge } from '../challenges/engine'
import type { Challenge, EvaluationResult } from '../domain/types'
import { Assumption, Badge, Callout, KV, PageHeader, Panel, Stat, fmtMs, fmtNum, fmtUsd } from '../ui/primitives'
import { ArchCanvas } from '../ui/ArchCanvas'
import { useAppStore } from '../state/store'

type Phase = 'brief' | 'answering' | 'submitted'

export default function ChallengeLab() {
  const arch = useAppStore((s) => s.workingArchitecture)
  const setActiveRequirements = useAppStore((s) => s.setActiveRequirements)
  const markProgress = useAppStore((s) => s.markProgress)
  const navigate = useNavigate()

  const [seed, setSeed] = useState('alpha')
  const [phase, setPhase] = useState<Phase>('brief')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)

  const challenge: Challenge = useMemo(() => generateChallenge(seed), [seed])
  const budget = useMemo(
    () =>
      challenge.budgetUsdPerCall === undefined
        ? null
        : evaluateBudget(challenge.requirements, challenge.budgetUsdPerCall),
    [challenge],
  )

  const newChallenge = () => {
    setSeed(Math.random().toString(36).slice(2, 8))
    setPhase('brief')
    setAnswers({})
    setNotes('')
    setEvaluation(null)
  }

  const submit = () => {
    const result = evaluateArchitecture(arch, challenge.requirements)
    setEvaluation(result)
    setPhase('submitted')
    // Submitting is not passing. The course step wants a design with no
    // blocking violations that also fits the brief's cost ceiling — buying
    // your way out of every tradeoff is exactly what the budget is there to
    // catch.
    const blocking =
      result.findings.some((f) => f.kind === 'violates') || result.issues.some((i) => i.severity === 'error')
    if (!blocking && (budget === null || budget.withinBudget)) markProgress('challenge-passed')
  }

  useEffect(() => {
    setActiveRequirements(challenge.requirements)
  }, [challenge, setActiveRequirements])

  const answeredCount = Object.keys(answers).length

  return (
    <div className="p-4">
      <PageHeader
        title="Challenges"
        steps={[
          "Read the brief, then press “Start designing →”.",
          "Build it on the canvas before answering the design questions. Drawing it exposes what you have not decided.",
          "Read the feedback on every question — especially the ones you got right.",
        ]}
        subtitle="A generated brief, your architecture, an honest evaluation. No grades."
        right={
          <div className="flex gap-2">
            <button className="btn" onClick={newChallenge}>🎲 New challenge</button>
            {phase !== 'submitted' && (
              <button className="btn btn-primary" onClick={submit} disabled={phase === 'brief' && answeredCount === 0}>
                ✓ Submit design
              </button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr,400px]">
        <div className="space-y-4">
          <Panel title={challenge.title} right={<Badge tone="accent">seed: {seed}</Badge>}>
            <div className="grid gap-4 sm:grid-cols-2">
              <KV
                items={[
                  { k: 'Calls / day', v: fmtNum(challenge.requirements.callsPerDay) },
                  { k: 'Peak concurrent', v: fmtNum(challenge.requirements.peakConcurrentCalls) },
                  { k: 'Avg duration', v: `${(challenge.requirements.avgCallSeconds / 60).toFixed(1)} min` },
                  { k: 'Latency target', v: `${challenge.requirements.latencyTargetMs} ms perceived` },
                  { k: 'Availability', v: `${(challenge.requirements.availabilityTarget * 100).toFixed(2)}%` },
                ]}
              />
              <KV
                items={[
                  { k: 'Languages', v: challenge.requirements.languages.join(', ') },
                  { k: 'Regions', v: challenge.requirements.regions.join(', ') },
                  { k: 'Channel / direction', v: `${challenge.requirements.channel} / ${challenge.requirements.direction}` },
                  { k: 'Human handoff', v: challenge.requirements.humanHandoff ? 'required' : 'not required' },
                  { k: 'Recording', v: challenge.requirements.recording ? 'required' : 'not required' },
                  { k: 'Budget posture', v: challenge.requirements.budgetPosture },
                ]}
              />
            </div>

            {/* A brief without a budget is a wish list: every reliability
                question has an obvious answer when money is free. */}
            {challenge.budgetUsdPerCall !== undefined && (
              <div className="mt-4 rounded-md border border-warn/30 bg-warn/[0.05] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink-100">
                    <span className="mr-1.5" aria-hidden>
                      ⌗
                    </span>
                    Budget ceiling: {fmtUsd(challenge.budgetUsdPerCall, 4)} per call
                  </span>
                  <span className="chip tone-neutral">
                    ≈ {fmtUsd(challenge.budgetUsdPerCall * challenge.requirements.callsPerDay * 30, 0)}/month
                  </span>
                  {budget && (
                    <span className={`chip ${budget.withinBudget ? 'tone-good' : 'tone-bad'}`}>
                      {budget.withinBudget
                        ? `✓ your design: ${fmtUsd(budget.usdPerCall, 4)}`
                        : `✕ your design: ${fmtUsd(budget.usdPerCall, 4)} — over by ${fmtUsd(budget.overBy, 4)}`}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                  {budget?.withinBudget
                    ? `Inside the ceiling. Check what you gave up to get there — the dominant line is ${budget.dominant}`
                    : budget
                      ? `Over the ceiling. The largest line is ${budget.dominant} Cutting it is a quality decision, not an efficiency one: say which quality you are selling.`
                      : 'Derived from what a reasonable reference design costs for these exact requirements, adjusted for the brief\u2019s budget posture.'}
                </p>
              </div>
            )}
            {phase === 'brief' && (
              <div className="mt-4 flex gap-2">
                <button className="btn btn-primary" onClick={() => setPhase('answering')}>Start designing →</button>
                <button className="btn" onClick={() => navigate('/canvas')}>⬡ Build it on the canvas</button>
              </div>
            )}
          </Panel>

          {phase !== 'brief' && (
            <Panel title="Design questions" right={<Badge>{answeredCount}/{challenge.questions.length} answered</Badge>}>
              <div className="space-y-4">
                {challenge.questions.map((q) => {
                  const chosen = answers[q.id]
                  const revealed = phase === 'submitted' && chosen
                  const isGood = chosen && q.goodAnswers?.includes(chosen)
                  const isBad = chosen && q.badAnswers?.includes(chosen)
                  return (
                    <div key={q.id} className="rounded-md border border-ink-750 bg-ink-850 p-3">
                      <p className="mb-2 text-sm font-medium text-ink-100">{q.prompt}</p>
                      <div className="space-y-1.5">
                        {q.options?.map((o) => {
                          const selected = chosen === o.id
                          const tone = phase === 'submitted' && selected
                            ? isGood ? 'border-good/60 bg-good/10' : isBad ? 'border-bad/60 bg-bad/10' : 'border-warn/60 bg-warn/10'
                            : selected ? 'border-accent-dim bg-ink-800' : 'border-ink-800 hover:border-ink-600'
                          return (
                            <button key={o.id} disabled={phase === 'submitted'}
                              className={`block w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${tone}`}
                              onClick={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}>
                              {o.label}
                              {phase === 'submitted' && q.goodAnswers?.includes(o.id) && <span className="ml-2 text-good">✓ defensible</span>}
                              {phase === 'submitted' && q.badAnswers?.includes(o.id) && <span className="ml-2 text-bad">✕ fails a requirement</span>}
                            </button>
                          )
                        })}
                      </div>
                      {revealed && (
                        <div className="mt-2 space-y-1.5 border-t border-ink-800 pt-2 text-xs">
                          <p className="text-ink-300"><span className="font-medium text-ink-200">Your choice: </span>{q.feedback[chosen]}</p>
                          {!isGood && q.goodAnswers?.map((g) => (
                            <p key={g} className="text-ink-400"><span className="font-medium text-good">Stronger answer: </span>{q.feedback[g]}</p>
                          ))}
                          <p className="italic text-ink-500">Principle: {q.principle}</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-4">
                <label className="label">Your design notes (what you'd tell the reviewer)</label>
                <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. 'Streaming pipeline with dual STT vendors; media tier at 24 instances for N-1; Redis for session state; escalation threshold tuned to 8% to keep human cost down.'"
                  disabled={phase === 'submitted'} />
              </div>
            </Panel>
          )}

          {phase === 'submitted' && evaluation && (
            <>
              <Panel title="Evaluation of your architecture" right={<Badge tone={evaluation.scoreLabel.includes('blocking') ? 'bad' : evaluation.scoreLabel.includes('rough') ? 'warn' : 'good'}>{evaluation.scoreLabel}</Badge>}>
                <p className="mb-3 text-sm text-ink-400">
                  Judged by the same models the rest of the app uses — validator rules, bottleneck detection, the latency
                  model and the cost engine — against <em>this brief's</em> requirements. Not a grade: a review.
                </p>
                <div className="space-y-2">
                  {(['violates', 'bottleneck', 'satisfies', 'suggestion', 'tradeoff', 'assumption'] as const).map((kind) => {
                    const items = evaluation.findings.filter((f) => f.kind === kind)
                    if (!items.length) return null
                    const tone = kind === 'violates' || kind === 'bottleneck' ? 'bad' : kind === 'satisfies' ? 'good' : kind === 'suggestion' ? 'accent' : 'warn'
                    return (
                      <div key={kind}>
                        <div className="label">{kind}</div>
                        {items.map((f, i) => (
                          <div key={i} className="mb-1.5 rounded-md border border-ink-800 px-2.5 py-1.5">
                            <div className="flex items-start gap-2">
                              <Badge tone={tone as 'bad' | 'good' | 'accent' | 'warn'}>{kind}</Badge>
                              <span className="text-sm text-ink-100">{f.title}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-ink-400">{f.detail}</p>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </Panel>

              <Panel title="Rule findings on your design">
                {evaluation.issues.length === 0 ? (
                  <Callout tone="good" title="No rule findings">Your architecture passed all the validator rules at this scale.</Callout>
                ) : (
                  <div className="space-y-2">
                    {evaluation.issues.slice(0, 8).map((issue, i) => (
                      <details key={i} className="rounded-md border border-ink-750 bg-ink-850 px-3 py-2" open={issue.severity === 'error'}>
                        <summary className="cursor-pointer text-sm text-ink-100">
                          <Badge tone={issue.severity === 'error' ? 'bad' : issue.severity === 'warning' ? 'warn' : 'accent'}>{issue.severity}</Badge>
                          <span className="ml-2">{issue.title}</span>
                        </summary>
                        <div className="mt-1.5 space-y-1 text-xs text-ink-300">
                          <p><span className="font-medium">Detected:</span> {issue.detected}</p>
                          <p><span className="font-medium">Why:</span> {issue.why}</p>
                          <p><span className="font-medium">Fix:</span> {issue.fix}</p>
                          <p className="italic text-ink-500">{issue.principle}</p>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </Panel>
            </>
          )}
        </div>

        <div className="space-y-3">
          <Panel title="Your current architecture" pad={false} right={<button className="btn btn-sm" onClick={() => navigate('/canvas')}>Edit</button>}>
            <div className="h-[260px]">
              <ArchCanvas architecture={arch} editable={false} fitKey={arch.nodes.length} />
            </div>
            <div className="border-t border-ink-800 p-2 text-2xs text-ink-500">
              {arch.nodes.length} components · {arch.edges.length} connections · evaluated against this brief on submit
            </div>
          </Panel>

          {phase === 'submitted' && evaluation && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Est. perceived latency" value={evaluation.latency ? fmtMs(evaluation.latency.perceivedLatencyMs) : '—'}
                  tone={evaluation.latency?.withinBudget ? 'good' : 'bad'} />
                <Stat label="Est. cost / call" value={evaluation.cost ? fmtUsd(evaluation.cost.usdPerCall, 4) : '—'} />
              </div>
              <Panel title="Rubric for this brief">
                <ul className="ml-4 list-disc space-y-1 text-xs text-ink-400">
                  {challenge.rubric.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Panel>
              <Panel title="Components this brief expects">
                <div className="flex flex-wrap gap-1.5">
                  {challenge.expectedComponents.map((c) => {
                    const present = arch.nodes.some((n) => n.specId === c)
                    return <Badge key={c} tone={present ? 'good' : 'bad'}>{present ? '✓' : '✕'} {c}</Badge>
                  })}
                </div>
                <p className="mt-2 text-2xs text-ink-500">
                  A missing component is a prompt to think, not an automatic failure — if you can defend its absence, say so in your notes.
                </p>
              </Panel>
            </>
          )}

          {phase !== 'submitted' && (
            <Callout tone="info" title="The solution stays hidden">
              Nothing about the expected design is shown until you submit. Build your architecture on the canvas, answer the
              questions, then submit — the evaluation compares your actual graph against this brief.
            </Callout>
          )}

          <Panel title="Assumptions">
            <p className="text-2xs text-ink-500">
              Generated briefs are deterministic from the seed. Evaluation uses the same labelled assumptions as the rest of
              the simulator (50 calls/media instance, provider quotas, example pricing). <Assumption />
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
