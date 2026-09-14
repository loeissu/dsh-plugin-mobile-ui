/**
 * Verify that a phone can actually copy from the conversation.
 *
 * The host's copy helper (`dsh-web-frontend`) is:
 *
 *   if (navigator.clipboard?.writeText) { try { await writeText(t); return true } catch { return false } }
 *   // legacy textarea + execCommand('copy') — reachable ONLY if the async API is absent
 *
 * so when the async API exists but REJECTS — the normal Android WebView case — it
 * returns false without trying its own fallback, and its caller returns silently
 * (`if (!ok) return`). Measured before the fix, with a rejecting stub and a real touch
 * tap: writeText called once, execCommand called ZERO times, nothing copied, no feedback.
 *
 * The rejecting stub has to be installed BEFORE the app boots, because the fix works by
 * wrapping whatever `navigator.clipboard.writeText` the page already has — a stub
 * installed afterwards would simply replace the wrapper and prove nothing.
 *
 * Assertions use the real clipboard (`readText`, with permissions granted) rather than
 * a stub, so "it copied" means the text is actually on the clipboard.
 *
 * Usage: node tools/verify-clipboard-fallback.mjs <url>
 */
const appUrl = process.argv[2]
const origin = new URL(appUrl).origin
// The debugger endpoint is overridable so the suite is not welded to one port.
const cdp = process.env.CDP_URL ?? 'http://127.0.0.1:9222'

// Grant clipboard read/write so the assertions can read back what was copied.
const version = await (await fetch(`${cdp}/json/version`)).json()
const browserWs = new WebSocket(version.webSocketDebuggerUrl)
const bp = new Map(); let bid = 0
await new Promise((r, j) => { browserWs.onopen = r; browserWs.onerror = j })
browserWs.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && bp.has(m.id)) { bp.get(m.id)(m); bp.delete(m.id) } }
const bsend = (method, params = {}) => new Promise((r) => { const i = ++bid; bp.set(i, r); browserWs.send(JSON.stringify({ id: i, method, params })) })
await bsend('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] })

// Pick the app page by the HOST:PORT of the URL this suite was handed, never by a
// hardcoded port. Two reasons: with the port baked in the suite could not run at all
// on another dev port, and — the reason it could not be run standalone — before the
// first navigation the page target is still `about:blank`, so a URL filter matched
// nothing and the run died on `undefined`. Preference: the app's own origin, then any
// page. It navigates itself in boot(), so any page target will do.
const hostPort = new URL(appUrl).host
const pages = (await (await fetch(`${cdp}/json/list`)).json()).filter((x) => x.type === 'page')
const t = pages.find((x) => x.url.includes(hostPort)) ?? pages[0]
if (t === undefined) {
  throw new Error(`no page target on ${cdp} — start Chrome with a --remote-debugging-port and a blank page`)
}
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map(); let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id
  const timer = setTimeout(() => {
    if (p.has(i)) { p.delete(i); reject(new Error(`CDP timeout: ${method}`)) }
  }, 15000)
  p.set(i, (m) => { clearTimeout(timer); resolve(m) })
  ws.send(JSON.stringify({ id: i, method, params }))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description).slice(0, 220)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

await send('Runtime.enable'); await send('Page.enable')
// Headless Chrome reports the document as unfocused after a navigation, and the
// Clipboard API refuses to read in that state ("Document is not focused"). The very
// first readText() then returns `__read_failed__` while a later one (after the tap
// focused the page) succeeds — which phase 3 used to report as "the clipboard
// changed". A real user's tab is focused, so force that state here.
await send('Emulation.setFocusEmulationEnabled', { enabled: true })

