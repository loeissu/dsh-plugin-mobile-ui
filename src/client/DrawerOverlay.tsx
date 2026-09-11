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

@media ${NARROW} {
  .dsh-mobile-drawer-root {
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
    font-size: 14px;
    color: ${V.text};
  }

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
    /* Narrower than the prototype's 80%: on a phone a full-height panel at 80%
       leaves a strip too small to aim at, and the drawer is dismissed by
       tapping the scrim. min() keeps the strip on small viewports while
       capping the panel on wide ones. */
    width: min(72%, 300px);
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
    /* Momentum scrolling and contained overscroll: without the latter, scrolling
       to the end of the list chains to the conversation behind the drawer. */
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 0 0 20px;
  }

  /* Section labels pin to the top while their rows scroll under them, so the
     reader always knows which group the visible rows belong to. Opaque
     background is required: a sticky label scrolls OVER the rows. */
  .dsh-mobile-drawer-label {
    position: sticky;
    top: 0;
    z-index: 1;
    background: ${V.surface};
    font-size: 11px;
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

  /* Bottom fade marking that the list continues. Sits above the scroll body,
     inside the panel so it inherits the rounded corner. */
  .dsh-mobile-drawer-more {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
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
  }
  .dsh-mobile-ws:active { background: ${V.active}; }
  .dsh-mobile-ws[data-active='true'] { background: ${V.hover}; }
  .dsh-mobile-ws-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
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
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dsh-mobile-ws-path {
    font-size: 11px;
    color: ${V.textFaint};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dsh-mobile-ws-count {
    flex: none;
    font-size: 11px;
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
  .dsh-mobile-sess-title {
    font-size: 14px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${V.textDim};
  }
  .dsh-mobile-sess[data-active='true'] .dsh-mobile-sess-title { color: ${V.text}; font-weight: 500; }
  .dsh-mobile-sess-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: ${V.textFaint};
    margin-top: 3px;
  }
  .dsh-mobile-sess-state {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    corner-shape: round;
  }
  .dsh-mobile-sess-state[data-state='running'] { background: ${V.accent}; }
  .dsh-mobile-sess-state[data-state='done'] { background: #34d399; }

  .dsh-mobile-drawer-empty {
    padding: 18px 16px;
    font-size: 12.5px;
    line-height: 1.7;
    color: ${V.textFaint};
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
 * The drawer overlay: a floating trigger, a scrim, and a panel holding the
 * workspace selector and the selected workspace's sessions.
 * @param props - framework standard props plus the injected navigation calls.
 * @returns the overlay, rendered on `document.body`.
 */
export function DrawerOverlay(props: DrawerOverlayProps) {
  injectStyles(STYLE_ID, CSS)
  const [open, setOpen] = useState(false)

  // Scroll affordance. A list that continues below the fold is indistinguishable
  // from a list that ends there, so the panel shows a fade while more content
  // remains. Measured rather than assumed: content that fits shows nothing.
  const bodyRef = useRef<HTMLDivElement | null>(null)
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

  const loading = wsPhase === 'pending' || sessPhase === 'pending'

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

        {/* Scroll affordance: shown only while rows remain below the fold, so a
            list that fits stays clean. Purely decorative and inert to touch. */}
        {moreBelow
          ? <div className="dsh-mobile-drawer-more" data-dsh-mobile-ui="drawer-more" aria-hidden="true" />
          : null}

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
                    <span className="dsh-mobile-sess-title">{s.displayTitle}</span>
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
      </div>
    </div>
  )

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body)
}
