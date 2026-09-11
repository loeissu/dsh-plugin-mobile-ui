/**
 * Coexistence check: does dsh-tether's injected narrow-screen CSS override this
 * plugin's overlay?
 *
 * Why this exists: the drawer was developed against an isolated profile that had
 * only this plugin installed, so it measured 320px and looked correct. On a real
 * phone — where dsh-tether is also installed — the panel filled the viewport.
 * The two plugins never ran together in any test.
 *
 * dsh-tether rewrites the served HTML and injects a narrow-screen stylesheet.
 * One of its rules is:
 *
 *   [role="dialog"][aria-modal="true"]:not([data-dsh-tether]) {
 *     width: 100% !important;
 *     max-width: 100% !important;
 *     border-radius: 0 !important;
 *   }
 *
 * The drawer panel declared exactly that role/modal pair, so it matched and was
 * forced full-width. The rule is `!important`, so the fix is to stop matching
 * the selector rather than to out-specify it.
 *
 * This script injects tether's actual rule into a page that does NOT have tether
 * installed, reproducing the phone's condition locally. It runs before and after
 * the fix, so it is also the regression guard.
 *
 * Usage: node tools/verify-coexistence.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/verify-coexistence.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

/**
 * The subset of dsh-tether's injected narrow-screen CSS that can collide with an
 * overlay. Transcribed from its `injectNarrowScreenCss` so the check exercises
 * the real rules rather than an approximation of them.
 */
const TETHER_NARROW_CSS = `
  html, body { overflow-x: hidden; }
  [role="dialog"][aria-modal="true"]:not([data-dsh-tether]) {
    width: 100% !important;
    max-width: 100% !important;
    height: 100% !important;
    max-height: 100% !important;
    margin: 0 !important;
    border-radius: 0 !important;
  }
  [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
  [class*="rowText"] { flex: 1 1 100% !important; }
  [class*="_frame"] { grid-template-columns: 56px minmax(0, 1fr) 0px !important; }
  [class*="_frame"] > [class*="centerCol"] { grid-column: 2 !important; }
  [class*="_frame"] > [class*="rightbarCol"] { grid-column: 3 !important; }
  [class*="_frame"] > [class*="sidebarCol"] {
    position: absolute !important; top: 0; bottom: 0; left: 0;
    width: 56px !important; z-index: 30 !important;
  }
  * { -webkit-tap-highlight-color: transparent; }
`

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms) })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description)}`
  return r.result?.result?.value
}

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const MEASURE = `(() => {
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  if (!root || !panel) return JSON.stringify({ missing: true })
  const pr = panel.getBoundingClientRect()
  const cs = getComputedStyle(panel)
  return JSON.stringify({
    viewport: window.innerWidth,
    panelWidth: Math.round(pr.width),
    panelRatio: +(pr.width / window.innerWidth).toFixed(3),
    panelMaxWidth: cs.maxWidth,
    panelBorderRadius: cs.borderRadius,
    panelRole: panel.getAttribute('role'),
    frameTemplate: frame ? getComputedStyle(frame).gridTemplateColumns : 'no-frame',
    sidebarDisplay: frame ? getComputedStyle(frame.querySelector(':scope > [class*="sidebarCol"]')).display : 'n/a',
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

await evaluate(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]').click()`)
await sleep(1000)

console.log('\n== A. without tether CSS ==')
const alone = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(alone, null, 1)}`)

console.log('\n== B. with dsh-tether narrow-screen CSS injected ==')
await evaluate(`(() => {
  let tag = document.getElementById('tether-sim')
  if (!tag) { tag = document.createElement('style'); tag.id = 'tether-sim'; document.head.append(tag) }
  tag.textContent = ${JSON.stringify(TETHER_NARROW_CSS)}
  return 'injected'
})()`)
await sleep(1200)
const together = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(together, null, 1)}`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(outDir, 'coexistence.png'), Buffer.from(shot.result.data, 'base64'))
console.log('  saved coexistence.png')

// ── assertions ─────────────────────────────────────────────────────────────
console.log('\n== verdict ==')

// The panel must not fill the viewport: a full-width drawer leaves no scrim to
// tap and is what the user reported on the phone.
check(together.panelRatio <= 0.85,
  'panel keeps a scrim strip with tether CSS present',
  `ratio=${together.panelRatio} (viewport ${together.viewport}, panel ${together.panelWidth}px)`)

// The panel must not match tether's dialog selector at all — that is the actual
// defect, and ratio alone could pass by coincidence.
check(!(together.panelRole === 'dialog'),
  'panel no longer presents the role/modal pair tether forces to 100%',
  `role=${together.panelRole}`)

check(together.panelBorderRadius !== '0px',
  'panel keeps its own corner radius', `border-radius=${together.panelBorderRadius}`)

// The grid override must still beat tether's, which is lower specificity.
check(together.sidebarDisplay === 'none',
  'native sidebar stays hidden despite tether restating the template',
  `sidebar display=${together.sidebarDisplay}`)
check(/^412px 0px$/.test(together.frameTemplate) || /minmax/.test(together.frameTemplate),
  'this plugin grid override wins over tether lower-specificity rule',
  `template=${together.frameTemplate}`)

await evaluate(`(() => { const t = document.getElementById('tether-sim'); if (t) t.remove(); return 'cleaned' })()`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: the overlay coexists with dsh-tether narrow-screen CSS')
process.exit(0)