/** Boot the app with the async clipboard already failing (or not), and open a session. */
const boot = async ({ rejectAsync, touch, width, height }) => {
  // A hidden page never acknowledges `Input.dispatchTouchEvent` (measured: with
  // document.hidden true every touch dispatch timed out while evaluates answered in
  // 1ms, and `Page.bringToFront` did not help). Focus emulation clears
  // document.hidden and the dispatch acks in ~10ms, so this runs whether the browser
  // window is visible or not.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: touch ? 2 : 1, mobile: touch })
  if (rejectAsync) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__async = 0
        try {
          const real = navigator.clipboard && navigator.clipboard.writeText
          if (real) {
            navigator.clipboard.writeText = (text) => {
              window.__async += 1
              window.__asyncText = String(text)
              return Promise.reject(new DOMException('Write permission denied', 'NotAllowedError'))
            }
          }
        } catch (e) { window.__asyncErr = String(e) }
      `,
    })
  }
  await send('Page.navigate', { url: appUrl })
  await sleep(9000)
  await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
  await sleep(1200)
  // Not `?.`: if no session row exists the suite would go on to measure an empty
  // conversation and fail on the clipboard assertions with a misleading reason.
  const opened = await ev(`(() => {
    const row = document.querySelector('.dsh-mobile-sess')
    if (row === null) return false
    row.click(); return true
  })()`)
  if (opened !== true) {
    throw new Error('no session could be opened: the drawer rendered no .dsh-mobile-sess row')
  }
  await sleep(4500)
}

/** Tap the 复制 control with a real touch tap; returns what it saw and what got copied. */
const tapCopy = async () => {
  const info = JSON.parse(await ev(`(() => {
    const btn = [...document.querySelectorAll('button, [role="button"]')]
      .filter((x) => /复制/.test(x.getAttribute('aria-label') || '')).pop()
    if (!btn) return JSON.stringify({ missing: true })
    btn.scrollIntoView({ block: 'center' })
    const r = btn.getBoundingClientRect()
    window.__landed = null
    window.__exec = 0
    const realExec = document.execCommand.bind(document)
    // Count the legacy path but still PERFORM it: a counting stub that swallows the
    // copy would make the assertions below measure the stub instead of the fix.
    document.execCommand = (cmd, ...rest) => {
      if (String(cmd).toLowerCase() === 'copy') { window.__exec += 1; return realExec(cmd, ...rest) }
      return realExec(cmd, ...rest)
    }
    document.addEventListener('click', (e) => {
      const el = e.target
      // An SVG element's className is an SVGAnimatedString, not a string.
      window.__landed = el instanceof Element
        ? (el.getAttribute('aria-label') || (typeof el.className === 'string' ? el.className.split(' ')[0] : '') || el.tagName)
        : String(el)
    }, true)
    const node = btn.closest('[data-slot="conversation.chat.node"]')
    window.__nodeText = node ? (node.textContent || '').trim() : ''
    return JSON.stringify({ center: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })
  })()`))
  if (info.missing === true) return { missing: true }
  const before = await ev(`(async () => { try { return await navigator.clipboard.readText() } catch (e) { return '__read_failed__' } })()`)
  const [x, y] = info.center
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await sleep(60)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(1500)
  const after = JSON.parse(await ev(`(async () => {
    let clip = ''
    try { clip = await navigator.clipboard.readText() } catch (e) { clip = '__read_failed__ ' + e.name }
    return JSON.stringify({ landed: window.__landed, clip, before: ${JSON.stringify(before)}, asyncCalls: window.__async ?? null, execCalls: window.__exec, nodeText: window.__nodeText })
  })()`))
  return after
}

/** A word from the copied text that must appear in the message it was copied from. */
const wordFrom = (text) => String(text).replace(/[#*`>\-\r\n]/g, ' ').trim().split(/\s+/).find((w) => w.length >= 6) ?? ''

