/**
 * Theme tokens for the mobile UI surfaces.
 *
 * Every color, font and border this plugin draws comes from a DSH semantic
 * alias (`--dsw-alias-*`). No palette value is copied into this file, which is
 * the rule stated in DSH's `docs/web-styling.md`:
 *
 *   "Use `--dsw-alias-*` semantic tokens in feature components. Do not copy
 *    static palette values or write literal colors there."
 *
 * Two traps this module exists to avoid, both verified against DSH source:
 *
 *  1. `--dsw-alias-brand-primary` is NOT the blue accent — it resolves to
 *     near-black in light mode and near-white in dark mode. The platform says
 *     so itself (`ui-dockkit/README.md`): "Emphasis takes the platform's
 *     accent, never `--dsw-alias-brand-primary`." The blue is
 *     {@link TOKEN.accent}.
 *  2. The code font is `--ds-font-family-code`, not `--dsw-font-mono`.
 *     `--dsw-font-mono` is referenced by five of DSH's own stylesheets but is
 *     defined nowhere, so it resolves to the guaranteed-invalid value.
 *
 * Fallbacks chain to DSH's OWN boot tokens (`--dsh-boot-*`), which the shipped
 * web frontend defines on the boot surface. That keeps the whole chain inside
 * DSH's token vocabulary even before the theme presenter has written its
 * variables onto `body` — no invented colors.
 */

/** DSH semantic alias tokens consumed by this plugin. */
export const TOKEN = {
  /** Page background. */
  bg: '--dsw-alias-bg-base',
  /** Raised surface (cards, sheets, the drawer). */
  surface: '--dsw-alias-bg-layer-1',
  /** Hover / pressed overlay. Translucent, not an opaque fill. */
  hover: '--dsw-alias-interactive-bg-hover',
  active: '--dsw-alias-interactive-bg-active',
  /** Hairline separators. Neutral borders draw at 0.5px. */
  border: '--dsw-alias-border-l2',
  /** Text ramp. */
  text: '--dsw-alias-label-primary',
  textDim: '--dsw-alias-label-secondary',
  textFaint: '--dsw-alias-label-tertiary',
  /** The real blue accent — NOT `--dsw-alias-brand-primary`. */
  accent: '--dsw-alias-brand-primary-new-colorprimary-new-color',
  /** Code / monospace face. */
  mono: '--ds-font-family-code',
  /** Fenced-code fill. DSH's own token, so tool output matches host code fences. */
  codeBlock: '--dsw-alias-markdown-code-block',
  /** Motion. Note the `--ds-` prefix, not `--dsw-`. */
  duration: '--ds-transition-duration',
  ease: '--ds-ease-in-out',
} as const

/**
 * DSH's boot-surface fallbacks. Defined by the shipped web frontend on the
 * boot card, so they exist even before the theme presenter runs.
 */
const BOOT = {
  bg: '--dsh-boot-bg',
  text: '--dsh-boot-label-primary',
  textDim: '--dsh-boot-label-secondary',
  textFaint: '--dsh-boot-label-tertiary',
  border: '--dsh-boot-border',
} as const

/**
 * Build a `var()` chain that prefers a semantic token and falls back to a
 * boot token. Both levels are DSH-owned, so no literal color enters the sheet.
 * @param primary - semantic alias token name.
 * @param fallback - boot token name used when the alias is absent.
 * @returns a CSS `var()` expression, optionally with a trailing literal.
 */
export function themeVar(primary: string, fallback?: string): string {
  return fallback === undefined ? `var(${primary})` : `var(${primary}, var(${fallback}))`
}

