/**
 * What syncs, and how two copies of it are reconciled.
 *
 * The workspace works entirely offline: progress, predictions, the working
 * prompt and saved architectures all live in `localStorage`. Signing in adds a
 * second copy in Supabase so the same learner keeps their record across
 * devices. That means two copies that can both change, so there has to be a
 * merge rule — and "last write wins on the whole blob" is the wrong one,
 * because it silently throws away work done on the other device.
 *
 * The rules below are chosen per field, from what the field actually is:
 *
 *  - **progress** is a monotonic set. A flag is written when the learner does
 *    something; nothing but an explicit reset ever removes one. So the merge is
 *    a union, which is conflict-free: signing in on a new laptop can only ever
 *    add to what you had, never subtract.
 *  - **predictions** are an append-only log. Concatenate, dedupe on
 *    (question, timestamp), keep the most recent 200.
 *  - **promptSelection** is one coherent choice. Merging it section by section
 *    would produce a prompt neither device chose, so the newer whole wins.
 *  - **savedArchitectures** are keyed by id. Union by id, newer `savedAt` wins
 *    per id, then cap at 20 by recency — the same cap the local store uses.
 *
 * This module is pure. It does not know Supabase exists, which is what makes
 * the interesting part testable without a network or a key.
 */

import type { PredictionRecordEntry } from '../domain/prediction'
import type { PromptSelection } from '../models/prompt'
import type { Architecture } from '../domain/types'

export interface SavedArchitectureRecord {
  id: string
  name: string
  savedAt: string
  architecture: Architecture
}

/** The slice of app state that belongs to the learner rather than the device. */
export interface LearnerState {
  progress: Record<string, boolean>
  predictions: PredictionRecordEntry[]
  promptSelection: PromptSelection
  savedArchitectures: SavedArchitectureRecord[]
  /** Epoch ms of the last local change. Decides the whole-value fields. */
  updatedAt: number
}

/**
 * Device preferences — theme, density, which mode chip is selected — are
 * deliberately NOT in `LearnerState`. A dark-theme laptop and a light-theme
 * desktop is a preference, not a disagreement to resolve.
 */
export const DEVICE_ONLY_KEYS = ['theme', 'viewMode', 'mode'] as const

export const EMPTY_LEARNER_STATE: LearnerState = {
  progress: {},
  predictions: [],
  promptSelection: {},
  savedArchitectures: [],
  updatedAt: 0,
}

/** Keep the prediction log bounded; it is a learning record, not analytics. */
export const MAX_PREDICTIONS = 200
/** Matches the local store's own cap on saved designs. */
export const MAX_SAVED_ARCHITECTURES = 20

export function mergeLearnerState(local: LearnerState, remote: LearnerState): LearnerState {
  return {
    // Union. Work done anywhere counts everywhere.
    progress: { ...remote.progress, ...local.progress },

    predictions: dedupePredictions([...remote.predictions, ...local.predictions]),

    // One coherent choice: the newer whole wins rather than a per-section blend.
    promptSelection: local.updatedAt >= remote.updatedAt ? local.promptSelection : remote.promptSelection,

    savedArchitectures: mergeSaved(local.savedArchitectures, remote.savedArchitectures),

    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  }
}

function dedupePredictions(entries: PredictionRecordEntry[]): PredictionRecordEntry[] {
  const seen = new Map<string, PredictionRecordEntry>()
  for (const e of entries) seen.set(`${e.questionId}:${e.at}`, e)
  return [...seen.values()].sort((a, b) => a.at - b.at).slice(-MAX_PREDICTIONS)
}

function mergeSaved(local: SavedArchitectureRecord[], remote: SavedArchitectureRecord[]): SavedArchitectureRecord[] {
  const byId = new Map<string, SavedArchitectureRecord>()
  for (const s of [...remote, ...local]) {
    const existing = byId.get(s.id)
    if (!existing || s.savedAt > existing.savedAt) byId.set(s.id, s)
  }
  return [...byId.values()]
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
    .slice(0, MAX_SAVED_ARCHITECTURES)
}

/** True when the merge produced something the remote does not already have. */
export function needsPush(merged: LearnerState, remote: LearnerState): boolean {
  if (Object.keys(merged.progress).length !== Object.keys(remote.progress).length) return true
  if (merged.predictions.length !== remote.predictions.length) return true
  if (merged.savedArchitectures.length !== remote.savedArchitectures.length) return true
  return JSON.stringify(merged.promptSelection) !== JSON.stringify(remote.promptSelection)
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/**
 * The row shape in Supabase, snake_cased to match Postgres convention.
 *
 * Columns are `jsonb` rather than a normalised schema on purpose: this is a
 * learner's private scratch state, read and written as one blob by exactly one
 * person, and a five-table schema would buy nothing but migrations.
 */
export interface LearnerStateRow {
  user_id: string
  progress: Record<string, boolean>
  predictions: PredictionRecordEntry[]
  prompt_selection: PromptSelection
  saved_architectures: SavedArchitectureRecord[]
  updated_at: string
}

export function toRow(userId: string, state: LearnerState): Omit<LearnerStateRow, 'updated_at'> & { updated_at: string } {
  return {
    user_id: userId,
    progress: state.progress,
    predictions: state.predictions,
    prompt_selection: state.promptSelection,
    saved_architectures: state.savedArchitectures,
    updated_at: new Date(state.updatedAt || Date.now()).toISOString(),
  }
}

/**
 * Row → state, defensively.
 *
 * Anything could be in those jsonb columns: an older client's shape, a hand-
 * edited row, a half-finished migration. A learning tool that white-screens
 * because one column came back null is worse than one that starts empty, so
 * every field falls back rather than throwing.
 */
export function fromRow(row: Partial<LearnerStateRow> | null | undefined): LearnerState {
  if (!row) return { ...EMPTY_LEARNER_STATE }
  const at = row.updated_at ? Date.parse(row.updated_at) : 0
  return {
    progress: isRecord(row.progress) ? (row.progress as Record<string, boolean>) : {},
    predictions: Array.isArray(row.predictions) ? row.predictions : [],
    promptSelection: isRecord(row.prompt_selection) ? (row.prompt_selection as PromptSelection) : {},
    savedArchitectures: Array.isArray(row.saved_architectures) ? row.saved_architectures : [],
    updatedAt: Number.isFinite(at) ? at : 0,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
