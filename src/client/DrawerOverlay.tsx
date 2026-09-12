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
 * and nothing works — and (2) cannot be fixed by priority at all. See
 * `docs/drawer-takeover.md`.
 *
 * So the shipped sidebar stays mounted and is hidden with CSS on narrow screens
 * only, and this overlay supplies the replacement UI. The two are independent:
 * dropping the CSS restores the native 56px rail with no drawer and no breakage.
 *
 * ## Data
 *
 * `useSessions` and `useWorkspaces` both arrive as global standard props (they
 * are declared on `GlobalStandardProps`, which applies in every scope including
 * this slot's `root`). Verified against a live renderer rather than inferred —
 * see `docs/drawer-list-fields.md`.
 *
 * Grouping is a direct association: `WorkspaceView.sessionIds` lists the
 * sessions accounted to a workspace, so there is no need to match a session's
 * `cwd` against a workspace `path`.
 *
 * ## What the top section is, and is not
 *
 * It lists **workspaces on the connected machine**, not the machines
 * themselves. Switching machines is dsh-tether's concern — a different plugin's
 * state, which a plugin cannot read — so it is out of reach here.
 *
 * ## Pointer events
 *
 * `shell.overlay` is click-through, so every surface opts back in explicitly,
 * and the surfaces need opposite treatment:
 *
 *  - The scrim and panel set `pointer-events: auto` only while open.
 *  - The floating trigger sets it permanently, because it is the only way in
 *    once the native rail is hidden.
 *
 * A closed overlay left at `pointer-events: auto` swallows every tap on the
 * page and looks exactly like a frozen app — the same trap the splash has.
 *
 * ## Why a floating trigger and not an edge swipe
 *
 * Android 10+ gesture navigation reserves the left-edge right-swipe for the
 * system Back gesture and the WebView never receives it. That is platform
 * interception, not something a page can claim.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { t } from './config.ts'
import { injectStyles, MOTION, R, TOKEN, TYPE, V } from './theme.ts'

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

/**
 * Shortest overhang worth animating.
 *
 * Deliberately small. An earlier value of 12 silently skipped the very title this
 * was built for: it overflowed by exactly 12px, i.e. its last character was cut,
 * and the threshold rejected it. Only sub-pixel noise should be ignored, since the
 * ellipsis already replaces one character and any real overhang hides more.
 */
const MARQUEE_MIN_PX = 4

const CSS = `
/* ── the drawer exists only on narrow screens ──────────────────────────────
   HIDDEN BY DEFAULT, enabled by the media query below — not the other way round.

   The component registers into shell.overlay unconditionally, so its DOM is
   always present. While every styling rule sat inside the media query, a wide
   viewport got the markup with none of the CSS: the root fell back to
   \`display: block; position: static\` and the whole workspace/session list
   rendered as unstyled text in the document flow. Measured at 1440px: root
   1432x249 at top=900, painted, carrying 245 characters of visible text.

   It also left \`pointer-events: auto\` on the panel, because that rule lived in
   the media query too — so the invisible-but-present layer could intercept
   clicks.

   \`display: none\` removes the subtree from rendering AND from hit-testing, so
   one rule answers both. A wide screen keeps the native sidebar and never sees
   this component at all. */
.dsh-mobile-drawer-root { display: none; }

/* ── native sidebar suppression (narrow screens only) ──────────────────────
   Hiding the sidebar column alone is NOT enough. Removing a grid item from
   flow does not free its track: the frame keeps its three-column template and
   automatic placement then collapses, dropping the conversation into the old
   280px sidebar track and leaving a visible gap. Measured, with screenshots,
   in docs/overlay-drawer-step1.md.

   So the template is restated and both surviving columns are pinned by number.
   They currently rely on auto-placement, which is exactly what breaks.

   Selectors are narrowed to the AppFrame: a bare [class*="_frame"] matches two
   elements (AppFrame plus one inside ui-chat).

   The column is PARKED off-viewport, not display:none. ui-settings renders
   its modal inside the sidebar.settings seat (no body portal). A display:none
   ancestor unpaints that modal entirely, so Settings opened from the hidden
   rail was a no-op — confirmed: dialog present, 0×0, inside sidebarCol.
   Parking keeps the subtree painted; position:fixed children still resolve
   against the viewport and appear on screen. pointer-events:none keeps the
   parked rail from eating taps; the dialog overlay opts back in. */
@media ${NARROW} {
  [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] {
    display: block !important;
    position: fixed !important;
    left: -10000px !important;
    top: 0 !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    pointer-events: none !important;
  }
  [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] [role="dialog"],
  [data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"] [class*="_overlay"] {
    pointer-events: auto !important;
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

@media ${NARROW} {
  .dsh-mobile-drawer-root {
    /* Re-enable the subtree the base rule hid. */
    display: block;
    position: fixed;
    /* Sized to the VISIBLE band, not the layout viewport.
       \`inset: 0\` resolves against the layout viewport, which this shell does not
       shrink for the keyboard. With the keyboard open and the frame shrunk to
       the visual viewport, an inset-based root would stay at full height and the
       panel's lower rows would sit behind the keyboard, unreachable.
       The variables are set by the keyboard-fit script and fall back to the
       untouched full-viewport layout when it is inactive. */
    top: var(--dsh-mobile-vv-top, 0px);
    left: 0;
    right: 0;
    height: var(--dsh-mobile-vv-height, 100%);
    z-index: 2147482000;
    pointer-events: none;
    font-size: ${TYPE.body};
    color: ${V.text};
  }

  /* Primary open control: a text tab matching 对话 / 轨迹, sitting left of
     that tablist. The host tablist is padded so the three read as one row. */
  .dsh-mobile-nav-tab {
    position: absolute;
    /* Aligns with the host tablist (measured top≈50px at phone width). */
    top: 50px;
    left: 20px;
    display: block;
    height: 25px;
    padding: 0 0 9px;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: ${TYPE.bodySm};
    font-weight: 500;
    line-height: 16px;
    color: ${V.textDim};
    cursor: pointer;
    pointer-events: auto;
    z-index: 2;
    transition: color ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
  }
  .dsh-mobile-nav-tab:active { color: ${V.accent}; }
  /* Touch target. The label paints ~25px tall, which is the only route into the
     drawer on a phone, so the pseudo-element grows the HIT AREA to 44px without
     moving the text or changing the tablist layout. Measured room: the host's
     first tab starts 30px to the right of this label, and the header band is
     ~90px tall, so -9px vertically and -10px horizontally stay clear. */
  .dsh-mobile-nav-tab::after {
    content: '';
    position: absolute;
    inset: -9px -10px;
  }
  .dsh-mobile-drawer-root[data-open='true'] .dsh-mobile-nav-tab {
    opacity: 0;
    pointer-events: none;
  }

  /* Make room in the host tablist so 导航 sits before 对话.
   *
   * The reserve is MEASURED at runtime (see the effect in the component) because
   * the label is text: '导航' is 26px at this font while 'Navigation' is 65px. A
   * hardcoded 56px fits only the Chinese copy and overlaps the host's first tab
   * in English. 56px stays as the fallback for the first paint and for the case
   * where the tablist is not in the DOM. */
  @media ${NARROW} {
    [class*="_tabs"][role="tablist"] {
      padding-left: var(--dsh-mobile-nav-reserve, 56px) !important;
    }
  }

  /* Full-viewport scrim (overlay mode). Paired with the panel: same duration,
     same curve, so the two halves of the open/close animation finish together. */
  .dsh-mobile-drawer-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    pointer-events: none;
    transition: opacity ${MOTION.sheet} var(${TOKEN.ease}, ${MOTION.ease});
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
    width: min(72%, 300px);
    display: flex;
    flex-direction: column;
    /* border-radius does not clip descendants, and the footer is an opaque
       full-width flex child: without this the square footer corner paints over
       the panel's 30px bottom end-cap and the corner reads as a notch. */
    overflow: hidden;
    background: ${V.surface};
    color: ${V.text};
    border-right: 0.5px solid ${V.border};
    border-radius: 0 ${R.panel} ${R.panel} 0;
    box-shadow: 0 10px 36px rgba(0, 0, 0, 0.24);
    transform: translateX(-100%);
    pointer-events: none;
    transition: transform ${MOTION.sheet} ${MOTION.ease};
    padding-top: env(safe-area-inset-top, 0px);
  }
  .dsh-mobile-drawer-root[data-open='true'] .dsh-mobile-drawer-panel {
    transform: translateX(0);
    pointer-events: auto;
  }
  /* Follow the finger 1:1 while swiping; the close/open transitions would
     smear the drag into a lag. */
  .dsh-mobile-drawer-panel[data-dragging='true'] {
    transition: none !important;
  }

  .dsh-mobile-drawer-head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 14px;
  }
  .dsh-mobile-drawer-title {
    flex: 1;
    min-width: 0;
    font-size: ${TYPE.bodyLg};
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
    border-radius: ${R.sm};
    corner-shape: round;
    background: transparent;
    color: ${V.textDim};
    cursor: pointer;
    transition: background ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
  }
  .dsh-mobile-drawer-close:active { background: ${V.active}; }

  .dsh-mobile-drawer-new {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: ${R.sm};
    corner-shape: round;
    background: transparent;
    color: ${V.accent};
    cursor: pointer;
    transition: background ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
  }
  .dsh-mobile-drawer-new:active { background: ${V.active}; }

  .dsh-mobile-drawer-foot {
    flex: none;
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
    border-top: 0.5px solid ${V.border};
    background: ${V.surface};
  }
  .dsh-mobile-drawer-settings {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 8px 10px;
    border: 0;
    border-radius: ${R.md};
    background: transparent;
    color: ${V.textDim};
    font: inherit;
    font-size: ${TYPE.body};
    text-align: left;
    cursor: pointer;
    transition: background ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
  }
  .dsh-mobile-drawer-settings:active { background: ${V.active}; }

  .dsh-mobile-drawer-refresh {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 44px;
    min-height: 44px;
    padding: 8px 12px;
    margin-left: 4px;
    border: 0;
    border-radius: ${R.md};
    background: transparent;
    color: ${V.textDim};
    font: inherit;
    font-size: ${TYPE.bodySm};
    cursor: pointer;
    transition: background ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease}),
                color ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
  }
  .dsh-mobile-drawer-refresh:active { background: ${V.active}; }
  .dsh-mobile-drawer-refresh[data-busy='true'] {
    color: ${V.accent};
    pointer-events: none;
  }
  .dsh-mobile-drawer-refresh[data-busy='true'] .dsh-mobile-drawer-refresh__ico {
    animation: dsh-mobile-spin 0.9s linear infinite;
  }
  @keyframes dsh-mobile-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .dsh-mobile-drawer-refresh[data-busy='true'] .dsh-mobile-drawer-refresh__ico {
      animation: none;
    }
  }

  .dsh-mobile-conn-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: ${R.pill};
    corner-shape: round;
    background: ${V.textFaint};
  }
  .dsh-mobile-conn-dot[data-state='connected'] { background: ${V.accent}; }
  .dsh-mobile-conn-dot[data-state='connecting'] {
    background: ${V.accent};
    opacity: 0.55;
    animation: dsh-mobile-conn-pulse 1.2s ease-in-out infinite;
  }
  .dsh-mobile-conn-dot[data-state='disconnected'] { background: ${V.textFaint}; }
  @keyframes dsh-mobile-conn-pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dsh-mobile-conn-dot[data-state='connecting'] { animation: none; opacity: 0.7; }
  }

  .dsh-mobile-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* Momentum scrolling and contained overscroll: without the latter, scrolling
       to the end of the list chains to the conversation behind the drawer. */
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 0 0 20px;
  }

  /* Section labels pin to the top while their rows scroll under them, so the
     reader always knows which group the visible rows belong to. Opaque
     background is required: a sticky label scrolls OVER the rows.

     pointer-events: none is load-bearing, not cosmetic. Without it the label is
     the topmost element over the scroll area and swallows touch drags.
     Measured with the label hit-testable: a synthesized touch drag inside the
     body left scrollTop at 0 across 212px of overflow, while programmatic
     scrolling still reached 212. That is precisely the "it does not scroll"
     report — the container scrolled, the finger could not reach it. */
  .dsh-mobile-drawer-label {
    position: sticky;
    top: 0;
    z-index: 1;
    pointer-events: none;
    background: ${V.surface};
    font-size: ${TYPE.micro};
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 600;
    color: ${V.textFaint};
    padding: 14px 16px 6px;
  }

  .dsh-mobile-drawer-sep {
    height: 0.5px;
    background: ${V.border};
    margin: 10px 16px;
  }

  /* Bottom fade marking that the list continues.
   *
   * Positioned against the footer's TOP edge (bottom: 100%) rather than the
   * panel's bottom edge. Measured: pinned to the panel it sat at y881..915 while
   * the opaque footer covers y846..915 at z-index 2, so the gradient was painted
   * entirely underneath the footer and the affordance never appeared. The footer
   * is position:relative, so this is its containing block. */
  .dsh-mobile-drawer-more {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 34px;
    pointer-events: none;
    background: linear-gradient(to bottom, transparent, ${V.surface});
  }

  /* Workspace rows: the whole row is the target. */
  .dsh-mobile-ws {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 8px 16px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    /* Skip layout/paint for off-screen rows. Chromium/Android WebView support
       this; contain-intrinsic-size keeps the scrollbar honest without JS
       virtualization (and without breaking sticky labels). */
    content-visibility: auto;
    contain-intrinsic-size: auto 52px;
  }
  .dsh-mobile-ws:active { background: ${V.active}; }
  .dsh-mobile-ws[data-active='true'] { background: ${V.hover}; }
  .dsh-mobile-ws-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: ${R.pill};
    corner-shape: round;
    background: transparent;
    border: 1.5px solid ${V.textFaint};
  }
  .dsh-mobile-ws[data-active='true'] .dsh-mobile-ws-dot {
    background: ${V.accent};
    border-color: ${V.accent};
  }
  .dsh-mobile-ws-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .dsh-mobile-ws-name {
    font-size: ${TYPE.body};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dsh-mobile-ws-path {
    font-size: ${TYPE.micro};
    color: ${V.textFaint};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dsh-mobile-ws-count {
    flex: none;
    font-size: ${TYPE.micro};
    color: ${V.textFaint};
    font-variant-numeric: tabular-nums;
  }

  /* Session rows: active gets an accent rail, matching the native sidebar's
     selected treatment. */
  .dsh-mobile-sess {
    position: relative;
    display: block;
    width: 100%;
    min-height: 44px;
    padding: 9px 16px 9px 20px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    content-visibility: auto;
    contain-intrinsic-size: auto 56px;
  }
  .dsh-mobile-sess:active { background: ${V.active}; }
  .dsh-mobile-sess[data-active='true'] { background: ${V.hover}; }
  .dsh-mobile-sess[data-active='true']::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 18px;
    border-radius: 0 3px 3px 0;
    background: ${V.accent};
  }
  /* Session titles.
   *
   * display: block on the title is required, not stylistic. It was a bare span
   * inside the row button, so it stayed inline — and overflow plus
   * text-overflow: ellipsis DO NOT APPLY to an inline box. The result was a
   * title cut dead at the panel edge with no ellipsis, and 39px of horizontal
   * overflow in the list. Measured: display=inline, clientWidth=0, scrollWidth=0
   * while the box itself rendered 257px wide.
   *
   * The workspace rows never had the bug because their parent is display: flex,
   * and a flex item is blockified. */
  .dsh-mobile-sess-title {
    display: block;
    font-size: ${TYPE.body};
    line-height: 1.45;
    overflow: hidden;
    white-space: nowrap;
    color: ${V.textDim};
  }
  /* Ellipsis lives on the inner span, so the same element can switch to a
     translating marquee without the two mechanisms fighting. */
  .dsh-mobile-sess-title > span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dsh-mobile-sess[data-active='true'] .dsh-mobile-sess-title { color: ${V.text}; font-weight: 500; }

  /* Marquee for the current session only.
   *
   * Read-only titles are the common case and there is exactly one current
   * session, so animating only that one keeps a screenful of rows still. The
   * distance and duration are measured and set per title, so speed stays even
   * for titles of different lengths, and alternate returns the text instead of
   * snapping back. */
  .dsh-mobile-sess-title[data-scroll='true'] > span {
    display: inline-block;
    overflow: visible;
    text-overflow: clip;
    animation: dsh-mobile-marquee var(--dsh-mobile-marquee-duration, 8s) ease-in-out infinite alternate;
  }
  @keyframes dsh-mobile-marquee {
    0%, 12%   { transform: translateX(0); }
    88%, 100% { transform: translateX(calc(-1 * var(--dsh-mobile-marquee-distance, 0px))); }
  }
  @media (prefers-reduced-motion: reduce) {
    .dsh-mobile-sess-title[data-scroll='true'] > span { animation: none; }
  }
  .dsh-mobile-sess-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: ${TYPE.caption};
    /* textDim, not textFaint: 3.71:1 on the light surface fails AA at 12px. */
    color: ${V.textDim};
    margin-top: 3px;
    /* Ages tick; tabular digits keep the row from wiggling. */
    font-variant-numeric: tabular-nums;
  }
  .dsh-mobile-sess-state {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: ${R.pill};
    corner-shape: round;
  }
  .dsh-mobile-sess-state[data-state='running'] { background: ${V.accent}; }
  .dsh-mobile-sess-state[data-state='done'] { background: ${V.accent}; opacity: 0.55; }

  .dsh-mobile-drawer-empty {
    padding: 18px 16px;
    font-size: ${TYPE.caption};
    line-height: 1.7;
    color: ${V.textDim};
  }

  @media (prefers-reduced-motion: reduce) {
    .dsh-mobile-drawer-scrim,
    .dsh-mobile-drawer-panel { transition: none; }
  }
}
`

/* ── data shapes ─────────────────────────────────────────────────────────────
   Structural copies of the published types, narrowed to the fields this list
   reads. Declared locally so the plugin does not take a build dependency on
   three more DSH packages, which would couple it to a DSH minor version. Field
   provenance: docs/drawer-list-fields.md. */

/** One session row, from `useSessions` → `byId`. */
interface SessionSummary {
  readonly id: string
  /** Durable title; absent until the host projects one. Do not render this. */
  readonly title?: string
  /** Always present: durable title, else project basename, else session id. */
  readonly displayTitle: string
  readonly cwd?: string
  readonly origin?: 'subagent'
  readonly running: boolean
  readonly completed?: boolean
  /** Empty-log placeholder; filtered out of the list. */
  readonly blank: boolean
  readonly updatedAt: number
}

/** One workspace row, from `useWorkspaces` → `items`. */
interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  /** Sessions accounted to this workspace, in manual order. */
  readonly sessionIds: readonly string[]
}

