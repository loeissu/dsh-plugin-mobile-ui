/**
 * Verify the keyboard-fit mitigation without a device.
 *
 * The real question — "does Android WebView report the keyboard through
 * `visualViewport`?" — cannot be answered here. What can be answered is whether
 * this plugin's half is correct: given a shrinking visual viewport, does the app
 * frame follow it, does the composer clear the keyboard, does it restore, and
 * does the threshold ignore small changes.
 *
 * `window.visualViewport` is replaced before any page script runs, so the plugin
 * binds to the controlled object during its own `apply`. The mock then stands in
 * for the keyboard: shrinking it is exactly the signal the plugin consumes.
 *
 * Usage: node tools/verify-keyboard-fit.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/verify-keyboard-fit.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

/**
 * Replaces `window.visualViewport` with a controllable stand-in and exposes
 * `__vv.set(height, offsetTop, width)` to drive it. Installed at document start
 * so the plugin's `apply` observes it.
 *
 * The plugin compares `window.innerHeight` against the visual viewport height,
 * so `innerHeight` is pinned to a fixed layout-viewport size. That models this
 * app's actual condition — the window does NOT resize for the IME, so the layout
 * viewport stays at full height while the visual viewport shrinks. Driving
 * `innerHeight` instead would model `adjustResize`, which is the other branch.
 */
const MOCK = `
(() => {
  // The layout viewport height. It does NOT shrink for the keyboard — that is
  // this shell's condition — but it DOES change on rotation, because rotation
  // resizes the window itself. Modelling it as permanently fixed would make a
  // rotation look like a 500px keyboard.
  let layoutHeight = 915
  const listeners = { resize: [], scroll: [] }
  const state = { height: layoutHeight, offsetTop: 0, width: 412, scale: 1 }
  Object.defineProperty(window, 'innerHeight', { get: () => layoutHeight, configurable: true })
  const mock = {
    get height() { return state.height },
    get offsetTop() { return state.offsetTop },
    get width() { return state.width },
    get scale() { return state.scale },
    get pageTop() { return 0 },
    get pageLeft() { return 0 },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) },
    removeEventListener(type, fn) {
      const at = (listeners[type] || []).indexOf(fn)
      if (at !== -1) listeners[type].splice(at, 1)
    },
  }
  Object.defineProperty(window, 'visualViewport', { get: () => mock, configurable: true })
  globalThis.__vv = {
    /** Open or close the keyboard: the visual viewport shrinks, the window does not. */
    set(height, offsetTop, width) {
      state.height = height
      state.offsetTop = offsetTop === undefined ? 0 : offsetTop
      if (width !== undefined) state.width = width
      for (const fn of listeners.resize || []) fn()
    },
    /** Rotate: the window resizes, so BOTH viewports take the new height. */
    rotate(newWidth, newHeight) {
      layoutHeight = newHeight
      state.height = newHeight
      state.width = newWidth
      state.offsetTop = 0
      for (const fn of listeners.resize || []) fn()
    },
    listenerCount() { return (listeners.resize || []).length },
  }
})()
`

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const errors = []
let nextId = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 240))
  }
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

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

/** Where the composer sits and how tall the scroll area is. */
const STATE = `(() => {
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  const de = document.documentElement
  let card = ta
  while (card && !(card.className || '').toString().includes('_root')) card = card.parentElement
  return JSON.stringify({
    viewportH: window.innerHeight,
    vvHeight: window.visualViewport ? window.visualViewport.height : null,
    vvWidth: window.visualViewport ? window.visualViewport.width : null,
    varHeight: de.style.getPropertyValue('--dsh-mobile-vv-height') || null,
    varTop: de.style.getPropertyValue('--dsh-mobile-vv-top') || null,
    frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
    composerCardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
    hasComposer: ta !== null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Open a session so a composer exists.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  await sleep(5000)
}

const listeners = await evaluate(`globalThis.__vv ? globalThis.__vv.listenerCount() : 'no mock'`)
console.log(`\nmock installed, resize listeners bound by the plugin: ${listeners}`)
check(typeof listeners === 'number' && listeners > 0,
  'plugin bound to the visual viewport', `listeners=${listeners}`)

// ── A. baseline ────────────────────────────────────────────────────────────
console.log('\n== A. baseline (no keyboard) ==')
const base = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(base, null, 1)}`)
check(base.hasComposer, 'a composer exists to measure')
check(base.varHeight === null, 'no height override at rest', `var=${base.varHeight}`)
check(base.frameH === 915, 'frame is the full viewport at rest', `${base.frameH}px`)

