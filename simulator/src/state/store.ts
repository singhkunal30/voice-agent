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

interface AppState {
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void

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
}

const defaultArch = cloneArchitecture(PATTERNS[1].architecture, 'working')

const initialTheme = load<Theme>('theme', 'dark')
applyTheme(initialTheme)

export const useAppStore = create<AppState>((set, get) => ({
  viewMode: load<ViewMode>('viewMode', 'simple'),
  setViewMode: (m) => {
    save('viewMode', m)
    set({ viewMode: m })
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
    set({ savedArchitectures: next })
  },
  deleteSaved: (id) => {
    const next = get().savedArchitectures.filter((s) => s.id !== id)
    save('saved', next)
    set({ savedArchitectures: next })
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
    set({ progress: next })
  },
  resetProgress: () => {
    save('progress', {})
    set({ progress: {} })
  },
}))
