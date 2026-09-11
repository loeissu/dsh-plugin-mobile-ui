/**
 * Verify the tether counter-rule restores the queued-message row.
 *
 * The claim is narrow and checkable: with tether's stylesheet active, the queue
 * row must return to its own layout (one line, not clipped) WITHOUT changing any
 * other `_row` in the composer.
 *
 * The control matters as much as the fix here. A blanket `flex-wrap: nowrap`
 * would also "fix" the queue row, while silently breaking the permission/model
 * row that DSH wraps on purpose — so this asserts both, and the second assertion
 * is what makes the selector's narrowness testable.
 *
 * Usage: node tools/verify-tether-compat.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/verify-tether-compat.mjs <url> [--cdp <url>]')
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

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const MEASURE = `(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  if (stack === null) return JSON.stringify({ missing: true })
  const rows = [...stack.querySelectorAll('[class*="_row"]:not([class*="rowText"])')]
  return JSON.stringify({
    tetherPresent: document.querySelector('style[data-dsh-tether]') !== null,
    compatPresent: document.querySelector('style#dsh-mobile-ui-tether-compat') !== null
      || [...document.querySelectorAll('style')].some((s) => (s.textContent || '').includes('conversation.input.dock')),
    rows: rows.map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const inDock = el.closest('[data-slot="conversation.input.dock"]') !== null
      // Lines cannot be counted by distinct top values. Children sharing one
      // flex line legitimately differ in top because they are aligned — measured
      // 756/760/763 for a SINGLE row — so that approach reported 3 lines for a
      // correct layout. Separate lines differ by about a line height, so lines
      // are counted by vertical overlap instead.
      const boxes = [...el.children].map((c) => c.getBoundingClientRect()).sort((p, q) => p.top - q.top)
      const lineTops = []
      for (const b of boxes) {
        if (lineTops.some((t) => Math.abs(t - b.top) < Math.max(b.height, 1))) continue
        lineTops.push(b.top)
      }
      return {
        cls: (el.className || '').toString().slice(0, 40),
        inDock,
        flexWrap: cs.flexWrap,
        h: Math.round(r.height),
        lines: lineTops.length,
        clipped: el.scrollHeight > el.clientHeight + 1,
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34),
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

// The queue only exists in a running session.
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(2000)
await evaluate(`(() => { const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]; if (rs[0]) rs[0].click(); return 'ok' })()`)
await sleep(9000)

const m = JSON.parse(await evaluate(MEASURE))
if (m.missing) {
  console.log('  no composerStack')
  ws.close()
  process.exit(1)
}
console.log(`\n  tether present: ${m.tetherPresent}`)
console.log(`  compat stylesheet: ${m.compatPresent}`)
for (const r of m.rows) {
  console.log(`  ${r.inDock ? '[dock]' : '[other]'} ${r.cls.padEnd(30)} wrap=${r.flexWrap.padEnd(7)} h=${String(r.h).padStart(3)} lines=${r.lines} clipped=${r.clipped}  "${r.text}"`)
}

const dockRows = m.rows.filter((r) => r.inDock)
const otherRows = m.rows.filter((r) => !r.inDock)

console.log('')
check(m.tetherPresent === true, 'tether stylesheet is active in this environment')
if (dockRows.length === 0) {
  console.log('  no queued row present right now — cannot verify the fix')
  console.log('  (the queue dock renders only while the agent runs with a message queued)')
} else {
  check(dockRows.every((r) => r.flexWrap === 'nowrap'),
    'the queue row is not force-wrapped', dockRows.map((r) => r.flexWrap).join(','))
  check(dockRows.every((r) => r.clipped === false),
    'the queue row is no longer clipped', dockRows.map((r) => `h=${r.h} clipped=${r.clipped}`).join(' '))
  check(dockRows.every((r) => r.lines === 1),
    'the queue row lays out on one line', dockRows.map((r) => `${r.lines} line(s)`).join(' '))
}
// The narrowness assertion: the counter-rule must NOT have reached other rows.
check(otherRows.every((r) => r.flexWrap === 'wrap'),
  'other composer rows keep their own wrap behaviour',
  otherRows.map((r) => `${r.cls}=${r.flexWrap}`).join(' ') || '(none present)')

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: the counter-rule fixes the queue row without touching other rows')
process.exit(0)
