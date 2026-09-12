/**
 * Simulate the cold-page first-focus lag: focus fires before the IME shrinks
 * visualViewport, and no resize event is delivered. The focus poll must still
 * engage once the mock height drops.
 *
 * Usage: node tools/verify-keyboard-focus-poll.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/verify-keyboard-focus-poll.mjs <url>')
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]

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

const MOCK = `
(() => {
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
    /** Change height WITHOUT firing listeners — models a silent IME. */
    setSilent(height) { state.height = height },
    set(height) {
      state.height = height
      for (const fn of listeners.resize || []) fn()
    },
    listenerCount() { return (listeners.resize || []).length },
  }
})()
`

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const STATE = `(() => {
  const de = document.documentElement
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  return JSON.stringify({
    varH: de.style.getPropertyValue('--dsh-mobile-vv-height') || null,
    frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
    vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    innerH: window.innerHeight,
    hasTa: ta !== null,
    focused: document.activeElement === ta,
  })
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1000)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  await clickSession(evaluate, 0)
  await sleep(4000)
}

console.log('listeners', await evaluate(`globalThis.__vv.listenerCount()`))
const base = JSON.parse(await evaluate(STATE))
console.log('baseline', base)
check(base.varH === null, 'no override at rest')

// Focus the composer, then shrink visualViewport SILENTLY (no resize event).
// Without a focus poll this is the exact cold-page failure mode.
console.log('\n== focus, then silent IME shrink (no resize event) ==')
await evaluate(`(() => {
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  if (ta) ta.focus()
  return document.activeElement && document.activeElement.tagName
})()`)
await sleep(50)
await evaluate(`globalThis.__vv.setSilent(500)`)
// Wait past the poll interval (120ms) plus a couple of samples.
await sleep(450)
const after = JSON.parse(await evaluate(STATE))
console.log('after silent shrink', after)
check(after.varH === '500px', 'focus poll engaged despite silent IME', `var=${after.varH}`)
check(after.frameH === 500, 'frame followed silent shrink', `frame=${after.frameH}`)

// Close IME silently; poll / focusout path must release.
console.log('\n== silent IME close ==')
await evaluate(`(() => { const ta = document.activeElement; if (ta && ta.blur) ta.blur(); return 'blurred' })()`)
await evaluate(`globalThis.__vv.setSilent(915)`)
await sleep(400)
const closed = JSON.parse(await evaluate(STATE))
console.log('after silent close', closed)
check(closed.varH === null, 'released after silent close', `var=${closed.varH}`)

console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: first-focus / silent-IME path is covered by the focus poll')
process.exit(0)
