/**
 * Name the rule that squashes the queued-message bar.
 *
 * The bar is now located in the live environment: it renders in the
 * `conversation.input.dock` slot as a `_7yHdaG_dock` element. The slot outlet
 * reports 0x0 because it is `display: contents`, which is expected — the real box
 * is the child. What is NOT explained yet is why that child looks like a sliver.
 *
 * So this walks the dock's subtree and asks CDP which rules apply to each node,
 * filtered to the properties that can collapse a box. That names the culprit
 * rather than inferring it.
 *
 * Usage: node tools/probe-queue-inner.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-queue-inner.mjs <url> [--cdp <url>]')
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

/** Properties that can collapse or clip a box. */
const INTERESTING = new Set([
  'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-wrap', 'flex-direction',
  'height', 'min-height', 'max-height',
  'width', 'min-width', 'max-width',
  'overflow', 'overflow-x', 'overflow-y',
  'white-space', 'text-overflow', 'display', 'visibility', 'opacity',
])

await send('Runtime.enable')
await send('Page.enable')
await send('DOM.enable')
await send('CSS.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(10000)

// Open the running session via this plugin's drawer.
await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(2000)
await evaluate(`(() => { const rs = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]; if (rs[0]) rs[0].click(); return 'ok' })()`)
await sleep(9000)

// ── the dock subtree, measured ─────────────────────────────────────────────
console.log('\n== dock subtree (box + the properties that can collapse it) ==')
console.log(await evaluate(`(() => {
  const slot = document.querySelector('[data-slot="conversation.input.dock"]')
  if (slot === null) return 'dock slot absent'
  const dock = slot.firstElementChild
  if (dock === null) return 'dock child absent'
  const rows = []
  const walk = (el, depth) => {
    if (depth > 3) return
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    rows.push({
      depth,
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 46),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: cs.display,
      flex: cs.flex,
      flexWrap: cs.flexWrap,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      minHeight: cs.minHeight,
      overflow: cs.overflow,
      whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      text: el.children.length === 0 ? (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34) : '',
      // Is the content clipped relative to what it wants?
      clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    })
    for (const child of el.children) walk(child, depth + 1)
  }
  walk(dock, 0)
  return JSON.stringify(rows, null, 1)
})()`))

// ── matched rules on the dock and its direct children ─────────────────────
console.log('\n== matched rules (size-related only) ==')
const doc = await send('DOM.getDocument', { depth: -1, pierce: true })
const sel = '[data-slot="conversation.input.dock"] > *'
const hit = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel })
if (hit.result?.nodeId) {
  const matched = await send('CSS.getMatchedStylesForNode', { nodeId: hit.result.nodeId })
  const rules = matched.result?.matchedCSSRules ?? []
  console.log(`  ${rules.length} rule(s) on the dock`)
  for (const r of rules) {
    const props = (r.rule.style.cssProperties || [])
      .filter((p) => INTERESTING.has(p.name) && p.value !== '')
      .map((p) => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`)
    if (props.length === 0) continue
    console.log(`\n  [${r.rule.origin}] ${r.rule.selectorList?.text?.slice(0, 120)}`)
    console.log(`     ${props.join('   ')}`)
  }
} else {
  console.log('  could not resolve the dock node')
}

// ── which rules come from dsh-tether? ─────────────────────────────────────
console.log('\n== do any matched rules come from tether? ==')
console.log(await evaluate(`(() => {
  const tether = document.querySelector('style[data-dsh-tether]')
  const rules = tether ? (tether.textContent || '') : ''
  // Which tether selectors could plausibly reach the dock or its children?
  const dock = document.querySelector('[data-slot="conversation.input.dock"]')
  if (dock === null) return 'no dock'
  const cls = []
  const walk = (el, d) => { if (d > 3) return; cls.push((el.className || '').toString()); for (const c of el.children) walk(c, d + 1) }
  walk(dock, 0)
  const joined = cls.join(' ')
  return JSON.stringify({
    tetherPresent: tether !== null,
    tetherHasRowRule: /_row/.test(rules),
    tetherHasRowTextRule: /rowText/.test(rules),
    dockClasses: cls.filter(Boolean).slice(0, 12),
    classesMatchingDshRowSuffix: cls.filter((c) => /_row/.test(c)),
    classesMatchingRowTextSuffix: cls.filter((c) => /rowText/.test(c)),
  }, null, 1)
})()`))

ws.close()
process.exit(0)
