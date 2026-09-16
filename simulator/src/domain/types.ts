/**
 * Central domain model for the Voice Agent Architecture Simulator.
 *
 * Everything in the app — the canvas, the call simulator, the validators,
 * the cost engine, the scaling model — reads and writes these types. There is
 * exactly one representation of "an architecture" and one representation of
 * "a component", so a change made in the Architecture Builder is immediately
 * visible to the Latency Lab, the Cost Simulator and the validator.
 *
 * NUMBERS IN THIS FILE AND IN THE COMPONENT REGISTRY ARE SIMULATION
 * ASSUMPTIONS. They are chosen to be order-of-magnitude plausible and to make
 * the *relationships* between design choices visible. They are not
 * measurements of any vendor's production system. Every place a number
 * reaches the UI it is accompanied by an `Assumption` label.
 */

// ---------------------------------------------------------------------------
// Planes, categories, protocols
// ---------------------------------------------------------------------------

/**
 * The media plane carries audio and is latency-critical. The control plane
 * carries state, routing, config and telemetry; it can be slower but it must
 * never block the media plane. Keeping this distinction explicit in the type
 * system is one of the core teaching goals of the simulator.
 */
export type Plane = 'media' | 'control' | 'both'

export type ComponentCategory =
  | 'endpoint'
  | 'telephony'
  | 'transport'
  | 'media'
  | 'speech'
  | 'intelligence'
  | 'runtime'
  | 'state'
  | 'data'
  | 'infrastructure'
  | 'observability'
  | 'human'
  | 'external'

export type Protocol =
  | 'PSTN'
  | 'SIP'
  | 'RTP'
  | 'SRTP'
  | 'RTCP'
  | 'WebSocket'
  | 'WebRTC'
  | 'HTTP'
  | 'HTTP/2'
  | 'gRPC'
  | 'TCP'
  | 'UDP'
  | 'AMQP'
  | 'Kafka'
  | 'Redis'
  | 'SQL'
  | 'internal'

/** How a connection behaves, which decides what the simulator does with it. */
export type ConnectionType =
  | 'sync'        // request/response; caller blocks
  | 'streaming'   // continuous frames both ways; latency measured per chunk
  | 'async'       // fire-and-forget / event; does not block the caller
  | 'persistent'  // long-lived session (WebSocket, WebRTC peer connection)
  | 'control'     // signalling / configuration; off the media path

export type Direction = 'uni' | 'bi'

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export type AudioEncoding =
  | 'pcm16'
  | 'pcm24'
  | 'pcmf32'
  | 'mulaw'
  | 'alaw'
  | 'opus'
  | 'mp3'
  | 'aac'
  | 'wav'
  | 'flac'

export interface AudioFormat {
  encoding: AudioEncoding
  /** Samples per second, e.g. 8000 for telephony, 16000 for most STT. */
  sampleRate: number
  channels: 1 | 2
  /** Bits per sample for uncompressed formats. Ignored for Opus/MP3/AAC. */
  bitDepth?: number
  /** Nominal bitrate in bits/sec for compressed formats. */
  bitrateBps?: number
  /** Packetisation interval in milliseconds (20 ms is the telephony default). */
  frameMs?: number
}

// ---------------------------------------------------------------------------
// Latency
// ---------------------------------------------------------------------------

/**
 * A latency model is deliberately explicit about *what kind* of latency a
 * component adds, because the difference is the whole lesson:
 *
 *  - `fixedMs`      constant overhead paid once (handshake, model warmup)
 *  - `perUnitMs`    scales with the work (per second of audio, per token)
 *  - `firstByteMs`  time to *first* output for a streaming component — the
 *                   number that actually decides perceived latency
 *  - `jitterMs`     +/- spread; sampled deterministically from the run seed
 *  - `queueingAtLoadMs` extra delay added as utilisation approaches 1
 */
export interface LatencyModel {
  fixedMs: number
  perUnitMs?: number
  unit?: 'audioSecond' | 'token' | 'request' | 'frame' | 'kb'
  firstByteMs?: number
  jitterMs?: number
  /** Latency multiplier applied at 100% utilisation (queueing blowup). */
  queueingAtLoadMs?: number
  /** True when the component can emit output before its input is complete. */
  streamingCapable?: boolean
}

