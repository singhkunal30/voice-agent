import type { Playback } from './playback'
import { SPEEDS } from './playback'
import { fmtMs } from './primitives'

export function SimControls({ playback, onRerun }: { playback: Playback; onRerun?: () => void }) {
  const p = playback
  return (
    <div className="flex flex-wrap items-center gap-2">
      {p.state === 'playing' ? (
        <button className="btn btn-primary" onClick={p.pause} title="Pause playback">
          ⏸ Pause
        </button>
      ) : (
        <button className="btn btn-primary" onClick={p.start} title="Play the simulated timeline">
          ▶ {p.state === 'paused' ? 'Resume' : 'Start'}
        </button>
      )}
      <button className="btn" onClick={p.step} title="Advance to the next event">
        ⏭ Step
      </button>
      <button className="btn" onClick={p.finish} title="Jump to the end of the run">
        ⇥ End
      </button>
      <button
        className="btn"
        onClick={() => {
          p.reset()
          onRerun?.()
        }}
        title={onRerun ? 'Reset and re-run the simulation' : 'Reset playback'}
      >
        ↻ Reset
      </button>
      <div className="ml-1 flex items-center gap-1 text-2xs text-ink-500">
        <span>Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => p.setSpeed(s)}
            className={`rounded px-1.5 py-0.5 font-mono ${
              p.speed === s ? 'bg-accent-deep/60 text-accent' : 'text-ink-400 hover:bg-ink-800'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="ml-auto font-mono text-xs text-ink-400">
        t = {fmtMs(p.now)} / {fmtMs(p.durationMs)}
      </div>
    </div>
  )
}
