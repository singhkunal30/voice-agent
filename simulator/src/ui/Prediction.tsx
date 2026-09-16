/**
 * The prediction gate.
 *
 * Wraps a lab's results and refuses to show them until the learner has
 * committed to an answer. That refusal is the entire feature: a number you
 * predicted wrongly is remembered, and a number you merely read is not.
 *
 * Skipping is allowed — a tool that traps you is a tool you stop opening — but
 * a skipped run is explicitly marked as producing information rather than
 * evidence, and the course only counts the latter.
 *
 * Once revealed, the gate collapses to a single line comparing what you said
 * with what the simulation measured, and stays out of the way. `resetKey`
 * re-arms it: labs pass whatever identifies "a genuinely different question"
 * — a new pressure test, a new load preset, a new architecture.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PredictionQuestion } from '../domain/prediction'
import { calibration, scorePrediction } from '../domain/prediction'
import { useAppStore } from '../state/store'

export function PredictionGate({
  question,
  route,
  actual,
  resetKey = '',
  note,
  className = 'space-y-4',
  children,
}: {
  question: PredictionQuestion
  /** Route recorded with the prediction, so the record can link back. */
  route: string
  /** The measured answer. The lab computes it; the gate never sees the model. */
  actual: string
  /** Changing this re-arms the gate for a genuinely different question. */
  resetKey?: string
  /** Extra context shown while predicting — what the learner should reason from. */
  note?: ReactNode
  /**
   * Classes for the wrapper. The gate always renders a single element so it can
   * be dropped straight into a grid column without its children escaping into
   * the grid as extra items.
   */
  className?: string
  /** The results, hidden until the learner predicts or skips. */
  children: ReactNode
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [state, setState] = useState<'asking' | 'revealed' | 'skipped'>('asking')
  const recordPrediction = useAppStore((s) => s.recordPrediction)
  const recordedFor = useRef<string | null>(null)

  useEffect(() => {
    setPicked(null)
    setState('asking')
    recordedFor.current = null
  }, [resetKey, question.id])

  const commit = (optionId: string) => {
    setPicked(optionId)
    setState('revealed')
    const outcome = scorePrediction(question, optionId, actual)
    // Record once per arming: re-reading your own result is not a new prediction.
    const key = `${question.id}:${resetKey}`
    if (recordedFor.current !== key) {
      recordedFor.current = key
      recordPrediction({
        questionId: question.id,
        correct: outcome.correct,
        distance: outcome.distance,
        route,
        at: Date.now(),
      })
    }
  }

  const outcome = state === 'revealed' && picked ? scorePrediction(question, picked, actual) : null

  if (state === 'asking') {
    return (
      <div className={className}>
        <div className="panel-pad border-accent/30 bg-accent/[0.04]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-100">
              <span className="mr-1.5 text-accent" aria-hidden>
                ◆
              </span>
              {question.prompt}
            </h2>
            <button
              className="text-2xs text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-300"
              onClick={() => setState('skipped')}
            >
              Show me without predicting
            </button>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-400">{question.why}</p>
          {note && <div className="mt-2 text-xs text-ink-400">{note}</div>}
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {question.options.map((o) => (
              <button
                key={o.id}
                onClick={() => commit(o.id)}
                className="rounded-md border border-ink-750 bg-ink-850 px-3 py-2 text-left text-sm text-ink-200 transition-colors hover:border-accent-dim hover:bg-ink-800 hover:text-ink-100"
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {outcome ? (
        <div
          className={`panel-pad ${
            outcome.correct ? 'border-good/35 bg-good/[0.05]' : outcome.distance === 1 ? 'border-warn/35 bg-warn/[0.05]' : 'border-bad/35 bg-bad/[0.05]'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={`chip ${
                outcome.correct ? 'tone-good' : outcome.distance === 1 ? 'tone-warn' : 'tone-bad'
              }`}
            >
              {/* Never colour alone: the word carries the meaning too. */}
              {outcome.correct ? '✓ Matched' : outcome.distance === 1 ? '≈ One band out' : `✕ ${outcome.distance} bands out`}
            </span>
            <span className="text-sm text-ink-300">
              You said <b className="text-ink-100">{outcome.predictedLabel}</b>
            </span>
            <span className="text-ink-600" aria-hidden>
              →
            </span>
            <span className="text-sm text-ink-300">
              It measured <b className="text-ink-100">{outcome.actualLabel}</b>
            </span>
            <button className="btn btn-sm ml-auto" onClick={() => setState('asking')}>
              Predict again
            </button>
          </div>
          <p className="mt-2 max-w-4xl text-xs leading-relaxed text-ink-400">{outcome.diagnosis}</p>
        </div>
      ) : (
        <div className="panel-pad border-ink-800 bg-ink-900/50">
          <div className="flex flex-wrap items-center gap-3">
            <span className="chip tone-neutral">No prediction</span>
            <span className="text-xs text-ink-400">
              You are reading the answer without having committed to one. That is information, not evidence — the
              course counts predictions, not page visits.
            </span>
            <button className="btn btn-sm ml-auto" onClick={() => setState('asking')}>
              Let me predict
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * The prediction record, shown on the workspace home and the course page.
 *
 * Reports attempts and where they landed, per topic. Deliberately not a score:
 * "you have been wrong about capacity three times" is a useful sentence, and
 * "you are level 4" is not.
 */
export function PredictionRecord({ compact = false }: { compact?: boolean }) {
  const predictions = useAppStore((s) => s.predictions)
  const clear = useAppStore((s) => s.clearPredictions)

  if (predictions.length === 0) {
    return (
      <p className="text-sm text-ink-500">
        No predictions yet. Labs that can measure something will ask you to commit to an answer before showing it.
      </p>
    )
  }

  const topics = calibration(predictions)

  return (
    <div>
      <ul className="space-y-1.5">
        {topics.map((c) => (
          <li key={c.questionId} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate text-ink-300" title={c.prompt}>
              {TOPIC_LABELS[c.questionId] ?? c.questionId}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-2xs">
              <span className="text-good" title="Exact band">
                {c.exact} exact
              </span>
              <span className="text-ink-700">·</span>
              <span className="text-warn" title="One band out">
                {c.near} near
              </span>
              <span className="text-ink-700">·</span>
              <span className="text-bad" title="Two or more bands out">
                {c.far} far
              </span>
            </span>
          </li>
        ))}
      </ul>
      {!compact && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">
            {predictions.length} prediction{predictions.length === 1 ? '' : 's'} committed to. A topic you have never
            been wrong about is a topic you have not stressed hard enough.
          </p>
          <button className="btn btn-sm" onClick={clear}>
            Clear record
          </button>
        </div>
      )}
    </div>
  )
}

/** Short labels for the record; the full prompts are too long for a list. */
const TOPIC_LABELS: Record<string, string> = {
  'perceived-latency': 'Where perceived latency lands',
  'call-outcome': 'How a call ends under failure',
  saturation: 'How close a fleet is to the edge',
  'infra-tier': 'What shape of system a load needs',
  'cost-per-call': 'What a call costs',
  'pressure-verdict': 'Whether a design holds under pressure',
  'agent-quality': 'How many turns go wrong',
}
