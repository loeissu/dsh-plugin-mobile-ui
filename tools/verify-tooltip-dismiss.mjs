/**
 * Verify that a host hover tooltip does not stick on a phone.
 *
 * The bug: a tap synthesises `pointerenter` but never `pointerleave`, so the host's
 * hover tooltip opens and nothing closes it. Measured before the fix, after tapping
 * 复制 at 412x915: a visible `span._bubble[role="tooltip"]` at 1.2s, 3s, 6s and 8s,
 * positioned over the composer (reported from a device with a screenshot).
 *
 * The fix reports the leave the host already listens for, so the assertions are:
 *  - on a phone, no visible tooltip is left after the interaction;
 *  - on a desktop the behaviour is untouched (a mouse dismisses by moving, and this
 *    plugin must not change that) — the tooltip is still there.
 *
 * Usage: node tools/verify-tooltip-dismiss.mjs <url>
 */
const appUrl = process.argv[2]
const cdp = 'http://127.0.0.1:9222'
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page' && x.url.includes('3080'))
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map(); let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id
  const timer = setTimeout(() => { if (p.has(i)) { p.delete(i); reject(new Error(`CDP timeout: ${method}`)) } }, 15000)
  p.set(i, (m) => { clearTimeout(timer); resolve(m) })
  ws.send(JSON.stringify({ id: i, method, params }))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description).slice(0, 220)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const VISIBLE = `(() => {
  const tips = [...document.querySelectorAll('[role="tooltip"]')].filter((e) => {
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  })
  return JSON.stringify({ count: tips.length, text: tips[0] ? (tips[0].textContent || '').trim().slice(0, 12) : null })
})()`

const boot = async ({ touch, width, height }) => {
  // A hidden page never acknowledges `Input.dispatchTouchEvent`: measured, the tab
  // reported document.hidden true and every touch dispatch timed out while the page
  // itself answered evaluates in 1ms, and `Page.bringToFront` did NOT help. Focus
  // emulation clears document.hidden and the same dispatch acks in ~10ms, so this
  // suite works whether the browser window is visible or not.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: touch ? 2 : 1, mobile: touch })
  await send('Page.navigate', { url: appUrl })
  await sleep(9000)
  await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
  await sleep(1200)
  await ev(`document.querySelector('.dsh-mobile-sess')?.click()`)
  await sleep(4500)
}

/** Record every tooltip appearance while the interaction settles. */
const watch = () => ev(`(() => {
  window.__tips = { appeared: 0, last: null }
  const scan = () => {
    const tips = [...document.querySelectorAll('[role="tooltip"]')].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && getComputedStyle(e).visibility !== 'hidden'
    })
    if (tips.length > 0) { window.__tips.appeared += 1; window.__tips.last = (tips[0].textContent || '').trim().slice(0, 12) }
  }
  window.__tipTimer = setInterval(scan, 100)
  return 'watching'
})()`)

const tapCopy = async () => {
  const at = JSON.parse(await ev(`(() => {
    const btn = [...document.querySelectorAll('button, [role="button"]')]
      .filter((x) => /复制/.test(x.getAttribute('aria-label') || '')).pop()
    if (!btn) return JSON.stringify({ missing: true })
    btn.scrollIntoView({ block: 'center' })
    const r = btn.getBoundingClientRect()
    return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)])
  })()`))
  if (at.missing === true) return false
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at[0], y: at[1], id: 1 }] })
  await sleep(70)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return true
}

await send('Runtime.enable'); await send('Page.enable')

console.log('## 1. phone: the tooltip must not be left behind')
await boot({ touch: true, width: 412, height: 915 })
await watch()
if (!await tapCopy()) { console.log('FAIL  no copy control in this session'); process.exit(1) }
const seen = []
for (const ms of [800, 1600, 2600, 4600]) {
  await sleep(ms === 800 ? 800 : 800)
  seen.push({ ms, ...JSON.parse(await ev(VISIBLE)) })
}
console.log('  samples:', JSON.stringify(seen))
const final = seen[seen.length - 1]
const watches = JSON.parse(await ev(`(() => { clearInterval(window.__tipTimer); return JSON.stringify(window.__tips) })()`))
console.log('  tooltip appearances during the window:', JSON.stringify(watches))
check(final.count === 0, 'no tooltip is left on screen 4.6s after the tap', `count=${final.count} text=${final.text}`)
check(watches.appeared > 0,
  'a tooltip did appear during the interaction (so this is not a vacuous pass)',
  `${watches.appeared} samples, last="${watches.last}"`)

console.log('\n## 2. desktop: the host behaviour is untouched')
await boot({ touch: false, width: 1440, height: 900 })
await watch()
await tapCopy()
await sleep(2600)
const desktop = JSON.parse(await ev(VISIBLE))
const desktopWatches = JSON.parse(await ev(`(() => { clearInterval(window.__tipTimer); return JSON.stringify(window.__tips) })()`))
console.log('  desktop sample:', JSON.stringify(desktop), 'appearances:', JSON.stringify(desktopWatches))
check(desktopWatches.appeared > 0, 'the desktop tooltip still opens', `${desktopWatches.appeared} samples`)
check(desktop.count > 0, 'and this plugin does not dismiss it there (a mouse does that by moving)', `count=${desktop.count}`)

await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: hover tooltips no longer stick on a phone, and desktop is untouched')
process.exit(0)
