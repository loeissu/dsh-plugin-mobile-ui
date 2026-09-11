/**
 * Raise the splash on demand and photograph it.
 *
 * The splash is on screen for about a second at boot, which makes it awkward to
 * inspect — that is exactly why `replaySplash()` exists and why the settings
 * panel has a replay button. This drives that path end to end: open settings,
 * walk to this plugin's section, press the button, capture the overlay while it
 * is up, then capture again after it has faded to confirm it unmounted.
 *
 * Usage: node tools/shoot-splash-replay.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/shoot-splash-replay.mjs <url> <out-dir> [--cdp <url>]')
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
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description))
  return r.result?.result?.value
}
const shoot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  const f = join(outDir, `${name}.png`)
  writeFileSync(f, Buffer.from(s.result.data, 'base64'))
  console.log(`  saved ${f}`)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(7000)

// The splash fires on its own at boot; catch it if the timing lines up.
const bootSplash = await evaluate(`document.querySelector('[data-dsh-mobile-ui="splash"]') !== null`)
console.log(`splash still up right after boot: ${bootSplash}`)

// Open settings the way a user does.
console.log('opening settings…')
await evaluate(`(() => {
  const t = document.querySelector('[data-slot="settings.trigger"] button')
    || document.querySelector('button[aria-label*="设置"], button[aria-label*="Settings" i]')
  if (t) t.click()
  return t ? 'clicked' : 'no-trigger'
})()`)
await sleep(1500)

// Walk to this plugin's settings section.
const section = await evaluate(`(() => {
  const nav = document.querySelector('[role="dialog"] nav')
  if (!nav) return 'no-nav'
  const cells = Array.from(nav.querySelectorAll('button, [role="tab"], li'))
  const ours = cells.find((c) => /移动端|Mobile/.test(c.textContent || ''))
  if (!ours) return 'not-found: ' + cells.map((c) => (c.textContent || '').trim()).join('|')
  ours.click()
  return 'opened'
})()`)
console.log(`  settings section: ${section}`)
await sleep(1200)
await shoot('01-settings-section')

// Press the replay button and photograph the overlay while it is up.
const pressed = await evaluate(`(() => {
  const section = document.querySelector('[data-dsh-mobile-ui="settings"]')
  if (!section) return 'no-section'
  const btn = Array.from(section.querySelectorAll('button'))
    .find((b) => /重放|Replay/.test(b.textContent || ''))
  if (!btn) return 'no-button'
  btn.click()
  return 'pressed'
})()`)
console.log(`  replay button: ${pressed}`)

// The overlay mounts synchronously on the click; capture quickly.
await sleep(300)
const up = await evaluate(`(() => {
  const el = document.querySelector('[data-dsh-mobile-ui="splash"]')
  if (!el) return JSON.stringify({ present: false })
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return JSON.stringify({
    present: true,
    leaving: el.getAttribute('data-leaving'),
    opacity: cs.opacity,
    pointerEvents: cs.pointerEvents,
    coversViewport: Math.round(r.width) === window.innerWidth && Math.round(r.height) === window.innerHeight,
    size: Math.round(r.width) + 'x' + Math.round(r.height),
    viewport: window.innerWidth + 'x' + window.innerHeight,
    zIndex: cs.zIndex,
  })
})()`)
console.log(`  replay splash: ${up}`)
await shoot('02-splash-replayed')

// Confirm it removes itself rather than lingering transparent.
await sleep(2500)
const gone = await evaluate(`document.querySelector('[data-dsh-mobile-ui="splash"]') === null`)
console.log(`  splash removed after fade: ${gone}`)
await shoot('03-after-fade')

ws.close()
console.log('done')
process.exit(0)
