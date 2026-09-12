/**
 * Diagnose intermittent keyboard / composer lift.
 *
 * Captures: viewport meta, live innerHeight vs visualViewport, our CSS
 * variables, competing frame-height rules, and whether a race would engage
 * or release the override.
 *
 * Usage: node tools/probe-keyboard-flap.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-keyboard-flap.mjs <url> [--cdp <url>]')
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

const SNAPSHOT = `(() => {
  const meta = document.querySelector('meta[name=viewport]')
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const de = document.documentElement
  const vv = window.visualViewport
  const rules = []
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) {
        const text = r.cssText || ''
        if ((text.includes('_frame') || text.includes('dsh-mobile-vv')) && (text.includes('height') || text.includes('top'))) {
          rules.push(text.slice(0, 220))
        }
      }
    } catch {}
  }
  const covered = vv ? window.innerHeight - vv.height : null
  return JSON.stringify({
    viewportMeta: meta ? meta.content : null,
    innerH: window.innerHeight,
    innerW: window.innerWidth,
    vvH: vv ? Math.round(vv.height) : null,
    vvW: vv ? Math.round(vv.width) : null,
    vvTop: vv ? Math.round(vv.offsetTop) : null,
    covered: covered === null ? null : Math.round(covered),
    wouldEngage: covered === null ? null : covered > 60,
    varH: de.style.getPropertyValue('--dsh-mobile-vv-height') || null,
    varTop: de.style.getPropertyValue('--dsh-mobile-vv-top') || null,
    frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
    frameTop: frame ? Math.round(frame.getBoundingClientRect().top) : null,
    rules: rules.slice(0, 12),
    screen: { h: window.screen?.height, w: window.screen?.width, availH: window.screen?.availHeight },
    outerH: window.outerHeight,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

console.log('\n== baseline snapshot ==')
console.log(await evaluate(SNAPSHOT))

// Race model: what if window.innerHeight also shrinks (resizes-content)?
// Sequence A: vv first (inner still full) then window catches up.
console.log('\n== race A: vv shrinks first, then innerHeight follows ==')
console.log(await evaluate(`(() => {
  // Do not mock; just document the decision table the plugin would take.
  const cases = [
    { name: 'vv-only shrink (resizes-visual)', inner: 915, vv: 500 },
    { name: 'both shrink (resizes-content)', inner: 500, vv: 500 },
    { name: 'vv first, inner lagging', inner: 915, vv: 500 },
    { name: 'inner first, vv lagging', inner: 500, vv: 500 },
    { name: 'edge-to-edge bars only', inner: 915, vv: 850 },
    { name: 'bars just over threshold', inner: 915, vv: 854 },
  ]
  return JSON.stringify(cases.map(c => ({
    ...c,
    covered: c.inner - c.vv,
    engage: (c.inner - c.vv) > 60,
  })), null, 1)
})()`))

// Open a session so composer exists, then force-shrink via our own vars to
// prove the CSS path, then release.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1000)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  await clickSession(evaluate, 0)
  await sleep(4000)
}

console.log('\n== force engage via CSS vars (no mock) ==')
console.log(await evaluate(`(() => {
  document.documentElement.style.setProperty('--dsh-mobile-vv-height', '500px')
  document.documentElement.style.setProperty('--dsh-mobile-vv-top', '0px')
  return 'set'
})()`))
await sleep(400)
console.log(await evaluate(SNAPSHOT))

console.log('\n== release ==')
console.log(await evaluate(`(() => {
  document.documentElement.style.removeProperty('--dsh-mobile-vv-height')
  document.documentElement.style.removeProperty('--dsh-mobile-vv-top')
  return 'released'
})()`))
await sleep(400)
console.log(await evaluate(SNAPSHOT))

ws.close()
process.exit(0)
