import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAppStore } from './state/store'
import { GROUP_BY_ROUTE, LAB_BY_ROUTE, NAV_GROUPS, labNeighbours } from './nav'
import { CommandPalette } from './ui/CommandPalette'
import { GroupIcon } from './ui/GroupIcon'
import {
  COURSE_LENGTH,
  STEP_NUMBERS_BY_ROUTE,
  activeStepForRoute,
  courseNeighbours,
  doneCount,
  isCourseRoute,
} from './domain/learning'
import { CourseRail, OffPathNote } from './ui/CourseRail'

// Route-level code splitting keeps the initial bundle lean.
const Dashboard = lazy(() => import('./labs/Dashboard'))
const ScenarioLab = lazy(() => import('./labs/ScenarioLab'))
const LiveCall = lazy(() => import('./labs/LiveCall'))
const ArchitectureCanvas = lazy(() => import('./labs/ArchitectureCanvas'))
const PatternLibrary = lazy(() => import('./labs/PatternLibrary'))
const AudioLab = lazy(() => import('./labs/AudioLab'))
const LatencyLab = lazy(() => import('./labs/LatencyLab'))
const VadLab = lazy(() => import('./labs/VadLab'))
const SttLab = lazy(() => import('./labs/SttLab'))
const TtsLab = lazy(() => import('./labs/TtsLab'))
const AgentLab = lazy(() => import('./labs/AgentLab'))
const StateMachineLab = lazy(() => import('./labs/StateMachineLab'))
const TelephonyLab = lazy(() => import('./labs/TelephonyLab'))
const WebSocketLab = lazy(() => import('./labs/WebSocketLab'))
const WebRtcLab = lazy(() => import('./labs/WebRtcLab'))
const HandoffLab = lazy(() => import('./labs/HandoffLab'))
const ScalingLab = lazy(() => import('./labs/ScalingLab'))
const ChaosLab = lazy(() => import('./labs/ChaosLab'))
const ReliabilityLab = lazy(() => import('./labs/ReliabilityLab'))
const CostLab = lazy(() => import('./labs/CostLab'))
const DecisionLab = lazy(() => import('./labs/DecisionLab'))
const ComparisonLab = lazy(() => import('./labs/ComparisonLab'))
const ChallengeLab = lazy(() => import('./labs/ChallengeLab'))
const Observability = lazy(() => import('./labs/Observability'))
const KnowledgeBase = lazy(() => import('./labs/KnowledgeBase'))
const LearningPath = lazy(() => import('./labs/LearningPath'))

