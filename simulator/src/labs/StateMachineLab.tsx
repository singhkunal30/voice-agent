import { useMemo, useState } from 'react'
import { STATE_MACHINES } from '../models/stateMachines'
import type { StateDef, StateMachineDef } from '../domain/types'
import { Badge, PageHeader, Panel } from '../ui/primitives'
import { Segmented } from '../ui/controls'

export default function StateMachineLab() {
  const [machineId, setMachineId] = useState(STATE_MACHINES[0].id)
  const machine = STATE_MACHINES.find((m) => m.id === machineId)!
  const [current, setCurrent] = useState(machine.initial)
  const [selected, setSelected] = useState<StateDef | null>(null)
  const [history, setHistory] = useState<{ from: string; event: string; to: string }[]>([])

  const switchMachine = (id: string) => {
    const m = STATE_MACHINES.find((x) => x.id === id)!
    setMachineId(id)
    setCurrent(m.initial)
    setSelected(null)
    setHistory([])
  }

  const outgoing = machine.transitions.filter((t) => t.from === current)

  // Circular layout.
  const layout = useMemo(() => {
    const n = machine.states.length
    const cx = 340
    const cy = 210
    const r = 165
    const pos: Record<string, { x: number; y: number }> = {}
    machine.states.forEach((s, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2
      pos[s.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
    })
    return pos
  }, [machine])

  const fire = (event: string, to: string) => {
    setHistory((h) => [...h.slice(-11), { from: current, event, to }])
    setCurrent(to)
    setSelected(machine.states.find((s) => s.id === to) ?? null)
  }

  return (
    <div className="p-4">
      <PageHeader
        title="Conversation state"
        steps={[
          "Fire transitions one at a time and watch the current state move.",
          "Click a state to see what is allowed to happen from there — and what is not.",
          "Read “Why explicit machines?” only after you have got a call stuck.",
        ]}
        subtitle="Call and turn lifecycles, one transition at a time."
        right={
          <Segmented value={machineId} onChange={switchMachine} ariaLabel="State machine"
            options={STATE_MACHINES.map((m) => ({ value: m.id, label: m.name.replace(' state machine', '').replace(' sequence', '') }))} />
        }
      />

      <p className="mb-4 max-w-4xl text-sm text-ink-400">{machine.description}</p>

      <div className="grid gap-4 xl:grid-cols-[1fr,380px]">
        <Panel title="Machine" pad={false}>
          <svg viewBox="0 0 680 430" className="w-full">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--ink-500))" />
              </marker>
              <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(var(--accent))" />
              </marker>
            </defs>
            {machine.transitions.map((t, i) => {
              const a = layout[t.from]
              const b = layout[t.to]
              if (!a || !b) return null
              const activeEdge = t.from === current
              // shorten line to node edges
              const dx = b.x - a.x
              const dy = b.y - a.y
              const len = Math.hypot(dx, dy) || 1
              const off = 52
              const x1 = a.x + (dx / len) * off
              const y1 = a.y + (dy / len) * off
              const x2 = b.x - (dx / len) * off
              const y2 = b.y - (dy / len) * off
              // slight curve for bidirectional pairs
              const mx = (x1 + x2) / 2 - dy / len * 18
              const my = (y1 + y2) / 2 + dx / len * 18
              return (
                <g key={i}>
                  <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none"
                    stroke={activeEdge ? 'rgb(var(--accent))' : 'rgb(var(--ink-600))'} strokeWidth={activeEdge ? 1.8 : 1.1}
                    markerEnd={`url(#${activeEdge ? 'arrow-active' : 'arrow'})`} opacity={activeEdge ? 1 : 0.7} />
                  <text x={mx} y={my - 3} textAnchor="middle" fontSize={8} fill={activeEdge ? 'rgb(var(--series-sky))' : 'rgb(var(--ink-500))'}>
                    {t.event.length > 24 ? t.event.slice(0, 23) + '…' : t.event}
                  </text>
                </g>
              )
            })}
            {machine.states.map((s) => {
              const p = layout[s.id]
              const isCurrent = s.id === current
              const isSelected = selected?.id === s.id
              return (
                <g key={s.id} className="cursor-pointer" onClick={() => setSelected(s)}>
                  <rect x={p.x - 52} y={p.y - 18} width={104} height={36} rx={8}
                    fill={isCurrent ? 'rgb(var(--accent-deep))' : 'rgb(var(--ink-800))'}
                    stroke={isSelected ? 'rgb(var(--accent))' : isCurrent ? 'rgb(var(--accent))' : 'rgb(var(--ink-600))'}
                    strokeWidth={isSelected || isCurrent ? 2 : 1} />
                  <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={10.5} fontWeight={600}
                    fill={isCurrent ? 'rgb(var(--ink-100))' : 'rgb(var(--ink-200))'}>
                    {s.name.length > 16 ? s.name.slice(0, 15) + '…' : s.name}
                  </text>
                  {isCurrent && <circle cx={p.x - 44} cy={p.y - 10} r={3.5} fill="rgb(var(--good))" />}
                </g>
              )
            })}
          </svg>
          <div className="border-t border-ink-800 p-3">
            <div className="mb-2 text-xs text-ink-400">
              Current state: <span className="font-mono font-semibold text-accent">{current}</span> — fire an event:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {outgoing.map((t, i) => (
                <button key={i} className="btn btn-sm" onClick={() => fire(t.event, t.to)}
                  title={`${t.guard ? `guard: ${t.guard}\n` : ''}${t.action ? `action: ${t.action}` : ''}`}>
                  {t.event} → {t.to}
                </button>
              ))}
              {outgoing.length === 0 && <span className="text-xs text-ink-500">Terminal state. Reset by switching machines.</span>}
              <button className="btn btn-sm ml-auto" onClick={() => { setCurrent(machine.initial); setHistory([]) }}>↻ Reset</button>
            </div>
            {history.length > 0 && (
              <div className="mt-2 font-mono text-2xs text-ink-500">
                {history.map((h, i) => (
                  <span key={i}>
                    {h.from} —{h.event}→ {h.to}{i < history.length - 1 ? '  ·  ' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-3">
          {selected ? (
            <Panel title={selected.name} right={<Badge tone={selected.id === current ? 'accent' : 'neutral'}>{selected.id === current ? 'current' : 'state'}</Badge>}>
              <p className="mb-3 text-sm text-ink-300">{selected.description}</p>
              <Detail label="On entry" items={selected.onEntry} />
              <Detail label="Timers" items={selected.timers.map((t) => `${t.name}: ${t.ms >= 1000 ? `${t.ms / 1000}s` : `${t.ms}ms`} → ${t.onExpiry}`)} />
              <Detail label="Failure branches" items={selected.failures} tone="bad" />
              <Detail label="Cleanup" items={selected.cleanup} />
              <Detail label="On exit" items={selected.onExit} />
              <div className="mt-3">
                <div className="label">Valid transitions</div>
                <ul className="space-y-1 font-mono text-xs text-ink-300">
                  {machine.transitions.filter((t) => t.from === selected.id).map((t, i) => (
                    <li key={i}>
                      —{t.event}→ <span className="text-accent">{t.to}</span>
                      {t.guard && <span className="text-ink-500"> [if {t.guard}]</span>}
                      {t.action && <div className="ml-4 text-2xs text-ink-500">action: {t.action}</div>}
                    </li>
                  ))}
                  {machine.transitions.filter((t) => t.from === selected.id).length === 0 && <li className="text-ink-500">terminal</li>}
                </ul>
              </div>
            </Panel>
          ) : (
            <Panel title="Inspect a state">
              <p className="text-sm text-ink-400">
                Click any state in the diagram. Timers and failure branches are where voice systems live or die: the machine
                is not the happy path, it is everything the happy path forgot.
              </p>
            </Panel>
          )}

          <Panel title="Why explicit machines?">
            <p className="text-sm text-ink-400">
              The same event means different things in different states: <span className="font-mono text-xs text-ink-200">SPEECH_STARTED</span> is
              “user begins turn” in <span className="font-mono text-xs">LISTENING</span> but “barge-in!” in <span className="font-mono text-xs">SPEAKING</span>.
              Encoding that as a transition table makes weird orderings (transcript after hangup, tool result after transfer)
              a lookup instead of a bug. Watchdog timers per state are the safety net for the transitions you forgot.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, items, tone }: { label: string; items: string[]; tone?: 'bad' }) {
  if (!items.length) return null
  return (
    <div className="mb-2.5">
      <div className="label">{label}</div>
      <ul className={`ml-4 list-disc space-y-0.5 text-xs ${tone === 'bad' ? 'text-warn' : 'text-ink-300'}`}>
        {items.map((i, idx) => <li key={idx}>{i}</li>)}
      </ul>
    </div>
  )
}

export type { StateMachineDef }
