/**
 * Verify the drawer New Session button is present and invokes startSession.
 * Usage: node tools/verify-drawer-new-session.mjs <url>
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

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(700)

const btn = JSON.parse(await ev(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-new-session"]')
  if (!b) return JSON.stringify({ present: false })
  const r = b.getBoundingClientRect()
  return JSON.stringify({
    present: true,
    label: b.getAttribute('aria-label'),
    visible: r.width > 0 && r.height > 0,
    w: Math.round(r.width), h: Math.round(r.height),
  })
})()`))
console.log(btn)
check(btn.present === true, 'new-session button present in drawer head')
check(btn.visible === true, 'button visible', `${btn.w}x${btn.h}`)
check(/新建|New session/i.test(btn.label || ''), 'has new-session label', btn.label)

// Capture header title before / after click to see navigation.
const before = await ev(`(() => {
  const h = document.querySelector('[class*="header"] [class*="title"], [data-slot="conversation.session.header"]')
  return document.title + '|' + (h?.textContent?.slice(0, 40) ?? '')
})()`)
console.log('before', before)

console.log('click', await ev(`(() => {
  document.querySelector('[data-dsh-mobile-ui="drawer-new-session"]')?.click()
  return 'clicked'
})()`))
await sleep(1200)
const after = JSON.parse(await ev(`(() => {
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const composer = document.querySelector('textarea, [contenteditable="true"]')
  return JSON.stringify({
    drawerOpen: root?.getAttribute('data-open'),
    hasComposer: !!composer,
    composerPlaceholder: composer?.getAttribute('placeholder') ?? composer?.getAttribute('data-placeholder') ?? null,
  })
})()`))
console.log('after', after)
check(after.drawerOpen === 'false', 'drawer closes after new session')
check(after.hasComposer === true, 'conversation composer still available')

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: new-session button works')
process.exit(0)
