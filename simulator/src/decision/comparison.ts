/**
 * Architecture comparison: batch vs streaming vs speech-to-speech vs hybrid.
 * Numeric rows come from the analytic latency model with stated assumptions;
 * qualitative rows are explicit prose, not scores — per the design brief,
 * no arbitrary numbers pretending to be measurements.
 */

import { computeLatency, DEFAULT_LATENCY_PARAMS, type LatencyParams } from '../models/latency'

export interface ComparisonColumn {
  id: 'batch' | 'streaming' | 's2s' | 'hybrid'
  name: string
  pipeline: string
  perceivedLatencyMs: number
  latencyBasis: string
}

export interface ComparisonRow {
  axis: string
  cells: Record<ComparisonColumn['id'], string>
  insight: string
}

export interface ComparisonData {
  columns: ComparisonColumn[]
  rows: ComparisonRow[]
  assumptions: string[]
}

export function buildComparison(base: LatencyParams = DEFAULT_LATENCY_PARAMS): ComparisonData {
  const batch = computeLatency({ ...base, sttStreaming: false, llmStreaming: false, ttsStreaming: false })
  const streaming = computeLatency({ ...base, sttStreaming: true, llmStreaming: true, ttsStreaming: true })
  // S2S approximation: endpointing (or native turn detection) + model first-audio + network.
  const s2sPerceived = Math.round(
    base.userToEdgeMs + base.edgeToServerMs + base.frameMs / 2 +
    Math.min(base.endpointingMs, 400) + // native turn detection tends to commit faster (assumption)
    base.serverToProviderMs + 450 + // S2S first-audio assumption
    base.serverToProviderMs + base.edgeToServerMs + base.userToEdgeMs + base.jitterBufferMs,
  )
  const hybridPerceived = streaming.perceivedLatencyMs // hybrid ≈ streaming for routine turns

  const columns: ComparisonColumn[] = [
    { id: 'batch', name: 'A · Batch pipeline', pipeline: 'STT → LLM → TTS (each completes before the next starts)', perceivedLatencyMs: batch.perceivedLatencyMs, latencyBasis: 'Analytic model, all stages serialised' },
    { id: 'streaming', name: 'B · Streaming pipeline', pipeline: 'Streaming STT → streaming LLM → streaming TTS, overlapped', perceivedLatencyMs: streaming.perceivedLatencyMs, latencyBasis: 'Analytic model, stages overlapped' },
    { id: 's2s', name: 'C · Speech-to-speech', pipeline: 'One realtime model: audio in → audio out', perceivedLatencyMs: s2sPerceived, latencyBasis: 'Assumption: 450 ms model first-audio + native turn detection' },
    { id: 'hybrid', name: 'D · Hybrid', pipeline: 'S2S (or streaming) shell + text pipeline for tool/audit turns', perceivedLatencyMs: hybridPerceived, latencyBasis: 'Routine turns ≈ streaming; hard turns pay the text-pipeline price' },
  ]

  const rows: ComparisonRow[] = [
    {
      axis: 'Latency',
      cells: {
        batch: `~${(batch.perceivedLatencyMs / 1000).toFixed(1)} s perceived. Every stage waits for the previous one — the arithmetic is unforgiving.`,
        streaming: `~${(streaming.perceivedLatencyMs / 1000).toFixed(1)} s perceived; endpointing is the dominant remaining term.`,
        s2s: `~${(s2sPerceived / 1000).toFixed(1)} s perceived; the model's native turn detection commits faster than a VAD timeout (assumption).`,
        hybrid: `Routine turns match B; tool-heavy turns add the tool + phrasing round trip.`,
      },
      insight: 'Streaming vs batch is worth 1.5–3 s. Nothing else in this table moves the needle that much.',
    },
    {
      axis: 'Complexity',
      cells: {
        batch: 'Lowest. Request/response calls, easy retries, trivial debugging.',
        streaming: 'High. Partials, revisions, sentence chunking, cancellation on barge-in, per-stage timeouts.',
        s2s: 'Low on your side — the provider ate the complexity. Integration is one session API.',
        hybrid: 'Highest. Two paths to build, test, monitor — and a router deciding between them.',
      },
      insight: 'Complexity is not bad by itself; UNPAID complexity is. B\'s complexity buys latency; D\'s buys flexibility.',
    },
    {
      axis: 'Control & auditability',
      cells: {
        batch: 'Full: every intermediate artifact (transcript, prompt, reply text) is inspectable and filterable.',
        streaming: 'Full, same as A — with more moving parts to log.',
        s2s: 'Weak: no transcript boundary unless the provider exposes one; content filtering happens inside the black box.',
        hybrid: 'Full where it matters: route regulated/tool turns through the text path.',
      },
      insight: 'If a compliance team must review what the agent said and why, C alone is a hard sell.',
    },
    {
      axis: 'Cost shape',
      cells: {
        batch: 'Cheapest APIs, but longer calls (slow turns) inflate per-minute meters.',
        streaming: 'Streaming APIs price similarly to batch (assumption); shorter calls actually save money.',
        s2s: 'Per-minute session pricing — the meter runs during silence. Long quiet calls are expensive.',
        hybrid: 'B\'s cost plus an S2S premium on the shell, minus tool-turn efficiency.',
      },
      insight: 'Compare on cost-per-RESOLVED-call, not per API call. The Cost Simulator models all four shapes.',
    },
    {
      axis: 'Scaling',
      cells: {
        batch: 'Simple: stateless-ish calls, provider quotas are the ceiling.',
        streaming: 'Connection-aware: one held STT/TTS stream per live call; quotas + your media tier.',
        s2s: 'Session quotas at the provider; your side is a thin relay.',
        hybrid: 'Both ceilings apply; capacity-plan each path separately.',
      },
      insight: 'In every column, provider concurrency quotas — not your servers — are the first ceiling you hit.',
    },
    {
      axis: 'Interruption handling',
      cells: {
        batch: 'Poor: nothing can be cancelled mid-stage; barge-in means abandoning a full response you already paid for.',
        streaming: 'Good, if built: cancel TTS, flush buffers, new turn — the state machine in this simulator.',
        s2s: 'Excellent, native: the model itself stops talking when interrupted.',
        hybrid: 'As good as its shell (S2S) on routine turns.',
      },
      insight: 'Barge-in quality is the difference users describe as “it actually listens”.',
    },
    {
      axis: 'Provider dependency',
      cells: {
        batch: 'Three swappable vendors; any one can be replaced in isolation.',
        streaming: 'Three swappable vendors + per-stage fallbacks — the most resilient shape.',
        s2s: 'One vendor owns hearing, thinking and speaking. Their outage is your total outage; their price change is your margin.',
        hybrid: 'S2S lock-in on the shell, softened by the surviving text path.',
      },
      insight: 'C concentrates exactly the risk B distributes. That is the trade, stated plainly.',
    },
    {
      axis: 'Audio quality / prosody',
      cells: {
        batch: 'TTS-quality bound; awkward turn pacing makes even good voices feel robotic.',
        streaming: 'TTS-quality bound; good pacing. Sentence-boundary artifacts possible.',
        s2s: 'Best: prosody, hesitations and tone carry across turns natively.',
        hybrid: 'S2S prosody on the shell.',
      },
      insight: 'Prosody is C\'s genuinely unmatched advantage — weigh it against the control you give up.',
    },
    {
      axis: 'Debugging a bad call',
      cells: {
        batch: 'Easy: four artifacts in a row; diff them.',
        streaming: 'Moderate: needs per-stage tracing (which this simulator\'s event log models).',
        s2s: 'Hard: audio in, audio out, vibes in between. Shadow STT or provider transcripts required.',
        hybrid: 'Split by path; routing decisions themselves become debugging targets.',
      },
      insight: 'Whatever you choose, the event timeline in the Live Call view is the observability you will wish you had.',
    },
  ]

  return {
    columns,
    rows,
    assumptions: [
      'Latency numbers come from the analytic model with the current Latency Lab parameters — change them there and this table follows.',
      'S2S first-audio (450 ms) and faster native turn-commit are stated assumptions, editable in code and labelled in the UI.',
      'Qualitative cells are engineering judgments to be argued with, not scores to be summed.',
    ],
  }
}
