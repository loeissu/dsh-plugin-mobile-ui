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
 * ## Why it was intermittent ("sometimes the input rises, sometimes it does not")
 *
 * Chromium's keyboard does not have one layout mode. Without an explicit
 * `interactive-widget` on the viewport meta, the engine may:
 *
 *  - shrink only the visual viewport (`resizes-visual`): `innerHeight` stays
 *    full, `visualViewport.height` drops → a covered-gap check engages;
 *  - shrink the layout viewport too (`resizes-content`): both drop together →
 *    covered ≈ 0 → a gap-only check does NOTHING, and the composer stays under
 *    the keyboard because the page still uses a full-height shell (`100%` /
 *    `100vh`, not the dynamic viewport);
 *  - pan the focused field (`adjustPan` in some WebViews) without a reliable
 *    resize event at all.
 *
 * System bars under edge-to-edge add a second flapper: a persistent
 * `innerHeight - visualViewport.height` of ~50–90px sits on the 60px engage
 * threshold, so the override can appear and disappear with the nav mode.
 *
 * ## The fix
 *
 * 1. Pin the viewport meta to `interactive-widget=resizes-visual` so every
 *    Chromium build reports the keyboard the way this mitigation expects.
 * 2. Engage on a keyboard-sized gap, with hysteresis, and also on focus when
 *    the visual viewport is clearly shorter than the layout shell.
 * 3. Re-sync on `focusin` / `focusout`, and **keep polling briefly while an
 *    editable is focused** — the cold-page first focus often samples before
 *    the IME has shrunk `visualViewport`, and some WebViews emit no resize
 *    event until a later tap. That is the "first tap does nothing, tapping
 *    around then works" report.
 *
 * Verified geometrically: forcing the frame to 500px on a 915px viewport moved
 * the composer card from bottom 915 to exactly 500. See
 * `tools/probe-keyboard-geometry.mjs`.
 *
 * ## Honest scope
 *
 * This is a **mitigation**, not the correct fix. The definitive fix is native
 * (`android:windowSoftInputMode` or an IME insets listener in `MainActivity`),
 * which needs an APK rebuild.
 */
import { injectStyles, PHONE_MEDIA } from './theme.ts'

const STYLE_ID = 'viewport-fit'

/**
 * Gap treated as a keyboard when the override is off.
 *
 * High enough to ignore status/nav-bar leftovers under edge-to-edge (those
 * often land in the 50–90px band and caused false engages at 60), and still
 * well below a real phone IME (200px+).
 */
const ENGAGE_PX = 100

/**
 * Gap that keeps an already-engaged override alive.
 *
 * Deliberately lower than {@link ENGAGE_PX}. Same-threshold engage/release
 * flapped around the boundary; a band between them is the hysteresis.
 */
const RELEASE_PX = 40

/** Custom property carrying the visible height, read by the stylesheet. */
const HEIGHT_VAR = '--dsh-mobile-vv-height'

/** Custom property carrying the visual viewport's offset within the page. */
const TOP_VAR = '--dsh-mobile-vv-top'