// ── B. keyboard opens ──────────────────────────────────────────────────────
console.log('\n== B. keyboard open (visual viewport 915 -> 500) ==')
await evaluate(`globalThis.__vv.set(500)`)
await sleep(900)
const open = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(open, null, 1)}`)
check(open.varHeight === '500px', 'height override applied', `var=${open.varHeight}`)
check(open.frameH === 500, 'frame followed the visual viewport', `${open.frameH}px`)
check(open.composerCardBottom !== null && open.composerCardBottom <= 505,
  'composer clears the keyboard', `card bottom=${open.composerCardBottom} (keyboard top=500)`)
await shoot('01-keyboard-open')

// ── C. keyboard closes ─────────────────────────────────────────────────────
console.log('\n== C. keyboard closed (500 -> 915) ==')
await evaluate(`globalThis.__vv.set(915)`)
await sleep(900)
const closed = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(closed, null, 1)}`)
check(closed.varHeight === null, 'height override removed', `var=${closed.varHeight}`)
check(closed.frameH === 915, 'frame restored', `${closed.frameH}px`)
check(closed.composerCardBottom === base.composerCardBottom,
  'composer returned to its original position',
  `${base.composerCardBottom} -> ${closed.composerCardBottom}`)
await shoot('02-keyboard-closed')

// ── D. small change must not trigger ───────────────────────────────────────
console.log('\n== D. small shrink (915 -> 900, 15px) must be ignored ==')
await evaluate(`globalThis.__vv.set(900)`)
await sleep(700)
const jitter = JSON.parse(await evaluate(STATE))
console.log(`  var=${jitter.varHeight}  frame=${jitter.frameH}`)
check(jitter.varHeight === null, 'below-threshold shrink ignored', `var=${jitter.varHeight}`)
await evaluate(`globalThis.__vv.set(915)`)
await sleep(400)

// ── E. panned viewport (offset, same height) ───────────────────────────────
console.log('\n== E. panned viewport (offsetTop 300, height 500) ==')
await evaluate(`globalThis.__vv.set(500, 300)`)
await sleep(900)
const panned = JSON.parse(await evaluate(STATE))
console.log(`  varTop=${panned.varTop}  frame=${panned.frameH}`)
check(panned.varTop === '300px', 'offset tracked', `var=${panned.varTop}`)
await evaluate(`globalThis.__vv.set(915, 0)`)
await sleep(500)

// ── F. rotation must not read as a keyboard ────────────────────────────────
// A rotation resizes the window, so the layout viewport and the visual viewport
// move together and their difference stays near zero. A keyboard moves only the
// visual viewport. That difference is what separates the two cases.
console.log('\n== F. rotation (412x915 -> 915x412, both viewports resize) ==')
await evaluate(`globalThis.__vv.rotate(915, 412)`)
await sleep(900)
const rotated = JSON.parse(await evaluate(STATE))
console.log(`  var=${rotated.varHeight}  frame=${rotated.frameH}  vv=${rotated.vvHeight}  inner=${rotated.viewportH}`)
check(rotated.varHeight === null,
  'rotation is not mistaken for a keyboard',
  `var=${rotated.varHeight} (frame ${rotated.frameH})`)
// And a keyboard AFTER a rotation must still engage, against the new geometry.
await evaluate(`globalThis.__vv.set(200)`)
await sleep(700)
const rotatedKb = JSON.parse(await evaluate(STATE))
console.log(`  after rotation, keyboard: var=${rotatedKb.varHeight}  frame=${rotatedKb.frameH}`)
check(rotatedKb.varHeight === '200px',
  'keyboard still detected after a rotation',
  `var=${rotatedKb.varHeight}`)
await evaluate(`globalThis.__vv.rotate(412, 915)`)
await sleep(500)

// ── G. exceptions ──────────────────────────────────────────────────────────
console.log('\n== G. exceptions ==')
const real = errors.filter((e) => !/ResizeObserver/i.test(e))
console.log(real.length === 0 ? '  none' : real.map((e) => `  ${e}`).join('\n'))
check(real.length === 0, 'no page exceptions', real.slice(0, 2).join(' | '))

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: keyboard-fit logic tracks the visual viewport correctly')
process.exit(0)
