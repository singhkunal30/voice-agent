/**
 * Global app state (zustand).
 *
 * Holds cross-cutting state only: the working architecture, the active
 * scenario, view mode (simple vs engineering), learning progress and saved
 * architectures. Lab-local state (sliders etc.) stays in the labs.
 * Persistence is localStorage; the app remains fully client-side.
 */

import { create } from 'zustand'
import type { Architecture, Requirements, Scenario, ViewMode } from '../domain/types'
import type { Mode } from '../nav'
import type { PredictionRecordEntry } from '../domain/prediction'
import { predictionFlag } from '../domain/learning'
import type { PromptSelection } from '../models/prompt'
import { MINIMAL_SELECTION } from '../models/prompt'
import type { LearnerState } from './sync'

export type Theme = 'dark' | 'light'
import { cloneArchitecture } from '../domain/builder'
import { PATTERNS } from '../patterns/library'
import { SCENARIOS } from '../scenarios/library'

const LS_PREFIX = 'voice-sim:'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Stamp a change to synced state, persisting the clock with it. */
function touch(): number {
  const now = Date.now()
  save('learnerUpdatedAt', now)
  return now
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable — the app works without persistence.
  }
}

export interface SavedArchitecture {
  id: string
  name: string
  savedAt: string
  architecture: Architecture
}

/** Paints the theme onto <html> so the CSS variables in theme.css swap over. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * Density follows the detail switch rather than being a third control.
 *
 * Engineering detail means more numbers on screen, and more numbers on screen
 * means tighter rows — otherwise the panels people opened for detail push the
 * thing they were comparing below the fold. One switch, two effects, no extra
 * decision for the learner to make.
 */
export function applyDensity(mode: ViewMode): void {
  document.documentElement.setAttribute('data-density', mode === 'engineering' ? 'compact' : 'comfortable')
}

interface AppState {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void

  /** The activity lens over the navigation. null = show everything. */
  mode: Mode | null
  setMode: (m: Mode | null) => void

  theme: Theme
  setTheme: (t: Theme) => void

  activeScenario: Scenario | null
  setActiveScenario: (s: Scenario | null) => void

  /** The architecture currently on the canvas / under evaluation. */
  workingArchitecture: Architecture
  setWorkingArchitecture: (a: Architecture) => void
  loadPattern: (patternId: string) => void

  savedArchitectures: SavedArchitecture[]
  saveArchitecture: (name: string) => void
  deleteSaved: (id: string) => void
  loadSaved: (id: string) => void

  /** Requirements the canvas validates against (from scenario or manual). */
  activeRequirements: Requirements | null
  setActiveRequirements: (r: Requirements | null) => void

  progress: Record<string, boolean>
  markProgress: (flag: string) => void
  resetProgress: () => void

  /**
   * Every prediction the learner has committed to before pressing Run.
   *
   * Kept so the course can require *evidence* rather than page visits, and so
   * the workspace can say which topics have been predicted correctly at least
   * once. Never aggregated into a score — see domain/prediction.ts.
   */
  predictions: PredictionRecordEntry[]
  recordPrediction: (entry: PredictionRecordEntry) => void
  clearPredictions: () => void

  /** The working voice prompt, shared between the prompt, quality and eval labs. */
  promptSelection: PromptSelection
  setPromptSelection: (s: PromptSelection) => void

  /**
   * Epoch ms of the last change to anything that syncs.
   *
   * Only the whole-value fields need it — progress and predictions merge
   * without a clock — but it is the tie-breaker for the prompt, and it tells
   * the sync engine whether there is anything worth pushing.
   */
  learnerUpdatedAt: number
  /** Replace every synced slice at once, after a merge. */
  applyLearnerState: (state: LearnerState) => void
}

const defaultArch = cloneArchitecture(PATTERNS[1].architecture, 'working')

const initialTheme = load<Theme>('theme', 'dark')
applyTheme(initialTheme)
const initialViewMode = load<ViewMode>('viewMode', 'simple')
applyDensity(initialViewMode)

