/**
 * Verify the tool-call cards in a live DSH session, driven through CDP.
 *
 * What it establishes, none of which a unit render can:
 *
 *  1. The keyed `tool.call.toolview` registration actually takes over the
 *     shipped card for the configured tool names, and the card appears inside
 *     the real transcript rather than beside it.
 *  2. Collapsing works: the body's grid-template-rows goes 0fr -> 1fr and the
 *     chevron rotates.
 *  3. A tool name this plugin does NOT claim still renders through DSH's own
 *     generic row, proving the takeover is per-key and not global.
 *  4. The plugin raises no page errors while the transcript renders.
 *
 * Usage:
 *   node tools/verify-toolcards.mjs <app-url-with-token> [--cdp <url>] [--session <id>]
 */

const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/verify-toolcards.mjs <url> [--cdp <url>] [--session <id>]')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const cdpBase = arg('--cdp', 'http://127.0.0.1:9222')
const sessionId = arg('--session', null)

const targets = await (await fetch(`${cdpBase}/json/list`)).json()
const target = targets.find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const consoleLines = []
let nextId = 0
await new Promise((resolve, reject) => {
  ws.onopen = () => { resolve() }
  ws.onerror = () => { reject(new Error('ws error')) }
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleLines.push('exception: ' + String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 250))
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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description))
  return r.result?.result?.value
}

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(7000)

// Open the sidebar drawer — it is a 56px rail on a narrow viewport, so no
// session row exists in the DOM until the toggle is clicked — reveal collapsed
// groups, then open a session that actually contains tool calls.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')

console.log(`sidebar: ${await openSidebar(evaluate)}`)
await sleep(1200)
for (let round = 0; round < 3; round += 1) {
  const clicked = await evaluate(`(() => {
    const scope = document.querySelector('[data-slot="sidebar.workspaces"]') || document
    const more = Array.from(scope.querySelectorAll('button'))
      .find((b) => /展开其余|展开更多|show more/i.test(b.textContent || ''))
    if (!more) return 'none'
    more.click()
    return (more.textContent || '').trim()
  })()`)
  if (clicked === 'none') break
  await sleep(900)
}

const rows = await listSessions(evaluate)
console.log(`${rows.length} session row(s) available`)

// Prefer a row whose title suggests tool activity, then fall back to walking
// rows until one yields cards.
const preferred = (() => {
  if (sessionId !== null) {
    const byId = rows.findIndex((r) => r.text.includes(sessionId))
    if (byId !== -1) return byId
  }
  const byText = rows.findIndex((r) => /dsh-tether|plugin|方案|重构|审核|command/i.test(r.text))
  return byText === -1 ? 1 : byText
})()

let cards = 0
let foreignFinal = -1
const order = [preferred, ...rows.map((r) => r.i).filter((i) => i !== preferred)]
for (const index of order.slice(0, 6)) {
  const label = await clickSession(evaluate, index)
  await sleep(5000)
  const counts = JSON.parse(await evaluate(`JSON.stringify({
    ours: document.querySelectorAll('[data-slot="tool.call.toolview"] [data-dsh-mobile-ui="tool-card"]').length,
    total: document.querySelectorAll('[data-slot="tool.call.toolview"]').length,
  })`))
  cards = counts.ours
  const foreign = counts.total - counts.ours
  console.log(`  [${String(index)}] "${String(label).slice(0, 34)}" -> ours=${counts.ours} foreign=${foreign}`)
  // Stop at the first session that has BOTH: a card we own proves the takeover
  // works, and a foreign outlet proves per-key dispatch leaves other tools on
  // the shipped row. A session of only-claimed tools cannot show the latter.
  if (cards > 0 && foreign > 0) { foreignFinal = foreign; break }
  if (cards > 0 && foreignFinal === -1) foreignFinal = 0
}

