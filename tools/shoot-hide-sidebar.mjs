/**
 * Visual confirmation of the three layout stages from probe-hide-sidebar.mjs.
 *
 * The numeric probe showed the grid template and column widths; this captures
 * what that actually looks like, because a 56px conversation column is a claim
 * worth seeing rather than trusting. Screenshots are the evidence that decides
 * whether the overlay route is viable.
 *
 * Usage: node tools/shoot-hide-sidebar.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/shoot-hide-sidebar.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

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
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const f = join(outDir, `${name}.png`)
  writeFileSync(f, Buffer.from(s.result.data, 'base64'))
  console.log(`  saved ${name}.png`)
}

/** Report the centre column's width and what it contains. */
const CENTRE = `(() => {
  const frame = document.querySelector('[class*="_frame"]')
  const centre = frame && frame.querySelector(':scope > [class*="centerCol"]')
  if (!centre) return JSON.stringify({ error: 'no centre' })
  const r = centre.getBoundingClientRect()
  const cs = getComputedStyle(frame)
  // Find the widest visible descendant, to see whether content fits or is
  // clipped into the narrow track.
  let widest = 0, widestCls = ''
  for (const el of centre.querySelectorAll('*')) {
    const er = el.getBoundingClientRect()
    if (er.width > widest) { widest = Math.round(er.width); widestCls = (el.className||'').toString().split(' ')[0].slice(0,28) }
  }
  return JSON.stringify({
    template: cs.gridTemplateColumns,
    centreW: Math.round(r.width),
    centreX: Math.round(r.x),
    widestDescendant: widest + ' (' + widestCls + ')',
    text: (centre.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 70),
  })
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Open a session so the conversation surface is real rather than the hero.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
console.log(`sidebar: ${await openSidebar(evaluate)}`)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  console.log(`opening session [${pick === -1 ? 0 : pick}]: ${await clickSession(evaluate, pick === -1 ? 0 : pick)}`)
  await sleep(5000)
}

console.log('\n--- stage 1: baseline ---')
console.log(`  ${await evaluate(CENTRE)}`)
await shoot('01-baseline')

console.log('\n--- stage 2: sidebar hidden, template untouched ---')
await evaluate(`(() => {
  let tag = document.getElementById('probe-hide-sidebar')
  if (!tag) { tag = document.createElement('style'); tag.id = 'probe-hide-sidebar'; document.head.append(tag) }
  tag.textContent = '[class*="_sidebarCol"] { display: none !important; }'
  return 'injected'
})()`)
await sleep(1200)
console.log(`  ${await evaluate(CENTRE)}`)
await shoot('02-hidden-no-override')

console.log('\n--- stage 3: sidebar hidden + template overridden ---')
await evaluate(`(() => {
  document.getElementById('probe-hide-sidebar').textContent = \`
    [class*="_sidebarCol"] { display: none !important; }
    [class*="_frame"] { grid-template-columns: minmax(0, 1fr) 0px !important; }
    [class*="_frame"] > [class*="centerCol"] { grid-column: 1 !important; }
    [class*="_frame"] > [class*="rightbarCol"] { grid-column: 2 !important; }
  \`
  return 'overridden'
})()`)
await sleep(1200)
console.log(`  ${await evaluate(CENTRE)}`)
await shoot('03-hidden-with-override')

// Clean up so the page returns to stock for any later step.
await evaluate(`(() => { const t = document.getElementById('probe-hide-sidebar'); if (t) t.remove(); return 'removed' })()`)
console.log('\ncleaned up')

ws.close()
process.exit(0)
