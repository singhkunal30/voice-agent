import { useMemo, useState } from 'react'
import { Rng } from '../engine/rng'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { Slider, Toggle } from '../ui/controls'
import { KNOWLEDGE_BY_ID } from '../knowledge/cards'

interface IceCandidate {
  type: 'host' | 'srflx' | 'relay'
  address: string
  note: string
}

interface SetupStep {
  atMs: number
  actor: string
  what: string
  note: string
  plane: 'control' | 'media'
}

function simulateWebRtcSetup(opts: { strictNat: boolean; turnDeployed: boolean; seed: number }): {
  steps: SetupStep[]
  candidates: IceCandidate[]
  selectedPath: string
  connected: boolean
  setupMs: number
  mediaPathNote: string
} {
  const rng = new Rng(`webrtc-${opts.seed}`)
  const candidates: IceCandidate[] = [
    { type: 'host', address: '192.168.1.24:52133', note: 'Local LAN address — only works if both peers share a network.' },
    { type: 'srflx', address: '49.207.61.8:52133', note: 'Server-reflexive: our public address as seen by the STUN server.' },
  ]
  if (opts.turnDeployed) candidates.push({ type: 'relay', address: 'turn.mumbai.example:3478', note: 'TURN relay allocation — the guaranteed (but indirect) path.' })

  const directWorks = !opts.strictNat
  const connected = directWorks || opts.turnDeployed
  const gatherMs = Math.round(rng.range(80, 160))
  const checksMs = Math.round(directWorks ? rng.range(60, 140) : opts.turnDeployed ? rng.range(180, 320) : rng.range(2500, 4000))
  const dtlsMs = Math.round(rng.range(40, 90))

  const steps: SetupStep[] = [
    { atMs: 0, actor: 'Browser', what: 'getUserMedia()', note: 'Mic permission prompt; capture starts at 48 kHz float PCM with echo cancellation.', plane: 'control' },
    { atMs: 20, actor: 'Browser', what: 'createOffer() → SDP', note: 'SDP offer lists codecs (Opus first), directions, and DTLS fingerprint.', plane: 'control' },
    { atMs: 60, actor: 'Signalling server', what: 'Offer relayed to media server', note: 'Signalling is YOUR channel (usually a WebSocket) — WebRTC does not specify it.', plane: 'control' },
    { atMs: 120, actor: 'Media server', what: 'SDP answer', note: 'Picks opus/48000, includes its own candidates and fingerprint.', plane: 'control' },
    { atMs: 120 + gatherMs, actor: 'Both', what: `ICE gathering complete (${candidates.length} candidate types)`, note: 'host + STUN-reflexive' + (opts.turnDeployed ? ' + TURN relay' : ''), plane: 'control' },
    {
      atMs: 120 + gatherMs + checksMs,
      actor: 'ICE',
      what: connected ? (directWorks ? 'Candidate pair selected: srflx ↔ host' : 'Candidate pair selected: relay (TURN)') : 'ICE FAILED — no pair connects',
      note: connected
        ? directWorks
          ? 'Direct path through the NAT succeeded. Media flows peer-to-server with no relay.'
          : 'Direct probes failed against the strict NAT; TURN relay carries the media. Works everywhere, adds one hop.'
        : 'Strict/symmetric NAT blocks direct paths and no TURN server is deployed. Signalling worked; media cannot flow. This user simply cannot connect.',
      plane: 'media',
    },
  ]
  if (connected) {
    steps.push(
      { atMs: 120 + gatherMs + checksMs + dtlsMs, actor: 'Both', what: 'DTLS handshake → SRTP keys', note: 'Media encryption is mandatory in WebRTC.', plane: 'control' },
      { atMs: 140 + gatherMs + checksMs + dtlsMs, actor: 'Media', what: 'Opus/SRTP flowing both ways · RTCP reports every ~1 s', note: '20 ms packets; FEC and PLC armed; jitter buffer adapting.', plane: 'media' },
    )
  }
  return {
    steps,
    candidates,
    selectedPath: connected ? (directWorks ? 'srflx ↔ host (direct)' : 'TURN relay') : 'none',
    connected,
    setupMs: connected ? 140 + gatherMs + checksMs + dtlsMs : 120 + gatherMs + checksMs,
    mediaPathNote: connected
      ? directWorks
        ? 'Direct: ~1 network path, lowest latency.'
        : 'Relayed: media hairpins through TURN — place TURN in-region or every packet pays the detour.'
      : 'No media path exists.',
  }
}