const CSS = `
@media ${PHONE_MEDIA} {
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
 * Force Chromium to report the keyboard by shrinking the visual viewport only.
 *
 * Without this, Chrome/WebView pick a mode per version and window, which is
 * why the composer lift looked random. Harmless on engines that ignore the
 * token.
 */
function pinInteractiveWidget(): () => void {
  const meta = document.querySelector('meta[name="viewport"]')
  if (meta === null) return () => {}
  const raw = meta.getAttribute('content')
  if (raw === null) return () => {}
  if (/interactive-widget\s*=/.test(raw)) return () => {}
  meta.setAttribute('content', `${raw}, interactive-widget=resizes-visual`)
  // The host's own viewport declaration is restored on disposal: this module
  // rewrites an element it does not own, and leaving the rewrite behind after the
  // plugin is disabled or HMR-unloaded would keep changing IME behaviour for a
  // feature that is no longer installed.
  return () => { meta.setAttribute('content', raw) }
}

/**
 * Whether the focused control is something a soft keyboard would serve.
 * @returns true while an editable field has focus.
 */
function isEditingFocus(): boolean {
  const el = document.activeElement
  if (el === null || el === document.body) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT') return true
  return (el as HTMLElement).isContentEditable === true
}

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
  const restoreViewportMeta = pinInteractiveWidget()

  // Both bail-outs below must UNDO `pinInteractiveWidget()` before returning: this
  // module rewrites an element it does not own, and the meta tag it edits lives for
  // the rest of the page's life. Returning a no-op disposer with the rewrite still in
  // place left the host's viewport declaration permanently changed for a feature that
  // is not running — the opposite of what its own comment promises.
  if (typeof window === 'undefined') {
    restoreViewportMeta()
    return () => {}
  }
  const vv = window.visualViewport
  if (vv === undefined || vv === null) {
    restoreViewportMeta()
    return () => {}
  }

  const root = document.documentElement
  /** Highest layout height seen since the last orientation change. */
  let layoutRef = window.innerHeight
  let lastWidth = window.innerWidth
  let lastVvWidth = vv.width
  let engaged = false

  const release = (): void => {
    engaged = false
    root.style.removeProperty(HEIGHT_VAR)
    root.style.removeProperty(TOP_VAR)
  }

  const engage = (): void => {
    if (disposed) return
    engaged = true
    root.style.setProperty(HEIGHT_VAR, `${Math.round(vv.height)}px`)
    root.style.setProperty(TOP_VAR, `${Math.round(vv.offsetTop)}px`)
  }

  const sync = (): void => {
    if (disposed) return
    // Orientation change resizes one or both viewports in width. The old
    // high-water mark would then look like a keyboard that never closed.
    // Checking both catches hosts that resize the layout viewport and hosts
    // that only report the visual one.
    if (window.innerWidth !== lastWidth || vv.width !== lastVvWidth) {
      lastWidth = window.innerWidth
      lastVvWidth = vv.width
      layoutRef = window.innerHeight
      release()
    }
    if (window.innerHeight > layoutRef) layoutRef = window.innerHeight

    const covered = layoutRef - vv.height
    // Also treat "editable focused + visual viewport clearly shorter than the
    // layout shell" as a keyboard: that is the resizes-content / adjustPan
    // shape, where covered can be ~0 but the composer is still under the IME.
    const editingShort = isEditingFocus() && covered > RELEASE_PX && vv.height < layoutRef - RELEASE_PX

    if (covered > ENGAGE_PX || (engaged && covered > RELEASE_PX) || editingShort) {
      engage()
    } else {
      release()
    }
  }

  /** Two frames plus a short poll chain: first IME open often reports late. */
  let focusTimers: number[] = []
  let focusPoll: number | undefined
  /**
   * Every deferred callback that can still reach `sync()`, tracked together.
   *
   * `clearFocusWatch` used to clear only `focusTimers`/`focusPoll`, so the bare
   * `requestAnimationFrame`s and the `setTimeout(sync, 80|220)` calls below stayed
   * live past disposal. A post-dispose `sync()` can call `engage()` and write
   * `--dsh-mobile-vv-height`/`--dsh-mobile-vv-top` back onto the root, and the
   * stylesheet applies them with `!important` — so the frame would be pinned to a
   * stale keyboard height with no keyboard present. `disposed` closes that.
   */
  let deferredTimeouts: number[] = []
  let deferredFrames: number[] = []
  let disposed = false

  const later = (fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      deferredTimeouts = deferredTimeouts.filter((x) => x !== id)
      if (!disposed) fn()
    }, ms)
    deferredTimeouts.push(id)
  }

  const nextFrame = (fn: () => void): void => {
    const id = requestAnimationFrame(() => {
      deferredFrames = deferredFrames.filter((x) => x !== id)
      if (!disposed) fn()
    })
    deferredFrames.push(id)
  }

  const clearFocusWatch = (): void => {
    for (const id of focusTimers) window.clearTimeout(id)
    focusTimers = []
    if (focusPoll !== undefined) {
      window.clearInterval(focusPoll)
      focusPoll = undefined
    }
  }

  /**
   * Watch the keyboard after an editable gains focus.
   *
   * The first focus on a cold page is the flaky one: the IME animates in
   * hundreds of milliseconds after `focusin`, and some Android WebViews fire
   * no `visualViewport.resize` at all until a later interaction. A single
   * double-rAF sync therefore samples a still-full viewport, decides "no
   * keyboard", and never revisits — until the user taps elsewhere and a
   * second focus/resize finally lands. That is exactly "first tap does not
   * lift, tapping around then works".
   *
   * So after focus we sync on a decaying schedule and hold a light poll for
   * as long as an editable still has focus.
   */
  const watchFocus = (): void => {
    clearFocusWatch()
    nextFrame(() => { nextFrame(sync) })
    for (const ms of [40, 100, 180, 320, 500, 800]) {
      focusTimers.push(window.setTimeout(sync, ms))
    }
    // Keep sampling while the field stays focused: catches engines that
    // update visualViewport with no event, and the reverse when the IME
    // closes without a reliable resize.
    focusPoll = window.setInterval(() => {
      if (!isEditingFocus()) {
        clearFocusWatch()
        return
      }
      sync()
    }, 120)
    // Hard stop so a stuck editable cannot poll forever.
    focusTimers.push(window.setTimeout(clearFocusWatch, 2500))
  }

  const onFocusOut = (): void => {
    // One more pass after blur: the IME may close asynchronously and we must
    // not leave the frame pinned to a stale short height.
    nextFrame(sync)
    later(sync, 80)
    later(sync, 220)
  }

  /**
   * Cold pages often already have the composer focused (DSH autofocus) before
   * any user gesture. A later tap then fires no `focusin`, so the watch above
   * never arms. Capture-phase pointerdown catches that tap either way.
   *
   * Android WebView also has a sharper quirk: **a tap on an already-focused
   * field frequently does not raise the IME at all.** Programmatic autofocus
   * without a user gesture leaves the field focused but silent; the user must
   * blur (tap elsewhere) and focus again before the keyboard appears — which
   * is exactly "first entry does nothing, tapping around then works".
   *
   * When we see a tap on an already-focused editable while the visual viewport
   * is still full height, force one blur→focus cycle. Cooldown keeps a double
   * pointerdown/touchstart and an accidental re-tap mid-typing from thrashing.
   */
  let lastForceRefocus = 0

  const onPointerDown = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const editable = target.closest('textarea, input, [contenteditable="true"]')
    if (editable === null) return

    watchFocus()

    if (!(editable instanceof HTMLElement)) return
    if (document.activeElement !== editable) return
    // Keyboard already up: leave the field alone.
    if (layoutRef - vv.height > RELEASE_PX) return
    const now = Date.now()
    if (now - lastForceRefocus < 800) return
    lastForceRefocus = now

    const start = editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement
      ? editable.selectionStart
      : null
    const end = editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement
      ? editable.selectionEnd
      : null

    editable.blur()
    nextFrame(() => {
      editable.focus()
      if ((editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement)
        && start !== null && end !== null) {
        try { editable.setSelectionRange(start, end) } catch { /* non-text input */ }
      }
      watchFocus()
    })
  }

  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  window.addEventListener('resize', sync)
  document.addEventListener('focusin', watchFocus)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('touchstart', onPointerDown, true)

  // Always-on light sample. `sync` is a handful of numbers; a 200ms tick is
  // the only way to see an IME that changes visualViewport without events,
  // and it also covers an already-focused composer on first entry.
  const ambientPoll = window.setInterval(() => {
    if (document.visibilityState === 'hidden') return
    sync()
  }, 200)

  // Install-time pass: URL-bar collapse and late layout can leave the first
  // reading stale if we wait for the next event.
  sync()
  if (isEditingFocus()) watchFocus()

  return () => {
    // First: nothing deferred may run past this point (see the pools above).
    // Timeout and frame ids come from different counters, so they are cancelled
    // through their own pool — calling cancelAnimationFrame on a timer id (or the
    // reverse) can cancel a callback that belongs to the host.
    disposed = true
    for (const id of deferredTimeouts) window.clearTimeout(id)
    for (const id of deferredFrames) cancelAnimationFrame(id)
    deferredTimeouts = []
    deferredFrames = []
    clearFocusWatch()
    window.clearInterval(ambientPoll)
    vv.removeEventListener('resize', sync)
    vv.removeEventListener('scroll', sync)
    window.removeEventListener('resize', sync)
    document.removeEventListener('focusin', watchFocus)
    document.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('touchstart', onPointerDown, true)
    release()
    restoreViewportMeta()
  }
}
