/**
 * Step 3 gate: do `useSessions` and `useWorkspaces` actually reach a component
 * registered into `shell.overlay`?
 *
 * The type declarations say both live in `GlobalStandardProps`, and the Slots
 * reference lists them as available in "every scope" — which includes `root`.
 * But the whole point of gating step 3 is not to hide the native sidebar and
 * then discover the drawer has no data, so this checks the live renderer rather
 * than trusting the types.
 *
 * Method: register a probe component into `shell.overlay` at runtime from the
 * page, rendering whatever hooks it receives, and inspect the result. The probe
 * is injected through the page's own module loader, so it goes through exactly
 * the same binding path a real plugin registration would.
 *
 * The plugin already proves the *registration* side (two components in
 * shell.overlay render fine), so what is left is whether the framework hooks
 * arrive with data.
 *
 * Usage: node tools/probe-root-hooks.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-root-hooks.mjs <url> [--cdp <url>]')
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
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Inspect what the EXISTING shell.overlay occupants receive. React fibers carry
// the props a component was rendered with, so walking the fiber of our own
// splash gives the real answer without injecting anything.
console.log('\n== props seen by an existing shell.overlay occupant ==')
const splashProps = await evaluate(`(() => {
  const el = document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')
  if (!el) return 'no drawer overlay in DOM'
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
  if (!key) return 'no react fiber key on the element'
  // Walk up to the nearest function component and collect its memoizedProps.
  let fiber = el[key]
  const seen = []
  let hops = 0
  while (fiber && hops < 30) {
    const t = fiber.type
    const name = typeof t === 'function' ? (t.name || 'anon') : (typeof t === 'string' ? t : 'other')
    if (typeof t === 'function' && fiber.memoizedProps) {
      seen.push({ component: name, props: Object.keys(fiber.memoizedProps).sort() })
    }
    fiber = fiber.return
    hops += 1
  }
  return JSON.stringify(seen, null, 1)
})()`)
console.log(splashProps)

// The decisive question: are the framework hooks present among those props?
const hasHooks = (() => {
  if (typeof splashProps !== 'string' || splashProps.startsWith('__ERR__')) return null
  try {
    const parsed = JSON.parse(splashProps)
    if (!Array.isArray(parsed)) return null
    const all = new Set(parsed.flatMap((s) => s.props ?? []))
    return {
      useSessions: all.has('useSessions'),
      useWorkspaces: all.has('useWorkspaces'),
      useSessionPendingInteraction: all.has('useSessionPendingInteraction'),
      sessionId: all.has('sessionId'),
      renderSlot: all.has('renderSlot'),
      allPropNames: [...all].sort(),
    }
  } catch { return null }
})()

console.log('\n== verdict ==')
if (hasHooks === null) {
  console.log('  could not read props off the fiber — see the raw dump above')
} else {
  console.log(`  useSessions                     : ${hasHooks.useSessions}`)
  console.log(`  useWorkspaces                   : ${hasHooks.useWorkspaces}`)
  console.log(`  useSessionPendingInteraction    : ${hasHooks.useSessionPendingInteraction}`)
  console.log(`  renderSlot                      : ${hasHooks.renderSlot}`)
  console.log(`  all props on the occupant chain : ${JSON.stringify(hasHooks.allPropNames)}`)
}

// Cross-check against a component that definitely receives them: ui-workspace's
// own browser, registered into `sidebar`. If the hooks are absent there too,
// the fiber-walk is looking at the wrong node rather than proving absence.
console.log('\n== control: props seen inside the sidebar occupant ==')
const sidebarProps = await evaluate(`(() => {
  const el = document.querySelector('[data-slot="sidebar.workspaces"]')
  if (!el) return 'no sidebar.workspaces outlet'
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  if (!key) return 'no fiber key'
  let fiber = el[key]
  const out = []
  let hops = 0
  while (fiber && hops < 40) {
    const t = fiber.type
    if (typeof t === 'function' && fiber.memoizedProps) {
      const names = Object.keys(fiber.memoizedProps)
      if (names.some((n) => n.startsWith('use') || n === 'renderSlot')) {
        out.push({ component: t.name || 'anon', props: names.sort() })
      }
    }
    fiber = fiber.return
    hops += 1
  }
  return JSON.stringify(out, null, 1)
})()`)
console.log(sidebarProps)

ws.close()
process.exit(0)
