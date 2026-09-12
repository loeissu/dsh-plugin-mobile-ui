/**
 * Verify the 刷新连接 button is honest.
 *
 * Two paths, both driven on the real page:
 *   1. healthy — tapping replaces the mux socket (instrumented WebSocket: the old
 *      one closes with code 4000) and no "link dead" state appears;
 *   2. dead tunnel — the app socket can still reach its peer while nothing reaches
 *      the host. That is simulated by answering the liveness probe with a body that
 *      lacks the host marker, which is exactly what a loopback proxy with no tunnel
 *      behind it would do. The button must then stop offering a reconnect (which
 *      cannot work at that layer) and offer a reload instead, with the dot showing
 *      the third state.
 *
 * Usage: node tools/verify-refresh-honesty.mjs <url>
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
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description).slice(0, 200)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

await send('Runtime.enable'); await send('Page.enable')
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__wsLog = []
    const Native = window.WebSocket
    window.WebSocket = function (url, protocols) {
      const sock = protocols === undefined ? new Native(url) : new Native(url, protocols)
      const rec = { made: Math.round(performance.now()), opened: null, closed: null, code: null, reason: null }
      window.__wsLog.push(rec)
      sock.addEventListener('open', () => { rec.opened = Math.round(performance.now()) })
      sock.addEventListener('close', (e) => { rec.closed = Math.round(performance.now()); rec.code = e.code; rec.reason = String(e.reason || '') })
      return sock
    }
    window.WebSocket.prototype = Native.prototype
    // The host's client compares readyState against WebSocket.OPEN/CLOSED, so the
    // constants must survive the wrapper or its socket never looks open.
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = Native[k]
  `,
})
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const openDrawer = async () => {
  await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
  await sleep(500)
}
const ui = async () => JSON.parse(await ev(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]')
  const d = document.querySelector('[data-dsh-mobile-ui="drawer-conn"]')
  return JSON.stringify({
    label: b ? (b.textContent || '').trim() : null,
    dead: b ? b.getAttribute('data-dead') : null,
    dot: d ? d.getAttribute('data-state') : null,
    announce: d ? (d.textContent || '').trim() : null,
  })
})()`))

console.log('## 1. healthy link')
await openDrawer()
const before = await ui()
const socksBefore = JSON.parse(await ev(`JSON.stringify(window.__wsLog)`)).length
console.log('  before:', JSON.stringify(before), 'sockets:', socksBefore)
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]').click()`)
await sleep(2500)
const after = await ui()
const log = JSON.parse(await ev(`JSON.stringify(window.__wsLog)`))
console.log('  after :', JSON.stringify(after))
console.log('  sockets:', JSON.stringify(log))
check(after.label === '刷新连接', 'a healthy refresh returns the button to 刷新连接', `label=${after.label}`)
check(after.dead === 'false', 'no false "link dead" state on a healthy link', `data-dead=${after.dead}`)
check(after.dot === 'connected', 'the dot still reports connected', `dot=${after.dot}`)
check(log.length === socksBefore + 1, 'the tap really replaced the socket', `${socksBefore} -> ${log.length}`)
const replaced = log[log.length - 1]
check(log.slice(0, -1).every((r) => r.code === 4000 || r.code === null), 'the previous socket was closed by the reconnect', JSON.stringify(log.slice(0, -1).map((r) => r.code)))
check(replaced.opened !== null, 'the new socket opened', `opened=${replaced.opened}`)

console.log('\n## 2. proxy answers, host unreachable (simulated)')
// A loopback proxy with a dead tunnel answers, but cannot produce the host marker.
await ev(`(() => {
  window.__realFetch = window.fetch
  window.fetch = async (input, init) => {
    const res = await window.__realFetch(input, init)
    if (String(input).startsWith(location.origin)) {
      const text = await res.text()
      return new Response('<html><body>proxy placeholder</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }
    return res
  }
  return 'stubbed'
})()`)
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]').click()`)
await sleep(2500)
const dead = await ui()
console.log('  after tap with a fake proxy answer:', JSON.stringify(dead))
check(dead.dead === 'true', 'the button reports the link as dead', `data-dead=${dead.dead}`)
check(dead.label === '重新加载', 'the button offers a reload instead of a useless reconnect', `label=${dead.label}`)
check(dead.dot === 'dead', 'the dot shows the third state', `dot=${dead.dot}`)
check(dead.announce === '链路已断', 'the state is announced as text', `announce=${dead.announce}`)

console.log('\n## 3. and it recovers when the host answers again')
await ev(`(() => { window.fetch = window.__realFetch; return 'restored' })()`)
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]').click()`)
await sleep(2500)
const back = await ui()
console.log('  after restore:', JSON.stringify(back))
check(back.dead === 'false' && back.label === '刷新连接', 'a later healthy refresh clears the dead state', JSON.stringify(back))

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: the refresh button replaces the socket, and tells the truth when it cannot help')
process.exit(0)
