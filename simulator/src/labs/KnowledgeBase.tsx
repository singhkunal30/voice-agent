import { useMemo, useState, type ReactNode } from 'react'
import { KNOWLEDGE_CARDS, KNOWLEDGE_CATEGORIES } from '../knowledge/cards'
import type { KnowledgeCard } from '../domain/types'
import { Badge, KV, PageHeader, Panel } from '../ui/primitives'

export default function KnowledgeBase() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [selected, setSelected] = useState<KnowledgeCard | null>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return KNOWLEDGE_CARDS.filter((c) => {
      if (category !== 'all' && c.category !== category) return false
      if (!q) return true
      return (
        c.term.toLowerCase().includes(q) ||
        c.whatIsIt.toLowerCase().includes(q) ||
        c.whereInVoice.toLowerCase().includes(q) ||
        c.problemSolved.toLowerCase().includes(q)
      )
    })
  }, [query, category])

  const open = (id: string) => {
    const card = KNOWLEDGE_CARDS.find((c) => c.id === id)
    if (card) setSelected(card)
  }

  return (
    <div className="p-4">
      <PageHeader
        title="Technology Knowledge Base"
        subtitle="Every concept in the simulator, answering the same eight questions: what is it, why does it exist, what problem does it solve, where does it sit in a voice architecture, alternatives, limitations, scaling, failure modes."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search concepts… (e.g. jitter, idempotency, opus)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button
            className={`chip ${category === 'all' ? 'border-accent/50 bg-accent/10 text-accent' : 'border-ink-700 bg-ink-850 text-ink-400 hover:text-ink-200'}`}
            onClick={() => setCategory('all')}
          >
            All ({KNOWLEDGE_CARDS.length})
          </button>
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              className={`chip ${category === c.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-ink-700 bg-ink-850 text-ink-400 hover:text-ink-200'}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`grid gap-4 ${selected ? 'xl:grid-cols-[1fr,480px]' : ''}`}>
        <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className={`rounded-md border px-3 py-2 text-left transition-colors ${
                selected?.id === c.id ? 'border-accent-dim bg-ink-800' : 'border-ink-750 bg-ink-900 hover:border-ink-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink-100">{c.term}</span>
                <Badge>{c.category}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-ink-400">{c.whatIsIt}</p>
            </button>
          ))}
          {filtered.length === 0 && <div className="text-sm text-ink-500">No concepts match “{query}”.</div>}
        </div>

        {selected && (
          <Panel
            title={selected.term}
            right={<button className="text-ink-500 hover:text-ink-200" onClick={() => setSelected(null)}>✕</button>}
            className="h-fit animate-slide-in xl:sticky xl:top-4"
          >
            <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1 text-sm">
              <Field label="What is it?">{selected.whatIsIt}</Field>
              <Field label="Why does it exist?">{selected.whyExists}</Field>
              <Field label="What problem does it solve?">{selected.problemSolved}</Field>
              <Field label="Where does it appear in a voice architecture?">{selected.whereInVoice}</Field>
              {selected.alternatives.length > 0 && (
                <Field label="Alternatives">
                  <ul className="ml-4 list-disc">{selected.alternatives.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </Field>
              )}
              <Field label="Limitations">
                <ul className="ml-4 list-disc">{selected.limitations.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </Field>
              <Field label="Scaling implications">{selected.scaling}</Field>
              <Field label="Failure modes">
                <ul className="ml-4 list-disc">{selected.failureModes.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </Field>
              {selected.keyNumbers && (
                <Field label="Key numbers (simulation assumptions)">
                  <KV items={selected.keyNumbers.map((k) => ({ k: k.label, v: `${k.value} — ${k.note}` }))} />
                </Field>
              )}
              {selected.related.length > 0 && (
                <Field label="Related">
                  <div className="flex flex-wrap gap-1.5">
                    {selected.related.map((r) => {
                      const card = KNOWLEDGE_CARDS.find((c) => c.id === r)
                      return card ? (
                        <button key={r} className="chip border-accent/40 bg-accent/5 text-accent hover:bg-accent/15" onClick={() => open(r)}>
                          {card.term}
                        </button>
                      ) : null
                    })}
                  </div>
                </Field>
              )}
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-ink-300">{children}</div>
    </div>
  )
}
