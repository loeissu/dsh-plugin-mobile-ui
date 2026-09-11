/**
 * A/B confirmation that dsh-tether's blanket `_row` rule squashes the queued bar.
 *
 * The measurement points at it: `li._7yHdaG_row` carries `flex-wrap: wrap`, its
 * content wants 86px, and its scrolling parent is only 36px tall, so the row is
 * clipped into a sliver. The class name contains `_row`, which is exactly what
 * tether matches on:
 *
 *   [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
 *
 * A measurement can only suggest that, because `wrap` could also be DSH's own
 * value. The decisive test is to remove tether's stylesheet and observe whether
 * the computed `flex-wrap` and the resulting box change. This does that, then
 * restores the sheet so the page is left as found.
 *
 * Usage: node tools/verify-tether-queue.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/verify-tether-queue.mjs <url> [--cdp <url>]')
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

/** The queue row, and the box chain that clips it. */
const MEASURE = `(() => {
  const li = document.querySelector('[data-slot="conversation.input.dock"] li')
  const ul = li ? li.parentElement : null
  if (li === null) return JSON.stringify({ missing: true })
  const cs = getComputedStyle(li)
  const ulCs = ul ? getComputedStyle(ul) : null
  const r = li.getBoundingClientRect()
  return JSON.stringify({
    liCls: (li.className || '').toString().slice(0, 40),
    liFlexWrap: cs.flexWrap,
    liDisplay: cs.display,
    liH: Math.round(r.height),
    liScrollH: li.scrollHeight,
    liClientH: li.clientHeight,
    liClipped: li.scrollHeight > li.clientHeight + 1,
    // How many lines the row's children occupy — a wrapped row is taller.
    liChildCount: li.children.length,
    liChildrenTop: [...li.children].map((c) => Math.round(c.getBoundingClientRect().top)),
    ulCls: ul ? (ul.className || '').toString().slice(0, 40) : null,
    ulOverflow: ulCs ? ulCs.overflow : null,
    ulClientH: ul ? ul.clientHeight : null,
    ulScrollH: ul ? ul.scrollHeight : null,
    ulClipped: ul ? ul.scrollHeight > ul.clientHeight + 1 : null,
    tetherPresent: document.querySelector('style[data-dsh-tether]') !== null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(10000)

// Open the running session, where the queue lives.
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(2000)
await evaluate(`(() => { const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]; if (rs[0]) rs[0].click(); return 'ok' })()`)
await sleep(9000)

console.log('\n== A. WITH tether stylesheet ==')
const withTether = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(withTether, null, 1)}`)

if (withTether.missing) {
  console.log('\n  no queued row present — nothing to test')
  ws.close()
  process.exit(0)
}

console.log('\n== B. tether stylesheet removed (disabled, then restored) ==')
await evaluate(`(() => {
  const t = document.querySelector('style[data-dsh-tether]')
  if (t === null) return 'absent'
  window.__tetherBackup = t.textContent
  window.__tetherTag = t
  t.disabled = true
  return 'disabled'
})()`)
await sleep(900)
const withoutTether = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(withoutTether, null, 1)}`)

// Restore.
await evaluate(`(() => {
  const t = window.__tetherTag
  if (t) t.disabled = false
  return 'restored'
})()`)
await sleep(600)
const restored = JSON.parse(await evaluate(MEASURE))
console.log(`\n  restored: flexWrap=${restored.liFlexWrap} liH=${restored.liH} tetherPresent=${restored.tetherPresent}`)

// ── verdict ────────────────────────────────────────────────────────────────
console.log('\n== verdict ==')
const changed = withTether.liFlexWrap !== withoutTether.liFlexWrap
console.log(`  flex-wrap  with tether: ${withTether.liFlexWrap}`)
console.log(`  flex-wrap without    : ${withoutTether.liFlexWrap}`)
console.log(`  row height with: ${withTether.liH}  without: ${withoutTether.liH}`)
console.log(`  clipped    with: ${withTether.liClipped}  without: ${withoutTether.liClipped}`)
console.log('')
if (changed) {
  console.log('  CONFIRMED: dsh-tether\'s [class*="_row"] rule is what changes this row.')
  console.log(`  Its blanket flex-wrap: wrap forces the queue row to wrap; the 36px`)
  console.log(`  scrolling parent then clips ${withTether.liScrollH}px of content into a sliver.`)
} else {
  console.log('  NOT confirmed: flex-wrap is unchanged without tether, so the wrap comes')
  console.log('  from DSH itself and the cause lies elsewhere.')
}

ws.close()
process.exit(changed ? 0 : 1)