/** Props injected by the plugin's `apply`, plus the framework standard props. */
export interface DrawerOverlayProps {
  /** Session list and current selection. */
  readonly useSessions: <S>(selector: (state: {
    readonly ids: readonly string[]
    readonly byId: Readonly<Record<string, SessionSummary>>
    readonly current: string | undefined
    readonly phase: 'pending' | 'ready'
  }) => S) => S
  /** Workspace list and archive set. */
  readonly useWorkspaces: <S>(selector: (state: {
    readonly items: readonly WorkspaceView[]
    readonly archivedSessionIds: readonly string[]
    readonly state: 'idle' | 'loading' | 'error'
    readonly phase: 'pending' | 'ready'
  }) => S) => S
  /** Select a session and show its conversation. */
  readonly openSession: (sessionId: string) => void
  /** Connect a workspace and open its session. */
  readonly openWorkspace: (workspaceId: string) => void
  /** Start a New Session in the current / most recent workspace. */
  readonly startSession?: () => void
  /**
   * Force an immediate Host reconnect. Surfaces after the app is backgrounded
   * and the wire goes stale without a clean offline event.
   */
  readonly reconnect?: () => void
  /** Subscribe to Host connection-state changes; returns unsubscribe. */
  readonly subscribeConnection?: (cb: () => void) => () => void
  /** Current Host wire state: connected | connecting | disconnected. */
  readonly getConnectionState?: () => string | undefined
}

