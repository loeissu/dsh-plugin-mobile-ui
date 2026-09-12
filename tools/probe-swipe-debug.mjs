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
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(700)

console.log(await ev(`(() => {
  window.__tlog = []
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  for (const type of ['touchstart', 'touchmove', 'touchend']) {
    panel.addEventListener(type, (e) => {
      const t = e.touches[0] || e.changedTouches[0]
      window.__tlog.push({ type, x: t?.clientX, y: t?.clientY, n: e.touches.length })
    }, true)
  }
  return 'instrumented'
})()`))

// left swipe sequence
for (const [type, x, y] of [['touchstart', 220, 400], ['touchmove', 180, 400], ['touchmove', 120, 400], ['touchend', 120, 400]]) {
  await ev(`(() => {
    const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
    const touch = new Touch({ identifier: 9, target: panel, clientX: ${x}, clientY: ${y} })
    panel.dispatchEvent(new TouchEvent('${type}', {
      bubbles: true, cancelable: true,
      touches: ${type === 'touchend' ? '[]' : '[touch]'},
      targetTouches: ${type === 'touchend' ? '[]' : '[touch]'},
      changedTouches: [touch],
    }))
    return 1
  })()`)
}
await sleep(100)
console.log('tlog', await ev(`JSON.stringify(window.__tlog)`))
console.log('dragging', await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')?.getAttribute('data-dragging')`))
console.log('open', await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`))

ws.close(); process.exit(0)
