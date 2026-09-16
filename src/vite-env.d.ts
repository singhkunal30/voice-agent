/// <reference types="vite/client" />

/**
 * Both of these are optional by design. With neither set the workspace runs
 * exactly as it always has — locally, with no account and no network — and
 * sign-in simply does not appear.
 *
 * `VITE_*` variables are inlined into the bundle at build time and are readable
 * by anyone who loads the page. Only the anon / publishable key belongs here.
 * See src/lib/supabase.ts.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
