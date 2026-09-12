/**
 * Dump every text node's computed font-size / weight / color in the host
 * settings dialog, plus section box metrics, for a full type audit.
 * Usage: node tools/probe-settings-type-full.mjs <url>
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
await ev(`(() => { document.querySelector('[data-slot="sidebar.settings"] button')?.click(); return 1 })()`)
await new Promise((r) => setTimeout(r, 900))

console.log(await ev(`(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return 'no dialog'
  const sizes = {}
  const samples = []
  for (const el of d.querySelectorAll('*')) {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (!own) continue
    const cs = getComputedStyle(el)
    const fs = cs.fontSize
    sizes[fs] = (sizes[fs] || 0) + 1
    if (samples.length < 40) {
      samples.push({
        fs, fw: cs.fontWeight, lh: cs.lineHeight,
        color: cs.color,
        cls: (el.className || '').toString().split(' ')[0].slice(0, 28),
        text: (el.textContent || '').trim().slice(0, 24),
        h: Math.round(el.getBoundingClientRect().height),
      })
    }
  }
  // section boxes
  const sections = [...d.querySelectorAll('[class*="_row"],[class*="_section"],[class*="Theme"],[class*="_cube"]')]
    .slice(0, 12).map(el => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
      return {
        cls: (el.className || '').toString().split(' ')[0].slice(0, 28),
        h: Math.round(r.height), w: Math.round(r.width),
        pad: cs.padding, gap: cs.gap, mb: cs.marginBottom,
      }
    })
  return JSON.stringify({ sizeHistogram: sizes, samples, sections }, null, 1)
})()`))

ws.close(); process.exit(0)
