/**
 * Resume reconnect: force a Host reconnect when the page returns to the
 * foreground while the wire is not connected.
 *
 * ## Why this exists
 *
 * The Tether Android shell is frequently backgrounded. On many devices the
 * WebView never fires `offline` / `online` for that — the WebSocket just goes
 * stale — so DSH's own recovery loop (which keys off those events) never
 * starts. The user comes back to a dead session and only notices on the next
 * send. The drawer's manual "refresh" button covers the diagnosed case; this
 * covers the common case without asking the user to remember it.
 *
 * ## Policy
 *
 * - Only act when the page becomes visible (`visibilitychange` → visible, or
 *   `pageshow` after a bfcache restore).
 * - Only act when `ctx.connection.state` is exactly `disconnected`. A live
 *   `connected` / `connecting` generation is left alone — interrupting an
 *   in-flight connect or a healthy wire would be worse than doing nothing.
 * - Debounce: a rapid hide→show pair (notification shade, app switcher) must
 *   not fire two reconnects. `pageshow` and `visibilitychange` can both fire
 *   for one restore.
 *
 * No slot, no stylesheet. Dispose removes every listener.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Minimum gap between automatic reconnects. */
const DEBOUNCE_MS = 2500

/**
 * Wire the foreground-recovery listeners.
 * @param ctx - client root; reads `ctx.connection.state` and calls `reconnect`.
 * @returns a disposer removing every listener and pending timer.
 */
export function installResumeReconnect(ctx: ClientContext): () => void {
  const connection = (ctx as unknown as {
    connection?: {
      state?: { getSnapshot?: () => string | undefined }
      reconnect?: () => void
    }
  }).connection
  if (connection?.reconnect === undefined || connection.state?.getSnapshot === undefined) {
    return () => {}
  }

  let lastFire = 0
  let timer: number | undefined

  const maybeReconnect = (): void => {
    if (document.visibilityState !== 'visible') return
    const state = connection.state?.getSnapshot?.()
    if (state !== 'disconnected') return
    const now = Date.now()
    if (now - lastFire < DEBOUNCE_MS) return
    lastFire = now
    try {
      connection.reconnect?.()
      // Lightweight breadcrumb for CDP probes; harmless in production.
      const n = Number(document.documentElement.dataset.dshMobileResume ?? '0')
      document.documentElement.dataset.dshMobileResume = String(n + 1)
    } catch {
      // A racing connect can make reconnect throw; recovery must not.
    }
  }

  /** Coalesce visibility + pageshow into one check after paint. */
  const schedule = (): void => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      maybeReconnect()
    }, 80)
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') schedule()
  }

  document.addEventListener('visibilitychange', onVisibility)
  // bfcache restore: visibilitychange may not fire; pageshow always does.
  window.addEventListener('pageshow', schedule)

  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pageshow', schedule)
  }
}
