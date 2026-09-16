/**
 * Cost engine.
 *
 * Computes per-call, per-minute, daily, monthly and annual cost from a fully
 * editable pricing sheet. Every default is an EXAMPLE ASSUMPTION — the UI
 * labels them as such and every field is editable. The teaching goal is the
 * *shape* of voice-agent economics: which components dominate, which scale
 * per-minute vs per-call vs fixed, and where optimisation actually pays.
 */

import type { CostLineItem, CostResult } from '../domain/types'
import { round } from '../engine/simulation'

export interface CostInputs {
  callsPerDay: number
  avgCallMinutes: number
  peakConcurrent: number
  /** Fraction of call minutes where STT is actively listening. */
  sttDutyCycle: number
  /** Fraction of call minutes where TTS is speaking. */
  ttsSpeakingFraction: number
  /** LLM turns per call. */
  turnsPerCall: number
  llmInputTokensPerTurn: number
  llmOutputTokensPerTurn: number
  ttsCharsPerTurn: number
  recordingEnabled: boolean
  recordingMbPerMinute: number
  retentionMonths: number
  pricing: PricingSheet
}

export interface PricingSheet {
  sttPerMinute: number
  ttsPer1kChars: number
  llmPer1kInputTokens: number
  llmPer1kOutputTokens: number
  telephonyPerMinute: number
  mediaServerPerInstanceHour: number
  mediaServerCallsPerInstance: number
  redisPerNodeHour: number
  redisNodes: number
  postgresPerInstanceHour: number
  postgresInstances: number
  queuePerMillionMsgs: number
  asyncMsgsPerCall: number
  storagePerGbMonth: number
  observabilityPerGbIngest: number
  telemetryMbPerCall: number
}

export const DEFAULT_PRICING: PricingSheet = {
  // All EXAMPLE ASSUMPTIONS, editable in the UI.
  sttPerMinute: 0.0059,
  ttsPer1kChars: 0.018,
  llmPer1kInputTokens: 0.00015,
  llmPer1kOutputTokens: 0.0006,
  telephonyPerMinute: 0.014,
  mediaServerPerInstanceHour: 0.17,
  mediaServerCallsPerInstance: 50,
  redisPerNodeHour: 0.09,
  redisNodes: 2,
  postgresPerInstanceHour: 0.35,
  postgresInstances: 2,
  queuePerMillionMsgs: 0.4,
  asyncMsgsPerCall: 12,
  storagePerGbMonth: 0.023,
  observabilityPerGbIngest: 0.5,
  telemetryMbPerCall: 0.8,
}

export const DEFAULT_COST_INPUTS: CostInputs = {
  callsPerDay: 5000,
  avgCallMinutes: 4,
  peakConcurrent: 500,
  sttDutyCycle: 0.45,
  ttsSpeakingFraction: 0.4,
  turnsPerCall: 8,
  llmInputTokensPerTurn: 1800,
  llmOutputTokensPerTurn: 60,
  ttsCharsPerTurn: 220,
  recordingEnabled: true,
  recordingMbPerMinute: 0.7,
  retentionMonths: 6,
  pricing: DEFAULT_PRICING,
}

