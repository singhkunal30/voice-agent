import { Suspense, lazy, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useAppStore } from './state/store'

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

interface NavItem {
  to: string
  label: string
  icon: string
}
interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    title: 'Start',
    items: [
      { to: '/', label: 'Dashboard', icon: '◉' },
      { to: '/learn', label: 'Learning Path', icon: '⬆' },
      { to: '/scenarios', label: 'Scenario Lab', icon: '⎈' },
    ],
  },
  {
    title: 'Simulate',
    items: [
      { to: '/call', label: 'Live Call Simulator', icon: '☎' },
      { to: '/canvas', label: 'Architecture Canvas', icon: '⬡' },
      { to: '/patterns', label: 'Pattern Library', icon: '❖' },
      { to: '/observability', label: 'Observability', icon: '∿' },
    ],
  },
  {
    title: 'Media & speech',
    items: [
      { to: '/audio', label: 'Audio Lab', icon: '♫' },
      { to: '/latency', label: 'Latency Lab', icon: '⏱' },
      { to: '/vad', label: 'VAD & Turns', icon: '▌' },
      { to: '/stt', label: 'STT Lab', icon: '𝄆' },
      { to: '/tts', label: 'TTS Lab', icon: '🗣' },
    ],
  },
  {
    title: 'Agent & transport',
    items: [
      { to: '/agent', label: 'Agent Runtime', icon: '⚙' },
      { to: '/state-machines', label: 'State Machines', icon: '⇄' },
      { to: '/telephony', label: 'Telephony Lab', icon: '⌗' },
      { to: '/websocket', label: 'WebSocket Lab', icon: '⇌' },
      { to: '/webrtc', label: 'WebRTC Lab', icon: '⛁' },
      { to: '/handoff', label: 'Human Handoff', icon: '☍' },
    ],
  },
  {
    title: 'Production',
    items: [
      { to: '/scaling', label: 'Infra & Scaling', icon: '▤' },
      { to: '/chaos', label: 'Failure / Chaos', icon: '⚡' },
      { to: '/reliability', label: 'Reliability Lab', icon: '⛨' },
      { to: '/cost', label: 'Cost Simulator', icon: '＄' },
    ],
  },
  {
    title: 'Architect',
    items: [
      { to: '/decisions', label: 'Decision Lab', icon: '⇶' },
      { to: '/compare', label: 'Compare Architectures', icon: '≍' },
      { to: '/challenge', label: 'Challenge Mode', icon: '🏁' },
      { to: '/knowledge', label: 'Knowledge Base', icon: '📚' },
    ],
  },
]

export default function App() {
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const scenario = useAppStore((s) => s.activeScenario)
  const [navOpen, setNavOpen] = useState(true)
  const location = useLocation()

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${navOpen ? 'w-56' : 'w-12'} flex shrink-0 flex-col border-r border-ink-800 bg-ink-900 transition-all`}
      >
        <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-3">
          <button
            className="text-ink-400 hover:text-ink-100"
            onClick={() => setNavOpen(!navOpen)}
            title="Toggle navigation"
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          {navOpen && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-100">Voice Agent Sim</div>
              <div className="truncate text-2xs text-ink-500">Architecture Learning Lab</div>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map((group) => (
            <div key={group.title} className="mb-2">
              {navOpen && (
                <div className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-widest text-ink-500">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'border-r-2 border-accent bg-ink-800 text-accent'
                        : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100'
                    }`
                  }
                >
                  <span className="w-4 text-center text-xs opacity-80">{item.icon}</span>
                  {navOpen && <span className="truncate">{item.label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-4">
          <h1 className="truncate text-sm font-medium text-ink-200">
            {NAV.flatMap((g) => g.items).find((i) => i.to === location.pathname)?.label ?? 'Voice Agent Simulator'}
          </h1>
          {scenario && (
            <span className="chip border-accent-deep bg-accent-deep/20 text-accent" title={scenario.tagline}>
              ⎈ {scenario.name}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-2xs text-ink-500 sm:block" title="Every number in this app is a labelled simulation assumption — the relationships are the lesson.">
              Deterministic local simulation · no APIs · no keys
            </span>
            <div className="flex overflow-hidden rounded-md border border-ink-700 text-xs">
              <button
                className={`px-2.5 py-1 ${viewMode === 'simple' ? 'bg-accent-deep/50 text-accent' : 'bg-ink-850 text-ink-400 hover:text-ink-200'}`}
                onClick={() => setViewMode('simple')}
                title="Plain-English explanations"
              >
                Simple
              </button>
              <button
                className={`px-2.5 py-1 ${viewMode === 'engineering' ? 'bg-accent-deep/50 text-accent' : 'bg-ink-850 text-ink-400 hover:text-ink-200'}`}
                onClick={() => setViewMode('engineering')}
                title="Full engineering detail"
              >
                Engineering
              </button>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-ink-500">Loading lab…</div>
            }
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
        </main>
      </div>
    </div>
  )
}
