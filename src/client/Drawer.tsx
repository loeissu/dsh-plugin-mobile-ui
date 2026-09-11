/**
 * Navigation column replacement, for the `sidebar` slot.
 *
 * ## DISABLED BY DEFAULT — and why
 *
 * `sidebar` is `single`/`root`. Its declaration is explicit:
 *
 *   "The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which
 *    declares the workspace and settings seats inside it — registering here
 *    replaces the navigation column outright rather than adding to it, and the
 *    seats it declares disappear with it. To add something to the sidebar,
 *    register into one of those inner seats instead."
 *
 * So taking this slot is a **takeover**: every seat ui-sidebar declared
 * collapses with it, and this component must re-declare and re-render each one
 * or the user loses workspace switching and the settings entry point. That is a
 * destructive, hard-to-recover failure on a phone, and it has not been verified
 * on a device.
 *
 * It therefore ships **off** (`FEATURES.replaceSidebar === false`) and is
 * exported so the takeover can be reviewed and enabled deliberately. Read
 * README.md → "Enabling the drawer" before turning it on.
 *
 * ## What it does when enabled
 *
 * Re-declares the shipped seats as `children` — declaration is also render
 * authorization, so a slot this component does not declare would be an error to
 * render — and lays them out as a mobile overlay drawer: brand row, workspace
 * seat, then the settings and footer actions pinned to the bottom.
 *
 * The `collapsed` owner flag is honoured: on a narrow viewport the drawer is
 * off-canvas and the frame keeps a compact rail, which is the behaviour the
 * frame expects from its occupant.
 */
import { t } from './config.ts'
import { injectStyles, TOKEN, V } from './theme.ts'

/** Owner share: live column state from the frame's concession solve. */
export interface DrawerProps {
  /** True when the sidebar is closed (the column renders the compact control rail). */
  readonly collapsed: boolean
  /** Rendered column width in px. */
  readonly width: number
  /**
   * Child renderers, narrowed to the keys this entry declared. Supplied by the
   * renderer from the registration's `children` table.
   */
  readonly renderSlot: (key: DrawerChildKey, opts?: { fallback?: unknown }) => unknown
  /**
   * Ask the frame to expand or collapse the column. Injected, because the frame
   * owns the geometry: the occupant cannot widen its own column.
   */
  readonly toggleSidebar: () => void
}

/** Every seat this takeover re-declares, and therefore must render. */
export const DRAWER_CHILDREN = {
  'sidebar.brand.mark': { kind: 'single', scope: 'root' },
  'sidebar.brand.name': { kind: 'single', scope: 'root' },
  'sidebar.panellist': { kind: 'list', scope: 'root' },
  'sidebar.workspaces': { kind: 'single', scope: 'root' },
  'sidebar.settings': { kind: 'single', scope: 'root' },
  'sidebar.footer.action': { kind: 'list', scope: 'root' },
} as const

/** Keys of {@link DRAWER_CHILDREN}. */
export type DrawerChildKey = keyof typeof DRAWER_CHILDREN

const STYLE_ID = 'drawer'

const CSS = `
.dsh-mobile-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${V.surface};
  border-right: 0.5px solid ${V.border};
  color: ${V.text};
}

/* Compact rail: the frame reserves the collapsed width, so render only the
   brand mark and keep the control affordances reachable. */
.dsh-mobile-drawer[data-collapsed='true'] {
  align-items: center;
  border-right: 0.5px solid ${V.border};
}

.dsh-mobile-drawer__brand {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
  min-height: 52px;
}

.dsh-mobile-drawer[data-collapsed='true'] .dsh-mobile-drawer__brand {
  padding: 12px 0;
  justify-content: center;
}

.dsh-mobile-drawer[data-collapsed='true'] .dsh-mobile-drawer__label,
.dsh-mobile-drawer[data-collapsed='true'] .dsh-mobile-drawer__body,
.dsh-mobile-drawer[data-collapsed='true'] .dsh-mobile-drawer__foot {
  display: none;
}

.dsh-mobile-drawer__section {
  flex: none;
  padding: 0 10px 10px;
}

.dsh-mobile-drawer__heading {
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 600;
  color: ${V.textFaint};
  padding: 10px 6px 8px;
}

.dsh-mobile-drawer__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding: 0 10px;
}

.dsh-mobile-drawer__foot {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-top: 0.5px solid ${V.border};
}

.dsh-mobile-drawer__toggle {
  flex: none;
  margin-left: auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: ${V.textDim};
  cursor: pointer;
}

.dsh-mobile-drawer__toggle:active { background: ${V.active}; }

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-drawer { transition: none; }
}
`

/** Fallback label shown when a seat renders nothing. */
function Section({ heading, children }: { heading: string, children: unknown }) {
  return (
    <div className="dsh-mobile-drawer__section">
      <div className="dsh-mobile-drawer__heading">{heading}</div>
      {children as never}
    </div>
  )
}

/**
 * The replacement navigation column.
 *
 * Only mounted when `FEATURES.replaceSidebar` is true; see the module comment
 * for the consequences of registering it.
 * @param props - the slot's owner share plus the declared child renderers.
 * @returns the column.
 */
export function Drawer(props: DrawerProps) {
  injectStyles(STYLE_ID, CSS)

  // `collapsed` is the frame's own state and the only authority on column
  // width; there is no local mirror of it. An earlier version kept a local
  // `open` flag and computed `collapsed = props.collapsed || !open`, which
  // could never expand once the frame reported collapsed — the toggle appeared
  // dead. Expanding means asking the frame, not flipping a local boolean.
  const collapsed = props.collapsed

  return (
    <div className="dsh-mobile-drawer" data-collapsed={collapsed ? 'true' : 'false'} data-dsh-mobile-ui="drawer">
      <div className="dsh-mobile-drawer__brand">
        {props.renderSlot('sidebar.brand.mark') as never}
        <span className="dsh-mobile-drawer__label">
          {props.renderSlot('sidebar.brand.name') as never}
        </span>
        <button
          type="button"
          className="dsh-mobile-drawer__toggle"
          aria-label={collapsed ? t.drawerOpen : t.drawerClose}
          aria-expanded={!collapsed}
          onClick={() => { props.toggleSidebar() }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 4h12M2 8h12M2 12h8" />
          </svg>
        </button>
      </div>

      {/* Every declared seat is rendered; dropping one silently removes a
          shipped affordance from the user's navigation. */}
      <Section heading={t.drawerHosts}>
        {props.renderSlot('sidebar.workspaces') as never}
      </Section>

      <div className="dsh-mobile-drawer__body">
        <div className="dsh-mobile-drawer__heading">{t.drawerSessions}</div>
        {props.renderSlot('sidebar.panellist') as never}
      </div>

      <div className="dsh-mobile-drawer__foot">
        {props.renderSlot('sidebar.footer.action') as never}
        {props.renderSlot('sidebar.settings') as never}
      </div>
    </div>
  )
}

/** Build-time token kept in the bundle for diagnostics. */
export const DRAWER_STYLE_TOKEN = TOKEN.border
