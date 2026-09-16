import { useEffect, useMemo, useState } from 'react'
import { computeLatency, DEFAULT_LATENCY_PARAMS, streamingComparison, type LatencyParams } from '../models/latency'
import { LatencyMilestones, LatencyWaterfall } from '../ui/LatencyWaterfall'
import { Assumption, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { Segmented, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'

export default function LatencyLab() {
  const [p, setP] = useState<LatencyParams>({ ...DEFAULT_LATENCY_PARAMS })
  const markProgress = useAppStore((s) => s.markProgress)
  const set = <K extends keyof LatencyParams>(k: K, v: LatencyParams[K]) => setP((prev) => ({ ...prev, [k]: v }))

  const breakdown = useMemo(() => computeLatency(p), [p])
  const comparison = useMemo(() => streamingComparison(p), [p])
  const allStreaming = p.sttStreaming && p.llmStreaming && p.ttsStreaming
  const noneStreaming = !p.sttStreaming && !p.llmStreaming && !p.ttsStreaming

  useEffect(() => {
    markProgress('compared-streaming')
  }, [markProgress])

  return (
    <div className="p-4">
      <PageHeader
        title="Latency Lab"
        subtitle="A closed-form model of the response pipeline. Move any slider and the entire waterfall recomputes — including the two facts that matter most: endpointing and STT run in parallel (the later gates the turn), and streaming stages overlap instead of adding."
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

          <Panel title="Network">
            <div className="space-y-3">
              <Slider label="User ↔ edge (one way)" value={p.userToEdgeMs} onChange={(v) => set('userToEdgeMs', v)} min={5} max={300} step={5} unit="ms" help="Carrier/last-mile to your region. Region placement is the only fix." />
              <Slider label="Edge ↔ server" value={p.edgeToServerMs} onChange={(v) => set('edgeToServerMs', v)} min={1} max={100} step={1} unit="ms" />
              <Slider label="Server ↔ AI providers" value={p.serverToProviderMs} onChange={(v) => set('serverToProviderMs', v)} min={1} max={150} step={1} unit="ms" help="Same-region provider endpoints make this small; cross-region makes it painful — per stage, per direction." />
              <Slider label="Audio frame size" value={p.frameMs} onChange={(v) => set('frameMs', v)} min={10} max={120} step={10} unit="ms" />
              <Slider label="Jitter buffer" value={p.jitterBufferMs} onChange={(v) => set('jitterBufferMs', v)} min={0} max={200} step={10} unit="ms" />
            </div>
          </Panel>

          <Panel title="Detection & STT">
            <div className="space-y-3">
              <Slider label="Endpointing silence timeout" value={p.endpointingMs} onChange={(v) => set('endpointingMs', v)} min={100} max={2000} step={50} unit="ms"
                help="The deliberate wait after silence. Usually the single largest segment — and pure product tuning." />
              <Slider label="STT finalization (streaming)" value={p.sttFinalizeMs} onChange={(v) => set('sttFinalizeMs', v)} min={50} max={800} step={10} unit="ms" />
              <Slider label="Batch STT real-time factor" value={p.sttBatchRtf} onChange={(v) => set('sttBatchRtf', v)} min={0.05} max={1} step={0.05}
                help="Batch only: 0.2 means a 5 s utterance takes 1 s to process — after the user stops." />
              <Slider label="Utterance length" value={p.utteranceSeconds} onChange={(v) => set('utteranceSeconds', v)} min={1} max={20} step={0.5} unit="s" />
            </div>
          </Panel>

          <Panel title="LLM, tools & TTS">
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
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Latency waterfall — end of user speech → agent audio heard">
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
        </div>
      </div>
    </div>
  )
}
