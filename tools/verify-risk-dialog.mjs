/**
 * Verify the risk-confirmation dialog is a compact card whose title sits ABOVE
 * its body — i.e. that `tether-compat.ts` case 2 still beats tether's
 * full-screen + absolute-header rules.
 *
 * Drives the real UI: settings → 权限 → 完全权限 (which only opens the risk
 * confirmation), asserts, then cancels. The permission setting is never changed.
 *
 * Usage: node tools/verify-risk-dialog.mjs <url>
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

await ev(`(() => {
  const seat = document.querySelector('[data-slot="sidebar.settings"] button')
    || [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '设置')
  seat && seat.click()
})()`)
await sleep(900)
check((await ev(`document.querySelector('[role="dialog"]') !== null`)) === true, 'host settings dialog opens')

await ev(`document.querySelector('[role="dialog"] [aria-haspopup="menu"]')?.click()`)
await sleep(700)
await ev(`[...document.querySelectorAll('[role="menuitem"]')].find(e => /完全权限/.test(e.textContent || ''))?.click()`)
await sleep(900)

const m = JSON.parse(await ev(`(() => {
  const conf = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].find(d => !d.querySelector('[class*="_navCell"]'))
  const settings = document.querySelector('[role="dialog"]')
  const g = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { y: Math.round(b.top), x: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) } }
  const header = conf && conf.querySelector('[class*="_header"]')
  const body = conf && conf.querySelector('[class*="_body"]')
  const title = conf && conf.querySelector('[class*="_title"]')
  const footer = conf && conf.querySelector('[class*="_footer"]')
  return JSON.stringify({
    present: !!conf,
    dialog: g(conf),
    header: g(header),
    body: g(body),
    title: g(title),
    headerPosition: header ? getComputedStyle(header).position : null,
    radius: conf ? getComputedStyle(conf).borderRadius : null,
    footer: g(footer),
    buttons: conf ? [...conf.querySelectorAll('button')].map(b => ({ t: (b.textContent || '').trim().slice(0, 8), r: g(b) })) : [],
    settingsDialog: g(settings),
  })
})()`))
console.log('measured', JSON.stringify(m))

check(m.present === true, 'risk confirmation dialog is open')
check(m.headerPosition === 'static', 'header is back in flow (tether made it absolute)', `position=${m.headerPosition}`)
check(m.body !== null && m.header !== null && m.body.y >= m.header.y + m.header.h - 2,
  'body starts below the header — title does not overlap it',
  m.body && m.header ? `header ${m.header.y}..${m.header.y + m.header.h}, body ${m.body.y}` : 'n/a')
check(m.title !== null && m.body !== null && m.title.y + m.title.h <= m.body.y + 2,
  'title sits above the body text',
  m.title && m.body ? `title ${m.title.y}..${m.title.y + m.title.h}, body ${m.body.y}` : 'n/a')
check(m.dialog !== null && m.dialog.h <= 915 - 20, 'card is no longer stretched to the full viewport', `h=${m.dialog && m.dialog.h}`)
check(m.radius !== null && m.radius !== '0px', 'card keeps its radius', `radius=${m.radius}`)
const cardRight = m.dialog ? m.dialog.x + m.dialog.w : 0
check(m.footer !== null && m.footer.x + m.footer.w <= cardRight + 2,
  'action footer stays inside the card (tether\'s width:100% on a content-box wrapper added its padding again)',
  m.footer ? `footer ${m.footer.x}..${m.footer.x + m.footer.w} vs card right ${cardRight}` : 'no footer')
const outside = (m.buttons || []).filter((b) => b.r.x + b.r.w > cardRight + 2)
check(outside.length === 0, 'no dialog button is clipped by the card edge',
  outside.length ? outside.map((b) => `${b.t || 'close'} -> ${b.r.x + b.r.w}`).join(', ') : `all ${(m.buttons || []).length} inside ${cardRight}`)
check(m.settingsDialog !== null && m.settingsDialog.w === 412 && m.settingsDialog.h === 915,
  'settings dialog keeps tether\'s full-screen phone treatment',
  m.settingsDialog ? `${m.settingsDialog.w}×${m.settingsDialog.h}` : 'closed')

await ev(`(() => {
  const conf = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].find(d => !d.querySelector('[class*="_navCell"]'))
  const cancel = conf && [...conf.querySelectorAll('button')].find(b => /取消/.test(b.textContent || ''))
  cancel && cancel.click()
})()`)
await sleep(500)
check((await ev(`(() => {
  const conf = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].find(d => !d.querySelector('[class*="_navCell"]'))
  return conf ? 'still open' : 'closed'
})()`)) === 'closed', 'cancel closes it and leaves the permission setting untouched')

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: risk-confirmation dialog renders as a compact card with the title above its body')
process.exit(0)
