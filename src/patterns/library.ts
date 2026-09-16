/**
 * Architecture pattern library — predefined, inspectable, editable designs.
 * Loading a pattern into the canvas gives a working starting point that the
 * validator, cost engine and call simulator all understand.
 */

import type { ArchitecturePattern, Requirements } from '../domain/types'
import { ArchBuilder } from '../domain/builder'
import { decideArchitecture } from '../decision/engine'

const baseReq = (over: Partial<Requirements>): Requirements => ({
  name: 'pattern',
  callsPerDay: 500,
  avgCallSeconds: 240,
  peakCallsPerMinute: 5,
  peakConcurrentCalls: 20,
  latencyTargetMs: 1200,
  availabilityTarget: 0.99,
  languages: ['en-US'],
  regions: ['us-east'],
  direction: 'inbound',
  channel: 'phone',
  humanHandoff: false,
  recording: false,
  toolUsage: 0.3,
  budgetPosture: 'balanced',
  compliance: [],
  ...over,
})

function simpleVoiceBot(): ArchitecturePattern {
  const b = new ArchBuilder(
    'pat-simple',
    'Simple voice bot (batch pipeline)',
    'The minimum viable voice agent: batch STT → LLM → batch TTS on one server. Slow but honest — and the baseline every streaming optimisation is measured against.',
    baseReq({ latencyTargetMs: 3000, peakConcurrentCalls: 5 }),
  )
  const user = b.node('user', { col: 0 })
  const tel = b.node('telephony', { col: 1 })
  const gw = b.node('media-gateway', { col: 2, label: 'Voice server' })
  const stt = b.node('stt', { col: 3, config: { provider: 'stt-whisper-batch' } })
  const llm = b.node('llm', { col: 4 })
  const tts = b.node('tts', { col: 5, config: { provider: 'tts-batch-mp3' } })
  const pg = b.node('postgres', { col: 6 })
  b.connect(user, tel, { protocol: 'PSTN', direction: 'bi' })
  b.connect(tel, gw, { protocol: 'WebSocket', type: 'persistent', direction: 'bi' })
  b.connect(gw, stt, { type: 'sync', streaming: false, label: 'complete utterance (batch)' })
  b.connect(stt, llm, { type: 'sync', plane: 'media', streaming: false, label: 'final transcript' })
  b.connect(llm, tts, { type: 'sync', plane: 'media', streaming: false, label: 'full reply text' })
  b.connect(tts, gw, { type: 'sync', streaming: false, label: 'complete MP3' })
  b.connect(gw, pg, { type: 'async', plane: 'control', label: 'call log' })
  b.assume('Every hop waits for the previous one to finish completely — the Latency Lab shows what that costs.')
  return {
    id: 'pat-simple',
    name: 'Simple voice bot',
    summary: 'Batch STT → LLM → batch TTS. One server, no streaming, no state tier.',
    whenToUse: 'Prototypes, internal demos, voicemail-style interactions where 2–4 s responses are acceptable.',
    whenNotToUse: 'Any real conversation: the serial pipeline typically lands 2.5–4 s of perceived latency (simulation estimate).',
    architecture: b.build(),
    tradeoffs: [
      { axis: 'Latency', note: 'Worst possible: every stage serialised.' },
      { axis: 'Complexity', note: 'Lowest: request/response everywhere, trivial to debug.' },
      { axis: 'Cost', note: 'Low: batch APIs are cheap; one small server.' },
    ],
  }
}

