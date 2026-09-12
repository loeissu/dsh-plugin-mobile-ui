/**
 * Overlap audit: find UI elements that overlap and steal hits from each other.
 *
 * Method: real CDP input clicks plus `elementsFromPoint` stack evidence —
 * the same discipline that caught the sticky label swallowing scroll drags
 * and the badge covering the drawer trigger. Screenshots per state go to the
 * out dir so a "PASS" can be eyeballed against what a user would see.
 *
 * States audited:
 *   A. drawer closed  — trigger reachable, nothing over it, no horizontal overflow
 *   B. drawer open    — rows/labels/fade/foot all hand hits to the right element
 *   C. settings dialog— trigger suppressed, dialog title owns its own hits
 *
 * Usage: node tools/probe-overlap-audit.mjs <url-with-token> <out-dir> [--cdp <url>]
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const appUrl = process.argv[2]
const outDir = process.argv[3]
if (appUrl === undefined || outDir === undefined) {
  throw new Error('usage: node tools/probe-overlap-audit.mjs <url> <out-dir> [--cdp <url>]')
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
  if (r.result?.exceptionDetails) return { __err__: String(r.result.exceptionDetails.exception?.description ?? '').slice(0, 300) }
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64'))
}
const click = async (x, y) => {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'touch' })
  }
}

const results = []
const check = (name, pass, evidence) => {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${evidence === undefined ? '' : `  — ${evidence}`}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true })
/* A previous run may have left the dialog open in this tab — reload first. */
await send('Page.reload')
await sleep(4000)

/* Wait out the splash so the audit starts from the steady-state UI. */
for (let i = 0; i < 20; i++) {
  const gone = await evaluate(`!document.querySelector('.dsh-mobile-splash')`)
  if (gone === true) break
  await sleep(500)
}

/* ── State A: drawer closed ─────────────────────────────────────────────── */
const a = await evaluate(`(() => {
  const trigger = document.querySelector('.dsh-mobile-drawer-trigger')
  if (!trigger) return { __err__: 'no trigger' }
  const r = trigger.getBoundingClientRect()
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
  const stack = document.elementsFromPoint(cx, cy).map((el) => {
    const cs = getComputedStyle(el)
    return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), pos: cs.position, z: cs.zIndex, pe: cs.pointerEvents, isTrigger: el === trigger, inTrigger: trigger.contains(el) && el !== trigger }
  })
  const overflows = document.documentElement.scrollWidth - window.innerWidth
  // Host surfaces near the trigger corner: anything intersecting the trigger
  // rect that is NOT part of the plugin AND NOT an ancestor of it (the
  // shell.overlay layer spans the viewport by design and is click-through).
  const intr = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[data-dsh-mobile-ui]')) continue
    if (el.contains(trigger)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    // pointer-events:none layers cover the screen by design and cannot steal
    // a tap — the shell's overlay chrome does exactly this.
    if (cs.pointerEvents === 'none') continue
    const b = el.getBoundingClientRect()
    if (b.width === 0 || b.height === 0) continue
    const inter = !(b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom)
    if (inter && (cs.position === 'fixed' || cs.position === 'absolute')) {
      intr.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] })
    }
  }
  return { triggerRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], center: [cx, cy], stack, overflows, intr: intr.slice(0, 8) }
})()`)
if (a?.__err__) { check('A0 drawer closed state reachable', false, a.__err__) } else {
  // Top hit may be the trigger's own SVG child; hits bubble to the button.
  const topEl = a.stack[0] ?? {}
  const triggerOwns = a.stack.some((s) => s.isTrigger || s.inTrigger)
  check('A1 trigger is the top hit target at its center', triggerOwns, `top=${topEl.tag}.${topEl.cls} z=${topEl.z}`)
  // Ancestors (the shell.overlay layer itself) legitimately span the viewport
  // under the trigger; only FOREIGN overlapping surfaces are a finding.
  check('A2 no foreign surface overlaps the trigger', a.intr.length === 0, a.intr.length === 0 ? 'none' : JSON.stringify(a.intr))
  check('A3 no horizontal overflow', a.overflows <= 0, `scrollWidth-innerWidth=${a.overflows}`)
}
await shot('A-closed.png')

