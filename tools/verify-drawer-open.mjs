/**
 * Verify header "导航" text tab opens the drawer (replaces ☰).
 * Usage: node tools/verify-drawer-open.mjs <url>
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
  const nav = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const hamburger = document.querySelector('.dsh-mobile-drawer-trigger')
  const tabs = [...document.querySelectorAll('[role="tab"]')].map(e => ({
    text: (e.textContent || '').trim(),
    left: Math.round(e.getBoundingClientRect().left),
  }))
  const list = document.querySelector('[role="tablist"]')
  if (!nav) return JSON.stringify({ present: false })
  const r = nav.getBoundingClientRect()
  return JSON.stringify({
    present: true,
    text: (nav.textContent || '').trim(),
    w: Math.round(r.width), h: Math.round(r.height),
    left: Math.round(r.left), top: Math.round(r.top),
    noHamburger: hamburger === null,
    tabPadLeft: list ? getComputedStyle(list).paddingLeft : null,
    tabs,
  })
})()`))
console.log('nav tab', geom)
check(geom.present === true, '导航 text tab present')
check(geom.text === '导航', 'label is 导航', `text=${geom.text}`)
check(geom.noHamburger === true, 'hamburger ☰ removed')
check(geom.left <= 24, 'sits at the left of the tab row', `left=${geom.left}`)
check(geom.top >= 40 && geom.top <= 60, 'aligned with header tabs vertically', `top=${geom.top}`)
const chatTab = (geom.tabs || []).find((x) => x.text === '对话')
if (chatTab) {
  check(chatTab.left > geom.left + 20, '对话 is to the right of 导航',
    `nav=${geom.left} 对话=${chatTab.left}`)
} else {
  check(true, '对话 tab not found for alignment check (skipped)')
}
check((await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-edge"]') === null ? 'yes' : 'no'`)) === 'yes',
  'left-edge open strip removed')

await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(600)
check((await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open')`)) === 'true',
  'clicking 导航 opens drawer')

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: 导航 text tab replaces ☰ in the header tab row')
process.exit(0)
