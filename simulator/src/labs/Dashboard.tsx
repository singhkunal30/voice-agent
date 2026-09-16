import { Link } from 'react-router-dom'
import { useAppStore } from '../state/store'
import { COURSE_LENGTH, STEP_NUMBERS_BY_ROUTE, currentStep, doneCount } from '../domain/learning'
import { NAV_GROUPS } from '../nav'
import { GroupIcon } from '../ui/GroupIcon'

/** Three ways in, chosen by what the visitor already knows. */
const ENTRY_POINTS = [
  {
    who: 'New to this',
    title: 'Take the guided course',
    desc: '13 steps, in order, each landing you in the lab that teaches it.',
    to: '/learn',
    cta: 'Start',
  },
  {
    who: 'Show me first',
    title: 'Watch a call happen',
    desc: 'Press play on a complete phone call, then interrupt the agent mid-sentence.',
    to: '/call',
    cta: 'Run a call',
  },
  {
    who: 'Building one for real',
    title: 'Design from requirements',
    desc: 'Describe what you need, get an architecture back with every tradeoff shown.',
    to: '/decisions',
    cta: 'Open',
  },
]

export default function Dashboard() {
  const progress = useAppStore((s) => s.progress)
  const scenario = useAppStore((s) => s.activeScenario)
  const done = doneCount(progress)
  const nextLevel = currentStep(progress)
  const started = done > 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-100">How voice agents actually work</h1>
      <p className="mt-2 max-w-xl text-base text-ink-400">
        Run them, break them, scale them, price them. Everything is simulated locally — no keys, no signup.
      </p>

      {started && nextLevel ? (
        <Link
          to={nextLevel.route}
          className="group mt-8 flex flex-wrap items-center gap-4 rounded-lg border border-accent/30 bg-accent/[0.06] px-5 py-4 transition-colors hover:border-accent-dim"
        >
          <div className="min-w-0 flex-1">
            <div className="text-2xs font-medium text-accent">
              Step {nextLevel.n} of {COURSE_LENGTH}
            </div>
            <div className="mt-0.5 text-base font-medium text-ink-100">{nextLevel.title}</div>
            <div className="text-sm text-ink-400">{nextLevel.goal}</div>
          </div>
          <span className="btn btn-primary shrink-0">Continue →</span>
        </Link>
      ) : null}

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {ENTRY_POINTS.map((e, i) => (
          <Link
            key={e.to}
            to={e.to}
            className={`group flex flex-col rounded-lg border p-5 transition-colors ${
              i === 0 && !started
                ? 'border-accent/40 bg-accent/[0.05] hover:border-accent-dim'
                : 'border-ink-750 bg-ink-900 hover:border-ink-600'
            }`}
          >
            <div className="text-2xs font-medium text-ink-500">{e.who}</div>
            <div className="mt-1 text-base font-medium text-ink-100 group-hover:text-accent">{e.title}</div>
            <p className="mt-1.5 flex-1 text-sm text-ink-400">{e.desc}</p>
            <div className="mt-4 text-sm font-medium text-accent">{e.cta} →</div>
          </Link>
        ))}
      </div>

      {scenario && (
        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-lg border border-ink-750 bg-ink-900 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <span className="text-2xs text-ink-500">Active scenario</span>
            <div className="text-sm font-medium text-ink-100">{scenario.name}</div>
          </div>
          <Link to="/scenarios" className="btn btn-sm shrink-0">
            Change
          </Link>
        </div>
      )}

      <div className="mt-12 mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink-100">All labs</h2>
        <span className="text-xs text-ink-500">
          <kbd className="rounded border border-ink-700 px-1 py-0.5 font-mono text-2xs">⌘K</kbd> to search
        </span>
      </div>
      {/* Columns, not a grid: groups have different lengths and a grid leaves
          ragged holes between rows. */}
      <div className="gap-x-8 sm:columns-2 lg:columns-3">
        {NAV_GROUPS.filter((g) => g.id !== 'start').map((g) => (
          <div key={g.id} className="mb-6 break-inside-avoid">
            <div className="mb-2 flex items-center gap-2 border-b border-ink-800 pb-1.5">
              <GroupIcon name={g.icon} className="h-4 w-4 text-ink-500" />
              <span className="text-2xs font-medium uppercase tracking-wide text-ink-500">{g.title}</span>
            </div>
            {g.items.map((i) => (
              <Link
                key={i.route}
                to={i.route}
                title={i.blurb}
                className="group -mx-2 flex items-baseline gap-2 rounded px-2 py-1 transition-colors hover:bg-ink-850"
              >
                <span className="text-sm text-ink-300 group-hover:text-accent">{i.label}</span>
                {/* Course steps carry their number, so the curriculum is
                    visible inside the full menu instead of being a separate
                    list you have to hold in your head. */}
                {STEP_NUMBERS_BY_ROUTE[i.route] && (
                  <span
                    className="shrink-0 font-mono text-2xs text-accent/70"
                    title={`Course step ${STEP_NUMBERS_BY_ROUTE[i.route].join(' & ')}`}
                  >
                    {STEP_NUMBERS_BY_ROUTE[i.route].map((n) => `·${n}`).join('')}
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-2xs text-ink-600">{i.minutes}m</span>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-12 max-w-2xl text-xs leading-relaxed text-ink-500">
        Every number here is an editable modelling assumption, not a measurement of any vendor. The relationships are
        what is worth learning.
      </p>
    </div>
  )
}