// ---------------------------------------------------------------------------
// Resources, scaling, cost
// ---------------------------------------------------------------------------

export interface ResourceRequirements {
  /** Fractional CPU cores consumed per concurrent call/stream. */
  cpuPerCall?: number
  /** MB of RAM per concurrent call/stream. */
  memMbPerCall?: number
  /** kbit/s of network per concurrent call (both directions summed). */
  netKbpsPerCall?: number
  /** OS file descriptors / sockets per concurrent call. */
  fdPerCall?: number
  /** Baseline cores consumed by one instance at idle. */
  baseCpu?: number
  /** Baseline MB consumed by one instance at idle. */
  baseMemMb?: number
  /** GPU class needed, when the component is model inference. */
  gpu?: 'none' | 'shared' | 'dedicated'
}

export type ScalingAxis =
  | 'stateless-horizontal'   // add replicas behind a load balancer, trivially
  | 'connection-aware'       // long-lived connections pin work to a replica
  | 'vertical'               // must get a bigger box
  | 'partitioned'            // shard by key
  | 'managed-external'       // someone else's problem — but has quotas
  | 'single-instance'        // does not scale; a hard ceiling

export interface ScalingModel {
  axis: ScalingAxis
  /** Concurrent calls (or streams) one instance can carry. Assumption. */
  capacityPerInstance: number
  /** Seconds to bring a new instance into rotation. */
  warmupSeconds?: number
  /** Hard ceiling on instances (quota, licence, IP range). */
  maxInstances?: number
  /** True when sessions cannot be moved between instances without dropping. */
  stickySessions?: boolean
  notes?: string
}

export type CostUnit =
  | 'per-minute'
  | 'per-1k-input-tokens'
  | 'per-1k-output-tokens'
  | 'per-1k-chars'
  | 'per-instance-hour'
  | 'per-gb-month'
  | 'per-million-requests'
  | 'per-gb-egress'
  | 'free'

export interface CostModel {
  unit: CostUnit
  /** USD per unit. EXAMPLE ASSUMPTION — editable everywhere in the UI. */
  usdPerUnit: number
  /** Fixed USD/month regardless of traffic (reserved capacity, licences). */
  usdPerMonthFixed?: number
  note?: string
}

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

export type FailureKind =
  | 'unavailable'
  | 'timeout'
  | 'rate-limit'
  | 'degraded-latency'
  | 'partial-output'
  | 'disconnect'
  | 'packet-loss'
  | 'overload'
  | 'memory-pressure'
  | 'queue-saturation'
  | 'data-loss'
  | 'no-capacity'

export interface FailureMode {
  id: string
  kind: FailureKind
  name: string
  /** What the caller actually experiences. This is the teaching payload. */
  callerImpact: string
  /** What the engineer sees in telemetry. */
  signal: string
  /** Mitigations that a well-designed system has in place. */
  mitigations: string[]
  /** Probability per call when this failure is armed, 0..1. */
  defaultProbability: number
  /** Added latency in ms when kind is 'degraded-latency'. */
  degradedLatencyMs?: number
  /** True when the failure kills the call outright without mitigation. */
  fatal?: boolean
}

// ---------------------------------------------------------------------------
// Component specification (catalog blueprint)
// ---------------------------------------------------------------------------

/** Progressive-disclosure explanation attached to every component and concept. */
export interface LearningLevels {
  /** "What is happening?" — plain English, no jargon. */
  beginner: string
  /** "How does it work?" — mechanism, protocols, data shapes. */
  engineering: string
  /** "Why is it needed?" — what breaks without it. */
  architecture: string
  /** "How does it scale?" */
  infrastructure: string
  /** "What can go wrong?" */
  production: string
  /** "How would you redesign it under new constraints?" */
  architect: string
}

