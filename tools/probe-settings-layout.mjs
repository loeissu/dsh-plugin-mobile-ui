const appUrl = process.argv[2]
const cdp = 'http://127.0.0.1:9222'
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map(); let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await new Promise((r) => setTimeout(r, 9000))
await ev(`(() => { const b = document.querySelector('[data-slot="sidebar.settings"] button'); b && b.click(); return 1 })()`)
await new Promise((r) => setTimeout(r, 800))
console.log(await ev(`(() => {
  const d = document.querySelector('[role="dialog"]')
  const sel = ['[class*="VOzbGW_panel"]','[class*="VOzbGW_header"]','[class*="VOzbGW_nav"]','[class*="VOzbGW_navList"]','[class*="VOzbGW_content"]','[class*="VOzbGW_options"]','[class*="_WvWnq_section"]','[class*="oY77xG_row"]','[class*="_8HJdBW_theme"]','[class*="_root_"]']
  const out = {}
  for (const s of sel) {
    const el = d.querySelector(s)
    if (!el) { out[s] = null; continue }
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    out[s] = {
      cls: (el.className || '').toString().split(' ')[0],
      display: cs.display, flexDirection: cs.flexDirection, gap: cs.gap,
      pad: cs.padding, margin: cs.margin,
      h: Math.round(r.height), w: Math.round(r.width),
      overflow: cs.overflowY, fs: cs.fontSize, grid: cs.gridTemplateColumns,
    }
  }
  return JSON.stringify(out, null, 1)
})()`))
ws.close(); process.exit(0)
