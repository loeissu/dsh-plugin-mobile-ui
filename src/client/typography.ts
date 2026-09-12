/**
 * Base typography for every surface this plugin draws.
 *
 * The plugin's own sheets set sizes and weights through `theme.TYPE`, but text
 * RENDERING was left to whatever the host document does. On the Android shell
 * that leaves three visible defects:
 *
 *  1. **Font boosting.** Android WebView inflates text blocks it deems "body
 *     copy" on narrow viewports, by its own heuristic — so a 12px caption can
 *     render at 15px while the row next to it stays at 12px. `text-size-adjust:
 *     100%` opts this plugin's surfaces out; the host page's own text is
 *     untouched because the rule is scoped to `[data-dsh-mobile-ui]`.
 *  2. **Mixed numerals.** Times, ages and counts jitter horizontally as they
 *     tick, because proportional digits have different widths. Tabular
 *     figures fix that, but they belong to each surface's own sheet (they are
 *     per-element choices, not a rendering default) — this module only
 *     documents the convention.
 *  3. **Inherited line rhythm.** Surfaces that do not declare a line-height
 *     used to inherit the host's, which differs between the conversation
 *     (markdown-tuned) and the settings dialog. A 1.5 floor on the plugin
 *     roots gives CJK copy enough air without touching the steps that set
 *     their own.
 *
 * The font FAMILY is deliberately not overridden: DSH projects its brand face
 * onto `body`, and the plugin inherits it. Forcing a stack here would make the
 * drawer and settings render in a different face than the surrounding app.
 *
 * Scope: the sheet only matches roots this plugin renders — every one carries
 * `data-dsh-mobile-ui`. Host text outside those roots is untouched.
 */
import { injectStyles } from './theme.ts'

const STYLE_ID = 'typography'

const CSS = `
/* Root + every descendant, not just the root: text-size-adjust and the
   smoothing properties are not reliably inherited across engines, and font
   boosting targets descendant text blocks — a root-only rule can miss them. */
/* NOTE: no backticks anywhere inside this template string — they terminate it
   and the parser error points at the next line. This trap is documented in
   STATUS.md 4.8 and has now bitten three times (twice before this file
   existed, once in its own first draft). This comment exists so there is no
   fourth. */
[data-dsh-mobile-ui],
[data-dsh-mobile-ui] * {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  /* Both prefixed and standard: Android WebView reads the prefixed one. */
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  /* Line-rhythm floor. Every TYPE step that needs tighter air sets its own. */
  line-height: 1.5;
  /* The plugin's rows and buttons style :active themselves; the stock gray
     flash on touch devices fights it. */
  -webkit-tap-highlight-color: transparent;
}
`

/**
 * Install the shared typography sheet. Idempotent; call once at plugin apply.
 */
export function installTypography(): void {
  injectStyles(STYLE_ID, CSS)
}
