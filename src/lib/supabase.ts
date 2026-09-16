/**
 * The Supabase client — optional, and deliberately so.
 *
 * This workspace's core promise is that it runs with no keys, no accounts and
 * no network. Sign-in is an *addition* to that, not a replacement: with no
 * environment configured, `supabase` is null, `isSupabaseConfigured` is false,
 * and every surface falls back to localStorage exactly as it did before. That
 * is what lets the whole app — and its browser test suite — run with no
 * credentials at all.
 *
 * ---------------------------------------------------------------------------
 * THE KEY THIS FILE MUST NEVER BE GIVEN
 * ---------------------------------------------------------------------------
 *
 * A Vite `VITE_*` variable is inlined into the JavaScript bundle at build time.
 * It is not a secret. Anyone who loads the page can read it, and no amount of
 * minification changes that.
 *
 * That is fine for the **anon / publishable** key, which is designed to be
 * public: it carries no authority of its own, and Row Level Security decides
 * what the logged-in user may touch. See `supabase/migrations/` for the
 * policies that make that true here.
 *
 * It is catastrophic for the **service role** key, which bypasses RLS
 * entirely. Shipping one in a frontend bundle hands every visitor full read and
 * write access to every row in the database.
 *
 * `looksLikeServiceRoleKey` below checks for exactly that and refuses to start
 * the client, because a loud failure at boot is enormously better than a quiet
 * data breach. It is a seatbelt, not a security control — the real control is
 * not putting the key there.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * Does this look like a service-role JWT?
 *
 * Legacy Supabase keys are unsigned-payload JWTs whose claims name the role.
 * Newer publishable keys (`sb_publishable_…`) are opaque and are never
 * service-role, so they pass. Anything unparseable is allowed through — this
 * check exists to catch the one specific mistake, not to validate key formats.
 */
export function looksLikeServiceRoleKey(key: string): boolean {
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

const serviceRoleMisconfigured = Boolean(anonKey && looksLikeServiceRoleKey(anonKey))

if (serviceRoleMisconfigured) {
  // eslint-disable-next-line no-console
  console.error(
    [
      'VITE_SUPABASE_ANON_KEY is a SERVICE ROLE key. Refusing to start the Supabase client.',
      '',
      'A VITE_* variable is compiled into the JavaScript bundle and is readable by',
      'anyone who loads the page. The service role key bypasses Row Level Security,',
      'so publishing it gives every visitor full access to the database.',
      '',
      'Use the anon / publishable key instead (Supabase dashboard → Project Settings',
      '→ API), and rotate the service role key you pasted here — it should be treated',
      'as compromised.',
    ].join('\n'),
  )
}

export const isSupabaseConfigured = Boolean(url && anonKey) && !serviceRoleMisconfigured

/** Why sign-in is unavailable, when it is. Rendered in the account panel. */
export const supabaseStatus: 'ready' | 'not-configured' | 'service-role-key' = serviceRoleMisconfigured
  ? 'service-role-key'
  : isSupabaseConfigured
    ? 'ready'
    : 'not-configured'

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The app is a hash router, so there is no OAuth redirect path to
        // parse. Magic links land back on the page with the token in the URL
        // fragment, which detectSessionInUrl does handle.
        detectSessionInUrl: true,
      },
    })
  : null

/** The table the learner's synced state lives in. */
export const LEARNER_STATE_TABLE = 'learner_state'
