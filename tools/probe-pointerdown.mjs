const cdp = 'http://127.0.0.1:9222'
const appUrl = process.argv[2]
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map()
let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) }
}
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id
  p.set(i, r)
  ws.send(JSON.stringify({ id: i, method, params }))
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description
}
await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await new Promise((r) => setTimeout(r, 9000))

console.log(await ev(`(() => {
  const meta = document.querySelector('meta[name=viewport]')
  const styles = [...document.querySelectorAll('style')].filter(s => (s.textContent || '').includes('dsh-mobile-vv-height'))
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  const hits = []
  const probe = (e) => {
    hits.push({
      type: e.type,
      target: e.target && e.target.tagName,
      closest: !!(e.target && e.target.closest && e.target.closest('textarea,input,[contenteditable="true"]')),
      active: document.activeElement && document.activeElement.tagName,
      same: document.activeElement === ta,
    })
  }
  document.addEventListener('pointerdown', probe, true)
  if (ta) {
    ta.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  }
  document.removeEventListener('pointerdown', probe, true)
  return JSON.stringify({
    viewport: meta && meta.content,
    vvStyles: styles.length,
    ta: ta && { tag: ta.tagName, ce: ta.getAttribute('contenteditable'), focused: document.activeElement === ta },
    hits,
  }, null, 1)
})()`))

ws.close()
process.exit(0)
