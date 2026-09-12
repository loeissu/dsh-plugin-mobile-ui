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
  const nodes = [...document.querySelectorAll('*')].filter(e => {
    const t = (e.textContent || '').trim()
    return t === '对话' || t === '轨迹'
  })
  const info = nodes.slice(0, 6).map(e => {
    const chain = []
    let el = e
    for (let i = 0; i < 5 && el; i++) {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      chain.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().split(' ').slice(0, 2).join(' '),
        slot: el.getAttribute && el.getAttribute('data-slot'),
        role: el.getAttribute && el.getAttribute('role'),
        display: cs.display,
        w: Math.round(r.width), h: Math.round(r.height),
        left: Math.round(r.left), top: Math.round(r.top),
      })
      el = el.parentElement
    }
    return chain
  })
  return JSON.stringify(info, null, 1)
})()`))
ws.close(); process.exit(0)
