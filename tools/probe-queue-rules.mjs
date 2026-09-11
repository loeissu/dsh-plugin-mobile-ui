/**
 * Find the squashed queued-message bar in the REAL environment and identify the
 * exact CSS rule responsible.
 *
 * All previous attempts measured an isolated profile, which has neither tether's
 * injected stylesheet nor a queued message — so the condition could not be
 * reproduced. This one points at the live instance the report came from.
 *
 * The decisive tool here is CDP's CSS domain: `CSS.getMatchedStylesForNode`
 * returns every rule that applies to an element, with the selector, origin and
 * declared properties. That answers "which rule squashed it" directly, instead of
 * inferring it from measurements.
 *
 * Usage: node tools/probe-queue-rules.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-queue-rules.mjs <url> [--cdp <url>]')
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
await send('DOM.enable')
await send('CSS.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(10000)

// ── 1. locate the queue dock ───────────────────────────────────────────────
console.log('\n== 1. is there a queue dock? ==')
const found = await evaluate(`(() => {
  const byAttr = document.querySelector('[data-queue-dock]')
  const byClass = [...document.querySelectorAll('*')].filter((e) => /queue/i.test((e.className || '').toString()))
  const stack = document.querySelector('[class*="composerStack"]')
  return JSON.stringify({
    queueDockAttr: byAttr ? { attr: byAttr.getAttribute('data-queue-dock'), h: Math.round(byAttr.getBoundingClientRect().height), cls: (byAttr.className||'').toString().slice(0,60) } : null,
    queueClassCount: byClass.length,
    queueClasses: byClass.slice(0, 8).map((e) => ({
      cls: (e.className || '').toString().slice(0, 60),
      h: Math.round(e.getBoundingClientRect().height),
      text: (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
    })),
    composerStackChildren: stack ? [...stack.children].map((e) => ({
      cls: (e.className || '').toString().slice(0, 50),
      h: Math.round(e.getBoundingClientRect().height),
      text: (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
    })) : null,
    tetherPresent: document.querySelector('style[data-dsh-tether]') !== null,
  }, null, 1)
})()`)
console.log(found)

// ── 2. matched rules for the queue dock (the decisive step) ────────────────
console.log('\n== 2. every rule that applies to the queue dock ==')
const doc = await send('DOM.getDocument', { depth: -1, pierce: true })
let nodeId = null
for (const sel of ['[data-queue-dock]', '[class*="queue"]', '[class*="composerStack"]']) {
  const r = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: sel })
  if (r.result?.nodeId) { nodeId = r.result.nodeId; console.log(`  using selector: ${sel}`); break }
}
if (nodeId === null) {
  console.log('  no queue or composer element found — cannot inspect rules')
} else {
  const matched = await send('CSS.getMatchedStylesForNode', { nodeId })
  const rules = matched.result?.matchedCSSRules ?? []
  console.log(`  ${rules.length} matched rule(s)`)
  const interesting = ['flex', 'flex-wrap', 'flex-basis', 'height', 'max-height', 'min-height', 'width', 'max-width', 'min-width', 'overflow', 'display', 'white-space']
  for (const r of rules) {
    const props = (r.rule.style.cssProperties || [])
      .filter((p) => interesting.includes(p.name) && p.value !== '')
      .map((p) => `${p.name}:${p.value}${p.important ? ' !important' : ''}`)
      .filter((p) => !/^(width:auto|height:auto|max-width:none|min-width:auto|display:block)$/.test(p))
    if (props.length === 0) continue
    const origin = r.rule.origin
    const sheet = r.rule.styleSheetId ?? '(inline)'
    console.log(`\n  [${origin}] ${r.rule.selectorList?.text?.slice(0, 110)}`)
    console.log(`     sheet=${sheet}`)
    console.log(`     ${props.join('  ')}`)
  }
  // The element's own box, for reference.
  console.log('\n== 3. the element itself ==')
  const box = await send('DOM.getBoxModel', { nodeId })
  console.log(`  box: ${box.result?.model ? JSON.stringify({ w: Math.round(box.result.model.width), h: Math.round(box.result.model.height) }) : 'n/a'}`)
  console.log(`  computed: ${await evaluate(`(() => {
    const el = document.querySelector('[class*="composerStack"]')
    if (!el) return 'n/a'
    const cs = getComputedStyle(el)
    return JSON.stringify({ h: cs.height, flex: cs.flex, flexWrap: cs.flexWrap, overflow: cs.overflow, minHeight: cs.minHeight })
  })()`)}`)
}

ws.close()
process.exit(0)