/** A time bucket for the secondary grouping. */
type Bucket = 'justNow' | 'today' | 'yesterday' | 'earlier'

/** Bucket boundaries in milliseconds. */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Classify a session's last activity.
 *
 * Uses calendar-day boundaries rather than fixed 24h windows, so "yesterday"
 * means the previous calendar day — which is what a reader expects from the
 * label.
 * @param updatedAt - epoch milliseconds.
 * @param now - current epoch milliseconds.
 * @returns the bucket.
 */
function bucketFor(updatedAt: number, now: number): Bucket {
  const age = now - updatedAt
  if (age < HOUR) return 'justNow'
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (updatedAt >= startOfToday) return 'today'
  if (updatedAt >= startOfToday - DAY) return 'yesterday'
  return 'earlier'
}

/** Relative age label for a session row. */
function ageLabel(updatedAt: number, now: number): string {
  const age = now - updatedAt
  if (age < MINUTE) return t.ageJustNow
  if (age < HOUR) return `${Math.floor(age / MINUTE)}${t.ageMinutes}`
  if (age < DAY) return `${Math.floor(age / HOUR)}${t.ageHours}`
  return `${Math.floor(age / DAY)}${t.ageDays}`
}

/**
 * Redact GitHub PAT-shaped tokens in a display title.
 *
 * Session titles are user data, and a title that is a token leaks it into
 * every screenshot of the drawer. Display-only: the underlying title is
 * untouched, so rename/open still work. Pattern matches classic `ghp_`/`gho_`
 * tokens and the newer `github_pat_` fine-grained form.
 */
