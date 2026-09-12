/**
 * Locate the settings entry at phone width and whether the sidebar hides it.
 * Usage: node tools/probe-settings-entry.mjs <url>
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

console.log(await ev(`(() => {
  const sidebar = document.querySelector('[data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"]')
  const settingsSeat = document.querySelector('[data-slot="sidebar.settings"]')
    || [...document.querySelectorAll('[data-slot]')].find(e => (e.getAttribute('data-slot')||'').includes('settings'))
  const allSettingsSlots = [...document.querySelectorAll('[data-slot]')]
    .map(e => e.getAttribute('data-slot'))
    .filter(s => s && s.toLowerCase().includes('setting'))
  const sidebarText = sidebar ? sidebar.innerText.slice(0, 400) : null
  const sidebarDisplay = sidebar ? getComputedStyle(sidebar).display : null
  const settingsBtns = [...document.querySelectorAll('button,[role="button"]')]
    .filter(b => /设置|settings/i.test((b.getAttribute('aria-label')||'') + ' ' + (b.textContent||'') + ' ' + (b.title||'')))
    .map(b => ({
      tag: b.tagName,
      label: b.getAttribute('aria-label'),
      text: (b.textContent||'').trim().slice(0, 40),
      visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length),
      inSidebar: !!(sidebar && sidebar.contains(b)),
    }))
  return JSON.stringify({
    sidebarDisplay,
    sidebarText,
    allSettingsSlots,
    settingsSeatPresent: !!settingsSeat,
    settingsSeatParentDisplay: settingsSeat ? getComputedStyle(settingsSeat.parentElement || settingsSeat).display : null,
    settingsBtns,
  }, null, 1)
})()`))

ws.close(); process.exit(0)
