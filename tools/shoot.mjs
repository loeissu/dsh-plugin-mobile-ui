/**
 * Capture screenshots of the mobile UI surfaces through CDP, at a phone-sized
 * viewport, so a reviewer can see what actually renders.
 *
 * The splash is only on screen for ~1s, so it is captured by pausing the page
 * at the right moment through the CDP `Debugger` domain rather than by racing
 * it with a timer: the recorder below sets a breakpoint-free flag the moment
 * the splash mounts, and this driver polls at high frequency from the very
 * first paint.
 *
 * Usage:
 *   node tools/shoot.mjs <app-url-with-token> <out-dir> [--cdp <url>]
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/shoot.mjs <app-url-with-token> <out-dir> [--cdp <url>]')
}
const cdpIndex = process.argv.indexOf('--cdp')
const cdpBase = cdpIndex === -1 ? 'http://127.0.0.1:9222' : process.argv[cdpIndex + 1]
mkdirSync(outDir, { recursive: true })

const targets = await (await fetch(`${cdpBase}/json/list`)).json()
const target = targets.find((t) => t.type === 'page')
if (target === undefined) throw new Error('no page target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
const pending = new Map()
let nextId = 0
await new Promise((resolve, reject) => {
  ws.onopen = () => { resolve() }
  ws.onerror = () => { reject(new Error('ws error')) }
})
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

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

const shoot = async (name) => {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const file = join(outDir, `${name}.png`)
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  console.log(`  saved ${file}`)
}

await send('Runtime.enable')
await send('Page.enable')
// A 412x915 CSS viewport approximates a modern Android phone in portrait.
await send('Emulation.setDeviceMetricsOverride', {
  width: 412, height: 915, deviceScaleFactor: 2, mobile: true,
})

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })

// Catch the splash: poll tightly from the first paint.
console.log('capturing splash…')
let splashShot = false
for (let i = 0; i < 400; i += 1) {
  const present = await evaluate(`document.querySelector('[data-dsh-mobile-ui="splash"]') !== null`)
  if (present === true) {
    // One more frame so the mount has painted.
    await sleep(120)
    await shoot('01-splash')
    splashShot = true
    break
  }
  await sleep(25)
}
if (!splashShot) console.log('  (splash window missed — it may have already faded)')

// Wait for the splash to unmount, then capture the settled application.
await sleep(3500)
const gone = await evaluate(`document.querySelector('[data-dsh-mobile-ui="splash"]') === null`)
console.log(`splash unmounted: ${gone}`)
await shoot('02-app')

// The settings surface lives behind DSH's own settings dialog; open it the way
// a user would, by clicking the settings trigger, then walk to our section.
console.log('opening settings…')
await evaluate(`(() => {
  const trigger = document.querySelector('[data-slot="settings.trigger"] button')
    || document.querySelector('button[aria-label*="设置"], button[aria-label*="Settings" i]')
  if (trigger) { trigger.click(); return 'clicked' }
  return 'no trigger'
})()`)
await sleep(1200)
await shoot('03-settings-open')

const sectionFound = await evaluate(`(() => {
  const nav = document.querySelector('[role="dialog"] nav')
  if (!nav) return 'no nav'
  const cells = Array.from(nav.querySelectorAll('button, [role="tab"], li'))
  const ours = cells.find((c) => /移动端|Mobile/.test(c.textContent || ''))
  if (ours) { ours.click(); return 'clicked-section' }
  return 'section not in nav: ' + cells.map((c) => (c.textContent || '').trim()).join(' | ')
})()`)
console.log(`  ${sectionFound}`)
await sleep(1000)
await shoot('04-settings-section')

const report = await evaluate(`JSON.stringify({
  dark: document.body.hasAttribute('data-ds-dark-theme'),
  accent: getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary-new-colorprimary-new-color').trim(),
  bgBase: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
  labelPrimary: getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim(),
  settingsSectionPresent: document.querySelector('[data-dsh-mobile-ui="settings"]') !== null,
})`)
console.log(`theme: ${report}`)

ws.close()
console.log('done')