export interface ComponentSpec {
  id: string
  name: string
  short: string
  category: ComponentCategory
  plane: Plane
  description: string
  /** What problem this component exists to solve. */
  problemSolved: string
  inputs: string[]
  outputs: string[]
  protocols: Protocol[]
  /** Audio format this component expects on input, when it touches audio. */
  audioIn?: AudioFormat
  /** Audio format this component emits. */
  audioOut?: AudioFormat
  latency: LatencyModel
  /** Requests/streams per second one instance sustains. */
  throughputPerInstance?: number
  resources: ResourceRequirements
  scaling: ScalingModel
  cost?: CostModel
  failureModes: FailureMode[]
  /** Other spec ids this component typically needs. */
  dependencies?: string[]
  alternatives: string[]
  whyChoose: string
  ifItFails: string
  learn: LearningLevels
  /** Tunable knobs surfaced in the inspector; drive the simulation. */
  config?: ComponentConfigField[]
  /** True when the component sits on the real-time audio path. */
  onMediaPath: boolean
  /** Docs/reading pointers (concept ids in the knowledge base). */
  concepts?: string[]
}

export interface ComponentConfigField {
  key: string
  label: string
  type: 'number' | 'boolean' | 'select' | 'text'
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
  unit?: string
  help: string
}

// ---------------------------------------------------------------------------
// Architecture graph (instances)
// ---------------------------------------------------------------------------

export interface ArchNode {
  id: string
  specId: string
  /** Display label; defaults to the spec name but is user-editable. */
  label: string
  position: { x: number; y: number }
  /** Per-instance overrides of the spec's config fields. */
  config: Record<string, number | boolean | string>
  /** How many replicas of this component exist. */
  replicas: number
  /** Region this instance is deployed in (multi-region mode). */
  region?: RegionId
  notes?: string
}

export interface ArchEdge {
  id: string
  source: string
  target: string
  type: ConnectionType
  protocol: Protocol
  direction: Direction
  streaming: boolean
  /** Network latency in ms added by this hop. Assumption. */
  latencyMs: number
  /** Bandwidth in kbit/s consumed per active call over this edge. */
  bandwidthKbps?: number
  label?: string
  plane: Plane
}

export interface Architecture {
  id: string
  name: string
  description: string
  nodes: ArchNode[]
  edges: ArchEdge[]
  /** Assumptions the author wants carried with the design. */
  assumptions: string[]
  /** Requirements this architecture was designed against, if any. */
  requirements?: Requirements
  createdAt?: string
  version: 1
}

// ---------------------------------------------------------------------------
// Requirements & constraints
// ---------------------------------------------------------------------------

export type RegionId = 'in-mumbai' | 'us-east' | 'eu-west' | 'ap-singapore'

export interface Requirements {
  name: string
  callsPerDay: number
  avgCallSeconds: number
  peakCallsPerMinute: number
  /** Target concurrent calls the system must carry at peak. */
  peakConcurrentCalls: number
  /** Perceived response latency budget, in ms (user stops speaking -> hears agent). */
  latencyTargetMs: number
  availabilityTarget: 0.99 | 0.995 | 0.999 | 0.9995 | 0.9999
  languages: string[]
  regions: RegionId[]
  direction: 'inbound' | 'outbound' | 'both'
  channel: 'phone' | 'browser' | 'both'
  humanHandoff: boolean
  recording: boolean
  /** Fraction of turns that invoke a tool, 0..1. */
  toolUsage: number
  budgetPosture: 'low-cost' | 'balanced' | 'premium'
  compliance: string[]
  notes?: string
}

// ---------------------------------------------------------------------------
// Simulation events
// ---------------------------------------------------------------------------