export default function WebRtcLab() {
  const [strictNat, setStrictNat] = useState(false)
  const [turnDeployed, setTurnDeployed] = useState(true)
  const [packetLossPct, setPacketLossPct] = useState(2)
  const [seed, setSeed] = useState(1)

  const setup = useMemo(() => simulateWebRtcSetup({ strictNat, turnDeployed, seed }), [strictNat, turnDeployed, seed])

  const opusQuality = packetLossPct <= 5 ? 'good' : packetLossPct <= 10 ? 'degraded' : 'poor'
  const wsQuality = packetLossPct <= 1 ? 'good' : packetLossPct <= 3 ? 'degraded' : 'poor'

  return (
    <div className="p-4">
      <PageHeader
        title="WebRTC"
        steps={[
          "Press “↻ New connection attempt” and read the ICE candidates as they are gathered.",
          "Pick a harsher network scenario and watch the connection fall back to a relay.",
          "Read the browser-vs-phone comparison at the bottom — same pipeline, completely different edge.",
        ]}
        subtitle="Connection setup, NAT traversal, and what absorbs jitter and packet loss."
        right={<Assumption>Timings sampled from the seed</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <div className="space-y-3">
          <Panel title="Network scenario">
            <div className="space-y-3">
              <Toggle label="User behind strict/symmetric NAT" checked={strictNat} onChange={setStrictNat}
                help="Enterprise firewalls and some carrier-grade NATs. Direct ICE paths fail." />
              <Toggle label="TURN servers deployed" checked={turnDeployed} onChange={setTurnDeployed}
                help="The relay of last resort. ~10–20% of real users need it (assumption)." />
              <Slider label="Packet loss" value={packetLossPct} onChange={setPacketLossPct} min={0} max={15} step={1} unit="%" />
              <button className="btn w-full justify-center" onClick={() => setSeed((s) => s + 1)}>↻ New connection attempt</button>
            </div>
          </Panel>

          <Panel title="ICE candidates gathered">
            <div className="space-y-2">
              {setup.candidates.map((c) => (
                <div key={c.type} className="rounded-md border border-ink-800 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={c.type === 'relay' ? 'warn' : 'accent'}>{c.type}</Badge>
                    <span className="font-mono text-ink-300">{c.address}</span>
                  </div>
                  <p className="mt-1 text-ink-500">{c.note}</p>
                </div>
              ))}
              {!turnDeployed && (
                <div className="rounded-md border border-dashed border-bad/40 p-2 text-xs text-bad">
                  No relay candidate — users behind strict NATs have no fallback path.
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Loss resilience: why UDP + Opus">
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-300">WebRTC (UDP + Opus FEC/PLC) at {packetLossPct}% loss</span>
                <Badge tone={opusQuality === 'good' ? 'good' : opusQuality === 'degraded' ? 'warn' : 'bad'}>{opusQuality}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-300">WebSocket audio (TCP) at {packetLossPct}% loss</span>
                <Badge tone={wsQuality === 'good' ? 'good' : wsQuality === 'degraded' ? 'warn' : 'bad'}>{wsQuality}</Badge>
              </div>
              <p className="pt-1 text-ink-500">
                UDP loses a packet and conceals 20 ms; TCP retransmits it and stalls <em>every frame behind it</em> (head-of-line blocking), turning loss into bursty latency. Thresholds are illustrative assumptions.
              </p>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Connection outcome" value={setup.connected ? 'connected' : 'FAILED'} tone={setup.connected ? 'good' : 'bad'} />
            <Stat label="Setup time" value={fmtMs(setup.setupMs)} hint="Offer/answer + ICE + DTLS. Phone calls take 2–4 s to 'connect' too — different machinery, same user wait." />
            <Stat label="Media path" value={setup.selectedPath} tone={setup.selectedPath.includes('TURN') ? 'warn' : setup.connected ? 'good' : 'bad'} hint={setup.mediaPathNote} />
          </div>

          <Panel title="Connection establishment, step by step">
            <div className="space-y-1.5">
              {setup.steps.map((s, i) => (
                <div key={i} className="flex gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-ink-900">
                  <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-500">+{fmtMs(s.atMs)}</span>
                  <Badge tone={s.plane === 'media' ? 'media' : 'control'}>{s.plane}</Badge>
                  <div className="min-w-0">
                    <span className="text-ink-200">{s.actor}: <span className={s.what.includes('FAILED') ? 'font-semibold text-bad' : 'font-medium'}>{s.what}</span></span>
                    <p className="text-xs text-ink-500">{s.note}</p>
                  </div>
                </div>
              ))}
            </div>
            {!setup.connected && (
              <Callout tone="bad" title="Signalling succeeded, media failed — the classic WebRTC outage">
                Everything over the signalling WebSocket worked, so your logs look healthy. The user hears nothing. Deploy TURN (with TCP/TLS fallback for hostile firewalls) and alert on ICE failure rate, not just signalling errors.
              </Callout>
            )}
          </Panel>

          <Panel title="Browser → WebRTC vs Phone → SIP/RTP — same pipeline, different edge">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-ink-750 p-3">
                <div className="mb-2 font-mono text-xs text-accent">Browser → WebRTC → Voice server</div>
                <ul className="space-y-1 text-xs text-ink-300">
                  <li>· Audio: Opus 48 kHz — wideband, clean capture, better STT accuracy</li>
                  <li>· NAT traversal (ICE/STUN/TURN) is YOUR problem</li>
                  <li>· Encryption mandatory (SRTP/DTLS)</li>
                  <li>· No per-minute fees; you pay TURN bandwidth + media servers</li>
                  <li>· Echo cancellation & jitter buffer ship with the browser</li>
                  <li>· Reach: anyone on your page; no one off it</li>
                </ul>
              </div>
              <div className="rounded-md border border-ink-750 p-3">
                <div className="mb-2 font-mono text-xs text-warn">Phone → PSTN → SIP/RTP → Voice server</div>
                <ul className="space-y-1 text-xs text-ink-300">
                  <li>· Audio: G.711 8 kHz — band-limited forever, STT accuracy penalty</li>
                  <li>· NAT handled by carriers/SBCs — someone else's problem</li>
                  <li>· Encryption optional and patchy in practice</li>
                  <li>· Per-minute carrier fees on every call</li>
                  <li>· Echo/jitter handling: your gateway's job</li>
                  <li>· Reach: every phone on earth</li>
                </ul>
              </div>
            </div>
            <p className="mt-3 text-sm text-ink-400">
              The architecture differs only at the left edge — everything from the media gateway rightward (VAD, STT, runtime, LLM, TTS)
              is identical. That is why well-factored voice platforms treat the edge as a pluggable transport, and why this repo's
              pipeline code never needs to know whether a call came from Twilio or a browser.
            </p>
          </Panel>

          <Panel title="Concepts behind this lab">
            <div className="flex flex-wrap gap-1.5">
              {['webrtc', 'ice', 'stun-turn', 'sdp', 'rtp', 'rtcp', 'opus'].map((id) => (
                <Badge key={id} tone="accent" title={KNOWLEDGE_BY_ID[id]?.whatIsIt}>{KNOWLEDGE_BY_ID[id]?.term}</Badge>
              ))}
              <span className="text-xs text-ink-500">— full cards in the Knowledge Base</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
