/**
 * Plugin-local configuration and copy.
 *
 * ## Why a source module and not cordis.yml
 *
 * A DSH client plugin cannot receive `config` from the profile layer: the
 * `dsh-client-modules` boot graph carries only `{ id, url, rev, inject,
 * immediately, external }` per entry — no config channel reaches the browser
 * half. Build-time `process.env.DSH_CLIENT_*` defines are the sanctioned
 * alternative for values that must be baked in, and everything here is read
 * once at factory execution.
 *
 * ## Copy and localization
 *
 * DSH routes product copy through typed locale dictionaries and gates it with
 * `verify-client-ui-i18n`. That gate runs inside the DSH repository and does
 * not apply to a third-party plugin, but the convention matters. This file is
 * the single home for every user-visible string, selected by the document
 * language; wiring the strings through `ctx.locale.register()` is tracked as
 * follow-up work in README.md.
 */

/** Languages this plugin ships copy for. */
export type Lang = 'zh' | 'en'

/** Every user-visible string, in both shipped languages. */
export interface Copy {
  readonly splashName: string
  readonly splashTagline: string
  readonly splashPreparing: string
  readonly splashConnecting: string
  readonly splashUnpacking: string
  readonly splashSlowNetwork: string
  readonly toolRunning: string
  readonly toolRan: string
  readonly toolFailed: string
  readonly toolNoOutput: string
  readonly toolTruncated: string
  readonly drawerHosts: string
  readonly settingsLabel: string
  readonly settingsHeading: string
  readonly settingsConnection: string
  readonly settingsAppearance: string
  readonly settingsAbout: string
  readonly settingsVersion: string
  readonly settingsFollowSystem: string
  readonly settingsToolCards: string
  readonly settingsResetSplash: string
  readonly settingsReplay: string
  readonly settingsFootnote: string
  readonly themeDark: string
  readonly themeLight: string
  readonly splashReplayHint: string
  readonly drawerOpen: string
  readonly drawerTitle: string
  readonly drawerClose: string
  readonly drawerSettings: string
  readonly drawerRefresh: string
  readonly drawerRefreshed: string
  readonly drawerNewSession: string
  readonly connConnected: string
  readonly connConnecting: string
  readonly connDisconnected: string
  readonly drawerPlaceholder: string
  readonly drawerWorkspaces: string
  readonly drawerSessions: string
  readonly drawerLoading: string
  readonly drawerNoWorkspaces: string
  readonly drawerNoSessions: string
  readonly bucketJustNow: string
  readonly bucketToday: string
  readonly bucketYesterday: string
  readonly bucketEarlier: string
  readonly ageJustNow: string
  readonly ageMinutes: string
  readonly ageHours: string
  readonly ageDays: string
}

const ZH: Copy = {
  splashName: 'DSH Tether',
  splashTagline: 'DeepSeek Harness，装进口袋',
  splashPreparing: '正在准备运行时…',
  splashConnecting: '正在连接…',
  splashUnpacking: '首次启动要解压运行时，约需 9 秒',
  splashSlowNetwork: '正在加载界面…',
  toolRunning: '正在运行',
  toolRan: '运行了',
  toolFailed: '失败',
  toolNoOutput: '（没有输出）',
  toolTruncated: '已截断',
  drawerHosts: '我的电脑',
  settingsLabel: '移动端',
  settingsHeading: '移动端界面',
  settingsConnection: '连接',
  settingsAppearance: '外观',
  settingsAbout: '关于',
  settingsVersion: '版本',
  settingsFollowSystem: '跟随系统主题',
  settingsToolCards: '工具卡片默认展开',
  settingsResetSplash: '重放启动页',
  settingsReplay: '重放',
  settingsFootnote: '这些界面的所有颜色都取自 DSH 自己的 --dsw-alias-* 语义 token，因此浅色与深色自动跟随宿主主题。本插件只往插槽里追加内容；除非显式配置，否则不会替换 DSH 自带的界面。',
  themeDark: '深色',
  themeLight: '浅色',
  splashReplayHint: '点击任意处关闭',
  drawerOpen: '展开导航',
  drawerTitle: '导航',
  drawerClose: '关闭',
  drawerSettings: '设置',
  drawerRefresh: '刷新连接',
  drawerRefreshed: '已刷新',
  drawerNewSession: '新建会话',
  connConnected: '已连接',
  connConnecting: '连接中',
  connDisconnected: '未连接',
  drawerPlaceholder: '工作区与会话列表将在这里显示。',
  drawerWorkspaces: '工作区',
  drawerSessions: '会话',
  drawerLoading: '正在载入…',
  drawerNoWorkspaces: '这台电脑上还没有工作区。',
  drawerNoSessions: '这个工作区里还没有会话。',
  bucketJustNow: '刚刚',
  bucketToday: '今天',
  bucketYesterday: '昨天',
  bucketEarlier: '更早',
  ageJustNow: '刚刚',
  ageMinutes: ' 分钟',
  ageHours: ' 小时',
  ageDays: ' 天',
}

