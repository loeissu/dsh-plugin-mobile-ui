/**
 * Verify: tap on an already-focused composer forces a blur→focus cycle so
 * Android WebView will raise the IME.
 *
 * Note: DSH's composer is a contenteditable DIV. In headless Chromium,
 * programmatic blur()/focus() move `activeElement` but often emit no
 * focusin/focusout — so the assertion is the activeElement transition, not
 * the event log.
 *
 * Usage: node tools/verify-ime-refocus.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]

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

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
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

// Wrap blur() to count calls — activeElement sampling at 16ms misses a
// same-frame blur→rAF-focus cycle, and DSH's contenteditable emits no
// focusin/focusout for programmatic focus changes in headless Chromium.
console.log(await evaluate(`(() => {
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  if (ta) ta.focus()
  window.__blurCalls = 0
  const orig = HTMLElement.prototype.blur
  HTMLElement.prototype.blur = function (...args) {
    window.__blurCalls += 1
    return orig.apply(this, args)
  }
  window.__origBlur = orig
  return JSON.stringify({ hasTa: !!ta, focused: document.activeElement === ta })
})()`))

await sleep(50)
console.log('pre-tap', await evaluate(`JSON.stringify({
  focused: document.activeElement && document.activeElement.tagName,
  vvH: Math.round(window.visualViewport.height),
  blurCalls: window.__blurCalls,
})`))

console.log('tap', await evaluate(`(() => {
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  if (!ta) return 'no ta'
  const rect = ta.getBoundingClientRect()
  ta.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 10,
  }))
  return 'dispatched'
})()`))

await sleep(120)
const result = JSON.parse(await evaluate(`(() => {
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  return JSON.stringify({
    blurCalls: window.__blurCalls,
    endsOnEditable: document.activeElement === ta,
  })
})()`))
console.log(result)
check(result.blurCalls >= 1, 'already-focused tap called blur() (IME can re-raise)', `blurCalls=${result.blurCalls}`)
check(result.endsOnEditable, 'refocus returned to the editable', `endsOnEditable=${result.endsOnEditable}`)

// Cooldown: a second tap within 800ms must not blur again.
await evaluate(`(() => {
  window.__blurCalls = 0
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  const rect = ta.getBoundingClientRect()
  ta.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.top + 10,
  }))
  return 'second'
})()`)
await sleep(80)
const second = JSON.parse(await evaluate(`JSON.stringify({ blurCalls: window.__blurCalls })`))
check(second.blurCalls === 0, 'cooldown suppresses a second blur cycle', `blurCalls=${second.blurCalls}`)

await evaluate(`(() => {
  if (window.__origBlur) HTMLElement.prototype.blur = window.__origBlur
  return 'restored'
})()`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: already-focused tap forces an IME re-focus cycle')
process.exit(0)
