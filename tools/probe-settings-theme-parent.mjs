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
await ev(`(() => { document.querySelector('[data-slot="sidebar.settings"] button')?.click(); return 1 })()`)
await new Promise((r) => setTimeout(r, 800))
console.log(await ev(`(() => {
  const cube = document.querySelector('[role="dialog"] [class*="_themeCube"]')
  if (!cube) return 'no cube'
  const parent = cube.parentElement
  const cs = getComputedStyle(parent)
  const siblings = [...parent.children].map(c => ({
    cls: (c.className||'').toString().split(' ')[0],
    text: (c.textContent||'').trim().slice(0,20),
  }))
  // description nodes near titles
  const descs = [...document.querySelectorAll('[role="dialog"] [class*="desc"],[role="dialog"] [class*="hint"],[role="dialog"] [class*="help"],[role="dialog"] [class*="caption"]')]
    .slice(0,6).map(e => ({ cls: (e.className||'').toString().split(' ')[0], fs: getComputedStyle(e).fontSize, text: (e.textContent||'').slice(0,30) }))
  return JSON.stringify({
    parentCls: (parent.className||'').toString(),
    parentDisplay: cs.display,
    parentFlex: cs.flexDirection,
    parentGap: cs.gap,
    parentGrid: cs.gridTemplateColumns,
    parentPad: cs.padding,
    siblings,
    descs,
    // dialog overlay z-index vs drawer trigger
    dialogZ: (() => {
      const d = document.querySelector('[role="dialog"]')
      let el = d, z = ''
      while (el) {
        const c = getComputedStyle(el)
        if (c.zIndex !== 'auto') { z = c.zIndex + '@' + (el.className||'').toString().split(' ')[0]; break }
        el = el.parentElement
      }
      return z
    })(),
    triggerZ: getComputedStyle(document.querySelector('.dsh-mobile-drawer-trigger') || document.body).zIndex,
  }, null, 1)
})()`))
ws.close(); process.exit(0)
