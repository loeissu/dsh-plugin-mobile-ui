/**
 * Verify swipe-to-switch in the host settings dialog, and the landscape branch.
 *
 * Swipe: the dialog's pages are switched by clicking the neighbour of the cell that
 * carries `aria-current="true"`, so the assertions read that attribute rather than
 * any private state.
 *
 * Landscape: a 915x412 phone is wider than the 768px gate every mobile surface used
 * to be keyed on, so the drawer and the touch layers switched off. The condition now
 * also matches a short, coarse-pointer viewport, which is exactly a phone on its
 * side — verified here with touch emulation on, the same way Chrome DevTools device
 * mode reports a coarse pointer on a handset.
 *
 * Usage: node tools/verify-swipe-and-landscape.mjs <url>
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
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description).slice(0, 200)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
/** Drive a gesture of the given delta, in 10 steps. */
const gesture = async (from, dx, dy) => {
  await touch('touchStart', from.x, from.y)
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', from.x + (dx * i) / 10, from.y + (dy * i) / 10)
    await sleep(12)
  }
  await touch('touchEnd', 0, 0)
  await sleep(700)
}
const activeTab = async () => ev(`(() => {
  const cells = [...document.querySelectorAll('[role="dialog"] [class*="_navCell"]')]
  const i = cells.findIndex((c) => c.getAttribute('aria-current') === 'true')
  return JSON.stringify({ index: i, text: i >= 0 ? (cells[i].textContent || '').trim() : null, count: cells.length })
})()`)

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

console.log('## swipe to switch pages (portrait 412x915)')
await ev(`document.querySelector('[data-slot="sidebar.settings"] button')?.click()`)
await sleep(1000)
const start = JSON.parse(await activeTab())
console.log('  starts at:', JSON.stringify(start))
check(start.count >= 3, 'the dialog has several sections', `${start.count} cells`)

// A swipe point inside the page area (right half, away from the nav strip).
const page = JSON.parse(await ev(`(() => {
  const o = document.querySelector('[role="dialog"] [class*="_options"]')
  const b = o.getBoundingClientRect()
  return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height * 0.7) })
})()`))
console.log('  page gesture point:', JSON.stringify(page))

await gesture(page, -160, 0)
const afterLeft = JSON.parse(await activeTab())
console.log('  after swipe left :', JSON.stringify(afterLeft))
check(afterLeft.index === start.index + 1, 'swiping left moves to the next section', `${start.index} -> ${afterLeft.index}`)

await gesture(page, -160, 0)
const afterLeft2 = JSON.parse(await activeTab())
check(afterLeft2.index === start.index + 2, 'and again', `${afterLeft.index} -> ${afterLeft2.index}`)

await gesture(page, 160, 0)
const afterRight = JSON.parse(await activeTab())
console.log('  after swipe right:', JSON.stringify(afterRight))
check(afterRight.index === afterLeft2.index - 1, 'swiping right moves back', `${afterLeft2.index} -> ${afterRight.index}`)

// A vertical drag must belong to the list, not the pager.
await gesture(page, 12, -140)
const afterVertical = JSON.parse(await activeTab())
check(afterVertical.index === afterRight.index, 'a vertical drag does not change section', `${afterRight.index} -> ${afterVertical.index}`)

// Clamp at the first page: go home, then swipe right.
await ev(`(() => { const c = [...document.querySelectorAll('[role="dialog"] [class*="_navCell"]')]; c[0].click(); return 'home' })()`)
await sleep(700)
await gesture(page, 160, 0)
const clamped = JSON.parse(await activeTab())
check(clamped.index === 0, 'there is no wrap-around at the first section', `index=${clamped.index}`)

