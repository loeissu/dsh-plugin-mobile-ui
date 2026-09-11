/**
 * Mobile drawer, rendered as an overlay in `shell.overlay`.
 *
 * ## Why an overlay rather than the `sidebar` slot
 *
 * Taking over `sidebar` was attempted and abandoned. Two runtime constraints
 * made it unusable from a plugin alone:
 *
 *  1. A `single` cell admits one entry per priority, so the shipped ui-sidebar
 *     must be shadowed with a lower priority.
 *  2. One declarer per slot key. The drawer has to re-declare the six seats
 *     ui-sidebar owns, and ui-sidebar declares the same six while mounted.
 *
 * Both failures are global — the application renders "Failed to load plugins"
 * and nothing works — and (2) cannot be fixed by priority at all; it requires
 * disabling the shipped entry in the user's profile. See
 * `docs/drawer-takeover.md`.
 *
 * So the shipped sidebar stays mounted and is hidden with CSS (narrow screens
 * only), and this overlay supplies the replacement UI. The two are independent:
 * dropping the CSS restores the native 56px rail with no drawer and no
 * breakage.
 *
 * ## The two pointer-events decisions
 *
 * `shell.overlay` is a click-through layer, so every surface here has to opt
 * back in explicitly, and the two surfaces need opposite treatment:
 *
 *  - The scrim and panel set `pointer-events: auto` while open, so a tap lands
 *    on them instead of the application underneath.
 *  - The floating trigger sets `pointer-events: auto` permanently, because it
 *    is the only way in once the native rail is hidden.
 *  - The scrim and panel return to `pointer-events: none` while closed, so a
 *    closed drawer cannot swallow taps. This is the same trap the splash has:
 *    an overlay left mounted at `opacity: 0` still eats input.
 *
 * ## Why a floating trigger and not an edge swipe
 *
 * Android 10+ gesture navigation reserves the left-edge right-swipe for the
 * system Back gesture, and the WebView never receives it. That is a platform
 * interception, not something the page can claim. A button is the only
 * dependable affordance.
 *
 * ## Scope of this file
 *
 * Minimal skeleton: panel, scrim, close button, trigger. No workspace or
 * session list yet.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from './config.ts'
import { injectStyles, TOKEN, V } from './theme.ts'

const STYLE_ID = 'drawer'

/**
 * Only take over the layout on narrow screens.
 *
 * The Tether WebView is always phone-width, so this matches on every real
 * device. On a desktop browser it does not, which keeps DSH's own layout intact
 * there — useful precisely because it makes "is this the plugin or DSH?"
 * unambiguous while debugging.
 */
const NARROW = '(max-width: 768px)'

