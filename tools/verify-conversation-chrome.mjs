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
  // These elements are SESSION-STATE dependent: the "/" separator, the mode chip and
  // the subagents chip only exist in the header while the session has them. Absence
  // satisfies the requirement (nothing extra visible, nothing cut), so the assertions
  // are about visibility, not existence — otherwise the suite fails on a plain
  // session for reasons that have nothing to do with the plugin.
  const absent = (v) => v === 'absent' || v === null
  check(m.separator === 'none' || m.separator === 'absent',
    `@${width} the decorative "/" separator is not visible`,
    `display=${m.separator}${m.separator === 'absent' ? ' (not present in this session)' : ''}`)
  check(m.modeLabel === 'none' || m.modeLabel === 'absent',
    `@${width} the duplicated mode chip is not visible`,
    `display=${m.modeLabel}${m.modeLabel === 'absent' ? ' (not present in this session)' : ''}`)
  check(m.chipClippedBy === 0 || absent(m.chipClippedBy),
    `@${width} the subagents chip is not cut mid-word`,
    `clipped ${m.chipClippedBy}px${absent(m.chipClippedBy) ? ' (chip not present in this session)' : ''}`)
  check(m.crumbClippedBy <= 20, `@${width} the session title loses at most 20px`, `clipped ${m.crumbClippedBy}px`)
  // The title's absolute width is SESSION-STATE dependent (a subagent session, a
  // deliverables chip or a plan chip all change the row), so a fixed floor measured
  // the open session, not this plugin: it read 226px on one session and 76px on
  // another with the same code. What the module actually promises is that the title
  // gets MORE room than the host's own layout would give it, so this is an A/B at one
  // instant — measure, take our sheets out, measure again — and the assertion is
  // "never worse, and better wherever our hiders actually apply".
  const stripped = JSON.parse(await ev(`(() => {
    const tags = [...document.querySelectorAll('style[data-plugin="dsh-plugin-mobile-ui"]')]
    const saved = tags.map((t) => [t.dataset.pluginCss, t.textContent])
    tags.forEach((t) => t.remove())
    const crumbs = document.querySelector('[data-slot="conversation.session.header"] [class*="_crumbs"]')
    const width = crumbs ? Math.round(crumbs.getBoundingClientRect().width) : null
    for (const [id, css] of saved) {
      const again = document.createElement('style')
      again.dataset.plugin = 'dsh-plugin-mobile-ui'
      again.dataset.pluginCss = id
      again.textContent = css
      document.head.append(again)
    }
    return JSON.stringify({ width, saved: saved.length })
  })()`))
  const roomier = m.crumbsWidth !== null && stripped.width !== null && m.crumbsWidth >= stripped.width - 1
  console.log(`  title container: ours ${m.crumbsWidth}px vs host-only ${stripped.width}px`)
  check(roomier, `@${width} our rules never give the title less room than the host layout`,
    `ours=${m.crumbsWidth}px host=${stripped.width}px`)
  const hidesSomething = m.separator === 'none' || m.modeLabel === 'none' ||
    (m.chipClippedBy !== null && m.chipClippedBy === 0 && stripped.width !== null)
  if (hidesSomething && m.crumbsWidth !== null && stripped.width !== null && m.crumbsWidth > stripped.width) {
    check(true, `@${width} and they give it measurably more room in this session`,
      `+${m.crumbsWidth - stripped.width}px`)
  }
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