await ev(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /关闭/.test(b.getAttribute('aria-label') || ''))?.click()`)
await sleep(500)

console.log('\n## landscape phone (915x412, coarse pointer)')
await send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2, mobile: true, screenOrientation: { angle: 90, type: 'landscapePrimary' } })
await send('Page.navigate', { url: appUrl })
await sleep(9000)
const land = JSON.parse(await ev(`(() => {
  const vis = (e) => { if (!e) return false; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e)
    return b.width > 0 && b.height > 0 && cs.display !== 'none' }
  const drawer = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const navTab = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const sidebar = document.querySelector('[data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"]')
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const de = document.documentElement
  return JSON.stringify({
    media: { phone: matchMedia('(max-width: 768px), (max-height: 520px) and (pointer: coarse)').matches, coarse: matchMedia('(pointer: coarse)').matches },
    drawerVisible: vis(drawer), navTabVisible: vis(navTab),
    sidebarX: sidebar ? Math.round(sidebar.getBoundingClientRect().left) : null,
    frameGrid: frame ? getComputedStyle(frame).gridTemplateColumns : null,
    pageScroll: [de.scrollWidth, de.clientWidth],
  })
})()`))
console.log('  ' + JSON.stringify(land))
check(land.media.coarse === true, 'the emulated device reports a coarse pointer (as a phone does)', `coarse=${land.media.coarse}`)
check(land.media.phone === true, 'the phone condition matches a landscape phone', `phone=${land.media.phone}`)
check(land.drawerVisible === true, 'the mobile drawer is available in landscape', `drawerVisible=${land.drawerVisible}`)
check(land.navTabVisible === true, 'so is the 导航 entry', `navTabVisible=${land.navTabVisible}`)
check(land.sidebarX !== null && land.sidebarX <= -1000, 'the native sidebar is parked off-viewport', `left=${land.sidebarX}`)
check(land.pageScroll[0] <= land.pageScroll[1] + 1, 'the landscape layout does not scroll sideways', `scrollWidth ${land.pageScroll[0]} vs ${land.pageScroll[1]}`)

// The touch layers must be active here too: message actions reach 44px. The row
// belongs to a message, and in a 412px-tall landscape viewport the transcript can
// be scrolled far past it, so bring it into view first — a point outside the
// viewport hits nothing, which would look like a missing hit layer.
const reach = JSON.parse(await ev(`(() => {
  const btn = document.querySelector('[data-slot="conversation.chat.node"] button[class*="_action"], [data-slot="conversation.chat.assistant-actions"] button')
  if (!btn) return JSON.stringify({ missing: true })
  btn.scrollIntoView({ block: 'center' })
  const b = btn.getBoundingClientRect()
  if (b.top < 0 || b.bottom > innerHeight) return JSON.stringify({ missing: 'off-screen even after scrollIntoView' })
  const hits = (x, y) => { const t = document.elementFromPoint(x, y); return t === btn || (t !== null && btn.contains(t)) }
  const walk = (dx, dy) => { let n = 0; while (n < 40 && hits(b.left + b.width / 2 + dx * (n + 1), b.top + b.height / 2 + dy * (n + 1))) n += 1; return n }
  return JSON.stringify({ painted: [Math.round(b.width), Math.round(b.height)], hit: [walk(-1, 0) + walk(1, 0), walk(0, -1) + walk(0, 1)] })
})()`))
console.log('  message action:', JSON.stringify(reach))
check(reach.missing !== true && reach.hit[1] >= 43, 'the touch hit layers are active in landscape too', `hit=${reach.hit}`)

// ...and so must the settings dialog's touch layer.
await ev(`document.querySelector('[data-slot="sidebar.settings"] button')?.click()`)
await sleep(1000)
const dialog = JSON.parse(await ev(`(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return JSON.stringify({ missing: true })
  const close = d.querySelector('[class*="_close"]')
  if (!close) return JSON.stringify({ missing: 'close' })
  const b = close.getBoundingClientRect()
  const hits = (y) => { const t = document.elementFromPoint(b.left + b.width / 2, y); return t === close || (t !== null && close.contains(t)) }
  let up = 0; while (up < 20 && hits(b.top - up - 1)) up += 1
  let down = 0; while (down < 20 && hits(b.bottom + down + 1)) down += 1
  return JSON.stringify({ painted: [Math.round(b.width), Math.round(b.height)], reach: Math.round(b.height) + up + down })
})()`))
console.log('  settings close:', JSON.stringify(dialog))
check(dialog.missing === undefined && dialog.reach >= 43, 'the settings close button keeps a touch target in landscape', JSON.stringify(dialog))

await send('Emulation.setTouchEmulationEnabled', { enabled: false })
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: swipe switches settings pages, and a landscape phone keeps the mobile surfaces')
process.exit(0)
