import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LEARNING_LEVELS } from '../domain/learning'
import { useAppStore } from '../state/store'
import { PageHeader } from '../ui/primitives'
import { LAB_BY_ROUTE } from '../nav'

/**
 * The thirteen levels grouped into five stages. Grouping is presentation only —
 * a flat list of thirteen numbered cards reads as a wall; five named stages
 * read as a journey with a visible finish line.
 */
const STAGES: { title: string; blurb: string; levels: [number, number] }[] = [
  {
    title: 'Foundations',
    blurb: 'What the pieces are, and how one turn of conversation flows through them.',
    levels: [1, 3],
  },
  {
    title: 'Make it feel human',
    blurb: 'Turn-taking, interruptions, tools and memory — the difference between a demo and a conversation.',
    levels: [4, 5],
  },
  {
    title: 'Connect the real world',
    blurb: 'Phone networks and human colleagues, both of which have opinions.',
    levels: [6, 7],
  },
  {
    title: 'Run it in production',
    blurb: 'Scale, design, failure and cost — everything that only shows up after launch.',
    levels: [8, 12],
  },
  {
    title: 'Prove it',
    blurb: 'Do it yourself, on a brief you have not seen before.',
    levels: [13, 13],
  },
]

export default function LearningPath() {
  const progress = useAppStore((s) => s.progress)
  const markProgress = useAppStore((s) => s.markProgress)
  const resetProgress = useAppStore((s) => s.resetProgress)
  const done = LEARNING_LEVELS.filter((l) => progress[l.flag]).length
  const current = LEARNING_LEVELS.find((l) => !progress[l.flag])
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <PageHeader
        title="Guided course"
        question="What order should I learn this in?"
        subtitle="Thirteen steps, each one landing you in the lab that teaches it. Some steps tick themselves off as you use the labs; the judgment-based ones you tick off yourself, honestly. Progress lives in this browser only — nothing is uploaded."
        right={
          <button className="btn btn-sm" onClick={resetProgress} title="Clear local progress">
            ↻ Reset
          </button>
        }
      />

      <div className="mb-8 panel-pad">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-ink-300">
            {done === 0 ? 'Not started yet' : done === LEARNING_LEVELS.length ? 'Course complete' : `${done} of ${LEARNING_LEVELS.length} steps done`}
          </span>
          <span className="font-mono text-xs text-ink-500">{Math.round((done / LEARNING_LEVELS.length) * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${(done / LEARNING_LEVELS.length) * 100}%` }}
          />
        </div>
        {current && (
          <Link
            to={current.route}
            className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/[0.06] px-4 py-3 transition-colors hover:border-accent-dim"
          >
            <div className="min-w-0 flex-1">
              <div className="text-2xs font-semibold uppercase tracking-wide text-accent">
                {done === 0 ? 'Start here' : 'Up next'} · step {current.level}
              </div>
              <div className="mt-0.5 font-medium text-ink-100">{current.title}</div>
            </div>
            <span className="btn btn-primary btn-sm shrink-0">
              Open {LAB_BY_ROUTE[current.route]?.label ?? 'lab'} →
            </span>
          </Link>
        )}
      </div>

      <div className="space-y-8">
        {STAGES.map((stage, si) => {
          const levels = LEARNING_LEVELS.filter((l) => l.level >= stage.levels[0] && l.level <= stage.levels[1])
          const stageDone = levels.filter((l) => progress[l.flag]).length
          const complete = stageDone === levels.length
          return (
            <section key={stage.title}>
              <div className="mb-3 flex items-baseline gap-3">
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
                  {stageDone}/{levels.length}
                </span>
              </div>

              <div className="ml-3 space-y-1.5 border-l border-ink-800 pl-6">
                {levels.map((level) => {
                  const isDone = !!progress[level.flag]
                  const isCurrent = current?.level === level.level
                  const isOpen = expanded === level.level || isCurrent
                  const lab = LAB_BY_ROUTE[level.route]
                  return (
                    <div
                      key={level.level}
                      className={`rounded-lg border transition-colors ${
                        isCurrent
                          ? 'border-accent/40 bg-accent/[0.04]'
                          : isDone
                            ? 'border-ink-800 bg-ink-900/50'
                            : 'border-ink-800 bg-ink-900'
                      }`}
                    >
                      <button
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                        onClick={() => setExpanded(expanded === level.level ? -1 : level.level)}
                        aria-expanded={isOpen}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-2xs font-semibold ${
                            isDone ? 'bg-good/20 text-good' : isCurrent ? 'bg-accent-deep/50 text-accent' : 'bg-ink-800 text-ink-500'
                          }`}
                        >
                          {isDone ? '✓' : level.level}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm font-medium ${isDone ? 'text-ink-400' : 'text-ink-100'}`}
                          >
                            {level.title}
                          </span>
                          {!isOpen && <span className="block truncate text-xs text-ink-500">{level.goal}</span>}
                        </span>
                        {lab && <span className="hidden shrink-0 text-2xs text-ink-600 sm:block">{lab.label}</span>}
                      </button>

                      {isOpen && (
                        <div className="border-t border-ink-800 px-4 py-3">
                          <p className="text-sm text-ink-300">{level.goal}</p>
                          <div className="mt-2.5 text-2xs font-semibold uppercase tracking-wide text-ink-500">
                            Done when you have
                          </div>
                          <ul className="mt-1 space-y-1">
                            {level.criteria.map((c, i) => (
                              <li key={i} className="flex gap-2 text-sm text-ink-300">
                                <span className="text-ink-600">·</span>
                                {c}
                              </li>
                            ))}
                          </ul>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link to={level.route} className={`btn btn-sm ${isCurrent ? 'btn-primary' : ''}`}>
                              Open {lab?.label ?? 'lab'} →
                            </Link>
                            {!isDone && (
                              <button className="btn btn-sm" onClick={() => markProgress(level.flag)}>
                                ✓ Mark done
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
