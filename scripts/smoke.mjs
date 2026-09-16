/**
 * Browser smoke test: visit every route, capture console errors, click the key
 * interactions (run a call, validate an architecture, submit a challenge),
 * and screenshot a few representative labs.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4173'
const SHOTS = process.env.SMOKE_SHOTS ?? './smoke-shots'
mkdirSync(SHOTS, { recursive: true })

const ROUTES = [
  ['/', 'dashboard'], ['/learn', 'learning'], ['/scenarios', 'scenarios'],
  ['/call', 'live-call'], ['/canvas', 'canvas'], ['/patterns', 'patterns'],
  ['/audio', 'audio'], ['/latency', 'latency'], ['/vad', 'vad'],
  ['/stt', 'stt'], ['/tts', 'tts'], ['/agent', 'agent'],
  ['/state-machines', 'state-machines'], ['/telephony', 'telephony'],
  ['/websocket', 'websocket'], ['/webrtc', 'webrtc'], ['/handoff', 'handoff'],
  ['/scaling', 'scaling'], ['/chaos', 'chaos'], ['/reliability', 'reliability'],
  ['/cost', 'cost'], ['/decisions', 'decisions'], ['/compare', 'compare'],
  ['/challenge', 'challenge'], ['/observability', 'observability'], ['/knowledge', 'knowledge'],
  ['/pressure', 'pressure'], ['/prompt', 'prompt'], ['/quality', 'quality'], ['/eval', 'eval'],
]

const SCREENSHOT = new Set([
  'dashboard', 'live-call', 'canvas', 'latency', 'vad', 'scaling', 'cost', 'decisions', 'observability', 'audio',
  'pressure', 'prompt', 'quality', 'eval', 'stt',
])

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console] ${page.url()} :: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`[pageerror] ${page.url()} :: ${e.message}`))

let ok = 0
for (const [route, name] of ROUTES) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(450)
  const h1 = await page.locator('h1').first().textContent().catch(() => null)
  const bodyLen = (await page.locator('body').innerText()).length
  if (!h1 || bodyLen < 300) {
    problems.push(`[empty] ${route} rendered ${bodyLen} chars, h1=${h1}`)
  } else {
    ok++
    console.log(`  ✓ ${route.padEnd(18)} ${String(bodyLen).padStart(6)} chars  “${h1.slice(0, 46)}”`)
  }
  if (SCREENSHOT.has(name)) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

console.log(`\n${ok}/${ROUTES.length} routes rendered.`)

// ---- interaction checks --------------------------------------------------
console.log('\nInteractions:')

// 1. Live Call: run the simulation to completion.
await page.goto(`${BASE}/#/call`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Start/ }).first().click()
await page.getByRole('button', { name: /End/ }).first().click()
await page.waitForTimeout(600)
const timelineRows = await page.locator('table tbody tr').count()
const hasWaterfall = await page.getByText('Latency waterfall').isVisible().catch(() => false)
console.log(`  ✓ live call: ${timelineRows} timeline rows, waterfall visible=${hasWaterfall}`)
if (timelineRows < 10) problems.push(`[interaction] live call produced only ${timelineRows} timeline rows`)
if (!hasWaterfall) problems.push('[interaction] latency waterfall did not appear after the run')
await page.screenshot({ path: `${SHOTS}/live-call-complete.png` })

// 2. Live Call: click an event to open the inspector.
await page.locator('table tbody tr').nth(5).click()
await page.waitForTimeout(250)
const inspectorOpen = await page.getByText('Timestamp', { exact: false }).first().isVisible().catch(() => false)
console.log(`  ✓ event inspector opens: ${inspectorOpen}`)
if (!inspectorOpen) problems.push('[interaction] event inspector did not open on click')

// 3. Canvas: validate an architecture.
await page.goto(`${BASE}/#/canvas`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const nodeCount = await page.locator('.react-flow__node').count()
await page.getByRole('button', { name: /Validate architecture/ }).click()
await page.waitForTimeout(400)
const validationText = await page.locator('body').innerText()
const hasFindings = /Validation —|No findings/.test(validationText)
console.log(`  ✓ canvas: ${nodeCount} nodes rendered, validation ran=${hasFindings}`)
if (nodeCount < 5) problems.push(`[interaction] canvas rendered only ${nodeCount} nodes`)
if (!hasFindings) problems.push('[interaction] validation produced no output')
await page.screenshot({ path: `${SHOTS}/canvas-validated.png` })

// 4. Canvas: click a node to open the component inspector.
await page.locator('.react-flow__node').first().click()
await page.waitForTimeout(300)
const specInspector = await page.getByText('What problem does it solve?').isVisible().catch(() => false)
console.log(`  ✓ component inspector opens: ${specInspector}`)
if (!specInspector) problems.push('[interaction] component inspector did not open')

// 5. Chaos: arm a failure and confirm the outcome changes.
await page.goto(`${BASE}/#/chaos`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const beforeChaos = await page.locator('body').innerText()
await page.getByLabel(/Mitigations enabled/).click().catch(async () => {
  await page.getByText('Mitigations enabled', { exact: false }).click()
})
await page.waitForTimeout(500)
const afterChaos = await page.locator('body').innerText()
console.log(`  ✓ chaos lab reacts to mitigation toggle: ${beforeChaos !== afterChaos}`)
if (beforeChaos === afterChaos) problems.push('[interaction] chaos lab did not react to toggling mitigations')
await page.screenshot({ path: `${SHOTS}/chaos.png` })

// 6. Challenge: generate, answer and submit.
await page.goto(`${BASE}/#/challenge`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: /Start designing/ }).click()
await page.waitForTimeout(300)
const optionButtons = page.locator('button').filter({ hasText: /Managed telephony|Streaming: STT partials|Redis, written/ })
const n = await optionButtons.count()
for (let i = 0; i < Math.min(n, 3); i++) await optionButtons.nth(i).click()
await page.getByRole('button', { name: /Submit design/ }).click()
await page.waitForTimeout(700)
const evaluated = await page.getByText('Evaluation of your architecture').isVisible().catch(() => false)
console.log(`  ✓ challenge submit produces an evaluation: ${evaluated}`)
if (!evaluated) problems.push('[interaction] challenge evaluation did not render')
await page.screenshot({ path: `${SHOTS}/challenge.png`, fullPage: false })

// 7. Latency lab: toggling batch/streaming changes the number.
await page.goto(`${BASE}/#/latency`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const streamingText = await page.locator('body').innerText()
await page.getByRole('button', { name: 'All batch' }).click()
await page.waitForTimeout(400)
const batchText = await page.locator('body').innerText()
console.log(`  ✓ latency lab recomputes on mode change: ${streamingText !== batchText}`)
if (streamingText === batchText) problems.push('[interaction] latency lab did not recompute')

// 8. Scaling lab: switch tabs.
await page.goto(`${BASE}/#/scaling`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
for (const tab of ['Long-lived connections', 'Autoscaling', 'Multi-region']) {
  await page.getByRole('button', { name: tab }).click()
  await page.waitForTimeout(500)
  const len = (await page.locator('body').innerText()).length
  if (len < 500) problems.push(`[interaction] scaling tab "${tab}" rendered ${len} chars`)
  console.log(`  ✓ scaling tab "${tab}": ${len} chars`)
}
await page.screenshot({ path: `${SHOTS}/scaling-regions.png` })

// 9. Knowledge base search.
await page.goto(`${BASE}/#/knowledge`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.locator('input[placeholder*="Search concepts"]').fill('jitter')
await page.waitForTimeout(300)
const results = await page.locator('button').filter({ hasText: /Jitter buffer/ }).count()
console.log(`  ✓ knowledge search finds "jitter": ${results > 0}`)
if (results === 0) problems.push('[interaction] knowledge base search returned nothing for "jitter"')

// 10. Prediction gate: results stay hidden until you commit to an answer.
await page.goto(`${BASE}/#/pressure`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const gated = await page.locator('body').innerText()
if (/What survives this/.test(gated)) problems.push('[gate] pressure findings were visible before predicting')
await page.getByRole('button', { name: /Breaks — it needs a structural change/ }).click()
await page.waitForTimeout(450)
const revealed = await page.locator('body').innerText()
const hasPressureFindings = /What survives this/.test(revealed) && /(Matched|bands out)/.test(revealed)
console.log(`  ✓ pressure gate hides findings until predicted, then reveals: ${hasPressureFindings}`)
if (!hasPressureFindings) problems.push('[gate] pressure findings did not appear after predicting')
await page.screenshot({ path: `${SHOTS}/pressure-findings.png` })

// 11. Pressure: run the whole suite and get a verdict spread.
await page.getByRole('button', { name: /Run every test against this design/ }).click()
await page.waitForTimeout(700)
const suite = await page.locator('body').innerText()
const spread = /(\d+) hold[\s\S]*?(\d+) degrade[\s\S]*?(\d+) break/.test(suite)
console.log(`  ✓ full pressure suite reports a verdict spread: ${spread}`)
if (!spread) problems.push('[interaction] running every pressure test produced no summary')

// 12. Compliance tab.
await page.getByRole('button', { name: 'Data exposure' }).click()
await page.waitForTimeout(500)
const exposure = await page.locator('body').innerText()
const compliant = exposure.includes('not legal') && /external processor/.test(exposure)
console.log(`  ✓ data-exposure tab lists processors and disclaims advice: ${compliant}`)
if (!compliant) problems.push('[interaction] data-exposure tab missing disclaimer or findings')

// 13. Prompt lab: changing a section moves the token cost and the projection.
await page.goto(`${BASE}/#/prompt`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const beforePrompt = await page.locator('body').innerText()
await page.getByRole('button', { name: /Explicit spoken-output rules/ }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Mandatory read-back of identifiers/ }).click()
await page.waitForTimeout(400)
const afterPrompt = await page.locator('body').innerText()
if (beforePrompt === afterPrompt) problems.push('[interaction] prompt lab did not react to section changes')
else console.log('  ✓ prompt lab recomputes tokens and projected failures on edit')
await page.screenshot({ path: `${SHOTS}/prompt-built.png` })

// 14. Quality lab: predicting reveals the twelve turns, each with a verdict.
await page.goto(`${BASE}/#/quality`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: /5–15% of turns go wrong/ }).click()
await page.waitForTimeout(500)
const turns = await page.locator('body').innerText()
const hasTurns = /The twelve turns/.test(turns) && /Expected failure rate/.test(turns)
console.log(`  ✓ quality lab reveals twelve turns after a prediction: ${hasTurns}`)
if (!hasTurns) problems.push('[interaction] quality lab did not show the case list')
await page.screenshot({ path: `${SHOTS}/quality-run.png` })

// 15. Eval lab: the seed sweep renders per-seed results.
await page.goto(`${BASE}/#/eval`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Seed sweep' }).click()
await page.waitForTimeout(600)
const sweep = await page.locator('body').innerText()
const hasSweep = /Mean pass rate/.test(sweep) && /Seed-to-seed spread/.test(sweep)
console.log(`  ✓ evaluation seed sweep reports mean and spread: ${hasSweep}`)
if (!hasSweep) problems.push('[interaction] eval seed sweep did not render')
await page.screenshot({ path: `${SHOTS}/eval-sweep.png` })

// 16. Canvas inspector: the what-if removal analysis.
await page.goto(`${BASE}/#/canvas`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('.react-flow__node').first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /What if this were not here/ }).click()
await page.waitForTimeout(400)
const whatIf = await page.locator('body').innerText()
const hasWhatIf = /What stops working/.test(whatIf) && /What genuinely improves/.test(whatIf)
console.log(`  ✓ inspector explains what a component was for, by removing it: ${hasWhatIf}`)
if (!hasWhatIf) problems.push('[interaction] what-if removal analysis did not open')

// 17. Speech lab: the multilingual section is present and reacts.
await page.goto(`${BASE}/#/stt`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const beforeLang = await page.locator('body').innerText()
if (!/Two languages, one sentence/.test(beforeLang)) {
  problems.push('[interaction] multilingual section missing from the speech lab')
} else {
  await page.getByRole('switch', { name: /Recogniser trained on the mixed variety/ }).click()
  await page.waitForTimeout(400)
  const afterLang = await page.locator('body').innerText()
  if (beforeLang === afterLang) problems.push('[interaction] code-switch handling toggle changed nothing')
  else console.log('  ✓ code-switch handling changes the recognition error rate')
}

// 18. The promise: with no Supabase configured, sign-in does not exist and
// nothing about the workspace changes. This is the default mode, and the whole
// suite above has been running in it.
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const signInButtons = await page.getByRole('button', { name: /Sign in to sync|key misconfigured/ }).count()
if (signInButtons !== 0) {
  problems.push('[auth] a sign-in control appeared with no Supabase environment configured')
} else {
  console.log('  ✓ unconfigured: no sign-in control, workspace unchanged')
}

await browser.close()

console.log('\n' + '='.repeat(60))
if (problems.length) {
  console.log(`FAILURES (${problems.length}):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('ALL BROWSER CHECKS PASSED')
