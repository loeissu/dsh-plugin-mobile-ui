/**
 * Verify swipe-left-to-close on the drawer panel (synthetic touch).
 * Usage: node tools/verify-drawer-swipe.mjs <url>
 */
const appUrl = process.argv[2]
const cdp = 'http://127.0.0.1:9222'
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map(); let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const dispatchTouch = (type, x, y, id = 1) => `(() => {
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  if (!panel) return 'no-panel'
  const touch = new Touch({ identifier: ${id}, target: panel, clientX: ${x}, clientY: ${y} })
  const ev = new TouchEvent('${type}', {
    bubbles: true, cancelable: true,
    touches: ${type === 'touchend' || type === 'touchcancel' ? '[]' : '[touch]'},
    targetTouches: ${type === 'touchend' || type === 'touchcancel' ? '[]' : '[touch]'},
    changedTouches: [touch],
  })
  panel.dispatchEvent(ev)
  return 'ok'
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(700)

const openState = await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`)
check(openState === 'true', 'drawer open before swipe')

// Vertical drag must NOT close.
await ev(dispatchTouch('touchstart', 200, 400))
await ev(dispatchTouch('touchmove', 205, 480))
await ev(dispatchTouch('touchend', 205, 480))
await sleep(200)
const afterVert = await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`)
check(afterVert === 'true', 'vertical drag does not close the drawer', `open=${afterVert}`)

// Horizontal left swipe past the threshold closes.
await ev(dispatchTouch('touchstart', 220, 400, 2))
await ev(dispatchTouch('touchmove', 180, 402, 2))
await ev(dispatchTouch('touchmove', 120, 403, 2))
const mid = JSON.parse(await ev(`(() => {
  const p = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  return JSON.stringify({ dragging: p?.getAttribute('data-dragging'), transform: p ? getComputedStyle(p).transform : null })
})()`))
console.log('mid-drag', mid)
check(mid.dragging === 'true', 'panel enters dragging during left swipe')

await ev(dispatchTouch('touchmove', 80, 404, 2))
await ev(dispatchTouch('touchend', 80, 404, 2))
await sleep(400)
const afterSwipe = await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`)
console.log('after swipe open=', afterSwipe)
check(afterSwipe === 'false', 'horizontal left swipe closes the drawer', `open=${afterSwipe}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: swipe-to-close works')
process.exit(0)
