import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_RELIABILITY, simulateCall, type CallSimOptions, type FailureTarget } from '../engine/callSim'
import { STT_PROVIDERS, TTS_PROVIDERS, LLM_PROVIDERS } from '../providers/simulated'
import { usePlayback } from '../ui/playback'
import { SimControls } from '../ui/SimControls'
import { EventTimeline } from '../ui/EventTimeline'
import { LatencyMilestones, LatencyWaterfall } from '../ui/LatencyWaterfall'
import { Assumption, Badge, Disclosure, Callout, PageHeader, Panel, fmtMs } from '../ui/primitives'
import { NumberInput, Select, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'

/** The visual journey strip: which stations light up as events flow. */
const STATIONS: { id: string; label: string; match: (c: string) => boolean }[] = [
  { id: 'user', label: 'User', match: (c) => c.includes('Caller') || c.includes('User') || c === 'Browser' },
  { id: 'tel', label: 'Telephony / Edge', match: (c) => c.includes('SIP') || c.includes('WebRTC') },
  { id: 'gw', label: 'Media Gateway', match: (c) => c.includes('Media gateway') || c.includes('WebSocket') },
  { id: 'vad', label: 'VAD', match: (c) => c === 'VAD' },
  { id: 'stt', label: 'STT', match: (c) => c === 'STT' },
  { id: 'rt', label: 'Agent Runtime', match: (c) => c.includes('Agent runtime') || c.includes('Handoff') || c === 'Redis' },
  { id: 'llm', label: 'LLM', match: (c) => c === 'LLM' || c === 'S2S model' },
  { id: 'tool', label: 'Tools / DB', match: (c) => c.startsWith('Tool') || c === 'Database' },
  { id: 'tts', label: 'TTS', match: (c) => c === 'TTS' },
  { id: 'human', label: 'Human', match: (c) => c.includes('Human') },
]

const FAILURE_OPTIONS: { target: FailureTarget; label: string }[] = [
  { target: 'stt', label: 'STT outage' },
  { target: 'tts', label: 'TTS outage' },
  { target: 'llm', label: 'LLM timeout' },
  { target: 'tool', label: 'Tool timeout' },
  { target: 'database', label: 'Database down' },
  { target: 'websocket', label: 'WebSocket drop' },
  { target: 'network-latency', label: 'High network latency' },
  { target: 'packet-loss', label: 'Packet loss' },
  { target: 'cpu-overload', label: 'Server CPU overload' },
]

export default function LiveCall() {
  const markProgress = useAppStore((s) => s.markProgress)
  const scenario = useAppStore((s) => s.activeScenario)

  const [seed, setSeed] = useState('demo-1')
  const [channel, setChannel] = useState<'phone' | 'browser'>('phone')
  const [utterance, setUtterance] = useState(
    scenario?.sampleUtterance ?? 'I want to know the premium for a one crore insurance policy',
  )
  const [stt, setStt] = useState('stt-stream-fast')
  const [tts, setTts] = useState('tts-premium-stream')
  const [llm, setLlm] = useState('llm-fast-small')
  const [s2sMode, setS2sMode] = useState(false)
  const [streamingLlm, setStreamingLlm] = useState(true)
  const [streamingTts, setStreamingTts] = useState(true)
  const [silenceTimeout, setSilenceTimeout] = useState(600)
  const [noise, setNoise] = useState(0.1)
  const [withTool, setWithTool] = useState(true)
  const [withInterruption, setWithInterruption] = useState(false)
  const [withHandoff, setWithHandoff] = useState(false)
  const [handoffAvailable, setHandoffAvailable] = useState(true)
  const [contextTokens, setContextTokens] = useState(1800)
  const [failures, setFailures] = useState<FailureTarget[]>([])
  const [fallbacksOn, setFallbacksOn] = useState(true)

  const opts: CallSimOptions = useMemo(
    () => ({
      seed,
      channel,
      utterance,
      language: 'en-IN',
      noiseLevel: noise,
      sttProviderId: stt,
      ttsProviderId: tts,
      llmProviderId: llm,
      telephonyProviderId: 'tel-cpaas',
      s2sMode,
      streamingLlm,
      streamingTts,
      vad: { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: silenceTimeout },
      network: { userToEdgeMs: channel === 'phone' ? 35 : 25, edgeToServerMs: 10, serverToProviderMs: 15 },
      greeting: 'Hi, thanks for calling Acme Insurance. How can I help you today?',
      responseText:
        'For a one crore term policy, the monthly premium comes to around two thousand one hundred rupees based on your profile. Would you like me to email the full quote?',
      llmContextTokens: contextTokens,
      llmOutputTokens: 60,
      toolCalls: withTool && !s2sMode
        ? [{ name: 'premium_calculator', latencyMs: 220, resultSummary: '₹2,100/month for ₹1 crore cover' }]
        : [],
      interruption: withInterruption
        ? { afterPlaybackMs: 900, utterance: 'Wait! Does that include the accidental death rider?' }
        : undefined,
      handoff: withHandoff
        ? { requested: true, agentAvailable: handoffAvailable, queueWaitMs: handoffAvailable ? 0 : 120000, acceptDelayMs: 2500 }
        : undefined,
      failures: failures.map((target) => ({ target, probability: 1 })),
      reliability: {
        ...DEFAULT_RELIABILITY,
        sttFallback: fallbacksOn,
        ttsFallback: fallbacksOn,
        llmRetry: fallbacksOn,
        toolRetry: fallbacksOn,
        wsReconnect: fallbacksOn,
      },
    }),
    [seed, channel, utterance, noise, stt, tts, llm, s2sMode, streamingLlm, streamingTts, silenceTimeout, contextTokens, withTool, withInterruption, withHandoff, handoffAvailable, failures, fallbacksOn],
  )

  const result = useMemo(() => simulateCall(opts), [opts])
  const playback = usePlayback(result.events)

  // Which stations are "hot" at the playback cursor (events in the last 400 ms of virtual time).
  const hotStations = useMemo(() => {
    const windowStart = playback.now - 400
    const hot = new Set<string>()
    for (const e of playback.visible) {
      if (e.t >= windowStart) {
        const st = STATIONS.find((s) => s.match(e.component))
        if (st) hot.add(st.id)
      }
    }
    return hot
  }, [playback.visible, playback.now])

  const failedStations = useMemo(() => {
    const failed = new Set<string>()
    for (const e of playback.visible) {
      if (e.status === 'error') {
        const st = STATIONS.find((s) => s.match(e.component))
        if (st) failed.add(st.id)
      }
    }
    return failed
  }, [playback.visible])

  const toggleFailure = (t: FailureTarget) =>
    setFailures((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]))

  // Step 2 is "play a call AND read three events". Pressing play alone leaves
  // you with an animation you did not look at.
  const played = useRef(false)
  const [inspected, setInspected] = useState(0)
  useEffect(() => {
    if (playback.state !== 'idle') played.current = true
    if (played.current && inspected >= 3) markProgress('ran-first-call')
  }, [playback.state, inspected, markProgress])

  return (
    <div className="p-4">
      <PageHeader
        title="Live call"
        steps={[
          "Press ▶ Start and just watch. Do not touch the settings on the first run.",
          "Click any event in the timeline to see its payload and which component emitted it.",
          "Turn on “User interrupts the agent (barge-in)”, run again, and watch the cancellation cascade.",
        ]}
        subtitle="One complete call as a deterministic event simulation. Same seed, same run, every time."
        right={<Assumption>All timings are simulation assumptions</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[300px,1fr]">
        {/* Config column */}
        <div className="space-y-3">
          <Panel title="Call setup">
            <div className="space-y-3">
              <div>
                <label className="label">User utterance</label>
                <textarea className="input min-h-[64px]" value={utterance} onChange={(e) => setUtterance(e.target.value)} />
              </div>
              <Select label="Channel" value={channel} onChange={setChannel}
                options={[
                  { value: 'phone', label: '☎ Phone (PSTN → mu-law 8 kHz)' },
                  { value: 'browser', label: '🌐 Browser (WebRTC → Opus 48 kHz)' },
                ]} />
              <div className="flex items-end gap-2">
                <NumberInput label="Seed" value={Number(seed.replace(/\D/g, '') || 1)} min={1} max={9999}
                  onChange={(v) => setSeed(`demo-${v}`)} help="Same seed → identical run. Change it to sample different jitter." />
                <span className="pb-2 font-mono text-2xs text-ink-500">{seed}</span>
              </div>
            </div>
          </Panel>

          <Disclosure summary="Pipeline" hint="providers & streaming" advanced>
            <div className="space-y-3">
              <Toggle label="Speech-to-speech mode (no STT/TTS hops)" checked={s2sMode} onChange={setS2sMode}
                help="One realtime model consumes and produces audio directly." />
              {!s2sMode && (
                <>
                  <Select label="STT provider (simulated)" value={stt} onChange={setStt}
                    options={STT_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))} />
                  <Select label="TTS provider (simulated)" value={tts} onChange={setTts}
                    options={TTS_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))} />
                  <Select label="LLM (simulated)" value={llm} onChange={setLlm}
                    options={LLM_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))} />
                  <Toggle label="Stream LLM tokens" checked={streamingLlm} onChange={setStreamingLlm} />
                  <Toggle label="Stream TTS audio" checked={streamingTts} onChange={setStreamingTts} />
                  <Toggle label="Tool call (premium calculator)" checked={withTool} onChange={setWithTool} />
                </>
              )}
              <Slider label="VAD silence timeout" value={silenceTimeout} onChange={setSilenceTimeout}
                min={150} max={1500} step={50} unit="ms"
                help="How long the agent waits after you stop talking. The single biggest perceived-latency knob." />
              <Slider label="Background noise" value={noise} onChange={setNoise} min={0} max={0.8} step={0.05}
                format={(v) => (v < 0.15 ? 'quiet' : v < 0.4 ? 'office' : v < 0.6 ? 'street' : 'very noisy')} />
              <Slider label="LLM context size" value={contextTokens} onChange={setContextTokens}
                min={300} max={8000} step={100} unit="tokens"
                help="System prompt + history sent every turn — a latency and cost tax." />
            </div>
          </Disclosure>

          <Panel title="Situations">
            <div className="space-y-2.5">
              <Toggle label="User interrupts the agent (barge-in)" checked={withInterruption} onChange={setWithInterruption} />
              <Toggle label="Escalate to human at end" checked={withHandoff} onChange={setWithHandoff} />
              {withHandoff && (
                <Toggle label="A human agent is available" checked={handoffAvailable} onChange={setHandoffAvailable} />
              )}
            </div>
          </Panel>

          <Disclosure summary="Failure injection" hint={failures.length ? `${failures.length} armed` : 'break something'} advanced>
            <div className="space-y-2">
              {FAILURE_OPTIONS.map((f) => (
                <Toggle key={f.target} label={f.label} checked={failures.includes(f.target)} onChange={() => toggleFailure(f.target)} />
              ))}
              <div className="border-t border-ink-800 pt-2">
                <Toggle label="Reliability patterns ON (fallbacks, retries)" checked={fallbacksOn} onChange={setFallbacksOn}
                  help="Turn OFF to watch the same failures kill the call outright." />
              </div>
            </div>
          </Disclosure>
        </div>

        {/* Main column */}
        <div className="min-w-0 space-y-4">
          {/* Journey strip */}
          <Panel title="Call journey" pad={false}>
            <div className="flex items-stretch gap-1 overflow-x-auto p-3">
              {STATIONS.filter((s) => (withHandoff ? true : s.id !== 'human')).map((s, i, arr) => (
                <div key={s.id} className="flex items-center">
                  <div
                    className={`min-w-[86px] rounded-md border px-2 py-2 text-center text-xs transition-all ${
                      failedStations.has(s.id)
                        ? 'border-bad bg-bad/15 text-bad shadow-[0_0_14px_rgba(248,113,113,0.35)]'
                        : hotStations.has(s.id)
                          ? 'border-warn bg-warn/10 text-warn shadow-[0_0_14px_rgba(251,191,36,0.3)]'
                          : 'border-ink-700 bg-ink-850 text-ink-400'
                    }`}
                  >
                    {s.label}
                  </div>
                  {i < arr.length - 1 && <span className="px-0.5 text-ink-600">→</span>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Event timeline"
            right={
              <div className="flex items-center gap-2 text-2xs text-ink-500">
                <span><span className="text-media">▮</span> media plane</span>
                <span><span className="text-control">▯</span> control plane</span>
                <span>{result.events.length} events</span>
              </div>
            }
          >
            <div className="mb-3">
              <SimControls playback={playback} />
            </div>
            {playback.state !== 'idle' && playback.visible.length === 0 && null}
            <EventTimeline events={playback.visible} onInspect={() => setInspected((n) => n + 1)} />
            {playback.state === 'idle' && (
              <div className="mt-2 text-xs text-ink-500">
                The full run is already computed ({result.events.length} events, {fmtMs(playback.durationMs)} of virtual time). Playback only animates it — pause, step and speed cannot change the outcome.
              </div>
            )}
          </Panel>

          {(playback.state === 'done' || playback.state === 'paused') && (
            <>
              <Panel title="Outcome">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={result.outcome === 'completed' || result.outcome === 'handed-off' ? 'good' : 'bad'}>
                    {result.outcome}
                  </Badge>
                  <span className="text-sm text-ink-300">{result.outcomeReason}</span>
                </div>
                {result.finalTranscript && (
                  <div className="mb-2 text-sm">
                    <span className="text-ink-500">Heard: </span>
                    <span className="font-mono text-ink-200">“{result.finalTranscript}”</span>
                    <span className="ml-2 text-2xs text-ink-500">simulated WER {(result.wer * 100).toFixed(1)}%</span>
                  </div>
                )}
                {result.failuresEncountered.length > 0 && (
                  <Callout tone="warn" title={`Failures encountered: ${result.failuresEncountered.join(', ')}`}>
                    Recoveries: {result.recoveries.length ? result.recoveries.join(', ') : 'none — and the call paid for it.'}
                  </Callout>
                )}
              </Panel>

              <Panel title="Latency waterfall" right={<Assumption />}>
                <LatencyMilestones breakdown={result.latency} />
                <div className="mt-4">
                  <LatencyWaterfall breakdown={result.latency} />
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
