/**
 * On-screen keyboard diagnostic.
 *
 * ## Why this exists
 *
 * `viewport.ts` assumes Android WebView reports the on-screen keyboard through
 * `visualViewport.height`. That assumption CANNOT be checked from a desktop
 * browser: the only way to test the logic there is to mock `visualViewport`, and
 * a mock proves the logic self-consistent, not that the assumption holds. The fix
 * verifying green against a mock that implements the assumption is circular.
 *
 * On the device the composer still does not rise, which points at the assumption
 * rather than the logic. So this badge reports the raw facts instead:
 *
 *   - the live `innerHeight` and `visualViewport.height`, and how far the visual
 *     viewport has ever shrunk since load (the "min" figure);
 *   - whether ANY event fired — visual viewport resize/scroll, window resize,
 *     focus — because a WebView that reports nothing about the keyboard would
 *     show all counters at zero after the keyboard opens;
 *   - what the keyboard-fit script decided (`engaged`, and the variable it wrote).
 *
 * One screenshot with the keyboard open then answers the question definitively:
 * if `min` never drops and the counters stay at zero, the WebView is silent and
 * only a native fix can work. If `vV` does drop, the assumption holds and the
 * bug is in the logic instead.
 *
 * ## Temporary
 *
 * Diagnostic only, behind `FEATURES.keyboardDebug`. Remove once the device
 * behaviour is known.
 */
import { injectStyles, R, Z } from './theme.ts'

const STYLE_ID = 'keyboard-debug'
const BADGE_ID = 'dsh-mobile-kbd-debug'

const CSS = `
#${BADGE_ID} {
  /* Bottom-right, not top-left. The drawer trigger lives at the top-left
     corner; a badge over it swallows the only way into navigation on narrow
     screens and looks like a dead hamburger. Same reason the z-index sits
     below the drawer overlay (2147482000). */
  position: fixed;
  right: 6px;
  bottom: calc(6px + env(safe-area-inset-bottom, 0px));
  left: auto;
  top: auto;
  z-index: ${Z.debug};
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 6px 8px;
  border-radius: ${R.sm};
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  white-space: pre;
  pointer-events: auto;
  max-width: 96vw;
}
`

/**
 * Install the badge.
 * @returns a disposer removing the badge, its listeners and its interval.
 */
export function installKeyboardDebug(): () => void {
  injectStyles(STYLE_ID, CSS)

  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const el = document.createElement('div')
  el.id = BADGE_ID
  el.setAttribute('data-dsh-mobile-ui', 'keyboard-debug')
  // Tap to hide, so it never becomes an obstacle on a small screen.
  el.addEventListener('click', () => { el.remove() })
  document.body.append(el)

  const counts = { vvResize: 0, vvScroll: 0, winResize: 0, focus: 0 }
  // The smallest visual viewport height ever observed is the load-bearing number:
  // it records a keyboard that opened even if it has closed again by the time the
  // screenshot is taken.
  let minVV = window.visualViewport ? window.visualViewport.height : window.innerHeight
  let engagedEver = false

  const render = (): void => {
    const vv = window.visualViewport
    const vvH = vv ? Math.round(vv.height) : null
    if (vvH !== null && vvH < minVV) minVV = vvH
    const root = document.documentElement
    const varH = root.style.getPropertyValue('--dsh-mobile-vv-height')
    const engaged = varH !== ''
    if (engaged) engagedEver = true
    const gap = vvH === null ? null : Math.round(window.innerHeight - vvH)
    el.textContent = [
      `iH ${window.innerHeight}  vV ${vvH ?? 'n/a'}  min ${Math.round(minVV)}`,
      `gap ${gap ?? 'n/a'}  var ${varH === '' ? '-' : varH}  eng ${engaged ? 'YES' : 'no'}`,
      `ev v${counts.vvResize}/${counts.vvScroll} w${counts.winResize} f${counts.focus}`,
      `kbd ever ${engagedEver ? 'YES' : 'no'}   (tap to hide)`,
    ].join('\n')
  }

  const vv = window.visualViewport
  const onVVResize = (): void => { counts.vvResize += 1; render() }
  const onVVScroll = (): void => { counts.vvScroll += 1; render() }
  const onWinResize = (): void => { counts.winResize += 1; render() }
  const onFocus = (): void => { counts.focus += 1; render() }

  vv?.addEventListener('resize', onVVResize)
  vv?.addEventListener('scroll', onVVScroll)
  window.addEventListener('resize', onWinResize)
  window.addEventListener('focusin', onFocus)
  window.addEventListener('focusout', onFocus)

  // A poll as well: if some signal fires that is not hooked above, the numbers
  // still update. Cheap, and this is short-lived diagnostic code.
  const timer = window.setInterval(render, 700)
  render()

  return () => {
    window.clearInterval(timer)
    vv?.removeEventListener('resize', onVVResize)
    vv?.removeEventListener('scroll', onVVScroll)
    window.removeEventListener('resize', onWinResize)
    window.removeEventListener('focusin', onFocus)
    window.removeEventListener('focusout', onFocus)
    el.remove()
  }
}
