/**
 * Render verification for this plugin, driven through the Chrome DevTools
 * Protocol against a real browser.
 *
 * Why this exists: `verify-bundle.mjs` proves the artifact satisfies the loader
 * contract, but it runs the components against stubbed hooks, so it cannot
 * observe anything real about the DOM — whether the splash actually mounts,
 * whether it is REMOVED after fading (rather than left at `opacity: 0`), or
 * whether the theme tokens resolve to actual computed values. Those are exactly
 * the failures that survive a contract check, so they need a browser.
 *
 * The recorder is installed with `Page.addScriptToEvaluateOnNewDocument`, so it
 * observes the splash from before any application script runs. Polling from the
 * outside would race the boot: the splash is only visible for ~900ms, and it
 * appears after the app frame mounts.
 *
 * Usage:
 *   node tools/verify-render.mjs <app-url-with-token> [--cdp http://127.0.0.1:9222]
 *
 * Exits non-zero on a failed assertion.
 */

const appUrl = process.argv[2]
if (appUrl === undefined) {
  throw new Error('usage: node tools/verify-render.mjs <app-url-with-token> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]

/** Shape of the recorder the page stores on `window.__dshMobileUiProbe`. */
const RECORDER = `
(() => {
  const probe = {
    startedAt: Date.now(),
    snapshots: [],
    errors: [],
    seenSplash: false,
    splashRemovedAt: null,
    readyStateAtFirstSplash: null,
  }
  globalThis.__dshMobileUiProbe = probe

  globalThis.addEventListener('error', (e) => {
    probe.errors.push(String(e.message || e.error || e))
  })
  globalThis.addEventListener('unhandledrejection', (e) => {
    probe.errors.push('unhandledrejection: ' + String(e.reason))
  })

  const SEL = '[data-dsh-mobile-ui="splash"]'
  let lastPresent = null

  const sample = () => {
    const el = document.querySelector(SEL)
    const present = el !== null
    if (present !== lastPresent) {
      lastPresent = present
      if (present) probe.seenSplash = true
      if (present && probe.readyStateAtFirstSplash === null) {
        probe.readyStateAtFirstSplash = document.readyState
      }
      if (!present && probe.seenSplash && probe.splashRemovedAt === null) {
        probe.splashRemovedAt = Date.now() - probe.startedAt
      }
    }
    if (present) {
      const cs = globalThis.getComputedStyle(el)
      probe.snapshots.push({
        t: Date.now() - probe.startedAt,
        leaving: el.getAttribute('data-leaving'),
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        display: cs.display,
        bg: cs.backgroundImage.slice(0, 120),
        color: cs.color,
        // Resolved token values, read from the element's own computed style.
        accent: cs.getPropertyValue('--dsw-alias-brand-primary-new-colorprimary-new-color').trim(),
        bgBase: cs.getPropertyValue('--dsw-alias-bg-base').trim(),
        bootBg: cs.getPropertyValue('--dsh-boot-bg').trim(),
        dark: document.body.hasAttribute('data-ds-dark-theme'),
      })
    }
  }

  const tick = globalThis.setInterval(sample, 40)
  // Stop recording after the app has had ample time to settle.
  globalThis.setTimeout(() => globalThis.clearInterval(tick), 12000)
  sample()
})()
`

/** Resolve the first page target, creating none. */
async function firstPageTarget() {
  const res = await fetch(`${cdpBase}/json/list`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (page === undefined) throw new Error('no page target on the CDP endpoint')
  return page
}

/** Minimal CDP client over the global WebSocket. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  const pending = new Map()
  const consoleLines = []
  let nextId = 0

  const ready = new Promise((resolve, reject) => {
    ws.onopen = () => { resolve() }
    ws.onerror = (event) => { reject(new Error(`websocket error: ${String(event?.message ?? '')}`)) }
  })

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      consoleLines.push(`${msg.params.type}: ${text}`.slice(0, 300))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      consoleLines.push(`exception: ${String(d.exception?.description ?? d.text)}`.slice(0, 300))
    }
  }

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

  return { ready, send, consoleLines, close: () => { ws.close() } }
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms) })

const failures = []
const notes = []
/**
 * Record an assertion result.
 * @param ok - whether the assertion held.
 * @param label - what was asserted.
 * @param detail - evidence for the report.
 */
function check(ok, label, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`
  console.log(line)
  if (!ok) failures.push(label)
}

const target = await firstPageTarget()
const cdp = connect(target.webSocketDebuggerUrl)
await cdp.ready
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')

// Install the recorder before any application script runs.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER })

console.log(`navigating: ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await cdp.send('Page.navigate', { url: appUrl })

// The splash is gone ~900ms after mount; give the app well past that, but read
// the recorder rather than sampling late (the recorder has been capturing all
// along, including at sub-second resolution).
await sleep(9000)

const read = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) {
    throw new Error(`page eval failed: ${String(r.result.exceptionDetails.exception?.description)}`)
  }
  return r.result?.result?.value
}

const probe = await read('JSON.stringify(globalThis.__dshMobileUiProbe ?? null)')
if (probe === null || probe === 'null') {
  console.error('the recorder never installed — navigation may have failed')
  cdp.close()
  process.exit(1)
}
const p = JSON.parse(probe)

console.log('')
console.log(`recorder started, readyState at first splash: ${p.readyStateAtFirstSplash}`)
console.log(`splash snapshots captured: ${p.snapshots.length}`)

// ── 1. it rendered at all ────────────────────────────────────────────────────
check(p.seenSplash === true, 'splash mounted', `first seen at readyState=${p.readyStateAtFirstSplash}`)
check(p.snapshots.length > 0, 'splash produced render snapshots', `${p.snapshots.length} samples`)

const first = p.snapshots[0]
const last = p.snapshots.at(-1)

// ── 2. it faded, and then actually unmounted ─────────────────────────────────
if (first !== undefined) {
  check(first.opacity === '1', 'splash starts fully opaque', `opacity=${first.opacity}`)
  check(first.pointerEvents === 'auto', 'splash captures pointer events while visible', `pointer-events=${first.pointerEvents}`)

  const leaving = p.snapshots.find((s) => s.leaving === 'true')
  check(leaving !== undefined, 'splash entered the leaving state',
    leaving === undefined ? 'no snapshot had data-leaving="true"' : `at t=${leaving.t}ms`)
  if (leaving !== undefined) {
    check(leaving.pointerEvents === 'none', 'leaving splash stops capturing taps', `pointer-events=${leaving.pointerEvents}`)
  }
}
check(p.splashRemovedAt !== null, 'splash REMOVED from the DOM (not merely transparent)',
  p.splashRemovedAt === null ? 'element still present after 9s' : `removed at t=${p.splashRemovedAt}ms`)

// ── 3. theme tokens resolved to real values ─────────────────────────────────
if (first !== undefined) {
  check(first.accent !== '' || first.bgBase !== '', 'DSH theme tokens resolved on the element',
    `accent="${first.accent}" bgBase="${first.bgBase}" bootBg="${first.bootBg}"`)
  check(first.bg !== 'none' && first.bg !== '', 'splash background resolved', first.bg)
  check(first.zIndex !== 'auto', 'splash sits above the app columns', `z-index=${first.zIndex}`)
  notes.push(`theme at first paint: dark=${first.dark} color=${first.color}`)
}

// ── 4. no page errors ───────────────────────────────────────────────────────
const realErrors = (p.errors ?? []).filter((e) => !/ResizeObserver|Script error/i.test(e))
check(realErrors.length === 0, 'no page errors during boot', realErrors.slice(0, 3).join(' | '))

// ── 5. the app itself came up ───────────────────────────────────────────────
const mounted = await read(`JSON.stringify({
  root: document.querySelector('#root') !== null,
  rootChildren: document.querySelector('#root')?.children.length ?? 0,
  overlayOutlet: document.querySelectorAll('[data-slot="shell.overlay"]').length,
  splashGone: document.querySelector('[data-dsh-mobile-ui="splash"]') === null,
  bodyDark: document.body.hasAttribute('data-ds-dark-theme'),
})`)
const m = JSON.parse(mounted)
check(m.root && m.rootChildren > 0, 'DSH application mounted', `#root children=${m.rootChildren}`)
check(m.splashGone === true, 'no splash element remains at rest')
notes.push(`shell.overlay outlets in DOM: ${m.overlayOutlet}; dark theme active: ${m.bodyDark}`)

if (cdp.consoleLines.length > 0) {
  console.log('')
  console.log('--- page console (tail) ---')
  for (const line of cdp.consoleLines.slice(-12)) console.log(`  ${line}`)
}

console.log('')
for (const note of notes) console.log(`note: ${note}`)
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  cdp.close()
  process.exit(1)
}
console.log('RESULT: all splash render assertions passed')
cdp.close()
process.exit(0)
