/**
 * Investigate the squashed queued-message bar above the composer.
 *
 * Two things are checked, in this order, because the second is only worth
 * pursuing if the first is ruled out.
 *
 * 1. Is the keyboard-fit override engaged when no keyboard is present?
 *
 *    That would be the explanation: the override pins the app frame to
 *    `visualViewport.height`, and on a phone with edge-to-edge there can be a
 *    PERSISTENT difference between `window.innerHeight` and
 *    `visualViewport.height` from the system bars alone. A 60px threshold would
 *    read that as a keyboard, shrink the frame permanently, and any flex child
 *    that can shrink would be compressed — the composer stack being the first
 *    place that shows.
 *
 * 2. What does the queue area's own layout look like?
 *
 *    If the override is NOT engaged, the compression has another cause and the
 *    measurement should say what it is (fixed height, flex-shrink, overflow).
 *
 * Usage: node tools/probe-queue-bar.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-queue-bar.mjs <url> [--cdp <url>]')
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

// ── 1. is the override engaged at rest? ────────────────────────────────────
console.log('\n== 1. keyboard-fit state at rest (no keyboard) ==')
console.log(await evaluate(`(() => {
  const de = document.documentElement
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const innerH = window.innerHeight
  const vvH = window.visualViewport ? window.visualViewport.height : null
  return JSON.stringify({
    innerHeight: innerH,
    visualViewportHeight: vvH === null ? null : Math.round(vvH),
    difference: vvH === null ? null : Math.round(innerH - vvH),
    threshold: 60,
    wouldEngage: vvH === null ? false : (innerH - vvH) > 60,
    varHeight: de.style.getPropertyValue('--dsh-mobile-vv-height') || '(unset)',
    varTop: de.style.getPropertyValue('--dsh-mobile-vv-top') || '(unset)',
    frameHeight: frame ? Math.round(frame.getBoundingClientRect().height) : null,
    variableResolved: getComputedStyle(frame).height,
  }, null, 1)
})()`))

// ── 2. the composer stack, and what can shrink ─────────────────────────────
console.log('\n== 2. composer stack geometry ==')
console.log(await evaluate(`(() => {
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const centre = frame ? frame.querySelector(':scope > [class*="centerCol"]') : null
  if (!centre) return 'no centre column'
  // Walk the composer and everything above it inside the centre column.
  const stack = []
  const walk = (el, depth) => {
    if (depth > 4) return
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (r.height < 400) {
      stack.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().split(' ')[0].slice(0, 34),
        h: Math.round(r.height),
        flex: cs.flex,
        flexShrink: cs.flexShrink,
        minHeight: cs.minHeight,
        overflow: cs.overflowY,
        position: cs.position,
      })
    }
    for (const child of el.children) walk(child, depth + 1)
  }
  walk(centre, 0)
  return JSON.stringify({
    centre: { h: Math.round(centre.getBoundingClientRect().height), display: getComputedStyle(centre).display, flex: getComputedStyle(centre).flex },
    // The last few entries are the composer's ancestors, which is the area in
    // question.
    bottom: stack.slice(-14),
  }, null, 1)
})()`))

// ── 3. does a queued message area exist, and how tall is it? ───────────────
console.log('\n== 3. queue area ==')
console.log(await evaluate(`(() => {
  const holes = ['conversation.composer.dock', 'conversation.input.dock']
  const out = {}
  for (const h of holes) {
    const el = document.querySelector('[data-slot="' + h + '"]')
    if (el === null) { out[h] = 'absent'; continue }
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    out[h] = { h: Math.round(r.height), flex: cs.flex, flexShrink: cs.flexShrink, minHeight: cs.minHeight, overflow: cs.overflowY }
  }
  return JSON.stringify(out, null, 1)
})()`))

ws.close()
process.exit(0)