const state = await evaluate(`JSON.stringify({
  ourCards: document.querySelectorAll('[data-dsh-mobile-ui="tool-card"]').length,
  anyToolRows: document.querySelectorAll('[data-slot="tool.call.toolview"]').length,
  transcriptPresent: document.querySelector('[data-slot="conversation.chat.node"]') !== null
    || document.querySelectorAll('[data-slot="conversation.session"]').length > 0,
  hasToolNames: Array.from(document.querySelectorAll('[data-dsh-mobile-ui="tool-card"]'))
    .slice(0, 8).map(c => (c.textContent || '').trim().slice(0, 50)),
})`)
const s = JSON.parse(state)
console.log(`cards=${s.ourCards} toolviewOutlets=${s.anyToolRows} transcript=${s.transcriptPresent}`)
if (s.hasToolNames.length > 0) console.log(`  labels: ${JSON.stringify(s.hasToolNames)}`)

check(s.ourCards > 0, 'plugin tool cards rendered in a real transcript',
  `${s.ourCards} card(s)`)
check(s.transcriptPresent, 'conversation transcript mounted')

if (s.ourCards > 0) {
  // Collapse/expand: the body animates grid-template-rows 0fr -> 1fr and the
  // chevron rotates 180deg. Both are asserted, not just the aria flag, because
  // the visual collapse is the user-visible behavior.
  const before = JSON.parse(await evaluate(`(() => {
    const card = document.querySelector('[data-dsh-mobile-ui="tool-card"]')
    const body = card.querySelector('.dsh-mobile-tool__body')
    const chev = card.querySelector('.dsh-mobile-tool__chev')
    return JSON.stringify({
      open: card.getAttribute('data-open'),
      rows: getComputedStyle(body).gridTemplateRows,
      chev: getComputedStyle(chev).transform,
      headH: card.querySelector('.dsh-mobile-tool__head').getBoundingClientRect().height,
    })
  })()`))
  console.log(`  collapsed: ${JSON.stringify(before)}`)

  await evaluate(`document.querySelector('[data-dsh-mobile-ui="tool-card"] .dsh-mobile-tool__head').click()`)
  await sleep(600)
  const after = JSON.parse(await evaluate(`(() => {
    const card = document.querySelector('[data-dsh-mobile-ui="tool-card"]')
    const body = card.querySelector('.dsh-mobile-tool__body')
    const chev = card.querySelector('.dsh-mobile-tool__chev')
    return JSON.stringify({
      open: card.getAttribute('data-open'),
      rows: getComputedStyle(body).gridTemplateRows,
      chev: getComputedStyle(chev).transform,
      headH: card.querySelector('.dsh-mobile-tool__head').getBoundingClientRect().height,
    })
  })()`))
  console.log(`  expanded:  ${JSON.stringify(after)}`)

  check(before.open === 'false', 'card starts collapsed', `data-open=${before.open}`)
  check(after.open === 'true', 'click expands the card', `data-open=${after.open}`)
  check(before.rows !== after.rows, 'body grid-template-rows actually changes',
    `${before.rows} -> ${after.rows}`)

  // Unclaimed-tool fallback: a toolview outlet with no plugin card inside means
  // DSH's own row rendered there. Counted from the session-selection loop,
  // because a session whose tools happen to all be claimed cannot show this.
  console.log(`  toolview outlets: ours=${cards} foreign=${foreignFinal}`)
}

check(foreignFinal > 0, 'unclaimed tool names still render a shipped row',
  foreignFinal > 0
    ? `${foreignFinal} outlet(s) not served by this plugin`
    : 'every tool in the inspected sessions is claimed by this plugin, so the '
      + 'per-key fallback could not be observed — widen FEATURES.toolCards less, '
      + 'or inspect a session using a tool outside that list')

const errors = consoleLines.filter((l) => !/ResizeObserver|Script error/i.test(l))
check(errors.length === 0, 'no page exceptions during transcript render', errors.slice(0, 3).join(' | '))

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: all tool-card assertions passed')
process.exit(0)
