/**
 * Verify failed tool cards open by default.
 * Usage: node tools/verify-toolcard-fail-open.mjs <url>
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

// Open a session with tool cards if possible.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(ev)
await sleep(1000)
const rows = await listSessions(ev)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案/i.test(r.text))
  await clickSession(ev, pick === -1 ? 0 : pick)
  await sleep(5000)
}

const stats = JSON.parse(await ev(`(() => {
  const cards = [...document.querySelectorAll('[data-dsh-mobile-ui="tool-card"]')]
  const failedOpen = cards.filter(c =>
    c.querySelector('.dsh-mobile-tool__error') && c.getAttribute('data-open') === 'true')
  const failedClosed = cards.filter(c =>
    c.querySelector('.dsh-mobile-tool__error') && c.getAttribute('data-open') !== 'true')
  const okOpen = cards.filter(c =>
    !c.querySelector('.dsh-mobile-tool__error') && c.getAttribute('data-open') === 'true')
  const okClosed = cards.filter(c =>
    !c.querySelector('.dsh-mobile-tool__error') && c.getAttribute('data-open') !== 'true')
  return JSON.stringify({
    total: cards.length,
    failedOpen: failedOpen.length,
    failedClosed: failedClosed.length,
    okOpen: okOpen.length,
    okClosed: okClosed.length,
    sampleFail: failedOpen[0]?.querySelector('.dsh-mobile-tool__label')?.textContent?.slice(0, 40) ?? null,
  })
})()`))
console.log(stats)
check(stats.total > 0, 'tool cards rendered', `n=${stats.total}`)
check(stats.failedClosed === 0, 'every failed card is open by default',
  `open=${stats.failedOpen} closed=${stats.failedClosed}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: failed tool cards auto-expand')
process.exit(0)
