import { useMemo, useRef, useState } from 'react'
import { DEFAULT_RELIABILITY, simulateCall, type FailureTarget } from '../engine/callSim'
import { ArchCanvas } from '../ui/ArchCanvas'
import { EventTimeline } from '../ui/EventTimeline'
import { usePlayback } from '../ui/playback'
import { SimControls } from '../ui/SimControls'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'
import { getSpec } from '../registry/components'
import { useEffect } from 'react'

interface FailureDef {
  target: FailureTarget
  label: string
  specIds: string[]
  blast: string
  desc: string
}

const FAILURES: FailureDef[] = [
  { target: 'stt', label: 'STT provider unavailable', specIds: ['stt'], blast: 'every in-flight and new call', desc: 'Connection refused. The agent goes deaf mid-conversation.' },
  { target: 'tts', label: 'TTS provider unavailable', specIds: ['tts'], blast: 'every in-flight and new call', desc: 'The agent understands perfectly and cannot say a word.' },
  { target: 'llm', label: 'LLM timeout', specIds: ['llm'], blast: 'the current turn on every call', desc: 'Requests hang past the budget. Dead air where the answer should be.' },
  { target: 'tool', label: 'Tool timeout', specIds: ['tool-api'], blast: 'turns that need that tool', desc: 'The backend hangs. Filler speech buys ~1 s, then you must degrade gracefully.' },
  { target: 'database', label: 'Database unavailable', specIds: ['postgres', 'tool-api'], blast: 'reads fail; writes must queue', desc: 'No source of truth for lookups. Live audio should survive — if the DB was off the media path.' },
  { target: 'redis', label: 'Redis unavailable', specIds: ['redis'], blast: 'state reads/writes at turn boundaries', desc: 'Depends entirely on your design: degraded mode, or every turn fails.' },
  { target: 'websocket', label: 'WebSocket disconnect', specIds: ['websocket', 'media-gateway'], blast: 'calls on the affected path', desc: 'The media artery is severed. Without resume logic the call is dead.' },
  { target: 'network-latency', label: 'Network latency spike', specIds: ['telephony', 'websocket'], blast: 'all calls, degraded', desc: '+150 ms per hop. Nothing fails; everything feels broken.' },
  { target: 'packet-loss', label: 'Packet loss', specIds: ['telephony', 'rtp'], blast: 'audio quality on all calls', desc: 'Syllables vanish; STT accuracy quietly collapses.' },
  { target: 'rate-limit', label: 'Provider rate limit', specIds: ['stt'], blast: 'new calls/turns beyond quota', desc: '429s. Existing streams continue; new ones are refused.' },
  { target: 'cpu-overload', label: 'Server CPU overload', specIds: ['media-gateway', 'agent-runtime'], blast: 'every call on that instance', desc: 'Audio deadlines missed: choppy audio and late everything, fleet-wide on that box.' },
  { target: 'human-unavailable', label: 'No human agents', specIds: ['human-agent'], blast: 'escalations only', desc: 'Every transfer request queues or falls back. The branch you must have designed.' },
]

