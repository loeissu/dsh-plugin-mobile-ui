/**
 * Verify left-edge open (no floating hamburger).
 * Usage: node tools/verify-drawer-edge.mjs <url>
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

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const geom = JSON.parse(await ev(`(() => {
  const edge = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const old = document.querySelector('.dsh-mobile-drawer-trigger')
  if (!edge) return JSON.stringify({ present: false })
  const r = edge.getBoundingClientRect()
  const cs = getComputedStyle(edge)
  const hit = document.elementFromPoint(12, Math.round(window.innerHeight / 2))
  return JSON.stringify({
    present: true,
    w: Math.round(r.width), h: Math.round(r.height),
    left: Math.round(r.left), top: Math.round(r.top),
    pointer: cs.pointerEvents,
    noFloatButton: old === null,
    hitIsEdge: hit === edge || edge.contains(hit),
    hitTag: hit && hit.className,
  })
})()`))
console.log('edge', geom)
check(geom.present === true, 'left-edge open strip present')
check(geom.noFloatButton === true, 'floating hamburger removed')
check(geom.w === 24, 'edge strip is 24px wide', `w=${geom.w}`)
check(geom.h >= 800, 'edge strip spans the panel height', `h=${geom.h}`)
check(geom.hitIsEdge === true, 'edge is hit-testable at mid-height', `hit=${geom.hitTag}`)

// Click opens (mouse / CDP path).
console.log('click edge', await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`))
await sleep(600)
const open1 = await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`)
check(open1 === 'true', 'clicking the edge opens the drawer', `open=${open1}`)

// Close via scrim, then edge-swipe open.
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-scrim"]')?.click()`)
await sleep(400)

const swipe = `(() => {
  const edge = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const mk = (type, x, y) => {
    const touch = new Touch({ identifier: 5, target: edge, clientX: x, clientY: y })
    edge.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [touch],
      targetTouches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch],
    }))
  }
  mk('touchstart', 8, 450)
  mk('touchmove', 28, 452)
  mk('touchmove', 48, 453)
  mk('touchend', 48, 453)
  return 'swiped'
})()`
console.log(await ev(swipe))
await sleep(500)
const open2 = await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`)
check(open2 === 'true', 'swiping right from the left edge opens the drawer', `open=${open2}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: left-edge open works; no floating trigger')
process.exit(0)
