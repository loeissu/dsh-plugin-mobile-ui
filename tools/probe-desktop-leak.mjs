/**
 * Does the drawer leak into the page on a desktop-width viewport?
 *
 * The component registers into `shell.overlay` unconditionally, but every rule
 * that styles it lives inside `@media (max-width: 768px)`. On a wide screen none
 * of those rules apply, so unless something also hides it, the drawer's DOM —
 * trigger, scrim, and the whole workspace/session list — renders as unstyled
 * content in the document flow.
 *
 * Reported from a desktop browser: stray text at the bottom of the page.
 *
 * This measures the drawer root's computed box at both widths, and whether its
 * content is actually painted (visible, with a non-zero box) rather than merely
 * present in the DOM.
 *
 * Usage: node tools/probe-desktop-leak.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-desktop-leak.mjs <url> [--cdp <url>]')
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

const STATE = `(() => {
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const trigger = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const body = panel ? panel.querySelector('.dsh-mobile-drawer-body') : null
  const box = (el) => {
    if (el === null) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      display: cs.display,
      position: cs.position,
      visibility: cs.visibility,
      opacity: cs.opacity,
      pointerEvents: cs.pointerEvents,
      // A rendered box: non-zero size AND not display:none / visibility:hidden.
      painted: cs.display !== 'none' && cs.visibility !== 'hidden'
        && (r.width > 0 || r.height > 0),
      w: Math.round(r.width),
      h: Math.round(r.height),
      top: Math.round(r.top),
    }
  }
  return JSON.stringify({
    viewport: window.innerWidth + 'x' + window.innerHeight,
    narrow: window.innerWidth <= 768,
    root: box(root),
    panel: box(panel),
    trigger: box(trigger),
    body: box(body),
    // Where the leaked text sits, if any.
    bodyTextLength: root ? (root.textContent || '').trim().length : null,
    textSample: root ? (root.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90) : null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')

// ── desktop first, since that is where the leak was reported ───────────────
console.log('== A. desktop viewport 1440x900 ==')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: appUrl })
await sleep(9000)
const desktop = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(desktop, null, 1)}`)

// ── then phone width, which must keep working ─────────────────────────────
console.log('\n== B. phone viewport 412x560 ==')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 560, deviceScaleFactor: 2, mobile: true })
await sleep(1500)
const phone = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(phone, null, 1)}`)

ws.close()
process.exit(0)