function redactSecrets(title: string): string {
  return title
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, (m) => `${m.slice(0, 7)}…${m.slice(-4)}`)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, (m) => `${m.slice(0, 12)}…${m.slice(-4)}`)
}

/**
 * Open DSH's settings by activating the shipped sidebar trigger.
 *
 * ui-settings renders its modal inside the `sidebar.settings` seat — no body
 * portal — so the only public entry is that row's button. The rail is parked
 * off-viewport (still painted), which is what lets the modal show once opened.
 */
function openHostSettings(): boolean {
  const seat = document.querySelector('[data-slot="sidebar.settings"]')
  const btn = (seat?.querySelector('button') ?? null)
    ?? document.querySelector('[data-slot="settings.trigger"] button')
    ?? [...document.querySelectorAll('button')].find((b) => {
      const label = b.getAttribute('aria-label') ?? ''
      return label === '设置' || label === 'Settings'
    })
  if (btn === null) return false
  btn.click()
  return true
}

/**
 * The drawer overlay: a floating trigger, a scrim, and a panel holding the
 * workspace selector and the selected workspace's sessions.
 * @param props - framework standard props plus the injected navigation calls.
 * @returns the overlay, rendered on `document.body`.
 */
export function DrawerOverlay(props: DrawerOverlayProps) {
  injectStyles(STYLE_ID, CSS)
  const [open, setOpen] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [connState, setConnState] = useState<string | undefined>(() => props.getConnectionState?.())
  /** Live horizontal drag offset while swiping the panel closed. */
  const [dragX, setDragX] = useState(0)
  const dragRef = useRef<{ x0: number; y0: number; active: boolean; id: number } | null>(null)

  useEffect(() => {
    const sync = (): void => { setConnState(props.getConnectionState?.()) }
    sync()
    return props.subscribeConnection?.(sync)
  }, [props])

  // Scroll affordance. A list that continues below the fold is indistinguishable
  // from a list that ends there, so the panel shows a fade while more content
  // remains. Measured rather than assumed: content that fits shows nothing.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tabRef = useRef<HTMLButtonElement | null>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  const measureOverflow = useCallback((): void => {
    const el = bodyRef.current
    if (el === null) return
    setMoreBelow(el.scrollHeight - el.clientHeight - el.scrollTop > 8)
  }, [])

  // Selectors return stable references only; anything derived is computed with
  // useMemo below. Returning a freshly built array from a selector would give a
  // new identity every render and loop.
  const items = props.useWorkspaces((s) => s.items)
  const archived = props.useWorkspaces((s) => s.archivedSessionIds)
  const wsPhase = props.useWorkspaces((s) => s.phase)
  const byId = props.useSessions((s) => s.byId)
  const current = props.useSessions((s) => s.current)
  const sessPhase = props.useSessions((s) => s.phase)

  // Now is read once per open rather than on a timer: the labels are coarse
  // ("3分钟", "今天") and a phone drawer is inspected briefly.
  const now = useMemo(() => Date.now(), [open, items, byId])

  const grouped = useMemo(() => {
    const archivedSet = new Set(archived)
    return items.map((ws) => {
      const sessions = ws.sessionIds
        .map((id) => byId[id])
        .filter((s): s is SessionSummary => s !== undefined)
        // Subagent sessions belong to their parent's detail view, blank ones
        // are reuse placeholders, and archived ones were explicitly put away.
        .filter((s) => s.origin !== 'subagent' && !s.blank && !archivedSet.has(s.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      return { ws, sessions }
    })
  }, [items, byId, archived])

  // The active workspace is the one accounting for the current session; there
  // is no explicit "selected workspace" in the snapshot. Falling back to the
  // first keeps the panel useful when nothing is selected yet.
  const activeId = useMemo(() => {
    if (current !== undefined) {
      const owner = grouped.find((g) => g.sessions.some((s) => s.id === current))
      if (owner !== undefined) return owner.ws.workspaceId
    }
    return grouped[0]?.ws.workspaceId
  }, [grouped, current])

  const active = grouped.find((g) => g.ws.workspaceId === activeId)

  const buckets = useMemo(() => {
    const order: Bucket[] = ['justNow', 'today', 'yesterday', 'earlier']
    const label: Record<Bucket, string> = {
      justNow: t.bucketJustNow,
      today: t.bucketToday,
      yesterday: t.bucketYesterday,
      earlier: t.bucketEarlier,
    }
    const sessions = active?.sessions ?? []
    return order
      .map((b) => ({ bucket: b, label: label[b], items: sessions.filter((s) => bucketFor(s.updatedAt, now) === b) }))
      .filter((g) => g.items.length > 0)
  }, [active, now])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  /**
   * Reserve room in the host tablist for the 导航 label.
   *
   * Measured rather than assumed: the label is text, so its width follows the
   * locale — 26px for '导航' at this font, 65px for 'Navigation'. The stylesheet
   * declares `padding-left: var(--dsh-mobile-nav-reserve, 56px)`, and a hardcoded
   * 56px fits only the Chinese copy: in English the label overlapped the host's
   * first tab by ~9px.
   *
   * The write cannot be one-shot: measured on the live instance, the effect runs
   * BEFORE the host's tab strip is committed (the overlay is a body child while
   * the strip lives in the app frame), so a single query found nothing and the
   * fallback stayed in place. So this keeps a cheap guard on every body mutation
   * — a `isConnected` test plus a variable read — and re-queries only when the
   * element is gone or the variable was cleared by a re-mount.
   */
  useEffect(() => {
    const tab = tabRef.current
    if (tab === null) return
    const VAR = '--dsh-mobile-nav-reserve'
    let list: HTMLElement | null = null

    const reserve = (): void => {
      if (list === null) return
      const tabBox = tab.getBoundingClientRect()
      if (tabBox.width === 0) return
      const offset = tabBox.left - list.getBoundingClientRect().left
      const value = `${Math.ceil(offset + tabBox.width + 10)}px`
      if (list.style.getPropertyValue(VAR) !== value) list.style.setProperty(VAR, value)
    }

    const ensure = (): void => {
      if (list !== null && list.isConnected && list.style.getPropertyValue(VAR) !== '') { reserve(); return }
      const found = document.querySelector('[class*="_tabs"][role="tablist"]')
      list = found instanceof HTMLElement ? found : null
      reserve()
    }

    ensure()
    const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(ensure)
    sizeObserver?.observe(tab)
    // The label reflows when the web font lands, and the host may re-mount the
    // strip (cheap guard, see the note above).
    const domObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(ensure)
    domObserver?.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', ensure)
    void document.fonts?.ready.then(ensure).catch(() => {})
    return () => {
      sizeObserver?.disconnect()
      domObserver?.disconnect()
      window.removeEventListener('resize', ensure)
    }
  }, [t.drawerTitle])

  /**
   * Swipe-left-to-close on the panel body.
   *
   * The panel opens from the left, so dismissing it with a leftward flick
   * matches the motion (same as most mobile sheets). The system Back gesture
   * owns the left screen edge; this lives inside the panel. Vertical list
   * scroll is left alone: the drag only claims the gesture after |dx| clearly
   * beats |dy| and dx is negative (towards the left / off-canvas).
   */
  const onPanelTouchStart = (e: ReactTouchEvent): void => {
    if (!open || e.touches.length !== 1) return
    const t0 = e.touches[0]
    dragRef.current = { x0: t0.clientX, y0: t0.clientY, active: false, id: t0.identifier }
  }

  const onPanelTouchMove = (e: ReactTouchEvent): void => {
    const d = dragRef.current
    if (d === null || !open) return
    const t0 = [...e.touches].find((t) => t.identifier === d.id)
    if (t0 === undefined) return
    const dx = t0.clientX - d.x0
    const dy = t0.clientY - d.y0
    if (!d.active) {
      // Claim only a clear horizontal left-drag.
      if (dx < -12 && Math.abs(dx) > Math.abs(dy) * 1.2) d.active = true
      else if (Math.abs(dy) > 12) {
        dragRef.current = null
        return
      } else return
    }
    // Rubber-band: no rightward pull past the open rest position.
    setDragX(Math.min(0, dx))
  }

  const onPanelTouchEnd = (): void => {
    const d = dragRef.current
    dragRef.current = null
    if (d === null || !d.active) {
      setDragX(0)
      return
    }
    // Commit if the user dragged far enough towards the left.
    const commit = dragX < -72
    setDragX(0)
    if (commit) setOpen(false)
  }

  // Re-measure whenever the drawer opens, the content changes, or the box
  // resizes (a keyboard shrinking the panel changes what fits).
  useEffect(() => {
    if (!open) {
      setMoreBelow(false)
      return
    }
    measureOverflow()
    const el = bodyRef.current
    if (el === null) return
    el.addEventListener('scroll', measureOverflow, { passive: true })
    // Guarded: an engine without ResizeObserver keeps the open-time measurement
    // and the scroll listener, so the fade still tracks scrolling.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureOverflow)
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', measureOverflow)
      observer?.disconnect()
    }
  }, [open, measureOverflow, grouped, buckets])

  // Marquee for the current session's title, measured rather than assumed.
  //
  // Only the active row animates: there is exactly one current session, so this
  // keeps a screenful of read-only rows perfectly still. It also runs only when
  // the text genuinely overflows — otherwise the ellipsis already signals "there
  // is more", and a moving row would be noise.
  //
  // Distance and duration are derived from the measurement, so a long title and a
  // short one scroll at the same speed instead of the short one crawling.
  useEffect(() => {
    const panel = panelRef.current
    if (panel === null) return
    // Whatever was marked last render is stale; the active row may have changed.
    for (const stale of panel.querySelectorAll('.dsh-mobile-sess-title[data-scroll]')) {
      stale.removeAttribute('data-scroll')
    }
    if (!open) return
    const title = panel.querySelector('.dsh-mobile-sess[data-active="true"] .dsh-mobile-sess-title')
    const inner = title === null ? null : title.firstElementChild
    if (title === null || inner === null) return
    // The inner span carries `overflow: hidden`, so its scrollWidth still reports
    // the full text width while clientWidth reports the box.
    const distance = inner.scrollWidth - title.clientWidth
    if (distance <= MARQUEE_MIN_PX) return
    title.setAttribute('data-scroll', 'true')
    title.style.setProperty('--dsh-mobile-marquee-distance', `${distance}px`)
    // Roughly 22px per second, clamped so a very long title stays endurable.
    title.style.setProperty('--dsh-mobile-marquee-duration', `${Math.min(20, Math.max(6, distance / 22)).toFixed(1)}s`)
  }, [open, current, grouped])

  const loading = wsPhase === 'pending' || sessPhase === 'pending'

  const overlay = (
    <div className="dsh-mobile-drawer-root" data-open={open ? 'true' : 'false'} data-dsh-mobile-ui="drawer-overlay">
      {/* Only open affordance: header text tab "导航". */}
      <button
        type="button"
        className="dsh-mobile-nav-tab"
        ref={tabRef}
        aria-label={t.drawerOpen}
        aria-expanded={open}
        data-dsh-mobile-ui="drawer-trigger"
        onClick={() => { setOpen(true) }}
      >
        {t.drawerTitle}
      </button>

      <div
        className="dsh-mobile-drawer-scrim"
        data-dsh-mobile-ui="drawer-scrim"
        onClick={() => { setOpen(false) }}
      />

      <div
        className="dsh-mobile-drawer-panel"
        ref={panelRef}
        data-dsh-mobile-ui="drawer-panel"
        /* Deliberately NOT role="dialog" + aria-modal="true": dsh-tether's
           injected narrow-screen sheet forces that exact pair to
           `width: 100% !important; max-width: 100% !important;
           border-radius: 0 !important`, which left no scrim to tap and is how
           this shipped broken to a phone — 321px in an isolated profile, 413px
           of 412 on a device where tether is also installed. The rule is
           `!important`, so not matching its selector is the fix; verified by
           tools/verify-coexistence.mjs. `navigation` is also the more honest
           role: this is a navigation region and the panel traps no focus, so
           claiming modality would overstate it. */
        role="navigation"
        aria-label={t.drawerTitle}
        data-dragging={dragX < 0 ? 'true' : 'false'}
        style={dragX < 0 ? { transform: `translateX(${dragX}px)` } : undefined}
        onTouchStart={onPanelTouchStart}
        onTouchMove={onPanelTouchMove}
        onTouchEnd={onPanelTouchEnd}
        onTouchCancel={onPanelTouchEnd}
      >
        <div className="dsh-mobile-drawer-head">
          <span className="dsh-mobile-drawer-title">{t.drawerTitle}</span>
          <button
            type="button"
            className="dsh-mobile-drawer-new"
            aria-label={t.drawerNewSession}
            data-dsh-mobile-ui="drawer-new-session"
            onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => { props.startSession?.() })
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M9 3.5v11M3.5 9h11" />
            </svg>
          </button>
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

        <div className="dsh-mobile-drawer-body" ref={bodyRef}>
          {/* Workspaces on the connected machine. Not machines: switching
              machines belongs to dsh-tether and is not readable here. */}
          <div className="dsh-mobile-drawer-label">{t.drawerWorkspaces}</div>
          {grouped.length === 0
            ? <div className="dsh-mobile-drawer-empty">{loading ? t.drawerLoading : t.drawerNoWorkspaces}</div>
            : grouped.map(({ ws, sessions }) => (
              <button
                key={ws.workspaceId}
                type="button"
                className="dsh-mobile-ws"
                data-active={ws.workspaceId === activeId ? 'true' : 'false'}
                data-dsh-mobile-ui="drawer-workspace"
                onClick={() => { props.openWorkspace(ws.workspaceId); setOpen(false) }}
              >
                <span className="dsh-mobile-ws-dot" aria-hidden="true" />
                <span className="dsh-mobile-ws-text">
                  <span className="dsh-mobile-ws-name">{ws.title}</span>
                  <span className="dsh-mobile-ws-path">{ws.path}</span>
                </span>
                <span className="dsh-mobile-ws-count">{sessions.length}</span>
              </button>
            ))}

          <div className="dsh-mobile-drawer-sep" />
          <div className="dsh-mobile-drawer-label">{t.drawerSessions}</div>

          {buckets.length === 0
            ? <div className="dsh-mobile-drawer-empty">{loading ? t.drawerLoading : t.drawerNoSessions}</div>
            : buckets.map((group) => (
              <div key={group.bucket}>
                <div className="dsh-mobile-drawer-label">{group.label}</div>
                {group.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="dsh-mobile-sess"
                    data-active={s.id === current ? 'true' : 'false'}
                    data-dsh-mobile-ui="drawer-session"
                    onClick={() => { props.openSession(s.id); setOpen(false) }}
                  >
                    <span className="dsh-mobile-sess-title" title={redactSecrets(s.displayTitle)}>
                      <span>{redactSecrets(s.displayTitle)}</span>
                    </span>
                    <span className="dsh-mobile-sess-meta">
                      {s.running || s.completed === true
                        ? <span className="dsh-mobile-sess-state" data-state={s.running ? 'running' : 'done'} aria-hidden="true" />
                        : null}
                      <span>{ageLabel(s.updatedAt, now)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>

        <div className="dsh-mobile-drawer-foot">
          {/* Scroll affordance: shown only while rows remain below the fold, so a
              list that fits stays clean. Purely decorative and inert to touch.
              Anchored to the footer's top edge (bottom: 100%) — pinned to the
              panel it sat underneath this opaque footer and never showed. */}
          {moreBelow
            ? <div className="dsh-mobile-drawer-more" data-dsh-mobile-ui="drawer-more" aria-hidden="true" />
            : null}
          <span
            className="dsh-mobile-conn-dot"
            data-dsh-mobile-ui="drawer-conn"
            data-state={connState ?? 'unknown'}
            title={
              connState === 'connected' ? t.connConnected
                : connState === 'connecting' ? t.connConnecting
                  : connState === 'disconnected' ? t.connDisconnected
                    : '—'
            }
            aria-label={
              connState === 'connected' ? t.connConnected
                : connState === 'connecting' ? t.connConnecting
                  : connState === 'disconnected' ? t.connDisconnected
                    : undefined
            }
            aria-hidden={connState === undefined}
          />

          <button
            type="button"
            className="dsh-mobile-drawer-settings"
            data-dsh-mobile-ui="drawer-settings"
            onClick={() => {
              setOpen(false)
              // Next frame: let the scrim unmount so the settings modal is the
              // topmost interactive surface.
              requestAnimationFrame(() => { openHostSettings() })
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="9" r="2.4" />
              <path d="M9 2.2v1.6M9 14.2v1.6M2.2 9h1.6M14.2 9h1.6M4.2 4.2l1.1 1.1M12.7 12.7l1.1 1.1M13.8 4.2l-1.1 1.1M5.3 12.7l-1.1 1.1" />
            </svg>
            <span>{t.drawerSettings}</span>
          </button>

          <button
            type="button"
            className="dsh-mobile-drawer-refresh"
            data-dsh-mobile-ui="drawer-refresh"
            data-busy={reconnecting ? 'true' : 'false'}
            aria-label={t.drawerRefresh}
            aria-busy={reconnecting}
            onClick={() => {
              if (reconnecting) return
              setReconnecting(true)
              // Official recovery: abort the current attempt and start retry 1.
              // Keeps the drawer open so the user sees the spinner complete.
              props.reconnect?.()
              window.setTimeout(() => { setReconnecting(false) }, 1200)
            }}
          >
            <svg
              className="dsh-mobile-drawer-refresh__ico"
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14.5 8.2A5.6 5.6 0 1 1 12.4 4" />
              <path d="M12.2 1.8v3.2h3.2" />
            </svg>
            <span>{reconnecting ? t.drawerRefreshed : t.drawerRefresh}</span>
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}
