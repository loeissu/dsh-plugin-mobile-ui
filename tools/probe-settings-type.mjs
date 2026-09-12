/**
 * Measure the host settings modal typography and spacing at phone width.
 * Usage: node tools/probe-settings-type.mjs <url>
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

// open settings
await ev(`(() => {
  const btn = document.querySelector('[data-slot="sidebar.settings"] button')
    || [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '设置')
  btn && btn.click(); return 'ok'
})()`)
await new Promise((r) => setTimeout(r, 800))

console.log(await ev(`(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return 'no dialog'
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className||'').toString().split(' ').slice(0,3).join(' '),
      fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight,
      pad: cs.padding, gap: cs.gap, mb: cs.marginBottom, mt: cs.marginTop,
      h: Math.round(r.height), w: Math.round(r.width),
      text: (el.textContent||'').trim().slice(0, 30),
    }
  }
  const headings = [...d.querySelectorAll('h1,h2,h3,h4,[class*="heading"],[class*="title"],[class*="section"]')]
    .slice(0, 12).map(pick)
  const buttons = [...d.querySelectorAll('button')].slice(0, 10).map(pick)
  // theme cards - large rounded buttons
  const cards = [...d.querySelectorAll('button,[role="radio"],[role="button"]')]
    .filter(b => /浅色|深色|跟随系统/.test(b.textContent||''))
    .map(pick)
  const labels = [...d.querySelectorAll('label,[class*="label"]')].slice(0, 8).map(pick)
  // class inventory
  const classes = {}
  for (const el of d.querySelectorAll('*')) {
    for (const c of (el.className||'').toString().split(' ')) {
      if (c && !c.startsWith('dsh-mobile')) classes[c] = (classes[c]||0)+1
    }
  }
  const topClasses = Object.entries(classes).sort((a,b)=>b[1]-a[1]).slice(0, 25)
  return JSON.stringify({ panel: pick(d), headings, cards, buttons, labels, topClasses }, null, 1)
})()`))

ws.close(); process.exit(0)
