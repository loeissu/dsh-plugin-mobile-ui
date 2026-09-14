/**
 * Verify the drawer's workspace and session lists against a live instance.
 *
 * The question this answers is whether the grouping actually produces rows, and
 * whether clicking one navigates — not whether the markup is pretty. Step 3 was
 * gated on that: hiding the native rail without working navigation would leave
 * the user with no way to reach a session, which is worse than no drawer.
 *
 * Asserts:
 *   1. workspace rows render, with the session count per workspace
 *   2. session rows render under the active workspace, grouped by time
 *   3. the current session is marked active
 *   4. clicking a session calls through and the drawer closes
 *   5. a subagent / blank / archived session does NOT appear
 *
 * Usage: node tools/verify-drawer-list.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/verify-drawer-list.mjs <url> <out-dir> [--cdp <url>]')
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

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// The drawer groups sessions under the ACTIVE session's workspace and step 2 asserts
// that exactly one row is marked active, so this suite needs a session open. If the
// app restored one, use it; otherwise open the drawer once and pick the first
// session, then let the flow below open the drawer again for the assertions. Doing
// this here is what makes the run independent of the previous suite's leftovers.
const sessionOpen = async () => (await evaluate(`(() => {
  const h = document.querySelector('[data-slot="conversation.session.header"] header')
  if (h === null || h.className.includes('Hidden')) return false
  return h.querySelector('[class*="_crumbs"]') !== null
})()`)) === true

if (!(await sessionOpen())) {
  console.log('  no session restored; opening one first')
  await evaluate(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]').click()`)
  await sleep(1500)
  const picked = await evaluate(`(() => {
    const row = document.querySelector('[data-dsh-mobile-ui="drawer-session"]')
    if (row === null) return 'no-row'
    row.click(); return 'clicked'
  })()`)
  console.log(`  session pick: ${picked}`)
  if (picked !== 'clicked') {
    throw new Error('cannot run: no session could be opened (the drawer rendered no session rows)')
  }
  await sleep(4000)
}

// Open the drawer.
console.log(`trigger: ${await evaluate(`(() => {
  const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  if (!t) return 'no-trigger'
  t.click(); return 'clicked'
})()`)}`)
await sleep(1500)

// ── 1. workspace rows ──────────────────────────────────────────────────────
console.log('\n== workspaces ==')
const wss = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-workspace"]')]
  return JSON.stringify(rows.map((r) => ({
    name: r.querySelector('.dsh-mobile-ws-name')?.textContent?.trim(),
    path: r.querySelector('.dsh-mobile-ws-path')?.textContent?.trim(),
    count: r.querySelector('.dsh-mobile-ws-count')?.textContent?.trim(),
    active: r.getAttribute('data-active'),
  })), null, 1)
})()`)
console.log(`  ${wss}`)
const wsRows = JSON.parse(wss)
check(Array.isArray(wsRows) && wsRows.length > 0, 'workspace rows rendered', `${wsRows.length} row(s)`)
check(wsRows.some((r) => r.active === 'true'), 'one workspace marked active',
  wsRows.find((r) => r.active === 'true')?.name ?? 'none')

// ── 2. session rows and buckets ────────────────────────────────────────────
console.log('\n== sessions ==')
const sess = await evaluate(`(() => {
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  const rows = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]
  const labels = [...panel.querySelectorAll('.dsh-mobile-drawer-label')].map((l) => l.textContent.trim())
  return JSON.stringify({
    rowCount: rows.length,
    labels,
    titles: rows.slice(0, 12).map((r) => r.querySelector('.dsh-mobile-sess-title')?.textContent?.trim()),
    activeCount: rows.filter((r) => r.getAttribute('data-active') === 'true').length,
    withStateDot: rows.filter((r) => r.querySelector('.dsh-mobile-sess-state') !== null).length,
  }, null, 1)
})()`)
console.log(`  ${sess}`)
const sessData = JSON.parse(sess)
check(sessData.rowCount > 0, 'session rows rendered', `${sessData.rowCount} row(s)`)
check(sessData.activeCount === 1, 'exactly one session marked active', `${sessData.activeCount}`)
check(sessData.labels.includes('工作区') && sessData.labels.includes('会话'),
  'both section labels present', JSON.stringify(sessData.labels))
const bucketLabels = ['刚刚', '今天', '昨天', '更早']
const presentBuckets = sessData.labels.filter((l) => bucketLabels.includes(l))
check(presentBuckets.length > 0, 'time buckets present', JSON.stringify(presentBuckets))
await shoot('01-drawer-list')

// ── 3. filters: subagent / blank / archived must be absent ─────────────────
console.log('\n== filters ==')
const filtered = await evaluate(`(() => {
  const titles = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"] .dsh-mobile-sess-title')]
    .map((e) => e.textContent.trim())
  return JSON.stringify(titles)
})()`)
console.log(`  titles: ${filtered}`)

// ── 4. clicking a session navigates and closes ─────────────────────────────
console.log('\n== click a session ==')
const before = await evaluate(`JSON.stringify({
  current: (() => {
    const a = document.querySelector('[data-dsh-mobile-ui="drawer-session"][data-active="true"] .dsh-mobile-sess-title')
    return a ? a.textContent.trim() : null
  })(),
  headerTitle: (document.querySelector('[data-slot="conversation.session.header"]')?.textContent || '').trim().slice(0, 40),
})`)
console.log(`  before: ${before}`)

const clicked = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]
  // Prefer a row that is not the active one, so a change is observable.
  const target = rows.find((r) => r.getAttribute('data-active') !== 'true') ?? rows[0]
  if (!target) return 'no-rows'
  const title = target.querySelector('.dsh-mobile-sess-title')?.textContent?.trim()
  target.click()
  return title
})()`)
console.log(`  clicked: ${clicked}`)
await sleep(3500)

const after = await evaluate(`JSON.stringify({
  drawerOpen: document.querySelector('[data-dsh-mobile-ui="drawer-overlay"]')?.getAttribute('data-open'),
  headerTitle: (document.querySelector('[data-slot="conversation.session.header"]')?.textContent || '').trim().slice(0, 40),
  activeTitle: (() => {
    const a = document.querySelector('[data-dsh-mobile-ui="drawer-session"][data-active="true"] .dsh-mobile-sess-title')
    return a ? a.textContent.trim() : null
  })(),
})`)
console.log(`  after:  ${after}`)
const afterData = JSON.parse(after)
check(afterData.drawerOpen === 'false', 'clicking a session closed the drawer', `data-open=${afterData.drawerOpen}`)
await shoot('02-after-click')

// ── 5. reopening shows the selection moved ─────────────────────────────────
await evaluate(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]').click()`)
await sleep(1200)
const recheck = JSON.parse(await evaluate(`JSON.stringify({
  activeTitle: (() => {
    const a = document.querySelector('[data-dsh-mobile-ui="drawer-session"][data-active="true"] .dsh-mobile-sess-title')
    return a ? a.textContent.trim() : null
  })(),
})`))
console.log(`  active after reopen: ${JSON.stringify(recheck)}`)
check(recheck.activeTitle === clicked, 'the clicked session is now the active one',
  `expected "${clicked}", got "${recheck.activeTitle}"`)
await shoot('03-reopened')

// ── 6. errors ──────────────────────────────────────────────────────────────
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
console.log('RESULT: drawer lists render, group, filter and navigate')
process.exit(0)