/** The `--dsw-alias-*` / `--dsh-boot-*` pairs the surfaces use. */
export const V = {
  bg: themeVar(TOKEN.bg, BOOT.bg),
  surface: themeVar(TOKEN.surface, BOOT.bg),
  hover: themeVar(TOKEN.hover, BOOT.border),
  active: themeVar(TOKEN.active, BOOT.border),
  border: themeVar(TOKEN.border, BOOT.border),
  text: themeVar(TOKEN.text, BOOT.text),
  textDim: themeVar(TOKEN.textDim, BOOT.textDim),
  textFaint: themeVar(TOKEN.textFaint, BOOT.textFaint),
  accent: `var(${TOKEN.accent}, var(${TOKEN.text}))`,
  // Fallback chain matters: if the code-face token is absent (older host or a
  // trimmed build) the raw var() resolves to the guaranteed-invalid value and
  // text falls back to the browser default serif-flavored monospace.
  mono: `var(${TOKEN.mono}, ui-monospace, 'Cascadia Mono', 'Roboto Mono', monospace)`,
  // Host code fences use a tinted fill in both palettes (bg-base == bg-layer-1
  // == #fff in light mode, so `bg` would leave the <pre> flush with the card).
  codeBlock: themeVar(TOKEN.codeBlock, BOOT.bg),
} as const

/**
 * The accent at low alpha. DSH has no `*-soft` token; the sanctioned
 * expression is a `color-mix()` against the accent itself (precedent:
 * `ui-dockkit/src/components/dockkit.module.css`, which mixes 8%).
 * @param percent - accent share of the mix.
 * @returns a `color-mix()` expression.
 */
export function accentSoft(percent = 8): string {
  return `color-mix(in srgb, ${V.accent} ${percent}%, transparent)`
}

/**
 * Type scale for every mobile surface this plugin draws.
 *
 * Six steps only — enough for overline → caption → body → display without
 * the 11.5 / 12.5 / 13.3 drift that made the drawer and settings feel noisy.
 * Pair each step with a label ramp in `V` (primary / dim / faint).
 */
export const TYPE = {
  /** Overlines, time buckets, section labels. */
  micro: '11px',
  /** Ages, counts, footnotes, tool body. */
  caption: '12px',
  /** Secondary rows, tool titles, settings controls. */
  bodySm: '13px',
  /** Primary list rows and body copy. */
  body: '14px',
  /** Emphasized titles (drawer head, splash tagline lockup). */
  bodyLg: '15px',
  /** Splash product name. */
  display: '19px',
} as const

/**
 * Line height paired with each {@link TYPE} step.
 *
 * These exist because the same step used to carry different rhythms in different
 * components — measured before: 12px appeared with line-heights of 18 / 19.8 /
 * 20px, 14px with 20.3 / 21px, and 11px overlines inherited the global 1.5 floor
 * (16.5px) instead of a deliberate 16px. Pairing the two makes the ramp a ramp.
 *
 * `code` is deliberately looser than `caption`: tool output is read line by line,
 * and mono glyphs need more air than UI copy at the same size.
 */
export const TYPE_LH = {
  micro: '16px',
  caption: '18px',
  bodySm: '18px',
  body: '21px',
  bodyLg: '22px',
  display: '28px',
  /** 12px monospace (tool output, inline code). */
  code: '20px',
} as const

/**
 * Corner-radius scale. DSH publishes no radius tokens, so these stay numeric
 * — but they are shared so a card and its inner chip never disagree.
 */
export const R = {
  /** Inline chips, tool detail pills. */
  xs: '5px',
  /** Compact badges and counts. */
  sm: '9px',
  /** Icon buttons, settings rows, list affordances. */
  md: '12px',
  /** Tool cards, foot buttons. */
  lg: '14px',
  /** Settings cards. */
  xl: '16px',
  /** Drawer panel end-cap. */
  panel: '30px',
  /** Fully round (dots, knobs). */
  pill: '999px',
} as const

/**
 * "This is a phone" as a media condition, landscape included.
 *
 * Width alone fails the moment the phone is turned sideways: a 915x412 phone is
 * wider than the 768px gate, so every mobile surface silently switched off (the
 * drawer, the touch hit layers, the settings density) and the app fell back to the
 * desktop layout. Height closes that gap — a phone on its side is short — and the
 * coarse-pointer guard keeps short *desktop* windows out of the landscape branch,
 * so only a touch device is treated as a phone that way.
 *
 * Measured: 412x915 matches on width, 915x412 matches on height + coarse (with
 * touch emulation on, `(pointer: coarse)` flips exactly as it does on a device),
 * and a 1600x500 desktop window matches neither.
 */
