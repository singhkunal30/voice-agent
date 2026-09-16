import { useMemo, useState } from 'react'
import {
  ENCODINGS,
  analysePipeline,
  bitrateBps,
  bytesForSeconds,
  bytesPerFrame,
  bytesPerSecond,
  framesPerSecond,
  nyquistHz,
  samplesPerFrame,
  telephonyPipeline,
  usableBandwidthHz,
  wastefulPipeline,
  webrtcPipeline,
  type PipelineStage,
} from '../models/audio'
import type { AudioEncoding, AudioFormat } from '../domain/types'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtBytes } from '../ui/primitives'
import { NumberInput, Segmented, Select } from '../ui/controls'
import { KNOWLEDGE_BY_ID } from '../knowledge/cards'

type Preset = 'telephony' | 'webrtc' | 'wasteful' | 'custom'

const RATES = [8000, 16000, 22050, 24000, 44100, 48000]

export default function AudioLab() {
  const [preset, setPreset] = useState<Preset>('telephony')
  const [stages, setStages] = useState<PipelineStage[]>(telephonyPipeline())
  const [callSeconds, setCallSeconds] = useState(240)
  const [inspectEncoding, setInspectEncoding] = useState<AudioEncoding>('mulaw')

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p === 'telephony') setStages(telephonyPipeline())
    if (p === 'webrtc') setStages(webrtcPipeline())
    if (p === 'wasteful') setStages(wastefulPipeline())
  }

  const analysis = useMemo(() => analysePipeline(stages), [stages])

  const updateStage = (idx: number, fmt: Partial<AudioFormat>) => {
    setPreset('custom')
    setStages((s) => s.map((st, i) => (i === idx ? { ...st, format: { ...st.format, ...fmt } } : st)))
  }

  const addStage = () => {
    setPreset('custom')
    setStages((s) => [
      ...s.slice(0, -1),
      { id: `custom-${Date.now()}`, label: `Stage ${s.length}`, role: 'Custom hop', format: { ...s[s.length - 2].format } },
      s[s.length - 1],
    ])
  }

  const removeStage = (idx: number) => {
    setPreset('custom')
    setStages((s) => s.filter((_, i) => i !== idx))
  }

  const enc = ENCODINGS[inspectEncoding]
  const inspectFmt: AudioFormat = { encoding: inspectEncoding, sampleRate: inspectEncoding === 'mulaw' || inspectEncoding === 'alaw' ? 8000 : 16000, channels: 1, bitDepth: enc.bitsPerSample as 8 | 16 | undefined, frameMs: 20 }

  return (
    <div className="p-4">
      <PageHeader
        title="Audio formats"
        steps={[
          "Start on “Clean phone pipeline”. That is what a carrier actually hands you.",
          "Switch to “Deliberately bad” and read the warnings — each one is a real mistake people ship.",
          "Go back to the clean pipeline and change one stage's sample rate to see a conversion appear from nothing.",
        ]}
        subtitle="Build a pipeline hop by hop; every conversion's latency, CPU and quality cost is computed."
        right={<Assumption>Conversion costs are educational estimates</Assumption>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          value={preset}
          onChange={applyPreset}
          ariaLabel="Pipeline preset"
          options={[
            { value: 'telephony', label: '☎ Clean phone pipeline', title: 'PSTN mu-law → PCM → STT/TTS → mu-law' },
            { value: 'webrtc', label: '🌐 Browser / WebRTC', title: '48 kHz Opus in, Opus out' },
            { value: 'wasteful', label: '⚠ Deliberately bad', title: '8k → 16k → 22.05k → MP3 → PCM → 8k' },
            { value: 'custom', label: '✎ Custom', title: 'Edit any stage' },
          ]}
        />
        <div className="ml-auto">
          <Badge tone={analysis.verdict === 'clean' ? 'good' : analysis.verdict === 'acceptable' ? 'warn' : 'bad'}>
            verdict: {analysis.verdict}
          </Badge>
        </div>
      </div>

      {/* Pipeline visualization */}
      <Panel title="Pipeline — every transformation shown" className="mb-4" pad={false}>
        <div className="overflow-x-auto p-4">
          <div className="flex items-stretch gap-0">
            {stages.map((stage, i) => (
              <div key={stage.id} className="flex items-stretch">
                <div className="w-44 shrink-0 rounded-md border border-ink-700 bg-ink-850 p-2.5">
                  <div className="flex items-start justify-between">
                    <div className="text-xs font-semibold text-ink-100">{stage.label}</div>
                    {stages.length > 3 && i > 0 && i < stages.length - 1 && (
                      <button className="text-2xs text-ink-600 hover:text-bad" onClick={() => removeStage(i)} title="Remove stage">✕</button>
                    )}
                  </div>
                  <div className="mb-2 text-2xs text-ink-500">{stage.role}</div>
                  <Select
                    value={stage.format.encoding}
                    onChange={(v) => updateStage(i, { encoding: v as AudioEncoding })}
                    options={Object.values(ENCODINGS).map((e) => ({ value: e.id, label: e.name }))}
                  />
                  <div className="mt-1.5">
                    <Select
                      value={String(stage.format.sampleRate)}
                      onChange={(v) => updateStage(i, { sampleRate: Number(v) })}
                      options={RATES.map((r) => ({ value: String(r), label: `${r / 1000} kHz` }))}
                    />
                  </div>
                  <div className="mt-2 space-y-0.5 font-mono text-2xs text-ink-400">
                    <div>{(bitrateBps(stage.format) / 1000).toFixed(0)} kbit/s</div>
                    <div>{fmtBytes(bytesPerFrame(stage.format))}/frame · {framesPerSecond(stage.format)} fps</div>
                    <div>{samplesPerFrame(stage.format)} samples/frame</div>
                    <div>usable ≤ {(usableBandwidthHz(stage.format) / 1000).toFixed(1)} kHz</div>
                  </div>
                </div>
                {i < stages.length - 1 && (
                  <ConversionArrow analysisIdx={i} analysis={analysis} />
                )}
              </div>
            ))}
            <button className="btn ml-2 self-center" onClick={addStage} title="Insert a stage before the last hop">＋ stage</button>
          </div>
        </div>
      </Panel>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Added latency (conversions)" value={analysis.totalLatencyMs} unit="ms" tone={analysis.totalLatencyMs > 60 ? 'bad' : analysis.totalLatencyMs > 30 ? 'warn' : 'good'}
          hint="Codec algorithmic delay + resampler filters + frame buffering, summed over every hop." />
        <Stat label="CPU / audio-second" value={analysis.totalCpuPerAudioSecond} tone={analysis.totalCpuPerAudioSecond > 0.01 ? 'warn' : 'default'}
          hint="Relative conversion cost per second of audio — multiply by concurrent calls for the media-tier CPU bill." />
        <Stat label="End-to-end quality" value={`${(analysis.endToEndQuality * 100).toFixed(1)}%`} tone={analysis.endToEndQuality < 0.8 ? 'bad' : analysis.endToEndQuality < 0.95 ? 'warn' : 'good'}
          hint="Relative to the original capture; every lossy hop compounds." />
        <Stat label="Effective bandwidth" value={(analysis.effectiveBandwidthHz / 1000).toFixed(1)} unit="kHz"
          hint="The narrowest point in the chain caps everything downstream — audio 'quality' can never exceed this." />
        <Stat label="Lossy hops" value={analysis.lossyHops} tone={analysis.lossyHops > 2 ? 'warn' : 'default'} />
      </div>

      <Callout tone={analysis.verdict === 'clean' ? 'good' : analysis.verdict === 'acceptable' ? 'warn' : 'bad'} title={`Verdict: ${analysis.verdict}`}>
        {analysis.verdictReason}
      </Callout>

      {analysis.warnings.length > 0 && (
        <Panel title="What the analyser noticed" className="mt-4">
          <ul className="space-y-1.5 text-sm text-ink-300">
            {analysis.warnings.map((w, i) => (
              <li key={i} className="flex gap-2"><span className="text-warn">⚠</span>{w}</li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Data volume calculator */}
        <Panel title="Data & bandwidth for one call">
          <div className="mb-3 max-w-[200px]">
            <NumberInput label="Call duration" value={callSeconds} min={10} max={3600} step={10} unit="s" onChange={setCallSeconds} />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                <th className="py-1.5">Stage</th>
                <th>Rate</th>
                <th>Frames</th>
                <th>Total data</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.id} className="border-b border-ink-850">
                  <td className="py-1.5 text-ink-300">{s.label}</td>
                  <td className="font-mono text-ink-400">{fmtBytes(bytesPerSecond(s.format))}/s</td>
                  <td className="font-mono text-ink-400">{(framesPerSecond(s.format) * callSeconds).toLocaleString()}</td>
                  <td className="font-mono text-ink-200">{fmtBytes(bytesForSeconds(s.format, callSeconds))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-500">
            Multiply by concurrent calls for the media tier's bandwidth bill: 1,000 concurrent calls of {fmtBytes(bytesPerSecond(stages[0].format))}/s each ≈ {fmtBytes(bytesPerSecond(stages[0].format) * 1000)}/s sustained, each direction.
          </p>
        </Panel>

        {/* Encoding inspector */}
        <Panel title="Codec inspector">
          <div className="mb-3 max-w-[280px]">
            <Select value={inspectEncoding} onChange={(v) => setInspectEncoding(v as AudioEncoding)}
              options={Object.values(ENCODINGS).map((e) => ({ value: e.id, label: e.name }))} />
          </div>
          <div className="space-y-2 text-sm text-ink-300">
            <p>{enc.description}</p>
            <p><span className="font-medium text-ink-200">Why choose it: </span>{enc.whyChoose}</p>
            <p><span className="font-medium text-ink-200">What it costs: </span>{enc.cost}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge tone={enc.lossy ? 'warn' : 'good'}>{enc.lossy ? 'lossy' : 'lossless'}</Badge>
              <Badge>{enc.algorithmicDelayMs} ms codec delay</Badge>
              <Badge>{(bitrateBps(inspectFmt) / 1000).toFixed(0)} kbit/s @ {inspectFmt.sampleRate / 1000} kHz</Badge>
              <Badge>Nyquist {nyquistHz(inspectFmt.sampleRate) / 1000} kHz</Badge>
            </div>
            <p className="pt-1 text-xs text-ink-500">Typical use: {enc.typicalUse}</p>
          </div>
        </Panel>
      </div>

      <Panel title="Concepts behind this lab" className="mt-4">
        <div className="flex flex-wrap gap-1.5">
          {['pcm', 'codecs', 'opus', 'sample-rate', 'resampling'].map((id) => (
            <Badge key={id} tone="accent" title={KNOWLEDGE_BY_ID[id]?.whatIsIt}>{KNOWLEDGE_BY_ID[id]?.term}</Badge>
          ))}
          <span className="text-xs text-ink-500">— full cards in the Knowledge Base</span>
        </div>
      </Panel>
    </div>
  )
}

function ConversionArrow({ analysisIdx, analysis }: { analysisIdx: number; analysis: ReturnType<typeof analysePipeline> }) {
  const conv = analysis.conversions[analysisIdx]
  if (!conv) return <span className="self-center px-1 text-ink-600">→</span>
  const none = conv.kinds.includes('none')
  return (
    <div className="flex w-28 shrink-0 flex-col items-center justify-center px-1 text-center" title={conv.explanation + (conv.warnings.length ? '\n\n' + conv.warnings.join('\n') : '')}>
      <span className={`text-lg ${none ? 'text-good' : conv.lossy ? 'text-warn' : 'text-accent'}`}>→</span>
      <span className={`text-2xs ${none ? 'text-good' : 'text-ink-400'}`}>
        {none ? 'pass-through' : conv.kinds.join(' + ')}
      </span>
      {!none && (
        <span className="font-mono text-2xs text-ink-500">
          +{conv.latencyMs} ms{conv.lossy ? ' · lossy' : ''}
        </span>
      )}
    </div>
  )
}
