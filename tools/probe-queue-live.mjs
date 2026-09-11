/**
 * Reproduce the squashed queued-message bar on the live instance, then name the
 * rule that squashes it.
 *
 * The bar only exists while the agent is running AND a message is queued, so an
 * idle page shows nothing (measured: `[data-queue-dock]` absent, height 0 on the
 * composer dock slot). This opens the most recent session first — which is the
 * running one — and only then inspects.
 *
 * Once the dock is present, `CSS.getMatchedStylesForNode` lists every rule that
 * applies, with selector, origin and the declared properties that control size.
 * That identifies the culprit directly rather than by inference.
 *
 * Usage: node tools/probe-queue-live.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-queue-live.mjs <url> [--cdp <url>]')
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
await send('DOM.enable')
await send('CSS.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(10000)

// ── open the running session via this plugin's own drawer ──────────────────
console.log('\n== opening the most recent session ==')
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(2000)
const rows = await evaluate(`(() => {
  const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]
  return JSON.stringify(rs.slice(0, 4).map((r) => (r.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 44)))
})()`)
console.log(`  rows: ${rows}`)
const clicked = await evaluate(`(() => {
  const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]
  if (rs.length === 0) return 'none'
  const label = (rs[0].textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
  rs[0].click()
  return label
})()`)
console.log(`  clicked: ${clicked}`)
// The drawer closes itself on click; give the transcript and any dock time to settle.
await sleep(9000)

// ── now look for the dock ──────────────────────────────────────────────────
console.log('\n== composer stack contents ==')
console.log(await evaluate(`(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  if (stack === null) return 'no composerStack'
  const docks = ['conversation.composer.dock', 'conversation.input.dock', 'conversation.composer.bar', 'conversation.input.overlay']
  return JSON.stringify({
    stackH: Math.round(stack.getBoundingClientRect().height),
    dockSlots: docks.map((s) => {
      const el = document.querySelector('[data-slot="' + s + '"]')
      if (el === null) return { slot: s, present: false }
      const r = el.getBoundingClientRect()
      return {
        slot: s,
        present: true,
        h: Math.round(r.height),
        w: Math.round(r.width),
        children: el.children.length,
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 44),
        firstChildCls: el.firstElementChild ? (el.firstElementChild.className || '').toString().slice(0, 44) : null,
        firstChildH: el.firstElementChild ? Math.round(el.firstElementChild.getBoundingClientRect().height) : null,
      }
    }),
    queueAttr: document.querySelector('[data-queue-dock]') ? document.querySelector('[data-queue-dock]').getAttribute('data-queue-dock') : null,
  }, null, 1)
})()`))

ws.close()
process.exit(0)
