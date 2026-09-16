import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ALL_LABS, GROUP_BY_ROUTE } from '../nav'

interface Hit {
  kind: 'lab' | 'concept'
  route: string
  title: string
  sub: string
  group: string
}

/**
 * ⌘K search over every lab and every glossary term.
 *
 * With two dozen labs, search — not a longer sidebar — is what makes the
 * whole thing explorable: you type "why is it slow" or "opus" and land in the
 * right place without knowing the menu structure.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [concepts, setConcepts] = useState<Hit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The glossary is a large data module — only pull it in once the palette is
  // actually opened, so it never weighs on first paint.
  useEffect(() => {
    if (!open || concepts.length) return
    let cancelled = false
    import('../knowledge/cards').then((m) => {
      if (cancelled) return
      setConcepts(
        m.KNOWLEDGE_CARDS.map((c) => ({
          kind: 'concept' as const,
          route: `/knowledge?card=${c.id}`,
          title: c.term,
          sub: c.whatIsIt,
          group: 'Glossary',
        })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [open, concepts.length])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // Focus after the dialog paints.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const labHits: Hit[] = useMemo(
    () =>
      ALL_LABS.map((l) => ({
        kind: 'lab' as const,
        route: l.route,
        title: l.label,
        sub: l.blurb,
        group: GROUP_BY_ROUTE[l.route]?.title ?? '',
      })),
    [],
  )

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return labHits
    const score = (h: Hit, extra: string) => {
      const hay = `${h.title} ${h.sub} ${extra}`.toLowerCase()
      if (h.title.toLowerCase().startsWith(q)) return 0
      if (h.title.toLowerCase().includes(q)) return 1
      if (hay.includes(q)) return 2
      // Loose match: every word of the query appears somewhere.
      return q.split(/\s+/).every((w) => hay.includes(w)) ? 3 : 99
    }
    const labs = ALL_LABS.map((l, i) => ({ hit: labHits[i], s: score(labHits[i], `${l.question} ${l.keywords.join(' ')}`) }))
    const cards = concepts.map((c) => ({ hit: c, s: score(c, '') + 0.5 }))
    return [...labs, ...cards]
      .filter((r) => r.s < 99)
      .sort((a, b) => a.s - b.s)
      .slice(0, 12)
      .map((r) => r.hit)
  }, [query, labHits, concepts])

  useEffect(() => {
    setCursor(0)
  }, [query])

  // Keep the highlighted row in view when navigating with the keyboard.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  const go = (hit?: Hit) => {
    if (!hit) return
    navigate(hit.route)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/70 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search labs and concepts"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 border-b border-ink-800 px-4">
          <span className="text-ink-500">⌕</span>
          <input
            ref={inputRef}
            className="w-full bg-transparent py-3.5 text-sm text-ink-100 placeholder-ink-500 outline-none"
            placeholder="Search labs and concepts — try “slow”, “cost”, or “opus”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                go(results[cursor])
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
          />
          <kbd className="shrink-0 rounded border border-ink-700 px-1.5 py-0.5 font-mono text-2xs text-ink-500">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-ink-500">
              Nothing matched “{query}”. Try a plainer word, like “slow” or “phone”.
            </div>
          )}
          {results.map((hit, i) => (
            <button
              key={`${hit.kind}-${hit.route}-${hit.title}`}
              data-active={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(hit)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                i === cursor ? 'bg-ink-800' : ''
              }`}
            >
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ${
                  hit.kind === 'lab' ? 'bg-accent-deep/40 text-accent' : 'bg-ink-800 text-ink-400'
                }`}
              >
                {hit.kind === 'lab' ? 'lab' : 'term'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-100">{hit.title}</span>
                <span className="block truncate text-xs text-ink-500">{hit.sub}</span>
              </span>
              <span className="hidden shrink-0 text-2xs text-ink-600 sm:block">{hit.group}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-ink-800 px-4 py-2 text-2xs text-ink-500">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      </div>
    </div>
  )
}
