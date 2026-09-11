/**
 * Experiment: if the app frame followed a shortened viewport, would the
 * composer actually rise above the keyboard?
 *
 * Context. On a phone the composer sits behind the keyboard and never moves.
 * Root cause is native: the manifest declares no `android:windowSoftInputMode`,
 * so the Android window does not resize for the IME, the WebView's layout
 * viewport never shrinks, and an in-flow composer keeps its position. Measured
 * geometry: html/body are exactly viewport height with `overflow: visible`, so
 * the document cannot scroll either — which is why DSH's own `visualViewport`
 * scroll-into-view routine has nothing to work with.
 *
 * Before proposing a plugin-side mitigation (drive the frame height from
 * `visualViewport.height`, which DOES track the keyboard in Android WebView even
 * when the layout viewport does not), it is worth checking the cheap half: does
 * shrinking the frame actually carry the composer up, and does the conversation
 * scroll area survive?
 *
 * This injects CSS at runtime against a live page and measures. It writes no
 * files and changes no source.
 *
 * Usage: node tools/probe-keyboard-geometry.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-keyboard-geometry.mjs <url> [--cdp <url>]')
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

/** Where the composer sits and how tall the scroll area is. */
const MEASURE = `(() => {
  const ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]')
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const centre = frame ? frame.querySelector(':scope > [class*="centerCol"]') : null
  const scroller = [...document.querySelectorAll('*')].find((e) => {
    const s = getComputedStyle(e)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4
  })
  if (!ta || !frame) return JSON.stringify({ error: 'missing composer or frame' })
  const tr = ta.getBoundingClientRect()
  return JSON.stringify({
    viewportH: window.innerHeight,
    frameH: Math.round(frame.getBoundingClientRect().height),
    centreH: centre ? Math.round(centre.getBoundingClientRect().height) : null,
    composerTop: Math.round(tr.top),
    composerBottom: Math.round(tr.bottom),
    // The composer card, which is what must clear the keyboard.
    cardBottom: (() => {
      let el = ta
      while (el && !(el.className || '').toString().includes('_root')) el = el.parentElement
      return el ? Math.round(el.getBoundingClientRect().bottom) : null
    })(),
    scrollAreaH: scroller ? scroller.clientHeight : null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Open a session so the composer is in a real conversation rather than the hero.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  await sleep(5000)
}

console.log('\n===== A. baseline (no keyboard, full viewport) =====')
const base = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(base, null, 1)}`)

// The frame currently derives its height from html/body, which are exactly the
// viewport. Overriding it on the frame is enough to see whether everything
// inside reflows.
console.log('\n===== B. frame height driven by a variable, set to 500px =====')
await evaluate(`(() => {
  let tag = document.getElementById('kb-probe')
  if (!tag) { tag = document.createElement('style'); tag.id = 'kb-probe'; document.head.append(tag) }
  tag.textContent = \`
    [data-slot="root"] > [class*="_frame"] {
      height: var(--kb-probe-height, 100%) !important;
    }
  \`
  document.documentElement.style.setProperty('--kb-probe-height', '500px')
  return 'applied'
})()`)
await sleep(1200)
const shrunk = JSON.parse(await evaluate(MEASURE))
console.log(`  ${JSON.stringify(shrunk, null, 1)}`)

// ── verdict ────────────────────────────────────────────────────────────────
console.log('\n===== verdict =====')
const composerMoved = base.cardBottom !== null && shrunk.cardBottom !== null
  && shrunk.cardBottom <= 505
console.log(`  composer card bottom : ${base.cardBottom} -> ${shrunk.cardBottom}  (target <= 505 for a 500px viewport)`)
console.log(`  ${composerMoved ? 'PASS' : 'FAIL'}  composer follows a shortened frame`)
console.log(`  frame height         : ${base.frameH} -> ${shrunk.frameH}`)
console.log(`  scroll area height   : ${base.scrollAreaH} -> ${shrunk.scrollAreaH}  (must stay > 0)`)

// Clean up.
await evaluate(`(() => {
  document.documentElement.style.removeProperty('--kb-probe-height')
  const t = document.getElementById('kb-probe'); if (t) t.remove()
  return 'cleaned'
})()`)
await sleep(600)
const restored = JSON.parse(await evaluate(MEASURE))
console.log(`  restored card bottom : ${restored.cardBottom}  (should be near ${base.cardBottom})`)

ws.close()
process.exit(0)
