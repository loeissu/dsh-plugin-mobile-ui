/**
 * Browser half: registers this plugin's surfaces into DSH's slot registry.
 *
 * ## The one rule that matters
 *
 * Every registration is wrapped in `ctx.slots.inject(key, () => register(...))`.
 * That is required, not stylistic:
 *
 *  - `inject` waits for the slot to be DECLARED. If the running DSH build never
 *    declares `key`, the callback simply never runs — a silent no-op. This is
 *    what makes one build safe on both `0.1.2-rc.1` and `0.1.5-rc.x`, where the
 *    slot sets differ: ui-renderer's `reconcile()` returns early when
 *    `specDynamic(key)` is undefined.
 *  - A bare `ctx.slots.register()` into an undeclared slot THROWS
 *    (`slot "X" is not declared`). It is not a silent skip.
 *
 * ## Slot semantics used here
 *
 * | slot | kind | effect of registering |
 * |---|---|---|
 * | `shell.overlay` | list | additive — a new `id` sits beside the shipped cells |
 * | `settings.section` | list | additive — one more settings page |
 * | `tool.call.toolview` | keyed | REPLACES the shipped card for that tool name |
 * | `sidebar` | single | REPLACES the whole navigation column |
 *
 * Only the two additive slots are enabled by default. See `config.ts`.
 *
 * Only `import type` is used for cross-package declarations, so no runtime value
 * import crosses a plugin boundary (DSH's client bundle purity rule).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FEATURES } from './config.ts'
import { DRAWER_CHILDREN, Drawer } from './Drawer.tsx'
import { DrawerOverlay } from './DrawerOverlay.tsx'
import { SECTION_OPTIONS, SettingsSection } from './Settings.tsx'
import { SplashHost } from './Splash.tsx'
import { ToolCard } from './ToolCard.tsx'
import { installKeyboardDebug } from './keyboard-debug.ts'
import { installResumeReconnect } from './connection-recovery.ts'
import { installConversationChrome } from './conversation-chrome.ts'
import { installSettingsChrome } from './settings-chrome.ts'
import { installSettingsSwipe } from './settings-swipe.ts'
import { installClipboardFallback } from './clipboard-fallback.ts'
import { installTetherCompat } from './tether-compat.ts'
import { installTypography } from './typography.ts'
import { installKeyboardFit } from './viewport.ts'

/**
 * Required services.
 *
 * `uiWorkspace` supplies the drawer's navigation. Declaring it is what makes
 * `ctx.uiWorkspace` available inside the inject face; components never see
 * `ctx` themselves.
 */
export const inject = ['slots', 'layout', 'uiWorkspace', 'connection']

/** Order for the splash cell; lower renders first within the list. */
const SPLASH_ORDER = 10

/**
 * Order for the drawer overlay.
 *
 * Above the splash (which uses {@link SPLASH_ORDER}): the splash covers the
 * whole viewport while it is up, so a drawer rendered beneath it would be
 * unreachable for that second. Both are `list` cells, so this is only ordering,
 * not competition.
 */
const DRAWER_ORDER = 20

/**
 * Priority for any registration that SHADOWS a shipped occupant.
 *
 * Both cardinalities that can shadow behave the same way at the runtime level:
 * a `keyed` cell and a `single` cell each admit one entry per priority, and a
 * second registration at the same priority is a hard error rather than a
 * replacement — the slot prose ("replaced, not shared") describes intent, not
 * the enforcement. Lower priority renders, so a negative value both avoids the
 * collision and wins the cell.
 *
 * For `single` the consequence of getting this wrong is severe: the collision
 * fails plugin activation and the application renders its "Failed to load
 * plugins" card, so nothing works at all.
 */
const SHADOW_PRIORITY = -100

