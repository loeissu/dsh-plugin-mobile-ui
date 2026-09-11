/**
 * Measure the drawer's scroll behaviour.
 *
 * The report is that the list is longer than the panel. Two very different
 * causes produce that symptom, and they need different fixes:
 *
 *  (a) the body is not actually scrollable — a bug in the flex/min-height chain
 *      or a stray overflow that clips the content;
 *  (b) the body scrolls fine, but nothing signals it, so the last rows look
 *      unreachable.
 *
 * So this measures the scroll container's geometry, then drives a real scroll
 * and checks whether scrollTop moves.
 *
 * Usage: node tools/probe-drawer-scroll.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-drawer-scroll.mjs <url> [--cdp <url>]')
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms) })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description)}`
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

await evaluate(`(() => {
  const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  if (t) t.click()
  return 'clicked'
})()`)
await sleep(1500)

console.log('\n== container geometry ==')
console.log(await evaluate(`(() => {
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const body = panel.querySelector('.dsh-mobile-drawer-body')
  const head = panel.querySelector('.dsh-mobile-drawer-head')
  const pr = panel.getBoundingClientRect()
  const br = body.getBoundingClientRect()
  const cs = (e) => getComputedStyle(e)
  return JSON.stringify({
    viewport: window.innerHeight,
    panel: { h: Math.round(pr.height), top: Math.round(pr.top), bottom: Math.round(pr.bottom), overflowY: cs(panel).overflowY, display: cs(panel).display },
    head: { h: Math.round(head.getBoundingClientRect().height), flex: cs(head).flex },
    body: {
      h: Math.round(br.height), top: Math.round(br.top), bottom: Math.round(br.bottom),
      clientH: body.clientHeight, scrollH: body.scrollHeight,
      overflowY: cs(body).overflowY, flex: cs(body).flex, minHeight: cs(body).minHeight,
      scrollable: body.scrollHeight > body.clientHeight + 2,
      scrollTop: body.scrollTop,
    },
    // Does anything else in the panel overflow?
    overflowing: [...panel.querySelectorAll('*')].filter((e) => {
      const s = cs(e)
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 2
    }).map((e) => ({ cls: (e.className || '').toString().split(' ')[0].slice(0, 30), sh: e.scrollHeight, ch: e.clientHeight })),
    rowCount: document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]').length,
    wsCount: document.querySelectorAll('[data-dsh-mobile-ui="drawer-workspace"]').length,
  }, null, 1)
})()`))

console.log('\n== can it actually scroll? ==')
const scrolled = await evaluate(`(() => {
  const body = document.querySelector('[data-dsh-mobile-ui="drawer-panel"] .dsh-mobile-drawer-body')
  const before = body.scrollTop
  body.scrollTop = 300
  return JSON.stringify({ before, after: body.scrollTop, maxScroll: body.scrollHeight - body.clientHeight })
})()`)
console.log(`  ${scrolled}`)

ws.close()
process.exit(0)
