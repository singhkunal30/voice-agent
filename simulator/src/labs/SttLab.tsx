import { useEffect, useMemo, useRef, useState } from 'react'
import { STT_PROVIDERS, getStt } from '../providers/simulated'
import { Rng } from '../engine/rng'
import { FORMATS } from '../models/audio'
import { Assumption, Badge, Callout, NumberChip, PageHeader, Panel, SectionLabel, Stat, Takeaway, fmtMs } from '../ui/primitives'
import { NumberInput, Select, Slider, Toggle } from '../ui/controls'
import { useAppStore } from '../state/store'
import {
  CODE_SWITCH_EXAMPLES,
  DEFAULT_RECOGNITION,
  LANGUAGES,
  recognitionQuality,
  type RecognitionInputs,
} from '../models/language'

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

      <MultilingualSection />
    </div>
  )
}

/**
 * Multilingual and code-switching.
 *
 * Almost every voice tutorial is monolingual English on clean audio, and almost
 * no real deployment is either. Hinglish is the worked example because it is
 * the honest hard case: one sentence, one intent, two languages, two scripts,
 * and a per-call language setting that is wrong in both directions at once.
 */
function MultilingualSection() {
  const markProgress = useAppStore((s) => s.markProgress)
  const [cfg, setCfg] = useState<RecognitionInputs>({ ...DEFAULT_RECOGNITION })
  const set = <K extends keyof RecognitionInputs>(k: K, v: RecognitionInputs[K]) =>
    setCfg((prev) => ({ ...prev, [k]: v }))
  const [exampleId, setExampleId] = useState(CODE_SWITCH_EXAMPLES[0].id)
  const quality = useMemo(() => recognitionQuality(cfg), [cfg])
  const example = CODE_SWITCH_EXAMPLES.find((e) => e.id === exampleId) ?? CODE_SWITCH_EXAMPLES[0]

  // The lesson is the *difference* between handling code-switching and not, so
  // require having seen both — arriving and reading one number proves nothing.
  const seenHandling = useRef(new Set<string>())
  useEffect(() => {
    seenHandling.current.add(cfg.codeSwitchAware ? 'aware' : cfg.perUtteranceRouting ? 'routed' : 'naive')
    if (seenHandling.current.size >= 2) markProgress('compared-recognition')
  }, [cfg.codeSwitchAware, cfg.perUtteranceRouting, markProgress])

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-3 border-t border-ink-800 pt-5">
        <h2 className="text-lg font-semibold text-ink-100">Two languages, one sentence</h2>
        <p className="min-w-0 flex-1 text-sm text-ink-400">
          A caller who says <span className="text-ink-200">&ldquo;मेरा order कहाँ है&rdquo;</span> is speaking one
          sentence. Code-switching is not two languages — it is a third problem, and a per-call language setting gets it
          wrong in both directions at once.
        </p>
        <NumberChip kind="ASSUMPTION" source="Error rates vary by vendor, model version, speaker and topic. The compounding is the lesson, not the constants." />
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <div className="space-y-3">
          <Panel title="Who is calling, and how">
            <div className="space-y-3">
              <Select
                label="Language variety"
                value={cfg.languageId}
                onChange={(v) => set('languageId', v)}
                options={LANGUAGES.map((l) => ({ value: l.id, label: `${l.name} · ${l.nativeName}` }))}
              />
              <Select
                label="Channel"
                value={cfg.channel}
                onChange={(v) => set('channel', v as 'phone' | 'browser')}
                options={[
                  { value: 'phone', label: 'Phone — 8 kHz' },
                  { value: 'browser', label: 'Browser — 16 kHz+' },
                ]}
                help="Everything above 4 kHz is gone on a phone call. That is the Nyquist limit of an 8 kHz sample rate, not a vendor limitation."
              />
              <Slider
                label="Background noise"
                value={cfg.noiseLevel}
                onChange={(v) => set('noiseLevel', v)}
                min={0}
                max={0.8}
                step={0.05}
                format={(v) => (v < 0.2 ? 'quiet room' : v < 0.45 ? 'office' : v < 0.65 ? 'street' : 'roadside')}
              />
              <Slider
                label="Share of utterances that mix languages"
                value={cfg.codeSwitchRate}
                onChange={(v) => set('codeSwitchRate', v)}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                help="In many Indian markets this is the majority of utterances, not an edge case."
              />
              <SectionLabel>How the pipeline handles it</SectionLabel>
              <Toggle
                label="Recogniser trained on the mixed variety"
                checked={cfg.codeSwitchAware}
                onChange={(v) => set('codeSwitchAware', v)}
                help="The only approach that treats an English word inside a Hindi sentence as an ordinary word."
              />
              <Toggle
                label="Per-utterance language routing"
                checked={cfg.perUtteranceRouting}
                onChange={(v) => set('perUtteranceRouting', v)}
                help="Picks one language per turn. Helps when the caller alternates between sentences; fails when they switch inside one."
              />
              <Toggle
                label="Custom vocabulary supplied"
                checked={cfg.customVocabulary}
                onChange={(v) => set('customVocabulary', v)}
                help="Biasing toward your product names, cities and plan tiers. The cheapest accuracy win available."
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat
              label="Effective error rate"
              value={`${(quality.wer * 100).toFixed(1)}%`}
              tone={quality.wer < 0.1 ? 'good' : quality.wer < 0.2 ? 'warn' : 'bad'}
              hint="Across the whole call, blending monolingual and mixed utterances by the rate you set."
            />
            <Stat label="On monolingual turns" value={`${(quality.monolingualWer * 100).toFixed(1)}%`} />
            <Stat
              label="On code-switched turns"
              value={`${(quality.codeSwitchedWer * 100).toFixed(1)}%`}
              tone={quality.codeSwitchedWer > quality.monolingualWer * 1.5 ? 'bad' : 'warn'}
            />
          </div>

          <Panel title="Where the errors come from">
            <div className="space-y-2.5">
              {quality.contributions.map((c) => (
                <div key={c.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-ink-200">{c.label}</span>
                    <span className={`font-mono text-xs ${c.deltaWer < 0 ? 'text-good' : 'text-warn'}`}>
                      {c.deltaWer >= 0 ? '+' : ''}
                      {(c.deltaWer * 100).toFixed(1)} pts
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{c.note}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="The same sentence, three recognisers"
            right={
              <div className="flex gap-1">
                {CODE_SWITCH_EXAMPLES.map((e) => (
                  <button
                    key={e.id}
                    className={`chip ${exampleId === e.id ? 'tone-info' : 'tone-neutral'}`}
                    onClick={() => setExampleId(e.id)}
                  >
                    {e.id}
                  </button>
                ))}
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {example.spoken.map((t, i) => (
                <span
                  key={i}
                  className={`rounded px-1.5 py-0.5 text-base ${
                    t.lang === 'hi'
                      ? 'bg-control/15 text-control'
                      : t.lang === 'number'
                        ? 'bg-warn/15 text-warn'
                        : 'bg-accent/15 text-accent'
                  }`}
                  title={t.lang === 'hi' ? 'Hindi' : t.lang === 'number' ? 'a digit' : 'English'}
                >
                  {t.text}
                </span>
              ))}
              <span className="ml-2 text-sm text-ink-500">— &ldquo;{example.meaning}&rdquo;</span>
            </div>
            <dl className="space-y-1.5 text-sm">
              {[
                ['English-only model', example.heardAsEnglish],
                ['Hindi-only model', example.heardAsHindi],
                ['Code-switch-aware model', example.heardAware],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[11rem,1fr] gap-3">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="font-mono text-ink-200">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-l-2 border-warn/40 pl-3 text-sm leading-relaxed text-ink-300">
              {example.consequence}
            </p>
          </Panel>

          {quality.hazards.length > 0 && (
            <Callout tone="warn" title="What this configuration will get wrong in a way the caller notices">
              <ul className="ml-4 list-disc space-y-1 text-sm">
                {quality.hazards.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </Callout>
          )}

          <Takeaway title="The design consequence">
            A higher error rate is not only a speech problem. Every identifier the caller speaks — order numbers,
            phone numbers, dates — passes straight into a tool call, so recognition quality becomes{' '}
            <b>data integrity</b>. That is why the mitigation is a read-back confirmation in the prompt, not a better
            microphone.
          </Takeaway>
        </div>
      </div>
    </section>
  )
}
