/**
 * One-shot probe: open the sidebar, list the session rows it reveals, and
 * report which of them look like they contain tool activity.
 *
 * Run this before verify-toolcards.mjs to learn the real row indices, and
 * before writing any selector that assumes a session is already open.
 *
 * Usage: node tools/probe-sessions.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-sessions.mjs <url> [--cdp <url>]')
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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description))
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(7000)

const { openSidebar, listSessions } = await import('./sidebar.mjs')

console.log(`sidebar: ${await openSidebar(evaluate)}`)
await sleep(1200)

// A workspace group may be collapsed behind an "expand the remaining N" row.
// Click every such row first, then list what appears.
for (let round = 0; round < 3; round += 1) {
  const clicked = await evaluate(`(() => {
    const scope = document.querySelector('[data-slot="sidebar.workspaces"]') || document
    const more = Array.from(scope.querySelectorAll('button'))
      .find((b) => /展开其余|展开更多|show more|more/i.test(b.textContent || ''))
    if (!more) return 'none'
    const label = (more.textContent || '').trim()
    more.click()
    return label
  })()`)
  console.log(`expand round ${round}: ${clicked}`)
  if (clicked === 'none') break
  await sleep(900)
}

const rows = await listSessions(evaluate)
console.log(`\n${rows.length} candidate row(s):`)
for (const r of rows) console.log(`  [${r.i}] ${r.tag}  ${r.text}`)

ws.close()
process.exit(0)
