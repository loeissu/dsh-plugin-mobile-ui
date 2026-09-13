/**
 * Make the host's copy actions work in an Android WebView.
 *
 * ## The defect this closes
 *
 * DSH's copy helper (in `dsh-web-frontend`) is, in its own words:
 *
 * ```js
 * if (navigator.clipboard?.writeText) {
 *   try { await navigator.clipboard.writeText(t); return true } catch { return false }
 * }
 * // ...legacy textarea + execCommand('copy') fallback, reachable ONLY if the
 * //    async API is absent
 * ```
 *
 * So when the async clipboard API EXISTS but REJECTS — the normal case in an Android
 * WebView, where `writeText` needs a permission the embedding app may never grant —
 * the helper returns `false` without ever trying its own fallback. The caller then
 * returns silently (`const ok = await copy(text); if (!ok) return`), so on a phone the
 * 复制 button does nothing at all and shows no feedback.
 *
 * Measured in a touch-emulated page: a real tap does reach the control
 * (`landedOn: 复制`), `writeText` is called exactly once, and with a rejecting stub the
 * legacy path is called ZERO times. That is the whole bug: the fallback is unreachable.
 *
 * ## What this module does
 *
 * Wraps `navigator.clipboard.writeText` so that a rejection falls back to the very same
 * legacy path the host already ships. Nothing else changes:
 *
 *  - the real API is always tried first, so a healthy environment behaves identically;
 *  - the text is passed through untouched (the host still decides WHAT is copied);
 *  - the promise still rejects if both paths fail, so the host's failure handling and
 *    its success feedback keep their meaning;
 *  - only phones are affected (`PHONE_MEDIA`), because on a desktop a rejection is a
 *    real error worth surfacing rather than papering over with a legacy path.
 */
import { PHONE_MEDIA } from './theme.ts'

/**
 * The legacy copy path: a selected, off-screen textarea plus `execCommand('copy')`.
 *
 * Deliberately the same shape as the host's fallback — `readonly` so mobile keyboards
 * never appear, positioned off-screen so nothing flashes, removed afterwards. The
 * caller's own selection is restored, because clearing the user's selection would be a
 * visible side effect of a recovery they never asked for.
 * @param text - text to put on the clipboard.
 * @returns whether the engine reported a successful copy.
 */
function legacyCopy(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null
  const saved = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  area.style.top = '0'
  document.body.append(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    if (saved !== null && selection !== null) {
      try {
        selection.removeAllRanges()
        selection.addRange(saved)
      } catch {
        // A range that no longer exists is not worth throwing over.
      }
    }
  }
}

/**
 * Install the fallback. Idempotent per page; disposed with the plugin.
 * @returns disposer restoring the original method.
 */
export function installClipboardFallback(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return () => {}
  const clip = navigator.clipboard
  if (clip === undefined || typeof clip.writeText !== 'function') {
    // Without the async API the host already takes its legacy path by itself.
    return () => {}
  }
  const original = clip.writeText.bind(clip)

  const patched = (text: string): Promise<void> =>
    original(text).catch((error: unknown) => {
      if (!window.matchMedia(PHONE_MEDIA).matches) throw error
      if (legacyCopy(text)) return
      throw error
    })

  try {
    clip.writeText = patched
  } catch {
    // Some engines expose the method as a non-writable accessor; then there is
    // nothing to wrap and the host's behaviour is left exactly as it was.
    return () => {}
  }

  return () => {
    try {
      clip.writeText = original
    } catch {
      // Restoring is best-effort; the plugin is going away either way.
    }
  }
}
