/**
 * Can we open settings by clicking the hidden sidebar trigger?
 * Usage: node tools/probe-settings-click.mjs <url>
 */
const appUrl = process.argv[2]
const cdp = 'http://127.0.0.1:9222'
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map(); let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await new Promise((r) => setTimeout(r, 9000))

const before = await ev(`(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].map(d => ({
    label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'),
    visible: !!(d.offsetWidth || d.offsetHeight),
    text: (d.innerText||'').slice(0, 80),
  }))
  return JSON.stringify({ dialogs })
})()`)
console.log('before', before)

console.log('click', await ev(`(() => {
  const btn = document.querySelector('[data-slot="sidebar.settings"] button')
    || [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '设置')
  if (!btn) return 'no button'
  btn.click()
  return 'clicked'
})()`))
await new Promise((r) => setTimeout(r, 800))

const after = await ev(`(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].map(d => ({
    label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'),
    visible: !!(d.offsetWidth || d.offsetHeight),
    text: (d.innerText||'').slice(0, 120),
  }))
  const mobile = document.querySelector('[data-dsh-mobile-ui="settings"]')
  return JSON.stringify({ dialogs, mobileSettingsVisible: !!(mobile && (mobile.offsetWidth || mobile.offsetHeight)) }, null, 1)
})()`)
console.log('after', after)

ws.close(); process.exit(0)
