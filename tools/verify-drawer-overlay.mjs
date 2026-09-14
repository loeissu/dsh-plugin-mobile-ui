/**
 * Verify the overlay drawer's minimal skeleton.
 *
 * The assertions target the failure modes that actually matter for an overlay
 * on a click-through layer, not the appearance:
 *
 *  1. The native sidebar is hidden AND the conversation filled the space. Hiding
 *     the column alone silently collapses the grid (measured in
 *     docs/overlay-drawer-step1.md), so the two must be checked together.
 *  2. The trigger is reachable — it is the only way in once the rail is gone.
 *  3. Opening works, and the scrim closes it.
 *  4. CLOSED means click-through. This is the one that bites: an overlay left
 *     mounted with `pointer-events: auto` swallows every tap on the page, which
 *     looks identical to "the app froze".
 *  5. `elementFromPoint` at the centre is the application when closed, and the
 *     scrim when open — the direct test of what a tap would actually hit.
 *
 * Also asserted: the media query really is narrow-only, by re-running the
 * geometry check at a desktop width where nothing should change.
 *
 * Usage: node tools/verify-drawer-overlay.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/verify-drawer-overlay.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

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
    errors.push(String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 240))
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
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description)}`
  return r.result?.result?.value
}
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(s.result.data, 'base64'))
  console.log(`  saved ${name}.png`)
}

const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

/** Geometry + hit-test snapshot. */
const STATE = `(() => {
  const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]')
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const trigger = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  const scrim = document.querySelector('[data-dsh-mobile-ui="drawer-scrim"]')
  const cx = Math.round(window.innerWidth / 2)
  const cy = Math.round(window.innerHeight / 2)
  const hit = document.elementFromPoint(cx, cy)
  // Whether the tap landed on our overlay at all. This is the real question —
  // a tag-name allowlist is not, because the application's own controls are
  // buttons and carry dsh-mobile-* class prefixes of their own.
  const centreInsideOverlay = hit !== null && hit.closest('[data-dsh-mobile-ui="drawer-overlay"]') !== null
  const hitTag = hit === null ? 'null'
    : hit.tagName.toLowerCase() + (hit.getAttribute && hit.getAttribute('data-dsh-mobile-ui')
      ? '[data-dsh-mobile-ui=' + hit.getAttribute('data-dsh-mobile-ui') + ']'
      : '.' + (hit.className || '').toString().split(' ')[0].slice(0, 30))
  const triggerHit = trigger ? (() => {
    const r = trigger.getBoundingClientRect()
    const t = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2))
    return t !== null && t.closest('[data-dsh-mobile-ui="drawer-trigger"]') !== null
  })() : null
  return JSON.stringify({
    viewport: window.innerWidth + 'x' + window.innerHeight,
    frameTemplate: frame ? getComputedStyle(frame).gridTemplateColumns : 'no-frame',
    sidebarDisplay: frame ? getComputedStyle(frame.querySelector(':scope > [class*="sidebarCol"]')).display : 'n/a',
    sidebarPainted: frame ? (() => {
      const sb = frame.querySelector(':scope > [class*="sidebarCol"]')
      if (!sb) return false
      const r = sb.getBoundingClientRect()
      // Parked off-viewport: still display:block so the settings modal can paint,
      // but no on-screen box and not hit-testable at the centre.
      return r.width > 1 && r.height > 1 && r.right > 0 && r.left < window.innerWidth
    })() : null,
    centreWidth: frame ? Math.round(frame.querySelector(':scope > [class*="centerCol"]').getBoundingClientRect().width) : -1,
    rootPresent: root !== null,
    open: root ? root.getAttribute('data-open') : null,
    rootPointerEvents: root ? getComputedStyle(root).pointerEvents : null,
    panelPointerEvents: panel ? getComputedStyle(panel).pointerEvents : null,
    panelTransform: panel ? getComputedStyle(panel).transform : null,
    panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : -1,
    scrimOpacity: scrim ? getComputedStyle(scrim).opacity : null,
    scrimPointerEvents: scrim ? getComputedStyle(scrim).pointerEvents : null,
    triggerPointerEvents: trigger ? getComputedStyle(trigger).pointerEvents : null,
    // The closed subtree is inert, which is what keeps the panel's dozens of controls
    // out of the tab order and the accessibility tree while it sits invisible off the
    // left edge. Read as an ATTRIBUTE, not a style: it was written as a JSX prop and
    // React 19 (which treats inert as a boolean prop, where the empty string is falsy)
    // silently dropped it, so the only thing worth asserting is whether the attribute
    // is on the element.
    panelInert: panel ? panel.hasAttribute('inert') : null,
    scrimInert: scrim ? scrim.hasAttribute('inert') : null,
    triggerHitTestOk: triggerHit,
    elementAtCentre: hitTag,
    centreInsideOverlay,
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Open a session so the conversation surface is real, not the hero.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const rows = await listSessions(evaluate)
if (rows.length > 0) {
  const pick = rows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  console.log(`opened session [${pick === -1 ? 0 : pick}]`)
  await sleep(5000)
}

// ── closed state ───────────────────────────────────────────────────────────
console.log('\n== CLOSED ==')
const closed = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(closed, null, 1)}`)
check(closed.rootPresent, 'drawer overlay mounted into shell.overlay')
check(closed.sidebarPainted === false,
  'native sidebar not painted at phone width (parked, not display:none)',
  `display=${closed.sidebarDisplay} painted=${closed.sidebarPainted}`)
