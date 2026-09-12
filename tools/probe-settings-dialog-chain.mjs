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
await ev(`(() => {
  const btn = document.querySelector('[data-slot="sidebar.settings"] button')
    || [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '设置')
  btn && btn.click()
  return 'clicked'
})()`)
await new Promise((r) => setTimeout(r, 800))
console.log(await ev(`(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return 'no dialog'
  const chain = []
  let el = d
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    chain.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className||'').toString().split(' ')[0].slice(0,40),
      slot: el.getAttribute && el.getAttribute('data-slot'),
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      position: cs.position,
      w: Math.round(r.width),
      h: Math.round(r.height),
      inSidebar: !!(el.closest && el.closest('[class*="sidebarCol"]')),
    })
    el = el.parentElement
  }
  return JSON.stringify({ chain, portalParent: d.parentElement && d.parentElement.tagName }, null, 1)
})()`))
ws.close(); process.exit(0)
