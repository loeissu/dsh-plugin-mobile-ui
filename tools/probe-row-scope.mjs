/**
 * Scope the damage before writing a counter-rule.
 *
 * The queue row is confirmed broken: tether's `[class*="_row"]` rule forces
 * `flex-wrap: wrap`, and the row's 36px scrolling parent clips its 86px of
 * wrapped content. But `_row` is a CSS-Module local-name suffix that appears
 * across many DSH packages, so a blanket counter-rule of `flex-wrap: nowrap`
 * would be wrong wherever DSH itself intends wrapping.
 *
 * This enumerates EVERY `_row` element inside the composer region — the area
 * where tether's narrow-screen sheet does its damage — and reports, for each, the
 * computed `flex-wrap` with tether's sheet enabled and disabled. The pairs give
 * DSH's own intent, so a counter-rule can be limited to the rows tether actually
 * changed away from it.
 *
 * Usage: node tools/probe-row-scope.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-row-scope.mjs <url> [--cdp <url>]')
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

/**
 * Every `_row` inside the composer region, identified by a stable index so the
 * same set can be re-read after toggling tether's sheet.
 */
const ROWS = `(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  if (stack === null) return JSON.stringify({ missing: true })
  const rows = [...stack.querySelectorAll('[class*="_row"]:not([class*="rowText"])')]
  rows.forEach((el, i) => { el.setAttribute('data-row-probe', String(i)) })
  return JSON.stringify({
    count: rows.length,
    rows: rows.map((el, i) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        i,
        cls: (el.className || '').toString().slice(0, 40),
        flexWrap: cs.flexWrap,
        display: cs.display,
        childCount: el.children.length,
        // Distinct top offsets reveal wrapping: one line means all equal.
        childTops: [...el.children].map((c) => Math.round(c.getBoundingClientRect().top)),
        h: Math.round(r.height),
        clipped: el.scrollHeight > el.clientHeight + 1,
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 32),
      }
    }),
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(10000)

await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(2000)
await evaluate(`(() => { const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]; if (rs[0]) rs[0].click(); return 'ok' })()`)
await sleep(9000)

console.log('\n== WITH tether ==')
const withTether = JSON.parse(await evaluate(ROWS))
if (withTether.missing) {
  console.log('  no composerStack')
  ws.close()
  process.exit(1)
}
console.log(`  ${withTether.count} row(s)`)
for (const r of withTether.rows) {
  console.log(`  [${r.i}] ${r.cls.padEnd(30)} wrap=${r.flexWrap.padEnd(7)} h=${String(r.h).padStart(3)} children=${r.childCount} clipped=${r.clipped}  "${r.text}"`)
  console.log(`        child tops: ${JSON.stringify(r.childTops)}`)
}

console.log('\n== WITHOUT tether ==')
await evaluate(`(() => {
  const t = document.querySelector('style[data-dsh-tether]')
  if (t === null) return 'absent'
  window.__tetherTag = t
  t.disabled = true
  return 'disabled'
})()`)
await sleep(1000)
const without = JSON.parse(await evaluate(ROWS))
for (const r of without.rows) {
  console.log(`  [${r.i}] ${r.cls.padEnd(30)} wrap=${r.flexWrap.padEnd(7)} h=${String(r.h).padStart(3)} children=${r.childCount} clipped=${r.clipped}  "${r.text}"`)
  console.log(`        child tops: ${JSON.stringify(r.childTops)}`)
}

await evaluate(`(() => { const t = window.__tetherTag; if (t) t.disabled = false; return 'restored' })()`)
await sleep(600)

console.log('\n== changed by tether ==')
for (const a of withTether.rows) {
  const b = without.rows.find((x) => x.i === a.i)
  if (b === undefined) continue
  if (a.flexWrap !== b.flexWrap) {
    console.log(`  [${a.i}] ${a.cls}`)
    console.log(`        wrap: ${a.flexWrap} -> ${b.flexWrap}   height: ${a.h} -> ${b.h}   clipped: ${a.clipped} -> ${b.clipped}`)
    console.log(`        "${a.text}"`)
  }
}
console.log('\n  (rows not listed are untouched by tether and must not be overridden)')

ws.close()
process.exit(0)
