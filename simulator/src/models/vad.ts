/**
 * VAD / turn-detection demonstration model.
 *
 * Generates a deterministic "call audio" energy track — speech bursts, a
 * thinking pause mid-thought, background noise, a cough — then runs a VAD
 * (threshold + hysteresis + min-duration + silence-timeout) over it and
 * reports what the agent would have done, including the failure modes bad
 * settings produce.
 */

import { Rng } from '../engine/rng'

export interface VadSettings {
  /** Speech probability threshold, 0..1. */
  speechThreshold: number
  /** Sounds shorter than this are ignored (ms). */
  minSpeechMs: number
  /** Silence longer than this ends the turn (ms). */
  silenceTimeoutMs: number
}

export interface EnergyPoint {
  /** ms */
  t: number
  /** 0..1 — simulated speech probability from the VAD model. */
  p: number
  /** What is actually happening (ground truth). */
  truth: 'silence' | 'speech' | 'pause-within-thought' | 'noise-burst'
  word?: string
}

export interface VadSegment {
  startMs: number
  endMs: number
  kind: 'detected-speech' | 'missed' | 'phantom'
}

export interface TurnCommit {
  atMs: number
  /** True when the endpointer fired inside the user's thinking pause. */
  midThought: boolean
  /** True when the turn contains no real speech (e.g. triggered by a cough). */
  empty: boolean
}

export interface VadOutcome {
  segments: VadSegment[]
  events: { t: number; type: string; note: string }[]
  /** First commit, kept for convenience. */
  turnCommittedAt: number | null
  /** Every turn the endpointer committed — real systems commit repeatedly. */
  turnCommits: TurnCommit[]
  problems: { kind: string; title: string; detail: string }[]
}

const FRAME_MS = 30

/**
 * The scripted utterance: "I want to change my flight ... (thinking pause) ...
 * to Thursday" with a cough before and noise floor throughout. The pause is
 * the whole lesson: VAD sees silence; the thought is not finished.
 */
export function generateEnergyTrack(noiseLevel: number, seed = 'vad-demo'): EnergyPoint[] {
  const rng = new Rng(seed)
  const points: EnergyPoint[] = []
  const words1 = ['I', 'want', 'to', 'change', 'my', 'flight']
  const words2 = ['to', 'Thursday', 'morning', 'please']

  const push = (t: number, p: number, truth: EnergyPoint['truth'], word?: string) =>
    points.push({ t, p: Math.max(0, Math.min(1, p)), truth, word })

  let t = 0
  const noise = () => noiseLevel * 0.45 + rng.jitter(0.06)

  // 0–600 ms: silence + noise floor
  for (; t < 600; t += FRAME_MS) push(t, noise(), 'silence')
  // 600–780 ms: a cough (short high-energy burst — should be gated out)
  for (; t < 780; t += FRAME_MS) push(t, 0.75 + rng.jitter(0.1), 'noise-burst', 'cough')
  // 780–1200 ms: silence
  for (; t < 1200; t += FRAME_MS) push(t, noise(), 'silence')
  // Speech part 1 (~6 words, ~350 ms each)
  for (const w of words1) {
    const end = t + 340
    for (; t < end; t += FRAME_MS) push(t, 0.82 + rng.jitter(0.12), 'speech', w)
    // tiny inter-word dip
    for (const stop = t + 60; t < stop; t += FRAME_MS) push(t, 0.35 + rng.jitter(0.1), 'speech')
  }
  // Thinking pause: 900 ms of real silence in the MIDDLE of the thought
  for (const stop = t + 900; t < stop; t += FRAME_MS) push(t, noise(), 'pause-within-thought')
  // Speech part 2
  for (const w of words2) {
    const end = t + 340
    for (; t < end; t += FRAME_MS) push(t, 0.84 + rng.jitter(0.12), 'speech', w)
    for (const stop = t + 60; t < stop; t += FRAME_MS) push(t, 0.35 + rng.jitter(0.1), 'speech')
  }
  // Trailing silence
  for (const stop = t + 1500; t < stop; t += FRAME_MS) push(t, noise(), 'silence')

  return points
}

