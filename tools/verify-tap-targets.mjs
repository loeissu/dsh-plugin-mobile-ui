/**
 * Verify the touch reach of the plugin's phone controls.
 *
 * The drawer's 导航 label is the only route into the drawer, so it must be a
 * 44x44 target even though the text paints ~25px tall — the hit area comes from
 * a pseudo-element, so this measures the REAL reach by walking outward from the
 * label with elementFromPoint instead of trusting getBoundingClientRect.
 *
 * Usage: node tools/verify-tap-targets.mjs <url>
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
  if (r.result?.exceptionDetails) return `__ERR__ ${String(r.result.exceptionDetails.exception?.description)}`
  return r.result?.result?.value
}
const failures = []
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(label)
}

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

// Walk outward from the label's box, 1px at a time, and stop where the probe no
// longer lands on the button. The two reaches are measured FROM THE CENTRE, so the
// target is their sum — adding the painted box on top would double-count it.
const reach = JSON.parse(await ev(`(() => {
  const tab = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  if (!tab) return JSON.stringify({ missing: true })
  const b = tab.getBoundingClientRect()
  const hits = (x, y) => { const el = document.elementFromPoint(x, y); return el === tab || (el !== null && tab.contains(el)) }
  const walk = (dx, dy) => { let n = 0; while (n < 40 && hits(b.left + b.width / 2 + dx * (n + 1), b.top + b.height / 2 + dy * (n + 1))) n += 1; return n }
  const left = walk(-1, 0), right = walk(1, 0), up = walk(0, -1), down = walk(0, 1)
  return JSON.stringify({
    painted: [Math.round(b.width), Math.round(b.height)],
    hit: [left + right, up + down],
    reach: { left, right, up, down },
  })
})()`))

console.log('导航 label:', JSON.stringify(reach))
check(reach.hit?.[0] >= 44, '导航 hit area is at least 44px wide', `painted ${reach.painted?.[0]} → hit ${reach.hit?.[0]}`)
check(reach.hit?.[1] >= 44, '导航 hit area is at least 44px tall', `painted ${reach.painted?.[1]} → hit ${reach.hit?.[1]}`)

await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(600)

// Same walk for the two header buttons: 36px painted, 44px target via ::after.
const header = JSON.parse(await ev(`(() => {
  const measure = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return { missing: true }
    const b = el.getBoundingClientRect()
    const hits = (x, y) => { const t = document.elementFromPoint(x, y); return t === el || (t !== null && el.contains(t)) }
    const walk = (dx, dy) => { let n = 0; while (n < 30 && hits(b.left + b.width / 2 + dx * (n + 1), b.top + b.height / 2 + dy * (n + 1))) n += 1; return n }
    const l = walk(-1, 0), r = walk(1, 0), u = walk(0, -1), d = walk(0, 1)
    return { painted: [Math.round(b.width), Math.round(b.height)], hit: [l + r, u + d] }
  }
  return JSON.stringify({ new: measure('[data-dsh-mobile-ui="drawer-new-session"]'), close: measure('[data-dsh-mobile-ui="drawer-close"]') })
})()`))
console.log('header buttons:', JSON.stringify(header))
check(header.new?.hit?.[0] >= 44 && header.new?.hit?.[1] >= 44, '＋ (new session) reaches 44px', `painted ${header.new?.painted} → hit ${header.new?.hit}`)
check(header.close?.hit?.[0] >= 44 && header.close?.hit?.[1] >= 44, '× (close) reaches 44px', `painted ${header.close?.painted} → hit ${header.close?.hit}`)

const controls = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-dsh-mobile-ui^="drawer-"]')]
  .filter(e => e.tagName === 'BUTTON' && e.getBoundingClientRect().width > 0)
  .map(e => { const b = e.getBoundingClientRect(); return { m: e.getAttribute('data-dsh-mobile-ui'), t: (e.textContent || '').trim().slice(0, 10), w: Math.round(b.width), h: Math.round(b.height) } }))`))
console.log('drawer buttons:', JSON.stringify(controls))
// The 导航 label is excluded here because its rect is only the painted text — its
// reach is measured by the walk above (as are the two header buttons).
const PAINTED_BOX_EXCEPTIONS = ['drawer-new-session', 'drawer-close', 'drawer-trigger']
const small = controls.filter((c) => c.h < 44 && !PAINTED_BOX_EXCEPTIONS.includes(c.m))
check(small.length === 0, 'drawer buttons outside the measured ones are at least 44px tall',
  small.length ? small.map((c) => `${c.m} ${c.w}x${c.h}`).join(', ') : `${controls.length - 3} buttons checked`)
check(controls.some((c) => c.m === 'drawer-settings' && c.h >= 44) && controls.some((c) => c.m === 'drawer-refresh' && c.h >= 44),
  '设置 and 刷新连接 keep a 44px row')

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: phone controls keep a reachable hit area')
process.exit(0)
