/**
 * Keyboard fit: keep the application frame inside the visual viewport.
 *
 * ## The problem
 *
 * On a phone the composer sits behind the on-screen keyboard and never moves.
 * The root cause is in the Android shell, not here: the manifest declares no
 * `android:windowSoftInputMode`, so the window does not resize for the IME and
 * the WebView's layout viewport never shrinks.
 *
 * That leaves the document unable to help itself either. Measured geometry:
 * `html` and `body` are exactly the viewport height with `overflow: visible`, so
 * there is nothing to scroll, and DSH's own scroll-into-view routine (which does
 * use `visualViewport`) has no scrollable ancestor to act on. The composer is in
 * normal flow, so its position is purely a function of how tall the shell is.
 *
 * ## The fix
 *
 * `visualViewport.height` DOES track the keyboard in Android WebView even when
 * the layout viewport does not. So the frame is sized from it whenever the two
 * viewports disagree by more than a keyboard's worth.
 *
 * Verified geometrically: forcing the frame to 500px on a 915px viewport moved
 * the composer card from bottom 915 to exactly 500, with the conversation scroll
 * area shrinking 839 -> 424 and restoring cleanly. See
 * `tools/probe-keyboard-geometry.mjs`.
 *
 * ## Why the comparison is against `window.innerHeight`
 *
 * The first version kept a high-water reference captured when the plugin
 * installed, and compared the live height against it. That latched on
 * permanently in testing because the reference was read before the viewport had
 * settled: every later event looked like an 85px keyboard that never closed.
 *
 * Comparing two live values removes the baseline entirely, and it makes the
 * webview's own resize mode irrelevant — which is the point:
 *
 *  - Window does NOT resize for the IME (this app's case): `innerHeight` stays
 *    at full height while `innerHeight - visualViewport.height` grows by the
 *    keyboard's height, so the override engages.
 *  - Window DOES resize (`adjustResize`, other hosts): `innerHeight` shrinks
 *    with the keyboard, the difference stays near zero, no override is applied,
 *    and the native behaviour already lifted the composer.
 *
 * A rotation needs no special case either: `innerHeight` and the visual viewport
 * change together, so the difference stays near zero.
 *
 * ## Honest scope
 *
 * This is a **mitigation**, not the correct fix. It depends on the WebView
 * reporting the keyboard through `visualViewport`; if a particular WebView does
 * not, this does nothing and the composer stays where it was — degraded, not
 * broken. The definitive fix is native (`android:windowSoftInputMode` or an IME
 * insets listener in `MainActivity`), which needs an APK rebuild.
 */
import { injectStyles } from './theme.ts'

const STYLE_ID = 'viewport-fit'

/**
 * Shortest difference treated as a keyboard.
 *
 * Well below any real on-screen keyboard (a phone IME is 200px+) and well above
 * the few pixels of rounding a rendering difference could produce. It is also
 * the release threshold, so it supplies its own hysteresis: the override appears
 * when the keyboard covers more than this and disappears when it covers less.
 */
const MIN_KEYBOARD_PX = 60

/** Custom property carrying the visible height, read by the stylesheet. */
const HEIGHT_VAR = '--dsh-mobile-vv-height'

/** Custom property carrying the visual viewport's offset within the page. */
const TOP_VAR = '--dsh-mobile-vv-top'

const CSS = `
@media (max-width: 768px) {
  /* Size the app shell to the visible band. Both properties are declared with
     fallbacks that reproduce the untouched layout (full height, no offset), so
     the rule is inert until the script sets the variables. The frame is already
     \`position: relative\`, so \`top\` is safe to state unconditionally. */
  [data-slot="root"] > [class*="_frame"] {
    height: var(${HEIGHT_VAR}, 100%) !important;
    top: var(${TOP_VAR}, 0px) !important;
  }
}
`

/**
 * Keep the app frame inside the visual viewport, so a keyboard cannot cover the
 * composer.
 *
 * Safe to call when `visualViewport` is absent: the stylesheet's fallbacks then
 * leave the layout exactly as it was.
 * @returns a disposer removing the listeners and the variables.
 */
export function installKeyboardFit(): () => void {
  injectStyles(STYLE_ID, CSS)

  if (typeof window === 'undefined') return () => {}
  const vv = window.visualViewport
  if (vv === undefined || vv === null) return () => {}

  const root = document.documentElement

  const release = (): void => {
    root.style.removeProperty(HEIGHT_VAR)
    root.style.removeProperty(TOP_VAR)
  }

  const sync = (): void => {
    // How much of the layout viewport the keyboard is covering. Both values are
    // read live; nothing is remembered between events.
    const covered = window.innerHeight - vv.height
    if (covered > MIN_KEYBOARD_PX) {
      root.style.setProperty(HEIGHT_VAR, `${Math.round(vv.height)}px`)
      root.style.setProperty(TOP_VAR, `${Math.round(vv.offsetTop)}px`)
    } else {
      release()
    }
  }

  // `scroll` as well as `resize`: panned viewports move the visible band
  // without changing its height.
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  // A host that resizes the window for the IME changes `innerHeight` without a
  // visual-viewport event in some engines, so the comparison is refreshed then
  // too. Cheap, and it keeps `covered` honest.
  window.addEventListener('resize', sync)

  return () => {
    vv.removeEventListener('resize', sync)
    vv.removeEventListener('scroll', sync)
    window.removeEventListener('resize', sync)
    release()
  }
}
