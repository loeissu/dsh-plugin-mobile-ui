/**
 * Does a real touch drag scroll the drawer body?
 *
 * Previous attempts were inconclusive, so this one is built as a controlled
 * experiment rather than a single measurement:
 *
 *  - `Input.dispatchTouchEvent` drives the browser's real input path
 *    (touchstart/touchmove/touchend), unlike a synthesized scroll gesture whose
 *    behaviour under headless is not trustworthy, and unlike hand-dispatched
 *    TouchEvents, which do not trigger native scrolling at all.
 *  - The SAME gesture is first applied to a control scroller — the conversation
 *    transcript, which is known to scroll — so a null result in the drawer can be
 *    attributed to the drawer rather than to the method.
 *
 * If the control scrolls and the drawer does not, the drawer is at fault. If
 * neither scrolls, the method is at fault and no conclusion follows.
 *
 * Usage: node tools/verify-touch-scroll.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/verify-touch-scroll.mjs <url> [--cdp <url>]')
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
 * Drag a finger upwards from yStart, in steps, through the real input channel.
 * @param x - horizontal position.
 * @param yStart - where the finger lands.
 * @param distance - how far to travel; positive scrolls content up (reveals below).
 */
async function touchDrag(x, yStart, distance) {
  const steps = 12
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: yStart }],
  })
  for (let i = 1; i <= steps; i += 1) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: yStart - (distance * i) / steps }],
    })
    await sleep(16)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(700)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 560, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// ── control: the conversation transcript, which is known to scroll ──────────
// Two preconditions, both learned the hard way:
//  - touch emulation must be ON, or the synthetic touch stream is not a touch input
//    source and no native scroll ever starts;
//  - the control must be at the TOP of its range, because the gesture drags content
//    upward (scrollTop increases) and a transcript parked at the bottom of a long
//    session cannot move — that is what made this control report "no scroll" and
//    stopped the run before it ever reached the drawer.
// A third, found later: a HIDDEN page never acknowledges Input.dispatchTouchEvent at
// all (measured: with document.hidden true every dispatch timed out while evaluates
// answered in 1ms, and Page.bringToFront did not help). Focus emulation clears it.
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
const control = JSON.parse(await evaluate(`(() => {
  const el = [...document.querySelectorAll('*')].find((e) => {
    const s = getComputedStyle(e)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 40
  })
  if (!el) return JSON.stringify({ found: false })
  el.scrollTop = 0
  const r = el.getBoundingClientRect()
  el.setAttribute('data-probe-control', '1')
  return JSON.stringify({ found: true, cls: (el.className || '').toString().split(' ')[0].slice(0, 34), x: Math.round(r.x + r.width / 2), y: Math.round(r.bottom - 40), overflow: el.scrollHeight - el.clientHeight, scrollTop: Math.round(el.scrollTop) })
})()`))
console.log(`\n== control scroller ==\n  ${JSON.stringify(control)}`)

if (control.found) {
  await touchDrag(control.x, control.y, 180)
  const after = await evaluate(`document.querySelector('[data-probe-control]').scrollTop`)
  console.log(`  control scrollTop: ${control.scrollTop} -> ${Math.round(after)}`)
  const controlWorks = after > control.scrollTop
  console.log(`  ${controlWorks ? 'PASS' : 'FAIL'}  the control scroller responds to a touch drag`)
  if (!controlWorks) {
    console.log('\n  The method itself does not drive scrolling here, so no conclusion')
    console.log('  can be drawn about the drawer. Stopping.')
    await evaluate(`document.querySelector('[data-probe-control]')?.removeAttribute('data-probe-control')`)
    ws.close()
    process.exit(2)
  }
}

// ── the drawer ──────────────────────────────────────────────────────────────
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(1500)

const body = JSON.parse(await evaluate(`(() => {
  const el = document.querySelector('[data-dsh-mobile-ui="drawer-panel"] .dsh-mobile-drawer-body')
  if (!el) return JSON.stringify({ found: false })
  el.setAttribute('data-probe-drawer', '1')
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return JSON.stringify({
    found: true,
    x: Math.round(r.x + r.width / 2),
    y: Math.round(r.bottom - 40),
    overflow: el.scrollHeight - el.clientHeight,
    scrollTop: Math.round(el.scrollTop),
    touchAction: cs.touchAction,
    overscroll: cs.overscrollBehaviorY,
  })
})()`))
console.log(`\n== drawer body ==\n  ${JSON.stringify(body)}`)

if (!body.found) {
  console.log('  drawer body missing')
  ws.close()
  process.exit(1)
}

await touchDrag(body.x, body.y, 180)
const afterDrawer = await evaluate(`document.querySelector('[data-probe-drawer]').scrollTop`)
console.log(`  drawer scrollTop: ${body.scrollTop} -> ${Math.round(afterDrawer)}`)
const drawerWorks = afterDrawer > body.scrollTop

console.log('')
console.log(`  ${drawerWorks ? 'PASS' : 'FAIL'}  the drawer scrolls under a touch drag`)
console.log(`  (overflow was ${body.overflow}px; touch-action=${body.touchAction}, overscroll=${body.overscroll})`)

await evaluate(`document.querySelector('[data-probe-drawer]')?.removeAttribute('data-probe-drawer')`)
ws.close()
process.exit(drawerWorks ? 0 : 1)