export const PHONE_MEDIA = '(max-width: 768px), (max-height: 520px) and (pointer: coarse)'

/**
 * Spacing scale for the surfaces this plugin draws.
 *
 * Shared so a card and its inner chip cannot disagree about the gutter, and so
 * "11px here, 13px there" stops creeping in. `rowY` is named rather than scaled:
 * it is what makes a 44px row out of a 21px line (11 + 21 + 12), so rounding it
 * to the scale would move every list row.
 *
 * Adoption is opportunistic — new and edited rules use these; untouched rules
 * keep their literals until something else needs to change them.
 */
export const SPACE = {
  /** Hairline separation inside a control. */
  xs: '4px',
  /** Chip / badge padding. */
  sm: '6px',
  /** Between related controls. */
  md: '8px',
  /** Row inset. */
  lg: '12px',
  /** Card inset. */
  xl: '16px',
  /** Between groups. */
  xxl: '20px',
  /** Vertical padding that completes a 44px row. */
  rowY: '11px',
} as const

/**
 * Stacking order for the plugin's layers.
 *
 * These used to be bare literals spread across three files with the ordering
 * documented only in comments. The sheet and splash values are near the top of
 * the 32-bit range on purpose: the drawer has to sit above the host's dialogs,
 * which it cannot know in advance.
 */
export const Z = {
  /** Boot splash — above everything, including the drawer. */
  splash: '2147483000',
  /** Drawer overlay. */
  sheet: '2147482000',
  /** Diagnostic badge: below the drawer so it cannot cover the trigger. */
  debug: '2147481000',
  /** Header-adjacent controls inside the host chrome (the 导航 tab). */
  local: '2',
  /** Sticky section labels inside a scroller. */
  sticky: '1',
} as const

/** Shared motion tokens for surfaces that animate. */
export const MOTION = {
  /** Default surface transition (scrim, switch). */
  base: '200ms',
  /** Drawer slide — slightly slower so it reads as a sheet, not a jump. */
  sheet: '220ms',
  /** Tool-card expand. Matches the host's own base step; see ToolCard. */
  expand: '200ms',
  /** Spinner rotation. Linear, and long enough to read as "working". */
  spin: '900ms',
  /** Status-dot pulse. */
  pulse: '1200ms',
  ease: 'cubic-bezier(.4, 0, .2, 1)',
} as const

/** Ids of the style tags this plugin owns. */
const OWNED_STYLES = new Set<string>()

/**
 * Inject one stylesheet once per document.
 *
 * Each sheet is tagged with `data-plugin` so a host-side teardown (or the HMR
 * driver) can find and remove exactly what this plugin added.
 * @param id - stable sheet id, unique within the plugin.
 * @param css - stylesheet text.
 */
export function injectStyles(id: string, css: string): void {
  if (typeof document === 'undefined') return
  const tagId = `dsh-mobile-ui/${id}`
  // Ownership is judged by the DOCUMENT, not by this Set: if the host (or an HMR
  // teardown) removed the tag, re-installing must put it back. Trusting the Set
  // alone made a re-install silently skip the sheet, leaving the plugin running
  // with none of its own CSS — the failure mode is "unstyled, no error".
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) {
    OWNED_STYLES.add(tagId)
    return
  }
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-plugin-mobile-ui'
  tag.dataset.pluginCss = tagId
  tag.textContent = css
  document.head.append(tag)
  OWNED_STYLES.add(tagId)
}

/**
 * Whether DSH is currently rendering its dark palette.
 *
 * The theme presenter sets a `data-ds-dark-theme` attribute on `body`. A
 * plugin cannot branch on this in CSS reliably across host versions, so the
 * components read it here when a value must differ structurally.
 * @returns true when the dark palette is active.
 */
export function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false
  return document.body.hasAttribute('data-ds-dark-theme')
}

/**
 * Watch the host theme and call back on every change.
 * @param onChange - receives the new dark-mode state; invoked once immediately.
 * @returns an unsubscribe function.
 */
export function observeTheme(onChange: (dark: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {}
  onChange(isDarkTheme())
  const observer = new MutationObserver(() => { onChange(isDarkTheme()) })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => { observer.disconnect() }
}