export function runVad(track: EnergyPoint[], s: VadSettings): VadOutcome {
  const events: VadOutcome['events'] = []
  const segments: VadSegment[] = []
  const problems: VadOutcome['problems'] = []

  let inSpeech = false
  let speechStart = 0
  let confirmed = false
  let silenceStart: number | null = null
  let speechEverConfirmed = false
  const turnCommits: TurnCommit[] = []
  /** Fires at most once per silence period; resets when speech resumes. */
  let committedThisSilence = false
  /** Did real (non-noise) speech occur since the last commit? */
  let realSpeechSinceCommit = false

  const endSegment = (endMs: number) => {
    if (!inSpeech) return
    const dur = endMs - speechStart
    if (confirmed) {
      segments.push({ startMs: speechStart, endMs, kind: 'detected-speech' })
    } else if (dur > 0) {
      segments.push({ startMs: speechStart, endMs, kind: 'missed' })
    }
    inSpeech = false
    confirmed = false
  }

  for (const pt of track) {
    const speechy = pt.p >= s.speechThreshold
    if (speechy) {
      silenceStart = null
      committedThisSilence = false
      if (!inSpeech) {
        inSpeech = true
        speechStart = pt.t
        confirmed = false
      }
      if (!confirmed && pt.t - speechStart >= s.minSpeechMs) {
        confirmed = true
        speechEverConfirmed = true
        if (pt.truth !== 'noise-burst') realSpeechSinceCommit = true
        events.push({
          t: pt.t,
          type: 'SPEECH_STARTED',
          note: `Sustained ${s.minSpeechMs} ms past threshold ${s.speechThreshold} — speech confirmed${pt.truth === 'noise-burst' ? ' (but ground truth says this is a cough: phantom!)' : ''}`,
        })
        if (pt.truth === 'noise-burst') {
          segments.push({ startMs: speechStart, endMs: pt.t + 200, kind: 'phantom' })
          problems.push({
            kind: 'phantom',
            title: 'Phantom speech: a cough passed the gate',
            detail: `min-speech ${s.minSpeechMs} ms is shorter than the cough. During agent playback this phantom would cancel TTS for nothing. Raise min-speech or the threshold.`,
          })
        }
        const lastCommit = turnCommits[turnCommits.length - 1]
        if (lastCommit) {
          events.push({
            t: pt.t,
            type: 'NEW_USER_TURN',
            note: lastCommit.midThought
              ? 'Speech resumes after a committed turn — but the user was continuing the same thought. The agent is now answering half a sentence while the other half arrives.'
              : 'Speech after a committed turn — a genuine new user turn.',
          })
        }
      }
    } else {
      if (inSpeech && !confirmed) {
        // Too short — gated.
        const dur = pt.t - speechStart
        if (dur > 60) {
          events.push({ t: pt.t, type: 'GATED', note: `${dur} ms burst discarded by the ${s.minSpeechMs} ms minimum — ${track.find((x) => x.t === speechStart)?.truth === 'noise-burst' ? 'correctly (it was a cough)' : 'but it was real speech: a word was missed!'}` })
          if (track.find((x) => x.t === speechStart)?.truth === 'speech') {
            segments.push({ startMs: speechStart, endMs: pt.t, kind: 'missed' })
            problems.push({
              kind: 'missed',
              title: 'Real speech gated out',
              detail: `min-speech ${s.minSpeechMs} ms swallowed a short word. Short confirmations ("yes", "no") die this way. Lower min-speech.`,
            })
          }
        }
        inSpeech = false
      } else if (inSpeech && confirmed) {
        endSegment(pt.t)
        events.push({ t: pt.t, type: 'SPEECH_ENDED', note: 'Energy below threshold — silence clock starts.' })
        silenceStart = pt.t
      }
      if (silenceStart !== null && !committedThisSilence && speechEverConfirmed) {
        if (pt.t - silenceStart >= s.silenceTimeoutMs) {
          committedThisSilence = true
          const midThought = pt.truth === 'pause-within-thought'
          const empty = !realSpeechSinceCommit
          turnCommits.push({ atMs: pt.t, midThought, empty })
          realSpeechSinceCommit = false
          events.push({
            t: pt.t,
            type: 'TURN_COMPLETE',
            note: empty
              ? `${s.silenceTimeoutMs} ms of silence → turn committed, but no real speech was in it. The agent will respond to a cough.`
              : midThought
                ? `${s.silenceTimeoutMs} ms of silence → turn committed — INSIDE the user's thinking pause. The agent now answers "I want to change my flight" without ever hearing "to Thursday morning".`
                : `${s.silenceTimeoutMs} ms of silence → turn committed. Correct: the thought was finished.`,
          })
          if (midThought) {
            problems.push({
              kind: 'premature',
              title: 'Premature turn completion',
              detail: `The silence timeout (${s.silenceTimeoutMs} ms) is shorter than the user's thinking pause (~900 ms). VAD answered "is there sound?" but the real question was "is the thought finished?". Raise the timeout — and pay for it in perceived latency on every normal turn: that is the tradeoff.`,
            })
          }
          if (empty) {
            problems.push({
              kind: 'empty-turn',
              title: 'Empty turn committed (agent responds to noise)',
              detail: `A non-speech sound passed the ${s.minSpeechMs} ms gate and then the endpointer committed a turn containing no words. In production this is the agent suddenly saying "Sorry, I didn't catch that" at a silent caller. Raise min-speech duration or the threshold.`,
            })
          }
        }
      }
    }
  }
  endSegment(track[track.length - 1]?.t ?? 0)

  if (turnCommits.length === 0 && speechEverConfirmed) {
    problems.push({
      kind: 'no-commit',
      title: 'Turn never committed',
      detail: `With a ${s.silenceTimeoutMs} ms timeout the trailing silence never satisfied the endpointer — the caller finishes talking and the agent just… waits. This is what "the bot feels slow/stuck" often is.`,
    })
  }
  if (turnCommits.length > 0 && !turnCommits.some((c) => c.midThought) && s.silenceTimeoutMs >= 900) {
    problems.push({
      kind: 'slow',
      title: 'Slow but safe',
      detail: `A ${s.silenceTimeoutMs} ms timeout survived the thinking pause — the full sentence was captured. The cost: EVERY turn now ends with ${s.silenceTimeoutMs} ms of dead air before the agent even starts thinking.`,
    })
  }

  return { segments, events, turnCommittedAt: turnCommits[0]?.atMs ?? null, turnCommits, problems }
}

/** The barge-in internal event sequence, as data for the lab. */
export const BARGE_IN_SEQUENCE = [
  { t: 0, type: 'PLAYBACK_ACTIVE', note: 'Agent audio is streaming to the caller: "Your premium is two thousand one hundred—"' },
  { t: 180, type: 'SPEECH_DETECTED', note: 'VAD raises speech probability above threshold WHILE playback is active. Could be the user — could be their TV.' },
  { t: 300, type: 'INTERRUPTION_DETECTED', note: 'Speech sustained past the min-duration gate (120 ms): this is a real barge-in, not a cough. State: SPEAKING → INTERRUPTED.' },
  { t: 320, type: 'CANCEL_TTS', note: 'Upstream synthesis cancelled — stop generating (and paying for) words nobody will hear.' },
  { t: 340, type: 'CLEAR_AUDIO_BUFFER', note: 'Transport-side flush. THE step everyone forgets: seconds of audio are already queued at the gateway/carrier. Skip this and the agent "keeps talking" after being interrupted.' },
  { t: 380, type: 'NEW_USER_TURN', note: 'State: INTERRUPTED → LISTENING. The partial agent reply is recorded in history as partially-delivered, so the LLM knows what the user actually heard.' },
] as const
