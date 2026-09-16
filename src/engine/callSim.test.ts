import { describe, expect, it } from 'vitest'
import { DEFAULT_RELIABILITY, simulateCall, type CallSimOptions } from './callSim'

export function baseOptions(overrides: Partial<CallSimOptions> = {}): CallSimOptions {
  return {
    seed: 'test-seed',
    channel: 'phone',
    utterance: 'I want to know the premium for a one crore insurance policy',
    language: 'en-IN',
    noiseLevel: 0.1,
    sttProviderId: 'stt-stream-fast',
    ttsProviderId: 'tts-premium-stream',
    llmProviderId: 'llm-fast-small',
    telephonyProviderId: 'tel-cpaas',
    streamingLlm: true,
    streamingTts: true,
    vad: { speechThreshold: 0.5, minSpeechMs: 120, silenceTimeoutMs: 600 },
    network: { userToEdgeMs: 35, edgeToServerMs: 10, serverToProviderMs: 15 },
    greeting: 'Hi, thanks for calling Acme Insurance. How can I help?',
    responseText:
      'For a one crore term policy, the monthly premium comes to around two thousand one hundred rupees based on your profile.',
    llmContextTokens: 1800,
    llmOutputTokens: 60,
    toolCalls: [{ name: 'premium_calculator', latencyMs: 220, resultSummary: '₹2,100/month for ₹1 crore cover' }],
    interruption: undefined,
    handoff: undefined,
    failures: [],
    reliability: { ...DEFAULT_RELIABILITY },
    ...overrides,
  }
}

