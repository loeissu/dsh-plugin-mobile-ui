/**
 * Verify the 导航 tab never overlaps the host's first tab, in ANY label width.
 *
 * The reservation for the label is measured at runtime (`--dsh-mobile-nav-reserve`)
 * because the label is text: '导航' is 26px at this font and 'Navigation' is 65px.
 * A hardcoded 56px fits the Chinese copy and overlapped the host tab by ~9px in
 * English, so this drives both widths — the English one by relabelling the button
 * for a moment rather than changing the locale setting.
 *
 * Usage: node tools/verify-nav-tab-locale.mjs <url>
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

const MEASURE = `(() => {
  const tab = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const list = document.querySelector('[class*="_tabs"][role="tablist"]')
  if (!tab || !list) return JSON.stringify({ missing: !tab ? 'tab' : 'tablist' })
  const tb = tab.getBoundingClientRect()
  const hostLeft = Math.min(...[...document.querySelectorAll('[role="tab"]')].map((e) => e.getBoundingClientRect().left))
  return JSON.stringify({
    label: (tab.textContent || '').trim(),
    tabRight: Math.round(tb.right),
    hostFirstLeft: Math.round(hostLeft),
    clearance: Math.round(hostLeft - tb.right),
    reserve: list.style.getPropertyValue('--dsh-mobile-nav-reserve').trim() || '(fallback)',
    padLeft: getComputedStyle(list).paddingLeft,
  })
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const zh = JSON.parse(await ev(MEASURE))
console.log('current locale:', JSON.stringify(zh))
check(zh.missing === undefined, '导航 tab and host tablist are both present')
check(zh.reserve !== '(fallback)', 'the reservation is measured, not the 56px fallback', `reserve=${zh.reserve} pad=${zh.padLeft}`)
check(zh.clearance >= 4, 'the label clears the host first tab', `clearance=${zh.clearance}px`)

const en = JSON.parse(await ev(`(async () => {
  const tab = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const original = tab.textContent
  tab.textContent = 'Navigation'
  await new Promise((r) => setTimeout(r, 350))
  const out = ${MEASURE}
  tab.textContent = original
  await new Promise((r) => setTimeout(r, 250))
  return out
})()`))
console.log('simulated EN  :', JSON.stringify(en))
check(en.missing === undefined, 'EN label keeps both elements present')
check(en.clearance >= 4, 'the wider EN label still clears the host first tab', `clearance=${en.clearance}px (was -9 before the fix)`)
check(en.reserve !== zh.reserve, 'the reservation follows the label width', `zh=${zh.reserve} en=${en.reserve}`)

const restored = JSON.parse(await ev(MEASURE))
check(restored.clearance >= 4, 'restoring the label restores the clearance', `clearance=${restored.clearance}px`)

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: the 导航 reservation adapts to the label width in both locales')
process.exit(0)
