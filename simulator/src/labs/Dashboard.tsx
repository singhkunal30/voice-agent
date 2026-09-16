import { Link } from 'react-router-dom'
import { PageHeader, Panel, Stat } from '../ui/primitives'
import { useAppStore } from '../state/store'
import { LEARNING_LEVELS } from '../domain/learning'
import { SCENARIOS } from '../scenarios/library'
import { COMPONENT_SPECS } from '../registry/components'
import { KNOWLEDGE_CARDS } from '../knowledge/cards'
import { PATTERNS } from '../patterns/library'

const MENTAL_MODEL = [
  'Requirements', 'Constraints', 'Architecture', 'Technology choices', 'Data / audio flow',
  'Latency', 'Infrastructure', 'Failure modes', 'Observability', 'Cost', 'Optimization',
]

const QUICK_PATHS: { title: string; desc: string; to: string; icon: string }[] = [
  { title: 'Run a simulated call', desc: 'Watch audio, transcripts, tokens and TTS chunks flow through a full pipeline — then interrupt the agent mid-sentence.', to: '/call', icon: '☎' },
  { title: 'Break something', desc: 'Kill the STT provider mid-call. Watch the failure propagate, then watch a fallback save it.', to: '/chaos', icon: '⚡' },
  { title: 'Feel the latency', desc: 'Move one slider, watch the whole waterfall recompute. Learn why streaming beats batch by seconds.', to: '/latency', icon: '⏱' },
  { title: 'Design from requirements', desc: 'Give the Decision Lab a brief and follow every Requirement → Constraint → Decision → Tradeoff chain.', to: '/decisions', icon: '⇶' },
  { title: 'Build your own', desc: 'Drag components onto the canvas, wire them up, and let 15+ engineering rules critique your design.', to: '/canvas', icon: '⬡' },
  { title: 'Take a challenge', desc: 'A generated brief, your architecture, an honest evaluation. No grades — engineering feedback.', to: '/challenge', icon: '🏁' },
]

export default function Dashboard() {
  const progress = useAppStore((s) => s.progress)
  const scenario = useAppStore((s) => s.activeScenario)
  const done = LEARNING_LEVELS.filter((l) => progress[l.flag]).length

  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader
        title="Voice Agent Architecture Simulator"
        subtitle="A flight simulator for voice/AI systems architecture. Everything here runs as a deterministic local simulation — no API keys, no external services. The numbers are labelled assumptions; the relationships between them are the curriculum."
      />

      {/* Mental model strip */}
      <Panel title="The mental model this simulator teaches" className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {MENTAL_MODEL.map((m, i) => (
            <span key={m} className="flex items-center gap-1.5">
              <span className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-ink-200">{m}</span>
              {i < MENTAL_MODEL.length - 1 && <span className="text-ink-600">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-400">
          Every lab manipulates one or more links in this chain, and every architectural decision the simulator makes is
          shown as <span className="text-ink-200">Requirement → Constraint → Decision → Tradeoff</span> — never as a bare verdict.
        </p>
      </Panel>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Learning levels" value={`${done} / ${LEARNING_LEVELS.length}`} tone={done > 0 ? 'accent' : 'default'} hint="Tracked locally in your browser" />
        <Stat label="Scenarios" value={SCENARIOS.length} hint="Realistic briefs, from browser assistants to 10k-concurrent platforms" />
        <Stat label="Components modelled" value={COMPONENT_SPECS.length} hint="Each with latency, scaling, cost and failure models" />
        <Stat label="Knowledge cards" value={KNOWLEDGE_CARDS.length} hint="PCM to circuit breakers, all searchable" />
      </div>

      {scenario && (
        <Panel title={`Active scenario: ${scenario.name}`} className="mb-4">
          <p className="text-sm text-ink-300">{scenario.story}</p>
          <div className="mt-2 flex gap-2">
            <Link to="/call" className="btn btn-primary btn-sm">Run its call</Link>
            <Link to="/scenarios" className="btn btn-sm">Change scenario</Link>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {QUICK_PATHS.map((q) => (
          <Link key={q.to} to={q.to} className="panel-pad group transition-colors hover:border-accent-dim">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-lg">{q.icon}</span>
              <span className="font-medium text-ink-100 group-hover:text-accent">{q.title}</span>
            </div>
            <p className="text-sm text-ink-400">{q.desc}</p>
          </Link>
        ))}
      </div>

      <Panel title="Grounded in real code" className="mt-4">
        <p className="text-sm text-ink-400">
          This repository also contains a <span className="font-mono text-ink-300">real</span> production-grade voice agent
          (FastAPI + Pipecat + Twilio Media Streams, in <span className="font-mono text-ink-300">app/</span>) that implements the
          “Simple customer support agent” scenario: streaming STT → LLM with tools → streaming TTS, idempotent booking,
          signature-verified webhooks. The simulator's media gateway / agent runtime components model that exact process —
          the labs teach the architecture it lives inside. {PATTERNS.length} editable reference patterns bridge the two.
        </p>
      </Panel>
    </div>
  )
}
