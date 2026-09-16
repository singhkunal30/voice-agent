/**
 * The account control in the header.
 *
 * Three states, and the first one is the important one:
 *
 *  - **Not configured.** No Supabase environment, so there is no button at all
 *    and nothing about the workspace changes. This is the default, and the
 *    browser test suite runs in it.
 *  - **Signed out.** "Sign in to sync" — with the reason stated, because asking
 *    someone to make an account without saying what it buys them is how you
 *    train people to close the dialog.
 *  - **Signed in.** The email, the sync status, and a way out.
 *
 * Nothing here gates the labs. Signing out leaves every bit of progress exactly
 * where it was, in localStorage, which is where it was all along.
 */

import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../state/auth'
import { supabaseStatus } from '../lib/supabase'

export function Account() {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const sync = useAuthStore((s) => s.sync)
  const syncedAt = useAuthStore((s) => s.syncedAt)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click and on Escape — a popover that traps you is worse
  // than no popover.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A service-role key in the frontend is worth shouting about even in the
  // header; everything else unconfigured is simply absent.
  if (status === 'unconfigured' && supabaseStatus !== 'service-role-key') return null

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={
          status === 'signed-in'
            ? `Signed in as ${user?.email ?? 'your account'} — progress syncs across devices`
            : 'Sign in to keep your progress across devices. Everything works signed out too.'
        }
      >
        {supabaseStatus === 'service-role-key' ? (
          <span className="text-bad">⚠ key misconfigured</span>
        ) : status === 'signed-in' ? (
          <>
            <SyncDot sync={sync} />
            <span className="hidden max-w-[10rem] truncate lg:inline">{user?.email ?? 'Account'}</span>
            <span className="lg:hidden">Account</span>
          </>
        ) : (
          'Sign in to sync'
        )}
      </button>

      {open && (
        <div className="panel-raised absolute right-0 top-full z-30 mt-2 w-[min(24rem,90vw)] animate-slide-in p-4">
          {supabaseStatus === 'service-role-key' ? (
            <ServiceRoleWarning />
          ) : status === 'signed-in' ? (
            <SignedIn email={user?.email ?? null} sync={sync} syncedAt={syncedAt} onDone={() => setOpen(false)} />
          ) : (
            <SignInForm />
          )}
        </div>
      )}
    </div>
  )
}

function SyncDot({ sync }: { sync: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    syncing: { cls: 'text-warn', label: 'syncing' },
    synced: { cls: 'text-good', label: 'synced' },
    error: { cls: 'text-bad', label: 'sync failed' },
    idle: { cls: 'text-ink-500', label: 'not synced yet' },
  }
  const s = map[sync] ?? map.idle
  return (
    <span className={s.cls} title={`Progress ${s.label}`} aria-label={`Progress ${s.label}`}>
      ●
    </span>
  )
}

