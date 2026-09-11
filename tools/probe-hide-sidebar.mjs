/**
 * Step 1 probe: can the native sidebar be hidden with CSS, and does the
 * conversation then fill the freed space?
 *
 * The concern this exists to answer: DSH's frame is a CSS grid whose column
 * template is set inline by the layout store. `display: none` on the sidebar
 * column removes it from the grid flow, but the template may still reserve its
 * track — in which case the conversation keeps its old width and a hole opens
 * on the left. That is a layout break, not a cosmetic one, and it decides
 * whether the overlay route is viable at all.
 *
 * So this measures, in order:
 *   baseline (stock)  ->  sidebar hidden  ->  sidebar hidden + template overridden
 * and reports the frame's computed grid columns at each stage.
 *
 * Read-only against the running server: it injects a style tag at runtime and
 * never modifies a file.
 *
 * Usage: node tools/probe-hide-sidebar.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-hide-sidebar.mjs <url> [--cdp <url>]')
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
// A phone viewport, since that is the target.
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

/**
 * Measure the frame's geometry and the key columns.
 * Reports each child's column index so a track that stays reserved is visible
 * as a width that does not grow.
 */
const MEASURE = `(() => {
  const frame = document.querySelector('[class*="_frame"]')
  if (!frame) return JSON.stringify({ error: 'no frame' })
  const cs = getComputedStyle(frame)
  const kids = Array.from(frame.children).map((el, i) => {
    const k = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const cls = (el.className || '').toString().split(' ')[0]
    return {
      i,
      cls: cls.slice(0, 34),
      col: k.gridColumnStart,
      display: k.display,
      pos: k.position,
      w: Math.round(r.width),
      h: Math.round(r.height),
    }
  })
  // The conversation surface itself, to confirm it actually got wider.
  const conv = document.querySelector('[data-slot="conversation.session"]')
    || document.querySelector('[data-slot="main.conversation"]')
    || document.querySelector('[data-slot="main"]')
  const convRect = conv ? conv.getBoundingClientRect() : null
  return JSON.stringify({
    templateColumns: cs.gridTemplateColumns,
    display: cs.display,
    viewport: window.innerWidth + 'x' + window.innerHeight,
    frameRect: Math.round(frame.getBoundingClientRect().width) + 'x' + Math.round(frame.getBoundingClientRect().height),
    kids,
    conversation: convRect ? { w: Math.round(convRect.width), x: Math.round(convRect.x) } : null,
    gaps: cs.gap + ' / ' + cs.columnGap,
    padding: cs.padding,
  }, null, 1)
})()`

console.log('\n===== STAGE 1: baseline (stock ui-sidebar) =====')
console.log(await evaluate(MEASURE))

// ── hide the sidebar column ────────────────────────────────────────────────
// Two candidate selectors, because the class prefix is a build hash:
// the sidebar column by its local name, and the sidebar slot outlet.
const HIDE_CSS = `
  [class*="_sidebarCol"] { display: none !important; }
`

console.log('\n===== STAGE 2: sidebar column hidden (template untouched) =====')
console.log(`  injecting display:none on [class*="_sidebarCol"]`)
await evaluate(`(() => {
  let tag = document.getElementById('probe-hide-sidebar')
  if (!tag) { tag = document.createElement('style'); tag.id = 'probe-hide-sidebar'; document.head.append(tag) }
  tag.textContent = ${JSON.stringify(HIDE_CSS)}
  return 'injected'
})()`)
await sleep(1200)
console.log(await evaluate(MEASURE))

// ── does the frame still reserve the track? ────────────────────────────────
const stage2 = JSON.parse(await evaluate(MEASURE))
console.log('\n  → did the conversation fill the freed space?')
if (stage2.templateColumns !== undefined) {
  console.log(`     frame template: ${stage2.templateColumns}`)
  console.log(`     viewport:       ${stage2.viewport}`)
  const first = stage2.kids?.[0]
  console.log(`     first child:    ${first?.cls} w=${first?.w} display=${first?.display}`)
  console.log(`     conversation:   ${JSON.stringify(stage2.conversation)}`)
}

// ── override the template so no hole is left ───────────────────────────────
// The frame is a grid; if hiding the column leaves its track reserved, the
// template has to be restated. The centre column is pinned explicitly because
// removing a grid item shifts auto-placement into the wrong track.
const OVERRIDE_CSS = `
  [class*="_sidebarCol"] { display: none !important; }
  [class*="_frame"] {
    grid-template-columns: minmax(0, 1fr) 0px !important;
  }
  [class*="_frame"] > [class*="centerCol"] { grid-column: 1 !important; }
  [class*="_frame"] > [class*="rightbarCol"] { grid-column: 2 !important; }
`

console.log('\n===== STAGE 3: sidebar hidden + template overridden =====')
await evaluate(`(() => {
  const tag = document.getElementById('probe-hide-sidebar')
  tag.textContent = ${JSON.stringify(OVERRIDE_CSS)}
  return 'overridden'
})()`)
await sleep(1200)
console.log(await evaluate(MEASURE))

const stage3 = JSON.parse(await evaluate(MEASURE))
console.log('\n  → result')
console.log(`     frame template: ${stage3.templateColumns}`)
console.log(`     conversation:   ${JSON.stringify(stage3.conversation)}`)

// Leave the page clean so later stages start from stock.
await evaluate(`(() => { const t = document.getElementById('probe-hide-sidebar'); if (t) t.remove(); return 'removed' })()`)
await sleep(600)
const after = JSON.parse(await evaluate(MEASURE))
console.log(`\n===== restore check =====\n  template back to: ${after.templateColumns}`)

ws.close()
process.exit(0)
