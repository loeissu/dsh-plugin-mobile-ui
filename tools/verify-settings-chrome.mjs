/**
 * Verify the phone layout of the HOST settings dialog (the surface this plugin
 * re-styles via settings-chrome.ts).
 *
 * Two defects came from the same root: tether turns the nav into a horizontal
 * strip *below* the title row on a phone, which the desktop layout never has to
 * survive. Measured before the fix at 412x915:
 *
 *   title row    22px tall, holding a 32px close and a 28px 打开配置文件 button,
 *                so both overflowed ~18px ONTO the tab strip (the × covered the
 *                selected 移动端 pill in the reported screenshot);
 *   nav strip    453px of content in a 392px strip -> horizontal scrolling, and
 *                because the selected tab is scrolled into view the FIRST tab was
 *                clipped (通用设置 rendered as 设置).
 *
 * Usage: node tools/verify-settings-chrome.mjs <url>
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

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

/** Measure the dialog at whatever size the emulation is currently set to. */
const measure = async () => JSON.parse(await ev(`(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect()
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) } }
  const d = document.querySelector('[role="dialog"]')
  if (!d) return JSON.stringify({ missing: true })
  const title = d.querySelector('[class*="_navTitle"]')
  const list = d.querySelector('[class*="_navList"]')
  const close = d.querySelector('[class*="_close"]')
  const openConfig = [...d.querySelectorAll('button')].find((b) => /配置文件/.test(b.textContent || ''))
  const cells = [...d.querySelectorAll('[class*="_navCell"]')]
  const strip = list ? getComputedStyle(list).flexDirection === 'row' : false
  return JSON.stringify({
    vw: innerWidth, strip,
    title: r(title), list: r(list), close: r(close), openConfig: r(openConfig),
    cells: cells.length,
    listScroll: list ? [list.scrollWidth, list.clientWidth, list.scrollLeft] : null,
    firstClipped: cells.length && list ? cells[0].getBoundingClientRect().left < list.getBoundingClientRect().left - 1 : null,
    lastInside: cells.length && list ? cells[cells.length - 1].getBoundingClientRect().right <= list.getBoundingClientRect().right + 1 : null,
  })
})()`))

// Every phone width the plugin claims to support, not just the one that was reported.
for (const width of [320, 360, 412, 430]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 2, mobile: true })
  await sleep(900)
  await ev(`document.querySelector('[data-slot="sidebar.settings"] button')?.click()`)
  await sleep(900)
  // Select the LAST tab: that is the case that scrolls the strip in the host's own
  // behaviour if the five cells do not fit.
  await ev(`(() => {
    const cells = [...document.querySelectorAll('[role="dialog"] [class*="_navCell"]')]
    const last = cells[cells.length - 1]
    if (last) last.click()
    return cells.length
  })()`)
  await sleep(700)

  const m = await measure()
  console.log(`\n@${width}: ${JSON.stringify({ title: m.title, list: m.list, cells: m.cells, listScroll: m.listScroll, firstClipped: m.firstClipped, lastInside: m.lastInside })}`)
  if (m.missing === true) { check(false, `@${width} the settings dialog opens`); continue }
  const stripTop = m.list.y
  check(m.close.bottom <= stripTop, `@${width} the close button does not reach the tab strip`, `close ends ${m.close.bottom}, strip starts ${stripTop}`)
  check(m.openConfig.bottom <= stripTop, `@${width} 打开配置文件 does not reach the tab strip`, `ends ${m.openConfig.bottom}, strip starts ${stripTop}`)
  check(m.title.h >= 44, `@${width} the title row has room for its own controls`, `height ${m.title.h}px`)
  check(m.listScroll[0] <= m.listScroll[1] + 1, `@${width} the five tabs fit without horizontal scrolling`,
    `content ${m.listScroll[0]}px in ${m.listScroll[1]}px`)
  check(m.lastInside === true, `@${width} the last tab is fully inside the strip`, `lastInside=${m.lastInside}`)
  check(m.firstClipped === false, `@${width} the first tab is not clipped at the left edge`, `firstClipped=${m.firstClipped}`)
  check(m.listScroll[2] <= 1, `@${width} the strip is not scrolled`, `scrollLeft ${m.listScroll[2]}`)
  if (m.strip) check(m.cells === 5, `@${width} all five sections are present`, `${m.cells} cells`)

  await ev(`[...document.querySelectorAll('[role="dialog"] button')].find(b => /关闭/.test(b.getAttribute('aria-label') || ''))?.click()`)
  await sleep(400)
}

// The close button's own reach, measured once at phone width.
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await sleep(700)
await ev(`document.querySelector('[data-slot="sidebar.settings"] button')?.click()`)
await sleep(900)
const closeReach = await ev(`(() => {
  const close = document.querySelector('[role="dialog"] [class*="_close"]')
  if (!close) return -1
  const b = close.getBoundingClientRect()
  const hits = (x, y) => { const el = document.elementFromPoint(x, y); return el === close || (el !== null && close.contains(el)) }
  let up = 0; while (up < 30 && hits(b.left + b.width / 2, b.top - up - 1)) up += 1
  let down = 0; while (down < 30 && hits(b.left + b.width / 2, b.bottom + down + 1)) down += 1
  return Math.round(b.height) + up + down
})()`)
console.log(`\nclose reach by pixel walk: ${closeReach}px`)
check(closeReach >= 40, 'the close button keeps a usable reach', `${closeReach}px tall`)

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: host settings dialog fits every phone width without the controls colliding with the tab strip')
process.exit(0)