function SignInForm() {
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const magicLink = useAuthStore((s) => s.signInWithMagicLink)
  const error = useAuthStore((s) => s.error)
  const notice = useAuthStore((s) => s.notice)
  const clearMessages = useAuthStore((s) => s.clearMessages)

  const [mode, setMode] = useState<'password' | 'link'>('password')
  const [isNew, setIsNew] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'link') await magicLink(email)
      else if (isNew) await signUp(email, password)
      else await signIn(email, password)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-ink-100">Keep your progress across devices</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Your course progress, prediction record, working prompt and saved designs move with you. Everything still runs
        locally — signing in adds a backup, it does not send your work anywhere to be processed.
      </p>

      <div className="mt-3 flex gap-1" role="group" aria-label="Sign-in method">
        <button
          className={`chip ${mode === 'password' ? 'tone-info' : 'tone-neutral'}`}
          onClick={() => {
            setMode('password')
            clearMessages()
          }}
          aria-pressed={mode === 'password'}
        >
          Email + password
        </button>
        <button
          className={`chip ${mode === 'link' ? 'tone-info' : 'tone-neutral'}`}
          onClick={() => {
            setMode('link')
            clearMessages()
          }}
          aria-pressed={mode === 'link'}
        >
          Emailed link
        </button>
      </div>

      <form className="mt-3 space-y-2.5" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="account-email">
            Email
          </label>
          <input
            id="account-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {mode === 'password' && (
          <div>
            <label className="label" htmlFor="account-password">
              Password
            </label>
            <input
              id="account-password"
              className="input"
              type="password"
              autoComplete={isNew ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
        )}

        <button className="btn btn-primary w-full justify-center" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'link' ? 'Send me a link' : isNew ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {mode === 'password' && (
        <button
          className="mt-2 text-2xs text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-300"
          onClick={() => {
            setIsNew((v) => !v)
            clearMessages()
          }}
        >
          {isNew ? 'I already have an account' : 'I need an account'}
        </button>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-bad/30 bg-bad/[0.06] px-2.5 py-1.5 text-xs text-bad">
          <span aria-hidden>✕ </span>
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-2 rounded-md border border-good/30 bg-good/[0.06] px-2.5 py-1.5 text-xs text-good">
          <span aria-hidden>✓ </span>
          {notice}
        </p>
      )}
    </div>
  )
}

function SignedIn({
  email,
  sync,
  syncedAt,
  onDone,
}: {
  email: string | null
  sync: string
  syncedAt: number | null
  onDone: () => void
}) {
  const signOut = useAuthStore((s) => s.signOut)
  const syncNow = useAuthStore((s) => s.syncNow)
  const syncError = useAuthStore((s) => s.syncError)

  return (
    <div>
      <h2 className="text-sm font-semibold text-ink-100">Signed in</h2>
      <p className="mt-0.5 truncate font-mono text-xs text-ink-400">{email}</p>

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-500">Progress sync</dt>
          <dd className="flex items-center gap-1.5">
            <SyncDot sync={sync} />
            <span className="text-ink-200">
              {sync === 'syncing'
                ? 'syncing…'
                : sync === 'error'
                  ? 'failed'
                  : syncedAt
                    ? `synced ${relative(syncedAt)}`
                    : 'not yet'}
            </span>
          </dd>
        </div>
      </dl>

      {syncError && (
        <p className="mt-2 rounded-md border border-warn/30 bg-warn/[0.06] px-2.5 py-1.5 text-xs text-warn">
          <span aria-hidden>⚠ </span>
          {syncError}. Your work is safe locally — the workspace has always kept it in this browser first.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button className="btn btn-sm flex-1 justify-center" onClick={() => void syncNow()}>
          ⟳ Sync now
        </button>
        <button
          className="btn btn-sm flex-1 justify-center"
          onClick={() => {
            void signOut()
            onDone()
          }}
        >
          Sign out
        </button>
      </div>

      <p className="mt-2.5 text-2xs leading-relaxed text-ink-500">
        Signing out leaves everything in this browser untouched. It stops the copy in the cloud being updated; it does
        not take anything away from you here.
      </p>
    </div>
  )
}

function ServiceRoleWarning() {
  return (
    <div>
      <h2 className="text-sm font-semibold text-bad">
        <span aria-hidden>⚠ </span>
        That is a service-role key
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-300">
        <code className="font-mono text-ink-100">VITE_SUPABASE_ANON_KEY</code> holds a key whose JWT claims say{' '}
        <code className="font-mono">service_role</code>. Sign-in has been disabled rather than start a client with it.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">
        Every <code className="font-mono">VITE_*</code> variable is compiled into the JavaScript bundle and is readable
        by anyone who loads the page. The service-role key bypasses Row Level Security, so publishing it hands every
        visitor full read and write access to the database.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">
        Use the <b className="text-ink-200">anon / publishable</b> key from Project Settings → API, and rotate the
        service-role key — once it has been in a bundle or a chat window, treat it as compromised.
      </p>
    </div>
  )
}

function relative(at: number): string {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
