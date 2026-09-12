/**
 * Verify the conversation-chrome layout rules at phone widths.
 *
 * Two things this plugin changes in the host's session header and metrics footer:
 *   - the title row gets its width back (the "/" separator and the mode chip go,
 *     and the subagents chip collapses to its icon), and
 *   - the metrics footer stops clipping its labels (the row's 32px side gutter is
 *     what squeezed them, not the font).
 *
 * Measured at 412x915 before the change: the title container was 118px of a 281px
 * string (59px clipped) and the metric label was 107px of 140px (33px clipped);
 * at 360 both were worse. Floors below are the measured post-change values, so a
 * regression that re-crowds the row fails here.
 *
 * Usage: node tools/verify-conversation-chrome.mjs <url>
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

const MEASURE = `(() => {
  const header = document.querySelector('[data-slot="conversation.session.header"]')
  const crumbs = header ? header.querySelector('[class*="_crumbs"]') : null
  const crumb = header ? header.querySelector('[class*="_crumb"]:not([class*="_crumbs"])') : null
  const chip = header ? header.querySelector('[class*="_trigger"]') : null
  const sep = header ? header.querySelector('[class*="_separator"]') : null
  const modeLabel = header ? header.querySelector('[class*="_headerActions"] [class*="_label"]') : null
  const dock = document.querySelector('[data-slot="conversation.composer.dock"]')
  const row = dock ? dock.firstElementChild : null
  const labels = [...document.querySelectorAll('[data-slot="conversation.composer.dock"] [class*="_label"]')]
  const clip = (e) => e ? e.scrollWidth - e.clientWidth : null
  return JSON.stringify({
    width: innerWidth,
    crumbsWidth: crumbs ? Math.round(crumbs.getBoundingClientRect().width) : null,
    crumbClippedBy: clip(crumb),
    chipClippedBy: clip(chip),
    separator: sep ? getComputedStyle(sep).display : 'absent',
    modeLabel: modeLabel ? getComputedStyle(modeLabel).display : 'absent',
    dockHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
    dockWrap: row ? getComputedStyle(row).flexWrap : null,
    labelClips: labels.map(clip),
    labelSizes: labels.map((e) => getComputedStyle(e).fontSize),
  })
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

for (const width of [412, 360]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 2, mobile: true })
  await sleep(900)
  const m = JSON.parse(await ev(MEASURE))
  console.log(`\nwidth ${width}: ${JSON.stringify(m)}`)
  check(m.separator === 'none', `@${width} the decorative "/" separator is gone`, `display=${m.separator}`)
  check(m.modeLabel === 'none', `@${width} the duplicated mode chip is gone`, `display=${m.modeLabel}`)
  check(m.chipClippedBy === 0, `@${width} the subagents chip is no longer cut mid-word`, `clipped ${m.chipClippedBy}px`)
  check(m.crumbClippedBy <= 20, `@${width} the session title loses at most 20px`, `clipped ${m.crumbClippedBy}px (was 59 at 412, 73 at 360)`)
  // Proportional floor: the row is narrower at 360, so an absolute number would
  // just be measuring the viewport. 45% of the width is comfortably above the old
  // 38% (412) and 29% (360).
  check(m.crumbsWidth >= Math.round(m.width * 0.45), `@${width} the title container keeps at least 45% of the width`,
    `${m.crumbsWidth}px of ${m.width} (was 158 of 412, 106 of 360)`)
  check(m.labelClips.every((c) => c === 0), `@${width} no metric label is clipped`, `clips ${JSON.stringify(m.labelClips)}`)
  check(m.labelSizes.every((s) => s === '12px'), `@${width} metric labels use the 12px caption step`, JSON.stringify(m.labelSizes))
  if (width === 412) {
    check(m.dockWrap === 'nowrap' && m.dockHeight <= 30, '@412 the metrics row stays on one line', `wrap=${m.dockWrap} height=${m.dockHeight}`)
  } else {
    check(m.dockWrap === 'wrap', '@360 the metrics row is allowed to wrap rather than cut', `wrap=${m.dockWrap} height=${m.dockHeight}`)
  }
}
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: session title room and metrics footer hold up at phone widths')
process.exit(0)
