/**
 * Counter-rules for dsh-tether's over-broad injected selectors.
 *
 * ## Why this file exists
 *
 * dsh-tether rewrites the served HTML and injects a narrow-screen stylesheet. One
 * of its rules is:
 *
 *   [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
 *
 * `_row` is a CSS-Module LOCAL name. tether documents that it matches on local
 * names deliberately, because only the hash prefix changes between builds — but
 * the same suffix appears in many DSH packages, so the rule reaches far beyond
 * the settings dialog it was written for. Measured: it matches 26 elements in the
 * shipped UI.
 *
 * ## What it breaks
 *
 * The queued-message row in the composer (`_7yHdaG_row`) is laid out as a single
 * line by DSH: three children — the text and two action buttons — side by side.
 * Forced to wrap, they stack into three lines wanting 86px, while the scrolling
 * parent is fixed at 36px with `overflow: auto`. The row is clipped to a sliver,
 * which is how it reaches the user: a queued message reduced to a thin strip.
 *
 * Confirmed by A/B, toggling only tether's stylesheet:
 *
 *              flex-wrap   child tops          content  box  clipped
 *   with       wrap        756, 780, 810       86       36   yes
 *   without    nowrap      763, 760, 756       36       36   no
 *
 * ## Why the selector is this narrow
 *
 * A blanket counter-rule would be wrong. The composer contains a second `_row`
 * (`uV2eYG_row`, the permission/model line) which is `wrap` BOTH with and without
 * tether — DSH intends wrapping there, and forcing `nowrap` would break it.
 * Verified by the same A/B: only the queue row changes.
 *
 * So the counter-rule is scoped to the queue dock. Specificity also beats tether
 * rather than relying on injection order: this selector scores (0,3,0) against
 * tether's (0,2,0), so it wins even though both are `!important`.
 *
 * ## This is a workaround, not a fix
 *
 * The defect is in tether: its selector should be narrowed to the settings dialog
 * it was written for. This file compensates so the UI is usable meanwhile, and
 * `FEATURES.tetherCompat` exists so it can be deleted once tether is corrected.
 */
import { injectStyles } from './theme.ts'

/** Only narrow screens: tether's own rule lives inside a max-width media query. */
const NARROW = '(max-width: 768px)'

const STYLE_ID = 'tether-compat'

/**
 * Restore the queue row's single-line layout.
 *
 * The selector intentionally mirrors tether's shape (`_row`, excluding
 * `rowText`) so it keeps matching if the hash prefix changes, and adds the dock
 * scope plus one more attribute so it out-specifies the original.
 */
const CSS = `
@media ${NARROW} {
  [data-slot="conversation.input.dock"] [class*="_row"]:not([class*="rowText"]) {
    flex-wrap: nowrap !important;
  }
}
`

/**
 * Install the counter-rules. Inert when tether is absent — the declarations then
 * match DSH's own values.
 */
export function installTetherCompat(): void {
  injectStyles(STYLE_ID, CSS)
}
