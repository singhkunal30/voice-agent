import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_RELIABILITY, simulateCall } from '../engine/callSim'
import { HANDOFF_SM } from '../models/stateMachines'
import { EventTimeline } from '../ui/EventTimeline'
import { usePlayback } from '../ui/playback'
import { SimControls } from '../ui/SimControls'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat } from '../ui/primitives'
import { Segmented, Slider } from '../ui/controls'
import { useAppStore } from '../state/store'

type HandoffScenario = 'available' | 'queued' | 'nobody'

export default function HandoffLab() {
  const [scenario, setScenario] = useState<HandoffScenario>('available')
  const [queueWaitS, setQueueWaitS] = useState(25)
  const markProgress = useAppStore((s) => s.markProgress)

  const result = useMemo(
    () =>
      simulateCall({
        seed: `handoff-${scenario}-${queueWaitS}`,
        channel: 'phone',
        utterance: 'This is about a rejected claim. I want to speak to a real person please.',
        language: 'en-IN',
        noiseLevel: 0.1,
        sttProviderId: 'stt-stream-fast',
        ttsProviderId: 'tts-premium-stream',
        llmProviderId: 'llm-fast-small',
        telephonyProviderId: 'tel-cpaas',
        streamingLlm: true,
        streamingTts: true,
        vad: { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 600 },
        network: { userToEdgeMs: 30, edgeToServerMs: 8, serverToProviderMs: 12 },
        responseText: 'Of course — claim disputes go to our claims specialists. Let me connect you now; I will pass along everything we discussed.',
        llmContextTokens: 1600,
        llmOutputTokens: 45,
        toolCalls: [{ name: 'customer_lookup', latencyMs: 140, resultSummary: 'Jane Doe · policy TERM-1CR · claim CL-2291 (rejected)' }],
        handoff: {
          requested: true,
          agentAvailable: scenario === 'available',
          queueWaitMs: scenario === 'available' ? 0 : scenario === 'queued' ? queueWaitS * 1000 : 120000,
          acceptDelayMs: 2500,
        },
        failures: scenario === 'nobody' ? [{ target: 'human-unavailable', probability: 1 }] : [],
        reliability: DEFAULT_RELIABILITY,
      }),
    [scenario, queueWaitS],
  )

  const handoffEvents = useMemo(
    () =>
      result.events.filter(
        (e) =>
          e.type.startsWith('HANDOFF') ||
          e.component.includes('Handoff') ||
          e.component.includes('Human') ||
          ['TURN_COMPLETE', 'TOOL_CALL_COMPLETED', 'PLAYBACK_STARTED', 'CALL_ENDED'].includes(e.type),
      ),
    [result],
  )
  const playback = usePlayback(handoffEvents)

  useEffect(() => {
    if (playback.state === 'done') markProgress('ran-handoff')
  }, [playback.state, markProgress])

  return (
    <div className="p-4">
      <PageHeader
        title="Human Handoff Lab"
        subtitle="Handoff is a distributed transaction across three planes — routing (find a human), media (move the audio), context (move the conversation) — and each leg fails independently. The design is judged by its failure branches, not its happy path."
        right={<Assumption>Queue waits and staffing are assumptions</Assumption>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={scenario}
          onChange={(v) => setScenario(v)}
          ariaLabel="Handoff scenario"
          options={[
            { value: 'available', label: '✓ Agent available', title: 'Skill-matched human free right now' },
            { value: 'queued', label: '⏳ All busy — queue', title: 'Caller waits with honest ETA' },
            { value: 'nobody', label: '✕ Nobody for a long time', title: 'Queue wait exceeds policy → fallback' },
          ]}
        />
        {scenario === 'queued' && (
          <div className="w-64">
            <Slider label="Queue wait" value={queueWaitS} onChange={setQueueWaitS} min={5} max={44} step={5} unit="s" />
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr,360px]">
        <div className="space-y-4">
          {/* Media legs visual */}
          <Panel title="Who is connected to whom (media legs)">
            <div className="grid gap-2 text-center text-xs sm:grid-cols-3">
              <LegCard title="Before" legs={[['Customer', 'AI agent', 'media']]} note="AI owns the conversation; VAD/STT/LLM/TTS all live." />
              <LegCard
                title="During transfer (bridge)"
                legs={[['Customer', 'Bridge', 'media'], ['AI agent', 'Bridge', 'media'], ['Human agent', 'Bridge', 'warn']]}
                note="Conference bridge: AI can whisper-summarise to the human before the customer hears them. Context packet lands on the desktop now."
              />
              <LegCard
                title="After"
                legs={[['Customer', 'Human agent', 'media']]}
                note="AI legs torn down, its provider streams closed, billing switched. Optionally a listen-only assist tap — an explicit privacy decision."
              />
            </div>
          </Panel>

          <Panel title="Handoff event timeline" right={<Badge>{handoffEvents.length} events</Badge>}>
            <div className="mb-3">
              <SimControls playback={playback} />
            </div>
            <EventTimeline events={playback.visible} height="h-[300px]" emptyHint="Press ▶ Start to run the transfer." />
          </Panel>

          {playback.state === 'done' && (
            <Callout
              tone={scenario === 'available' ? 'good' : scenario === 'queued' ? 'info' : 'warn'}
              title={
                scenario === 'available'
                  ? 'Warm transfer completed'
                  : scenario === 'queued'
                    ? 'Queued, then transferred'
                    : 'No humans — the fallback branch carried it'
              }
            >
              {scenario === 'available' &&
                'Availability was confirmed BEFORE anything was promised to the caller; media re-anchored via the bridge; the human saw transcript + intent + CRM before saying hello. The caller repeated nothing.'}
              {scenario === 'queued' &&
                `The caller waited ${queueWaitS}s with an honest estimate and a callback escape hatch. Watch abandonment vs wait time in real deployments — honesty measurably beats hold music (assumption, but a well-supported one).`}
              {scenario === 'nobody' &&
                'Queue wait exceeded policy, so the AI fell back: apologised, booked a callback, sent confirmation by SMS (async job). "Transfer and hope" was never on the table — the no-agent branch is designed, scripted and tested.'}
            </Callout>
          )}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <Stat label="Outcome" value={result.outcome} tone={result.outcome === 'handed-off' ? 'good' : 'accent'} />
            <Stat label="Context transferred" value={scenario !== 'nobody' ? 'transcript + slots + CRM' : 'n/a'}
              hint="The #1 handoff complaint is repeating yourself. Context transfer is what prevents it." />
          </div>

          <Panel title="The handoff state machine">
            <ol className="space-y-1.5">
              {HANDOFF_SM.states.map((s) => (
                <li key={s.id} className="rounded-md border border-ink-800 px-2.5 py-1.5">
                  <div className="font-mono text-xs font-semibold text-ink-200">{s.name}</div>
                  <div className="text-2xs text-ink-500">{s.description.split('.')[0]}.</div>
                  {s.failures.length > 0 && (
                    <div className="mt-0.5 text-2xs text-warn">⚠ {s.failures[0]}</div>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink-500">
              Walk it interactively in the <a className="text-accent hover:underline" href="#/state-machines">State Machine Lab</a>.
            </p>
          </Panel>

          <Panel title="Why humans are the expensive tier">
            <ul className="space-y-1.5 text-xs text-ink-400">
              <li>· One human ≈ one call at a time. No autoscaling — hiring, scheduling, Erlang C.</li>
              <li>· ~$0.50/min loaded cost vs ~$0.05–0.10/min AI stack (example assumptions): every avoided escalation pays for many AI calls.</li>
              <li>· At 80% agent occupancy, queue waits roughly double vs 70% — queueing theory, not management failure.</li>
              <li>· Therefore the escalation <em>threshold</em> is a first-order cost lever — tune it in the Cost Simulator.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function LegCard({ title, legs, note }: { title: string; legs: [string, string, string][]; note: string }) {
  return (
    <div className="rounded-md border border-ink-750 bg-ink-900 p-3">
      <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-500">{title}</div>
      <div className="space-y-1.5">
        {legs.map(([a, b, tone], i) => (
          <div key={i} className="flex items-center justify-center gap-1.5">
            <span className="rounded border border-ink-700 px-1.5 py-0.5 text-ink-200">{a}</span>
            <span className={tone === 'warn' ? 'text-warn' : 'text-media'}>⇆</span>
            <span className="rounded border border-ink-700 px-1.5 py-0.5 text-ink-200">{b}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-left text-2xs text-ink-500">{note}</p>
    </div>
  )
}