console.log('## 1. phone, async clipboard healthy')
await boot({ rejectAsync: false, touch: true, width: 412, height: 915 })
// A sentinel makes "something was copied" observable even when the copied text is
// identical between phases (the clipboard is browser-level and survives navigations).
const SENTINEL = '__dsh_copy_sentinel__'
await ev(`navigator.clipboard.writeText(${JSON.stringify(SENTINEL)}).catch(() => {})`)
const r1 = await tapCopy()
console.log('  landed on:', r1.landed)
console.log('  clipboard  :', JSON.stringify(String(r1.clip).slice(0, 40)), `(${String(r1.clip).length} chars)`)
check(r1.landed === '复制', 'a touch tap lands on the 复制 control (our hit layers do not divert it)', `landed=${r1.landed}`)
check(String(r1.clip) !== SENTINEL && String(r1.clip).length > 40 && !String(r1.clip).startsWith('__read_failed__'),
  'the message really reaches the clipboard', `${String(r1.clip).length} chars, sentinel replaced`)
check(r1.execCalls === 0, 'a healthy environment never takes the legacy path (no double copy)', `execCommand=${r1.execCalls}`)

// Leave a sentinel behind so phase 2 can tell that ITS copy wrote something.
await ev(`navigator.clipboard.writeText(${JSON.stringify(SENTINEL)}).catch(() => {})`)
await sleep(200)

console.log('\n## 2. phone, async clipboard REJECTS (the Android WebView case)')
await boot({ rejectAsync: true, touch: true, width: 412, height: 915 })
const r2 = await tapCopy()
console.log('  landed on:', r2.landed, ' async attempts:', r2.asyncCalls, ' legacy calls:', r2.execCalls)
console.log('  clipboard  :', JSON.stringify(String(r2.clip).slice(0, 40)), `(${String(r2.clip).length} chars)`)
check(r2.asyncCalls !== null && r2.asyncCalls >= 1, 'the async API is still tried first', `writeText calls=${r2.asyncCalls}`)
check(String(r2.clip) !== SENTINEL && String(r2.clip).length > 40, 'the legacy fallback still copies (before the fix: nothing was copied, sentinel intact)', `${String(r2.clip).length} chars`)
check(r2.execCalls >= 1, 'and it went through the legacy path', `execCommand=${r2.execCalls}`)
check(String(r2.clip) === String(r1.clip), 'copying exactly what the host asked for (same text as the healthy path)', `${String(r2.clip).length} vs ${String(r1.clip).length} chars`)

console.log('\n## 3. desktop viewport, async clipboard rejects')
await boot({ rejectAsync: true, touch: false, width: 1440, height: 900 })
const r3 = await tapCopy()
console.log('  landed on:', r3.landed, ' async attempts:', r3.asyncCalls, ' legacy calls:', r3.execCalls)
console.log('  clipboard  :', JSON.stringify(String(r3.clip).slice(0, 40)))
console.log('  before     :', JSON.stringify(String(r3.before).slice(0, 40)))
check(r3.asyncCalls !== null && r3.asyncCalls >= 1, 'the desktop tap still tries the async API', `writeText calls=${r3.asyncCalls}`)
check(r3.execCalls === 0, 'and is NOT papered over with the legacy path (desktop semantics unchanged)', `execCommand=${r3.execCalls}`)
// A failed READ makes the equality below meaningless (it compares a sentinel against
// real text and reports it as "the clipboard changed"), so prove both reads worked
// first — otherwise this assertion blames the product for a clipboard-access problem.
const readState = (v) => JSON.stringify(String(v).slice(0, 24))
check(!String(r3.before).startsWith('__read_failed__') && !String(r3.clip).startsWith('__read_failed__'),
  'both desktop clipboard reads succeeded', `before=${readState(r3.before)} clip=${readState(r3.clip)}`)
check(String(r3.clip) === String(r3.before), 'nothing new reached the clipboard on the desktop',
  `before=${readState(r3.before)} clip=${readState(r3.clip)}`)

await bsend('Browser.resetPermissions')
ws.close(); browserWs.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: 复制 works on a phone even when the async clipboard API rejects')
process.exit(0)
