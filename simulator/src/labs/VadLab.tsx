import { useEffect, useMemo, useState } from 'react'
import { BARGE_IN_SEQUENCE, generateEnergyTrack, runVad } from '../models/vad'
import { Assumption, Badge, Callout, PageHeader, Panel } from '../ui/primitives'
import { Slider } from '../ui/controls'
import { useAppStore } from '../state/store'

export default function VadLab() {
  const [threshold, setThreshold] = useState(0.5)
  const [minSpeech, setMinSpeech] = useState(120)
  const [silenceTimeout, setSilenceTimeout] = useState(600)
  const [noise, setNoise] = useState(0.15)
  const markProgress = useAppStore((s) => s.markProgress)

  const track = useMemo(() => generateEnergyTrack(noise), [noise])
  const outcome = useMemo(
    () => runVad(track, { speechThreshold: threshold, minSpeechMs: minSpeech, silenceTimeoutMs: silenceTimeout }),
    [track, threshold, minSpeech, silenceTimeout],
  )

  useEffect(() => {
    if (outcome.problems.some((p) => p.kind === 'premature')) markProgress('tuned-vad')
  }, [outcome, markProgress])

  const totalMs = track[track.length - 1]?.t ?? 1
  const W = 900
  const H = 140
  const x = (t: number) => (t / totalMs) * W
  const y = (p: number) => H - p * (H - 10) - 5

  const pathD = track.map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join(' ')

  return (
    <div className="p-4">
      <PageHeader
        title="Turn-taking"
        steps={[
          "Press “300 ms timeout” — watch the agent cut the speaker off mid-thought.",
          "Press “1100 ms timeout” — the pause survives, but every single reply now waits 1.1 s.",
          "Try “Sensitive + noisy” to watch the VAD hear speech that was never there.",
        ]}
        subtitle="The scripted audio has a cough, ten words, and a 900 ms thinking pause mid-sentence. Your settings decide what the agent believes happened."
        right={<Assumption>Synthetic audio track</Assumption>}
      />

      <div className="grid gap-4 xl:grid-cols-[300px,1fr]">
        <div className="space-y-3">
          <Panel title="VAD settings">
            <div className="space-y-4">
              <Slider label="Speech threshold" value={threshold} onChange={setThreshold} min={0.15} max={0.9} step={0.05}
                help="Probability needed to count a frame as speech. Too low: noise becomes speech. Too high: soft speech is missed." />
              <Slider label="Minimum speech duration" value={minSpeech} onChange={setMinSpeech} min={20} max={500} step={20} unit="ms"
                help="Bursts shorter than this are ignored. Gates out coughs — and, if too high, short words." />
              <Slider label="Silence timeout (endpointing)" value={silenceTimeout} onChange={setSilenceTimeout} min={150} max={1500} step={50} unit="ms"
                help="Silence needed to declare the turn over. Shorter = snappier agent that interrupts thinkers. Longer = polite agent that feels slow." />
              <Slider label="Background noise" value={noise} onChange={setNoise} min={0} max={0.8} step={0.05}
                format={(v) => (v < 0.2 ? 'quiet room' : v < 0.45 ? 'office' : v < 0.65 ? 'street' : 'roadside')} />
            </div>
          </Panel>

          <Panel title="Try these settings">
            <div className="space-y-2 text-xs">
              <button className="btn btn-sm w-full justify-start" onClick={() => { setSilenceTimeout(300); setMinSpeech(120); setThreshold(0.5) }}>
                ⏱ 300 ms timeout → interrupts the thinker
              </button>
              <button className="btn btn-sm w-full justify-start" onClick={() => { setSilenceTimeout(1100); setMinSpeech(120); setThreshold(0.5) }}>
                🐢 1100 ms timeout → survives the pause, feels slow
              </button>
              <button className="btn btn-sm w-full justify-start" onClick={() => { setMinSpeech(40); setThreshold(0.35); setNoise(0.3) }}>
                👻 Sensitive + noisy → phantom speech
              </button>
              <button className="btn btn-sm w-full justify-start" onClick={() => { setMinSpeech(420); setThreshold(0.6) }}>
                🔇 420 ms min-speech → short words vanish
              </button>
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Audio energy & what the VAD decided" pad={false}>
            <div className="overflow-x-auto p-3">
              <svg viewBox={`0 0 ${W} ${H + 58}`} className="min-w-[700px]" role="img" aria-label="VAD energy timeline">
                {/* threshold line */}
                <line x1={0} x2={W} y1={y(threshold)} y2={y(threshold)} stroke="rgb(var(--warn))" strokeDasharray="5 4" strokeWidth={1} />
                <text x={4} y={y(threshold) - 4} fill="rgb(var(--warn))" fontSize={9}>threshold {threshold}</text>
                {/* ground truth bands */}
                {track.map((pt, i) =>
                  pt.truth !== 'silence' ? (
                    <rect key={i} x={x(pt.t)} y={H + 8} width={(30 / totalMs) * W + 0.5} height={8}
                      fill={pt.truth === 'speech' ? 'rgb(var(--good))' : pt.truth === 'pause-within-thought' ? 'rgb(var(--control))' : 'rgb(var(--bad))'} />
                  ) : null,
                )}
                <text x={4} y={H + 30} fill="rgb(var(--ink-400))" fontSize={9}>ground truth:</text>
                <text x={70} y={H + 30} fill="rgb(var(--good))" fontSize={9}>■ speech</text>
                <text x={125} y={H + 30} fill="rgb(var(--control))" fontSize={9}>■ thinking pause (thought continues!)</text>
                <text x={300} y={H + 30} fill="rgb(var(--bad))" fontSize={9}>■ cough</text>
                {/* detected segments */}
                {outcome.segments.map((seg, i) => (
                  <rect key={i} x={x(seg.startMs)} y={H + 38} width={x(seg.endMs) - x(seg.startMs)} height={8}
                    fill={seg.kind === 'detected-speech' ? 'rgb(var(--accent))' : seg.kind === 'phantom' ? 'rgb(var(--bad))' : 'rgb(var(--warn))'} opacity={0.9}>
                    <title>{seg.kind}</title>
                  </rect>
                ))}
                <text x={4} y={H + 56} fill="rgb(var(--ink-400))" fontSize={9}>VAD verdict:</text>
                <text x={62} y={H + 56} fill="rgb(var(--accent))" fontSize={9}>■ speech detected</text>
                <text x={155} y={H + 56} fill="rgb(var(--bad))" fontSize={9}>■ phantom</text>
                <text x={215} y={H + 56} fill="rgb(var(--warn))" fontSize={9}>■ missed/gated</text>
                {/* turn commit markers — an endpointer can commit several times */}
                {outcome.turnCommits.map((c, i) => (
                  <g key={i}>
                    <line x1={x(c.atMs)} x2={x(c.atMs)} y1={0} y2={H + 46}
                      stroke={c.midThought || c.empty ? 'rgb(var(--bad))' : 'rgb(var(--series-pink))'} strokeWidth={1.5} />
                    <text x={x(c.atMs) + 3} y={12 + (i % 2) * 11} fill={c.midThought || c.empty ? 'rgb(var(--bad))' : 'rgb(var(--series-pink))'} fontSize={9}>
                      TURN_COMPLETE{c.midThought ? ' (mid-thought!)' : c.empty ? ' (empty!)' : ''}
                    </text>
                  </g>
                ))}
                {/* energy curve */}
                <path d={pathD} fill="none" stroke="rgb(var(--ink-300))" strokeWidth={1.2} />
              </svg>
            </div>
          </Panel>

          {outcome.problems.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {outcome.problems.map((p, i) => (
                <Callout key={i} tone={p.kind === 'slow' ? 'warn' : 'bad'} title={p.title}>
                  {p.detail}
                </Callout>
              ))}
            </div>
          ) : (
            <Callout tone="good" title="These settings handled the scripted audio cleanly">
              The cough was gated, all ten words were captured, and the turn committed after the real end of the thought. Now check what it cost: the turn could not commit earlier than {silenceTimeout} ms after the final word — that delay is baked into every response.
            </Callout>
          )}

          <Panel title="VAD event log">
            <div className="max-h-56 overflow-y-auto font-mono text-xs">
              {outcome.events.map((e, i) => (
                <div key={i} className="border-b border-ink-850 py-1">
                  <span className="text-ink-500">{(e.t / 1000).toFixed(2)}s</span>{' '}
                  <span className={e.type === 'TURN_COMPLETE' ? 'text-warn' : e.type === 'GATED' ? 'text-ink-400' : 'text-accent'}>{e.type}</span>{' '}
                  <span className="text-ink-300">{e.note}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Barge-in: the internal cascade" right={<Badge tone="media">media-plane reflex</Badge>}>
            <p className="mb-3 text-sm text-ink-400">
              Agent: <span className="italic text-ink-200">“Your premium is two thousand—”</span> · User: <span className="italic text-ink-200">“Wait!”</span> · Agent: <b className="text-ink-100">stops</b>. Here is everything that must happen inside ~400 ms for that to work:
            </p>
            <ol className="space-y-2">
              {BARGE_IN_SEQUENCE.map((s) => (
                <li key={s.type} className="flex gap-3 text-sm">
                  <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-500">+{s.t} ms</span>
                  <div>
                    <span className={`font-mono text-xs font-semibold ${s.type === 'CLEAR_AUDIO_BUFFER' ? 'text-warn' : 'text-accent'}`}>{s.type}</span>
                    <p className="text-xs text-ink-400">{s.note}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-ink-500">
              Run this live in the <a href="#/call" className="text-accent hover:underline">Live Call Simulator</a> with “User interrupts the agent” enabled — the same cascade appears in the full event timeline.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
