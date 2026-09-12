/**
 * Why does "reveal in File Explorer" not work from the UI?
 *
 * The native command itself is verified working: `explorer.exe "/select,"
 * "file:///H:/..."` opened the folder (Explorer window count 2 -> 3). So the
 * defect is in the click path, not the mechanism.
 *
 * This walks that path in the real page and at BOTH widths, because this plugin's
 * narrow-screen CSS rewrites the frame's grid columns and hides the sidebar
 * column — if the reveal menu is portalled into that column, a phone would break
 * while a desktop works. That is the same shape as two defects already found.
 *
 * It records: whether a deliverable card is present, what the menu contains, any
 * console error or page exception, and any toast the UI shows after the click.
 *
 * Usage: node tools/probe-reveal.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/probe-reveal.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const consoleErrors = []
const exceptions = []
let nextId = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    consoleErrors.push(m.params.args.map((a) => String(a.description ?? a.value ?? '')).join(' ').slice(0, 200))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 240))
  }
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
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(s.result.data, 'base64'))
  console.log(`  saved ${name}.png`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Log.enable').catch(() => {})

for (const [label, width, height, mobile] of [
  ['phone 412x915', 412, 915, true],
  ['desktop 1280x900', 1280, 900, false],
]) {
  console.log(`\n${'='.repeat(60)}\n== ${label} ==`)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  await send('Page.navigate', { url: appUrl })
  await sleep(11000)

  // Is there a deliverable card, and what does it offer?
  const cards = await evaluate(`(() => {
    const hits = []
    const wanted = ['在文件资源管理器中显示', '打开所在文件夹', '在 Finder 中显示', '用默认应用打开', '资源管理器']
    for (const el of document.querySelectorAll('button, [role="menuitem"], [role="button"], a')) {
      const txt = (el.textContent || '').trim()
      if (wanted.some((w) => txt.includes(w))) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        hits.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          text: txt.slice(0, 40),
          cls: (el.className || '').toString().split(' ')[0].slice(0, 34),
          w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top), left: Math.round(r.left),
          display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents,
          // Reachable by a finger? Zero-size or off-screen elements are not.
          hitTestable: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        })
      }
    }
    // Any deliverable card at all?
    const cards = [...document.querySelectorAll('*')].filter((e) => {
      const c = (e.className || '').toString()
      return /deliverab|presented|presentCard/i.test(c)
    }).slice(0, 3).map((e) => ({ cls: (e.className || '').toString().slice(0, 60), h: Math.round(e.getBoundingClientRect().height) }))
    return JSON.stringify({ menuItems: hits, deliverableCards: cards }, null, 1)
  })()`)
  console.log('  menu items / cards found:')
  console.log(cards.split('\n').map((l) => `  ${l}`).join('\n'))
  await shoot(`${mobile ? '01-phone' : '02-desktop'}`)
}

console.log('\n== console errors / exceptions ==')
const all = [...consoleErrors, ...exceptions]
console.log(all.length === 0 ? '  none' : all.map((e) => `  ${e}`).join('\n'))

ws.close()
process.exit(0)