/* ── State B: drawer open ───────────────────────────────────────────────── */
if (a && !a.__err__) {
  await click(a.center[0], a.center[1])
  await sleep(700)
  const b = await evaluate(`(() => {
    const panel = document.querySelector('.dsh-mobile-drawer-panel')
    if (!panel) return { __err__: 'panel missing after trigger click' }
    const open = panel.getAttribute('data-open') || document.querySelector('.dsh-mobile-drawer-root')?.getAttribute('data-open')
    const pr = panel.getBoundingClientRect()
    const px = Math.round(pr.left + pr.width / 2), pyMid = Math.round(pr.top + pr.height / 2)
    const mid = document.elementsFromPoint(px, pyMid).slice(0, 4).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 50))
    // Bottom fade band: taps here must reach rows, not the gradient.
    const body = document.querySelector('.dsh-mobile-drawer-body')
    const br = body ? body.getBoundingClientRect() : null
    const fadePoint = br ? [px, Math.round(br.bottom - 8)] : null
    const fadeTop = fadePoint ? document.elementsFromPoint(fadePoint[0], fadePoint[1]).slice(0, 3).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 50)) : null
    // Foot settings button.
    const foot = document.querySelector('.dsh-mobile-drawer-settings')
    const fr = foot ? foot.getBoundingClientRect() : null
    const footHit = fr ? document.elementsFromPoint(Math.round(fr.left + fr.width / 2), Math.round(fr.top + fr.height / 2))[0] : null
    const footOk = footHit ? (footHit === foot || foot.contains(footHit)) : false
    return { open, mid, fadeTop, footOk }
  })()`)
  if (b?.__err__) { check('B0 drawer opens from trigger click', false, b.__err__) } else {
    check('B1 drawer opens from a real CDP click', b.open === 'true', `data-open=${b.open}`)
    check('B2 panel center hit reaches a row, not a chrome layer', (b.mid[0] ?? '').includes('dsh-mobile') && !(b.mid[0] ?? '').includes('dsh-mobile-drawer-root'), b.mid.join(' | '))
    check('B3 bottom fade does not swallow row taps', (b.fadeTop?.[0] ?? '').includes('dsh-mobile-') && !(b.fadeTop?.[0] ?? '').includes('drawer-more'), (b.fadeTop ?? []).join(' | '))
    check('B4 foot settings button reachable', b.footOk === true)
  }
  await shot('B-open.png')

  /* ── State C: settings dialog from the drawer foot ──────────────────── */
  const fr = await evaluate(`(() => {
    const foot = document.querySelector('.dsh-mobile-drawer-settings')
    const r = foot.getBoundingClientRect()
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]
  })()`)
  if (Array.isArray(fr)) {
    await click(fr[0], fr[1])
    await sleep(900)
    const c = await evaluate(`(() => {
      const dlg = document.querySelector('[role="dialog"]')
      const trigger = document.querySelector('.dsh-mobile-drawer-trigger')
      const trigCs = trigger ? getComputedStyle(trigger) : null
      const title = dlg ? dlg.querySelector('h1, h2, [class*="_title"], [class*="_navTitle"]') : null
      const tr = title ? title.getBoundingClientRect() : null
      const titleTop = tr ? document.elementsFromPoint(Math.round(tr.left + Math.min(30, tr.width / 2)), Math.round(tr.top + tr.height / 2)).slice(0, 3).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 50)) : null
      const root = document.querySelector('.dsh-mobile-drawer-root')
      return {
        dialog: !!dlg,
        triggerOpacity: trigCs ? trigCs.opacity : 'no-trigger',
        triggerPE: trigCs ? trigCs.pointerEvents : '-',
        titleTop,
      }
    })()`)
    if (c?.__err__) { check('C0 settings dialog state probed', false, c.__err__) } else {
      check('C1 settings dialog opened', c.dialog === true)
      check('C2 trigger suppressed while dialog is up', Number(c.triggerOpacity) < 0.05 || c.triggerPE === 'none', `opacity=${c.triggerOpacity} pe=${c.triggerPE}`)
      check('C3 dialog title owns its own hit', (c.titleTop?.[0] ?? '') !== '' && !(c.titleTop?.[0] ?? '').includes('dsh-mobile-drawer-trigger'), (c.titleTop ?? []).join(' | '))
    }
    await shot('C-settings.png')
  }

  /* Close the dialog again so the tab is clean for the next run. */
  await evaluate(`(() => {
    const dlg = document.querySelector('[role="dialog"]')
    if (!dlg) return false
    const close = dlg.querySelector('[class*="_close"]')
    if (close) { close.click(); return 'clicked' }
    return 'no-close'
  })()`)
  await sleep(400)

  /* Close the drawer again (dialog open state may block the scrim). */
  await evaluate(`document.querySelector('.dsh-mobile-drawer-root')?.setAttribute('data-open', 'false')`)
}

const fails = results.filter((r) => !r.pass).length
console.log(`\\nRESULT: ${results.length - fails}/${results.length} overlap checks pass`)
writeFileSync(join(outDir, 'overlap-audit.json'), JSON.stringify(results, null, 2))
process.exit(0)
