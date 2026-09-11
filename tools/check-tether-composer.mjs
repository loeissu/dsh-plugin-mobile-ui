/**
 * Does dsh-tether's injected narrow-screen CSS squeeze the composer area?
 *
 * The isolation gap again: every measurement so far ran in a profile with only
 * this plugin installed, so tether's injected stylesheet was absent. On the
 * phone it is present, and it contains rules broad enough to reach into DSH's
 * own composer:
 *
 *   [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
 *   [class*="rowText"] { flex: 1 1 100% !important; }
 *
 * `_row` and `rowText` are CSS-Module LOCAL names. tether documents that it
 * matches on them deliberately, because only the hash prefix changes between
 * builds — but the same suffix appears in many packages, so the rules reach far
 * beyond the settings dialog they were written for.
 *
 * So: inject tether's real rules, then check whether anything inside the composer
 * stack matches them and whether its box changes.
 *
 * Usage: node tools/check-tether-composer.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/check-tether-composer.mjs <url> [--cdp <url>]')
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]

/** tether's row rules, transcribed from its injectNarrowScreenCss. */
const TETHER_ROW_RULES = `
  [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
  [class*="rowText"] { flex: 1 1 100% !important; }
`

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
 * Elements matching tether's selectors, restricted to the composer area, with
 * the box each one has now.
 */
const PROBE = `(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  if (stack === null) return JSON.stringify({ missing: true })
  const matches = []
  for (const el of stack.querySelectorAll('*')) {
    const cls = (el.className || '').toString()
    if (cls.includes('_row') || cls.includes('rowText')) {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      matches.push({
        cls: cls.split(' ')[0].slice(0, 40),
        isRowText: cls.includes('rowText'),
        h: Math.round(r.height),
        w: Math.round(r.width),
        flexWrap: cs.flexWrap,
        flex: cs.flex,
        text: (el.textContent || '').trim().slice(0, 34),
      })
    }
  }
  const r = stack.getBoundingClientRect()
  return JSON.stringify({
    stackH: Math.round(r.height),
    stackW: Math.round(r.width),
    matchCount: matches.length,
    matches: matches.slice(0, 10),
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  await sleep(5000)
}

// A stand-in for a queued-message row inside the stack.
await evaluate(`(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  if (!document.getElementById('tether-fake')) {
    const fake = document.createElement('div')
    fake.id = 'tether-fake'
    // Deliberately uses a _row class so tether's rule can match it, which is the
    // question being asked.
    fake.className = 'probe_row'
    fake.style.cssText = 'display:flex;align-items:center;gap:8px;height:44px;flex:none;background:rgba(77,107,254,.12);border-radius:10px;margin:4px 0'
    fake.innerHTML = '<span class="probe_rowText" style="font-size:14px">queued message text that is reasonably long</span><button style="flex:none">×</button>'
    stack.prepend(fake)
  }
  return 'injected'
})()`)
await sleep(600)

console.log('\n== WITHOUT tether row rules ==')
console.log(await evaluate(PROBE))

console.log('\n== WITH tether row rules injected ==')
await evaluate(`(() => {
  let tag = document.getElementById('tether-rows')
  if (!tag) { tag = document.createElement('style'); tag.id = 'tether-rows'; document.head.append(tag) }
  tag.textContent = ${JSON.stringify(TETHER_ROW_RULES)}
  return 'applied'
})()`)
await sleep(700)
console.log(await evaluate(PROBE))

// Clean up.
await evaluate(`(() => {
  document.getElementById('tether-rows')?.remove()
  document.getElementById('tether-fake')?.remove()
  return 'cleaned'
})()`)

ws.close()
process.exit(0)
