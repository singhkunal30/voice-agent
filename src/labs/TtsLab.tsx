import { useMemo, useState } from 'react'
import { TTS_PROVIDERS, getTts } from '../providers/simulated'
import { Rng } from '../engine/rng'
import { FORMATS } from '../models/audio'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtBytes, fmtMs } from '../ui/primitives'
import { Select, Toggle } from '../ui/controls'

const SAMPLE_TEXT =
  'Thanks for waiting. For a one crore term policy, the monthly premium comes to around two thousand one hundred rupees. Shall I email you the full quote with the rider options?'

export default function TtsLab() {
  const [providerId, setProviderId] = useState('tts-premium-stream')
  const [text, setText] = useState(SAMPLE_TEXT)
  const [streaming, setStreaming] = useState(true)

  const provider = getTts(providerId)
  const result = useMemo(
    () => provider.synthesize({ text, language: 'en-IN', format: FORMATS.pcm24k, streaming }, new Rng(`tts-${providerId}-${streaming}`)),
    [provider, text, streaming, providerId],
  )

  const comparison = useMemo(
    () =>
      TTS_PROVIDERS.map((p) => {
        const stream = p.synthesize({ text, language: 'en-IN', format: FORMATS.pcm24k, streaming: true }, new Rng(`c-${p.id}-s`))
        const batch = p.synthesize({ text, language: 'en-IN', format: FORMATS.pcm24k, streaming: false }, new Rng(`c-${p.id}-b`))
        return { p, stream, batch }
      }),
    [text],
  )

  const totalMs = Math.max(result.totalGenerationMs, result.audioSeconds * 1000) * 1.05
  const W = 860

  return (
    <div className="p-4">
      <PageHeader
        title="Text to speech"
        steps={[
          "Note the time to first audio, then switch off “Streaming synthesis” and note it again.",
          "Read the chunk timeline: generation runs ahead of playback, so only the first chunk is ever on the critical path.",
          "Compare the providers — the best-sounding voice is rarely the fastest to start talking.",
        ]}
        subtitle="Only one number really matters here: time to first audio."
        right={<Assumption>Provider profiles are example assumptions</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <div className="space-y-3">
          <Panel title="Input">
            <div className="space-y-3">
              <div>
                <label className="label">Agent reply to synthesize</label>
                <textarea className="input min-h-[90px]" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="mt-1 text-2xs text-ink-500">{text.length} characters → ≈ {result.audioSeconds}s of audio at 150 wpm</div>
              </div>
              <Select label="Provider (simulated)" value={providerId} onChange={setProviderId}
                options={TTS_PROVIDERS.map((p) => ({ value: p.id, label: `${p.name} (${p.quality})` }))} />
              <Toggle label="Streaming synthesis" checked={streaming} onChange={setStreaming}
                help="Off = 'generate entire response, then speak'. Watch what happens to first audio." />
            </div>
          </Panel>

          <Panel title={provider.name}>
            <p className="mb-2 text-xs text-ink-400">{provider.profileOf}</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge tone={provider.streaming ? 'good' : 'warn'}>{provider.streaming ? 'streaming-capable' : 'file API only'}</Badge>
              <Badge>{provider.quality} quality</Badge>
              <Badge>{provider.realtimeFactor}× real time</Badge>
              <Badge>
                {provider.cost.unit === 'per-1k-chars' ? `$${provider.cost.usdPerUnit}/1k chars` : `$${provider.cost.usdPerUnit}/instance-h`}
              </Badge>
            </div>
            <div className="text-xs text-ink-400">
              <div>Voice: {provider.voice.style} · pitch {provider.voice.pitch} · expressiveness {provider.voice.expressiveness}</div>
            </div>
            <ul className="ml-4 mt-2 list-disc space-y-1 text-xs text-ink-400">
              {provider.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Time to first audio" value={fmtMs(result.firstAudioMs)}
              tone={result.firstAudioMs < 300 ? 'good' : result.firstAudioMs < 800 ? 'warn' : 'bad'}
              hint="The caller's silence ends here. The single most important TTS number for voice agents." />
            <Stat label="Total generation" value={fmtMs(result.totalGenerationMs)} hint="When the last chunk exists." />
            <Stat label="Audio produced" value={result.audioSeconds} unit="s" />
            <Stat label="Characters billed" value={result.charactersBilled} hint="What the cost model meters." />
          </div>

          <Panel title="Chunk timeline — generation vs playback">
            <svg viewBox={`0 0 ${W} 120`} className="w-full" role="img" aria-label="TTS chunk timeline">
              {/* generation row */}
              <text x={0} y={18} fill="rgb(var(--ink-400))" fontSize={10}>generated</text>
              {result.chunks.map((c) => (
                <rect key={c.index} x={(c.atMs / totalMs) * W} y={26} width={Math.max(3, ((c.audioSeconds * 1000) / provider.realtimeFactor / totalMs) * W)} height={16}
                  rx={2} fill="rgb(var(--good))" opacity={0.85}>
                  <title>chunk {c.index + 1}: ready at {fmtMs(c.atMs)} · {c.audioSeconds}s audio · {fmtBytes(c.bytes)}</title>
                </rect>
              ))}
              {/* playback row: starts at firstAudioMs, plays at 1x */}
              <text x={0} y={70} fill="rgb(var(--ink-400))" fontSize={10}>caller hears</text>
              <rect x={(result.firstAudioMs / totalMs) * W} y={78} width={((result.audioSeconds * 1000) / totalMs) * W} height={16} rx={2} fill="rgb(var(--accent))" opacity={0.85}>
                <title>playback: {result.audioSeconds}s at exactly 1× real time</title>
              </rect>
              <line x1={(result.firstAudioMs / totalMs) * W} y1={20} x2={(result.firstAudioMs / totalMs) * W} y2={100} stroke="rgb(var(--warn))" strokeDasharray="4 3" />
              <text x={(result.firstAudioMs / totalMs) * W + 4} y={112} fill="rgb(var(--warn))" fontSize={9}>first audio {fmtMs(result.firstAudioMs)}</text>
            </svg>
            <p className="mt-2 text-xs text-ink-500">
              {streaming && provider.streaming
                ? `Generation runs at ${provider.realtimeFactor}× real time, so chunks pile up ahead of playback — the buffer absorbs generation jitter. The caller's wait was only the first chunk.`
                : `Non-streaming: the whole ${result.audioSeconds}s utterance must exist before the first millisecond plays. The caller waited ${fmtMs(result.firstAudioMs)} in silence for it.`}
            </p>
          </Panel>

          <Panel title={'“Generate entire response → speak” vs “stream sentence by sentence”'} right={<Assumption />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                  <th className="py-1.5">Provider</th>
                  <th>Quality</th>
                  <th>First audio (streaming)</th>
                  <th>First audio (batch)</th>
                  <th>Streaming saves</th>
                  <th>Cost for this reply</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ p, stream, batch }) => (
                  <tr key={p.id} className={`border-b border-ink-850 ${p.id === providerId ? 'bg-ink-850' : ''}`}>
                    <td className="py-1.5 text-ink-200">{p.name}</td>
                    <td><Badge>{p.quality}</Badge></td>
                    <td className="font-mono text-good">{p.streaming ? fmtMs(stream.firstAudioMs) : '—'}</td>
                    <td className="font-mono text-warn">{fmtMs(batch.firstAudioMs)}</td>
                    <td className="font-mono text-accent">{p.streaming ? fmtMs(batch.firstAudioMs - stream.firstAudioMs) : 'n/a'}</td>
                    <td className="font-mono text-ink-300">
                      {p.cost.unit === 'per-1k-chars' ? `$${((text.length / 1000) * p.cost.usdPerUnit).toFixed(4)}` : 'compute-h'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Callout tone="info" title="Why this compounds with streaming LLMs">
            A streaming pipeline sends the LLM's <em>first sentence</em> to TTS while the rest is still generating. Batch-TTS thinking cannot use that: it needs the whole reply anyway. The two streaming decisions multiply — which is why the Latency Lab shows seconds, not milliseconds, between architectures A and B.
          </Callout>
        </div>
      </div>
    </div>
  )
}