export type SimEventType =
  | 'CALL_STARTED'
  | 'CALL_CONNECTED'
  | 'SIP_INVITE'
  | 'SIP_200_OK'
  | 'SIP_ACK'
  | 'SIP_BYE'
  | 'RTP_STREAM_STARTED'
  | 'WS_CONNECTED'
  | 'WS_FRAME_SENT'
  | 'WS_FRAME_RECEIVED'
  | 'AUDIO_FRAME_RECEIVED'
  | 'AUDIO_TRANSCODED'
  | 'SPEECH_STARTED'
  | 'SPEECH_ENDED'
  | 'VAD_TRIGGERED'
  | 'ENDPOINT_DETECTED'
  | 'TURN_COMPLETE'
  | 'TRANSCRIPT_PARTIAL'
  | 'TRANSCRIPT_FINAL'
  | 'CONTEXT_BUILT'
  | 'LLM_STARTED'
  | 'LLM_FIRST_TOKEN'
  | 'LLM_TOKEN'
  | 'LLM_COMPLETED'
  | 'TOOL_CALL_STARTED'
  | 'TOOL_CALL_COMPLETED'
  | 'DB_QUERY'
  | 'CACHE_HIT'
  | 'CACHE_MISS'
  | 'STATE_WRITTEN'
  | 'TTS_STARTED'
  | 'TTS_FIRST_AUDIO'
  | 'TTS_AUDIO_CHUNK'
  | 'TTS_COMPLETED'
  | 'PLAYBACK_STARTED'
  | 'PLAYBACK_COMPLETED'
  | 'USER_INTERRUPTION'
  | 'TTS_CANCELLED'
  | 'BUFFER_CLEARED'
  | 'HANDOFF_REQUESTED'
  | 'HANDOFF_QUEUED'
  | 'HANDOFF_ACCEPTED'
  | 'HANDOFF_COMPLETED'
  | 'HANDOFF_FAILED'
  | 'CALL_ENDED'
  | 'PROVIDER_ERROR'
  | 'NETWORK_ERROR'
  | 'RETRY'
  | 'TIMEOUT'
  | 'FALLBACK_ENGAGED'
  | 'CIRCUIT_OPENED'
  | 'CIRCUIT_HALF_OPEN'
  | 'CIRCUIT_CLOSED'
  | 'SERVER_OVERLOAD'
  | 'BACKPRESSURE'
  | 'RECONNECT'
  | 'SCALE_UP'
  | 'SCALE_DOWN'
  | 'REGION_FAILOVER'
  | 'NOTE'

export type EventStatus = 'ok' | 'warn' | 'error' | 'info'

export interface SimEvent {
  /** Monotonic sequence number; ties are broken by it, so ordering is total. */
  seq: number
  /** Virtual time in milliseconds since simulation start. */
  t: number
  type: SimEventType
  /** Node id in the architecture that produced the event, when applicable. */
  nodeId?: string
  /** Human label of the producing component. */
  component: string
  plane: Plane
  status: EventStatus
  /** One-line summary shown in the timeline. */
  summary: string
  /** Duration of the work this event represents, in ms. */
  durationMs?: number
  /** Payload description — what actually moved. */
  payloadType?: string
  /** Bytes moved by this event. */
  bytes?: number
  /** Arbitrary inspectable detail, rendered as a key/value table. */
  detail?: Record<string, string | number | boolean>
  /** Correlates a start event with its completion. */
  spanId?: string
  /** Call this event belongs to (multi-call runs). */
  callId?: string
}

// ---------------------------------------------------------------------------
// Latency breakdown
// ---------------------------------------------------------------------------

export interface LatencySegment {
  key: string
  label: string
  ms: number
  /** Where in the pipeline this sits; used to colour the waterfall. */
  stage: 'network' | 'audio' | 'detect' | 'stt' | 'llm' | 'tool' | 'tts' | 'playback'
  /** True when this segment is on the critical path to first audio. */
  criticalPath: boolean
  explanation: string
  startMs: number
}

export interface LatencyBreakdown {
  segments: LatencySegment[]
  timeToFirstTranscriptMs: number
  timeToFinalTranscriptMs: number
  timeToFirstLlmTokenMs: number
  timeToFirstTtsAudioMs: number
  /** Wall-clock from end of user speech to agent audio reaching the user. */
  perceivedLatencyMs: number
  /** Includes the endpointing wait, which the user also perceives. */
  totalResponseMs: number
  budgetMs: number
  withinBudget: boolean
  notes: string[]
}

// ---------------------------------------------------------------------------
// Resource / capacity
// ---------------------------------------------------------------------------

export interface ResourceUsage {
  nodeId: string
  label: string
  instances: number
  capacityPerInstance: number
  /** Concurrent calls (or equivalent units) currently offered to the node. */
  offered: number
  /** Total capacity across instances. */
  capacity: number
  utilisation: number
  cpuCores: number
  memMb: number
  netKbps: number
  connections: number
  bottleneck: boolean
  scalingAxis: ScalingAxis
}

