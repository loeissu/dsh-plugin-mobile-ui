/**
 * Focused rotation-debug for keyboard-fit.
 * Usage: node tools/probe-rotate-debug.mjs <app-url-with-token>
 */
const appUrl = process.argv[2]
const cdpBase = 'http://127.0.0.1:9222'
const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
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
    set(height, offsetTop, width) {
      state.height = height
      state.offsetTop = offsetTop === undefined ? 0 : offsetTop
      if (width !== undefined) state.width = width
      for (const fn of listeners.resize || []) fn()
    },
    rotate(newWidth, newHeight) {
      layoutHeight = newHeight
      state.height = newHeight
      state.width = newWidth
      state.offsetTop = 0
      console.log('[mock] rotate', { newWidth, newHeight, stateWidth: state.width, layoutHeight })
      for (const fn of listeners.resize || []) fn()
    },
    snap() {
      return {
        innerH: window.innerHeight,
        innerW: window.innerWidth,
        vvH: Math.round(mock.height),
        vvW: mock.width,
        varH: document.documentElement.style.getPropertyValue('--dsh-mobile-vv-height') || null,
      }
    },
  }
})()
`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

console.log('baseline', await evaluate(`JSON.stringify(globalThis.__vv.snap())`))
await evaluate(`globalThis.__vv.set(500)`)
await sleep(400)
console.log('kb open', await evaluate(`JSON.stringify(globalThis.__vv.snap())`))
await evaluate(`globalThis.__vv.set(915)`)
await sleep(400)
console.log('kb closed', await evaluate(`JSON.stringify(globalThis.__vv.snap())`))

console.log('rotating…')
await evaluate(`globalThis.__vv.rotate(915, 412)`)
await sleep(500)
console.log('after rotate', await evaluate(`JSON.stringify(globalThis.__vv.snap())`))

// Manually recompute what plugin should see
console.log('manual', await evaluate(`JSON.stringify({
  covered: window.innerHeight - window.visualViewport.height,
  vvW: window.visualViewport.width,
  innerW: window.innerWidth,
})`))

ws.close()
process.exit(0)
