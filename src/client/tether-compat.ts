/**
 * Counter-rules for dsh-tether's over-broad injected selectors.
 *
 * ## Why this file exists
 *
 * dsh-tether injects a narrow-screen stylesheet into the served HTML
 * (`<style data-dsh-tether="narrow-screen">`, its rules inside
 * `@media (max-width: 640px)`). Two of those rules reach past the surface they
 * were written for. This file compensates so the UI stays usable meanwhile, and
 * `FEATURES.tetherCompat` exists so it can be deleted once tether is corrected.
 *
 * ---------------------------------------------------------------------------
 *
 * ## Case 1 — the queued-message row is squashed
 *
 * One tether rule is:
 *
 *   [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
 *
 * `_row` is a CSS-Module LOCAL name. tether documents that it matches on local
 * names deliberately, because only the hash prefix changes between builds — but
 * the same suffix appears in many DSH packages, so the rule reaches far beyond
 * the settings dialog it was written for. Measured: it matches 26 elements in the
 * shipped UI.
 *
 * ### What it breaks
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
 * ### Why the selector is this narrow
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
 * ---------------------------------------------------------------------------
 *
 * ## Case 2 — a dialog's title floats on top of its own body
 *
 * tether also restyles EVERY modal dialog for phones:
 *
 *   [role="dialog"][aria-modal="true"]:not([data-dsh-tether]) {
 *     width/height/max-width/max-height: 100% !important;
 *     margin: 0 !important; border-radius: 0 !important;
 *     display: flex !important; flex-direction: column !important;
 *   }
 *   ... > div > [class*="_header"] {
 *     position: absolute !important; top: 10px; right: 12px; left: auto !important;
 *   }
 *
 * The absolute header is written for the settings dialog, where the header it
 * targets is the nav strip. Applied to the risk-confirmation dialog — same
 * `aria-modal` primitive, but its header is «title + close button» with the body
 * directly beneath — the header leaves the flow while the body still starts at the
 * top of the card, so the title lands on top of the first paragraph. Measured at
 * 412×915 on DSH `0.1.5-rc.1` + tether `0.1.13`:
 *
 *                dialog            header              body top   title over body
 *   tether on    364×891 at y=12   absolute at y=22    32         yes
 *   tether off   364×282           static              389        no
 *
 * ### Why the selector is this narrow
 *
 * The counter-rule applies only to dialogs that
 *   - are modal,
 *   - have the `> div > _header` shape tether's rule targets, and
 *   - have NO nav strip, i.e. are not the settings dialog.
 *
 * The settings dialog keeps tether's full-screen phone treatment (verified: still
 * 412×915, radius 0, with its nav strip) — that treatment is what
 * `settings-chrome.ts` builds the mobile tab row on. For everything else the
 * shipped compact card is restored: width/height come back from the authored CSS,
 * `margin: auto` re-centres inside the fixed flex overlay, and the dialog's own
 * `_content` is `overflow-y: auto`, so long copy scrolls inside the card rather
 * than being clipped — checked with a deliberately over-long body at 412×915
 * (card capped at 867px, `_content` scrolled).
 *
 * ### Second symptom of the same rule: the confirm button is clipped
 *
 * tether's `> div { width: 100% !important; flex: 1 1 auto !important }` also hits
 * the dialog's action footer, which is authored as a `content-box` element with
 * `padding: 0 24px` and no width. `width: 100%` therefore sizes its CONTENT box
 * to the card's 340px and adds the padding on top, so the footer's border box
 * comes out at 388px inside a 340px card and the right-hand button is cut off:
 *
 *                 footer border box   confirm button        clipped
 *   tether on     388 (340 + 48)      x 264..400           yes
 *   tether off    340 (stretch)       x 216..352           no
 *
 * `box-sizing: border-box` on those wrapper divs makes tether's `100%` mean the
 * card width again. Scoped to the same non-settings dialogs as above.
 *
 * ---------------------------------------------------------------------------
 *
 * ## This is a workaround, not a fix
 *
 * Both defects are in tether: its selectors should be narrowed to the surfaces
 * they were written for. This file compensates so the UI is usable meanwhile.
 */
import { injectStyles, R } from './theme.ts'

/** Only narrow screens: tether's own rules live inside a max-width media query. */
const NARROW = '(max-width: 768px)'

const STYLE_ID = 'tether-compat'

/**
 * Restore the queue row's single-line layout (case 1).
 *
 * The selector intentionally mirrors tether's shape (`_row`, excluding
 * `rowText`) so it keeps matching if the hash prefix changes, and adds the dock
 * scope plus one more attribute so it out-specifies the original.
 */
const QUEUE_CSS = `
@media ${NARROW} {
  [data-slot="conversation.input.dock"] [class*="_row"]:not([class*="rowText"]) {
    flex-wrap: nowrap !important;
  }
}
`

/**
 * The dialogs tether's modal rules get wrong: modal, with the `> div > _header`
 * shape its absolute-header rule targets, and without a nav strip (so the
 * settings dialog — which wants the full-screen phone treatment — is excluded).
 */
const DIALOG_SEL = '[role="dialog"][aria-modal="true"]:not([data-dsh-tether])'
  + ':has(> div > [class*="_header"]):not(:has(nav [class*="_navCell"]))'

/**
 * Put the modal-dialog header back in flow and un-stretch the card (case 2).
 *
 * Mirrors tether's own media condition instead of {@link NARROW}: outside
 * `max-width: 640px` tether never touches these dialogs, so neither do we.
 * Specificity beats tether's rules comfortably (5 attributes + 3-4 elements
 * against 3 attributes), which is what lets `!important` lose.
 */
const DIALOG_CSS = `
@media (max-width: 640px) {
  ${DIALOG_SEL} {
    width: auto !important;
    max-width: calc(100% - 24px) !important;
    height: auto !important;
    max-height: calc(100% - 24px) !important;
    margin: auto !important;
    border-radius: ${R.xl} !important;
  }
  ${DIALOG_SEL} > div > [class*="_header"] {
    position: static !important;
    width: auto !important;
    height: auto !important;
    padding: 14px 12px 4px !important;
  }
  ${DIALOG_SEL} > div {
    box-sizing: border-box !important;
  }
}
`

/**
 * Install the counter-rules. Inert when tether is absent — the declarations then
 * match DSH's own values.
 */
export function installTetherCompat(): void {
  injectStyles(STYLE_ID, `${QUEUE_CSS}${DIALOG_CSS}`)
}
