/**
 * Settings page, registered into `settings.section`.
 *
 * `settings.section` is a `list`/`root` slot: registering adds one page beside
 * the shipped ones and cannot remove anything. That is why this is enabled by
 * default — it is purely additive and reversible.
 *
 * Registrant options carry the nav identity: `id` (section key, drives `only`
 * filtering), `order` (nav position) and `label` (registrant-localized display
 * text). The owner share supplies exactly one affordance, `close`.
 *
 * The label is supplied from `config.ts` rather than through
 * `ctx.locale.register()`. DSH's `verify-client-ui-i18n` gate enforces the
 * locale-dictionary path inside the DSH repository; for a third-party plugin
 * the copy lives in one module and is selected by document language. Wiring it
 * through `ctx.locale` is tracked in README.md.
 */
import { useEffect, useState } from 'react'
import { FEATURES, t } from './config.ts'
import { replaySplash, setSplashStatus } from './Splash.tsx'
import { accentSoft, injectStyles, isDarkTheme, MOTION, observeTheme, R, SPACE, TOKEN, TYPE, TYPE_LH, V } from './theme.ts'

const STYLE_ID = 'settings'

const CSS = `
.dsh-mobile-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-size: ${TYPE.body};
  color: ${V.text};
}

.dsh-mobile-settings__heading {
  font-size: ${TYPE.micro};
  line-height: ${TYPE_LH.micro};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 600;
  color: ${V.textFaint};
  margin-bottom: 10px;
}

.dsh-mobile-settings__card {
  background: ${V.surface};
  border: 0.5px solid ${V.border};
  border-radius: ${R.xl};
  overflow: hidden;
}

.dsh-mobile-settings__row {
  display: flex;
  align-items: center;
  gap: 12px;
  /* >=44px keeps every row inside the touch target minimum. */
  min-height: 44px;
  padding: ${SPACE.rowY} 14px;
  border-bottom: 0.5px solid ${V.border};
}

.dsh-mobile-settings__row:last-child { border-bottom: 0; }

.dsh-mobile-settings__label {
  flex: 1;
  min-width: 0;
  font-size: ${TYPE.body};
  line-height: ${TYPE_LH.body};
}

.dsh-mobile-settings__value {
  font-size: ${TYPE.bodySm};
  line-height: ${TYPE_LH.bodySm};
  /* textDim, not textFaint: at 13px the faint ramp is 3.71:1 on the light
     surface, below WCAG AA 4.5:1. The faint ramp stays on 11px overlines. */
  color: ${V.textDim};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dsh-mobile-settings__value--mono { font-family: ${V.mono}; }

/* 42x25 track with a 20px knob, matching the mobile switch geometry DSH uses
   for its own settings rows. */
.dsh-mobile-settings__switch {
  flex: none;
  width: 42px;
  height: 25px;
  border-radius: ${R.pill};
  corner-shape: round;
  border: 0;
  padding: 0;
  background: ${V.border};
  position: relative;
  cursor: pointer;
  transition: background ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
}

.dsh-mobile-settings__switch[data-on='true'] { background: ${V.accent}; }

.dsh-mobile-settings__switch::after {
  content: '';
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 20px;
  height: 20px;
  border-radius: ${R.pill};
  corner-shape: round;
  background: ${V.bg};
  transition: transform ${MOTION.sheet} ${MOTION.ease};
}

.dsh-mobile-settings__switch[data-on='true']::after { transform: translateX(17px); }

.dsh-mobile-settings__action {
  flex: none;
  font: inherit;
  font-size: ${TYPE.caption};
  line-height: ${TYPE_LH.caption};
  font-weight: 500;
  /* R.md + 36px: it used to be R.lg (14px) on a ~28px control, which reads as a
     pill rather than the 12/16px corner the cards around it use, and sat well
     under the touch minimum. The painted control stops at 36px — the row it sits in
     is 44px tall, so growing the box itself would push the row — and the hit area
     is completed by the pseudo-element below. */
  min-height: 36px;
  padding: ${SPACE.sm} ${SPACE.lg};
  border-radius: ${R.md};
  border: 0.5px solid ${V.border};
  background: transparent;
  color: inherit;
  cursor: pointer;
  position: relative;
  transition: background ${MOTION.base} var(${TOKEN.ease}, ${MOTION.ease});
}
/* 36 + 2x4 = 44: this is the plugin's own control, so it does not get to be the
   one that misses the target the rest of the plugin enforces. */
.dsh-mobile-settings__action::after {
  content: '';
  position: absolute;
  inset: -4px -2px;
}

.dsh-mobile-settings__action:active { background: ${V.active}; }

.dsh-mobile-settings__swatch {
  flex: none;
  display: flex;
  gap: 6px;
}

.dsh-mobile-settings__chip {
  width: 14px;
  height: 14px;
  border-radius: ${R.pill};
  corner-shape: round;
  border: 0.5px solid ${V.border};
}

.dsh-mobile-settings__note {
  font-size: ${TYPE.caption};
  line-height: ${TYPE_LH.caption};
  /* Same reason as __value: 12px on the faint ramp fails AA in light mode. */
  color: ${V.textDim};
  padding: 0 4px;
  /* Avoids a lone dangling character on the last wrapped line, which CJK
     footnotes produce easily at this measure. */
  text-wrap: pretty;
}

.dsh-mobile-settings__accent { color: ${V.accent}; }

@media (prefers-reduced-motion: reduce) {
  .dsh-mobile-settings__switch,
  .dsh-mobile-settings__switch::after { transition: none; }
}
`

