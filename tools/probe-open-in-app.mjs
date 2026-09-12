/**
 * What does the host advertise for "open in app", and does the UI offer reveal?
 *
 * Two menu items read similarly but do different things:
 *
 *   - `dsh-client-ui-deliverables` → "在文件资源管理器中显示" → `revealNativePath`
 *     → `explorer.exe /select,file:///...`, which was verified working on this
 *     machine (Explorer window count 2 -> 3, folder opened).
 *   - `dsh-client-ui-open-in-app` catalog entry `explorer` → `openNativePath`
 *     → `powershell.exe Invoke-Item -LiteralPath <path>`, which opens the ITEM
 *     with its default association. For a file that is not its folder at all.
 *
 * Which of them the UI can offer depends on what the host advertises. This reads
 * that from the live React tree via the store hooks in global props, the same way
 * `probe-root-hooks.mjs` reads session state.
 *
 * Usage: node tools/probe-open-in-app.mjs <app-url-with-token> [--cdp <url>]
 */
const appUrl = process.argv[2]
if (appUrl === undefined) throw new Error('usage: node tools/probe-open-in-app.mjs <url> [--cdp <url>]')
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

console.log(`navigating ${appUrl.replace(/token=.*/, 'token=<redacted>')}`)
await send('Page.navigate', { url: appUrl })
await sleep(11000)

/**
 * Walk the React fiber tree and collect every props object that mentions
 * openInApp. DSH passes store hooks down through global standard props, so the
 * values are reachable from the fiber that received them.
 */
console.log('\n== openInApp data found in the React tree ==')
console.log(await evaluate(`(() => {
  const root = document.querySelector('#root') || document.body
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'))
  if (!key) return 'no react container on #root'
  const seen = new Set()
  const found = []
  const walk = (fiber, depth) => {
    if (fiber === null || depth > 60 || found.length > 6) return
    const props = fiber.memoizedProps
    if (props && typeof props === 'object') {
      for (const name of Object.keys(props)) {
        if (!/openInApp/i.test(name)) continue
        const v = props[name]
        if (seen.has(name)) continue
        seen.add(name)
        let rendered
        try { rendered = JSON.stringify(v, (k, val) => (typeof val === 'function' ? '[fn]' : val)).slice(0, 600) }
        catch { rendered = String(v) }
        found.push({ name, type: typeof v, value: rendered })
      }
    }
    walk(fiber.child, depth + 1)
    walk(fiber.sibling, depth)
  }
  walk(root[key], 0)
  return JSON.stringify(found.length ? found : 'no openInApp props found', null, 1)
})()`))

console.log('\n== any element mentioning 资源管理器 anywhere in the DOM ==')
console.log(await evaluate(`(() => {
  const hits = []
  const walk = (el) => {
    for (const child of el.children) {
      const own = [...child.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
      if (/资源管理器/.test(own)) {
        const cs = getComputedStyle(child)
        const r = child.getBoundingClientRect()
        hits.push({
          tag: child.tagName.toLowerCase(),
          text: own.trim().slice(0, 30),
          cls: (child.className || '').toString().split(' ')[0].slice(0, 30),
          display: cs.display, w: Math.round(r.width), h: Math.round(r.height),
        })
      }
      walk(child)
    }
  }
  walk(document.body)
  return JSON.stringify({ count: hits.length, hits: hits.slice(0, 8) }, null, 1)
})()`))

ws.close()
process.exit(0)
