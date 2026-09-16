import { useMemo, useState } from 'react'
import { STT_PROVIDERS, getStt } from '../providers/simulated'
import { Rng } from '../engine/rng'
import { FORMATS } from '../models/audio'
import { Assumption, Badge, Callout, PageHeader, Panel, Stat, fmtMs } from '../ui/primitives'
import { NumberInput, Select, Slider, Toggle } from '../ui/controls'

export default function SttLab() {
  const [providerId, setProviderId] = useState('stt-stream-fast')
  const [utterance, setUtterance] = useState('I want to renew my policy and claim the no claim bonus for order one zero zero one')
  const [noise, setNoise] = useState(0.1)
  const [narrowband, setNarrowband] = useState(true)
  const [language, setLanguage] = useState('en-IN')
  const [accent, setAccent] = useState(0.3)
  const [seed, setSeed] = useState(1)

  const provider = getStt(providerId)
  const audioSeconds = Math.max(1, (utterance.split(/\s+/).length / 150) * 60)

  const result = useMemo(
    () =>
      provider.transcribe(
        {
          utterance,
          audioSeconds,
          format: narrowband ? FORMATS.pcm8k : FORMATS.pcm16k,
          noiseLevel: noise,
          language,
          accentStrength: accent,
          narrowband,
        },
        new Rng(`stt-${seed}-${providerId}`),
      ),
    [provider, utterance, audioSeconds, noise, language, accent, narrowband, seed, providerId],
  )

  const comparison = useMemo(
    () =>
      STT_PROVIDERS.map((p) => {
        const r = p.transcribe(
          { utterance, audioSeconds, format: narrowband ? FORMATS.pcm8k : FORMATS.pcm16k, noiseLevel: noise, language, accentStrength: accent, narrowband },
          new Rng(`stt-${seed}-${p.id}`),
        )
        return { p, r }
      }),
    [utterance, audioSeconds, noise, language, accent, narrowband, seed],
  )

  return (
    <div className="p-4">
      <PageHeader
        title="Speech to text"
        steps={[
          "Watch the partials revise themselves as they firm up — streaming hypotheses are unstable by design.",
          "Switch the provider to a batch engine. The first partial disappears entirely, and the wait moves after the speech.",
          "Raise the noise and accent sliders, then check which words break first: numbers and names, every time.",
        ]}
        subtitle="Streaming partials arrive while the user is still talking. That overlap is what streaming buys you."
        right={<Assumption>Provider profiles are example assumptions</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <div className="space-y-3">
          <Panel title="Input">
            <div className="space-y-3">
              <div>
                <label className="label">Ground truth (what the user says)</label>
                <textarea className="input min-h-[70px]" value={utterance} onChange={(e) => setUtterance(e.target.value)} />
                <div className="mt-1 text-2xs text-ink-500">≈ {audioSeconds.toFixed(1)} s of speech at 150 wpm</div>
              </div>
              <Select label="Provider (simulated)" value={providerId} onChange={setProviderId}
                options={STT_PROVIDERS.map((p) => ({ value: p.id, label: `${p.name} ${p.streaming ? '(streaming)' : '(batch)'}` }))} />
              <Select label="Language" value={language} onChange={setLanguage}
                options={[
                  { value: 'en-US', label: 'English (US)' },
                  { value: 'en-IN', label: 'English (India)' },
                  { value: 'hi-IN', label: 'Hindi' },
                  { value: 'ta-IN', label: 'Tamil' },
                  { value: 'sw-KE', label: 'Swahili (outside most engines)' },
                ]} />
              <Slider label="Background noise" value={noise} onChange={setNoise} min={0} max={0.8} step={0.05}
                format={(v) => (v < 0.15 ? 'studio' : v < 0.4 ? 'office' : v < 0.6 ? 'street' : 'roadside')} />
              <Slider label="Accent strength" value={accent} onChange={setAccent} min={0} max={1} step={0.1} />
              <Toggle label="8 kHz narrowband (phone line)" checked={narrowband} onChange={setNarrowband}
                help="Telephony audio is band-limited to ~3.4 kHz. Toggle to compare with 16 kHz wideband (browser) input." />
              <NumberInput label="Seed" value={seed} min={1} max={999} onChange={setSeed} help="Deterministic: same seed = same errors." />
            </div>
          </Panel>

          <Panel title={provider.name}>
            <p className="mb-2 text-xs text-ink-400">{provider.profileOf}</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <Badge tone={provider.streaming ? 'good' : 'warn'}>{provider.streaming ? 'streaming' : 'batch'}</Badge>
              <Badge>{provider.deployment}</Badge>
              <Badge>{provider.compute}</Badge>
              <Badge>{provider.cost.unit === 'per-minute' ? `$${provider.cost.usdPerUnit}/min` : `$${provider.cost.usdPerUnit}/instance-h`}</Badge>
            </div>
            <ul className="ml-4 list-disc space-y-1 text-xs text-ink-400">
              {provider.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="First partial" value={result.firstPartialMs === Infinity ? '—' : fmtMs(result.firstPartialMs)}
              tone={result.firstPartialMs === Infinity ? 'warn' : 'good'}
              hint={result.firstPartialMs === Infinity ? 'Batch engine: nothing until the utterance ends.' : 'From start of speech — the agent can begin reasoning here.'} />
            <Stat label="Final after speech end" value={fmtMs(result.finalizeMs)} tone={result.finalizeMs > 500 ? 'warn' : 'default'}
              hint="This lands directly in the perceived-latency budget." />
            <Stat label="Simulated WER" value={`${(result.wer * 100).toFixed(1)}%`} tone={result.wer > 0.15 ? 'bad' : result.wer > 0.08 ? 'warn' : 'good'}
              hint="Word error rate on this utterance with these conditions." />
            <Stat label="Billed" value={result.audioSecondsBilled.toFixed(1)} unit="s" hint="What the cost model meters." />
          </div>

          <Panel title="Transcription timeline — partials, then final">
            <div className="max-h-80 space-y-1 overflow-y-auto font-mono text-xs">
              {result.partials.map((p, i) => (
                <div key={i} className={`flex gap-3 rounded px-2 py-1 ${p.isFinal ? 'bg-accent-deep/20' : ''}`}>
                  <span className="w-16 shrink-0 text-right text-ink-500">{(p.atMs / 1000).toFixed(2)}s</span>
                  <span className={`w-14 shrink-0 ${p.isFinal ? 'text-accent' : 'text-ink-500'}`}>{p.isFinal ? 'FINAL' : 'partial'}</span>
                  <span className={p.isFinal ? 'text-ink-100' : 'text-ink-300'}>
                    “{p.text}”{p.revised && <span className="ml-1 text-warn" title="This partial revised earlier words — streaming hypotheses are unstable by design.">↺ revised</span>}
                  </span>
                  <span className="ml-auto shrink-0 text-ink-600">conf {p.confidence}</span>
                </div>
              ))}
            </div>
            {result.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-ink-500">
                {result.notes.map((n, i) => <li key={i}>· {n}</li>)}
              </ul>
            )}
            {result.wer > 0.12 && (
              <Callout tone="warn" title="This transcript would mislead the agent">
                Compare against the ground truth above: numbers and named entities are the first casualties. This is why production agents confirm critical entities aloud (“that's order O-R-D one zero zero one, correct?”) instead of trusting the transcript.
              </Callout>
            )}
          </Panel>

          <Panel title="All providers on this exact audio" right={<Assumption />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-2xs uppercase tracking-wide text-ink-500">
                  <th className="py-1.5">Provider</th>
                  <th>Mode</th>
                  <th>First partial</th>
                  <th>Final (after speech)</th>
                  <th>WER</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ p, r }) => (
                  <tr key={p.id} className={`border-b border-ink-850 ${p.id === providerId ? 'bg-ink-850' : ''}`}>
                    <td className="py-1.5 text-ink-200">{p.name}</td>
                    <td>{p.streaming ? <Badge tone="good">stream</Badge> : <Badge tone="warn">batch</Badge>}</td>
                    <td className="font-mono text-ink-300">{r.firstPartialMs === Infinity ? '—' : fmtMs(r.firstPartialMs)}</td>
                    <td className="font-mono text-ink-300">{fmtMs(r.finalizeMs)}</td>
                    <td className={`font-mono ${r.wer > 0.15 ? 'text-bad' : r.wer > 0.08 ? 'text-warn' : 'text-good'}`}>{(r.wer * 100).toFixed(1)}%</td>
                    <td className="max-w-[280px] truncate font-mono text-2xs text-ink-500" title={r.finalText}>“{r.finalText}”</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-500">
              Notice the structural difference, not the absolute numbers: batch engines pay their entire processing time <em>after</em> the user stops; streaming engines paid it during the speech. Narrowband and noise hurt every engine — the transport you chose upstream set this ceiling.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
