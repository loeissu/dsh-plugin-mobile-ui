/**
 * Verify the dead-link retry cadence actually escalates.
 *
 * The contract, from `DrawerOverlay.tsx`:
 *
 *   timer = setTimeout(attempt, attempts < 15 ? LINK_RETRY_MS : LINK_RETRY_SLOW_MS)
 *   // "Cadence: every 4s for the first minute, then every 15s, so a long outage does
 *   //  not turn into a battery drain."
 *
 * i.e. 15 attempts at ~4s (reaching ~60s) and the 16th ~15s later. Every claim in that
 * comment is measurable, and until this suite existed none of it was measured — the
 * audit could only say the fast phase "looked like it never escalated", because the
 * retry effect's dependency list contained `props`, whose identity changes whenever the
 * parent renders, and a re-run restarts `attempts` from zero.
 *
 * So the assertion is deliberately NOT a fixed attempt count (that would break the
 * moment the gate constant is tuned). It is the SHAPE of the cadence on one run: a run
 * of fast intervals, then an interval that is clearly slow, and the slow one not first.
 *
 * The probe is identified exactly — `fetch(location.href, { cache: 'no-store' })` — not
 * by counting same-origin requests, so nothing else the app does can pollute the series.
 *
 * Cost: this suite waits ~75s on purpose, which makes it the slowest one here. The wait
 * is the measurement; shortening it would mean not testing the gate at all.
 *
 * Usage: node tools/verify-link-retry-cadence.mjs <url>
 */
const appUrl = process.argv[2]
const cdp = process.env.CDP_URL ?? 'http://127.0.0.1:9222'
const t = (await (await fetch(`${cdp}/json/list`)).json()).find((x) => x.type === 'page')
if (t === undefined) throw new Error(`no page target on ${cdp}`)
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

/** The gate in the source, and the tolerances used to classify an interval. */
const FAST_MS = 4000
const SLOW_MS = 15000
const FAST_MAX = 8000
const SLOW_MIN = 12000
const GATE = 15
/** Long enough to see the fast phase run out and one slow interval land. */
const WAIT_MS = 100000

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: appUrl })
await sleep(9000)

await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-trigger"]')?.click()`)
await sleep(1200)

// Arm the recorder: timestamp every liveness probe, and answer it like a loopback proxy
// with no tunnel behind it (200, tiny, no host marker) so the link stays dead.
const armed = await ev(`(() => {
  window.__probeAt = []
  const realFetch = window.fetch
  window.fetch = (input, init) => {
    const isProbe = String(input) === location.href && init !== undefined && init.cache === 'no-store'
    if (!isProbe) return realFetch(input, init)
    window.__probeAt.push(Math.round(performance.now()))
    return Promise.resolve(new Response('<html><body>proxy placeholder</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }))
  }
  return 'armed'
})()`)
if (armed !== 'armed') throw new Error(`could not arm the probe recorder: ${armed}`)

// Enter the dead state through the real affordance, then confirm it took — a suite that
// silently never goes dead would pass everything below without measuring anything.
await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]').click()`)
await sleep(2500)
const dead = await ev(`document.querySelector('[data-dsh-mobile-ui="drawer-refresh"]').getAttribute('data-dead')`)
console.log(`armed; link dead = ${dead}`)
if (dead !== 'true') throw new Error(`the link never went dead (data-dead=${dead}), so the retry loop is not running`)

// Watch the probe timestamps until a clearly-slow interval appears, or the budget runs out.
const started = Date.now()
let probes = []
let gaps = []
for (;;) {
  await sleep(2000)
  probes = JSON.parse(await ev(`JSON.stringify(window.__probeAt)`))
  gaps = []
  for (let i = 1; i < probes.length; i += 1) gaps.push(probes[i] - probes[i - 1])
  if (gaps.some((g) => g >= SLOW_MIN)) break
  if (Date.now() - started > WAIT_MS) break
}

const fastCount = gaps.filter((g) => g <= FAST_MAX).length
const slowAt = gaps.findIndex((g) => g >= SLOW_MIN)
console.log(`\nprobes: ${probes.length}`)
console.log(`gaps(ms): ${JSON.stringify(gaps)}`)
console.log(`fast(<${FAST_MAX}) intervals: ${fastCount}   first slow(>=${SLOW_MIN}) at index: ${slowAt}`)

check(probes.length >= GATE + 1,
  `at least ${GATE + 1} probes ran (the loop is alive and persistent)`, `${probes.length} probes`)
check(fastCount >= GATE - 3,
  `the fast phase really ran at ~${FAST_MS}ms`, `${fastCount} fast intervals`)
check(slowAt !== -1,
  `the cadence slows to ~${SLOW_MS}ms (this is the escalation the comment promises)`,
  `gaps=${JSON.stringify(gaps.slice(-4))}`)
check(slowAt === -1 || slowAt >= GATE - 3,
  'and the slow phase comes AFTER the fast one, not immediately',
  `first slow interval is #${slowAt + 1} of ${gaps.length}`)

ws.close()
console.log('')
if (failures.length > 0) { console.log(`RESULT: ${failures.length} FAILED`); process.exit(1) }
console.log('RESULT: the dead-link retry cadence runs fast for the first minute, then backs off')
process.exit(0)