check(closed.centreWidth === closed.viewport.split('x')[0] * 1,
  'conversation filled the freed space', `centre=${closed.centreWidth} viewport=${closed.viewport}`)
check(closed.triggerPointerEvents === 'auto', 'floating trigger accepts taps')
check(closed.triggerHitTestOk === true, 'trigger is the topmost element at its own centre while closed')
check(closed.open === 'false', 'drawer starts closed')
check(closed.panelPointerEvents === 'none',
  'CLOSED drawer does not capture pointer events', `panel pointer-events=${closed.panelPointerEvents}`)
check(closed.scrimPointerEvents === 'none',
  'CLOSED scrim does not capture pointer events', `scrim pointer-events=${closed.scrimPointerEvents}`)
check(closed.panelInert === true,
  'CLOSED panel is inert (controls leave the tab order and the a11y tree)',
  `inert=${closed.panelInert}`)
check(closed.scrimInert === true,
  'CLOSED scrim is inert', `inert=${closed.scrimInert}`)
check(closed.centreInsideOverlay === false,
  'a tap at the centre reaches the application, not the overlay',
  `${closed.elementAtCentre} (insideOverlay=${closed.centreInsideOverlay})`)
await shoot('01-closed')

// ── open via the trigger ───────────────────────────────────────────────────
console.log('\n== OPEN (via trigger) ==')
const clicked = await evaluate(`(() => {
  const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  if (!t) return 'no-trigger'
  t.click(); return 'clicked'
})()`)
console.log(`  trigger: ${clicked}`)
await sleep(700)
const open = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify(open, null, 1)}`)
check(open.open === 'true', 'trigger opened the drawer')
check(open.panelPointerEvents === 'auto', 'OPEN panel accepts taps')
check(open.scrimPointerEvents === 'auto', 'OPEN scrim accepts taps (dismissable)')
// The other half of the contract: an inert panel would be visible but unusable.
check(open.panelInert === false, 'OPEN panel is NOT inert (its controls are reachable)',
  `inert=${open.panelInert}`)
check(open.scrimInert === false, 'OPEN scrim is NOT inert (it is the tap-to-close layer)',
  `inert=${open.scrimInert}`)
check(open.panelWidth > 0, 'panel has a width', `${open.panelWidth}px`)
// The panel is `min(72%, 300px)`. Narrower than the prototype's 80% on purpose:
// the drawer is dismissed by tapping the scrim, so a full-height panel at 80%
// leaves a strip too small to aim at on a phone.
const expected = Math.min(300, Math.round(412 * 0.72))
check(Math.abs(open.panelWidth - expected) <= 2, 'panel is min(72%, 300px)', `${open.panelWidth}px (expected ~${expected}px)`)
check(Number(open.scrimOpacity) > 0.3, 'scrim is visible', `opacity=${open.scrimOpacity}`)
await shoot('02-open')

// ── close via the scrim ────────────────────────────────────────────────────
console.log('\n== CLOSE (via scrim tap) ==')
const scrimClicked = await evaluate(`(() => {
  const s = document.querySelector('[data-dsh-mobile-ui="drawer-scrim"]')
  if (!s) return 'no-scrim'
  s.click(); return 'clicked'
})()`)
console.log(`  scrim: ${scrimClicked}`)
await sleep(700)
const reclosed = JSON.parse(await evaluate(STATE))
check(reclosed.open === 'false', 'scrim tap closed the drawer')
check(reclosed.panelPointerEvents === 'none',
  'panel returned to click-through after closing', `pointer-events=${reclosed.panelPointerEvents}`)
check(reclosed.panelInert === true && reclosed.scrimInert === true,
  'and the closed subtree is inert again (the guard is re-applied, not one-shot)',
  `panel=${reclosed.panelInert} scrim=${reclosed.scrimInert}`)
check(reclosed.centreInsideOverlay === false,
  'taps reach the application again after closing',
  `${reclosed.elementAtCentre} (insideOverlay=${reclosed.centreInsideOverlay})`)
await shoot('03-reclosed')

// ── close button ───────────────────────────────────────────────────────────
console.log('\n== OPEN then CLOSE via the close button ==')
await evaluate(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]').click()`)
await sleep(600)
const closeBtn = await evaluate(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-close"]')
  if (!b) return 'no-close-button'
  b.click(); return 'clicked'
})()`)
console.log(`  close button: ${closeBtn}`)
await sleep(600)
const afterClose = JSON.parse(await evaluate(STATE))
check(afterClose.open === 'false', 'close button closed the drawer')

// ── narrow-only: verify at a desktop width nothing is hidden ───────────────
console.log('\n== DESKTOP WIDTH (media query must not apply) ==')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(1500)
const desktop = JSON.parse(await evaluate(STATE))
console.log(`  ${JSON.stringify({ viewport: desktop.viewport, sidebar: desktop.sidebarDisplay, template: desktop.frameTemplate, panelPointerEvents: desktop.panelPointerEvents }, null, 1)}`)
check(desktop.sidebarDisplay !== 'none', 'native sidebar is NOT hidden at desktop width', `display=${desktop.sidebarDisplay}`)

// The assertion that was missing when this leaked.
//
// Checking only that the native sidebar survives says nothing about OUR markup.
// The component registers unconditionally, so its DOM exists at every width; if
// the rules that hide it ever move back inside the media query, the whole
// workspace/session list renders as unstyled text in the document flow — 1432px
// wide, 245 characters of it, below the fold. Presence in the DOM is therefore
// the wrong question; whether it PAINTS is the right one.
const leak = JSON.parse(await evaluate(`(() => {
  const root = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const box = (el) => {
    if (el === null) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      display: cs.display,
      painted: cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0),
      w: Math.round(r.width),
      h: Math.round(r.height),
      pointerEvents: cs.pointerEvents,
    }
  }
  return JSON.stringify({ root: box(root), panel: box(panel) })
})()`))
console.log(`  drawer at desktop width: ${JSON.stringify(leak)}`)
check(leak.root !== null && leak.root.painted === false,
  'the drawer is not painted at desktop width', `root=${JSON.stringify(leak.root)}`)
check(leak.panel !== null && leak.panel.painted === false,
  'the drawer panel is not painted at desktop width', `panel=${JSON.stringify(leak.panel)}`)
await shoot('04-desktop')

// ── errors ─────────────────────────────────────────────────────────────────
console.log('\n== exceptions ==')
const real = errors.filter((e) => !/ResizeObserver/i.test(e))
console.log(real.length === 0 ? '  none' : real.map((e) => `  ${e}`).join('\n'))
check(real.length === 0, 'no page exceptions', real.slice(0, 2).join(' | '))

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: overlay drawer skeleton behaves correctly at phone and desktop widths')
process.exit(0)