/** Owner share of a settings section entry. */
export interface SettingsSectionProps {
  /** Close the settings panel (the shell owns the open state). */
  readonly close: () => void
}

/** Nav identity for this section, read by the settings shell. */
export const SECTION_OPTIONS = {
  name: 'settings.section',
  id: 'mobile-ui',
  order: 60,
  label: t.settingsLabel,
} as const

/**
 * One settings page for the mobile surfaces.
 * @param _props - the owner share; only `close` is supplied and it is unused
 * here because no row navigates away from settings.
 * @returns the section body.
 */
export function SettingsSection(_props: SettingsSectionProps) {
  injectStyles(STYLE_ID, CSS)

  const [dark, setDark] = useState<boolean>(() => isDarkTheme())

  useEffect(() => observeTheme(setDark), [])

  return (
    <div className="dsh-mobile-settings" data-dsh-mobile-ui="settings">
      <section>
        <div className="dsh-mobile-settings__heading">{t.settingsHeading}</div>
        <div className="dsh-mobile-settings__card">
          <div className="dsh-mobile-settings__row">
            <span className="dsh-mobile-settings__label">{t.settingsVersion}</span>
            <span className="dsh-mobile-settings__value dsh-mobile-settings__value--mono">
              {PLUGIN_VERSION}
            </span>
          </div>

          <div className="dsh-mobile-settings__row">
            <span className="dsh-mobile-settings__label">{t.settingsFollowSystem}</span>
            <span className="dsh-mobile-settings__swatch" aria-hidden="true">
              <span className="dsh-mobile-settings__chip" style={{ background: V.bg }} />
              <span className="dsh-mobile-settings__chip" style={{ background: V.surface }} />
              <span className="dsh-mobile-settings__chip" style={{ background: accentSoft(60) }} />
            </span>
            <span className="dsh-mobile-settings__value">
              {dark ? t.themeDark : t.themeLight}
            </span>
          </div>

          {/* Reflects the build-time list; there is no host write path yet, so
              this row reports the effective configuration rather than toggling
              it. See README.md "Known limitations". */}
          <div className="dsh-mobile-settings__row">
            <span className="dsh-mobile-settings__label">{t.settingsToolCards}</span>
            <span className="dsh-mobile-settings__value">
              {FEATURES.toolCards.length === 0 ? '—' : `${FEATURES.toolCards.length}`}
            </span>
          </div>

          <div className="dsh-mobile-settings__row">
            <span className="dsh-mobile-settings__label">{t.settingsResetSplash}</span>
            <button
              type="button"
              className="dsh-mobile-settings__action"
              onClick={() => {
                // The splash is on screen for about a second at boot, so it is
                // easy to miss; this raises it again on demand. It previously
                // called dismissSplash(), which is the opposite of a replay.
                setSplashStatus(t.splashPreparing)
                replaySplash()
              }}
            >
              {t.settingsReplay}
            </button>
          </div>
        </div>
      </section>

      <p className="dsh-mobile-settings__note">{t.settingsFootnote}</p>
    </div>
  )
}

/** Build-time plugin version, stamped by the bundler define. */
declare const PLUGIN_VERSION: string
