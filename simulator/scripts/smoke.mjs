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

await browser.close()

console.log('\n' + '='.repeat(60))
if (problems.length) {
  console.log(`FAILURES (${problems.length}):`)
  for (const p of problems) console.log('  ✗ ' + p)
  process.exit(1)
}
console.log('ALL BROWSER CHECKS PASSED')
