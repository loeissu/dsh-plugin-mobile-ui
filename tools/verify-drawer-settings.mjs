/**
 * Verify the mobile drawer exposes Settings and the host modal actually paints.
 *
 * Usage: node tools/verify-drawer-settings.mjs <app-url-with-token> <out-dir>
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/verify-drawer-settings.mjs <url> <out-dir>')
}
const cdpBase = 'http://127.0.0.1:9222'
mkdirSync(outDir, { recursive: true })

const target = (await (await fetch(`${cdpBase}/json/list`)).json()).find((t) => t.type === 'page')
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

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

const trigger = await evaluate(`(() => {
  const t = document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')
  if (!t) return 'no-trigger'
  t.click(); return 'clicked'
})()`)
console.log(`drawer: ${trigger}`)
await sleep(700)

const btn = JSON.parse(await evaluate(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-settings"]')
  if (!b) return JSON.stringify({ present: false })
  const r = b.getBoundingClientRect()
  return JSON.stringify({
    present: true,
    text: (b.textContent || '').trim(),
    visible: r.width > 0 && r.height > 0,
    w: Math.round(r.width), h: Math.round(r.height),
  })
})()`))
console.log('settings button', btn)
check(btn.present === true, 'drawer has a settings button')
check(btn.visible === true, 'settings button is visible in the open drawer', `${btn.w}x${btn.h}`)
await shoot('01-drawer-settings')

console.log(await evaluate(`(() => {
  const b = document.querySelector('[data-dsh-mobile-ui="drawer-settings"]')
  b && b.click()
  return 'clicked settings'
})()`))
await sleep(900)

const modal = JSON.parse(await evaluate(`(() => {
  const d = document.querySelector('[role="dialog"]')
  if (!d) return JSON.stringify({ present: false })
  const r = d.getBoundingClientRect()
  const cs = getComputedStyle(d)
  const text = (d.innerText || '').slice(0, 120)
  return JSON.stringify({
    present: true,
    w: Math.round(r.width), h: Math.round(r.height),
    painted: r.width > 40 && r.height > 40,
    display: cs.display,
    text,
    hasGeneral: /通用|General/.test(text),
    hasMobile: /移动端|Mobile/.test(text),
  })
})()`))
console.log('modal', modal)
check(modal.present === true, 'settings modal opened')
check(modal.painted === true, 'settings modal paints on screen', `${modal.w}x${modal.h}`)
check(modal.hasGeneral === true, 'modal shows General section', modal.text.slice(0, 60))
await shoot('02-settings-modal')

console.log('')
if (failures.length > 0) {
  console.log(`RESULT: ${failures.length} FAILED`)
  process.exit(1)
}
console.log('RESULT: drawer settings entry opens a painted host modal')
process.exit(0)
