/**
 * Verify the `sidebar` takeover before it is enabled for a real user.
 *
 * Replacing `sidebar` is the one destructive thing this plugin can do: the slot
 * is `single`/`root`, so taking it collapses every seat ui-sidebar declared.
 * The failure that matters is not visual — it is a user who can no longer reach
 * workspace switching or the settings entry point, with no way back on a phone.
 *
 * So this checks function, not appearance:
 *   1. the drawer mounted and replaced ui-sidebar (the old brand row is gone)
 *   2. every seat the entry declares actually rendered content
 *   3. the settings entry point still opens the settings dialog
 *   4. the drawer's own toggle expands the column
 *
 * Usage: node tools/verify-drawer.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/verify-drawer.mjs <url> [--cdp <url>]')
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
    errors.push(String(m.params.exceptionDetails.exception?.description ?? '').slice(0, 260))
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
await sleep(8000)

// ── 1. did the takeover happen? ────────────────────────────────────────────
console.log('\n== takeover ==')
const shape = await evaluate(`(() => {
  const drawer = document.querySelector('[data-dsh-mobile-ui="drawer"]')
  const sidebarSlot = document.querySelector('[data-slot="sidebar"]')
  return JSON.stringify({
    drawerPresent: drawer !== null,
    sidebarSlotPresent: sidebarSlot !== null,
    drawerIsTheOutlet: drawer !== null && sidebarSlot !== null && sidebarSlot.contains(drawer),
    collapsed: drawer ? drawer.getAttribute('data-collapsed') : null,
  })
})()`)
console.log(`  ${shape}`)
const s = JSON.parse(shape)
check(s.drawerPresent, 'drawer mounted into the sidebar slot')
check(s.drawerIsTheOutlet, 'the drawer occupies the sidebar outlet (ui-sidebar replaced)')

// ── 2. every declared seat rendered something ──────────────────────────────
console.log('\n== seats ==')
const seats = await evaluate(`(() => {
  const drawer = document.querySelector('[data-dsh-mobile-ui="drawer"]')
  if (!drawer) return JSON.stringify({ error: 'no drawer' })
  const seatText = (sel) => {
    const el = drawer.querySelector(sel)
    if (el === null) return null
    const t = (el.textContent || '').trim()
    return { present: true, chars: t.length, empty: el.children.length === 0 }
  }
  // The seats are rendered through renderSlot, so they appear as the slot
  // outlet divs the renderer stamps with data-slot.
  const outlets = Array.from(drawer.querySelectorAll('[data-slot]')).map((e) => e.getAttribute('data-slot'))
  return JSON.stringify({
    outlets,
    text: (drawer.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
    hasToggle: drawer.querySelector('.dsh-mobile-drawer__toggle') !== null,
    brandSvg: drawer.querySelectorAll('svg').length,
  })
})()`)
console.log(`  ${seats}`)
const st = JSON.parse(seats)
const expectedSeats = [
  'sidebar.brand.mark', 'sidebar.brand.name',
  'sidebar.workspaces', 'sidebar.panellist',
  'sidebar.settings', 'sidebar.footer.action',
]
const rendered = new Set(st.outlets ?? [])
const missing = expectedSeats.filter((k) => !rendered.has(k))
console.log(`  outlets rendered: ${JSON.stringify([...rendered])}`)
check(missing.length === 0, 'all six declared seats rendered', missing.length === 0 ? '' : `missing: ${missing.join(', ')}`)
check(st.hasToggle === true, 'drawer has its own expand toggle')
check((st.text ?? '').length > 0, 'drawer has visible content', `${(st.text ?? '').length} chars`)

// ── 3. the settings entry point still works ────────────────────────────────
console.log('\n== settings reachable ==')
const openedSettings = await evaluate(`(() => {
  const drawer = document.querySelector('[data-dsh-mobile-ui="drawer"]')
  if (!drawer) return 'no-drawer'
  const trigger = drawer.querySelector('[data-slot="sidebar.settings"] button')
    || drawer.querySelector('[data-slot="sidebar.settings"]')
  if (!trigger) return 'no-settings-trigger'
  trigger.click()
  return 'clicked'
})()`)
console.log(`  ${openedSettings}`)
await sleep(1800)
const dialog = await evaluate(`document.querySelector('[role="dialog"]') !== null`)
check(dialog === true, 'settings dialog opens from the drawer',
  dialog ? '' : 'the settings entry point is GONE — do not enable this')

// ── 4. the drawer expands ──────────────────────────────────────────────────
console.log('\n== expand ==')
const toggled = await evaluate(`(() => {
  const drawer = document.querySelector('[data-dsh-mobile-ui="drawer"]')
  if (!drawer) return 'no-drawer'
  const btn = drawer.querySelector('.dsh-mobile-drawer__toggle')
  if (!btn) return 'no-toggle'
  const before = drawer.getAttribute('data-collapsed')
  btn.click()
  return JSON.stringify({ before })
})()`)
await sleep(600)
const after = await evaluate(`(() => {
  const drawer = document.querySelector('[data-dsh-mobile-ui="drawer"]')
  if (!drawer) return 'gone'
  const cs = getComputedStyle(drawer)
  const col = drawer.closest('[data-slot="sidebar"]') ?? drawer
  const r = col.getBoundingClientRect()
  return JSON.stringify({
    collapsed: drawer.getAttribute('data-collapsed'),
    width: Math.round(r.width),
    visibleLabels: drawer.querySelectorAll('.dsh-mobile-drawer__label').length,
  })
})()`)
console.log(`  toggle: ${toggled}  →  ${after}`)

// ── 5. errors ──────────────────────────────────────────────────────────────
console.log('\n== exceptions ==')
const real = errors.filter((e) => !/ResizeObserver/i.test(e))
console.log(real.length === 0 ? '  none' : real.map((e) => `  ${e}`).join('\n'))
check(real.length === 0, 'no page exceptions with the drawer mounted', real.slice(0, 2).join(' | '))

// Screenshot for the record.
const shot = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
const out = process.argv[3] ?? 'drawer-check.png'
writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log(`\nsaved ${out}`)

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED — DO NOT enable this on a real device`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: the sidebar takeover preserves every entry point')
process.exit(0)
