/**
 * Measure how the drawer's session titles handle long text.
 *
 * The report is that long text in the navigation drawer "does not scroll by
 * itself". Before changing anything, this establishes what the title element
 * actually does today and how much text goes unread, so the fix can be aimed at
 * a measured behaviour rather than a guess.
 *
 * Reports, for each visible session row:
 *   - the full title text
 *   - the box width vs the text width (how much is cut)
 *   - whether a tooltip (`title` attribute) exposes the rest
 * and compares against DSH's own sidebar row, which is still in the DOM even
 * though our CSS hides its column at this width.
 *
 * Usage: node tools/probe-nav-text.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-nav-text.mjs <url> [--cdp <url>]')
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
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 560, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(1500)

console.log('\n== OUR drawer: how each title is laid out ==')
console.log(await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]
  return JSON.stringify(rows.map((r) => {
    const t = r.querySelector('.dsh-mobile-sess-title')
    const cs = getComputedStyle(t)
    return {
      text: (t.textContent || '').trim(),
      chars: (t.textContent || '').trim().length,
      boxW: t.clientWidth,
      textW: t.scrollWidth,
      cutChars: t.scrollWidth > t.clientWidth ? '~' + Math.round((t.scrollWidth / Math.max(t.clientWidth, 1) - 1) * (t.textContent || '').trim().length) : '0',
      truncated: t.scrollWidth > t.clientWidth + 1,
      overflow: cs.overflow,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      // A tooltip is the cheapest way to expose the rest without layout work.
      titleAttr: t.getAttribute('title'),
      rowTitleAttr: r.getAttribute('title'),
      canScrollX: t.scrollWidth > t.clientWidth && cs.overflowX !== 'hidden',
    }
  }), null, 1)
})()`))

console.log('\n== DSH\'s own sidebar row, for comparison (column hidden but in DOM) ==')
console.log(await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-slot="sidebar.workspaces"] div[class*="_sessionRow"]')]
  if (rows.length === 0) return 'no native rows in DOM'
  return JSON.stringify(rows.slice(0, 4).map((r) => {
    // Find the deepest element that actually holds the title text.
    const candidates = [...r.querySelectorAll('*')].filter((e) => (e.textContent || '').trim().length > 0 && e.children.length === 0)
    const t = candidates[0]
    if (!t) return { text: '(none)' }
    const cs = getComputedStyle(t)
    return {
      text: (t.textContent || '').trim().slice(0, 60),
      chars: (t.textContent || '').trim().length,
      boxW: Math.round(t.getBoundingClientRect().width),
      textW: t.scrollWidth,
      truncated: t.scrollWidth > Math.round(t.getBoundingClientRect().width) + 1,
      overflow: cs.overflow,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      titleAttr: t.getAttribute('title') || r.getAttribute('title'),
    }
  }), null, 1)
})()`))

console.log('\n== the workspace row (title + path), same question ==')
console.log(await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-workspace"]')]
  return JSON.stringify(rows.map((r) => {
    const out = {}
    for (const sel of ['.dsh-mobile-ws-name', '.dsh-mobile-ws-path']) {
      const t = r.querySelector(sel)
      const cs = getComputedStyle(t)
      out[sel] = {
        text: (t.textContent || '').trim(),
        boxW: t.clientWidth,
        textW: t.scrollWidth,
        truncated: t.scrollWidth > t.clientWidth + 1,
        textOverflow: cs.textOverflow,
        titleAttr: t.getAttribute('title'),
      }
    }
    return out
  }), null, 1)
})()`))

ws.close()
process.exit(0)