export default function App() {
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const scenario = useAppStore((s) => s.activeScenario)
  const progress = useAppStore((s) => s.progress)
  const [navOpen, setNavOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()

  const lab = LAB_BY_ROUTE[location.pathname]
  const group = GROUP_BY_ROUTE[location.pathname]
  const doneLevels = doneCount(progress)

  // Reading order follows the *course* whenever this lab is part of it, so
  // "next" continues the curriculum instead of silently dropping you out of it
  // into whatever happens to sit next in the menu.
  const courseStep = activeStepForRoute(location.pathname, progress)
  const onCourse = isCourseRoute(location.pathname)
  const menuNeighbours = labNeighbours(location.pathname)
  const courseNext = courseStep ? courseNeighbours(courseStep).next : null
  const coursePrev = courseStep ? courseNeighbours(courseStep).prev : null
  const prev = onCourse && coursePrev
    ? { route: coursePrev.route, label: coursePrev.title, blurb: `Step ${coursePrev.n} · ${coursePrev.goal}` }
    : menuNeighbours.prev
  const next = onCourse && courseNext
    ? { route: courseNext.route, label: courseNext.title, blurb: `Step ${courseNext.n} · ${courseNext.goal}` }
    : menuNeighbours.next

  // Only the group you are in stays open, so the sidebar shows a handful of
  // choices rather than all twenty-six at once.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({ start: true }))
  useEffect(() => {
    if (group) setOpenGroups((g) => ({ ...g, [group.id]: true }))
  }, [group])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
      // Bare "/" opens search, unless the learner is typing into something.
      const el = document.activeElement
      const typing = el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A new page should start at the top, not wherever the last one was scrolled.
  useEffect(() => {
    document.getElementById('lab-scroll')?.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={`${navOpen ? 'w-60' : 'w-14'} flex shrink-0 flex-col border-r border-ink-800 bg-ink-900 transition-all`}
      >
        <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-3">
          <button
            className="rounded p-1 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
            onClick={() => setNavOpen(!navOpen)}
            title={navOpen ? 'Collapse navigation' : 'Expand navigation'}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          {navOpen && (
            <Link to="/" className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-100">Voice Agent Sim</div>
              <div className="truncate text-2xs text-ink-500">Learn by building and breaking</div>
            </Link>
          )}
        </div>

        {navOpen && (
          <div className="px-3 py-2.5">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-left text-xs text-ink-500 transition-colors hover:border-ink-600 hover:text-ink-300"
            >
              <span>⌕</span>
              <span>Search labs…</span>
              <kbd className="ml-auto rounded border border-ink-700 px-1 py-0.5 font-mono text-2xs">⌘K</kbd>
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto pb-3">
          {NAV_GROUPS.map((g) => {
            const expanded = navOpen ? openGroups[g.id] : false
            const hasActive = g.items.some((i) => i.route === location.pathname)
            return (
              <div key={g.id} className="px-2">
                <button
                  onClick={() => (navOpen ? setOpenGroups((o) => ({ ...o, [g.id]: !o[g.id] })) : setNavOpen(true))}
                  title={g.blurb}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    hasActive && !expanded ? 'text-accent' : 'text-ink-400 hover:text-ink-200'
                  } hover:bg-ink-850`}
                >
                  <GroupIcon name={g.icon} className="h-4 w-4 shrink-0" />
                  {navOpen && (
                    <>
                      <span className="truncate text-2xs font-semibold uppercase tracking-wide">{g.title}</span>
                      <span className={`ml-auto shrink-0 text-2xs transition-transform ${expanded ? 'rotate-90' : ''}`}>
                        ›
                      </span>
                    </>
                  )}
                </button>
                {expanded && (
                  <div className="mb-1 ml-3 border-l border-ink-800 pl-1.5">
                    {g.items.map((item) => (
                      <NavLink
                        key={item.route}
                        to={item.route}
                        title={item.blurb}
                        className={({ isActive }) =>
                          `block truncate rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                            isActive
                              ? 'bg-accent-deep/25 font-medium text-accent'
                              : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'
                          }`
                        }
                      >
                        {item.label}
                        {/* Course steps are numbered in the menu too, so the
                            path through twenty-six labs is visible wherever
                            you happen to be looking. */}
                        {navOpen && STEP_NUMBERS_BY_ROUTE[item.route] && (
                          <span
                            className="ml-1.5 font-mono text-2xs text-accent/60"
                            title={`Course step ${STEP_NUMBERS_BY_ROUTE[item.route].join(' & ')}`}
                          >
                            {STEP_NUMBERS_BY_ROUTE[item.route].join(',')}
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {navOpen && (
          <Link
            to="/learn"
            className="border-t border-ink-800 px-3 py-2.5 transition-colors hover:bg-ink-850"
            title="Your progress through the guided course"
          >
            <div className="mb-1 flex items-baseline justify-between text-2xs">
              <span className="font-medium text-ink-300">Course progress</span>
              <span className="font-mono text-ink-500">
                {doneLevels}/{COURSE_LENGTH}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${(doneLevels / COURSE_LENGTH) * 100}%` }}
              />
            </div>
          </Link>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-800 bg-ink-900 px-4">
          {group && group.id !== 'start' && (
            <>
              <span className="hidden text-xs text-ink-500 sm:block">{group.title}</span>
              <span className="hidden text-xs text-ink-600 sm:block">/</span>
            </>
          )}
          <h1 className="truncate text-sm font-medium text-ink-200">{lab?.label ?? 'Voice Agent Simulator'}</h1>
          {scenario && (
            <Link
              to="/scenarios"
              className="chip border-accent-deep bg-accent-deep/20 text-accent hover:bg-accent-deep/40"
              title={`Active scenario: ${scenario.tagline}. Click to change.`}
            >
              {scenario.name}
            </Link>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden text-2xs text-ink-500 lg:block"
              title="Every number in this app is a labelled simulation assumption — the relationships are the lesson."
            >
              Simulated locally · no API keys
            </span>
            <button
              className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs text-ink-400 transition-colors hover:text-ink-100"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
              aria-label="Toggle colour theme"
            >
              {theme === 'dark' ? '☾' : '☀'}
            </button>
            <div
              className="flex items-center gap-1.5"
              title="Plain hides the advanced parameter panels and speaks in plain English. Engineering opens them all."
            >
              <span className="hidden text-2xs uppercase tracking-wide text-ink-500 xl:block">Detail</span>
              <div className="flex overflow-hidden rounded-md border border-ink-700 text-xs">
                <button
                  className={`px-2.5 py-1 ${viewMode === 'simple' ? 'bg-accent-deep/50 text-accent' : 'bg-ink-850 text-ink-400 hover:text-ink-200'}`}
                  onClick={() => setViewMode('simple')}
                >
                  Plain
                </button>
                <button
                  className={`px-2.5 py-1 ${viewMode === 'engineering' ? 'bg-accent-deep/50 text-accent' : 'bg-ink-850 text-ink-400 hover:text-ink-200'}`}
                  onClick={() => setViewMode('engineering')}
                >
                  Engineering
                </button>
              </div>
            </div>
          </div>
        </header>

        <main id="lab-scroll" className="min-h-0 flex-1 overflow-y-auto">
          {/* The course follows you into the lab. Without this the curriculum
              stops at the door and every lab feels like an unrelated tool. */}
          {onCourse ? (
            <CourseRail route={location.pathname} />
          ) : (
            location.pathname !== '/' && location.pathname !== '/learn' && (
              <OffPathNote route={location.pathname} />
            )
          )}
          <Suspense
            fallback={<div className="flex h-full items-center justify-center text-sm text-ink-500">Loading lab…</div>}
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/learn" element={<LearningPath />} />
              <Route path="/scenarios" element={<ScenarioLab />} />
              <Route path="/call" element={<LiveCall />} />
              <Route path="/canvas" element={<ArchitectureCanvas />} />
              <Route path="/patterns" element={<PatternLibrary />} />
              <Route path="/audio" element={<AudioLab />} />
              <Route path="/latency" element={<LatencyLab />} />
              <Route path="/vad" element={<VadLab />} />
              <Route path="/stt" element={<SttLab />} />
              <Route path="/tts" element={<TtsLab />} />
              <Route path="/agent" element={<AgentLab />} />
              <Route path="/state-machines" element={<StateMachineLab />} />
              <Route path="/telephony" element={<TelephonyLab />} />
              <Route path="/websocket" element={<WebSocketLab />} />
              <Route path="/webrtc" element={<WebRtcLab />} />
              <Route path="/handoff" element={<HandoffLab />} />
              <Route path="/scaling" element={<ScalingLab />} />
              <Route path="/chaos" element={<ChaosLab />} />
              <Route path="/reliability" element={<ReliabilityLab />} />
              <Route path="/cost" element={<CostLab />} />
              <Route path="/decisions" element={<DecisionLab />} />
              <Route path="/compare" element={<ComparisonLab />} />
              <Route path="/challenge" element={<ChallengeLab />} />
              <Route path="/observability" element={<Observability />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Suspense>

          {/* Reading order: you can walk the whole curriculum without the menu. */}
          {(prev || next) && (
            <div className="mx-auto flex max-w-6xl flex-wrap items-stretch gap-3 px-6 pb-8 pt-2">
              {prev ? (
                <Link
                  to={prev.route}
                  className="panel-pad group min-w-0 flex-1 transition-colors hover:border-accent-dim"
                >
                  <div className="text-2xs uppercase tracking-wide text-ink-500">← Previous</div>
                  <div className="truncate text-sm font-medium text-ink-200 group-hover:text-accent">{prev.label}</div>
                  <div className="truncate text-xs text-ink-500">{prev.blurb}</div>
                </Link>
              ) : (
                <div className="flex-1" />
              )}
              {next ? (
                <Link
                  to={next.route}
                  className="panel-pad group min-w-0 flex-1 text-right transition-colors hover:border-accent-dim"
                >
                  <div className="text-2xs uppercase tracking-wide text-ink-500">Next →</div>
                  <div className="truncate text-sm font-medium text-ink-200 group-hover:text-accent">{next.label}</div>
                  <div className="truncate text-xs text-ink-500">{next.blurb}</div>
                </Link>
              ) : (
                <div className="flex-1" />
              )}
            </div>
          )}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