/**
 * Install this plugin's surfaces.
 *
 * Each surface is independent: a slot missing on the running DSH build removes
 * exactly that contribution and nothing else.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  // Keyboard fit installs no slot: it is a stylesheet plus a viewport listener,
  // registered as an effect so it is disposed with the plugin.
  if (FEATURES.keyboardFit) {
    ctx.effect(() => installKeyboardFit(), 'mobile-ui: keyboard fit')
  }

  // Counter-rules for tether's injected sheet. A stylesheet with no listeners,
  // so there is nothing to dispose.
  if (FEATURES.tetherCompat) installTetherCompat()

  // Foreground recovery: reconnect when the page becomes visible and the wire
  // is disconnected (Tether backgrounding often skips offline/online events).
  if (FEATURES.resumeReconnect) {
    ctx.effect(() => installResumeReconnect(ctx), 'mobile-ui: resume reconnect')
  }

  // Base typography for every surface below. Stylesheet only, so like the two
  // installs above there is nothing to dispose.
  if (FEATURES.typography) installTypography()

  // TEMPORARY diagnostic. See the flag's comment in config.ts.
  if (FEATURES.keyboardDebug) {
    ctx.effect(() => installKeyboardDebug(), 'mobile-ui: keyboard debug badge')
  }

  if (FEATURES.splash) {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'mobile-ui-splash', order: SPLASH_ORDER },
        SplashHost,
      ))
  }

  if (FEATURES.settings) {
    // Mobile density for the host settings dialog; no slot, stylesheet only.
    installSettingsChrome()
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(SECTION_OPTIONS, SettingsSection))
  }

  // Touch comfort for the host conversation's 26-34px controls; stylesheet only,
  // and additive like the settings chrome above.
  if (FEATURES.conversationChrome) installConversationChrome()

  // Sideways swipe inside the host settings dialog changes section. Listeners only,
  // so it is registered as an effect and disposed with the plugin.
  if (FEATURES.settingsSwipe) {
    ctx.effect(() => installSettingsSwipe(), 'mobile-ui: settings swipe')
  }

  // The host's copy actions silently fail in a WebView: the async clipboard API
  // rejects and the host's own legacy fallback is unreachable. The wrapper goes onto
  // the clipboard method and comes off with the plugin.
  if (FEATURES.clipboardFallback) {
    ctx.effect(() => installClipboardFallback(), 'mobile-ui: clipboard fallback')
  }

  // The drawer overlay. `shell.overlay` is a `list`, so this is additive: it
  // sits beside the shipped entries rather than competing with any of them, and
  // it is the only surface here that has no shipped occupant to argue with.
  if (FEATURES.drawerOverlay) {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'mobile-ui-drawer',
          order: DRAWER_ORDER,
          // Components never see `ctx`, so the navigation calls arrive through
          // the inject face. `uiWorkspace` owns both: `openSession` selects a
          // session, `openWorkspace` connects a workspace and opens its
          // session. Returning plain callbacks keeps the face to data plus
          // behavior, as the slot contract requires.
          inject: () => ({
            openSession: (sessionId: string): void => { ctx.uiWorkspace.openSession(sessionId) },
            openWorkspace: (workspaceId: string): void => {
              // Fire and forget: `openWorkspace` returns a promise that settles
              // when navigation commits, and the drawer closes immediately so
              // the reader sees the conversation it navigates to.
              void ctx.uiWorkspace.openWorkspace(workspaceId)
            },
            /** Start a New Session in the current / most recent workspace. */
            startSession: (): void => { ctx.uiWorkspace.startSession() },
            /**
             * Force an immediate Host reconnect.
             *
             * Backgrounding the Tether shell often leaves the WebSocket half-dead
             * without a clean `offline` event, so the auto-reconnect loop never
             * runs. `reconnect()` aborts the current attempt and starts retry 1
             * right away — the sanctioned recovery command.
             */
            reconnect: (): void => { ctx.connection.reconnect() },
            /** Live Host wire state for the status dot. */
            subscribeConnection: (cb: () => void): (() => void) =>
              ctx.connection.state.subscribe(cb),
            getConnectionState: (): string | undefined =>
              ctx.connection.state.getSnapshot() as string | undefined,
          }),
        },
        DrawerOverlay,
      ))
  }

  // Keyed dispatch: one registration per tool name, each shadowing that tool's
  // shipped card. The shipped list has five entries, so four of them (read, grep,
  // edit, write) really do displace a shipped card — the fifth (pwsh) claims a key
  // the host leaves to its generic card. `toolCards: []` keeps every shipped card.
  //
  // Priority is load-bearing, not cosmetic. A keyed cell accepts only ONE entry
  // per priority: registering at the same priority as the shipped entry throws
  //   keyed slot "tool.call.toolview" already has an entry for key "read"
  //   at priority 0 (registered by ...) — register at a different priority to
  //   shadow it (lowest renders)
  // so a would-be replacement must come in BELOW the shipped entry. Lower
  // priority renders, so a negative value both avoids the collision and wins
  // the cell.
  for (const toolName of FEATURES.toolCards) {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        { name: 'tool.call.toolview', key: toolName, priority: SHADOW_PRIORITY },
        ToolCard,
      ))
  }

  // `sidebar` is single/root: this takes over the entire navigation column and
  // every seat ui-sidebar declared collapses with it, which is why the entry
  // declares them as children and renders each one back.
  //
  // Priority matters here for the same reason it does on a keyed cell, and
  // getting it wrong is far worse. Observed on a live instance at priority 0:
  //
  //   Failed to load plugins
  //   @deepseek-ai/dsh-client-ui-sidebar
  //   failed to apply loader entry (@deepseek-ai/dsh-client-ui-sidebar):
  //   single slot "sidebar" already has a registration at priority 0
  //   (registered by ...) — register at a different priority to shadow it
  //
  // That is not a broken sidebar: the collision makes plugin activation fail
  // and the whole application renders its "Failed to load plugins" card
  // instead. A negative priority both avoids the collision and wins the cell.
  //
  // A priority alone is NOT sufficient to take this slot over: both entries
  // would still declare the same six child seats, and the slot system allows one
  // declarer per key. Observed on a live instance with the priority fixed:
  //
  //   failed to apply loader entry (@deepseek-ai/dsh-client-ui-sidebar):
  //   slot "sidebar.brand.mark" is already declared (by an entry in "sidebar")
  //
  // So the takeover requires the shipped ui-sidebar entry to be DISABLED in the
  // profile's cordis.patch.yml. See docs/drawer-takeover.md.
  if (FEATURES.replaceSidebar) {
    ctx.slots.inject('sidebar', () =>
      ctx.slots.register(
        {
          name: 'sidebar',
          children: DRAWER_CHILDREN,
          priority: SHADOW_PRIORITY,
          // The frame owns the column width, so the drawer cannot expand
          // itself; it asks the layout service instead. Components never see
          // `ctx`, so the callback arrives through the inject face.
          inject: () => ({
            toggleSidebar: (): void => { ctx.layout.toggleSidebar() },
          }),
        },
        Drawer,
      ))
  }
}
