const cdp = 'http://127.0.0.1:9222'
const appUrl = process.argv[2]
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

// open a session quickly
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(ev); await new Promise((r) => setTimeout(r, 1000))
const rows = await listSessions(ev)
if (rows.length) { await clickSession(ev, 0); await new Promise((r) => setTimeout(r, 4000)) }

console.log(await ev(`(() => {
  const log = []
  document.addEventListener('focusin', (e) => log.push('in:' + e.target.tagName), true)
  document.addEventListener('focusout', (e) => log.push('out:' + e.target.tagName), true)
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  ta.focus()
  const before = document.activeElement && document.activeElement.tagName
  ta.blur()
  const mid = document.activeElement && document.activeElement.tagName
  ta.focus()
  const after = document.activeElement && document.activeElement.tagName
  return JSON.stringify({ before, mid, after, log, ce: ta && ta.getAttribute('contenteditable'), contentEditable: ta && ta.contentEditable }, null, 1)
})()`))

ws.close(); process.exit(0)
