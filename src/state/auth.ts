/**
 * Sign-in, and the sync engine that follows from it.
 *
 * The shape of the thing: the app is fully usable signed out, and signing in
 * only adds a second copy of the learner's record in Supabase. So every code
 * path here has to be a no-op when Supabase is unconfigured, and a failure to
 * reach the network must never cost the learner anything — their work is
 * already in localStorage before any of this runs.
 *
 * The sync loop:
 *
 *   sign in  →  pull the remote row
 *            →  merge it with whatever is local (see state/sync.ts)
 *            →  apply the merged state locally
 *            →  push it back if the merge added anything
 *
 *   any later change to synced state  →  debounce  →  push
 *
 * Merge-then-push rather than pull-or-push is what makes signing in on a second
 * device safe: progress is a union, so it can only ever grow.
 */

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { LEARNER_STATE_TABLE, isSupabaseConfigured, supabase, supabaseStatus } from '../lib/supabase'
import { currentLearnerState, useAppStore } from './store'
import { fromRow, mergeLearnerState, needsPush, toRow } from './sync'

export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'signed-in'
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline'

interface AuthState {
  status: AuthStatus
  user: { id: string; email: string | null } | null
  /** The last auth error, in the words Supabase used. */
  error: string | null
  /** Set after a sign-up or magic link, when the next step is the inbox. */
  notice: string | null
  sync: SyncStatus
  syncedAt: number | null
  syncError: string | null

  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signInWithMagicLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
  clearMessages: () => void

  /** Pull, merge, apply, push. Safe to call more than once. */
  syncNow: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: isSupabaseConfigured ? 'loading' : 'unconfigured',
  user: null,
  error: null,
  notice: null,
  sync: 'idle',
  syncedAt: null,
  syncError: null,

  signUp: async (email, password) => {
    if (!supabase) return
    set({ error: null, notice: null })
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return set({ error: error.message })
    // With email confirmation on, there is no session yet and the next step is
    // the inbox. Saying so beats a form that appears to do nothing.
    if (!data.session) {
      set({ notice: `Check ${email} for a confirmation link, then sign in.` })
    }
  },

  signIn: async (email, password) => {
    if (!supabase) return
    set({ error: null, notice: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) set({ error: error.message })
  },

  signInWithMagicLink: async (email) => {
    if (!supabase) return
    set({ error: null, notice: null })
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    })
    if (error) return set({ error: error.message })
    set({ notice: `Sign-in link sent to ${email}. It opens straight back into this workspace.` })
  },

  signOut: async () => {
    if (!supabase) return
    // Push whatever is outstanding before letting go of the session, so the
    // last few minutes of work are not stranded on this device.
    await get().syncNow().catch(() => undefined)
    await supabase.auth.signOut()
    set({ sync: 'idle', syncedAt: null, syncError: null })
  },

  clearMessages: () => set({ error: null, notice: null }),

  syncNow: async () => {
    const { user } = get()
    if (!supabase || !user) return
    set({ sync: 'syncing', syncError: null })
    try {
      const { data, error } = await supabase
        .from(LEARNER_STATE_TABLE)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()

      // PGRST116 is "no rows", which is the normal state on a first sign-in.
      if (error && error.code !== 'PGRST116') throw error

      const remote = fromRow(data)
      const local = currentLearnerState()
      const merged = mergeLearnerState(local, remote)

      useAppStore.getState().applyLearnerState(merged)

      if (needsPush(merged, remote)) {
        const { error: upsertError } = await supabase
          .from(LEARNER_STATE_TABLE)
          .upsert(toRow(user.id, { ...merged, updatedAt: Date.now() }), { onConflict: 'user_id' })
        if (upsertError) throw upsertError
      }

      set({ sync: 'synced', syncedAt: Date.now() })
    } catch (e) {
      // Losing the network must never lose work: the local copy is already
      // authoritative, so this is a status message, not a failure state.
      set({ sync: 'error', syncError: e instanceof Error ? e.message : String(e) })
    }
  },
}))

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function applySession(session: Session | null): void {
  if (!session?.user) {
    useAuthStore.setState({ status: 'signed-out', user: null })
    return
  }
  useAuthStore.setState({
    status: 'signed-in',
    user: { id: session.user.id, email: session.user.email ?? null },
    error: null,
    notice: null,
  })
}

let started = false

/**
 * Start listening for sessions and keep the remote copy up to date.
 *
 * Called once from `main.tsx`. Idempotent, because React 18's StrictMode
 * mounts everything twice in development and a second subscription would push
 * every change twice.
 */
export function startAuth(): void {
  if (started || !supabase) return
  started = true

  supabase.auth.getSession().then(({ data }) => {
    applySession(data.session)
    if (data.session) void useAuthStore.getState().syncNow()
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    const wasSignedIn = useAuthStore.getState().status === 'signed-in'
    applySession(session)
    if (session && !wasSignedIn) void useAuthStore.getState().syncNow()
  })

  // Push local changes, debounced. The subscription is on the clock rather than
  // on each slice: one field to watch, and it only moves when something that
  // syncs has actually changed.
  let timer: ReturnType<typeof setTimeout> | null = null
  useAppStore.subscribe((state, prev) => {
    if (state.learnerUpdatedAt === prev.learnerUpdatedAt) return
    if (useAuthStore.getState().status !== 'signed-in') return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void useAuthStore.getState().syncNow(), PUSH_DEBOUNCE_MS)
  })
}

/**
 * Long enough that dragging a slider does not write a row per frame, short
 * enough that closing the tab after finishing a step does not lose it.
 */
export const PUSH_DEBOUNCE_MS = 1500

export { supabaseStatus }
