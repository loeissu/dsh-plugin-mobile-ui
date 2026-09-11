/**
 * Why does the composer stop rising when a message is queued?
 *
 * The report is conditional: with queued content the input bar stays put when the
 * keyboard opens. Earlier geometry work proved the composer DOES follow a shorter
 * frame (frame 915 -> 500 moved the card bottom to exactly 500), but that was
 * measured with an EMPTY queue. If the condition matters, something about the
 * taller composer stack changes the outcome.
 *
 * So this reproduces both states in one run, in the environment that has tether
 * and a real queued message:
 *
 *   - the queue row is present (agent running, message queued), measured as-is;
 *   - then the same measurement with the queue row hidden, as the comparison.
 *
 * `visualViewport` is replaced before page scripts run, so the plugin binds to the
 * controlled object at apply time. `innerHeight` is pinned because this shell does
 * NOT resize the layout viewport for the IME — that is the whole reason the
 * keyboard-fit script exists.
 *
 * Usage: node tools/probe-queue-keyboard.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/probe-queue-keyboard.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

const LAYOUT_H = 915
const KEYBOARD_VV = 500

// The layout viewport never shrinks for the keyboard here; only the visual
// viewport does. That asymmetry is what the plugin keys on.
const MOCK = `
(() => {
  let layoutHeight = ${LAYOUT_H}
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
    set(height, offsetTop) {
      state.height = height
      state.offsetTop = offsetTop === undefined ? 0 : offsetTop
      for (const fn of listeners.resize || []) fn()
    },
    count() { return (listeners.resize || []).length },
  }
})()
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

/**
 * Everything that decides whether the composer is above the keyboard.
 *
 * `stackPosition` matters: if the composer stack is out of normal flow, shrinking
 * the frame would not move it, which is the shape of the reported symptom.
 */
const MEASURE = `(() => {
  const de = document.documentElement
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const stack = document.querySelector('[class*="composerStack"]')
  const dock = document.querySelector('[data-slot="conversation.input.dock"]')
  const queueRow = dock ? dock.querySelector('li') : null
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  let card = ta
  while (card && !(card.className || '').toString().includes('_root')) card = card.parentElement
  const conv = [...document.querySelectorAll('*')].find((e) => {
    const s = getComputedStyle(e)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 40
      && e.closest('[class*="composerStack"]') === null
  })
  const box = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
      position: cs.position, flex: cs.flex, overflow: cs.overflowY,
    }
  }
  return JSON.stringify({
    viewportH: window.innerHeight,
    vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    varHeight: de.style.getPropertyValue('--dsh-mobile-vv-height') || '(unset)',
    frame: box(frame),
    stack: box(stack),
    queueRow: box(queueRow),
    composerCard: box(card),
    conv: conv ? { h: conv.clientHeight, scrollH: conv.scrollHeight } : null,
    keyboardTop: window.visualViewport ? Math.round(window.visualViewport.height) : null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: LAYOUT_H, deviceScaleFactor: 2, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(10000)

console.log(`\nlisteners bound by the plugin: ${await evaluate(`globalThis.__vv ? globalThis.__vv.count() : 'no mock'`)}`)

// Open the running session, which is where the queue lives.
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(2000)
await evaluate(`(() => { const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]; if (rs[0]) rs[0].click(); return 'ok' })()`)
await sleep(9000)

const hasQueue = await evaluate(`document.querySelector('[data-slot="conversation.input.dock"] li') !== null`)
console.log(`queued row present: ${hasQueue}`)

// ── case 1: queue present, keyboard closed ─────────────────────────────────
console.log('\n== 1. QUEUE PRESENT, keyboard closed ==')
const q1 = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(q1, null, 1)}`)
await shoot('01-queue-kb-closed')

// ── case 2: queue present, keyboard OPEN ───────────────────────────────────
console.log('\n== 2. QUEUE PRESENT, keyboard open (vv 915 -> 500) ==')
await evaluate(`globalThis.__vv.set(${KEYBOARD_VV})`)
await sleep(1200)
const q2 = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(q2, null, 1)}`)
await shoot('02-queue-kb-open')

console.log('\n== verdict: with the queue present ==')
console.log(`  frame   : ${q1.frame.h} -> ${q2.frame.h}`)
console.log(`  stack   : top ${q1.stack.top} -> ${q2.stack.top}   bottom ${q1.stack.bottom} -> ${q2.stack.bottom}`)
console.log(`  card    : bottom ${q1.composerCard.bottom} -> ${q2.composerCard.bottom}`)
console.log(`  queueRow: bottom ${q1.queueRow?.bottom} -> ${q2.queueRow?.bottom}`)
const rose = q2.composerCard.bottom <= KEYBOARD_VV + 8
console.log(`  keyboard top = ${KEYBOARD_VV}`)
console.log(`  ${rose ? 'ROSE' : 'DID NOT ROSE'}: composer card bottom is ${q2.composerCard.bottom} vs keyboard top ${KEYBOARD_VV}`)

// ── case 3: the same, with the queue row hidden, as the control ────────────
console.log('\n== 3. CONTROL: queue row hidden, keyboard still open ==')
await evaluate(`(() => {
  const dock = document.querySelector('[data-slot="conversation.input.dock"]')
  if (dock) dock.style.display = 'none'
  return 'hidden'
})()`)
await sleep(800)
const q3 = JSON.parse(await evaluate(MEASURE))
console.log(`  frame   : ${q3.frame.h}`)
console.log(`  stack   : top ${q3.stack.top}   bottom ${q3.stack.bottom}`)
console.log(`  card    : bottom ${q3.composerCard.bottom}`)
await shoot('03-noqueue-kb-open')

console.log('\n== comparison ==')
console.log(`  WITH queue, keyboard open : card bottom ${q2.composerCard.bottom}, stack bottom ${q2.stack.bottom}`)
console.log(`  WITHOUT queue, kb open    : card bottom ${q3.composerCard.bottom}, stack bottom ${q3.stack.bottom}`)
if (q3.composerCard.bottom < q2.composerCard.bottom - 8) {
  console.log(`  => the queue row is what pushes the composer down by ${q2.composerCard.bottom - q3.composerCard.bottom}px`)
} else {
  console.log('  => the queue row does not change the outcome')
}

// Restore.
await evaluate(`(() => {
  const dock = document.querySelector('[data-slot="conversation.input.dock"]')
  if (dock) dock.style.display = ''
  globalThis.__vv.set(${LAYOUT_H})
  return 'restored'
})()`)

ws.close()
process.exit(0)
