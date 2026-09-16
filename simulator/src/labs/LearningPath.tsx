import { Link } from 'react-router-dom'
import {
  COURSE_LENGTH,
  COURSE_STAGES,
  STEPS_BY_STAGE,
  currentStep,
  doneCount,
  isDone,
  type CourseStep,
} from '../domain/learning'
import { useAppStore } from '../state/store'
import { PageHeader } from '../ui/primitives'
import { LAB_BY_ROUTE } from '../nav'

/**
 * The course overview.
 *
 * Deliberately a map, not a workspace: it shows where you are and hands you
 * straight into the lab. The work — and the step's goal, criteria and "next" —
 * travels with you via the course rail, so this page never has to be
 * re-visited mid-step just to remember what you were doing.
 */
export default function LearningPath() {
  const progress = useAppStore((s) => s.progress)
  const resetProgress = useAppStore((s) => s.resetProgress)
  const done = doneCount(progress)
  const current = currentStep(progress)

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Guided course"
        question="What order should I learn this in?"
        subtitle="Thirteen steps in five stages. Each one drops you into the lab that teaches it, and the step travels with you — you never have to come back here to remember where you were. Progress lives in this browser only."
        right={
          <button className="btn btn-sm" onClick={resetProgress} title="Clear local progress">
            ↻ Reset
          </button>
        }
      />

      {/* Where you are */}
      <div className="panel-pad mb-8">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-ink-300">
            {done === 0
              ? 'Not started'
              : done === COURSE_LENGTH
                ? 'Course complete'
                : `${done} of ${COURSE_LENGTH} steps done`}
          </span>
          <span className="font-mono text-xs text-ink-500">{Math.round((done / COURSE_LENGTH) * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${(done / COURSE_LENGTH) * 100}%` }}
          />
        </div>

        {current ? (
          <Link
            to={current.route}
            className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/[0.06] px-4 py-3 transition-colors hover:border-accent-dim"
          >
            <div className="min-w-0 flex-1">
              <div className="text-2xs font-semibold uppercase tracking-wide text-accent">
                {done === 0 ? 'Start here' : 'Up next'} · step {current.n}
              </div>
              <div className="mt-0.5 font-medium text-ink-100">{current.title}</div>
              <div className="text-xs text-ink-400">{current.goal}</div>
            </div>
            <span className="btn btn-primary btn-sm shrink-0">
              Open {LAB_BY_ROUTE[current.route]?.label ?? 'lab'} →
            </span>
          </Link>
        ) : (
          <p className="mt-4 text-sm text-ink-300">
            Every step is done. The labs are still there — and the{' '}
            <Link to="/challenge" className="text-accent hover:underline">
              challenges
            </Link>{' '}
            generate a fresh brief every time.
          </p>
        )}
      </div>

      {/* The map */}
      <div className="space-y-7">
        {COURSE_STAGES.map((stage, si) => {
          const steps = STEPS_BY_STAGE[stage.id] ?? []
          const stageDone = steps.filter((s) => isDone(s, progress)).length
          const complete = stageDone === steps.length
          return (
            <section key={stage.id}>
              <div className="mb-2.5 flex items-baseline gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-2xs font-semibold ${
                    complete ? 'bg-good/20 text-good' : 'bg-ink-800 text-ink-400'
                  }`}
                >
                  {complete ? '✓' : si + 1}
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink-100">{stage.title}</h2>
                  <p className="text-xs text-ink-500">{stage.blurb}</p>
                </div>
                <span className="ml-auto shrink-0 font-mono text-2xs text-ink-600">
                  {stageDone}/{steps.length}
                </span>
              </div>

              <ol className="ml-3 space-y-1 border-l border-ink-800 pl-6">
                {steps.map((step) => (
                  <StepRow
                    key={step.n}
                    step={step}
                    done={isDone(step, progress)}
                    current={current?.n === step.n}
                  />
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function StepRow({ step, done, current }: { step: CourseStep; done: boolean; current: boolean }) {
  const lab = LAB_BY_ROUTE[step.route]
  return (
    <li>
      <Link
        to={step.route}
        className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors ${
          current
            ? 'border-accent/40 bg-accent/[0.04] hover:border-accent-dim'
            : done
              ? 'border-ink-800 bg-ink-900/50 hover:border-ink-700'
              : 'border-ink-800 bg-ink-900 hover:border-ink-700'
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-2xs font-semibold ${
            done ? 'bg-good/20 text-good' : current ? 'bg-accent-deep/50 text-accent' : 'bg-ink-800 text-ink-500'
          }`}
        >
          {done ? '✓' : step.n}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${done ? 'text-ink-400' : 'text-ink-100'}`}>
            {step.title}
          </span>
          <span className="block truncate text-xs text-ink-500">{step.goal}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          {step.completion.kind === 'self' && !done && (
            <span className="chip border-ink-700 bg-ink-850 text-ink-500" title={step.completion.prompt}>
              you decide
            </span>
          )}
          <span className="text-2xs text-ink-600">{lab?.label}</span>
        </span>
      </Link>
    </li>
  )
}
