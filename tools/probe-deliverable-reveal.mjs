/**
 * Find the deliverable card and drive its "reveal in File Explorer" item.
 *
 * The card only exists in the FINAL turn of a session, so a freshly opened page
 * (empty state) shows nothing — which is why earlier probes found no menu items.
 * This opens the session that has a delivered file, scrolls to the bottom, opens
 * the card's overflow menu, and records what happens on click.
 *
 * Both widths are tested because this plugin rewrites the frame's grid columns
 * and hides the sidebar column on narrow screens. If the menu is portalled into
 * that column, a phone breaks while a desktop works — the same shape as two
 * defects already found in this project.
 *
 * Usage: node tools/probe-deliverable-reveal.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/probe-deliverable-reveal.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const logs = []
let nextId = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    logs.push(`[${m.params.type}] ` + m.params.args.map((a) => String(a.description ?? a.value ?? '')).join(' ').slice(0, 220))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push('[exception] ' + String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 240))
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

for (const [label, width, height, mobile, tag] of [
  ['desktop 1280x900', 1280, 900, false, 'desktop'],
  ['phone 412x915', 412, 915, true, 'phone'],
]) {
  console.log(`\n${'='.repeat(62)}\n== ${label} ==`)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
  await send('Page.navigate', { url: appUrl })
  await sleep(11000)

  // Open the session holding a delivered file, via this plugin's drawer when
  // narrow and via the native sidebar when wide.
  if (mobile) {
    await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
    await sleep(2000)
    await evaluate(`(() => { const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]; if (rs[0]) rs[0].click(); return 'ok' })()`)
  } else {
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('[class*="sessionRow"], [class*="session_row"]')]
      const target = rows.find((r) => /dsh-tether|zexadev/.test(r.textContent || '')) || rows[0]
      if (target) target.click()
      return target ? 'clicked' : 'no rows'
    })()`)
  }
  await sleep(9000)

  // Scroll to the bottom, where the final turn and its deliverables live.
  await evaluate(`(() => {
    const scroller = [...document.querySelectorAll('*')].find((e) => {
      const s = getComputedStyle(e)
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 200
    })
    if (scroller) scroller.scrollTop = scroller.scrollHeight
    return scroller ? 'scrolled' : 'no scroller'
  })()`)
  await sleep(2500)

  console.log('  looking for the deliverable card and its menu...')
  const found = await evaluate(`(() => {
    const text = (el) => (el.textContent || '').trim()
    // The card shows a basename plus a segmented open control.
    const cards = [...document.querySelectorAll('*')].filter((e) => {
      const t = text(e)
      return /STATUS\\.md|README\\.md|STATUS/.test(t) && e.querySelectorAll('*').length < 40
    })
    const buttons = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')].map((b) => ({
      text: text(b).slice(0, 26),
      aria: b.getAttribute('aria-label'),
      cls: (b.className || '').toString().split(' ')[0].slice(0, 30),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
      top: Math.round(b.getBoundingClientRect().top),
    })).filter((b) => b.text !== '' || b.aria !== null)
    return JSON.stringify({
      cardCandidates: cards.slice(0, 4).map((e) => ({
        cls: (e.className || '').toString().slice(0, 50),
        text: text(e).replace(/\\s+/g, ' ').slice(0, 70),
        h: Math.round(e.getBoundingClientRect().height),
      })),
      buttonsNearBottom: buttons.slice(-14),
    }, null, 1)
  })()`)
  console.log(found.split('\n').map((l) => `  ${l}`).join('\n'))
  await shoot(`01-${tag}-bottom`)
}

console.log('\n== console errors / exceptions ==')
console.log(logs.length === 0 ? '  none' : logs.map((l) => `  ${l}`).join('\n'))

ws.close()
process.exit(0)
