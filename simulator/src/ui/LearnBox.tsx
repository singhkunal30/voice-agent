import { useState } from 'react'
import type { LearningLevels } from '../domain/types'
import { useAppStore } from '../state/store'

const LEVELS: { key: keyof LearningLevels; label: string; question: string }[] = [
  { key: 'beginner', label: 'Beginner', question: 'What is happening?' },
  { key: 'engineering', label: 'Engineering', question: 'How does it work?' },
  { key: 'architecture', label: 'Architecture', question: 'Why is it needed?' },
  { key: 'infrastructure', label: 'Infrastructure', question: 'How does it scale?' },
  { key: 'production', label: 'Production', question: 'What can go wrong?' },
  { key: 'architect', label: 'Architect', question: 'How would you redesign it?' },
]

/**
 * Progressive-disclosure explainer: six levels from "what is happening" to
 * "redesign under new constraints". In Simple view it opens at Beginner; in
 * Engineering view at the Engineering level. Never a wall of text — one level
 * at a time, chosen by the learner.
 */
export function LearnBox({ learn, compact = false }: { learn: LearningLevels; compact?: boolean }) {
  const viewMode = useAppStore((s) => s.viewMode)
  const [level, setLevel] = useState<keyof LearningLevels>(viewMode === 'simple' ? 'beginner' : 'engineering')
  const active = LEVELS.find((l) => l.key === level)!

  return (
    <div className="rounded-md border border-ink-750 bg-ink-850">
      <div className="flex flex-wrap gap-1 border-b border-ink-800 p-1.5">
        {LEVELS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLevel(l.key)}
            title={l.question}
            className={`rounded px-2 py-0.5 text-2xs font-medium transition-colors ${
              level === l.key ? 'bg-accent-deep/60 text-accent' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className={`px-3 ${compact ? 'py-2' : 'py-2.5'}`}>
        <div className="mb-1 text-2xs font-medium uppercase tracking-wider text-ink-500">{active.question}</div>
        <p className="text-sm leading-relaxed text-ink-200">{learn[level]}</p>
      </div>
    </div>
  )
}
