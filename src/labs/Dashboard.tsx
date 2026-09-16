/**
 * The workspace home.
 *
 * V1's home was a menu with a headline on top. V2's answers three questions in
 * order, because those are the three a returning user actually has:
 *
 *   1. Where was I? (the course, and the design on the canvas)
 *   2. How is my current design doing? (pressure, validation — at a glance)
 *   3. What do I still get wrong? (the prediction record)
 *
 * The full lab index stays, underneath, for when none of that applies.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../state/store'
import { COURSE_LENGTH, STEP_NUMBERS_BY_ROUTE, currentStep, doneCount } from '../domain/learning'
import { NAV_GROUPS } from '../nav'
import { GroupIcon } from '../ui/GroupIcon'
import { PredictionRecord } from '../ui/Prediction'
import { runAllPressureTests, summarisePressure } from '../models/pressure'
import { validateArchitecture } from '../validation/rules'
import { SCENARIOS } from '../scenarios/library'
import { Badge, Panel, SectionLabel, Verdict } from '../ui/primitives'

/** The loop the whole workspace is built around. */
const LOOP = [
  { verb: 'Design', where: '/canvas', what: 'Draw the architecture, or start from a reference pattern.' },
  { verb: 'Predict', where: '/pressure', what: 'Commit to an answer before you look. This is the step people skip.' },
  { verb: 'Simulate', where: '/call', what: 'Run it and watch every event, on a seed you can reproduce.' },
  { verb: 'Observe', where: '/observability', what: 'Read what the numbers actually say, not what you hoped.' },
  { verb: 'Redesign', where: '/decisions', what: 'Change one thing and go round again.' },
]