const EN: Copy = {
  splashName: 'DSH Tether',
  splashTagline: 'DeepSeek Harness, in your pocket',
  splashPreparing: 'Preparing the runtime…',
  splashConnecting: 'Connecting…',
  splashUnpacking: 'First start unpacks the runtime — about 9 seconds',
  splashSlowNetwork: 'Loading the interface…',
  toolRunning: 'Running',
  toolRan: 'Ran',
  toolFailed: 'Failed',
  toolNoOutput: '(no output)',
  toolTruncated: 'truncated',
  drawerHosts: 'My computers',
  settingsLabel: 'Mobile',
  settingsHeading: 'Mobile interface',
  settingsConnection: 'Connection',
  settingsAppearance: 'Appearance',
  settingsAbout: 'About',
  settingsVersion: 'Version',
  settingsFollowSystem: 'Follow system theme',
  settingsToolCards: 'Expand tool cards by default',
  settingsResetSplash: 'Replay the splash',
  settingsReplay: 'Replay',
  settingsFootnote: 'Every color on these surfaces comes from DSH\u2019s own --dsw-alias-* semantic tokens, so light and dark follow the host theme. This plugin only adds to slots; it never replaces a shipped surface unless explicitly configured.',
  themeDark: 'Dark',
  themeLight: 'Light',
  splashReplayHint: 'Tap anywhere to dismiss',
  drawerOpen: 'Expand navigation',
  drawerTitle: 'Navigation',
  drawerClose: 'Close',
  drawerSettings: 'Settings',
  drawerRefresh: 'Reconnect',
  drawerRefreshed: 'Refreshed',
  drawerNewSession: 'New session',
  connConnected: 'Connected',
  connConnecting: 'Connecting',
  connDisconnected: 'Disconnected',
  drawerPlaceholder: 'Workspaces and sessions will appear here.',
  drawerWorkspaces: 'Workspaces',
  drawerSessions: 'Sessions',
  drawerLoading: 'Loading…',
  drawerNoWorkspaces: 'No workspaces on this machine yet.',
  drawerNoSessions: 'No sessions in this workspace yet.',
  bucketJustNow: 'Just now',
  bucketToday: 'Today',
  bucketYesterday: 'Yesterday',
  bucketEarlier: 'Earlier',
  ageJustNow: 'just now',
  ageMinutes: 'm',
  ageHours: 'h',
  ageDays: 'd',
}

/** Detect the copy language from the document, then the browser. */
function detectLang(): Lang {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('lang')
    if (attr !== null && attr.toLowerCase().startsWith('zh')) return 'zh'
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) return 'zh'
  return 'en'
}

/** Copy for the active language. */
export const t: Copy = detectLang() === 'zh' ? ZH : EN

/**
 * Which surfaces this plugin occupies.
 *
 * `shell.overlay` (splash) and `settings.section` are additive `list` slots:
 * registering there adds a cell beside the shipped ones and cannot remove
 * anything. `tool.call.toolview` is `keyed`, so each entry REPLACES the shipped
 * view for that tool name.
 */
