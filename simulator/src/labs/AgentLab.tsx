import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_RELIABILITY, simulateCall } from '../engine/callSim'
import { LLM_PROVIDERS } from '../providers/simulated'
import { EventTimeline } from '../ui/EventTimeline'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { NumberInput, Select, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'

interface ToolDef {
  id: string
  name: string
  latencyMs: number
  result: string
  args: Record<string, string>
  blocking: boolean
  note: string
}

const TOOL_CATALOG: ToolDef[] = [
  { id: 'customer_lookup', name: 'customer_lookup', latencyMs: 120, result: '{ name: "Jane Doe", tier: "gold", since: 2019 }', args: { phone: '"+91-98xxx"' }, blocking: true, note: 'Fast read; fine on the turn.' },
  { id: 'policy_lookup', name: 'policy_lookup', latencyMs: 180, result: '{ policy: "TERM-1CR", status: "active", premium_due: "2026-10-01" }', args: { customer_id: '"C-1042"' }, blocking: true, note: 'Fast read; fine on the turn.' },
  { id: 'premium_calculator', name: 'premium_calculator', latencyMs: 260, result: '{ monthly: 2100, currency: "INR", riders: ["accidental"] }', args: { cover: '10000000', age: '31', term_years: '25' }, blocking: true, note: 'Compute service; budget 1.5 s.' },
  { id: 'crm_update', name: 'crm_update', latencyMs: 900, result: '{ queued: true }', args: { interaction: '"quote_given"' }, blocking: false, note: 'WRITE — belongs on the queue, not the turn.' },
  { id: 'database_query', name: 'database_query', latencyMs: 350, result: '{ rows: 3 }', args: { sql: '"select … from orders"' }, blocking: true, note: 'Pooled read replica; watch p99.' },
  { id: 'payment_api', name: 'payment_api', latencyMs: 1400, result: '{ link_sent: true }', args: { amount: '2100' }, blocking: false, note: 'External + slow + consequential: async with spoken confirmation.' },
  { id: 'calendar_booking', name: 'calendar_booking', latencyMs: 420, result: '{ slot: "Tue 10:30", confirmation: "AB12CD" }', args: { date: '"2026-09-22"', time: '"10:30"' }, blocking: true, note: 'Write with idempotency key — this repo\'s handlers.py pattern.' },
  { id: 'search', name: 'knowledge_search', latencyMs: 280, result: '{ passages: 3, top: "Term policies cover…" }', args: { query: '"1 crore premium"' }, blocking: true, note: 'RAG retrieval inside the turn budget.' },
]

const FLOW = ['User input', 'Conversation state', 'Context builder', 'LLM', 'Decision', 'Tool', 'Result', 'State update', 'LLM', 'Response']

export default function AgentLab() {
  const [llmId, setLlmId] = useState('llm-fast-small')
  const [selectedTools, setSelectedTools] = useState<string[]>(['customer_lookup', 'premium_calculator'])
  const [contextTokens, setContextTokens] = useState(1800)
  const [toolFails, setToolFails] = useState(false)
  const [dbFails, setDbFails] = useState(false)
  const [retries, setRetries] = useState(true)
  const markProgress = useAppStore((s) => s.markProgress)

  const tools = TOOL_CATALOG.filter((t) => selectedTools.includes(t.id))
  const llm = LLM_PROVIDERS.find((l) => l.id === llmId)!

  const result = useMemo(
    () =>
      simulateCall({
        seed: 'agent-lab',
        channel: 'phone',
        utterance: 'I want to know the premium for a one crore insurance policy',
        language: 'en-IN',
        noiseLevel: 0.05,
        sttProviderId: 'stt-stream-fast',
        ttsProviderId: 'tts-premium-stream',
        llmProviderId: llmId,
        telephonyProviderId: 'tel-cpaas',
        streamingLlm: true,
        streamingTts: true,
        vad: { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 600 },
        network: { userToEdgeMs: 30, edgeToServerMs: 8, serverToProviderMs: 12 },
        responseText: 'For a one crore term policy, the monthly premium comes to about two thousand one hundred rupees.',
        llmContextTokens: contextTokens,
        llmOutputTokens: 55,
        toolCalls: tools.filter((t) => t.blocking).map((t) => ({ name: t.name, latencyMs: t.latencyMs, resultSummary: t.result })),
        failures: [
          ...(toolFails ? [{ target: 'tool' as const, probability: 1 }] : []),
          ...(dbFails ? [{ target: 'database' as const, probability: 1 }] : []),
        ],
        reliability: { ...DEFAULT_RELIABILITY, toolRetry: retries, llmRetry: retries },
      }),
    [llmId, tools, contextTokens, toolFails, dbFails, retries],
  )

  useEffect(() => {
    if (tools.length > 0) markProgress('used-tools')
  }, [tools.length, markProgress])

  const runtimeEvents = useMemo(
    () =>
      result.events.filter((e) =>
        ['CONTEXT_BUILT', 'LLM_STARTED', 'LLM_FIRST_TOKEN', 'LLM_TOKEN', 'LLM_COMPLETED', 'TOOL_CALL_STARTED', 'DB_QUERY', 'TOOL_CALL_COMPLETED', 'STATE_WRITTEN', 'TIMEOUT', 'RETRY', 'TURN_COMPLETE', 'TTS_STARTED'].includes(e.type),
      ),
    [result],
  )

  const blockingMs = tools.filter((t) => t.blocking).reduce((s, t) => s + t.latencyMs, 0)

  return (
    <div className="p-4">
      <PageHeader
        title="LLM / Agent Runtime Lab"
        subtitle="The orchestration loop of one turn: state in, context built, model reasons, tools execute, state updates, model phrases the answer. Every tool you put on the blocking path spends the caller's silence."
        right={<Assumption>Tool latencies are editable assumptions</Assumption>}
      />

      {/* Flow strip */}
      <Panel className="mb-4" pad={false}>
        <div className="flex items-center gap-1 overflow-x-auto p-3 text-xs">
          {FLOW.map((f, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className={`whitespace-nowrap rounded-md border px-2 py-1 ${f === 'Tool' ? 'border-control text-control' : f === 'LLM' ? 'border-media text-media' : 'border-ink-700 text-ink-300'}`}>{f}</span>
              {i < FLOW.length - 1 && <span className="text-ink-600">→</span>}
            </span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[340px,1fr]">
        <div className="space-y-3">
          <Panel title="Model & context">
            <div className="space-y-3">
              <Select label="LLM (simulated)" value={llmId} onChange={setLlmId}
                options={LLM_PROVIDERS.map((l) => ({ value: l.id, label: `${l.name} — ${l.timeToFirstTokenMs}ms TTFT, ${l.tokensPerSecond} tok/s` }))} />
              <NumberInput label="Context per turn (tokens)" value={contextTokens} min={300} max={20000} step={100} onChange={setContextTokens}
                help="System prompt + history + tool schemas, re-sent every turn. Latency AND cost scale with it." />
              <div className="text-xs text-ink-500">
                Capability {Math.round(llm.capability * 100)}% · context window {llm.contextWindow.toLocaleString()} · function calling {llm.functionCalling ? 'native' : 'parsed'}
              </div>
            </div>
          </Panel>

          <Panel title="Tools for this turn" right={<Badge tone={blockingMs > 800 ? 'warn' : 'neutral'}>{blockingMs} ms blocking</Badge>}>
            <div className="space-y-2">
              {TOOL_CATALOG.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-ink-800 p-2 text-xs hover:border-ink-600">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-sky-400"
                    checked={selectedTools.includes(t.id)}
                    onChange={(e) =>
                      setSelectedTools((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-mono text-ink-200">{t.name}</span>
                    <Badge tone={t.blocking ? 'warn' : 'good'} title={t.blocking ? 'Runs inside the live turn' : 'Runs async via the queue'}>
                      {t.blocking ? `blocking · ${t.latencyMs}ms` : 'async'}
                    </Badge>
                    <span className="mt-0.5 block text-ink-500">{t.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </Panel>

          <Panel title="Failure injection">
            <div className="space-y-2">
              <Toggle label="Tool times out" checked={toolFails} onChange={setToolFails} />
              <Toggle label="Database unavailable" checked={dbFails} onChange={setDbFails} />
              <Toggle label="Retries enabled" checked={retries} onChange={setRetries} />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Perceived latency this turn" value={fmtMs(result.latency.perceivedLatencyMs)}
              tone={result.latency.withinBudget ? 'good' : 'bad'} />
            <Stat label="Blocking tool time" value={blockingMs} unit="ms" tone={blockingMs > 800 ? 'warn' : 'default'}
              hint="Sequential tool latency on the critical path (before retries/timeouts)." />
            <Stat label="Async side effects" value={TOOL_CATALOG.filter((t) => selectedTools.includes(t.id) && !t.blocking).length}
              hint="Writes that go via the queue after the turn — the caller never waits for them." />
          </div>

          {tools.some((t) => !t.blocking) && (
            <Callout tone="good" title="Async tools skipped the turn">
              {tools.filter((t) => !t.blocking).map((t) => t.name).join(', ')} — enqueued, executed after the reply started. The sort into blocking-vs-async is one of the highest-leverage decisions in agent design.
            </Callout>
          )}

          <Panel title="Function calls — what the LLM actually emitted">
            <div className="space-y-2 font-mono text-xs">
              {tools.filter((t) => t.blocking).map((t) => (
                <div key={t.id} className="rounded-md border border-ink-800 bg-ink-950 p-2.5">
                  <div className="text-control">→ tool_call: <span className="text-ink-100">{t.name}</span>({Object.entries(t.args).map(([k, v]) => `${k}: ${v}`).join(', ')})</div>
                  <div className="mt-1 text-ink-500">   validated against schema ✓ · timeout budget 1500 ms · executed in ~{t.latencyMs} ms</div>
                  <div className="mt-1 text-good">← result: {t.result}</div>
                </div>
              ))}
              {tools.filter((t) => t.blocking).length === 0 && (
                <div className="text-ink-500">No blocking tools selected — the model answers from context alone.</div>
              )}
            </div>
          </Panel>

          <Panel title="Runtime event trace (from the same deterministic call engine)">
            <EventTimeline events={runtimeEvents} autoScroll={false} height="h-[340px]" emptyHint="No runtime events." />
          </Panel>
        </div>
      </div>
    </div>
  )
}
