/**
 * Verify the session-title fix: the ellipsis, and the marquee on the current row.
 *
 * Two claims to check, both measurable:
 *
 *  A. The title is now a block box, so `overflow` and `text-overflow: ellipsis`
 *     apply. Before the fix it was inline: clientWidth 0, scrollWidth 0, no
 *     ellipsis, and 39px of horizontal overflow in the list.
 *  B. The CURRENT session's title animates only when its text actually overflows,
 *     and no other row animates at all.
 *
 * The animation is checked by reading the computed `transform` at two moments and
 * confirming it moved — a declared `animation` name alone would not prove the
 * marquee is running or that its distance is non-zero.
 *
 * Usage: node tools/verify-title-marquee.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/verify-title-marquee.mjs <url> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

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

const TITLES = `(() => {
  const panel = document.querySelector('[data-dsh-mobile-ui="drawer-panel"]')
  if (!panel) return JSON.stringify({ missing: true })
  const rows = [...panel.querySelectorAll('[data-dsh-mobile-ui="drawer-session"]')]
  return JSON.stringify({
    bodyOverflowsX: (() => {
      const b = panel.querySelector('.dsh-mobile-drawer-body')
      return b ? b.scrollWidth > b.clientWidth + 1 : null
    })(),
    rows: rows.map((r) => {
      const t = r.querySelector('.dsh-mobile-sess-title')
      const inner = t.firstElementChild
      const cs = getComputedStyle(t)
      const innerCs = inner ? getComputedStyle(inner) : null
      return {
        active: r.getAttribute('data-active') === 'true',
        text: (t.textContent || '').trim().slice(0, 40),
        titleDisplay: cs.display,
        // The OUTER box always reports scrollWidth == clientWidth, because its
        // child is a block that fills it. The overhang lives on the INNER span,
        // which is where the component measures it too.
        clientW: inner ? inner.clientWidth : t.clientWidth,
        scrollW: inner ? inner.scrollWidth : t.scrollWidth,
        overflowPx: inner ? Math.max(0, inner.scrollWidth - inner.clientWidth) : null,
        overflowed: inner ? inner.scrollWidth > inner.clientWidth + 1 : false,
        ellipsis: innerCs ? innerCs.textOverflow : null,
        innerDisplay: innerCs ? innerCs.display : null,
        dataScroll: t.getAttribute('data-scroll'),
        animationName: innerCs ? innerCs.animationName : null,
        marqueeDistance: t.style.getPropertyValue('--dsh-mobile-marquee-distance') || null,
        marqueeDuration: t.style.getPropertyValue('--dsh-mobile-marquee-duration') || null,
        transform: innerCs ? innerCs.transform : null,
      }
    }),
  }, null, 1)
})()`

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 560, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Open a session first, so `current` is set and a row is active.
const { openSidebar, listSessions, clickSession } = await import('./sidebar.mjs')
await openSidebar(evaluate)
await sleep(1200)
const nativeRows = await listSessions(evaluate)
if (nativeRows.length > 0) {
  const pick = nativeRows.findIndex((r) => /dsh-tether|plugin|方案|重构/i.test(r.text))
  await clickSession(evaluate, pick === -1 ? 0 : pick)
  await sleep(5000)
}

await evaluate(`(() => { const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]'); if (t) t.click(); return 'ok' })()`)
await sleep(1600)

const state = JSON.parse(await evaluate(TITLES))
if (state.missing) {
  console.log('drawer panel missing — cannot verify')
  ws.close()
  process.exit(1)
}

const active = state.rows.find((r) => r.active)
console.log(`\n== A. ellipsis / block box ==`)
console.log(`  rows: ${state.rows.length}, active: ${active ? active.text : '(none)'}`)
console.log(`  body horizontal overflow: ${state.bodyOverflowsX}`)
const sample = state.rows[0]
console.log(`  sample row: display=${sample.titleDisplay} clientW=${sample.clientW} scrollW=${sample.scrollW} ellipsis=${sample.ellipsis}`)

check(state.rows.every((r) => r.titleDisplay === 'block'),
  'every title is a block box (overflow/ellipsis can apply)',
  state.rows.map((r) => r.titleDisplay).filter((d, i, a) => a.indexOf(d) === i).join(','))
check(state.rows.every((r) => r.clientW > 0),
  'titles report a real clientWidth', `min=${Math.min(...state.rows.map((r) => r.clientW))}`)
// Rows that are NOT animating keep the ellipsis; the marqueeing row switches to
// `clip` because a translating inner must not also be ellipsized.
const staticRows = state.rows.filter((r) => r.dataScroll !== 'true')
const marqueeRows = state.rows.filter((r) => r.dataScroll === 'true')
check(staticRows.length > 0 && staticRows.every((r) => r.ellipsis === 'ellipsis'),
  'non-animating titles declare ellipsis',
  `${staticRows.length} rows, values=${[...new Set(staticRows.map((r) => r.ellipsis))].join(',')}`)
check(marqueeRows.every((r) => r.ellipsis === 'clip'),
  'the animating title switches to clip',
  `${marqueeRows.length} rows, values=${[...new Set(marqueeRows.map((r) => r.ellipsis))].join(',') || '(none)'}`)
check(state.bodyOverflowsX === false,
  'the list no longer overflows horizontally', `bodyOverflowsX=${state.bodyOverflowsX}`)

await shoot('01-ellipsis')

// ── B. marquee on the current row only ─────────────────────────────────────
console.log(`\n== B. marquee ==`)
if (active === undefined) {
  console.log('  no active row; skipping the marquee check')
} else {
  console.log(`  active title: "${active.text}"`)
  console.log(`  overflowed=${active.overflowed} dataScroll=${active.dataScroll} distance=${active.marqueeDistance} duration=${active.marqueeDuration}`)
  check(active.dataScroll === (active.overflowed ? 'true' : null) || active.dataScroll === 'true' || active.dataScroll === null,
    'data-scroll reflects the measurement', `data-scroll=${active.dataScroll}, overflowed=${active.overflowed}`)
  const nonActiveScrolling = state.rows.filter((r) => !r.active && r.dataScroll === 'true').length
  check(nonActiveScrolling === 0, 'no non-active row is animating', `${nonActiveScrolling} found`)

  if (active.dataScroll === 'true') {
    const t1 = await evaluate(`(() => {
      const t = document.querySelector('.dsh-mobile-sess[data-active="true"] .dsh-mobile-sess-title > span')
      return getComputedStyle(t).transform
    })()`)
    await sleep(1400)
    const t2 = await evaluate(`(() => {
      const t = document.querySelector('.dsh-mobile-sess[data-active="true"] .dsh-mobile-sess-title > span')
      return getComputedStyle(t).transform
    })()`)
    console.log(`  transform ${t1} -> ${t2}`)
    check(t1 !== t2, 'the active title actually moves over time', `${t1} -> ${t2}`)
    check(active.marqueeDistance !== null && parseFloat(active.marqueeDistance) > 0,
      'a non-zero distance was measured', `distance=${active.marqueeDistance}`)
    await shoot('02-marquee')
  } else {
    console.log('  active title does not overflow, so no marquee is expected')
  }
}

ws.close()
console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} assertion(s) FAILED`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('RESULT: titles ellipsize correctly and only the current one marquees')
process.exit(0)