export const FEATURES = {
  /** Boot / transition splash in `shell.overlay`. Additive. */
  splash: true,
  /** Settings page in `settings.section`. Additive. */
  settings: true,
  /**
   * Keep the app shell inside the visual viewport so the keyboard cannot cover
   * the composer.
   *
   * Touches no slot: it injects a narrow-screen stylesheet and a
   * `visualViewport` listener. The underlying defect is in the Android shell
   * (no `windowSoftInputMode`), and the definitive fix is native; this is the
   * mitigation that works without an APK rebuild. Inert when the WebView does
   * not report the keyboard — see `src/client/viewport.ts`.
   */
  keyboardFit: true,
  /**
   * Counter-rules for dsh-tether's over-broad injected selectors.
   *
   * Two tether rules reach past the surface they were written for:
   *
   *  1. `flex-wrap: wrap` on every element whose class contains `_row` — 26
   *     elements in the shipped UI — which squashes the queued-message row in the
   *     composer into a clipped sliver.
   *  2. a full-screen + `position: absolute` header applied to every modal dialog,
   *     which is only correct for the settings dialog: on the risk-confirmation
   *     dialog it makes the title land on top of its own body text.
   *
   * Touches no slot: a stylesheet only, and inert when tether is not installed.
   * Delete once tether narrows its selectors — see `src/client/tether-compat.ts`.
   */
  tetherCompat: true,
  /**
   * Force a Host reconnect when the page returns to the foreground while the
   * wire is not connected.
   *
   * Backgrounding the Tether shell often leaves the WebSocket half-dead
   * without a clean `offline` event, so DSH's own reconnect loop never runs.
   * Listening for `visibilitychange` / `pageshow` and calling
   * `ctx.connection.reconnect()` only when state is `disconnected` keeps the
   * recovery automatic; the drawer's manual refresh stays as a fallback.
   *
   * Touches no slot: listeners only, disposed with the plugin.
   * See `src/client/connection-recovery.ts`.
   */
  resumeReconnect: true,
  /**
   * Shared typography for the plugin's own surfaces: opt out of Android
   * WebView font boosting, tabular figures on numeric text, a line-height
   * floor, and no stock tap flash. A stylesheet only, scoped to
   * `[data-dsh-mobile-ui]`, so no host text outside this plugin is touched.
   * See `src/client/typography.ts`.
   */
  typography: true,
  /**
   * Hit layers for the HOST conversation's small controls (message actions,
   * composer buttons, the 对话/轨迹 tabs).
   *
   * Measured at 412x915: those controls paint 26-34px where the touch minimum is
   * 44, and they are the ones a phone user taps most. This grows only the hit
   * AREA via a pseudo-element — no size, position or content changes.
   *
   * Touches no slot: a stylesheet scoped to `data-slot` anchors, inert above the
   * phone breakpoint. See `src/client/conversation-chrome.ts`.
   */
  conversationChrome: true,
  /**
   * TEMPORARY. On-screen readout of the values that decide whether `keyboardFit`
   * can work at all: the live viewport heights, the smallest visual-viewport
   * height seen since load, and event counters.
   *
   * The reason it is needed: `keyboardFit` assumes Android WebView reports the
   * keyboard through `visualViewport`, and that assumption can only be tested on a
   * device. Mocking `visualViewport` on a desktop proves the logic is
   * self-consistent, not that the assumption holds — so the desktop suite was
   * green while the phone stayed broken.
   *
   * Off by default: the badge sat over the floating drawer trigger at phone
   * width and made navigation look broken. Enable only while collecting a
   * keyboard screenshot. See `src/client/keyboard-debug.ts`.
   */
  keyboardDebug: false,
  /**
   * Tool names whose shipped card this plugin replaces in
   * `tool.call.toolview`. A key the shipped composition already covers is
   * replaced, not shared — so every name listed here LOSES DSH's own card.
   * An empty array leaves every shipped tool card untouched.
   */
  toolCards: ['pwsh', 'read', 'grep', 'edit', 'write'] as readonly string[],
  /**
   * Replace the whole navigation column via the `sidebar` slot.
   *
   * DANGER: `sidebar` is `single`/`root`. Registering there replaces
   * ui-sidebar outright, and every seat it declared — `sidebar.workspaces`,
   * `sidebar.settings`, `sidebar.brand.*`, `sidebar.footer.action` — collapses
   * with it. The replacement must re-declare and re-render all of them or the
   * user loses workspace switching and the settings entry point.
   *
   * Left off by default: it has not been verified on a device, and the failure
   * mode is losing access to saved workspaces. See README.md.
   */
  replaceSidebar: false,
  /**
   * Mobile drawer as an overlay, in `shell.overlay`.
   *
   * The recommended route, and independent of {@link replaceSidebar}:
   *
   *  - It touches no other slot. `shell.overlay` is a `list`, so registering is
   *    purely additive and cannot collide with a shipped occupant.
   *  - The native sidebar is hidden with CSS on narrow screens only, rather
   *    than being replaced or disabled. Undoing the CSS restores the 56px rail
   *    with no drawer and no breakage, so this cannot brick the application.
   *
   * It does hide the shipped navigation rail, so it is still a visible change
   * to DSH's layout — but the failure mode is "the rail comes back", not
   * "nothing loads". See docs/overlay-drawer-step1.md.
   */
  drawerOverlay: true,
} as const

/** Timing for the splash, in milliseconds. */
export const SPLASH_TIMING = {
  /** Minimum visible time on a cold start before the fade starts. */
  minVisibleMs: 700,
  /**
   * Minimum visible time on a warm start (same browser session already showed
   * the splash). Refreshing or returning from a deep link should not pay the
   * full brand beat again.
   */
  minVisibleWarmMs: 120,
  /** Fade duration; must match the splash opacity transition. */
  fadeMs: 200,
  /**
   * Hard safety cap on a cold start. The splash always dismisses by this point
   * even if the readiness signal never arrives, so it can never trap the user.
   */
  maxVisibleMs: 4000,
  /** Cap on a warm start — short enough to feel like a blink, not a wait. */
  maxVisibleWarmMs: 900,
} as const
