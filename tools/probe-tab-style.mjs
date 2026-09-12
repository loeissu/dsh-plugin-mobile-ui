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
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)
console.log(await ev(`(() => {
  const tab = document.querySelector('[role="tab"]')
  const list = document.querySelector('[role="tablist"]')
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      cls: (el.className || '').toString(),
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color,
      pad: cs.padding, margin: cs.margin, gap: cs.gap,
      bg: cs.background, border: cs.border, borderRadius: cs.borderRadius,
      h: Math.round(r.height), w: Math.round(r.width),
      left: Math.round(r.left), top: Math.round(r.top),
      display: cs.display, lineHeight: cs.lineHeight,
    }
  }
  return JSON.stringify({ tab: pick(tab), list: pick(list) }, null, 1)
})()`))
ws.close(); process.exit(0)
