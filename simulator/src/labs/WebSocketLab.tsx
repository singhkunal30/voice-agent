import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Rng } from '../engine/rng'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtBytes } from '../ui/primitives'
import { Segmented, Slider, Toggle } from '../ui/controls'

interface WsTick {
  t: number
  queueDepth: number
  queuedMs: number
  bandwidthKbps: number
  dropped: number
  state: 'open' | 'stalled' | 'closed' | 'reconnecting'
  oldestFrameAgeMs: number
}

interface WsFrame {
  t: number
  dir: 'up' | 'down'
  kind: 'binary' | 'text'
  bytes: number
  note: string
  status: 'ok' | 'dropped' | 'delayed'
}

/**
 * Deterministic 30-second WebSocket session model at 10 ms resolution:
 * producer emits one 20 ms audio frame every 20 ms; the network drains at a
 * configurable rate; a stall window stops draining entirely; the buffer policy
 * decides what happens to the excess.
 */
function simulateWs(opts: {
  stall: boolean
  stallStartS: number
  stallSeconds: number
  disconnect: boolean
  reconnect: boolean
  drainFactor: number
  boundedBuffer: boolean
  bufferCapFrames: number
}): { ticks: WsTick[]; frames: WsFrame[]; summary: string[] } {
  const rng = new Rng('ws-lab')
  const FRAME_BYTES = 640 // 20 ms of 16 kHz PCM16
  const ticks: WsTick[] = []
  const frames: WsFrame[] = []
  const summary: string[] = []
  let queue: number[] = [] // enqueue timestamps of pending frames
  let dropped = 0
  let state: WsTick['state'] = 'open'
  const disconnectAt = opts.disconnect ? 12000 : Infinity
  let reconnectDone = false

  frames.push({ t: 0, dir: 'up', kind: 'text', bytes: 182, note: 'HTTP GET /media Upgrade: websocket → 101 Switching Protocols', status: 'ok' })
  frames.push({ t: 12, dir: 'down', kind: 'text', bytes: 96, note: '{"event":"connected","protocol":"audio/pcm16;rate=16000"}', status: 'ok' })

  for (let t = 0; t <= 30000; t += 10) {
    const stalled = opts.stall && t >= opts.stallStartS * 1000 && t < (opts.stallStartS + opts.stallSeconds) * 1000
    if (t >= disconnectAt && state === 'open') {
      state = 'closed'
      frames.push({ t, dir: 'down', kind: 'text', bytes: 2, note: 'Close frame 1006 (abnormal) — TCP reset, no goodbye', status: 'dropped' })
      if (opts.reconnect) {
        frames.push({ t: t + 340, dir: 'up', kind: 'text', bytes: 214, note: 'Reconnect with resume token; server restores session from Redis', status: 'ok' })
        summary.push('Disconnect at 12.0 s; reconnect completed in ~340 ms. Audio in the gap is gone forever — live media cannot be retransmitted usefully.')
      } else {
        summary.push('Disconnect at 12.0 s with no reconnect strategy: the call is dead. Everything after this line is what did NOT happen.')
      }
    }
    if (state === 'closed' && opts.reconnect && t >= disconnectAt + 340 && !reconnectDone) {
      state = 'open'
      reconnectDone = true
      queue = []
    }
    if (state === 'closed' && !opts.reconnect) {
      ticks.push({ t, queueDepth: 0, queuedMs: 0, bandwidthKbps: 0, dropped, state, oldestFrameAgeMs: 0 })
      continue
    }

    // Producer: one frame per 20 ms.
    if (t % 20 === 0 && state === 'open') queue.push(t)

    // Consumer: drain `drainFactor` frames per 20 ms when not stalled.
    if (!stalled && state === 'open' && t % 20 === 0) {
      let n = Math.floor(opts.drainFactor)
      if (rng.chance(opts.drainFactor - n)) n++
      queue.splice(0, n)
    }

    // Buffer policy.
    if (opts.boundedBuffer && queue.length > opts.bufferCapFrames) {
      const excess = queue.length - opts.bufferCapFrames
      queue.splice(0, excess) // drop OLDEST audio: stale frames are worthless
      dropped += excess
    }

    if (t % 250 === 0) {
      const oldest = queue.length ? t - queue[0] : 0
      ticks.push({
        t,
        queueDepth: queue.length,
        queuedMs: queue.length * 20,
        bandwidthKbps: state === 'open' && !stalled ? Math.round(((FRAME_BYTES * 50 * 8) / 1000) * Math.min(1, opts.drainFactor)) : 0,
        dropped,
        state: stalled ? 'stalled' : state,
        oldestFrameAgeMs: oldest,
      })
    }
    // Sampled frame log.
    if (t % 5000 === 0 && t > 0 && state === 'open') {
      frames.push({ t, dir: 'up', kind: 'binary', bytes: FRAME_BYTES, note: `audio frame #${t / 20} — 20 ms PCM16 @16 kHz`, status: stalled ? 'delayed' : 'ok' })
      frames.push({ t: t + 40, dir: 'down', kind: 'text', bytes: 148, note: '{"type":"transcript.partial","text":"…"}', status: 'ok' })
    }
  }

  const maxQueuedMs = Math.max(...ticks.map((x) => x.queuedMs))
  if (opts.stall && maxQueuedMs > 0) {
    summary.push(
      opts.boundedBuffer
        ? `Stall absorbed by the bounded buffer: depth capped at ${opts.bufferCapFrames} frames (${opts.bufferCapFrames * 20} ms), ${dropped} oldest frames dropped. The caller lost ${((dropped * 20) / 1000).toFixed(1)} s of audio but latency stayed bounded.`
        : `Unbounded buffer during the stall: depth peaked at ${Math.round(maxQueuedMs / 20)} frames = ${(maxQueuedMs / 1000).toFixed(1)} s of queued audio. Every frame after the stall now arrives ${(maxQueuedMs / 1000).toFixed(1)} s late — the conversation is permanently behind.`,
    )
  }
  return { ticks, frames, summary }
}

