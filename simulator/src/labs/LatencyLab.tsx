import { useEffect, useMemo, useRef, useState } from 'react'
import { computeLatency, DEFAULT_LATENCY_PARAMS, streamingComparison, type LatencyParams } from '../models/latency'
import { LatencyMilestones, LatencyWaterfall } from '../ui/LatencyWaterfall'
import { Assumption, Callout, Disclosure, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { Segmented, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'
import { LATENCY_BANDS, PERCEIVED_LATENCY_Q, bandFor } from '../domain/prediction'
import { PredictionGate } from '../ui/Prediction'
import { perceptionBand } from '../domain/numbers'

export default function LatencyLab() {
  const [p, setP] = useState<LatencyParams>({ ...DEFAULT_LATENCY_PARAMS })
  const markProgress = useAppStore((s) => s.markProgress)
  const set = <K extends keyof LatencyParams>(k: K, v: LatencyParams[K]) => setP((prev) => ({ ...prev, [k]: v }))

  const breakdown = useMemo(() => computeLatency(p), [p])
  const comparison = useMemo(() => streamingComparison(p), [p])
  const allStreaming = p.sttStreaming && p.llmStreaming && p.ttsStreaming
  const noneStreaming = !p.sttStreaming && !p.llmStreaming && !p.ttsStreaming

  // The course step here needs evidence, not attendance: both pipeline shapes
  // looked at, AND a latency band predicted correctly before the waterfall was
  // revealed. The prediction flag is written by the gate, never by this lab.
  const predictedLatency = useAppStore((s) => s.progress['predicted:perceived-latency'])
  const seenModes = useRef(new Set<string>())
  useEffect(() => {
    if (allStreaming) seenModes.current.add('streaming')
    if (noneStreaming) seenModes.current.add('batch')
    if (seenModes.current.size === 2 && predictedLatency) markProgress('latency-predicted')
  }, [allStreaming, noneStreaming, predictedLatency, markProgress])

  return (
    <div className="p-4">
      <PageHeader
        title="Latency"
        steps={[
          "Press “All batch”, note the perceived latency, then press “All streaming”. That gap is the entire argument for streaming.",
          "Find the longest bar in the waterfall. It is usually endpointing — product tuning, not engineering.",
          "Open the parameter panels below and drag “Tool call on critical path” to 1.5 s to see what one CRM lookup costs you.",
        ]}
        subtitle="Endpointing and STT run in parallel, and streaming stages overlap instead of adding up. Everything else follows from those two facts."
        right={<Assumption>Every value is an editable assumption</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <div className="space-y-3">
          <Panel title="Pipeline mode">
            <div className="mb-3">
              <Segmented
                ariaLabel="Pipeline mode"
                value={allStreaming ? 'stream' : noneStreaming ? 'batch' : 'mixed'}
                onChange={(v) => {
                  if (v === 'stream') setP((prev) => ({ ...prev, sttStreaming: true, llmStreaming: true, ttsStreaming: true }))
                  if (v === 'batch') setP((prev) => ({ ...prev, sttStreaming: false, llmStreaming: false, ttsStreaming: false }))
                }}
                options={[
                  { value: 'stream', label: 'All streaming' },
                  { value: 'batch', label: 'All batch' },
                  { value: 'mixed', label: 'Mixed' },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Toggle label="Streaming STT (partials during speech)" checked={p.sttStreaming} onChange={(v) => set('sttStreaming', v)} />
              <Toggle label="Streaming LLM (speak on first sentence)" checked={p.llmStreaming} onChange={(v) => set('llmStreaming', v)} />
              <Toggle label="Streaming TTS (first chunk early)" checked={p.ttsStreaming} onChange={(v) => set('ttsStreaming', v)} />
            </div>
          </Panel>

          <Disclosure summary="Network" hint="5 parameters" advanced>
            <div className="space-y-3">
              <Slider label="User ↔ edge (one way)" value={p.userToEdgeMs} onChange={(v) => set('userToEdgeMs', v)} min={5} max={300} step={5} unit="ms" help="Carrier/last-mile to your region. Region placement is the only fix." />
              <Slider label="Edge ↔ server" value={p.edgeToServerMs} onChange={(v) => set('edgeToServerMs', v)} min={1} max={100} step={1} unit="ms" />
              <Slider label="Server ↔ AI providers" value={p.serverToProviderMs} onChange={(v) => set('serverToProviderMs', v)} min={1} max={150} step={1} unit="ms" help="Same-region provider endpoints make this small; cross-region makes it painful — per stage, per direction." />
              <Slider label="Audio frame size" value={p.frameMs} onChange={(v) => set('frameMs', v)} min={10} max={120} step={10} unit="ms" />
              <Slider label="Jitter buffer" value={p.jitterBufferMs} onChange={(v) => set('jitterBufferMs', v)} min={0} max={200} step={10} unit="ms" />
            </div>
          </Disclosure>

          <Disclosure summary="Detection & STT" hint="4 parameters" advanced>
            <div className="space-y-3">
              <Slider label="Endpointing silence timeout" value={p.endpointingMs} onChange={(v) => set('endpointingMs', v)} min={100} max={2000} step={50} unit="ms"
                help="The deliberate wait after silence. Usually the single largest segment — and pure product tuning." />
              <Slider label="STT finalization (streaming)" value={p.sttFinalizeMs} onChange={(v) => set('sttFinalizeMs', v)} min={50} max={800} step={10} unit="ms" />
              <Slider label="Batch STT real-time factor" value={p.sttBatchRtf} onChange={(v) => set('sttBatchRtf', v)} min={0.05} max={1} step={0.05}
                help="Batch only: 0.2 means a 5 s utterance takes 1 s to process — after the user stops." />
              <Slider label="Utterance length" value={p.utteranceSeconds} onChange={(v) => set('utteranceSeconds', v)} min={1} max={20} step={0.5} unit="s" />
            </div>
          </Disclosure>

          <Disclosure summary="LLM, tools & TTS" hint="8 parameters" advanced defaultOpen={p.toolMs > 0}>
            <div className="space-y-3">
              <Slider label="LLM time-to-first-token" value={p.llmFirstTokenMs} onChange={(v) => set('llmFirstTokenMs', v)} min={80} max={2000} step={10} unit="ms" />
              <Slider label="LLM tokens / second" value={p.llmTokensPerSecond} onChange={(v) => set('llmTokensPerSecond', v)} min={10} max={300} step={5} />
              <Slider label="Response length" value={p.responseTokens} onChange={(v) => set('responseTokens', v)} min={10} max={400} step={5} unit="tokens" />
              <Slider label="First speakable sentence" value={p.firstSentenceTokens} onChange={(v) => set('firstSentenceTokens', v)} min={5} max={60} step={1} unit="tokens" />
              <Slider label="Tool call on critical path" value={p.toolMs} onChange={(v) => set('toolMs', v)} min={0} max={4000} step={50} unit="ms"
                help="0 = no tool this turn. Watch what a 1.5 s CRM lookup does to the total." />
              <Slider label="TTS time-to-first-audio" value={p.ttsFirstAudioMs} onChange={(v) => set('ttsFirstAudioMs', v)} min={50} max={1500} step={10} unit="ms" />
              <Slider label="Reply audio length (batch TTS)" value={p.responseAudioSeconds} onChange={(v) => set('responseAudioSeconds', v)} min={1} max={30} step={1} unit="s" />
              <Slider label="Latency budget" value={p.budgetMs} onChange={(v) => set('budgetMs', v)} min={300} max={3000} step={50} unit="ms" />
            </div>
          </Disclosure>
        </div>

        <PredictionGate
          question={PERCEIVED_LATENCY_Q}
          route="/latency"
          actual={bandFor(breakdown.perceivedLatencyMs, LATENCY_BANDS).id}
          resetKey={`${p.sttStreaming}${p.llmStreaming}${p.ttsStreaming}:${p.endpointingMs}:${p.toolMs}`}
          note={
            <>
              This pipeline is{' '}
              <b className="text-ink-200">
                {allStreaming ? 'fully streaming' : noneStreaming ? 'fully batch' : 'partly streaming'}
              </b>
              , endpointing waits {p.endpointingMs} ms, and there {p.toolMs > 0 ? `is a ${p.toolMs} ms tool call` : 'is no tool call'} on the
              critical path. Remember that streaming stages overlap rather than adding up.
            </>
          }
        >
          <Panel
            title="Latency waterfall — end of user speech → agent audio heard"
            right={
              <span className="chip tone-neutral" title={perceptionBand(breakdown.perceivedLatencyMs).feels}>
                feels: {perceptionBand(breakdown.perceivedLatencyMs).label}
              </span>
            }
          >
            <LatencyWaterfall breakdown={breakdown} />
          </Panel>

          <LatencyMilestones breakdown={breakdown} />

          <Panel title="Streaming vs batch — same settings, both worlds">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Batch pipeline" value={fmtMs(comparison.batch.perceivedLatencyMs)} tone="bad" hint="Every stage waits for the previous stage to fully complete." />
              <Stat label="Streaming pipeline" value={fmtMs(comparison.streaming.perceivedLatencyMs)} tone="good" hint="Stages overlap; only first-outputs are on the critical path." />
              <Stat label="Streaming saves" value={fmtMs(comparison.savedMs)} tone="accent" hint="The whole argument for streaming, in one number." />
            </div>
            <Callout tone="info" title="Where does the saving come from?">
              Batch STT processes the whole utterance <em>after</em> speech ends; streaming STT finished most of it <em>during</em> speech.
              Batch LLM+TTS wait for the full reply and the full audio; streaming needs only the first sentence and the first chunk.
              The remaining floor is physics (network), product tuning (endpointing) and provider first-token/first-audio times.
            </Callout>
          </Panel>
        </PredictionGate>
      </div>
    </div>
  )
}
