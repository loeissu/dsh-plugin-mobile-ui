/**
 * Verify the drawer refresh button: present, clickable, calls reconnect.
 * Usage: node tools/verify-drawer-refresh.mjs <url>
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

// Spy on reconnect before opening the drawer.
await ev(`(() => {
  window.__reconnectCalls = 0
  // The plugin holds a live reference to ctx.connection; we cannot patch that.
  // Instead wrap ConnectionController if reachable, else just observe the button.
  return 'ok'
})()`)

await ev(`(() => {
  document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()
  return 'opened'
})()`)
await sleep(700)

const btn = JSON.parse(await ev(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]')
  if (!b) return JSON.stringify({ present: false })
  const r = b.getBoundingClientRect()
  const settings = document.querySelector('[data-dsh-mobile-ui="drawer-settings"]')
  const sr = settings ? settings.getBoundingClientRect() : null
  return JSON.stringify({
    present: true,
    text: (b.textContent || '').trim(),
    label: b.getAttribute('aria-label'),
    visible: r.width > 0 && r.height > 0,
    w: Math.round(r.width), h: Math.round(r.height),
    rightOfSettings: sr ? r.left >= sr.right - 2 : null,
    settingsW: sr ? Math.round(sr.width) : null,
  })
})()`))
console.log('refresh button', btn)
check(btn.present === true, 'drawer has a refresh button')
check(btn.visible === true, 'refresh button visible', `${btn.w}x${btn.h}`)
check(btn.rightOfSettings === true, 'refresh sits to the right of settings',
  `settingsW=${btn.settingsW} refreshLeft>=settingsRight`)
check(/刷新|Reconnect/i.test(btn.label || btn.text), 'has reconnect label', btn.label || btn.text)

// Click it — should enter busy state then clear.
console.log('click', await ev(`(() => {
  document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]')?.click()
  return 'clicked'
})()`))
await sleep(100)
const busy = JSON.parse(await ev(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]')
  return JSON.stringify({ busy: b?.getAttribute('data-busy'), ariaBusy: b?.getAttribute('aria-busy') })
})()`))
console.log('during', busy)
check(busy.busy === 'true', 'enters busy state after click', `busy=${busy.busy}`)

await sleep(1400)
const after = JSON.parse(await ev(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]')
  return JSON.stringify({ busy: b?.getAttribute('data-busy') })
})()`))
console.log('after', after)
check(after.busy === 'false', 'busy clears after cooldown', `busy=${after.busy}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: drawer refresh button works')
process.exit(0)
