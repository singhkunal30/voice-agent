/**
 * Playback of a precomputed simulation event log.
 *
 * The engine computes the entire log up front (deterministically); this hook
 * merely animates a cursor through virtual time at a chosen speed. The UI
 * animation layer therefore cannot change any result — pause, step and speed
 * only change what you are looking at, never what happened.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SimEvent } from '../domain/types'

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'done'

export interface Playback {
  state: PlaybackState
  /** Current virtual time in ms. */
  now: number
  /** Events with t <= now. */
  visible: SimEvent[]
  /** Index of the most recent visible event. */
  cursor: number
  speed: number
  start: () => void
  pause: () => void
  /** Advance to the next event instantly. */
  step: () => void
  reset: () => void
  /** Jump to the end instantly. */
  finish: () => void
  setSpeed: (s: number) => void
  durationMs: number
}

export const SPEEDS = [0.5, 1, 2, 5, 10] as const

export function usePlayback(events: SimEvent[]): Playback {
  const [state, setState] = useState<PlaybackState>('idle')
  const [now, setNow] = useState(0)
  const [speed, setSpeed] = useState(2)
  const raf = useRef<number | null>(null)
  const lastWall = useRef<number>(0)
  const nowRef = useRef(0)
  const speedRef = useRef(speed)
  speedRef.current = speed

  const durationMs = events.length ? events[events.length - 1].t : 0

  // Reset when the event log itself changes (new simulation run).
  useEffect(() => {
    setState('idle')
    setNow(0)
    nowRef.current = 0
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
  }, [events])

  const stopLoop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
  }, [])

  const loop = useCallback(
    (wall: number) => {
      const dt = wall - lastWall.current
      lastWall.current = wall
      const next = nowRef.current + dt * speedRef.current
      nowRef.current = next
      setNow(next)
      if (next >= durationMs) {
        nowRef.current = durationMs
        setNow(durationMs)
        setState('done')
        stopLoop()
        return
      }
      raf.current = requestAnimationFrame(loop)
    },
    [durationMs, stopLoop],
  )

  const start = useCallback(() => {
    if (!events.length) return
    if (nowRef.current >= durationMs) {
      nowRef.current = 0
      setNow(0)
    }
    setState('playing')
    lastWall.current = performance.now()
    stopLoop()
    raf.current = requestAnimationFrame(loop)
  }, [events.length, durationMs, loop, stopLoop])

  const pause = useCallback(() => {
    setState('paused')
    stopLoop()
  }, [stopLoop])

  const step = useCallback(() => {
    stopLoop()
    const nextEvent = events.find((e) => e.t > nowRef.current + 0.001)
    if (nextEvent) {
      nowRef.current = nextEvent.t
      setNow(nextEvent.t)
      setState('paused')
    } else {
      nowRef.current = durationMs
      setNow(durationMs)
      setState('done')
    }
  }, [events, durationMs, stopLoop])

  const reset = useCallback(() => {
    stopLoop()
    nowRef.current = 0
    setNow(0)
    setState('idle')
  }, [stopLoop])

  const finish = useCallback(() => {
    stopLoop()
    nowRef.current = durationMs
    setNow(durationMs)
    setState('done')
  }, [durationMs, stopLoop])

  useEffect(() => stopLoop, [stopLoop])

  const visible = useMemo(() => {
    if (state === 'idle') return []
    let hi = 0
    while (hi < events.length && events[hi].t <= now) hi++
    return events.slice(0, hi)
  }, [events, now, state])

  return {
    state,
    now,
    visible,
    cursor: visible.length - 1,
    speed,
    start,
    pause,
    step,
    reset,
    finish,
    setSpeed,
    durationMs,
  }
}
