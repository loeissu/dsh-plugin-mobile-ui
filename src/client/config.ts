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
  readonly drawerTitle: string
  readonly drawerHosts: string
  readonly drawerSessions: string
  readonly drawerClose: string
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
  drawerTitle: '导航',
  drawerHosts: '我的电脑',
  drawerSessions: '会话',
  drawerClose: '关闭',
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
  drawerTitle: 'Navigation',
  drawerHosts: 'My computers',
  drawerSessions: 'Sessions',
  drawerClose: 'Close',
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
} as const

/** Timing for the splash, in milliseconds. */
export const SPLASH_TIMING = {
  /** Minimum visible time before the fade starts. */
  minVisibleMs: 700,
  /** Fade duration; must match the `--dsh-mobile-splash-fade` transition. */
  fadeMs: 200,
  /**
   * Hard safety cap. The splash always dismisses by this point even if the
   * readiness signal never arrives, so it can never trap the user.
   */
  maxVisibleMs: 4000,
} as const