describe('simulateCall', () => {
  it('produces a completed call with the expected event backbone', () => {
    const r = simulateCall(baseOptions())
    expect(r.outcome).toBe('completed')
    const types = r.events.map((e) => e.type)
    for (const expected of [
      'CALL_STARTED',
      'SIP_INVITE',
      'SIP_200_OK',
      'SIP_ACK',
      'RTP_STREAM_STARTED',
      'WS_CONNECTED',
      'CALL_CONNECTED',
      'AUDIO_FRAME_RECEIVED',
      'SPEECH_STARTED',
      'TRANSCRIPT_PARTIAL',
      'SPEECH_ENDED',
      'ENDPOINT_DETECTED',
      'TRANSCRIPT_FINAL',
      'TURN_COMPLETE',
      'CONTEXT_BUILT',
      'LLM_STARTED',
      'LLM_FIRST_TOKEN',
      'TOOL_CALL_STARTED',
      'TOOL_CALL_COMPLETED',
      'TTS_STARTED',
      'TTS_FIRST_AUDIO',
      'PLAYBACK_STARTED',
      'CALL_ENDED',
    ]) {
      expect(types, `missing event ${expected}`).toContain(expected)
    }
  })

  it('is deterministic: same seed -> identical event log', () => {
    const a = simulateCall(baseOptions())
    const b = simulateCall(baseOptions())
    expect(a.events).toEqual(b.events)
    expect(a.latency).toEqual(b.latency)
  })

  it('differs across seeds', () => {
    const a = simulateCall(baseOptions({ seed: 's1' }))
    const b = simulateCall(baseOptions({ seed: 's2' }))
    expect(a.latency.perceivedLatencyMs).not.toBe(b.latency.perceivedLatencyMs)
  })

  it('events are in non-decreasing time order with unique seqs', () => {
    const r = simulateCall(baseOptions())
    for (let i = 1; i < r.events.length; i++) {
      expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t)
    }
    const seqs = new Set(r.events.map((e) => e.seq))
    expect(seqs.size).toBe(r.events.length)
  })

  it('latency markers are causally ordered', () => {
    const r = simulateCall(baseOptions())
    const m = r.markers
    expect(m.userSpeechEndMs).toBeGreaterThan(m.userSpeechStartMs)
    expect(m.turnCompleteMs).toBeGreaterThanOrEqual(m.userSpeechEndMs)
    expect(m.firstLlmTokenMs).toBeGreaterThan(m.turnCompleteMs)
    expect(m.firstTtsAudioMs).toBeGreaterThan(m.firstLlmTokenMs)
    expect(m.playbackStartMs).toBeGreaterThan(m.firstTtsAudioMs)
    expect(m.callEndMs).toBeGreaterThan(m.playbackStartMs)
    expect(r.latency.perceivedLatencyMs).toBeGreaterThan(0)
    expect(r.latency.perceivedLatencyMs).toBeLessThan(10000)
  })

  it('interruption cancels TTS and clears buffers', () => {
    const r = simulateCall(
      baseOptions({ interruption: { afterPlaybackMs: 800, utterance: 'Wait, does that include tax?' } }),
    )
    const types = r.events.map((e) => e.type)
    expect(types).toContain('USER_INTERRUPTION')
    expect(types).toContain('TTS_CANCELLED')
    expect(types).toContain('BUFFER_CLEARED')
    const interrupt = r.events.find((e) => e.type === 'USER_INTERRUPTION')!
    const cancel = r.events.find((e) => e.type === 'TTS_CANCELLED')!
    expect(cancel.t).toBeGreaterThanOrEqual(interrupt.t)
  })

  it('STT outage without fallback fails the call; with fallback it recovers', () => {
    const noFallback = simulateCall(
      baseOptions({
        failures: [{ target: 'stt', probability: 1 }],
        reliability: { ...DEFAULT_RELIABILITY, sttFallback: false },
      }),
    )
    expect(noFallback.outcome).toBe('failed')

    const withFallback = simulateCall(baseOptions({ failures: [{ target: 'stt', probability: 1 }] }))
    expect(withFallback.outcome).toBe('completed')
    expect(withFallback.recoveries).toContain('stt-fallback')
  })

  it('TTS outage with fallback engages the fallback voice', () => {
    const r = simulateCall(baseOptions({ failures: [{ target: 'tts', probability: 1 }] }))
    expect(r.outcome).toBe('completed')
    expect(r.recoveries).toContain('tts-fallback')
    expect(r.events.some((e) => e.type === 'FALLBACK_ENGAGED')).toBe(true)
  })

  it('LLM timeout retries and recovers', () => {
    const r = simulateCall(baseOptions({ failures: [{ target: 'llm', probability: 1 }] }))
    expect(r.outcome).toBe('completed')
    expect(r.recoveries).toContain('llm-retry')
    expect(r.events.some((e) => e.type === 'TIMEOUT')).toBe(true)
    expect(r.events.some((e) => e.type === 'RETRY')).toBe(true)
  })

  it('handoff with available agent completes the transfer', () => {
    const r = simulateCall(
      baseOptions({
        handoff: { requested: true, agentAvailable: true, queueWaitMs: 0, acceptDelayMs: 2000 },
      }),
    )
    expect(r.outcome).toBe('handed-off')
    const types = r.events.map((e) => e.type)
    expect(types).toContain('HANDOFF_REQUESTED')
    expect(types).toContain('HANDOFF_ACCEPTED')
    expect(types).toContain('HANDOFF_COMPLETED')
  })

  it('handoff with no agent falls back to callback', () => {
    const r = simulateCall(
      baseOptions({
        handoff: { requested: true, agentAvailable: false, queueWaitMs: 120000, acceptDelayMs: 0 },
      }),
    )
    expect(r.events.some((e) => e.type === 'HANDOFF_FAILED')).toBe(true)
    expect(r.outcome).toBe('completed')
  })

  it('network latency injection raises perceived latency', () => {
    const base = simulateCall(baseOptions())
    const slow = simulateCall(
      baseOptions({ failures: [{ target: 'network-latency', probability: 1, extraMs: 250 }] }),
    )
    expect(slow.latency.perceivedLatencyMs).toBeGreaterThan(base.latency.perceivedLatencyMs + 200)
  })

  it('s2s mode skips the composed pipeline hops', () => {
    const r = simulateCall(baseOptions({ s2sMode: true, toolCalls: [] }))
    expect(r.outcome).toBe('completed')
    expect(r.events.some((e) => e.component === 'S2S model')).toBe(true)
    expect(r.events.some((e) => e.type === 'CONTEXT_BUILT')).toBe(false)
  })

  it('browser channel uses WebRTC setup instead of SIP', () => {
    const r = simulateCall(baseOptions({ channel: 'browser' }))
    const types = r.events.map((e) => e.type)
    expect(types).not.toContain('SIP_INVITE')
    expect(r.events.some((e) => e.component.startsWith('WebRTC'))).toBe(true)
  })
})