export function computeCost(i: CostInputs): CostResult {
  const p = i.pricing
  const minutesPerCall = i.avgCallMinutes
  const callsPerMonth = i.callsPerDay * 30

  const items: CostLineItem[] = []
  const push = (
    key: string,
    label: string,
    category: CostLineItem['category'],
    usdPerCall: number,
    basis: string,
  ) => {
    items.push({
      key,
      label,
      category,
      usdPerCall: round(usdPerCall, 5),
      usdPerDay: round(usdPerCall * i.callsPerDay, 2),
      usdPerMonth: round(usdPerCall * callsPerMonth, 2),
      basis,
    })
  }

  // --- Usage-priced components (scale per call) ---
  const sttMinutes = minutesPerCall * i.sttDutyCycle
  push('stt', 'Speech-to-text', 'speech', sttMinutes * p.sttPerMinute,
    `${round(sttMinutes, 2)} listening-min/call × $${p.sttPerMinute}/min`)

  const ttsChars = i.turnsPerCall * i.ttsCharsPerTurn
  push('tts', 'Text-to-speech', 'speech', (ttsChars / 1000) * p.ttsPer1kChars,
    `${ttsChars} chars/call × $${p.ttsPer1kChars}/1k chars`)

  const inTok = i.turnsPerCall * i.llmInputTokensPerTurn
  const outTok = i.turnsPerCall * i.llmOutputTokensPerTurn
  push('llm', 'LLM tokens', 'intelligence',
    (inTok / 1000) * p.llmPer1kInputTokens + (outTok / 1000) * p.llmPer1kOutputTokens,
    `${inTok} in + ${outTok} out tokens/call. Note: input tokens dominate — context is re-sent every turn.`)

  push('telephony', 'Telephony minutes', 'telephony', minutesPerCall * p.telephonyPerMinute,
    `${minutesPerCall} min/call × $${p.telephonyPerMinute}/min`)

  // --- Capacity-priced components (scale with peak concurrency, not calls) ---
  const mediaInstances = Math.max(1, Math.ceil(i.peakConcurrent / p.mediaServerCallsPerInstance / 0.7))
  const computeMonthly = mediaInstances * p.mediaServerPerInstanceHour * 24 * 30
  push('compute', `Media/runtime compute (${mediaInstances} instances)`, 'compute', computeMonthly / callsPerMonth,
    `Sized by PEAK concurrency (${i.peakConcurrent}), not call volume — idle capacity at 3 am still bills.`)

  const redisMonthly = p.redisNodes * p.redisPerNodeHour * 24 * 30
  push('redis', `Redis (${p.redisNodes} nodes)`, 'data', redisMonthly / callsPerMonth, 'Session state tier; fixed while it fits.')

  const pgMonthly = p.postgresInstances * p.postgresPerInstanceHour * 24 * 30
  push('postgres', `PostgreSQL (${p.postgresInstances} instances)`, 'data', pgMonthly / callsPerMonth, 'Durable record; steps up in chunks, not smoothly.')

  push('queue', 'Queue / events', 'data', (i.pricing.asyncMsgsPerCall / 1_000_000) * p.queuePerMillionMsgs,
    `${p.asyncMsgsPerCall} async messages/call — effectively free until volume is huge.`)

  // --- Storage (accumulates with retention!) ---
  if (i.recordingEnabled) {
    const gbPerCall = (minutesPerCall * i.recordingMbPerMinute) / 1024
    // Steady-state stored volume = monthly inflow × retention months.
    const steadyGb = gbPerCall * callsPerMonth * i.retentionMonths
    const monthly = steadyGb * p.storagePerGbMonth
    push('recording', `Recordings (${Math.round(steadyGb)} GB steady-state)`, 'storage', monthly / callsPerMonth,
      `${i.retentionMonths}-month retention means you always store ${i.retentionMonths} months of calls. Retention policy is a cost dial.`)
  }

  const obsGb = (i.pricing.telemetryMbPerCall / 1024)
  push('observability', 'Observability ingest', 'observability', obsGb * p.observabilityPerGbIngest,
    `${p.telemetryMbPerCall} MB logs/metrics/traces per call × $${p.observabilityPerGbIngest}/GB`)

  const usdPerCall = items.reduce((s, li) => s + li.usdPerCall, 0)
  const usdPerDay = items.reduce((s, li) => s + li.usdPerDay, 0)
  const usdPerMonth = items.reduce((s, li) => s + li.usdPerMonth, 0)

  return {
    lineItems: items.sort((a, b) => b.usdPerCall - a.usdPerCall),
    // Rounded to the same precision as the line items so the headline figure is
    // exactly the sum of the rows the UI displays — no unexplained pennies.
    usdPerCall: round(usdPerCall, 5),
    usdPerMinute: round(usdPerCall / minutesPerCall, 5),
    usdPerDay: round(usdPerDay, 2),
    usdPerMonth: round(usdPerMonth, 2),
    usdPerYear: round(usdPerMonth * 12, 2),
    assumptions: [
      'All prices are EXAMPLE ASSUMPTIONS — edit them to match real quotes; the structure, not the defaults, is the model.',
      'Usage components (STT/TTS/LLM/telephony) scale with call volume; capacity components (compute/Redis/Postgres) scale with PEAK concurrency; storage scales with volume × retention.',
      `Compute sized at 70% peak utilisation: ${Math.max(1, Math.ceil(i.peakConcurrent / i.pricing.mediaServerCallsPerInstance / 0.7))} media instances for ${i.peakConcurrent} peak concurrent calls.`,
      'No committed-use discounts, support plans, or egress fees modelled.',
    ],
  }
}

/** A handful of what-if levers with computed savings, for the optimisation lesson. */
export function costLevers(base: CostInputs): { label: string; deltaPerMonth: number; note: string }[] {
  const baseline = computeCost(base).usdPerMonth
  const lever = (label: string, mutate: (c: CostInputs) => CostInputs, note: string) => {
    const v = computeCost(mutate(structuredClone(base))).usdPerMonth
    return { label, deltaPerMonth: round(v - baseline, 2), note }
  }
  return [
    lever('Trim LLM context 1800 → 900 tokens/turn', (c) => {
      c.llmInputTokensPerTurn = Math.round(c.llmInputTokensPerTurn / 2)
      return c
    }, 'Summarise history instead of resending it. Also cuts time-to-first-token.'),
    lever('Cheaper TTS tier ($0.018 → $0.004 /1k chars)', (c) => {
      c.pricing.ttsPer1kChars = 0.004
      return c
    }, 'Standard neural voice instead of premium. A/B the answer rate before deciding.'),
    lever('SIP trunk telephony ($0.014 → $0.006 /min)', (c) => {
      c.pricing.telephonyPerMinute = 0.006
      return c
    }, 'Roughly half-price minutes in exchange for operating SBCs yourself.'),
    lever('Recording retention 6 → 2 months', (c) => {
      c.retentionMonths = 2
      return c
    }, 'Storage is volume × retention; retention is usually a policy default nobody questioned.'),
    lever('Shorter calls (−30 s avg) via tighter prompts', (c) => {
      c.avgCallMinutes = Math.max(0.5, c.avgCallMinutes - 0.5)
      return c
    }, 'Every per-minute meter (STT, telephony, compute occupancy) shrinks together.'),
  ]
}
