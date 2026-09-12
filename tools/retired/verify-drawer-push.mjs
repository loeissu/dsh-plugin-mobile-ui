/**
 * Verify push-mode drawer: opening pads the AppFrame so the conversation
 * (and its header tabs) slide right instead of being covered.
 * Usage: node tools/verify-drawer-push.mjs <url>
 */
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
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const snap = async () => JSON.parse(await ev(`(() => {
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const centre = frame?.querySelector(':scope > [class*="centerCol"]')
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const tabs = [...document.querySelectorAll('[role="tab"], [class*="tab"]')]
    .filter(e => /对话|轨迹|Chat|Trace/i.test(e.textContent || ''))
    .map(e => Math.round(e.getBoundingClientRect().left))
  const pad = frame ? getComputedStyle(frame).paddingLeft : null
  return JSON.stringify({
    flag: document.documentElement.dataset.dshMobileDrawer ?? null,
    padLeft: pad,
    centreLeft: centre ? Math.round(centre.getBoundingClientRect().left) : null,
    centreW: centre ? Math.round(centre.getBoundingClientRect().width) : null,
    panelW: panel ? Math.round(panel.getBoundingClientRect().width) : null,
    panelTransform: panel ? getComputedStyle(panel).transform : null,
    open: document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open'),
    tabLefts: tabs.slice(0, 3),
  })
})()`))

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const closed = await snap()
console.log('closed', closed)
check(closed.flag === null, 'no push flag when closed')
check(closed.centreLeft === 0 || closed.centreLeft === null || closed.centreLeft < 8,
  'conversation starts at the left edge when closed', `left=${closed.centreLeft}`)

await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(700)
const open = await snap()
console.log('open', open)
check(open.flag === 'open', 'push flag set on <html>', `flag=${open.flag}`)
check(open.padLeft !== null && parseFloat(open.padLeft) >= 200,
  'AppFrame has left padding for the drawer', `pad=${open.padLeft}`)
check(open.centreLeft !== null && open.centreLeft >= 200,
  'conversation column shifted right', `centreLeft=${open.centreLeft}`)
check(open.panelW !== null && open.panelW >= 200,
  'drawer panel visible at full width', `panelW=${open.panelW}`)
// Header tabs live inside centerCol — they must move with it.
if (open.tabLefts.length > 0 && closed.tabLefts.length > 0) {
  check(open.tabLefts[0] > closed.tabLefts[0] + 100,
    '对话/轨迹 header shifted right with the column',
    `closed=${closed.tabLefts[0]} open=${open.tabLefts[0]}`)
} else {
  check(true, 'header tab probe skipped (no tab nodes matched)')
}

// Close restores.
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-scrim"]')?.click()`)
await sleep(700)
const reclosed = await snap()
console.log('reclosed', reclosed)
check(reclosed.flag === null, 'push flag cleared on close')
check(parseFloat(reclosed.padLeft || '0') < 8, 'frame padding restored', `pad=${reclosed.padLeft}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: push-mode drawer embeds beside the conversation')
process.exit(0)
