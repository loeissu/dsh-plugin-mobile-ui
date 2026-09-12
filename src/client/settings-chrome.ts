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
import { injectStyles, R, TYPE } from './theme.ts'

const STYLE_ID = 'settings-chrome'
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
  [role="dialog"] [class*="_close"] {
    width: 32px !important;
    height: 32px !important;
    border-radius: ${R.sm} !important;
  }

  /* ── section nav ─────────────────────────────────────────────────── */
  [role="dialog"] [class*="_nav"] {
    padding: 8px 10px 0 !important;
    gap: 8px !important;
  }
  [role="dialog"] [class*="_navList"] {
    gap: 4px !important;
  }
  [role="dialog"] [class*="_navCell"] {
    padding: 6px 11px !important;
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
`

/**
 * Install host-settings mobile chrome. Inert on wide viewports.
 */
export function installSettingsChrome(): void {
  injectStyles(STYLE_ID, CSS)
}