const CSS = `
/* ── native sidebar suppression (narrow screens only) ──────────────────────
   Hiding the sidebar column alone is NOT enough. Removing a grid item from
   flow does not free its track: the frame keeps its three-column template and
   automatic placement then collapses, dropping the conversation into the old
   280px sidebar track and leaving a visible gap. Measured, with screenshots,
   in docs/overlay-drawer-step1.md.

   So the template is restated and both surviving columns are pinned by number.
   They currently rely on auto-placement, which is exactly what breaks.

   Selectors are narrowed to the AppFrame: a bare [class*="_frame"] matches two
   elements (AppFrame plus one inside ui-chat). */
@media ${NARROW} {
  [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] {
    display: none !important;
  }
  [data-slot="root"] > [class*="_frame"] {
    grid-template-columns: minmax(0, 1fr) 0px !important;
  }
  [data-slot="root"] > [class*="_frame"] > [class*="centerCol"] {
    grid-column: 1 !important;
  }
  [data-slot="root"] > [class*="_frame"] > [class*="rightbarCol"] {
    grid-column: 2 !important;
  }
}

/* ── overlay layer: click-through by default, children opt back in ────────── */
@media ${NARROW} {
  .dsh-mobile-drawer-root {
    position: fixed;
    inset: 0;
    z-index: 2147482000;
    pointer-events: none;
  }

  /* The floating trigger sits above everything and owns its own hit area. */
  .dsh-mobile-drawer-trigger {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 8px);
    left: 8px;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 13px;
    corner-shape: round;
    background: ${V.surface};
    color: ${V.text};
    box-shadow: var(--dsw-elevation-panel, 0 2px 8px rgba(0, 0, 0, 0.14));
    pointer-events: auto;
    cursor: pointer;
  }
  .dsh-mobile-drawer-trigger:active { background: ${V.active}; }

  /* Scrim only exists while open, and returns to click-through when closed so
     a dismissed drawer cannot intercept taps. */
  .dsh-mobile-drawer-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(${TOKEN.duration}, 200ms) var(${TOKEN.ease}, ease);
  }
  .dsh-mobile-drawer-root[data-open='true'] .dsh-mobile-drawer-scrim {
    opacity: 1;
    pointer-events: auto;
  }

  .dsh-mobile-drawer-panel {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 80%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    background: ${V.surface};
    color: ${V.text};
    border-right: 0.5px solid ${V.border};
    border-radius: 0 30px 30px 0;
    box-shadow: 0 10px 36px rgba(0, 0, 0, 0.24);
    transform: translateX(-100%);
    pointer-events: none;
    transition: transform 220ms ${'cubic-bezier(.4,0,.2,1)'};
    padding-top: env(safe-area-inset-top, 0px);
  }
  .dsh-mobile-drawer-root[data-open='true'] .dsh-mobile-drawer-panel {
    transform: translateX(0);
    pointer-events: auto;
  }

  .dsh-mobile-drawer-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 14px;
    border-bottom: 0.5px solid ${V.border};
  }
  .dsh-mobile-drawer-title {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dsh-mobile-drawer-close {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 11px;
    corner-shape: round;
    background: transparent;
    color: ${V.textDim};
    cursor: pointer;
  }
  .dsh-mobile-drawer-close:active { background: ${V.active}; }

  .dsh-mobile-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
    font-size: 13px;
    color: ${V.textFaint};
  }

  @media (prefers-reduced-motion: reduce) {
    .dsh-mobile-drawer-scrim,
    .dsh-mobile-drawer-panel { transition: none; }
  }
}
`

/**
 * The drawer overlay: a floating trigger, a scrim, and a panel.
 * @returns the overlay, rendered on `document.body`.
 */
export function DrawerOverlay() {
  injectStyles(STYLE_ID, CSS)
  const [open, setOpen] = useState(false)

  // Escape closes. Not the primary affordance (a phone has no keyboard) but it
  // costs nothing and helps when the same build is driven from a desktop.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  const overlay = (
    <div className="dsh-mobile-drawer-root" data-open={open ? 'true' : 'false'} data-dsh-mobile-ui="drawer-overlay">
      <button
        type="button"
        className="dsh-mobile-drawer-trigger"
        aria-label={t.drawerOpen}
        aria-expanded={open}
        data-dsh-mobile-ui="drawer-trigger"
        onClick={() => { setOpen(true) }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M2.5 5h13M2.5 9h13M2.5 13h13" />
        </svg>
      </button>

      <div
        className="dsh-mobile-drawer-scrim"
        data-dsh-mobile-ui="drawer-scrim"
        onClick={() => { setOpen(false) }}
      />

      <div
        className="dsh-mobile-drawer-panel"
        data-dsh-mobile-ui="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t.drawerTitle}
      >
        <div className="dsh-mobile-drawer-head">
          <span className="dsh-mobile-drawer-title">{t.drawerTitle}</span>
          <button
            type="button"
            className="dsh-mobile-drawer-close"
            aria-label={t.drawerClose}
            data-dsh-mobile-ui="drawer-close"
            onClick={() => { setOpen(false) }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="dsh-mobile-drawer-body">
          {t.drawerPlaceholder}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}
