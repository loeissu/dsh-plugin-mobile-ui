/**
 * Pin down what compresses the composer stack, and whether a fix holds.
 *
 * Established already: the composer card keeps its height (128px) as the frame
 * shrinks from 915 to 300, because the conversation area has `flex-basis: 0` and
 * absorbs the change. So frame height alone does not explain the reported
 * squashing of the queued-message bar.
 *
 * What the dump did reveal is that `composerStack` is `flex-shrink: 1` — it is
 * allowed to compress. This probe therefore forces the condition under which
 * that matters: a tall item inside the composer stack (standing in for a queued
 * message) combined with a short frame, and then tests whether pinning
 * `flex-shrink: 0` on the stack prevents the squeeze.
 *
 * Usage: node tools/probe-composer-squeeze.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-composer-squeeze.mjs <url> [--cdp <url>]')
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

const MEASURE = `(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  if (stack === null) return JSON.stringify({ missing: true })
  const fake = document.getElementById('squeeze-fake')
  const conv = [...document.querySelectorAll('*')].find((e) => {
    const s = getComputedStyle(e)
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4
  })
  return JSON.stringify({
    stackH: Math.round(stack.getBoundingClientRect().height),
    stackFlexShrink: getComputedStyle(stack).flexShrink,
    stackScrollH: stack.scrollHeight,
    fakeH: fake ? Math.round(fake.getBoundingClientRect().height) : null,
    // If the stack is squeezed, its content is taller than the box.
    squeezed: fake ? stack.scrollHeight > stack.clientHeight + 2 : null,
    convH: conv ? conv.clientHeight : null,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  await sleep(5000)
}

// A stand-in for a queued-message row: 90px of real content inside the stack.
await evaluate(`(() => {
  const stack = document.querySelector('[class*="composerStack"]')
  let fake = document.getElementById('squeeze-fake')
  if (!fake) {
    fake = document.createElement('div')
    fake.id = 'squeeze-fake'
    fake.style.cssText = 'height:90px;flex:none;background:rgba(77,107,254,.12);border-radius:10px;margin:4px 0'
    fake.textContent = 'queued-message stand-in'
    stack.prepend(fake)
  }
  return 'injected'
})()`)
await sleep(600)

console.log('\n== baseline with a tall item in the stack (full-height frame) ==')
console.log(await evaluate(MEASURE))

console.log('\n== frame forced short, as it is while the keyboard is up ==')
for (const h of [560, 420, 340]) {
  await evaluate(`document.documentElement.style.setProperty('--dsh-mobile-vv-height', '${h}px')`)
  await sleep(500)
  const m = JSON.parse(await evaluate(MEASURE))
  console.log(`  frame=${h}  stackH=${m.stackH}  fakeH=${m.fakeH}  stackFlexShrink=${m.stackFlexShrink}  squeezed=${m.squeezed}  conv=${m.convH}`)
}

console.log('\n== the same, with flex-shrink: 0 pinned on the composer stack ==')
await evaluate(`(() => {
  let tag = document.getElementById('squeeze-fix')
  if (!tag) { tag = document.createElement('style'); tag.id = 'squeeze-fix'; document.head.append(tag) }
  tag.textContent = '[class*="composerStack"] { flex-shrink: 0 !important; }'
  return 'applied'
})()`)
await sleep(500)
for (const h of [560, 420, 340]) {
  await evaluate(`document.documentElement.style.setProperty('--dsh-mobile-vv-height', '${h}px')`)
  await sleep(500)
  const m = JSON.parse(await evaluate(MEASURE))
  console.log(`  frame=${h}  stackH=${m.stackH}  fakeH=${m.fakeH}  squeezed=${m.squeezed}  conv=${m.convH}`)
}

// Clean up.
await evaluate(`(() => {
  document.documentElement.style.removeProperty('--dsh-mobile-vv-height')
  document.getElementById('squeeze-fake')?.remove()
  document.getElementById('squeeze-fix')?.remove()
  return 'cleaned'
})()`)
await sleep(500)
console.log(`\n  cleaned up`)

ws.close()
process.exit(0)
