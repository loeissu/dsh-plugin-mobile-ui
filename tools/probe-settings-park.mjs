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

console.log(await ev(`(() => {
  let tag = document.getElementById('settings-park-probe')
  if (!tag) { tag = document.createElement('style'); tag.id = 'settings-park-probe'; document.head.append(tag) }
  tag.textContent = \`
    @media (max-width: 768px) {
      [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] {
        display: block !important;
        position: fixed !important;
        left: -10000px !important;
        top: 0 !important;
        width: 0 !important;
        height: 0 !important;
        overflow: visible !important;
        pointer-events: none !important;
      }
      [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] [role="dialog"],
      [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] [class*="_overlay"] {
        pointer-events: auto !important;
      }
    }
  \`
  return 'parked'
})()`))

await new Promise((r) => setTimeout(r, 300))
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
  const r = d.getBoundingClientRect()
  const cs = getComputedStyle(d)
  const hit = document.elementFromPoint(Math.round(window.innerWidth/2), Math.round(window.innerHeight/2))
  return JSON.stringify({
    w: Math.round(r.width), h: Math.round(r.height),
    top: Math.round(r.top), left: Math.round(r.left),
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    painted: r.width > 10 && r.height > 10,
    centreHit: hit && (hit.closest('[role="dialog"]') !== null),
    centreTag: hit && hit.tagName,
  }, null, 1)
})()`))

ws.close(); process.exit(0)
