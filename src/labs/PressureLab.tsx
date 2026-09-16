/**
 * Pressure tests: what was this architecture quietly assuming?
 *
 * The canvas tells you whether a design is structurally valid today. This lab
 * asks the harder question — which of today's conditions is the design
 * depending on, and what happens when one of them changes.
 *
 * Every test gates on a prediction first, because the interesting information
 * is not "this breaks under 10× traffic". It is "I thought it would hold".
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../state/store'
import {
  PRESSURE_TESTS,
  runAllPressureTests,
  runPressureTest,
  summarisePressure,
  type PressureId,
  type PressureResult,
} from '../models/pressure'
import { checkCompliance, DATA_ARTEFACTS, REGIMES } from '../models/compliance'
import { PRESSURE_Q } from '../domain/prediction'
import { PredictionGate } from '../ui/Prediction'
import {
  Badge,
  Callout,
  EmptyState,
  NumberChip,
  PageHeader,
  Panel,
  SectionLabel,
  Verdict,
  fmtNum,
} from '../ui/primitives'
import { Segmented } from '../ui/controls'
import { SCENARIOS } from '../scenarios/library'
import type { Requirements } from '../domain/types'

type Tab = 'pressure' | 'exposure'

export default function PressureLab() {
  const arch = useAppStore((s) => s.workingArchitecture)
  const requirements = useAppStore((s) => s.activeRequirements)
  const markProgress = useAppStore((s) => s.markProgress)
  const [tab, setTab] = useState<Tab>('pressure')
  const [selected, setSelected] = useState<PressureId>('traffic-10x')
  const [runAll, setRunAll] = useState(false)

  // Without a brief there is nothing to apply pressure *against* — "10x the
  // traffic" needs a number to multiply. Fall back to a mid-size scenario and
  // say so, rather than inventing requirements silently.
  const fallback = SCENARIOS.find((s) => s.id === 'sc-support-handoff') ?? SCENARIOS[0]
  const req: Requirements = requirements ?? fallback.requirements
  const usingFallback = !requirements

  const result = useMemo(() => runPressureTest(arch, req, selected), [arch, req, selected])
  const all = useMemo(() => (runAll ? runAllPressureTests(arch, req) : null), [runAll, arch, req])
  const summary = all ? summarisePressure(all) : null
  const compliance = useMemo(() => checkCompliance(arch, req), [arch, req])

  // The course step here is a redesign, not a reading: remember the worst
  // verdict each test has produced this session, and only count a test that
  // the learner has since made hold. A design that held from the start proves
  // nothing about the person looking at it.
  const worstSeen = useRef(new Map<PressureId, string>())
  useEffect(() => {
    const previous = worstSeen.current.get(result.test.id)
    if (result.verdict === 'holds' && previous && previous !== 'holds') {
      markProgress('pressure-redesigned')
    }
    if (result.verdict !== 'holds' || !previous) worstSeen.current.set(result.test.id, result.verdict)
  }, [result, markProgress])

  return (
    <div className="p-5">
      <PageHeader
        title="Pressure tests"
        steps={[
          'Pick a pressure — start with "10× the traffic" — and commit to a verdict before you look.',
          'Read the findings top to bottom. Each one names what broke and the change that would survive it.',
          'Open the canvas, make that change, and run the same test again.',
          'When one design holds, press "Run every test" and find the one that does not.',
        ]}
        subtitle={
          <>
            An architecture is never simply good — it is good <i>for a set of conditions</i>, most of which its author
            never wrote down. Each test here removes one of those conditions and re-runs the same capacity, latency,
            cost and validation models against what is left. The verdict distinguishes needing a <b>bigger</b> system
            from needing a <b>different</b> one, because adding replicas is a purchase order and moving session state
            out of process memory is a project.
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <Segmented
              value={tab}
              onChange={setTab}
              ariaLabel="View"
              options={[
                { value: 'pressure', label: 'Pressure', title: 'Ten changes the world makes to a design' },
                { value: 'exposure', label: 'Data exposure', title: 'Security and compliance awareness' },
              ]}
            />
          </div>
        }
      />

      {usingFallback && (
        <Callout tone="info" title={`No brief selected — using "${fallback.name}" so the numbers mean something`}>
          Pressure is relative to a load, a latency target and an availability promise.{' '}
          <Link to="/scenarios" className="text-accent hover:underline">
            Pick a scenario
          </Link>{' '}
          to test against your own requirements instead.
        </Callout>
      )}

      {tab === 'pressure' ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[19rem,minmax(0,1fr)]">
            <div className="space-y-3">
              <Panel title="Apply a pressure" pad={false}>
                <div className="max-h-[32rem] overflow-y-auto p-1.5">
                  {PRESSURE_TESTS.map((t) => {
                    const verdict = all?.find((r) => r.test.id === t.id)?.verdict
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelected(t.id)}
                        className={`mb-1 block w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                          selected === t.id ? 'bg-accent-deep/25' : 'hover:bg-ink-850'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${selected === t.id ? 'text-accent' : 'text-ink-100'}`}>
                            {t.name}
                          </span>
                          {verdict && <span className="ml-auto shrink-0">{<Verdict value={verdict} size="sm" />}</span>}
                        </div>
                        <div className="mt-0.5 text-xs leading-snug text-ink-500">{t.change}</div>
                      </button>
                    )
                  })}
                </div>
              </Panel>

              <button className="btn btn-primary w-full justify-center" onClick={() => setRunAll(true)}>
                ⚡ Run every test against this design
              </button>

              {summary && (
                <Panel title="Across all ten">
                  <div className="mb-3 flex gap-2">
                    <Badge tone="good">{summary.holds} hold</Badge>
                    <Badge tone="warn">{summary.degrades} degrade</Badge>
                    <Badge tone="bad">{summary.breaks} break</Badge>
                  </div>
                  <SectionLabel hint="Worst first — this is the order to fix them in.">Fix next</SectionLabel>
                  <ol className="space-y-1.5">
                    {summary.worst.slice(0, 4).map((r) => (
                      <li key={r.test.id}>
                        <button
                          className="w-full text-left text-xs text-ink-400 hover:text-accent"
                          onClick={() => setSelected(r.test.id)}
                        >
                          <b className="text-ink-200">{r.test.name}</b> — {r.headline}
                        </button>
                      </li>
                    ))}
                  </ol>
                </Panel>
              )}

              <Panel title="Testing this design">
                <dl className="space-y-1.5 text-xs">
                  <Row k="Architecture" v={`${arch.name} · ${fmtNum(arch.nodes.length)} components`} />
                  <Row k="Peak concurrent" v={fmtNum(req.peakConcurrentCalls)} />
                  <Row k="Latency target" v={`${req.latencyTargetMs} ms`} />
                  <Row k="Availability" v={`${(req.availabilityTarget * 100).toFixed(2)}%`} />
                  <Row k="Regions" v={req.regions.join(', ')} />
                </dl>
                <Link to="/canvas" className="btn btn-sm mt-3 w-full justify-center">
                  Open this design on the canvas →
                </Link>
              </Panel>
            </div>

            <PredictionGate
              question={PRESSURE_Q}
              route="/pressure"
              actual={result.verdict}
              resetKey={`${selected}:${arch.nodes.length}:${req.peakConcurrentCalls}`}
              note={
                <>
                  <b className="text-ink-200">{result.test.name}:</b> {result.test.change} {result.test.trigger}
                </>
              }
            >
              <PressureReport result={result} />
            </PredictionGate>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <Callout tone="info" title="What this check is, and is not">
            {compliance.disclaimer}
          </Callout>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),20rem]">
            <div className="space-y-3">
              <Panel title="Findings for this architecture">
                {compliance.findings.length === 0 ? (
                  <EmptyState>
                    Nothing to report — which at this size usually means the architecture does not yet touch caller
                    data, not that it is safe.
                  </EmptyState>
                ) : (
                  <div className="space-y-2.5">
                    {compliance.findings.map((f, i) => (
                      <div
                        key={i}
                        className={`rounded-md border px-3 py-2.5 ${
                          f.severity === 'error' ? 'tone-bad' : f.severity === 'warning' ? 'tone-warn' : 'tone-info'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-100">
                            <span className="mr-1.5" aria-hidden>
                              {f.severity === 'error' ? '✕' : f.severity === 'warning' ? '⚠' : 'ℹ'}
                            </span>
                            {f.title}
                          </span>
                          <span className="ml-auto flex gap-1">
                            {f.regimes.map((r) => (
                              <span key={r} className="chip tone-neutral uppercase">
                                {r}
                              </span>
                            ))}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{f.detail}</p>
                        <p className="mt-1.5 text-sm leading-relaxed text-ink-400">
                          <b className="text-ink-200">What to do: </b>
                          {f.fix}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Every copy of caller data this design creates">
                <p className="mb-3 text-sm text-ink-400">
                  The list is the lesson. Most teams protect the first two and forget the rest — and an erasure request
                  has to reach all of them, including the ones held by vendors.
                </p>
                <div className="space-y-2">
                  {compliance.artefacts.map((a) => (
                    <div key={a.id} className="rounded-md border border-ink-800 bg-ink-850/40 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-100">{a.name}</span>
                        <span
                          className={`chip ${
                            a.sensitivity === 'critical' ? 'tone-bad' : a.sensitivity === 'high' ? 'tone-warn' : 'tone-neutral'
                          }`}
                        >
                          {a.sensitivity}
                        </span>
                        <span className="ml-auto text-2xs text-ink-500">{a.whereItLives}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-400">{a.easilyMissed}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="space-y-3">
              <Panel title="Regimes">
                <p className="mb-3 text-xs text-ink-500">
                  Highlighted ones are named in the current brief. The rest are here because the voice-specific trap in
                  each is worth knowing before a contract requires it.
                </p>
                <div className="space-y-2.5">
                  {REGIMES.map((r) => {
                    const active = compliance.applicable.some((x) => x.id === r.id)
                    return (
                      <div
                        key={r.id}
                        className={`rounded-md border px-3 py-2 ${active ? 'border-accent/40 bg-accent/[0.05]' : 'border-ink-800 bg-ink-850/30'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-ink-200'}`}>{r.name}</span>
                          {active && <span className="chip tone-info">in this brief</span>}
                        </div>
                        <p className="mt-0.5 text-2xs text-ink-500">{r.appliesWhen}</p>
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                          <b className="text-ink-300">The voice trap: </b>
                          {r.voiceTrap}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </Panel>

              <Panel title="The shape of the problem">
                <ul className="space-y-2 text-xs leading-relaxed text-ink-400">
                  <li>
                    <b className="text-ink-200">The input is biometric.</b> A recording identifies a person whether or
                    not anyone said anything sensitive.
                  </li>
                  <li>
                    <b className="text-ink-200">There is no password field on a phone call.</b> Sensitive data arrives
                    in the same channel as everything else and is captured by the same recorder.
                  </li>
                  <li>
                    <b className="text-ink-200">Every stage makes another copy.</b>{' '}
                    {DATA_ARTEFACTS.length} of them in a fully built pipeline, several held by companies you do not
                    control.
                  </li>
                  <li>
                    <b className="text-ink-200">Deletion is the hard part.</b> Deleting the recording is easy; reaching
                    the transcript, the derived analytics, the traces and the vendor&apos;s copy is the work.
                  </li>
                </ul>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PressureReport({ result }: { result: PressureResult }) {
  return (
    <div className="space-y-3">
      <Panel
        title={result.test.name}
        right={
          <>
            <Verdict value={result.verdict} />
            <NumberChip kind="ASSUMPTION" source="Derived from the capacity, latency and cost models, whose inputs are all editable." />
          </>
        }
      >
        <p className="text-base leading-relaxed text-ink-100">{result.headline}</p>
        <p className="mt-2 text-sm text-ink-400">
          <b className="text-ink-300">What this probes: </b>
          {result.test.probes}
        </p>

        {result.deltas.length > 0 && (
          <div className="mt-4">
            <SectionLabel>What moved</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {result.deltas.map((d, i) => (
                <div key={i} className="rounded-md border border-ink-800 bg-ink-850/40 px-3 py-2">
                  <div className="text-2xs text-ink-500">{d.label}</div>
                  <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-sm">
                    <span className="text-ink-400">{d.before}</span>
                    <span className="text-ink-600" aria-hidden>
                      →
                    </span>
                    <span className={d.worse ? 'text-bad' : 'text-ink-100'}>{d.after}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {result.findings.map((f, i) => (
        <div
          key={i}
          className={`panel-pad ${
            f.severity === 'breaks' ? 'border-bad/35' : f.severity === 'degrades' ? 'border-warn/35' : 'border-ink-750'
          }`}
        >
          <div className="flex flex-wrap items-start gap-2">
            <Verdict value={f.severity} size="sm" />
            <h3 className="min-w-0 flex-1 text-sm font-semibold text-ink-100">{f.title}</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-300">{f.detail}</p>
          <p className="mt-2 border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-ink-400">
            <b className="text-ink-200">What survives this: </b>
            {f.remedy}
          </p>
        </div>
      ))}

      <div className="panel-pad flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink-100">Now redesign for it</div>
          <p className="text-xs text-ink-500">
            A verdict you read is worth little. Change the architecture so this test passes, then run it again — the
            second verdict is the one that means something.
          </p>
        </div>
        <Link to="/canvas" className="btn btn-primary">
          Edit the architecture →
        </Link>
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
