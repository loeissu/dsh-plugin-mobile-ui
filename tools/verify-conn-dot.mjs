/**
 * Verify the connection status dot in the drawer footer.
 * Usage: node tools/verify-conn-dot.mjs <url>
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
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(700)

const dot = JSON.parse(await ev(`(() => {
  const d = document.querySelector('[data-dsh-mobile-ui="drawer-conn"]')
  if (!d) return JSON.stringify({ present: false })
  const cs = getComputedStyle(d)
  const r = d.getBoundingClientRect()
  return JSON.stringify({
    present: true,
    state: d.getAttribute('data-state'),
    label: d.getAttribute('aria-label') || d.getAttribute('title'),
    w: Math.round(r.width), h: Math.round(r.height),
    bg: cs.backgroundColor,
    visible: r.width > 0 && r.height > 0,
  })
})()`))
console.log('dot', dot)
check(dot.present === true, 'connection dot present in drawer footer')
check(dot.visible === true, 'dot is visible', `${dot.w}x${dot.h}`)
check(['connected', 'connecting', 'disconnected', 'unknown'].includes(dot.state),
  'dot carries a known state', `state=${dot.state}`)
check(dot.state === 'connected', 'live 3080 reports connected', `state=${dot.state}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: connection status dot works')
process.exit(0)