function streamingAgent(): ArchitecturePattern {
  const b = new ArchBuilder(
    'pat-streaming',
    'Streaming voice agent',
    'The modern default: streaming STT partials, streaming LLM tokens, sentence-chunked streaming TTS, VAD-driven turn taking with barge-in.',
    baseReq({ latencyTargetMs: 800, peakConcurrentCalls: 40 }),
  )
  const user = b.node('user', { col: 0 })
  const tel = b.node('telephony', { col: 1 })
  const gw = b.node('media-gateway', { col: 2 })
  const vad = b.node('vad', { col: 3, row: 0 })
  const stt = b.node('stt', { col: 3, row: 1 })
  const rt = b.node('agent-runtime', { col: 4 })
  const llm = b.node('llm', { col: 5, row: 0 })
  const tool = b.node('tool-api', { col: 5, row: 1 })
  const tts = b.node('tts', { col: 3, row: 2 })
  const redis = b.node('redis', { col: 6, row: 0 })
  const pg = b.node('postgres', { col: 6, row: 1 })
  b.connect(user, tel, { protocol: 'PSTN', direction: 'bi' })
  b.connect(tel, gw, { protocol: 'WebSocket', type: 'persistent', direction: 'bi', label: 'mu-law 8k frames' })
  b.connect(gw, vad, { type: 'streaming', direction: 'uni' })
  b.connect(gw, stt, { type: 'streaming', direction: 'bi', label: 'audio ↑ / partials ↓' })
  b.connect(stt, rt, { type: 'streaming', direction: 'uni' })
  b.connect(rt, llm, { type: 'streaming', direction: 'bi', protocol: 'HTTP/2', label: 'prompt / token stream' })
  b.connect(rt, tool, { type: 'sync', plane: 'control', label: 'timeout 1.5s' })
  b.connect(rt, tts, { type: 'streaming', direction: 'uni', label: 'sentence chunks' })
  b.connect(tts, gw, { type: 'streaming', direction: 'uni', label: 'audio chunks' })
  b.connect(rt, redis, { type: 'sync', plane: 'control', label: 'state @ turn boundaries' })
  b.connect(rt, pg, { type: 'async', plane: 'control', label: 'durable writes (async)' })
  return {
    id: 'pat-streaming',
    name: 'Streaming voice agent',
    summary: 'Everything overlaps: recognition during speech, synthesis during generation. Sub-second perceived latency.',
    whenToUse: 'Any production conversational agent. This is the reference architecture most of this simulator teaches.',
    whenNotToUse: 'Throwaway prototypes (complexity) or when a realtime S2S model fits and lock-in is acceptable.',
    architecture: b.build(),
    tradeoffs: [
      { axis: 'Latency', note: 'Sub-second achievable; endpointing becomes the biggest remaining knob.' },
      { axis: 'Complexity', note: 'Partials, revision, sentence-chunking, barge-in cancellation — real orchestration.' },
      { axis: 'Control', note: 'Full: every stage swappable, transcript inspectable, per-stage fallbacks possible.' },
    ],
  }
}

function browserAgent(): ArchitecturePattern {
  const b = new ArchBuilder(
    'pat-browser',
    'Browser WebRTC agent',
    'No phone number: users click a button. WebRTC brings 48 kHz audio, built-in echo cancellation, and zero per-minute carrier fees.',
    baseReq({ channel: 'browser', latencyTargetMs: 700, peakConcurrentCalls: 50 }),
  )
  const brow = b.node('browser', { col: 0 })
  const rtc = b.node('webrtc', { col: 1, label: 'WebRTC + TURN' })
  const gw = b.node('media-gateway', { col: 2 })
  const vad = b.node('vad', { col: 3, row: 0 })
  const stt = b.node('stt', { col: 3, row: 1 })
  const rt = b.node('agent-runtime', { col: 4 })
  const llm = b.node('llm', { col: 5 })
  const tts = b.node('tts', { col: 3, row: 2 })
  const redis = b.node('redis', { col: 6 })
  b.connect(brow, rtc, { protocol: 'WebRTC', type: 'persistent', direction: 'bi', label: 'Opus 48k / SRTP' })
  b.connect(rtc, gw, { protocol: 'RTP', type: 'streaming', direction: 'bi' })
  b.connect(gw, vad, { type: 'streaming', direction: 'uni' })
  b.connect(gw, stt, { type: 'streaming', direction: 'bi', label: 'PCM 16k (from 48k — accuracy win)' })
  b.connect(stt, rt, { type: 'streaming', direction: 'uni' })
  b.connect(rt, llm, { type: 'streaming', direction: 'bi', protocol: 'HTTP/2' })
  b.connect(rt, tts, { type: 'streaming', direction: 'uni' })
  b.connect(tts, gw, { type: 'streaming', direction: 'uni' })
  b.connect(rt, redis, { type: 'sync', plane: 'control' })
  b.assume('TURN relay needed for ~10–20% of users behind strict NATs (assumption).')
  return {
    id: 'pat-browser',
    name: 'Browser WebRTC agent',
    summary: 'WebRTC edge instead of telephony: better audio, no carrier fees, needs STUN/TURN.',
    whenToUse: 'Web products, support widgets, demos — anywhere the user is already on your page.',
    whenNotToUse: 'When users must reach you from a plain phone; then this pattern *complements* the phone pattern behind the same pipeline.',
    architecture: b.build(),
    tradeoffs: [
      { axis: 'Audio quality', note: '48 kHz clean capture: measurably better STT than 8 kHz phone audio.' },
      { axis: 'Reach', note: 'Requires your page to be open; no PSTN reach.' },
      { axis: 'Cost', note: 'No per-minute carrier fees; you pay for TURN bandwidth instead.' },
    ],
  }
}

