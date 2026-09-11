/**
 * Does shrinking the app frame compress the composer stack?
 *
 * This isolates the mechanism behind the squashed queued-message bar. If the
 * composer card or its dock lose height as the frame shrinks, then anything that
 * spuriously shrinks the frame — such as the keyboard-fit override engaging when
 * no keyboard is present — will squash that bar.
 *
 * The frame height is driven directly through the same custom property the
 * keyboard-fit script writes, so this exercises the real code path rather than a
 * synthetic one.
 *
 * Usage: node tools/probe-composer-compression.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-composer-compression.mjs <url> [--cdp <url>]')
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

/**
 * Height of the composer card and of each dock slot above it.
 *
 * The dock slots are the queue's seats; their height is what the user sees as
 * the queued-message bar.
 */
const MEASURE = `(() => {
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const centre = frame ? frame.querySelector(':scope > [class*="centerCol"]') : null
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  let card = ta
  while (card && !(card.className || '').toString().includes('_root')) card = card.parentElement
  const docks = ['conversation.composer.dock', 'conversation.input.dock', 'conversation.composer.bar']
    .map((slot) => {
      const el = document.querySelector('[data-slot="' + slot + '"]')
      if (el === null) return { slot, present: false }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return { slot, present: true, h: Math.round(r.height), flexShrink: cs.flexShrink, overflow: cs.overflowY }
    })
  return JSON.stringify({
    frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
    composerCardH: card ? Math.round(card.getBoundingClientRect().height) : null,
    centreH: centre ? Math.round(centre.getBoundingClientRect().height) : null,
    docks,
  })
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Open a session so the composer exists in a conversation.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  await sleep(5000)
}

console.log('\n== composer stack at decreasing frame heights ==')
console.log('  (frame height is driven through the same variable the keyboard fit writes)\n')

for (const h of [915, 850, 700, 560, 420, 300]) {
  await evaluate(`(() => {
    const de = document.documentElement
    if (${h} === 915) { de.style.removeProperty('--dsh-mobile-vv-height'); de.style.removeProperty('--dsh-mobile-vv-top') }
    else { de.style.setProperty('--dsh-mobile-vv-height', '${h}px'); de.style.setProperty('--dsh-mobile-vv-top', '0px') }
    return 'ok'
  })()`)
  await sleep(600)
  const m = JSON.parse(await evaluate(MEASURE))
  const dockSummary = m.docks.map((d) => d.present ? `${d.slot.split('.').pop()}=${d.h}` : `${d.slot.split('.').pop()}=absent`).join('  ')
  console.log(`  frame=${String(m.frameH).padStart(3)}  composerCard=${String(m.composerCardH).padStart(3)}  centre=${String(m.centreH).padStart(3)}   ${dockSummary}`)
}

// Restore.
await evaluate(`(() => {
  const de = document.documentElement
  de.style.removeProperty('--dsh-mobile-vv-height')
  de.style.removeProperty('--dsh-mobile-vv-top')
  return 'restored'
})()`)
await sleep(500)
const restored = JSON.parse(await evaluate(MEASURE))
console.log(`\n  restored: frame=${restored.frameH} composerCard=${restored.composerCardH}`)

ws.close()
process.exit(0)
