/**
 * The course rail.
 *
 * The simulator's problem was never a shortage of material — it was that the
 * curriculum stopped at the door of every lab. You would pick step 4, land in
 * the VAD lab, and the course would vanish: no sense of where you were, what
 * counted as finished, or where to go next. The only way back was the menu.
 *
 * This rail follows you in. On any lab that hosts a course step it shows the
 * step's number, its goal, what "done" means here, and the one button that
 * matters — finish this step and continue. It is deliberately one line tall
 * until you ask for more, so it frames the lab without competing with it.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  COURSE_LENGTH,
  activeStepForRoute,
  courseNeighbours,
  currentStep,
  isDone,
  stageOf,
  stepsForRoute,
} from '../domain/learning'
import { LAB_BY_ROUTE } from '../nav'
import { useAppStore } from '../state/store'

export function CourseRail({ route }: { route: string }) {
  const progress = useAppStore((s) => s.progress)
  const markProgress = useAppStore((s) => s.markProgress)
  const [expanded, setExpanded] = useState(false)

  const step = activeStepForRoute(route, progress)
  if (!step) return null

  const done = isDone(step, progress)
  const { next } = courseNeighbours(step)
  const stage = stageOf(step)
  const siblings = stepsForRoute(route)
  const nextLab = next ? LAB_BY_ROUTE[next.route] : null
  // Bound once so TypeScript can narrow the union inside the callbacks below.
  const completion = step.completion

  return (
    <div className="border-b border-ink-800 bg-ink-900/60">
      <div className="mx-auto max-w-6xl px-6 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Position in the course */}
          <Link
            to="/learn"
            className="group flex shrink-0 items-center gap-2"
            title="Back to the course overview"
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-2xs font-semibold ${
                done ? 'bg-good/20 text-good' : 'bg-accent-deep/50 text-accent'
              }`}
            >
              {done ? '✓' : step.n}
            </span>
            <span className="text-2xs text-ink-500 group-hover:text-ink-300">
              Step {step.n} of {COURSE_LENGTH}
              <span className="hidden sm:inline"> · {stage.title}</span>
            </span>
          </Link>

          <span className="hidden h-4 w-px shrink-0 bg-ink-750 sm:block" />

          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-ink-100">{step.title}</span>
            <span className="ml-2 hidden text-xs text-ink-400 lg:inline">{step.goal}</span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              className="btn btn-sm"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              title="What counts as finishing this step"
            >
              {expanded ? 'Hide' : "What's 'done'?"}
            </button>

            {done ? (
              next ? (
                <Link to={next.route} className="btn btn-sm btn-primary">
                  Step {next.n}: {next.title} →
                </Link>
              ) : (
                <span className="chip border-good/40 bg-good/10 text-good">Course complete</span>
              )
            ) : completion.kind === 'self' ? (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => markProgress(completion.flag)}
                title={completion.prompt}
              >
                ✓ I can do this
              </button>
            ) : completion.kind === 'evidence' ? (
              <span
                className="chip border-media/40 bg-media/10 text-media"
                title={`${completion.artefact} ${completion.how}`}
              >
                ◉ needs evidence
              </span>
            ) : (
              <span className="chip border-ink-700 bg-ink-850 text-ink-400" title={completion.trigger}>
                ticks itself
              </span>
            )}
          </div>
        </div>

        {expanded && (
          <div className="animate-slide-in border-t border-ink-800 pb-3 pt-2.5">
            <p className="text-sm text-ink-300 lg:hidden">{step.goal}</p>
            <div className="mt-1 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-500">
                  Done when you can
                </div>
                <ul className="space-y-1">
                  {step.criteria.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-300">
                      <span className="text-ink-600">·</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-500">
                  How this step completes
                </div>
                <p className="text-sm text-ink-300">
                  {completion.kind === 'auto'
                    ? completion.trigger
                    : completion.kind === 'self'
                      ? `You decide. ${completion.prompt}`
                      : `Evidence required: ${completion.artefact} ${completion.how}`}
                </p>
                {siblings.length > 1 && (
                  <p className="mt-2 text-xs text-ink-500">
                    This lab covers {siblings.length} steps:{' '}
                    {siblings.map((s) => `${s.n}. ${s.title}`).join(' · ')}
                  </p>
                )}
                {next && nextLab && (
                  <p className="mt-2 text-xs text-ink-500">
                    Next up: step {next.n}, {next.title} — in {nextLab.label}.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Shown on labs that are *not* course steps, so reference material is visibly
 * off the path rather than looking like a step you forgot to do.
 */
export function OffPathNote({ route }: { route: string }) {
  const progress = useAppStore((s) => s.progress)
  const lab = LAB_BY_ROUTE[route]
  const current = currentStep(progress)
  if (!lab || !current) return null

  return (
    <div className="border-b border-ink-800 bg-ink-900/40">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-1.5">
        <span className="text-2xs text-ink-500">Reference · not a course step</span>
        <span className="hidden h-3 w-px bg-ink-750 sm:block" />
        <Link
          to={current.route}
          className="text-2xs text-ink-400 transition-colors hover:text-accent"
          title={current.goal}
        >
          Back to the course → step {current.n}: {current.title}
        </Link>
      </div>
    </div>
  )
}