export const useAppStore = create<AppState>((set, get) => ({
  viewMode: initialViewMode,
  setViewMode: (m) => {
    save('viewMode', m)
    applyDensity(m)
    set({ viewMode: m })
  },

  mode: load<Mode | null>('mode', null),
  setMode: (m) => {
    save('mode', m)
    set({ mode: m })
  },

  theme: initialTheme,
  setTheme: (t) => {
    save('theme', t)
    applyTheme(t)
    set({ theme: t })
  },

  activeScenario: load<string | null>('scenarioId', null)
    ? SCENARIOS.find((s) => s.id === load<string | null>('scenarioId', null)) ?? null
    : null,
  setActiveScenario: (s) => {
    save('scenarioId', s?.id ?? null)
    set({ activeScenario: s, activeRequirements: s?.requirements ?? get().activeRequirements })
  },

  workingArchitecture: load<Architecture>('workingArch', defaultArch),
  setWorkingArchitecture: (a) => {
    save('workingArch', a)
    set({ workingArchitecture: a })
  },
  loadPattern: (patternId) => {
    const pattern = PATTERNS.find((p) => p.id === patternId)
    if (!pattern) return
    const arch = cloneArchitecture(pattern.architecture, 'working')
    save('workingArch', arch)
    set({ workingArchitecture: arch, activeRequirements: pattern.architecture.requirements ?? get().activeRequirements })
  },

  savedArchitectures: load<SavedArchitecture[]>('saved', []),
  saveArchitecture: (name) => {
    const entry: SavedArchitecture = {
      id: `saved-${Date.now()}`,
      name,
      savedAt: new Date().toISOString(),
      architecture: cloneArchitecture(get().workingArchitecture),
    }
    const next = [entry, ...get().savedArchitectures].slice(0, 20)
    save('saved', next)
    set({ savedArchitectures: next, learnerUpdatedAt: touch() })
  },
  deleteSaved: (id) => {
    const next = get().savedArchitectures.filter((s) => s.id !== id)
    save('saved', next)
    set({ savedArchitectures: next, learnerUpdatedAt: touch() })
  },
  loadSaved: (id) => {
    const entry = get().savedArchitectures.find((s) => s.id === id)
    if (!entry) return
    const arch = cloneArchitecture(entry.architecture, 'working')
    save('workingArch', arch)
    set({ workingArchitecture: arch })
  },

  activeRequirements: load<Requirements | null>('requirements', null),
  setActiveRequirements: (r) => {
    save('requirements', r)
    set({ activeRequirements: r })
  },

  progress: load<Record<string, boolean>>('progress', {}),
  markProgress: (flag) => {
    if (get().progress[flag]) return
    const next = { ...get().progress, [flag]: true }
    save('progress', next)
    set({ progress: next, learnerUpdatedAt: touch() })
  },
  resetProgress: () => {
    // A reset has to reach the synced copy too, or signing in would merrily
    // restore everything the learner just cleared. The sync engine pushes on
    // the clock bump below.
    save('progress', {})
    set({ progress: {}, learnerUpdatedAt: touch() })
  },

  predictions: load<PredictionRecordEntry[]>('predictions', []),
  recordPrediction: (entry) => {
    // Bounded: this is a learning record, not an analytics pipeline, and an
    // unbounded array in localStorage eventually fails to serialise.
    const next = [...get().predictions, entry].slice(-200)
    save('predictions', next)
    set({ predictions: next, learnerUpdatedAt: touch() })
    // A correct prediction is the one piece of evidence the course cannot get
    // any other way, so it is written as a progress flag too. Only correct
    // ones, and only from the gate — which records before revealing the
    // answer, so the flag cannot be earned by reading the result first.
    if (entry.correct) get().markProgress(predictionFlag(entry.questionId))
  },
  clearPredictions: () => {
    save('predictions', [])
    set({ predictions: [], learnerUpdatedAt: touch() })
  },

  promptSelection: load<PromptSelection>('promptSelection', MINIMAL_SELECTION),
  setPromptSelection: (sel) => {
    save('promptSelection', sel)
    set({ promptSelection: sel, learnerUpdatedAt: touch() })
  },

  learnerUpdatedAt: load<number>('learnerUpdatedAt', 0),
  applyLearnerState: (state) => {
    save('progress', state.progress)
    save('predictions', state.predictions)
    save('promptSelection', state.promptSelection)
    save('saved', state.savedArchitectures)
    save('learnerUpdatedAt', state.updatedAt)
    set({
      progress: state.progress,
      predictions: state.predictions,
      promptSelection: state.promptSelection,
      savedArchitectures: state.savedArchitectures,
      learnerUpdatedAt: state.updatedAt,
    })
  },
}))

/** The synced slice of the store, as the sync engine wants it. */
export function currentLearnerState(): LearnerState {
  const s = useAppStore.getState()
  return {
    progress: s.progress,
    predictions: s.predictions,
    promptSelection: s.promptSelection,
    savedArchitectures: s.savedArchitectures,
    updatedAt: s.learnerUpdatedAt,
  }
}
