/**
 * Walks the guided course the way a learner would and checks the thread never
 * drops: the rail is present in every step's lab, it names the right step, and
 * progress is only awarded for work actually done.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4173'
const SHOTS = process.env.SMOKE_SHOTS ?? './smoke-shots'
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const problems = []
page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} :: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console] ${page.url()} :: ${m.text()}`)
})

const COURSE = [
  [1, '/canvas'], [2, '/call'], [3, '/latency'], [4, '/vad'], [5, '/agent'],
  [6, '/telephony'], [7, '/handoff'], [8, '/scaling'], [9, '/scaling'],
  [10, '/chaos'], [11, '/cost'], [12, '/decisions'], [13, '/challenge'],
]

console.log('Course rail present and correct in every step lab:')
for (const [n, route] of COURSE) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
  const body = await page.locator('body').innerText()
  const railStep = body.match(/Step (\d+) of 13/)
  // Steps 8/9 share a lab; the rail shows the first outstanding one.
  const expected = route === '/scaling' ? 8 : n
  const ok = railStep && Number(railStep[1]) === expected
  if (!ok) problems.push(`[rail] ${route} expected "Step ${expected} of 13", got ${railStep?.[0] ?? 'no rail'}`)
  else console.log(`  ✓ ${String(n).padStart(2)} ${route.padEnd(12)} rail says "${railStep[0]}"`)
}

// Off-path labs should say so rather than looking like a missed step.
console.log('\nOff-path labs are marked as reference:')
for (const route of ['/knowledge', '/patterns', '/stt', '/webrtc']) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const body = await page.locator('body').innerText()
  const marked = body.includes('not a course step')
  const noRail = !/Step \d+ of 13/.test(body)
  if (!marked || !noRail) problems.push(`[offpath] ${route} marked=${marked} railAbsent=${noRail}`)
  else console.log(`  ✓ ${route.padEnd(12)} marked reference, no step rail`)
}

// Progress must be earned: visiting every course lab must not tick anything.
console.log('\nProgress is earned, not granted:')
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.removeItem('voice-sim:progress'))
for (const [, route] of COURSE) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
}
await page.goto(`${BASE}/#/learn`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const afterTour = await page.locator('body').innerText()
const started = !afterTour.includes('Not started')
if (started) problems.push(`[progress] visiting every lab granted progress: ${afterTour.match(/\d+ of 13[^\n]*/)?.[0]}`)
else console.log('  ✓ visiting all 13 labs granted nothing ("Not started")')

// ...but doing the work does tick a step.
await page.goto(`${BASE}/#/latency`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'All batch' }).click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: 'All streaming' }).click()
await page.waitForTimeout(500)
const afterWork = await page.locator('body').innerText()
const ticked = /✓/.test(afterWork) && !/Step 3 of 13[\s\S]{0,400}ticks itself/.test(afterWork)
await page.screenshot({ path: `${SHOTS}/course-rail-latency.png` })
await page.goto(`${BASE}/#/learn`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const learnAfter = await page.locator('body').innerText()
const earned = /1 of 13 steps done/.test(learnAfter)
if (!earned) problems.push(`[progress] comparing batch vs streaming did not complete step 3 (${learnAfter.match(/\d+ of 13[^\n]*/)?.[0] ?? 'none'})`)
else console.log('  ✓ comparing batch vs streaming completed step 3')
void ticked
await page.screenshot({ path: `${SHOTS}/course-map.png` })

// The rail's "continue" must lead to the next step.
await page.goto(`${BASE}/#/latency`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const continueLink = page.getByRole('link', { name: /Step 4/ })
const hasContinue = await continueLink.count()
if (!hasContinue) problems.push('[rail] finished step did not offer "Step 4 …" continue link')
else {
  await continueLink.first().click()
  await page.waitForTimeout(500)
  const url = page.url()
  if (!url.includes('/vad')) problems.push(`[rail] continue went to ${url}, expected /vad`)
  else console.log('  ✓ "Step 4 →" from the rail lands in the next lab')
}

await browser.close()
console.log('\n' + '='.repeat(60))
if (problems.length) {
  console.log(`FAILURES (${problems.length}):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('COURSE THREAD HOLDS END TO END')