export default function Dashboard() {
  const progress = useAppStore((s) => s.progress)
  const scenario = useAppStore((s) => s.activeScenario)
  const arch = useAppStore((s) => s.workingArchitecture)
  const requirements = useAppStore((s) => s.activeRequirements)
  const predictions = useAppStore((s) => s.predictions)

  const done = doneCount(progress)
  const next = currentStep(progress)
  const started = done > 0

  const req = requirements ?? SCENARIOS.find((s) => s.id === 'sc-support-handoff')?.requirements ?? SCENARIOS[0].requirements
  const pressure = useMemo(() => summarisePressure(runAllPressureTests(arch, req)), [arch, req])
  const issues = useMemo(() => validateArchitecture(arch, requirements ?? undefined), [arch, requirements])
  const errors = issues.filter((i) => i.severity === 'error').length

  return (
    <div className="px-6 py-8">
      <header className="max-w-3xl">
        <h1 className="text-display font-semibold text-ink-100">Design it. Break it. Find out why.</h1>
        <p className="mt-2 text-base leading-relaxed text-ink-400">
          A workspace for voice-agent architecture. Everything runs locally against a deterministic simulation — no
          keys, no accounts, no network. Every figure is labelled with where it came from.
        </p>
      </header>

      {/* The loop, stated once, as navigation. */}
      <nav aria-label="The working loop" className="mt-6 flex flex-wrap items-stretch gap-2">
        {LOOP.map((s, i) => (
          <Link
            key={s.verb}
            to={s.where}
            className="group relative flex min-w-[9.5rem] flex-1 flex-col rounded-lg border border-ink-800 bg-ink-900 px-3.5 py-3 transition-colors hover:border-accent-dim"
          >
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-2xs text-ink-600">{i + 1}</span>
              <span className="text-sm font-medium text-ink-100 group-hover:text-accent">{s.verb}</span>
            </span>
            <span className="mt-1 text-xs leading-snug text-ink-500">{s.what}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr),22rem]">
        <div className="space-y-4">
          {started && next ? (
            <Link
              to={next.route}
              className="group flex flex-wrap items-center gap-4 rounded-lg border border-accent/30 bg-accent/[0.06] px-5 py-4 transition-colors hover:border-accent-dim"
            >
              <div className="min-w-0 flex-1">
                <div className="text-2xs font-medium text-accent">
                  Continue the course · step {next.n} of {COURSE_LENGTH}
                </div>
                <div className="mt-0.5 text-base font-medium text-ink-100">{next.title}</div>
                <div className="text-sm text-ink-400">{next.goal}</div>
              </div>
              <span className="btn btn-primary shrink-0">Continue →</span>
            </Link>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {[
                {
                  who: 'New to this',
                  title: 'Take the guided course',
                  desc: `${COURSE_LENGTH} steps, in order, each landing you in the lab that teaches it.`,
                  to: '/learn',
                  cta: 'Start',
                },
                { who: 'Show me first', title: 'Watch a call happen', desc: 'Press play on a complete phone call, then interrupt the agent mid-sentence.', to: '/call', cta: 'Run a call' },
                { who: 'Building one for real', title: 'Design from requirements', desc: 'Describe what you need, get an architecture back with every tradeoff shown.', to: '/decisions', cta: 'Open' },
              ].map((e, i) => (
                <Link
                  key={e.to}
                  to={e.to}
                  className={`group flex flex-col rounded-lg border p-5 transition-colors ${
                    i === 0 ? 'border-accent/40 bg-accent/[0.05] hover:border-accent-dim' : 'border-ink-750 bg-ink-900 hover:border-ink-600'
                  }`}
                >
                  <div className="text-2xs font-medium text-ink-500">{e.who}</div>
                  <div className="mt-1 text-base font-medium text-ink-100 group-hover:text-accent">{e.title}</div>
                  <p className="mt-1.5 flex-1 text-sm text-ink-400">{e.desc}</p>
                  <div className="mt-4 text-sm font-medium text-accent">{e.cta} →</div>
                </Link>
              ))}
            </div>
          )}

          <Panel
            title="Your current design, under pressure"
            right={
              <>
                <Badge tone="good">{pressure.holds} hold</Badge>
                <Badge tone="warn">{pressure.degrades} degrade</Badge>
                <Badge tone="bad">{pressure.breaks} break</Badge>
              </>
            }
          >
            <p className="mb-3 text-sm text-ink-400">
              <b className="text-ink-200">{arch.name}</b> · {arch.nodes.length} components, validated against{' '}
              {requirements ? requirements.name : 'a default brief'}.{' '}
              {errors > 0 ? (
                <span className="text-bad">
                  {errors} structural error{errors > 1 ? 's' : ''} before any pressure is applied.
                </span>
              ) : (
                <span className="text-good">No structural errors.</span>
              )}
            </p>
            <SectionLabel hint="Worst first — this is the order to fix them in.">Fix next</SectionLabel>
            <ul className="space-y-1.5">
              {pressure.worst.slice(0, 3).map((r) => (
                <li key={r.test.id} className="flex items-start gap-2.5 text-sm">
                  <span className="shrink-0">
                    <Verdict value={r.verdict} size="sm" />
                  </span>
                  <span className="min-w-0">
                    <b className="text-ink-200">{r.test.name}</b>{' '}
                    <span className="text-ink-400">{r.headline}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Link to="/pressure" className="btn btn-sm btn-primary">
                Run the pressure tests →
              </Link>
              <Link to="/canvas" className="btn btn-sm">
                Edit the design
              </Link>
            </div>
          </Panel>

          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-ink-100">All labs</h2>
              <span className="text-xs text-ink-500">
                <kbd className="kbd">⌘K</kbd> to search
              </span>
            </div>
            {/* Columns, not a grid: groups have different lengths and a grid
                leaves ragged holes between rows. */}
            <div className="gap-x-8 sm:columns-2 xl:columns-3">
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
                      {STEP_NUMBERS_BY_ROUTE[i.route] && (
                        <span
                          className="shrink-0 font-mono text-2xs text-accent/70"
                          title={`Course step ${STEP_NUMBERS_BY_ROUTE[i.route].join(' & ')}`}
                        >
                          {STEP_NUMBERS_BY_ROUTE[i.route].map((n) => `·${n}`).join('')}
                        </span>
                      )}
                      {i.isNew && <span className="shrink-0 text-2xs text-media">new</span>}
                      <span className="ml-auto shrink-0 font-mono text-2xs text-ink-600">{i.minutes}m</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <Panel title="What you have predicted">
            <PredictionRecord />
            {predictions.length === 0 && (
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                Labs that can measure something ask you to commit to a band before they show you the answer. Getting it
                wrong is the point — a number you predicted wrongly is the only kind you remember.
              </p>
            )}
          </Panel>

          {scenario ? (
            <Panel title="Active brief">
              <div className="text-sm font-medium text-ink-100">{scenario.name}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">{scenario.tagline}</p>
              <dl className="mt-3 space-y-1 text-xs">
                <Row k="Peak concurrent" v={scenario.requirements.peakConcurrentCalls.toLocaleString()} />
                <Row k="Latency target" v={`${scenario.requirements.latencyTargetMs} ms`} />
                <Row k="Languages" v={scenario.requirements.languages.join(', ')} />
              </dl>
              <Link to="/scenarios" className="btn btn-sm mt-3 w-full justify-center">
                Change brief
              </Link>
            </Panel>
          ) : (
            <Panel title="No brief selected">
              <p className="text-xs leading-relaxed text-ink-400">
                Pick a realistic brief and every other lab works against it — the capacity model, the cost model, the
                pressure tests and the validator all read the same requirements.
              </p>
              <Link to="/scenarios" className="btn btn-sm btn-primary mt-3 w-full justify-center">
                Choose a brief →
              </Link>
            </Panel>
          )}

          <Panel title="How to read the numbers">
            <ul className="space-y-2 text-xs leading-relaxed text-ink-400">
              <li>
                <b className="text-ink-300">≈ assumption</b> — a value this simulator picked. Change it and see whether
                the conclusion survives.
              </li>
              <li>
                <b className="text-control">§ reference</b> — fixed by a standard or by arithmetic. G.711 is 64 kbit/s
                because 8000 × 8 is 64,000.
              </li>
              <li>
                <b className="text-media">◉ measured</b> — produced by a seeded run here. Re-run the seed and the same
                number comes back.
              </li>
            </ul>
            <p className="mt-2.5 text-2xs leading-relaxed text-ink-500">
              None of the three is a measurement of any vendor&apos;s production system. The relationships between them
              are what is worth learning.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="truncate font-mono text-ink-200">{v}</dd>
    </div>
  )
}
