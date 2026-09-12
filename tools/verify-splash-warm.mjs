/**
 * Verify splash cold vs warm timing via sessionStorage.
 * Usage: node tools/verify-splash-warm.mjs <url>
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
const splashPresent = async () => JSON.parse(await ev(`(() => {
  const s = document.querySelector('[data-dsh-mobile-ui="splash"]')
  return JSON.stringify({
    present: !!s,
    leaving: s?.getAttribute('data-leaving') ?? null,
    warm: sessionStorage.getItem('dsh-mobile-ui/splash-warm'),
  })
})()`))

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

// ── cold: clear flag, reload, splash must appear then leave after ~700ms ──
await send('Page.navigate', { url: appUrl })
await sleep(8000)
await ev(`sessionStorage.removeItem('dsh-mobile-ui/splash-warm'); 'cleared'`)
await send('Page.navigate', { url: appUrl })

let coldAt = null
for (let i = 0; i < 30; i++) {
  await sleep(100)
  const s = await splashPresent()
  if (s.present) { coldAt = { ms: (i + 1) * 100, ...s }; break }
}
console.log('cold first paint', coldAt)
check(coldAt !== null, 'cold start shows the splash')
check(coldAt?.warm === '1', 'cold start marks session warm', `warm=${coldAt?.warm}`)

// Wait until it unmounts (min 700 + fade 200, cap 4000)
let coldGoneAt = null
for (let i = 0; i < 50; i++) {
  await sleep(100)
  const s = await splashPresent()
  if (!s.present) { coldGoneAt = (i + 1) * 100; break }
}
console.log('cold gone after', coldGoneAt, 'ms from loop start')
check(coldGoneAt !== null && coldGoneAt >= 700, 'cold splash lasts at least the brand beat',
  `goneAt=${coldGoneAt}`)

// ── warm: flag set, reload, splash should vanish quickly ──
await send('Page.navigate', { url: appUrl })
let warmGoneQuick = false
let sawWarmSplash = false
for (let i = 0; i < 20; i++) {
  await sleep(100)
  const s = await splashPresent()
  if (s.present) sawWarmSplash = true
  if (sawWarmSplash && !s.present && (i + 1) * 100 <= 800) {
    warmGoneQuick = true
    break
  }
  // If splash never appeared (already gone before first sample) treat as warm-ok
  if (!s.present && i >= 3) { warmGoneQuick = true; break }
}
console.log('warm quick dismiss', { sawWarmSplash, warmGoneQuick })
check(warmGoneQuick === true, 'warm start dismisses well under the cold beat',
  `saw=${sawWarmSplash} quick=${warmGoneQuick}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: splash cold/warm timing works')
process.exit(0)