export default function WebSocketLab() {
  const [stall, setStall] = useState(true)
  const [stallSeconds, setStallSeconds] = useState(3)
  const [drainFactor, setDrainFactor] = useState(1)
  const [boundedBuffer, setBoundedBuffer] = useState(false)
  const [bufferCap, setBufferCap] = useState(15)
  const [disconnect, setDisconnect] = useState(false)
  const [reconnect, setReconnect] = useState(true)
  const [view, setView] = useState<'queue' | 'bandwidth'>('queue')

  const { ticks, frames, summary } = useMemo(
    () => simulateWs({ stall, stallStartS: 6, stallSeconds, disconnect, reconnect, drainFactor, boundedBuffer, bufferCapFrames: bufferCap }),
    [stall, stallSeconds, disconnect, reconnect, drainFactor, boundedBuffer, bufferCap],
  )

  const maxQueuedMs = Math.max(...ticks.map((t) => t.queuedMs))
  const totalDropped = ticks[ticks.length - 1]?.dropped ?? 0

  return (
    <div className="p-4">
      <PageHeader
        title="WebSocket Lab"
        subtitle="One persistent connection carrying 50 binary audio frames per second upstream and JSON events downstream — for the whole call. This lab is about what happens when the other side reads slower than you write: backpressure, the defining failure mode of streaming transports."
        right={<Assumption>640 B / 20 ms frames = 16 kHz PCM16</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <div className="space-y-3">
          <Panel title="Network conditions">
            <div className="space-y-3">
              <Toggle label="Network stall at t=6 s" checked={stall} onChange={setStall}
                help="Peer stops reading (TCP zero window / congested path). Producer keeps producing." />
              {stall && <Slider label="Stall duration" value={stallSeconds} onChange={setStallSeconds} min={1} max={8} step={0.5} unit="s" />}
              <Slider label="Drain rate vs production" value={drainFactor} onChange={setDrainFactor} min={0.5} max={1.5} step={0.05}
                format={(v) => `${v.toFixed(2)}× (${v < 1 ? 'consumer too slow!' : v > 1 ? 'headroom' : 'exactly keeping up'})`}
                help="Below 1.0 the queue grows forever even without a stall — a slow consumer is a permanent stall." />
              <Toggle label="Mid-call disconnect at t=12 s" checked={disconnect} onChange={setDisconnect} />
              {disconnect && <Toggle label="Reconnect with session resume" checked={reconnect} onChange={setReconnect} />}
            </div>
          </Panel>

          <Panel title="Backpressure policy">
            <div className="space-y-3">
              <Toggle label="Bounded send buffer (drop oldest)" checked={boundedBuffer} onChange={setBoundedBuffer}
                help="The production policy: stale audio is worthless, so cap the buffer and drop from the head." />
              {boundedBuffer && <Slider label="Buffer cap" value={bufferCap} onChange={setBufferCap} min={5} max={100} step={5} unit="frames" format={(v) => `${v} frames (${v * 20} ms)`} />}
              <Callout tone={boundedBuffer ? 'good' : 'warn'} title={boundedBuffer ? 'Bounded: latency capped, audio sacrificed' : 'Unbounded: nothing lost, everything late'}>
                {boundedBuffer
                  ? 'You chose WHAT to lose (oldest audio) and HOW MUCH (the cap). That is what a backpressure policy is.'
                  : 'The queue “helpfully” keeps every frame — and converts a 3 s stall into 3 s of permanent added latency. For live audio this is the wrong default.'}
              </Callout>
            </div>
          </Panel>

          <Panel title="Connection state math">
            <dl className="space-y-1.5 text-xs text-ink-400">
              <div><dt className="inline font-medium text-ink-200">Per connection: </dt><dd className="inline">1 socket/fd · ~300 KB buffers+state · ~140 kbit/s both directions (assumption)</dd></div>
              <div><dt className="inline font-medium text-ink-200">3,000 calls/server: </dt><dd className="inline">3,000 fds · ~0.9 GB · ~420 Mbit/s — and one process whose death drops all 3,000</dd></div>
              <div><dt className="inline font-medium text-ink-200">TCP caveat: </dt><dd className="inline">one lost packet stalls every frame behind it (head-of-line blocking) — why WebRTC uses UDP</dd></div>
            </dl>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Peak queued audio" value={(maxQueuedMs / 1000).toFixed(2)} unit="s" tone={maxQueuedMs > 1000 ? 'bad' : maxQueuedMs > 300 ? 'warn' : 'good'}
              hint="Audio sitting in the send buffer = latency added to the conversation." />
            <Stat label="Frames dropped" value={totalDropped} tone={totalDropped > 0 ? 'warn' : 'good'}
              hint="By the bounded-buffer policy (oldest first)." />
            <Stat label="Steady bandwidth" value={Math.round((640 * 50 * 8) / 1000)} unit="kbit/s" hint="50 frames/s × 640 B, upstream audio only." />
            <Stat label="Frame rate" value="50" unit="fps" hint="One frame per 20 ms — the heartbeat of the media plane." />
          </div>

          <Panel title={view === 'queue' ? 'Send-queue depth over the session' : 'Effective bandwidth over the session'}
            right={<Segmented value={view} onChange={setView} options={[{ value: 'queue', label: 'Queue depth' }, { value: 'bandwidth', label: 'Bandwidth' }]} ariaLabel="Chart" />}>
            <div className="h-56">
              <ResponsiveContainer>
                {view === 'queue' ? (
                  <AreaChart data={ticks}>
                    <CartesianGrid stroke="#1a2433" />
                    <XAxis dataKey="t" tickFormatter={(t) => `${t / 1000}s`} stroke="#4a5a72" fontSize={11} />
                    <YAxis stroke="#4a5a72" fontSize={11} label={{ value: 'frames queued', angle: -90, position: 'insideLeft', fill: '#4a5a72', fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: '#0f1520', border: '1px solid #324054', fontSize: 12 }}
                      formatter={(v: number, name) => (name === 'queueDepth' ? [`${v} frames (${v * 20} ms of audio)`, 'queued'] : [v, name])}
                      labelFormatter={(t) => `t = ${(t as number) / 1000}s`} />
                    <Area type="monotone" dataKey="queueDepth" stroke="#fbbf24" fill="#fbbf2433" isAnimationActive={false} />
                  </AreaChart>
                ) : (
                  <LineChart data={ticks}>
                    <CartesianGrid stroke="#1a2433" />
                    <XAxis dataKey="t" tickFormatter={(t) => `${t / 1000}s`} stroke="#4a5a72" fontSize={11} />
                    <YAxis stroke="#4a5a72" fontSize={11} />
                    <Tooltip contentStyle={{ background: '#0f1520', border: '1px solid #324054', fontSize: 12 }} labelFormatter={(t) => `t = ${(t as number) / 1000}s`} />
                    <Line type="stepAfter" dataKey="bandwidthKbps" stroke="#38bdf8" dot={false} isAnimationActive={false} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
            {summary.map((s, i) => (
              <Callout key={i} tone={s.includes('dead') || s.includes('permanently') ? 'bad' : 'info'} title={i === 0 ? 'What happened' : undefined}>{s}</Callout>
            ))}
          </Panel>

          <Panel title="Frame inspector (sampled)">
            <div className="max-h-64 overflow-y-auto font-mono text-xs">
              {frames.map((f, i) => (
                <div key={i} className={`flex gap-3 border-b border-ink-850 py-1 ${f.status === 'dropped' ? 'text-bad' : f.status === 'delayed' ? 'text-warn' : ''}`}>
                  <span className="w-14 shrink-0 text-right text-ink-500">{(f.t / 1000).toFixed(2)}s</span>
                  <span className={`w-8 shrink-0 ${f.dir === 'up' ? 'text-accent' : 'text-good'}`}>{f.dir === 'up' ? '⇑' : '⇓'}</span>
                  <Badge tone={f.kind === 'binary' ? 'media' : 'control'}>{f.kind}</Badge>
                  <span className="w-16 shrink-0 text-right text-ink-400">{fmtBytes(f.bytes)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-300" title={f.note}>{f.note}</span>
                  {f.status !== 'ok' && <span>{f.status}</span>}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-500">Binary frames carry audio (media plane); text frames carry JSON events (control plane) — both multiplexed on one TCP connection.</p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
