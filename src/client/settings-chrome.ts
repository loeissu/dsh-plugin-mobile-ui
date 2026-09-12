/**
 * Mobile polish for the host settings dialog (and hide the drawer trigger
 * while that modal is up so it does not sit on the title).
 *
 * Type ramp (matches theme.TYPE):
 *   15px  modal title
 *   13px  nav labels, section titles, selectors, theme cubes
 *   12px  descriptions, secondary actions
 *
 * Layout notes:
 *  - `_row` and `_rowText` BOTH carry 12px vertical padding, so a single
 *    setting stacked to ~137px. Zero the inner pad; keep the outer.
 *  - Theme cubes are full-width blocks on phones even though `cubeRow` is
 *    flex-row — force a three-up strip.
 */
import { injectStyles, PHONE_MEDIA, R, TYPE } from './theme.ts'

const STYLE_ID = 'settings-chrome'

/** The phone *density* applies to the narrow (portrait) layout only. */
const NARROW = '(max-width: 768px)'

/**
 * Class hashes rotate per DSH build. Match stable local-name suffixes only,
 * and scope everything under [role="dialog"] so conversation rows that also
 * end in _row stay untouched.
 */
const CSS = `
@media ${NARROW} {
  /* Header "导航" tab would sit over the modal title. */
  body:has([role="dialog"] [class*="_navCell"]) .dsh-mobile-nav-tab {
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* ── chrome / header ─────────────────────────────────────────────── */
  [role="dialog"] [class*="_header"] {
    padding: 14px 12px 6px !important;
    gap: 8px !important;
  }
  [role="dialog"] [class*="_header"] h1,
  [role="dialog"] [class*="_header"] h2,
  [role="dialog"] [class*="_header"] [class*="_title"],
  [role="dialog"] [class*="_navTitle"] {
    font-size: ${TYPE.bodyLg} !important;
    font-weight: 600 !important;
    line-height: 22px !important;
  }
  /* Give the title row the height its own controls need.
   *
   * Measured: the row is 22px tall while it holds a 32px close button and a 28px
   * 打开配置文件 button, so both overflow ~18px below it. On desktop that is
   * invisible — the nav is a left-hand column with nothing underneath. On a phone
   * tether turns the nav into a horizontal strip directly below, so the two buttons
   * land ON the tab strip: the × covered the selected 移动端 pill in the reported
   * screenshot. Fixing the row's height is the honest fix; shrinking the controls
   * again would take the close button under the touch minimum. */
  [role="dialog"] [class*="_navTitle"] {
    min-height: 44px !important;
    align-items: center !important;
  }
  [role="dialog"] [class*="_close"] {
    width: 32px !important;
    height: 32px !important;
    border-radius: ${R.sm} !important;
  }

  /* ── section nav ─────────────────────────────────────────────────── */
  /* '> nav', NOT [class*="_nav"]: the suffix _nav is a PREFIX of four other
     local names in this dialog (_navList, _navCell, _navLabel, _navTitle), so
     the prefix form also pushed 8px of vertical padding and 10px of side padding
     onto the list and onto every individual label.
     Measured before the fix: _navList and _navLabel both carried
     'padding: 8px 10px 0' from this rule. */
  [role="dialog"] > nav {
    padding: 8px 10px 0 !important;
    gap: 8px !important;
  }
  /* Five tabs have to fit 392px without horizontal scrolling.
   *
   * Measured at 412: the authored spacing wants 453px for the five cells, so the
   * strip scrolls and — because the selected tab is scrolled into view — the FIRST
   * one is clipped: 通用设置 rendered as 设置 in the reported screenshot. The
   * reclaimed 68px comes from spacing only, never from type size or content:
   * cell padding 11 -> 7px (-40), the icon/label gap 8 -> 4px (-20), and the list
   * gap 4 -> 2px (-8). Measured after: 385px of 392, so the row is complete and
   * still, with 13px labels and the 16px icons untouched. */
  [role="dialog"] [class*="_navList"] {
    gap: 2px !important;
  }
  [role="dialog"] [class*="_navCell"] {
    padding: 6px 7px !important;
    gap: 4px !important;
    min-height: 32px !important;
    border-radius: ${R.md} !important;
  }
  [role="dialog"] [class*="_navLabel"] {
    font-size: ${TYPE.bodySm} !important;
    line-height: 18px !important;
  }

  /* ── content ─────────────────────────────────────────────────────── */
  [role="dialog"] [class*="_options"] {
    padding: 0 14px 24px !important;
  }

  /* Kill the double vertical pad: outer _row keeps 10px, inner _rowText 0. */
  [role="dialog"] [class*="_row"] {
    padding: 10px 0 !important;
    gap: 4px !important;
  }
  [role="dialog"] [class*="_rowText"] {
    padding: 0 !important;
    gap: 2px !important;
  }

  [role="dialog"] [class*="_title"] {
    font-size: ${TYPE.bodySm} !important;
    line-height: 20px !important;
    font-weight: 500 !important;
  }
  [role="dialog"] [class*="_desc"] {
    font-size: ${TYPE.caption} !important;
    line-height: 18px !important;
  }

  /* Selectors / value controls (语言, 权限, 紧凑, 排队发送, 字号 …). */
  [role="dialog"] [class*="_selector"],
  [role="dialog"] [class*="_value"],
  [role="dialog"] [class*="_unit"] {
    font-size: ${TYPE.bodySm} !important;
    line-height: 20px !important;
    /* Steppers and counters stop jittering as their digits change. */
    font-variant-numeric: tabular-nums !important;
  }
  [role="dialog"] [class*="_selector"] {
    min-height: 32px !important;
    padding: 0 12px !important;
    border-radius: ${R.md} !important;
  }

  /* Theme picker: three-up strip instead of stacked full-width cards. */
  [role="dialog"] [class*="_cubeRow"] {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: nowrap !important;
    gap: 8px !important;
    width: 100% !important;
  }
  [role="dialog"] [class*="_themeCube"] {
    flex: 1 1 0 !important;
    min-width: 0 !important;
    width: auto !important;
    max-width: none !important;
    padding: 10px 6px !important;
    min-height: 56px !important;
    border-radius: ${R.md} !important;
    gap: 2px !important;
    font-size: ${TYPE.bodySm} !important;
    line-height: 18px !important;
  }
  [role="dialog"] [class*="_themeCube"] svg,
  [role="dialog"] [class*="_themeCube"] [class*="_icon"] {
    width: 18px !important;
    height: 18px !important;
  }
}

/*
 * The touch layer, for phones in EITHER orientation.
 *
 * A phone on its side keeps the desktop dialog shape (the density block above is
 * narrow-only, and tether's own strip rules stop at 640px), but its controls are
 * still finger-sized needs: the close button is the only way out of the dialog, so
 * it keeps a 44px hit area whenever the pointer is coarse, portrait or not. The
 * 32px visual is unchanged and nothing moves.
 */
@media ${PHONE_MEDIA} {
  [role="dialog"] [class*="_close"] {
    position: relative !important;
  }
  [role="dialog"] [class*="_close"]::after {
    content: '';
    position: absolute;
    /* -8px: the desktop dialog's close is 28px, and the pixel walk measures a
       nominal box one pixel short, so this lands at 43 — as close to the 44px
       target as the header row allows. */
    inset: -8px;
  }
  /* Section tabs are 32px tall in the desktop dialog: enough for a mouse, not for
     a thumb, so they get the same treatment without changing their size. */
  [role="dialog"] [class*="_navCell"] {
    position: relative !important;
  }
  [role="dialog"] [class*="_navCell"]::after {
    content: '';
    position: absolute;
    inset: -4px -2px;
  }
}
`

/**
 * Install host-settings mobile chrome. Inert on wide viewports.
 */
export function installSettingsChrome(): void {
  injectStyles(STYLE_ID, CSS)
}