export interface Bottleneck {
  nodeId: string
  label: string
  utilisation: number
  offered: number
  capacity: number
  severity: 'warning' | 'critical'
  why: string
  consequences: string[]
  remedies: string[]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  ruleId: string
  severity: IssueSeverity
  title: string
  /** Node/edge ids the issue points at, for canvas highlighting. */
  targets: string[]
  /** What the simulator observed. */
  detected: string
  /** Why this matters in a voice system specifically. */
  why: string
  /** Concrete remedy. */
  fix: string
  /** Real-world engineering principle behind the rule. */
  principle: string
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface CostLineItem {
  key: string
  label: string
  category: 'speech' | 'intelligence' | 'telephony' | 'compute' | 'data' | 'storage' | 'observability'
  usdPerCall: number
  usdPerDay: number
  usdPerMonth: number
  basis: string
}

export interface CostResult {
  lineItems: CostLineItem[]
  usdPerCall: number
  usdPerMinute: number
  usdPerDay: number
  usdPerMonth: number
  usdPerYear: number
  assumptions: string[]
}

// ---------------------------------------------------------------------------
// Decisions — Requirement -> Constraint -> Decision -> Tradeoff
// ---------------------------------------------------------------------------

export interface DecisionRecord {
  id: string
  requirement: string
  constraint: string
  decision: string
  tradeoff: string
  /** Component spec ids this decision pulls into the architecture. */
  addsComponents: string[]
  alternatives: { option: string; whyNot: string }[]
  confidence: 'high' | 'medium' | 'contextual'
}

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

export interface StateDef {
  id: string
  name: string
  description: string
  onEntry: string[]
  onExit: string[]
  timers: { name: string; ms: number; onExpiry: string }[]
  failures: string[]
  cleanup: string[]
}

export interface TransitionDef {
  from: string
  to: string
  event: string
  guard?: string
  action?: string
}

export interface StateMachineDef {
  id: string
  name: string
  description: string
  initial: string
  states: StateDef[]
  transitions: TransitionDef[]
}

// ---------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------

export interface KnowledgeCard {
  id: string
  term: string
  category:
    | 'audio'
    | 'networking'
    | 'telephony'
    | 'ai'
    | 'agents'
    | 'infrastructure'
    | 'reliability'
    | 'observability'
    | 'security'
  whatIsIt: string
  whyExists: string
  problemSolved: string
  whereInVoice: string
  alternatives: string[]
  limitations: string[]
  scaling: string
  failureModes: string[]
  related: string[]
  keyNumbers?: { label: string; value: string; note: string }[]
}

// ---------------------------------------------------------------------------
// Scenarios & challenges
// ---------------------------------------------------------------------------

export interface Scenario {
  id: string
  name: string
  tagline: string
  story: string
  requirements: Requirements
  /** Pattern id that is a reasonable answer to this scenario. */
  referencePatternId: string
  /** Things that make this scenario interesting/hard. */
  crux: string[]
  learningGoals: string[]
  sampleUtterance: string
  tools: string[]
}

export interface ArchitecturePattern {
  id: string
  name: string
  summary: string
  whenToUse: string
  whenNotToUse: string
  architecture: Architecture
  tradeoffs: { axis: string; note: string }[]
}

export interface ChallengeQuestion {
  id: string
  prompt: string
  kind: 'choice' | 'multi' | 'text'
  options?: { id: string; label: string }[]
  /** Option ids that are defensible answers. */
  goodAnswers?: string[]
  /** Option ids that are outright wrong for the scenario. */
  badAnswers?: string[]
  feedback: Record<string, string>
  principle: string
}

export interface Challenge {
  id: string
  title: string
  requirements: Requirements
  questions: ChallengeQuestion[]
  /** Spec ids a passing architecture is expected to contain. */
  expectedComponents: string[]
  /** Spec ids that are red flags for this scenario. */
  discouragedComponents: string[]
  rubric: string[]
}

export interface EvaluationFinding {
  kind: 'satisfies' | 'violates' | 'assumption' | 'tradeoff' | 'bottleneck' | 'suggestion'
  title: string
  detail: string
  targets?: string[]
}

export interface EvaluationResult {
  scoreLabel: string
  findings: EvaluationFinding[]
  latency?: LatencyBreakdown
  cost?: CostResult
  bottlenecks: Bottleneck[]
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Learning progression
// ---------------------------------------------------------------------------

export interface LearningLevel {
  level: number
  title: string
  goal: string
  /** Route the learner should visit. */
  route: string
  /** Human-checkable completion criteria. */
  criteria: string[]
  /** Id of the progress flag set when the criteria are met. */
  flag: string
}

export type ViewMode = 'simple' | 'engineering'
