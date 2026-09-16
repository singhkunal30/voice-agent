import { Link } from 'react-router-dom'
import { LEARNING_LEVELS } from '../domain/learning'
import { useAppStore } from '../state/store'
import { Badge, PageHeader, Panel } from '../ui/primitives'

export default function LearningPath() {
  const progress = useAppStore((s) => s.progress)
  const markProgress = useAppStore((s) => s.markProgress)
  const resetProgress = useAppStore((s) => s.resetProgress)
  const done = LEARNING_LEVELS.filter((l) => progress[l.flag]).length

  return (
    <div className="mx-auto max-w-4xl p-4">
      <PageHeader
        title="Learning Path"
        subtitle="Thirteen levels from 'what is a component' to 'design production architecture under pressure'. Progress is tracked locally in your browser — some levels self-complete as you use the labs; the judgment-based ones you check off yourself, honestly."
        right={
          <button className="btn btn-sm" onClick={resetProgress} title="Clear local progress">
            ↻ Reset progress
          </button>
        }
      />

      <div className="mb-4">
        <div className="mb-1 flex justify-between text-xs text-ink-400">
          <span>{done} of {LEARNING_LEVELS.length} levels complete</span>
          <span>{Math.round((done / LEARNING_LEVELS.length) * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / LEARNING_LEVELS.length) * 100}%` }} />
        </div>
      </div>

      <div className="space-y-2">
        {LEARNING_LEVELS.map((level) => {
          const complete = !!progress[level.flag]
          return (
            <Panel key={level.level} className={complete ? 'opacity-80' : ''}>
              <div className="flex items-start gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold ${
                  complete ? 'bg-good/20 text-good' : 'bg-ink-800 text-ink-300'
                }`}>
                  {complete ? '✓' : level.level}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink-100">Level {level.level}: {level.title}</h3>
                    {complete && <Badge tone="good">complete</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-400">{level.goal}</p>
                  <ul className="mt-1.5 ml-4 list-disc text-xs text-ink-500">
                    {level.criteria.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Link to={level.route} className="btn btn-sm justify-center">Open lab →</Link>
                  {!complete && (
                    <button className="btn btn-sm justify-center" onClick={() => markProgress(level.flag)} title="Mark this level complete">
                      Mark done
                    </button>
                  )}
                </div>
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
