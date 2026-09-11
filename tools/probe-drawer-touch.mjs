/**
 * Dark mode, short viewport, tether CSS present, and REAL touch scrolling.
 *
 * Every previous drawer measurement was light-mode, at 915px, with programmatic
 * `scrollTop`, and without tether installed. That is four differences from the
 * phone, any one of which could hide the reported problems, so this probe closes
 * all four:
 *
 *  - `prefers-color-scheme: dark`, because the report is a dark-mode screenshot
 *    and every token this plugin draws comes from the host theme.
 *  - a 560px viewport, since the Tether shell takes a strip of the phone's height
 *    and 8 sessions fit exactly in 915px (which is why overflow was never seen).
 *  - tether's real narrow-screen rules injected, because that is the condition on
 *    the device and the blind spot that already hid one real defect.
 *  - `Input.synthesizeScrollGesture`, i.e. a genuine touch drag. Programmatic
 *    `scrollTop` proves the container CAN scroll; it says nothing about whether a
 *    finger can, and `overscroll-behavior`, `touch-action` and the click-through
 *    overlay layer all sit between the two.
 *
 * It also reports whether the list has anything to scroll at all, so "it does not
 * scroll" can be told apart from "there is nothing to scroll".
 *
 * Usage: node tools/probe-drawer-touch.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/probe-drawer-touch.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

/** tether's narrow-screen rules, transcribed from its injectNarrowScreenCss. */
const TETHER_NARROW_CSS = `
  html, body { overflow-x: hidden; }
  [role="dialog"][aria-modal="true"]:not([data-dsh-tether]) {
    width: 100% !important; max-width: 100% !important;
    height: 100% !important; max-height: 100% !important;
    margin: 0 !important; border-radius: 0 !important;
  }
  [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
  [class*="rowText"] { flex: 1 1 100% !important; }
  [class*="_frame"] { grid-template-columns: 56px minmax(0, 1fr) 0px !important; }
  [class*="_frame"] > [class*="centerCol"] { grid-column: 2 !important; }
  [class*="_frame"] > [class*="rightbarCol"] { grid-column: 3 !important; }
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
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(s.result.data, 'base64'))
  console.log(`  saved ${name}.png`)
}

const STATE = `(() => {
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const body = panel ? panel.querySelector('.dsh-mobile-drawer-body') : null
  const fade = document.querySelector('[data-dsh-mobile-ui="drawer-more"]')
  const de = document.documentElement
  const cs = body ? getComputedStyle(body) : null
  return JSON.stringify({
    theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
    panelH: panel ? Math.round(panel.getBoundingClientRect().height) : null,
    bodyClientH: body ? body.clientHeight : null,
    bodyScrollH: body ? body.scrollHeight : null,
    overflowPx: body ? Math.max(0, body.scrollHeight - body.clientHeight) : null,
    scrollTop: body ? Math.round(body.scrollTop) : null,
    fadeShown: fade !== null,
    overscroll: cs ? cs.overscrollBehaviorY : null,
    touchAction: cs ? cs.touchAction : null,
    pointerEvents: cs ? cs.pointerEvents : null,
    varHeight: de.style.getPropertyValue('--dsh-mobile-vv-height') || '(unset)',
    labelBg: (() => {
      const l = panel ? panel.querySelector('.dsh-mobile-drawer-label') : null
      return l ? getComputedStyle(l).backgroundColor : null
    })(),
    panelBg: panel ? getComputedStyle(panel).backgroundColor : null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
// Dark scheme, phone-sized, and shorter than the CSS default to force overflow.
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 560, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

console.log('\n== dark scheme active? ==')
console.log(await evaluate(`JSON.stringify({ dark: document.body.hasAttribute('data-ds-dark-theme'), scheme: matchMedia('(prefers-color-scheme: dark)').matches })`))

await evaluate(`(() => {
  let tag = document.getElementById('tether-sim')
  if (!tag) { tag = document.createElement('style'); tag.id = 'tether-sim'; document.head.append(tag) }
  tag.textContent = ${JSON.stringify(TETHER_NARROW_CSS)}
  return 'injected'
})()`)
await sleep(800)

// Open the drawer and wait for the panel to exist rather than assuming it did.
// An earlier run measured `panelH: null` because the click landed before the
// trigger was interactive under the injected CSS.
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
for (let i = 0; i < 20; i += 1) {
  const open = await evaluate(`document.querySelector('[data-dsh-mobile-ui="drawer-panel"]') !== null
    && document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]').getAttribute('data-open') === 'true'`)
  if (open === true) break
  await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'retry' })()`)
  await sleep(500)
}
const panelReady = await evaluate(`document.querySelector('[data-dsh-mobile-ui="drawer-panel"]') !== null`)
console.log(`  panel present: ${panelReady}`)
if (panelReady !== true) {
  console.log('  could not open the drawer under the injected CSS — see the screenshot')
  await shoot('01-dark-open')
  ws.close()
  process.exit(0)
}
await sleep(800)

console.log('\n== A. drawer open, dark, 560px, tether CSS present ==')
const a = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(a, null, 1)}`)
await shoot('01-dark-open')

// ── touch scroll: the thing never tested before ────────────────────────────
console.log('\n== B. TOUCH scroll gesture inside the drawer body ==')
const box = JSON.parse(await evaluate(`(() => {
  const body = document.querySelector('[data-dsh-mobile-ui="drawer-panel"] .dsh-mobile-drawer-body')
  const r = body.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(r.x + r.width / 2), yTop: Math.round(r.top + 20), yBottom: Math.round(r.bottom - 20) })
})()`))
console.log(`  gesture from (${box.x}, ${box.yBottom}) to (${box.x}, ${box.yTop})`)

await send('Input.synthesizeScrollGesture', {
  x: box.x,
  y: box.yBottom,
  xDistance: 0,
  // Negative yDistance scrolls the content up, i.e. reveals what is below.
  yDistance: -220,
  gestureSourceType: 'touch',
  speed: 800,
})
await sleep(1200)

const afterTouch = JSON.parse(await evaluate(STATE))
console.log(`  scrollTop after touch: ${afterTouch.scrollTop} (was ${a.scrollTop})`)
console.log(`  fade now: ${afterTouch.fadeShown}`)
await shoot('02-after-touch')

// ── is the pointer even reaching the body? ─────────────────────────────────
console.log('\n== C. what is on top at the drawer body centre? ==')
console.log(await evaluate(`(() => {
  const body = document.querySelector('[data-dsh-mobile-ui="drawer-panel"] .dsh-mobile-drawer-body')
  const r = body.getBoundingClientRect()
  const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
  return JSON.stringify({
    hitTag: hit ? hit.tagName.toLowerCase() : null,
    hitCls: hit ? (hit.className || '').toString().split(' ')[0].slice(0, 34) : null,
    insideBody: hit ? body.contains(hit) : null,
    insideDrawer: hit ? hit.closest('[data-dsh-mobile-ui="drawer-overlay"]') !== null : null,
  }, null, 1)
})()`))

// ── the composer, in dark mode, for the "打字栏怪怪的" report ──────────────
console.log('\n== D. composer area in dark mode (drawer closed) ==')
await evaluate(`(() => { const s = document.querySelector('[data-dsh-mobile-ui="drawer-scrim"]'); if (s) s.click(); return 'closed' })()`)
await sleep(1200)
console.log(await evaluate(`(() => {
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  if (!ta) return JSON.stringify({ missing: true })
  let card = ta
  while (card && !(card.className || '').toString().includes('_root')) card = card.parentElement
  const r = card.getBoundingClientRect()
  const cs = getComputedStyle(card)
  return JSON.stringify({
    cardH: Math.round(r.height),
    cardTop: Math.round(r.top),
    cardBottom: Math.round(r.bottom),
    viewportH: window.innerHeight,
    vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    varHeight: document.documentElement.style.getPropertyValue('--dsh-mobile-vv-height') || '(unset)',
    bg: cs.backgroundColor,
    radius: cs.borderRadius,
    belowViewport: Math.round(r.bottom) > window.innerHeight,
  }, null, 1)
})()`))
await shoot('03-composer-dark')

ws.close()
process.exit(0)