function fromDecisions(id: string, name: string, req: Requirements, meta: Omit<ArchitecturePattern, 'id' | 'name' | 'architecture'>): ArchitecturePattern {
  const arch = decideArchitecture(req).architecture
  arch.id = id
  arch.name = name
  return { id, name, architecture: arch, ...meta }
}

export const PATTERNS: ArchitecturePattern[] = [
  simpleVoiceBot(),
  streamingAgent(),
  browserAgent(),
  fromDecisions('pat-phone-agent', 'Phone AI agent (production single-region)', baseReq({
    name: 'Phone AI agent', callsPerDay: 2000, peakConcurrentCalls: 120, latencyTargetMs: 900, availabilityTarget: 0.995, recording: true,
  }), {
    summary: 'CPaaS telephony, streaming pipeline, Redis session state, queue for side effects, recording to object storage.',
    whenToUse: 'A real product answering real phone calls at modest scale.',
    whenNotToUse: 'Above ~5k concurrent (go distributed/multi-region) or for browser-first products.',
    tradeoffs: [
      { axis: 'Scaling', note: 'Connection-aware media tier behind an LB; deploys drain.' },
      { axis: 'Reliability', note: 'Fallback TTS + timeouts; single STT vendor accepted at 99.5%.' },
    ],
  }),
  fromDecisions('pat-support', 'AI customer support (with tools)', baseReq({
    name: 'AI customer support', callsPerDay: 5000, peakConcurrentCalls: 300, latencyTargetMs: 800, availabilityTarget: 0.999, recording: true, toolUsage: 0.7,
  }), {
    summary: 'Streaming pipeline + heavy tool use (CRM, orders, bookings) + queue-isolated side effects + provider fallbacks.',
    whenToUse: 'Support automation where the agent must act (look up, book, update), not just talk.',
    whenNotToUse: 'Pure FAQ deflection — that needs far less machinery.',
    tradeoffs: [
      { axis: 'Tools', note: 'Blocking reads ≤1.5 s with filler; writes async via queue with idempotency keys.' },
      { axis: 'Backends', note: 'AI concurrency multiplies load on legacy systems sized for human agents.' },
    ],
  }),
  fromDecisions('pat-sales', 'AI outbound sales agent', baseReq({
    name: 'AI sales agent', callsPerDay: 20000, peakConcurrentCalls: 400, latencyTargetMs: 900, direction: 'outbound', recording: true, budgetPosture: 'low-cost',
  }), {
    summary: 'Dialer-paced outbound at CPS limits, answer-detection, low-cost voice tier, aggressive cost tuning.',
    whenToUse: 'High-volume outbound campaigns where unit economics decide viability.',
    whenNotToUse: 'Anywhere regulations around automated outbound calling are not fully sorted (treat compliance notes as educational).',
    tradeoffs: [
      { axis: 'Cost', note: 'Cheap TTS + trimmed prompts: the Cost Simulator shows why these two dominate.' },
      { axis: 'Telephony', note: 'Outbound CPS quotas pace the dialer; answer rates drive real throughput.' },
    ],
  }),
  fromDecisions('pat-handoff', 'AI + human handoff', baseReq({
    name: 'AI + human handoff', callsPerDay: 3000, peakConcurrentCalls: 200, latencyTargetMs: 900, availabilityTarget: 0.999, humanHandoff: true, recording: true,
  }), {
    summary: 'Full streaming pipeline plus a staffed human tier: skill routing, queueing, warm transfer, context screen-pop, no-agent fallback.',
    whenToUse: 'Whenever the AI can reach the edge of its competence with a customer still on the line — i.e. almost always, eventually.',
    whenNotToUse: 'Fully self-service products with an async escape hatch (ticket, callback) instead of live humans.',
    tradeoffs: [
      { axis: 'Cost', note: 'Humans ≈ 50× the per-minute cost of the AI (assumption): the escalation threshold is the budget.' },
      { axis: 'State', note: 'Handoff = media + context transfer; both must survive independent failures.' },
    ],
  }),
  fromDecisions('pat-outbound-scale', 'High-scale outbound calling (1,000 concurrent)', baseReq({
    name: 'High-scale outbound', callsPerDay: 100000, peakConcurrentCalls: 1000, latencyTargetMs: 1000, direction: 'outbound', availabilityTarget: 0.999, recording: true, budgetPosture: 'low-cost',
  }), {
    summary: 'Distributed single-region: ~29 media instances, split runtime tier, clustered Redis/queue, Kafka event log, K8s autoscaling.',
    whenToUse: 'Campaign platforms and collection/reminder dialers at four-digit concurrency.',
    whenNotToUse: 'Below ~500 concurrent, this much platform is premature.',
    tradeoffs: [
      { axis: 'Blast radius', note: '50 calls/instance chosen deliberately: each instance loss drops ≤50 calls.' },
      { axis: 'Autoscaling', note: 'Scale on connections + arrival rate; CPU alone lags the spike.' },
    ],
  }),
  fromDecisions('pat-multiregion', 'Multi-region voice platform (10,000+ concurrent)', baseReq({
    name: 'Multi-region platform', callsPerDay: 500000, peakConcurrentCalls: 10000, latencyTargetMs: 800, availabilityTarget: 0.9995, regions: ['in-mumbai', 'us-east', 'eu-west'], humanHandoff: true, recording: true,
  }), {
    summary: 'Regional media termination, region-local session state, replicated durable data, global routing with failover, per-region autoscaling.',
    whenToUse: 'Global products, five-digit concurrency, or availability targets a single region cannot honestly meet.',
    whenNotToUse: 'Anywhere a single region still fits: multi-region doubles the operational surface before it saves you anything.',
    tradeoffs: [
      { axis: 'Physics', note: 'Media terminates near the caller; only durable data crosses oceans.' },
      { axis: 'Consistency', note: 'Regional sources of truth + explicit replication story; partitions are designed for, not hoped away.' },
    ],
  }),
  fromDecisions('pat-enterprise', 'Enterprise voice platform', baseReq({
    name: 'Enterprise platform', callsPerDay: 200000, peakConcurrentCalls: 5000, latencyTargetMs: 800, availabilityTarget: 0.9995, regions: ['us-east', 'eu-west'], humanHandoff: true, recording: true, compliance: ['PII handling', 'audit logging', 'retention policy'], budgetPosture: 'premium',
  }), {
    summary: 'The everything pattern: multi-region, dual providers everywhere, human tier, recording + retention, audit trail, full observability.',
    whenToUse: 'Regulated industries and large enterprises where the RFP has a security tab longer than the product tab.',
    whenNotToUse: 'Startups: this is a destination, not a starting point. Compliance items shown are educational architecture considerations, not legal advice.',
    tradeoffs: [
      { axis: 'Security', note: 'PII redaction in transcripts, encrypted media, audited access — each adds latency or cost somewhere visible.' },
      { axis: 'Cost', note: 'Premium everything; the Cost Simulator shows enterprise floors clearly.' },
    ],
  }),
]

export function getPattern(id: string): ArchitecturePattern | undefined {
  return PATTERNS.find((p) => p.id === id)
}
