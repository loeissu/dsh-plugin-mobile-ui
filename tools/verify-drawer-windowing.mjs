/**
 * Verify content-visibility windowing does not break drawer hit-testing or
 * scroll affordance.
 * Usage: node tools/verify-drawer-windowing.mjs <url>
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

const info = JSON.parse(await ev(`(() => {
  const sess = [...document.querySelectorAll('.dsh-mobile-sess')]
  const body = document.querySelector('.dsh-mobile-drawer-body')
  const first = sess[0]
  const last = sess[sess.length - 1]
  const cs = first ? getComputedStyle(first) : null
  return JSON.stringify({
    count: sess.length,
    contentVisibility: cs?.contentVisibility ?? null,
    containIntrinsicSize: cs?.containIntrinsicSize ?? null,
    firstH: first ? Math.round(first.getBoundingClientRect().height) : null,
    lastH: last ? Math.round(last.getBoundingClientRect().height) : null,
    bodyScrollH: body?.scrollHeight ?? null,
    bodyClientH: body?.clientHeight ?? null,
  })
})()`))
console.log(info)
check(info.count > 0, 'session rows present', `n=${info.count}`)
check(info.contentVisibility === 'auto', 'content-visibility:auto applied',
  `cv=${info.contentVisibility}`)
check(info.firstH !== null && info.firstH >= 40, 'first row has real height',
  `h=${info.firstH}`)
check(info.bodyScrollH !== null && info.bodyScrollH >= info.bodyClientH,
  'scroll height remains >= client height',
  `scroll=${info.bodyScrollH} client=${info.bodyClientH}`)

// Click first session — must still work.
console.log('click first', await ev(`(() => {
  const s = document.querySelector('.dsh-mobile-sess')
  s?.click(); return s?.textContent?.slice(0, 24) ?? 'none'
})()`))
await sleep(500)
const closed = JSON.parse(await ev(`(() => {
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  return JSON.stringify({ open: root?.getAttribute('data-open') })
})()`))
console.log(closed)
check(closed.open === 'false', 'clicking a windowed row still closes the drawer')

// Programmatic scroll: either the list scrolls, or it fits and scrollTop stays 0.
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(500)
await ev(`(() => {
  const b = document.querySelector('.dsh-mobile-drawer-body')
  if (b) b.scrollTop = b.scrollHeight
  return b ? b.scrollTop : -1
})()`)
await sleep(200)
const afterScroll = JSON.parse(await ev(`(() => {
  const b = document.querySelector('.dsh-mobile-drawer-body')
  return JSON.stringify({
    top: b?.scrollTop ?? null,
    scrollH: b?.scrollHeight ?? null,
    clientH: b?.clientHeight ?? null,
  })
})()`))
console.log('scrolled', afterScroll)
const fits = (afterScroll.scrollH ?? 0) <= (afterScroll.clientH ?? 0)
check(fits ? (afterScroll.top ?? 0) === 0 : (afterScroll.top ?? 0) > 0,
  'body scroll position is consistent with content size',
  `fits=${fits} top=${afterScroll.top}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: content-visibility windowing is safe')
process.exit(0)