export default function ChaosLab() {
  const arch = useAppStore((s) => s.workingArchitecture)
  const markProgress = useAppStore((s) => s.markProgress)
  const [armed, setArmed] = useState<FailureTarget[]>(['stt'])
  const [mitigations, setMitigations] = useState(true)
  const [extraLatency, setExtraLatency] = useState(200)

  const result = useMemo(
    () =>
      simulateCall({
        seed: `chaos-${armed.join('-')}-${mitigations}-${extraLatency}`,
        channel: 'phone',
        utterance: 'I want to know the premium for a one crore insurance policy',
        language: 'en-IN',
        noiseLevel: 0.1,
        sttProviderId: 'stt-stream-fast',
        ttsProviderId: 'tts-premium-stream',
        llmProviderId: 'llm-fast-small',
        telephonyProviderId: 'tel-cpaas',
        streamingLlm: true,
        streamingTts: true,
        vad: { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 600 },
        network: { userToEdgeMs: 35, edgeToServerMs: 10, serverToProviderMs: 15 },
        greeting: 'Acme Insurance, how can I help?',
        responseText: 'For a one crore term policy the monthly premium is about two thousand one hundred rupees.',
        llmContextTokens: 1800,
        llmOutputTokens: 55,
        toolCalls: [{ name: 'premium_calculator', latencyMs: 240, resultSummary: '₹2,100/month' }],
        handoff: armed.includes('human-unavailable')
          ? { requested: true, agentAvailable: false, queueWaitMs: 120000, acceptDelayMs: 0 }
          : undefined,
        failures: armed.map((target) => ({ target, probability: 1, extraMs: extraLatency })),
        reliability: {
          ...DEFAULT_RELIABILITY,
          sttFallback: mitigations,
          ttsFallback: mitigations,
          llmRetry: mitigations,
          toolRetry: mitigations,
          wsReconnect: mitigations,
        },
      }),
    [armed, mitigations, extraLatency],
  )

  const playback = usePlayback(result.events)

  // The lesson is the *difference* mitigations make, so require having watched
  // the same failure play out both ways.
  const ranWith = useRef(new Set<string>())
  useEffect(() => {
    if (playback.state === 'idle' || armed.length === 0) return
    ranWith.current.add(mitigations ? 'on' : 'off')
    if (ranWith.current.size === 2) markProgress('injected-failures')
  }, [playback.state, armed.length, mitigations, markProgress])

  // Which architecture nodes are implicated by the armed failures.
  const failedSpecIds = useMemo(
    () => new Set(FAILURES.filter((f) => armed.includes(f.target)).flatMap((f) => f.specIds)),
    [armed],
  )
  const failedNodeIds = useMemo(
    () => arch.nodes.filter((n) => failedSpecIds.has(n.specId)).map((n) => n.id),
    [arch.nodes, failedSpecIds],
  )
  // Downstream nodes (reachable from a failed node) are "impacted".
  const impactedNodeIds = useMemo(() => {
    const impacted = new Set<string>()
    const queue = [...failedNodeIds]
    while (queue.length) {
      const id = queue.pop()!
      for (const e of arch.edges) {
        if (e.source === id && !impacted.has(e.target) && !failedNodeIds.includes(e.target)) {
          impacted.add(e.target)
          queue.push(e.target)
        }
      }
    }
    return [...impacted]
  }, [arch.edges, failedNodeIds])

  const failedEdgeIds = useMemo(
    () => arch.edges.filter((e) => failedNodeIds.includes(e.source) || failedNodeIds.includes(e.target)).map((e) => e.id),
    [arch.edges, failedNodeIds],
  )

  const toggle = (t: FailureTarget) => setArmed((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))

  const armedDefs = FAILURES.filter((f) => armed.includes(f.target))

  return (
    <div className="p-4">
      <PageHeader
        title="Break things"
        steps={[
          "Arm exactly one failure — “STT provider unavailable” — and run it.",
          "Read what the caller experienced, not just the blast radius. The caller is the only honest metric.",
          "Press “Arm everything” once, for the spectacle, then go fix it in Reliability patterns.",
        ]}
        subtitle="Inject a failure, watch it propagate, then read what the caller heard."
        right={<Assumption>Deterministic: same armed set → same run</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[330px,1fr]">
        <div className="space-y-3">
          <Panel title="Failure injection" right={<Badge tone={armed.length ? 'bad' : 'neutral'}>{armed.length} armed</Badge>}>
            <div className="space-y-1.5">
              {FAILURES.map((f) => (
                <label key={f.target}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs transition-colors ${
                    armed.includes(f.target) ? 'border-bad/50 bg-bad/5' : 'border-ink-800 hover:border-ink-600'
                  }`}>
                  <input type="checkbox" className="mt-0.5 accent-red-400" checked={armed.includes(f.target)} onChange={() => toggle(f.target)} />
                  <span className="min-w-0">
                    <span className="font-medium text-ink-200">{f.label}</span>
                    <span className="mt-0.5 block text-ink-500">{f.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            {armed.includes('network-latency') && (
              <div className="mt-3">
                <Slider label="Extra latency per hop" value={extraLatency} onChange={setExtraLatency} min={50} max={800} step={50} unit="ms" />
              </div>
            )}
            <div className="mt-3 border-t border-ink-800 pt-3">
              <Toggle label="Mitigations enabled (fallbacks, retries, reconnect)" checked={mitigations} onChange={setMitigations}
                help="The whole point of this lab: run identical failures with this ON and OFF." />
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-sm flex-1 justify-center" onClick={() => setArmed([])}>Clear all</button>
              <button className="btn btn-sm flex-1 justify-center" onClick={() => setArmed(FAILURES.map((f) => f.target))}>Arm everything</button>
            </div>
          </Panel>

          <div className="grid grid-cols-2 gap-2">
            <Stat label="Outcome" value={result.outcome}
              tone={result.outcome === 'completed' || result.outcome === 'handed-off' ? 'good' : 'bad'} />
            <Stat label="Perceived latency" value={isFinite(result.latency.perceivedLatencyMs) ? fmtMs(result.latency.perceivedLatencyMs) : 'never'}
              tone={result.latency.withinBudget ? 'good' : 'bad'} />
          </div>

          <Callout tone={result.outcome === 'completed' || result.outcome === 'handed-off' ? 'good' : 'bad'}
            title={result.outcome === 'failed' || result.outcome === 'dropped' ? 'The caller lost this call' : 'The caller got an answer'}>
            {result.outcomeReason}
            {result.recoveries.length > 0 && (
              <div className="mt-1.5 text-xs">
                <span className="font-medium text-good">Recoveries used: </span>{result.recoveries.join(', ')}
              </div>
            )}
            {!mitigations && armed.length > 0 && (
              <div className="mt-1.5 text-xs text-warn">Mitigations are OFF — turn them on and compare.</div>
            )}
          </Callout>
        </div>

        <div className="space-y-4">
          <Panel title="Blast radius on your architecture" pad={false}
            right={<div className="flex gap-2 text-2xs text-ink-500"><span className="text-bad">✕ failed</span><span className="text-warn">◌ impacted downstream</span></div>}>
            <div className="h-[300px]">
              <ArchCanvas
                architecture={arch}
                editable={false}
                highlights={{ failedNodeIds, warnNodeIds: impactedNodeIds, failedEdgeIds }}
                fitKey={`chaos-${armed.join()}`}
              />
            </div>
            <div className="border-t border-ink-800 p-3">
              {armedDefs.length === 0 ? (
                <p className="text-xs text-ink-500">Arm a failure to see which components fail and what depends on them.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {armedDefs.map((f) => (
                    <li key={f.target} className="text-ink-300">
                      <span className="font-medium text-bad">{f.label}</span> — blast radius: {f.blast}.
                      {arch.nodes.filter((n) => f.specIds.includes(n.specId)).length === 0 && (
                        <span className="ml-1 text-ink-500">(this component is not in your current architecture — load one in the canvas to see it highlighted)</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>

          <Panel title="What the caller experienced, event by event">
            <div className="mb-3"><SimControls playback={playback} /></div>
            <EventTimeline events={playback.visible} height="h-[320px]" emptyHint="Press ▶ Start to run the call with these failures armed." />
          </Panel>

          {armedDefs.length > 0 && (
            <Panel title="Failure modes in detail (from the component registry)">
              <div className="space-y-2">
                {armedDefs.map((f) => {
                  const spec = (() => { try { return getSpec(f.specIds[0]) } catch { return null } })()
                  if (!spec) return null
                  const mode = spec.failureModes[0]
                  return (
                    <div key={f.target} className="rounded-md border border-ink-750 bg-ink-850 p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge tone="bad">{spec.short}</Badge>
                        <span className="text-sm font-medium text-ink-100">{mode.name}</span>
                      </div>
                      <div className="space-y-1 text-xs text-ink-400">
                        <p><span className="font-medium text-ink-300">Caller experiences: </span>{mode.callerImpact}</p>
                        <p><span className="font-medium text-ink-300">Telemetry signal: </span>{mode.signal}</p>
                        <p><span className="font-medium text-ink-300">Mitigations: </span>{mode.mitigations.join(' · ')}</p>
                        <p className="italic text-ink-500">If it fails: {spec.ifItFails}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
