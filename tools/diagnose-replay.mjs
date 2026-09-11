/**
 * Diagnose why the splash is not visible after pressing Replay.
 *
 * The suspicion is a stacking problem that only appears on this path: the
 * replay button lives inside DSH's settings dialog, so the splash is raised
 * while a modal is open. Every earlier splash capture happened at boot with no
 * dialog present, so that combination was never exercised.
 *
 * The decisive probe is `elementFromPoint` at the viewport centre: it reports
 * which element actually receives a tap there. If it is not the splash, the
 * splash is mounted but painted underneath something.
 *
 * Usage: node tools/diagnose-replay.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/diagnose-replay.mjs <url> [--cdp <url>]')
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
const errors = []
let nextId = 0
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 300))
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
  if (r.result?.exceptionDetails) return { __error: String(r.result.exceptionDetails.exception?.description) }
  return r.result?.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(8000)

// ── A. baseline: is the plugin's settings section present at all? ───────────
console.log('\n== A. plugin presence ==')
const present = await evaluate(`JSON.stringify({
  settingsTrigger: document.querySelector('[data-slot="settings.trigger"]') !== null,
  overlayOutlet: document.querySelectorAll('[data-slot="shell.overlay"]').length,
})`)
console.log(`  ${present}`)

// ── B. open settings, find our section ─────────────────────────────────────
console.log('\n== B. open settings ==')
console.log(`  trigger: ${await evaluate(`(() => {
  const t = document.querySelector('[data-slot="settings.trigger"] button')
    || document.querySelector('[data-slot="settings.trigger"]')
    || document.querySelector('button[aria-label*="设置"], button[aria-label*="Settings" i]')
  if (!t) return 'none'
  t.click(); return 'clicked'
})()`)}`)
await sleep(1800)

const nav = await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return JSON.stringify({ dialog: false })
  const labels = Array.from(dialog.querySelectorAll('nav button, nav [role="tab"], nav li'))
    .map((e) => (e.textContent || '').trim()).filter(Boolean)
  return JSON.stringify({ dialog: true, labels })
})()`)
console.log(`  nav: ${nav}`)

const section = await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (!dialog) return 'no-dialog'
  const cells = Array.from(dialog.querySelectorAll('nav button, nav [role="tab"], nav li'))
  const ours = cells.find((c) => /移动端|Mobile/.test(c.textContent || ''))
  if (!ours) return 'section-missing'
  ours.click(); return 'opened'
})()`)
console.log(`  our section: ${section}`)
await sleep(1500)

// ── C. the dialog's stacking context ───────────────────────────────────────
console.log('\n== C. z-index landscape while the dialog is open ==')
console.log(`  ${await evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"]')
  const chain = []
  let el = dialog
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el)
    if (cs.zIndex !== 'auto' || cs.position !== 'static') {
      chain.push({ tag: el.tagName.toLowerCase(), pos: cs.position, z: cs.zIndex, cls: (el.className||'').toString().slice(0,30) })
    }
    el = el.parentElement
  }
  return JSON.stringify(chain, null, 1)
})()`)}`)

// ── D. press replay, then check what is actually on top ────────────────────
console.log('\n== D. press replay ==')
console.log(`  button: ${await evaluate(`(() => {
  const s = document.querySelector('[data-dsh-mobile-ui="settings"]')
  if (!s) return 'no-settings-section'
  const b = Array.from(s.querySelectorAll('button')).find((x) => /重放|Replay/.test(x.textContent || ''))
  if (!b) return 'no-replay-button'
  b.click(); return 'pressed'
})()`)}`)
await sleep(400)

const top = await evaluate(`(() => {
  const splash = document.querySelector('[data-dsh-mobile-ui="splash"]')
  const cx = Math.round(window.innerWidth / 2)
  const cy = Math.round(window.innerHeight / 2)
  const hit = document.elementFromPoint(cx, cy)
  const hitDesc = hit === null ? 'null'
    : hit.tagName.toLowerCase() + '.' + (hit.className || '').toString().split(' ')[0].slice(0, 40)
  const hitIsSplash = hit !== null && hit.closest('[data-dsh-mobile-ui="splash"]') !== null
  let splashInfo = null
  if (splash) {
    const cs = getComputedStyle(splash)
    const r = splash.getBoundingClientRect()
    // Effective z-index: the value on the nearest positioned ancestor too.
    splashInfo = {
      zIndex: cs.zIndex,
      position: cs.position,
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
      leaving: splash.getAttribute('data-leaving'),
      rect: Math.round(r.width) + 'x' + Math.round(r.height) + ' @' + Math.round(r.top) + ',' + Math.round(r.left),
      parent: splash.parentElement ? splash.parentElement.tagName.toLowerCase() : 'none',
      inDom: true,
    }
  }
  return JSON.stringify({
    splashMounted: splash !== null,
    splash: splashInfo,
    elementAtCentre: hitDesc,
    centreIsSplash: hitIsSplash,
    dialogOpen: document.querySelector('[role="dialog"]') !== null,
  }, null, 1)
})()`)
console.log(`  ${top}`)

// ── E. did an exception fire? ──────────────────────────────────────────────
console.log('\n== E. page exceptions ==')
console.log(errors.length === 0 ? '  none' : errors.map((e) => `  ${e}`).join('\n'))

ws.close()
process.exit(0)
