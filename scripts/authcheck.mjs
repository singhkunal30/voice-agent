/**
 * Verifies the three Supabase configurations in a real browser, against real
 * production bundles.
 *
 *   1. unconfigured     → no sign-in control at all, workspace unchanged
 *   2. anon key         → sign-in appears and the panel opens
 *   3. service-role key → the client refuses to start, and says why
 *
 * Case 3 is why this script exists. It is the highest-stakes line in the
 * feature — a service-role key in a frontend bundle publishes full database
 * access to every visitor — and a guard nobody has watched fire is a guard you
 * do not have. `looksLikeServiceRoleKey` is unit-tested; this checks that the
 * refusal reaches the screen with an explanation on it.
 *
 * The keys below are synthetic: unsigned JWTs carrying the right claims and a
 * nonsense signature. They authenticate nothing, anywhere.
 *
 * No network is needed and no server is spawned — `dist/` is served from this
 * process. `createClient` does not call out, and `getSession()` against an
 * empty localStorage resolves locally.
 *
 *   npm run authcheck
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const PORT = 4175
const DIST = 'dist'
const ENV_FILE = '.env.local'
const BACKUP = '.env.local.authcheck-backup'

/** An unsigned JWT with the given claims. Signs nothing, proves nothing. */
const fakeJwt = (claims) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'authcheck', ...claims })).toString('base64url'),
    'not-a-real-signature',
  ].join('.')

const CASES = [
  {
    name: 'unconfigured',
    env: null,
    expect: { signIn: false, warning: false },
    because: 'the default: no account, no network, nothing about the workspace changes',
  },
  {
    name: 'anon key',
    env: {
      VITE_SUPABASE_URL: 'https://authcheck.supabase.co',
      VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }),
    },
    expect: { signIn: true, warning: false },
    because: 'sign-in becomes available',
  },
  {
    name: 'service-role key',
    env: {
      VITE_SUPABASE_URL: 'https://authcheck.supabase.co',
      VITE_SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role' }),
    },
    expect: { signIn: false, warning: true },
    because: 'the client must refuse to start, loudly',
  },
]

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** A static server for dist/, in-process — no subprocess to leak or to kill. */
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const file = join(DIST, path === '/' ? 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    // Hash routing means every path that is not a file is the shell.
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(await readFile(join(DIST, 'index.html')))
  }
})

const problems = []

if (existsSync(ENV_FILE)) renameSync(ENV_FILE, BACKUP)
await new Promise((resolve) => server.listen(PORT, resolve))
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})

try {
  for (const testCase of CASES) {
    if (testCase.env) {
      writeFileSync(
        ENV_FILE,
        Object.entries(testCase.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') + '\n',
      )
    } else {
      rmSync(ENV_FILE, { force: true })
    }
    execSync('npx vite build', { stdio: 'pipe' })

    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
    await page.goto(`http://localhost:${PORT}/#/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)

    const signIn = (await page.getByRole('button', { name: 'Sign in to sync' }).count()) > 0
    const warning = (await page.getByRole('button', { name: /key misconfigured/ }).count()) > 0

    if (signIn !== testCase.expect.signIn || warning !== testCase.expect.warning) {
      problems.push(
        `[${testCase.name}] expected signIn=${testCase.expect.signIn} warning=${testCase.expect.warning}, got signIn=${signIn} warning=${warning}`,
      )
    } else {
      console.log(`  ✓ ${testCase.name.padEnd(18)} ${testCase.because}`)
    }

    // The signed-out panel has to actually open, not merely exist.
    if (signIn) {
      await page.getByRole('button', { name: 'Sign in to sync' }).click()
      await page.waitForTimeout(300)
      const body = await page.locator('body').innerText()
      if (!/Keep your progress across devices/.test(body) || !/Emailed link/.test(body)) {
        problems.push('[anon key] the sign-in panel did not open with both methods')
      } else {
        console.log('  ✓ the panel offers both password and emailed-link sign-in')
      }
    }

    // And the refusal has to explain the mistake, not merely flag it.
    if (warning) {
      await page.getByRole('button', { name: /key misconfigured/ }).click()
      await page.waitForTimeout(300)
      const body = await page.locator('body').innerText()
      if (!/service-role key/i.test(body) || !/Row Level Security/i.test(body) || !/rotate/i.test(body)) {
        problems.push('[service-role key] the warning did not explain the risk or the remedy')
      } else {
        console.log('  ✓ it names the risk, the correct key, and says to rotate')
      }
    }

    await page.close()
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
  rmSync(ENV_FILE, { force: true })
  if (existsSync(BACKUP)) renameSync(BACKUP, ENV_FILE)
  // Leave dist/ matching the committed configuration rather than the last case.
  execSync('npx vite build', { stdio: 'pipe' })
}

console.log('\n' + '='.repeat(60))
if (problems.length) {
  console.log(`FAILURES (${problems.length}):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('ALL THREE SUPABASE CONFIGURATIONS BEHAVE AS DESIGNED')
