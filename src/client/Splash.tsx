/**
 * Boot / transition splash, registered into the frame-wide `shell.overlay`
 * slot.
 *
 * ## Why this slot
 *
 * `shell.overlay` is a `list`/`root` slot owned by ui-layout. Its declaration
 * calls it "the additive seat for a frame-wide surface of your own: a fresh
 * `id` is added beside the shipped entries instead of replacing them", and
 * notes the layer is click-through with entries opting back into pointer
 * events. A splash is exactly that, and because the slot is additive it cannot
 * displace anything DSH shipped.
 *
 * ## Honest scope
 *
 * This overlay renders once the DSH application frame is mounted, so it does
 * NOT cover the cold-start window — the browser's white frame and DSH's own
 * `_boot_` card do, and neither is reachable from a client plugin. The genuine
 * cold-start splash belongs to the host shell's native theme (Android
 * `windowSplashScreenBackground`), tracked separately in README.md.
 *
 * What this overlay IS for: the waits a client plugin can actually observe —
 * connecting to a machine, and local mode unpacking its runtime (~9s on first
 * start). It is also the branded transition when switching machines.
 *
 * ## Never trap the user
 *
 * Dismissal is bounded three ways: a minimum visible time so a fast path does
 * not flash, an explicit {@link dismissSplash} for a real readiness signal, and
 * a hard {@link SPLASH_TIMING.maxVisibleMs} cap. The last one means a missing
 * readiness signal degrades to a slightly long splash, never a stuck screen.
 *
 * After the fade the component returns `null` — it unmounts. Leaving it mounted
 * at `opacity: 0` would keep an invisible surface sitting over the application.
 */
import { useEffect, useState } from 'react'
import { SPLASH_TIMING, t } from './config.ts'
import { accentSoft, injectStyles, TOKEN, V } from './theme.ts'

const STYLE_ID = 'splash'

const CSS = `
.dsh-mobile-splash {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Two-stop veil built from the raised-surface and base tokens, so it matches
     DSH's own boot surface instead of introducing a second palette. */
  background: radial-gradient(ellipse 70% 50% at 50% 42%, ${V.surface} 0%, ${V.bg} 70%);
  color: ${V.text};
  /* The overlay layer is click-through; opt back in while visible so a tap
     cannot reach the application underneath. */
  pointer-events: auto;
  opacity: 1;
  transition: opacity var(${TOKEN.duration}, 200ms) var(${TOKEN.ease}, ease);
}

.dsh-mobile-splash[data-leaving='true'] {
  opacity: 0;
  pointer-events: none;
}

.dsh-mobile-splash__mark {
  width: 72px;
  height: 72px;
  margin-bottom: 26px;
  filter: drop-shadow(0 0 32px ${accentSoft(35)});
}

.dsh-mobile-splash__name {
  font-size: 19px;
  line-height: 28px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: ${V.text};
  margin-bottom: 10px;
}

.dsh-mobile-splash__tagline {
  font-size: 13px;
  line-height: 20px;
  color: ${V.textFaint};
}

.dsh-mobile-splash__status {
  position: absolute;
  /* Clears the Android gesture bar plus the home indicator inset. */
  bottom: calc(62px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
  color: ${V.textFaint};
  max-width: 78vw;
  text-align: left;
}

.dsh-mobile-splash__dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 50%;
  /* Paired with corner-shape so the circle keeps circular arcs on engines that
     apply DSH's global superellipse smoothing. */
  corner-shape: round;
  background: ${V.accent};
  animation: dsh-mobile-splash-pulse 1.6s ease-in-out infinite;
}

@keyframes dsh-mobile-splash-pulse {
  0%, 100% { opacity: 0.25; transform: scale(0.8); }
  50%      { opacity: 1;    transform: scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-splash { transition: none; }
  .dsh-mobile-splash__dot { animation: none; opacity: 0.8; }
}
`

/* ── module-level dismissal + status control ─────────────────────────────── */

let requestDismiss: (() => void) | undefined
let pushStatus: ((text: string) => void) | undefined

/**
 * Dismiss the splash immediately. Idempotent, and safe to call when no splash
 * is mounted. A real readiness signal (proxy ready, local runtime up) should
 * call this rather than waiting out the timer.
 */
export function dismissSplash(): void {
  requestDismiss?.()
}

/**
 * Replace the status line under the logo while the splash is visible.
 * @param text - status copy; ignored once the splash has gone.
 */
export function setSplashStatus(text: string): void {
  pushStatus?.(text)
}

/* ── component ───────────────────────────────────────────────────────────── */

/**
 * The splash overlay.
 * @returns the overlay, or `null` once it has faded and unmounted.
 */
export function Splash() {
  injectStyles(STYLE_ID, CSS)

  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  const [status, setStatus] = useState<string>(t.splashPreparing)

  useEffect(() => {
    let done = false
    let fadeTimer = 0

    const beginFade = (): void => {
      if (done) return
      done = true
      setLeaving(true)
      fadeTimer = window.setTimeout(() => { setGone(true) }, SPLASH_TIMING.fadeMs)
    }

    requestDismiss = beginFade
    pushStatus = (text: string) => { setStatus(text) }

    const minTimer = window.setTimeout(beginFade, SPLASH_TIMING.minVisibleMs)
    const maxTimer = window.setTimeout(beginFade, SPLASH_TIMING.maxVisibleMs)

    return () => {
      window.clearTimeout(minTimer)
      window.clearTimeout(maxTimer)
      window.clearTimeout(fadeTimer)
      requestDismiss = undefined
      pushStatus = undefined
    }
  }, [])

  if (gone) return null

  return (
    <div className="dsh-mobile-splash" data-leaving={leaving ? 'true' : 'false'} data-dsh-mobile-ui="splash">
      <svg
        className="dsh-mobile-splash__mark"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
        style={{ color: `var(${TOKEN.accent})` }}
      >
        <defs>
          <linearGradient id="dsh-mobile-ui-mark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <circle cx="19" cy="24" r="11.5" stroke="url(#dsh-mobile-ui-mark)" strokeWidth="2.4" />
        <circle cx="29" cy="24" r="11.5" stroke="url(#dsh-mobile-ui-mark)" strokeWidth="2.4" opacity="0.55" />
      </svg>

      <div className="dsh-mobile-splash__name">{t.splashName}</div>
      <div className="dsh-mobile-splash__tagline">{t.splashTagline}</div>

      <div className="dsh-mobile-splash__status" role="status" aria-live="polite">
        <span className="dsh-mobile-splash__dot" />
        <span>{status}</span>
      </div>
    </div>
  )
}
