/**
 * Verify the host conversation's touch targets.
 *
 * These controls are the host's, so the assertion is about REACH, not size: the
 * painted box stays 26-34px and a pseudo-element grows what the finger can hit.
 * Reach is measured by walking outward from the control's centre with
 * elementFromPoint (a rect cannot see a pseudo-element), and the horizontal result
 * is capped by the neighbour's pitch — the test asserts the pitch-limited value so
 * a future change that starts stealing the neighbour's taps fails here.
 *
 * Usage: node tools/verify-conversation-touch.mjs <url>
 */
const appUrl = process.argv[2]
const cdp = 'http://127.0.0.1:9222'
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page')
const ws = new WebSocket(t.webSocketDebuggerUrl)
const p = new Map(); let id = 0
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description).slice(0, 200)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

const MEASURE = `(() => {
  const walk = (el) => {
    const b = el.getBoundingClientRect()
    const hits = (x, y) => { const t = document.elementFromPoint(x, y); return t === el || (t !== null && el.contains(t)) }
    const step = (dx, dy) => { let n = 0; while (n < 40 && hits(b.left + b.width / 2 + dx * (n + 1), b.top + b.height / 2 + dy * (n + 1))) n += 1; return n }
    const l = step(-1, 0), r = step(1, 0), u = step(0, -1), d = step(0, 1)
    return { painted: [Math.round(b.width), Math.round(b.height)], hit: [l + r, u + d], x: Math.round(b.left), y: Math.round(b.top) }
  }
  const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 && b.top > -50 && b.bottom < innerHeight + 50 }
  const group = (sel, cap) => {
    const els = [...document.querySelectorAll(sel)].filter(visible)
    if (!els.length) return { sel, missing: true }
    const items = els.map(walk)
    const widths = items.map((i) => i.hit[0])
    const heights = items.map((i) => i.hit[1])
    return { sel, count: items.length, painted: items[0].painted, minWidthReach: Math.min(...widths), minHeightReach: Math.min(...heights), cap, items }
  }
  return JSON.stringify({
    messageActions: group('[data-slot="conversation.chat.assistant-actions"] button, [data-slot="conversation.chat.node"] button[class*="_action"], [data-slot="conversation.chat.node"] button[class*="_trigger"]', 36),
    composer: group('[data-slot="conversation.composer.bar"] button, [data-slot="conversation.input.model"] button', 40),
    hostTabs: group('[data-slot="conversation.session.header"] [role="tablist"] [role="tab"]', 62),
  }, null, 1)
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// This suite measures the HOST's controls inside a conversation, and `visible()`
// rejects anything outside the viewport — so it needs a session open AND its
// messages on screen. On the hero screen the header slot exists but is empty
// (`headerHidden`) and every group reports `missing`. Doing both steps here makes
// the run independent of whatever state a previous suite left in the shared browser.
const headerReady = async () => (await ev(`(() => {
  const h = document.querySelector('[data-slot="conversation.session.header"] header')
  if (h === null || h.className.includes('Hidden')) return false
  return h.querySelector('[class*="_crumbs"]') !== null
})()`)) === true

if (!(await headerReady())) {
  await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
  await sleep(1200)
  const picked = await ev(`(() => {
    const row = document.querySelector('.dsh-mobile-sess')
    if (row === null) return false
    row.click(); return true
  })()`)
  if (picked !== true) {
    throw new Error('cannot run: no session could be opened (no .dsh-mobile-sess row in the drawer)')
  }
  for (let i = 0; i < 20 && !(await headerReady()); i += 1) await sleep(500)
}

// Bring the newest message actions into view: scroll the largest scrollable box
// (the transcript) to its end. Env-dependent, so its absence is reported rather
// than asserted — the groups below still fail loudly if nothing is on screen.
const scrolled = await ev(`(() => {
  const boxes = [...document.querySelectorAll('*')].filter((e) => {
    const cs = getComputedStyle(e)
    return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight - e.clientHeight > 40
  })
  const box = boxes.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0]
  if (box === undefined) return false
  box.scrollTop = box.scrollHeight
  return true
})()`)
if (scrolled !== true) console.log('note: no scrollable transcript found; measuring whatever is already in view')
await sleep(1500)

const m = JSON.parse(await ev(MEASURE))
// Each floor is the value the layout actually allows, not a wish: the walk
// measures a nominal box one pixel short (the far edge is exclusive), and two
// groups are squeezed by something the hit layer cannot move.
const FLOORS = {
  // 28x28 on a 36px pitch: nominally 36x44 -> 35x43 measured.
  messageActions: { w: 35, h: 43, note: 'pitch 36 caps the width; height is free' },
  // 28x28 on a 40px pitch; the metric dock covers the band below the row.
  composer: { w: 39, h: 37, note: 'pitch 40 caps the width; the dock limits the height to ~37' },
  // 26x25 tabs: width goes into the row's empty middle, height is squeezed by the
  // crumb above and the transcript below. 43 is the measured value of a nominal 44
  // (the walk's far edge is exclusive).
  hostTabs: { w: 43, h: 35, note: 'grows sideways; the crumb above and transcript below cap the height' },
}
for (const [name, label] of [['messageActions', 'message actions (复制/反馈/分支/用量/用时)'], ['composer', 'composer controls (指令/附件/权限/模型/上下文/发送)'], ['hostTabs', 'host tabs (对话/轨迹)']]) {
  const g = m[name]
  const floor = FLOORS[name]
  console.log(`${name}: ${JSON.stringify({ count: g.count, painted: g.painted, minWidthReach: g.minWidthReach, minHeightReach: g.minHeightReach, floor, note: floor.note })}`)
  check(g.missing !== true, `${label}: present`, g.missing ? 'not found' : '')
  if (g.missing) continue
  check(g.minHeightReach >= floor.h, `${label}: vertical reach at or above ${floor.h}px`, `min ${g.minHeightReach}px (${floor.note})`)
  check(g.minWidthReach >= floor.w, `${label}: horizontal reach at or above ${floor.w}px`, `min ${g.minWidthReach}px`)
}

// The plugin's own drawer trigger must keep its reach: the first host tab only
// expands to the right precisely so it cannot swallow taps aimed at 导航.
const nav = JSON.parse(await ev(`(() => {
  const el = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  if (!el) return JSON.stringify({ missing: true })
  const b = el.getBoundingClientRect()
  const hits = (x, y) => { const t = document.elementFromPoint(x, y); return t === el || (t !== null && el.contains(t)) }
  let n = 0; while (n < 40 && hits(b.right + n + 1, b.top + b.height / 2)) n += 1
  return JSON.stringify({ painted: [Math.round(b.width), Math.round(b.height)], rightReach: n })
})()`))
console.log('导航:', JSON.stringify(nav))
check(nav.missing !== true && nav.rightReach >= 9, '导航 keeps its own reach beside the first host tab', `right reach ${nav.rightReach}px`)

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: host conversation controls are reachable at phone width')
process.exit(0)
