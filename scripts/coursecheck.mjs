/**
 * Walks the guided course the way a learner would and checks the thread never
 * drops: the rail is present in every step's lab, it names the right step, and
 * progress is only awarded for work actually done.
 *
 * V2 adds the property that matters most: an evidence step cannot be completed
 * by doing the motions. Comparing batch against streaming is now necessary but
 * not sufficient for step 3 — the learner also has to have predicted the
 * latency band correctly, before the waterfall was revealed.
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

const N = 15
const COURSE = [
  [1, '/canvas'], [2, '/call'], [3, '/latency'], [4, '/vad'], [5, '/stt'],
  [6, '/agent'], [7, '/prompt'], [8, '/quality'], [9, '/eval'],
  [10, '/telephony'], [11, '/handoff'], [12, '/scaling'], [13, '/chaos'],
  [14, '/pressure'], [15, '/challenge'],
]
const stepRe = new RegExp(`Step (\\d+) of ${N}`)

const clearProgress = () =>
  page.evaluate(() => {
    localStorage.removeItem('voice-sim:progress')
    localStorage.removeItem('voice-sim:predictions')
  })

console.log('Course rail present and correct in every step lab:')
for (const [n, route] of COURSE) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
  const body = await page.locator('body').innerText()
  const railStep = body.match(stepRe)
  const ok = railStep && Number(railStep[1]) === n
  if (!ok) problems.push(`[rail] ${route} expected "Step ${n} of ${N}", got ${railStep?.[0] ?? 'no rail'}`)
  else console.log(`  ✓ ${String(n).padStart(2)} ${route.padEnd(12)} rail says "${railStep[0]}"`)
}

// Off-path labs should say so rather than looking like a missed step.
console.log('\nOff-path labs are marked as reference:')
for (const route of ['/knowledge', '/patterns', '/cost', '/webrtc', '/decisions']) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const body = await page.locator('body').innerText()
  const marked = body.includes('not a course step')
  const noRail = !stepRe.test(body)
  if (!marked || !noRail) problems.push(`[offpath] ${route} marked=${marked} railAbsent=${noRail}`)
  else console.log(`  ✓ ${route.padEnd(12)} marked reference, no step rail`)
}

// Progress must be earned: visiting every course lab must not tick anything.
console.log('\nProgress is earned, not granted:')
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await clearProgress()
for (const [, route] of COURSE) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
}
await page.goto(`${BASE}/#/learn`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const afterTour = await page.locator('body').innerText()
if (!afterTour.includes('Not started')) {
  problems.push(`[progress] visiting every lab granted progress: ${afterTour.match(new RegExp(`\\d+ of ${N}[^\\n]*`))?.[0]}`)
} else {
  console.log(`  ✓ visiting all ${N} labs granted nothing ("Not started")`)
}

// Doing the motions on an evidence step is NOT enough.
await page.goto(`${BASE}/#/latency`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Show me without predicting' }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'All batch' }).click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: 'All streaming' }).click()
await page.waitForTimeout(500)
await page.goto(`${BASE}/#/learn`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const afterMotions = await page.locator('body').innerText()
if (!afterMotions.includes('Not started')) {
  problems.push('[evidence] comparing pipelines without predicting completed step 3 — evidence steps must need the prediction')
} else {
  console.log('  ✓ comparing batch vs streaming WITHOUT predicting still grants nothing')
}

// The gate must refuse a second attempt on the same arming: once you have seen
// the measured band, naming it is not a prediction.
await page.goto(`${BASE}/#/latency`, { waitUntil: 'networkidle' })
await page.waitForTimeout(450)
await page.getByRole('button', { name: /300–600 ms/ }).click()
await page.waitForTimeout(300)
const gate = await page.locator('body').innerText()
if (!/Matched|bands out/.test(gate)) {
  problems.push('[gate] the prediction gate did not show a comparison after committing')
} else {
  console.log('  ✓ the prediction gate compares what you said with what it measured')
}
const measured = gate.match(/It measured\s*\n?(.+)/)?.[1]?.trim()
if (!measured) {
  problems.push('[gate] the comparison did not name the measured band')
} else {
  await page.getByRole('button', { name: 'Predict again' }).click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: measured, exact: true }).click()
  await page.waitForTimeout(350)
  const retried = await page.evaluate(() => localStorage.getItem('voice-sim:progress'))
  if (retried && retried.includes('predicted:perceived-latency')) {
    problems.push('[gate] naming the band after seeing it counted as a correct prediction')
  } else {
    console.log('  ✓ naming the measured band after seeing it does NOT count as a prediction')
  }
}

// ...and a correct prediction made on a fresh arming, plus both pipelines,
// does complete the step. The harness reloads first because the gate is right
// to refuse the retry above.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: measured ?? /1–2 s/, exact: Boolean(measured) }).click()
await page.waitForTimeout(350)
await page.getByRole('button', { name: 'All batch' }).click()
await page.waitForTimeout(250)
await page.getByRole('button', { name: 'All streaming' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${SHOTS}/course-rail-latency.png` })
await page.goto(`${BASE}/#/learn`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const learnAfter = await page.locator('body').innerText()
if (!new RegExp(`1 of ${N} steps done`).test(learnAfter)) {
  problems.push(
    `[progress] a correct prediction plus both pipelines did not complete step 3 (${
      learnAfter.match(new RegExp(`\\d+ of ${N}[^\\n]*`))?.[0] ?? 'none'
    })`,
  )
} else {
  console.log('  ✓ a correct prediction plus both pipelines completed step 3')
}
await page.screenshot({ path: `${SHOTS}/course-map.png` })

// The rail's "continue" must lead to the next step.
await page.goto(`${BASE}/#/latency`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const continueLink = page.getByRole('link', { name: /Step 4/ })
if (!(await continueLink.count())) {
  problems.push('[rail] finished step did not offer "Step 4 …" continue link')
} else {
  await continueLink.first().click()
  await page.waitForTimeout(500)
  const url = page.url()
  if (!url.includes('/vad')) problems.push(`[rail] continue went to ${url}, expected /vad`)
  else console.log('  ✓ "Step 4 →" from the rail lands in the next lab')
}

// Evidence steps must advertise that they need evidence.
await page.goto(`${BASE}/#/quality`, { waitUntil: 'networkidle' })
await page.waitForTimeout(450)
const qualityBody = await page.locator('body').innerText()
if (!qualityBody.includes('needs evidence')) {
  problems.push('[evidence] an evidence step did not tell the learner it needs evidence')
} else {
  console.log('  ✓ evidence steps say so in the rail')
}

await browser.close()
console.log('\n' + '='.repeat(60))
if (problems.length) {
  console.log(`FAILURES (${problems.length}):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('COURSE THREAD HOLDS END TO END')
