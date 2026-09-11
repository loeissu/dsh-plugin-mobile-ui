# DSH Web UI Design-Token Mapping Report

**Source of record:** `H:\DSH\_work\src\deepseek-harness-master`
**Token authority:** `packages/client/ui-theme/src/styles/` (six sheets)
**Status:** every DSH token cited below was read from source; file paths + line numbers given. Nothing here is inferred from naming alone. Where a faithful equivalent does not exist, that is stated explicitly.

---

## 0. Executive summary for the plugin author

1. **Do not hardcode the prototype palette.** DSH's own dark palette is *neutral* (`#151517`-family), not the prototype's blue-tinted `#0B0D10`/`#14171C`. The mapping below is **semantic, not chromatic** — you get DSH's theming behaviour, not the prototype's exact hues.
2. **Consume `--dsw-alias-*` custom properties in CSS.** They are declared on `body` and inherited, so a plugin's CSS Modules can read them with plain `var()` — no JS, no context, no theme state.
3. **A feature plugin must not register its own global theme.** Confirmed and quoted in §3.2.
4. **Two things you cannot get from tokens:** a radius scale (DSH has **no** radius tokens at all) and colors for the prototype's `--accent-soft`. Both are treated in the table and in §4.
5. **There is no `--dsw-font-mono` token**, even though five package stylesheets reference it. The real code-font variable is `--ds-font-family-code` (§2.5).

---

## 1. Mapping table

Read the **light / dark** columns as the *resolved* value of the DSH token in each scheme. DSH expresses most values as a second indirection through `--dsw-static-*`; both hops are given for the color rows.

### 1.1 Backgrounds and surfaces

| prototype token | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| `--bg` `#0B0D10` (page background) | `--dsw-alias-bg-base` | `var(--dsw-static-neutral-bluish-00)` = `#FFFFFF` | `var(--dsw-static-neutral-bluish-950)` = `rgb(21,21,23)` `#151517` | `design-platform.css:157` (light), `:250` (dark). Consumed as the frame background at `ui-layout/src/client/AppFrame.module.css:7`. Hue mismatch: DSH dark base is neutral grey, not blue-black. |
| `--surface` `#14171C` (cards / drawer) | `--dsw-alias-bg-layer-1` | `var(--dsw-static-neutral-bluish-00)` = `#FFFFFF` | `var(--dsw-static-neutral-bluish-875)` = `rgb(35,35,36)` `#232324` | `design-platform.css:158` (light), `:251` (dark). **The light value is identical to `bg-base`** — in light mode DSH does *not* separate a card from the page by fill; separation comes from the 0.5px border / elevation shadow (§3.3). |
| `--surface-2` `#1A1E24` (hover / active) | `--dsw-alias-interactive-bg-hover` (hover) and `--dsw-alias-interactive-bg-active` (pressed) | hover `rgba(38,49,72,0.06)`; active `rgba(38,49,72,0.1)` | hover `rgba(255,255,255,0.08)`; active `rgba(255,255,255,0.14)` | `design-platform.css:200`/`:196` (light), `:293`/`:289` (dark). **These are translucent overlays, not opaque fills** — DSH's deliberate design so hover holds on any elevation (Agent Note `.agents/notes/implemented/process/2026-07-19-web-styling-system.md:22`). Closest opaque alternative: `--dsw-alias-bg-layer-2` (`design-platform.css:159`/`:252`, light `#FFFFFF`, dark `--dsw-static-neutral-bluish-850` = `rgb(44,44,46)`). |

### 1.2 Borders and dividers

| prototype token | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| `--border` `#232830` (dividers) | `--dsw-alias-border-l2` | `rgba(0, 0, 0, 0.1)` | `rgba(255, 255, 255, 0.12)` | `design-platform.css:174` (light), `:267` (dark). **Must be drawn at `0.5px`, not 1px** (§3.3). Translucent, not opaque — it composites over whatever surface it sits on. |
| *(stronger divider)* | `--dsw-alias-border-l3` | `rgba(0, 0, 0, 0.12)` | `rgba(255, 255, 255, 0.16)` | `design-platform.css:175`/`:268`. Used for the sidebar column seam (`AppFrame.module.css:29`). |
| *(weakest divider)* | `--dsw-alias-border-l1` | `rgba(0, 0, 0, 0.04)` | `rgba(255, 255, 255, 0.06)` | `design-platform.css:172`/`:265`. Also the default elevation stroke color for menus. |
| *(dark-mode-only thin variant)* | `--dsw-alias-border-l2-darkmode-thin` | `rgba(0, 0, 0, 0.1)` | `rgba(255, 255, 255, 0.06)` | `design-platform.css:173`/`:266`. Used by the question composer / attachment rail strokes. |
| *(strongest)* | `--dsw-alias-border-l4` | `rgba(0, 0, 0, 0.16)` | `rgba(255, 255, 255, 0.2)` | `design-platform.css:176`/`:269`. **This is the default `--dsw-elevation-stroke-color`** (`gradient-shadow-text.css:17`). |

### 1.3 Text

| prototype token | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| `--text` `#E8EAED` (primary) | `--dsw-alias-label-primary` | `var(--dsw-static-neutral-bluish-1000)` = `rgb(15,17,21)` `#0F1115` | `var(--dsw-static-neutral-bluish-50)` = `rgb(249,250,251)` `#F9FAFB` | `design-platform.css:207` (light), `:300` (dark). |
| `--text-dim` `#8B93A1` (secondary) | `--dsw-alias-label-secondary` | `var(--dsw-static-neutral-bluish-700)` = `rgb(97,102,107)` `#61666B` | `var(--dsw-static-neutral-bluish-300)` = `rgb(207,211,214)` `#CFD3D6` | `design-platform.css:208`/`:301`. Used for the user-bubble-adjacent metadata at `ui-chat/src/client/chat/MessageItem.module.css:191`. |
| `--text-faint` `#5A6272` (tertiary / hint) | `--dsw-alias-label-tertiary` | `var(--dsw-static-neutral-bluish-600)` = `rgb(129,133,140)` `#81858C` | `var(--dsw-static-neutral-bluish-400)` = `rgb(173,178,184)` `#ADB2B8` | `design-platform.css:209`/`:302`. Exact name/role match for "tertiary". Real consumers: `MessageItem.module.css:44,141,151,157`. |
| *(for micro / caption text)* | `--dsw-alias-label-caption` | `var(--dsw-static-neutral-bluish-400)` = `#ADB2B8` | `var(--dsw-static-neutral-bluish-600)` = `#81858C` | `design-platform.css:201`/`:294`. This is the caption role DSH actually pairs with uppercase micro-labels (`ui-skill/src/client/SkillRow.module.css:134`). Note the light/dark values are **inverted** relative to `label-tertiary`. |
| *(disabled / very dim ink)* | `--dsw-alias-label-dimmed` | `var(--dsw-static-neutral-bluish-200)` = `#E1E5EE` | `var(--dsw-static-neutral-bluish-750)` = `#43454A` | `design-platform.css:202`/`:295`. Named for disabled controls, not for secondary prose — do not use as `text-faint`. |
| *(primary ink for a filled brand surface)* | `--dsw-alias-label-primary-foreground` | `var(--dsw-static-neutral-bluish-00)` = `#FFFFFF` | `var(--dsw-static-neutral-bluish-1000)` = `#0F1115` | `design-platform.css:205`/`:298`. |

### 1.4 Accent / brand

> **Read this caveat first.** `--dsw-alias-brand-primary` is **not** a blue accent on this platform. It resolves to near-black in light and near-white in dark (`design-platform.css:179`/`:272` → `--dsw-static-neutral-bluish-1000` / `--dsw-static-neutral-bluish-50`). It is the *contrast* fill. Using it as `--accent` would be wrong. This is stated by the platform itself at `ui-dockkit/README.md:72`: "**Emphasis takes the platform's accent, never `--dsw-alias-brand-primary`.** This platform binds `brand-primary` to its near-black (light) or near-white (dark) foreground".

| prototype token | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| `--accent` `#4D6BFE` (brand blue) | `--dsw-alias-brand-primary-new-colorprimary-new-color` | `rgb(65, 118, 230)` `#4176E6` | `var(--dsw-static-deepseek-450)` = `rgb(86, 134, 254)` `#5686FE` | `design-platform.css:178` (light), `:271` (dark). **Closest faithful equivalent.** It is the token DSH's own trajectory/dockkit views use for accent. The literal name is awkward but real. Hue is close to `#4D6BFE`, not exact. |
| *(alternative accent)* | `--dsw-alias-link` | `var(--dsw-static-deepseek-500)` = `rgb(65, 118, 230)` `#4176E6` | `var(--dsw-static-deepseek-400)` = `rgb(103, 158, 254)` `#679EFE` | `design-platform.css:210`/`:303`. Use **only** for clickable links — `docs/web-styling.md:26` fixes link styling to this token at `font-weight: 500`. Do not repurpose it as a generic accent. |
| *(alternative accent, state palette)* | `--dsw-alias-state-business-primary` | `var(--dsw-static-deepseek-500)` = `#4176E6` | `var(--dsw-static-deepseek-400)` = `#679EFE` | `design-platform.css:223`/`:316`. Semantically "business/info state", not brand. |
| `--accent-soft` `rgba(77,107,254,0.12)` | **No faithful equivalent.** Closest: `--dsw-alias-interactive-bg-hover-accent` | `rgba(38, 49, 72, 0.14)` | `rgba(255, 255, 255, 0.24)` | `design-platform.css:197`/`:290`. It is a **neutral** translucent hover tint, *not* an accent-tinted one — the hue is unrelated to brand blue. |
| *(accent-tinted soft fill, the pattern DSH actually uses)* | built from `--dsw-alias-brand-primary-new-colorprimary-new-color` via `color-mix` | `color-mix(in srgb, #4176E6 8%, transparent)` | `color-mix(in srgb, #5686FE 8%, transparent)` | Precedent in source: `ui-dockkit/src/components/dockkit.module.css:581` — `background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 8%, transparent)`, with `border-color` on line 582. **This is the sanctioned way** to express `--accent-soft`; there is no token for it. |
| *(opaque accent-tinted fill)* | `--dsw-alias-state-business-tertiary` | `var(--dsw-static-deepseek-100)` = `rgb(228,237,253)` `#E4EDFD` | `var(--dsw-static-deepseek-800)` = `rgb(52,65,91)` `#34415B` | `design-platform.css:224`/`:317`. Opaque, unlike the prototype's alpha fill. |

### 1.5 Elevation shadows

Prototype: "elevation shadows" (unspecified values). DSH replaces them with a three-token system plus a rebindable stroke color.

| prototype role | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| panel shadow | `--dsw-elevation-panel` | `var(--dsw-elevation-stroke), 0 3px 8px 0 rgba(0,0,0,0.03), 0 0 16px 0 rgba(0,0,0,0.02)` | *same value* (not scheme-branched) | `gradient-shadow-text.css:29-30`. Declared on `body, body *` (`:26-27`) so a surface's stroke rebind resolves. |
| prominent shadow (menus, popovers, modals) | `--dsw-elevation-prominent` | `var(--dsw-elevation-stroke), 0 3px 8px 0 rgba(0,0,0,0.04), 0 0 20px 0 rgba(0,0,0,0.05)` | *same value* | `gradient-shadow-text.css:31-32`. |
| soft shadow (composer; larger blur, lower alpha) | `--dsw-elevation-soft` | `var(--dsw-elevation-stroke), 0 4px 16px 0 rgba(0,0,0,0.03), 0 0 24px 0 rgba(0,0,0,0.03)` | *same value* | `gradient-shadow-text.css:33-34`. |
| the 0.5px hairline inside the shadow | `--dsw-elevation-stroke` | `0 0 0 0.5px var(--dsw-elevation-stroke-color)` | *same value* | `gradient-shadow-text.css:28`. |
| rebindable stroke color | `--dsw-elevation-stroke-color` | `var(--dsw-alias-border-l4)` | *same* | Default declared **on `body` alone** (`gradient-shadow-text.css:17`), deliberately, so a surface rebind inherits down (`elevation-styles.client.spec.ts:35-41`). |
| *(older, still-shipped shadow scale)* | `--dsw-shadow-lv1`, `--dsw-shadow-lv1-blur`, `--dsw-shadow-lv2`, `--dsw-shadow-lv3` | e.g. lv3 = `0 0 1px 0 rgba(0,0,0,0.2), 0 0 4px 0 rgba(0,0,0,0.02), 0 12px 32px 0 rgba(0,0,0,0.08)` | *same values* | `gradient-shadow-text.css:5-9`. `--dsw-shadow-lv*` is still counted as an "elevated surface" by the gate (`elevation-styles.client.spec.ts:19`) and still in use (`ui-primitives/src/Toast.module.css:30`). Prefer the `--dsw-elevation-*` trio for new work. |

**Dark-mode note:** the elevation shadows are not scheme-branched. The `0.5px` hairline carries the surface separation in dark mode; `gradient-shadow-text.css:11-12` states the soft glow is nearly invisible there.

### 1.6 Corner radii — **DSH has no radius tokens**

Verified: `grep` for any `--dsw-*radius*` token across the whole checkout returns **no matches**. There is no `--dsw-radius-*`, no `--dsw-corner-radius-*`. Radii are literal per-component values. The only related token is `--dsw-corner-shape` (`corner-shape.css:18`), which is a *curvature family*, not a size.

| prototype role | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| 26px pill radius | **No token.** Nearest shipped pattern: `border-radius: 999px;` + `corner-shape: round;` | n/a (literal) | n/a | Precedents: `ui-theme/src/styles/scrollbar.css:81-82`, `ui-conversation/src/client/skeleton/InputBar.module.css:304-305` and `:362-363`. **But**: the corner-shape gate's `isFullRound()` only treats `50%`, `100%`, or a px value `>= 99` as full-round (`corner-shape-styles.client.spec.ts:30-33`). A literal `26px` radius is therefore **not** gate-forced to pair `corner-shape: round` — it is a normal rounded corner and inherits the global `superellipse(1.5)`. Only write `corner-shape: round` if you express the pill as `50%`/`100%`/`>=99px`. |
| 14–16px card radius | **No token.** Literal. | n/a | n/a | Real DSH cards: `16px` (`ui-chat/.../MessageItem.module.css:313`), `14px` (`ui-primitives/src/Toast.module.css:25`), `12px`, `8px`, `6px`. Tally of literal radii in `packages/client/**/*.module.css`: `6px` ×38, `8px` ×33, `12px` ×26, `50%` ×25, `4px`/`10px` ×16, `20px`/`16px`/`999px` ×15, `18px` ×12, `14px` ×11. |
| 30px drawer radius | **No token, and no 30px precedent.** Nearest shipped surfaces: right-drawer `28px` (`ui-sidebar-right/src/client/shell/SidebarRight.module.css:77`), modal `24px` (`ui-primitives/src/Modal.module.css:32`), menu `20px` (`ui-primitives/src/Menu.module.css:17`), composer `22px` (`InputBar.module.css:55`). | n/a | n/a | If a 30px drawer radius must match DSH, align to one of the shipped values rather than inventing a token. |
| 18px message bubble radius | **No token for the radius.** The *fill* is tokenized as `--dsw-specific-bubble`. | `var(--dsw-static-deepseek-50)` = `rgb(237,243,254)` `#EDF3FE` | `var(--dsw-static-neutral-bluish-850)` = `rgb(44,44,46)` `#2C2C2E` | Fill: `design-platform.css:237` (light), `:330` (dark). Radius on DSH's own bubble is **22px, not 18px** — `ui-chat/src/client/chat/MessageItem.module.css:28-29` sets `background: var(--dsw-specific-bubble); border-radius: 22px;`. Also relevant: `--dsw-specific-bubble-highlight` (`design-platform.css:236`/`:329`, light `--dsw-static-deepseek-200` `#D3E2FF`, dark `--dsw-static-neutral-bluish-750` `#43454A`). |
| *(corner curvature)* | `--dsw-corner-shape` | `superellipse(1.5)` — **only inside `@supports (corner-shape: superellipse(1.5))`** | *same value* | `corner-shape.css:16-25`. Applied to `*`, `*::before`, `*::after` (`:21-24`). On non-supporting engines the token and the rule simply do not exist, so corners stay circular. A plugin gets this for free by writing plain `border-radius`. |

### 1.7 Type roles

| prototype role | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| message body `14.5px / 1.72` | `--dsh-content-font-size` (size) + `--dsh-content-font-delta` (line-height axis) | `--dsh-content-font-size` default `14px`; line-height `calc(22px + var(--dsh-content-font-delta, 0px))` | *same* | Size range is `12..17` px, default `14` (`ui-theme/src/theme-settings.ts:24,27,30`). Written onto `body` inline by `boot-theme.ts:21` and `ui-layout/src/client/theme-presenter.ts:47`. **14px/22px = ratio 1.571, not 1.72.** For ~1.72 use the markdown base pair below. |
| *(the ~1.72 body ratio)* | `--dsw-font-markdown-base` | `var(--dsh-content-font-size, 14px) / calc(24px + var(--dsh-content-font-delta))` → `14px/24px` = **1.714** | *same* | `gradient-shadow-text.css:87`. **Closest match to the prototype's 1.72 line-height.** Composed shorthand; decomposed parts on `:88-92`. |
| *(user bubble body pair)* | `--dsh-content-font-size` + `--dsh-content-font-delta` | `font-size: var(--dsh-content-font-size, 14px); line-height: calc(22px + var(--dsh-content-font-delta, 0px))` | *same* | The exact declaration DSH's bubble uses: `ui-chat/src/client/chat/MessageItem.module.css:34-35`. |
| secondary text `13–13.5px` | `--dsh-content-font-size-secondary` | `13px` at the default setting (formula: setting −1 at ≤14, setting −2 above) | *same* | Formula: `gradient-shadow-text.css:56`; derived delta on `:57`. Range 11–15px. Consumed with a fallback, e.g. `font-size: var(--dsh-content-font-size-secondary, 13px)` (`ui-primitives/src/DisclosureRow.module.css:81`). |
| *(secondary text, fixed pair)* | `--dsw-font-xs-13` | `13px/20px var(--dsw-font-family)` | *same* | `gradient-shadow-text.css:228-233`. Fixed — does **not** follow the font-size preference. Also `--dsw-font-xs-strong-13` (`:235-240`, `500 13px/20px`). |
| micro label `11px` | `--dsw-font-xxxs-11` | `11px/14px var(--dsw-font-family)` | *same* | `gradient-shadow-text.css:256-261`. Strong variant `--dsw-font-xxxs-strong-11` = `500 11px/14px` on `:263-268`. |
| micro label `letter-spacing: 1.3px` | **No token.** Letter-spacing is a per-component literal in DSH. | n/a | n/a | DSH uses `em`-relative values, and they are **much tighter than 1.3px**: `0.04em` ≈ 0.44px at 11px (`ui-skill/src/client/SkillRow.module.css:136`, `ui-sidebar/src/client/SidebarRoot.module.css:154`), `0.035em` (`ui-trajectory/src/client/TrajectoryTable.module.css:475`), `0.06em` (`ui-agent-preset/src/client/AgentPresetSection.module.css:76`). 1.3px at 11px would be `0.118em` — roughly 2–3× DSH's tracking. |
| micro label `uppercase` | **No token.** `text-transform: uppercase` is a per-component literal. | n/a | n/a | Precedents: `ui-skill/.../SkillRow.module.css:135`, `ui-agent-preset/.../AgentPresetSection.module.css:77`. The canonical pairing is `font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dsw-alias-label-caption)` (`SkillRow.module.css:131-136`). |
| mono `"SF Mono", ui-monospace, Menlo, monospace` | **No `--dsw-font-mono` token exists.** Use `--ds-font-family-code`. | `'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'` | *same* | Defined at `base.css:9-10`. Note the deliberate omission of a bare `monospace` tail, documented at `base.css:3-5`: "Windows CJK falls back to SimSun otherwise." Composite code font shorthands: `--dsw-font-markdown-code` (`12px/19px`, `gradient-shadow-text.css:157`), `--dsw-font-markdown-code-block` (`11px/19px`, `:164`), `--dsw-font-markdown-code-block-small` (`11px/16px`, `:172`). |

> **Warning about `--dsw-font-mono`:** five package stylesheets reference it (`ui-jobs/src/client/JobListAction.module.css:102`, `ui-sidebar-documentpreview/.../TextPreview.module.css:93`, `ui-agent-preset/.../AgentPresetSection.module.css:275,359,442`), **but it is never defined anywhere in the checkout.** `ui-jobs:102` uses it with no fallback, so it resolves to the guaranteed-invalid value. Do not copy that pattern; use `--ds-font-family-code`.

### 1.8 Motion

| prototype role | DSH token name | light value | dark value | notes / caveats |
|---|---|---|---|---|
| duration (standard) | `--ds-transition-duration` | `0.2s` | *same* | `base.css:12`. Note the `--ds-` prefix, not `--dsw-`. |
| duration (fast) | `--ds-transition-duration-fast` | `0.1s` | *same* | `base.css:13`. |
| duration (slow) | `--ds-transition-duration-slow` | `0.3s` | *same* | `base.css:14`. |
| easing | `--ds-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | *same* | `base.css:11`. Usage precedent: `AppFrame.module.css:10`. |

There is **no** motion token under the `--dsw-` prefix. The Agent Note records the intent: "Transitions are always `var(--dur*) var(--ease)` and only transition opacity/transform/background-color/shadow" (`.agents/notes/implemented/process/2026-07-19-web-styling-system.md:31`).

---

## 2. What actually exists: token inventory with file paths

**Token authority directory:** `packages/client/ui-theme/src/styles/` — six sheets, imported in this order (`ui-theme/src/client/styles.ts:11-18`) and injected as plugin-owned `<style>` tags tagged `data-plugin="@deepseek-ai/dsh-client-ui-theme"` (`styles.ts:24-36`).

| Sheet | Owns |
|---|---|
| `base.css` | `--dsw-font-family`, `--ds-font-family-code`, the four motion variables |
| `corner-shape.css` | `--dsw-corner-shape` (guarded) |
| `design-platform.css` | Every `--dsw-static-*` (light + dark) and every `--dsw-alias-*` / `--dsw-specific-*` alias |
| `scrollbar.css` | `--dsh-scrollbar-*` consumer contract |
| `gradient-shadow-text.css` | `--dsw-shadow-lv*`, `--dsw-elevation-*`, `--dsh-content-font-*`, the whole `--dsw-font-*` typographic ladder |
| `shiki.css` | `--shiki-*` syntax palette |

### 2.1 `base.css` (15 lines)

| Line | Token | Value |
|---|---|---|
| 7-8 | `--dsw-font-family` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif` |
| 9-10 | `--ds-font-family-code` | `'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'` |
| 11 | `--ds-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| 12 | `--ds-transition-duration` | `0.2s` |
| 13 | `--ds-transition-duration-fast` | `0.1s` |
| 14 | `--ds-transition-duration-slow` | `0.3s` |

### 2.2 `corner-shape.css` (26 lines)

| Line | Token / rule | Value |
|---|---|---|
| 16 | `@supports` guard | `(corner-shape: superellipse(1.5))` |
| 18 | `--dsw-corner-shape` | `superellipse(1.5)` |
| 21-24 | universal application | `*, *::before, *::after { corner-shape: var(--dsw-corner-shape); }` |

Rationale in-file: between a circular arc (`round` = `superellipse(1)`) and a squircle (`superellipse(2)`); `corner-shape` does not inherit, hence the universal selector (`corner-shape.css:1-15`).

### 2.3 `design-platform.css` (340 lines)

**Static scale — `body` (light)** at `:4-78`, **`body[data-ds-dark-theme]`** at `:80-154`. The two blocks are byte-identical **except** for two tokens:

| Token | Light line / value | Dark line / value |
|---|---|---|
| `--dsw-static-neutral-bluish-60` | `:63` = `rgb(245,246,247)` | `:139` = `rgb(249,250,251)` |

Families present: `--dsw-static-amber-{100,400,500,600,900}`, `--dsw-static-blue-{50,50p,75,100,300,400,450,500,600,800,900,950}`, `--dsw-static-deepseek-{50,100,200,300,400,450,500,600,700-delete,800,900}`, `--dsw-static-green-{100,400,500,900}`, `--dsw-static-neutral-{00,50,100,150,200,250,300,400,500,550,600,700,800,850,900,1000}`, `--dsw-static-neutral-bluish-{00,50,60,75,100,150,200,300,400,500,600,700,750,800,850,875,900,950,1000}`, `--dsw-static-red-{50,100,400,500,600,900}`.

**Semantic aliases — `body` (light)** at `:156-247`, **`body[data-ds-dark-theme]`** at `:249-340`.

| Family | Tokens | Light lines | Dark lines |
|---|---|---|---|
| Backgrounds | `bg-base`, `bg-layer-1`, `bg-layer-2`, `bg-layer-3`, `bg-mask-1`, `bg-mask-2`, `bg-mask-3`, `bg-mask-photo`, `bg-mask-drop`, `bg-module-platform`, `bg-multi-select`, `bg-overlay`, `bg-skeleton` | 157-169 | 250-262 |
| Borders | `border-inverted`, `border-inverted2`, `border-l1`, `border-l2`, `border-l2-darkmode-thin`, `border-l3`, `border-l4` | 170-176 | 263-269 |
| Brand | `brand-primary`, `brand-primary-invert`, `brand-primary-new-colorprimary-new-color`, `brand-text` | 177-180 | 270-273 |
| Buttons | `button-contrast-fill`, `button-elevated-fill`, `button-floating-fill`, `button-floating-hover`, `button-ghost-active-{border,fill,hover}`, `button-info-fill`, `button-info-hover`, `button-primary-dimmed`, `button-primary-fill`, `button-primary-hover`, `button-tool-bar-fill`, `button-tool-bar-fill-invisible`, `button-tool-bar-hover` | 181-195 | 274-288 |
| Interactive | `interactive-bg-hover`, `interactive-bg-active`, `interactive-bg-hover-accent`, `interactive-bg-hover-danger`, `interactive-bg-hover-solid` | 196-200 | 289-293 |
| Labels | `label-caption`, `label-dimmed`, `label-primary`, `label-primary-bluish`, `label-primary-dimmed`, `label-primary-foreground`, `label-primary-inverted`, `label-secondary`, `label-tertiary` | 201-209 | 294-302 |
| Link | `link` | 210 | 303 |
| Markdown | `markdown-citation`, `markdown-code-block`, `markdown-code-block-banner`, `markdown-code-segment-selected`, `markdown-code-segment-unselected`, `markdown-inline-code`, `markdown-placeholder`, `markdown-tag` | 211-218 | 304-311 |
| Scrollbar | `scrollbar-bg-l1`, `scrollbar-bg-l2`, `scrollbar-hover-l1`, `scrollbar-hover-l2` | 219-222 | 312-315 |
| State | `state-business-primary`, `state-business-tertiary`, `state-error-primary`, `state-error-secondary`, `state-success-primary`, `state-success-secondary`, `state-success-tertiary`, `state-warn-label`, `state-warn-primary`, `state-warn-secondary`, `state-warn-tertiary` | 223-233 | 316-326 |
| Toast / tooltip | `toast-bg`, `tooltip-bg` | 234-235 | 327-328 |
| **`--dsw-specific-*`** | `specific-bubble`, `specific-bubble-highlight`, `specific-input-major`, `specific-login-input`, `specific-menu`, `specific-selector`, `specific-sidebar-fill`, `specific-sidebar-nav-item-active`, `specific-sidebar-nav-item-active-accent`, `specific-sidebar-nav-item-hover`, `specific-tip` | 236-246 | 329-339 |

### 2.4 `scrollbar.css` (95 lines) — consumer-contract variables

| Line | Token | Value |
|---|---|---|
| 17 | `--dsh-scrollbar-thumb` | `var(--dsw-alias-scrollbar-bg-l1)` |
| 18 | `--dsh-scrollbar-thumb-hover` | `var(--dsw-alias-scrollbar-hover-l1)` |
| 19 | `--dsh-scrollbar-thumb-border` | `0px` |
| 20 | `--dsh-scrollbar-track-margin` | `0px` |
| 25 | `--dsh-scrollbar-width` | `8px` |
| 81-82 | the pill pairing | `border-radius: 999px; corner-shape: round;` |

An elevated surface rebinds the thumb pair to the l2 tokens on its own container — real precedent at `ui-primitives/src/Menu.module.css:26-27`.

### 2.5 `gradient-shadow-text.css` (269 lines)

| Group | Lines | Tokens |
|---|---|---|
| Gradients | 2-3 (light), 38-39 (dark) | `--dsw-linear-gradient-think`, `--dsw-linear-think-select` |
| Shadows | 5-9 | `--dsw-shadow-lv1`, `--dsw-shadow-lv1-blur`, `--dsw-shadow-lv2`, `--dsw-shadow-lv3` |
| Elevation defaults | 17, 19 | `--dsw-elevation-stroke-color`, `--dsw-mask-blur` |
| Elevation derived (**per element**) | 26-35 | `--dsw-elevation-stroke`, `--dsw-elevation-panel`, `--dsw-elevation-prominent`, `--dsw-elevation-soft` |
| Content font axis | 55-57 | `--dsh-content-font-delta`, `--dsh-content-font-size-secondary`, `--dsh-content-font-delta-secondary` |
| Markdown ladder | 59-155 | `--dsw-font-markdown-{h1,h2,h3,h4,base,base-strong,base-italic,base-strong-italic,table,table-head,small,small-strong,small-italic,small-strong-italic}` |
| Code | 157-177 | `--dsw-font-markdown-code` (12/19), `--dsw-font-markdown-code-block` (11/19), `--dsw-font-markdown-code-block-small` (11/16) |
| UI scale ladder | 179-268 | `--dsw-font-xl-24` (600 24/32), `--dsw-font-l-20` (500 20/28), `--dsw-font-m-18` (500 16/28), `--dsw-font-base-16` (16/24), `--dsw-font-base-strong-16` (500 16/24), `--dsw-font-s-14` (14/22), `--dsw-font-s-strong-14` (500 14/22), `--dsw-font-xs-13` (13/20), `--dsw-font-xs-strong-13` (500 13/20), `--dsw-font-xxs-12` (12/18), `--dsw-font-xxs-strong-12` (500 12/18), `--dsw-font-xxxs-11` (11/14), `--dsw-font-xxxs-strong-11` (500 11/14) |

> Note: `--dsw-font-m-18` and `--dsw-font-l-20` are **misleadingly named** — `m-18` is `16px` (`:193`) and `l-20` is `20px` (`:186`). The trailing number is the line height, not the size.

Every ladder entry also has decomposed `-font-family`, `-font-weight`, `-line-height`, `-font-size`, `-font-style` siblings.

### 2.6 `shiki.css` (31 lines)

`--shiki-foreground` and `--shiki-background` alias DSH tokens (`:8-9`); the nine `--shiki-token-*` values are **literal hex colors**, light on `:root` (`:7-19`) and dark on `body[data-ds-dark-theme]` (`:21-31`). This is the one sheet in the theme package where literal colors appear legitimately.

### 2.7 `--dsh-*` (runtime-published, not stylesheet-declared)

| Token | Declared by | Values |
|---|---|---|
| `--dsh-content-font-size` | `boot-theme.ts:21` (pre-plugin bootstrap) and `ui-layout/src/client/theme-presenter.ts:47` (after activation) — written as an **inline style on `body`** | integer px, `12..17`, default `14` |
| `--dsh-content-font-delta`, `--dsh-content-font-size-secondary`, `--dsh-content-font-delta-secondary` | **derived in CSS** from the above (`gradient-shadow-text.css:55-57`) | see §1.7 |
| `--dsh-scrollbar-*` | `scrollbar.css:17-25` | see §2.4 |
| `--dsh-chat-content-width` | Read with fallback at `ui-chat/src/client/chat/MessageItem.module.css:21` | not found in the theme package; published elsewhere in the chat layer |

### 2.8 Theme extension surface (`ctx.theme`)

From `packages/client/ui-theme/src/client/index.ts`:

| Line | Member | Contract |
|---|---|---|
| 49 | `ThemeTokens` | `Record<string, string>` (resolved per-scheme) |
| 56-61 | `ThemeTokenModes` | `{ light: string; dark: string }` — **both modes mandatory** |
| 67-77 | `ThemeDefinition` | `{ id, colorScheme: 'light'\|'dark', tokens }` |
| 80-95 | `ThemeSnapshot` | `{ preference, fontSize, active, themes, revision }` |
| 131-145 | `BUILTIN_INSPECT_TOKENS` | The 13-token pre-definition inspection list: `bg-base`, `bg-layer-1`, `bg-layer-2`, `bg-overlay`, `border-l1`, `border-l2`, `brand-primary`, `label-primary`, `label-secondary`, `state-error-primary`, `state-success-primary`, `state-warn-primary`, `specific-sidebar-fill` — **all marked `requiresLightAndDark: true`** |
| 275-290 | `register(definition)` | Register a theme id + alias overrides; duplicate id throws; `'system'` is rejected (`:276`) |
| 308-317 | `overrideTokens(source, tokens)` | Stack a token override layer over the active theme; later layers win per token |
| 383-403 | `validateOverrides` | Runtime shape check: a bare string throws a teaching error telling the caller to pass `{light, dark}` |
| 202-204 | `getTheme()` | Read the current immutable snapshot |
| 122 | `theme/change` event | Emitted on every publish |

---

## 3. Rules a plugin must follow

> **Placement note (verified).** `packages/AGENTS.md` contains **no styling rules** — it covers plugin export form, service definitions, `./invariant` publication, naming, and tsconfig layout. The styling/localization rules for the web client live in **`packages/client/AGENTS.md`** ("Styling and localization") and **`docs/web-styling.md`**, with the framework rationale in `.agents/notes/implemented/process/2026-07-19-web-styling-system.md`. I report the rules from where they actually are rather than forcing them into `packages/AGENTS.md`.

### 3.1 `--dsw-alias-*` vs literal colors

`docs/web-styling.md:11`:
> "Global style sheets belong in `ui-theme/src/styles/`. Component styles live beside their component as CSS Modules. A component may define a local custom property when its value is part of that component's layout or presentation contract; shared colors, typography, elevation, and motion belong to the theme package."

`docs/web-styling.md:17` (imperative):
> "Use `--dsw-alias-*` semantic tokens in feature components. Do not copy static palette values or write literal colors there."

`docs/web-styling.md:18`:
> "Keep theme selectors out of feature component CSS. Light/dark overrides belong to the theme owner."

`packages/client/AGENTS.md` (Styling and localization):
> "Shared `--dsw-*` tokens and global sheets live in `ui-theme/src/styles/`; feature components consume semantic aliases through CSS Modules and `clsx`, with no literal colors, component library, or Tailwind."

Bounded exception, from `ui-theme/README.md:101-102` ("Known Limitations and Deferred Work"):
> "- **Third-party themes are an extension point, not a product** — registering one means overriding same-named alias variables; no validation exists that an override set is complete.
> - **The token sheets are the sole color authority** — values absent from the design system are deliberately not appended; the nearest semantic token wins, and design-owner-approved additions enter as a static step plus a semantic alias in the same change."

### 3.2 A feature package may NOT define its own global theme — confirmed

`docs/web-styling.md:9` (exact wording):
> "[`ui-theme`](../packages/client/ui-theme/README.md) owns the `--dsw-*` static scale, semantic aliases, typography, motion, gradients, shadows, scrollbar styles, and light/dark preference. [`ui-layout`](../packages/client/ui-layout/README.md) applies the resolved theme snapshot to the document. **Feature packages consume semantic aliases and do not define another global theme.**"

`docs/web-styling.md:28-30` ("Changing the system"):
> "Add or change a shared token in the owning `ui-theme` sheet, then consume its semantic alias from feature packages. Update the owning package reference when a public styling contract changes."

**The sanctioned alternative** (this is the distinction that matters for your plugin): the `ctx.theme` seam exists precisely so a composition can supply a *theme*, not so a feature can restyle globally. `ui-theme/README.md:12, 34-36`:
> "Third-party themes can register alias-token overrides through `ctx.theme`."
> "A composition can register a third-party theme id with alias-token overrides through `ctx.theme`; the override layer folds into the active snapshot's tokens in registration order. Removing one never overwrites the last durable built-in preference. Third-party theme ids remain an in-process extension and do not cross the built-in settings schema."

**Practical reading:** if your external plugin is delivering a *palette*, register it via `ctx.theme.register({ id, colorScheme, tokens })` / `ctx.theme.overrideTokens(source, {name: {light, dark}})` and let the user select it. If your plugin is a *feature*, consume `--dsw-alias-*` and define no global theme.

### 3.3 The 0.5px neutral border rule and the elevation/border pairing rule

`docs/web-styling.md:24` (elevation/border pairing, exact wording):
> "Elevated surfaces (menus, popovers, modals, panels, floating buttons, the composer) set `border: 0` and take `box-shadow: var(--dsw-elevation-panel)`, `var(--dsw-elevation-prominent)`, or the composer's `var(--dsw-elevation-soft)` (larger blur at lower alpha): the 0.5px hairline stroke is the first shadow layer, and `--dsw-elevation-stroke-color` rebinds or suppresses it per surface or state. **Never pair a `--dsw-alias-border-*` border with an lv/elevation shadow** — the ui-theme elevation spec rejects the pairing; state-colored borders (warn panels) stay real borders."

`docs/web-styling.md:25` (the 0.5px rule, exact wording):
> "Flat borders and separators that use a neutral `--dsw-alias-border-*` token draw at `0.5px` — buttons, inputs, cards, row dividers, and separators drawn as filled boxes (menu separators, the conversation header seam, markdown `hr`, vertical rails) share the hairline weight, which Chromium paints as one device pixel. Dashed affordances and state-colored borders keep 1px; spinner ring tracks keep their width through the spec's explicit allowlist. The ui-theme elevation spec rejects wider neutral solid borders."

**The enforcing spec** (this is a real, running test, not just prose): `packages/client/ui-theme/tests/elevation-styles.client.spec.ts`.
- `:63-70` — `neutralBordersBesideElevation()` flags any rule with an `--dsw-(shadow-lv|elevation-)` `box-shadow` **and** a non-radius `border*` property whose value matches `--dsw-alias-border-`.
- `:82-89` — asserts `paired === []` across **every** `.css` under `packages/` (discovered by `stylesheet-scan.ts:79-90`, which walks `packages/` skipping `node_modules`, `lib`, `dist`).
- `:105-117` — `wideNeutralBorders()` flags a `border`/`border-{top,bottom,left,right}` shorthand that is `solid` + a neutral token but does not start with `0.5px `.
- `:159-171` — asserts `wide === []` across `packages/`.
- `:125-138` / `:173-181` — same for separators drawn as a filled box: a 1px `height`/`width` with a neutral-token `background` is rejected; `0.5px` is required.
- `:145-148` — the only allowlist: `boot-page.module.css .spinner` and `TrajectoryTable.module.css .historyLoadingSpinner`.

### 3.4 `corner-shape: round` paired with full-round `border-radius`

`docs/web-styling.md:23` (exact wording):
> "Rounded corners inherit the global superellipse smoothing from ui-theme's `corner-shape.css` on supporting engines. Pair `corner-shape: round` with every full-round `border-radius` (`50%`, `100%`, or a pill radius) so circles and capsules keep circular arcs; the ui-theme corner-shape spec enforces the pairing."

`ui-theme/README.md:56`:
> "Full-round shapes — `border-radius: 50%` circles and pill radii — pair `corner-shape: round` with their radius in the owning component sheet because a superellipse deforms them; the corner-shape stylesheet spec enforces that pairing across every package stylesheet."

**The enforcing spec:** `packages/client/ui-theme/tests/corner-shape-styles.client.spec.ts`.
- `:30-33` — `isFullRound(value)` is true when any whitespace-separated part is `50%`, `100%`, or ends in `px` with a parsed value `>= 99`.
- `:76-81` — rejects a full-round radius lacking `corner-shape: round` in the same rule.
- `:83-90` — asserts the pairing holds across **every** package stylesheet.

Rationale from the sheet itself, `corner-shape.css:11-15`:
> "Full-round shapes opt out where they are declared: a superellipse deforms a circle into a squircle and squares off capsule ends, so every effectively uncapped radius (50%, 100%, or a pill radius far above the box size) pairs `corner-shape: round` with its `border-radius` in the owning component sheet."

**Scope limit for your plugin:** a literal `26px`/`30px` radius is below the `99px` threshold, so it is *not* gate-forced to opt out — see §1.6.

### 3.5 Reduced motion

`docs/web-styling.md:22`:
> "Preserve keyboard focus visibility and reduced-motion behavior when adding transitions or hover-only controls."

That is the only prose rule. It is applied uniformly and concretely in the codebase: **37 occurrences of `prefers-reduced-motion`** across the checkout (33 of them in `packages/client/**`). The canonical shape disables the transition outright:

```css
@media (prefers-reduced-motion: reduce) {
  .frame { transition: none; }
}
```
— `ui-layout/src/client/AppFrame.module.css:19-23` (and again at `:71-75` for the drag handle).

The complementary form guards the animation on `no-preference`:
```css
@media (hover: hover) and (prefers-reduced-motion: no-preference) { … }
```
— `ui-conversation/src/client/skeleton/HeroShell.module.css:115`.

JS-side precedents check the media query before enabling smooth scrolling or typing animation: `ui-attachment/src/AttachmentRail.tsx:36`, `ui-chat/src/client/chat/TurnNavigator.tsx:120`, `ui-agent-preset/src/client/AgentPresetSeat.tsx:121`.

Companion rule, `docs/web-styling.md:20`:
> "Keep source text, terminal output, and diff lines unwrapped when their component contract requires column preservation; use the shared scrollbar styles rather than component-specific scrollbar selectors."

### 3.6 CSS Modules / clsx required; Tailwind and component libraries forbidden

`docs/web-styling.md:16`:
> "Use CSS Modules and `clsx`; do not add a component library or Tailwind."

`docs/web-styling.md:15`:
> "Reuse the control before restyling one: the [ui-primitives component catalog](../packages/client/ui-primitives/README.md#component-catalog) is the only channel that crosses feature packages, and a deliberate visual difference belongs in a prop there rather than in a second copy."

`packages/client/AGENTS.md`:
> "feature components consume semantic aliases through CSS Modules and `clsx`, with no literal colors, component library, or Tailwind."

`docs/web-styling.md:19` and `:21` add the pairing requirements:
> "Pair font sizes with line heights and use the theme typography variables when an existing role matches."
> "Put presentation in CSS. Inline React styles may pass component-local custom-property values but must not encode theme branches."

Framework rationale, `.agents/notes/implemented/process/2026-07-19-web-styling-system.md:27-31` (still in force per its 2026-07-22 note at `:5`):
> "**CSS Modules + clsx, no component library, no tailwind**: each component has a same-named `.module.css` in the same directory; class names are camelCase, single-adjective state classes are attached via clsx; components pass `className` through."
> "**`composes` is banned**; `:global` only pierces third-party/cross-package class names and never defines new global classes; global utility classes live only in global.css and stay in the single digits (currently `.scrollable`)."
> "**PostCSS plugins are currently zero** … (flat CSS suffices — adopting nested/custom-media requires recording it in web-styling.md first)."
> "**Dynamic styles go through the CSS variable bridge**: JS writes only variables (`style={{'--x': v}}`), rules stay in CSS; assembling style objects in TSX for theme/state branches is banned."
> "Transitions are always `var(--dur*) var(--ease)` and only transition opacity/transform/background-color/shadow; scroll containers uniformly use `.scrollable` (writing `::-webkit-scrollbar` inside components is banned)."

> Note: the last two bullets name tokens from a superseded naming era (`--dur*`, `--ease`, `class="scrollable"`). The 2026-07-22 banner at `:5` records the token-table replacement, and no `.scrollable` class or `--dur*` token exists in the current sheets — use `--ds-transition-duration*` / `--ds-ease-in-out` and the shared `--dsh-scrollbar-*` contract instead. The *intent* of both rules is live and reflected in `docs/web-styling.md:20-22`.

### 3.7 The i18n rule and the exact localization mechanism

`AGENTS.md:127` (root standing order):
> "**Client UI copy is locale-owned.** Route product text through typed dictionaries and `t` or localized primitive props; `verify-client-ui-i18n` rejects hardcoded copy ([decision](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md))."

`packages/client/AGENTS.md` (Styling and localization):
> "Every product-visible string—including text, accessibility names, tooltips, placeholders, status/unit formatters, and primitive chrome—lives in a typed locale dictionary and reaches components through the standard `t` seat or an already-localized prop. Cordis-free primitives require complete label props and own no fallback copy. Keep user/model/wire data and code tokens verbatim; internal matching uses discriminants or stable ids, never localized text. `pnpm run verify-client-ui-i18n` enforces source ownership."

**What the gate actually rejects** (`scripts/verify-client-ui-i18n.ts`):

| Line | Mechanism |
|---|---|
| 17-32 | `COPY_ATTRIBUTES` — a literal in any of `alt`, `aria-description`, `aria-label`, `aria-valuetext`, `cancelLabel`, `closeLabel`, `confirmLabel`, `copyLabel`, `description`, `emptyLabel`, `label`, `placeholder`, `title`, `truncatedLabel` is a violation |
| 33 | `COPY_ATTRIBUTE_SUFFIX` — any JSX prop ending in `Aria`, `Copy`, `Description`, `Heading`, `Label`, `Message`, `Placeholder`, `Summary`, `Text`, `Title`, `Tooltip` |
| 35-36 | `COPY_NAME` / `COPY_SUFFIX` — variables, object properties, binding defaults and function returns whose *name* matches those words |
| 69-75 | `localeOwner(file)` — the **only** files allowed to hold copy are basenames `locale.ts` / `locales.ts`, or anything under a `/locales/` directory |
| 77-83 | `containsProductText()` — a non-empty string with a letter, not in `IMMUTABLE_LANGUAGE_TOKENS` (`B`, `Function`, `GB`, `K`, `KB`, `M`, `MB`, `Symbol`, `false`, `n`, `null`, `true`, `undefined`) and not matching the locale-key shape `/^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)+$/` |
| 239 | JSX text nodes are violations |
| 296-298 | A `.tsx` function with an explicit `string` return type gets "natural text only" scrutiny |
| 319-337 | Discovery globs: `packages/client/*/src/**/*.tsx`, `packages/client/ui-*/src/**/*.{ts,tsx}`, every `src/client` root found by `packages/*/*/src/client/**/*.tsx`, `apps/web/src/**/*.{ts,tsx}`, `apps/desktop/src/{main,update-coordinator}.{ts,tsx}`, `apps/desktop/renderer/*.js` — `.d.ts` excluded |
| 341-345 | Anti-narrowing guard: fewer than `MINIMUM_CLIENT_UI_SOURCES = 450` files throws |
| 348-357 | Non-zero exit listing `file:line:column reason: "text"` |

**The mechanism for localizing product text in a client plugin** — four steps, all evidenced:

1. **Declare a typed key union and both shipped locales.** From `ui-theme/src/client/locales.ts:4-30`:
   ```ts
   export const zh = { 'appearance.title': '外观', /* … */ } satisfies Record<string, string>
   export type ThemeKey = keyof typeof zh
   export const en = { 'appearance.title': 'Appearance', /* … */ } satisfies Record<ThemeKey, string>
   ```
   The `satisfies Record<ThemeKey, string>` on `en` makes a missing English key a compile error. Put these in `src/client/locales.ts` or `src/client/locales/` so the gate's `localeOwner()` exempts them.

2. **Merge the namespace into `LocaleNamespaceMap`** — every dictionary owner does this by declaration merging (`ui-theme/src/client/index.ts:41-46`):
   ```ts
   declare module '@deepseek-ai/dsh-client-ui-slots' {
     interface LocaleNamespaceMap { 'settings.theme': ThemeKey }
   }
   ```
   The map itself is `export interface LocaleNamespaceMap {}` at `ui-slots/src/index.ts:36`; the derived types are `LocaleKeysOf<N>` (`:66`), `TranslateNS<N>` (`:76`), and `LocaleDictOf<N>` (`:83-84`).

3. **Register the dictionaries as an owned effect** (`ui-theme/src/client/index.ts:434`):
   ```ts
   ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: settings row dictionaries')
   ```
   Signature: `register<N>(ns, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>)` at `locale/src/client/index.ts:370`; both shipped locales are required and each dictionary is checked against the namespace's key union. A duplicate `(ns, locale)` throws (`:396-400`). The disposer is idempotent.
   For an **external** plugin adding a whole new language (not just a namespace), use the language-pack form — `locale/README.md:40-58`:
   ```js
   export const inject = ['locale']
   export function apply(ctx) {
     ctx.effect(() => ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }), 'my-locale: language')
     ctx.effect(() => ctx.locale.register('common', 'ja', { cancel: 'キャンセル', close: '閉じる' }), 'my-locale: common dictionary')
   }
   ```
   The external id must be a non-empty ASCII BCP 47-style tag, its fallback must already be registered, and the chain must terminate at `en` (`locale/README.md:60`).

4. **Receive the text through the `t` seat** — declare `locale:` on the slot registration, and the renderer synthesizes a typed `t` prop. `ui-slots/src/index.ts:580-586`:
   > "Dictionary namespace of this entry's copy. Declaring it puts the framework-synthesized `t` seat (typed to the namespace's dictionary union) on the component props; rendering requires an installed locale face — fails loud otherwise."

   Working example, `ui-theme/src/client/index.ts:454-461`:
   ```ts
   ctx.slots.inject('settings.general.item', () => ctx.slots.register({
     name: 'settings.general.item', id: 'appearance', order: 10,
     store, locale: SETTINGS_NS, inject: injected,
   }, AppearanceRow))
   ```
   The prop type is derived: `PropsLocale<N>` gives `{ t: TranslateNS<N> }` exactly on entries that declared `locale:` (`ui-slots/src/index.ts:90-95`). Outside a slot, use `ctx.locale.bind(ns)` — `locale/src/client/index.ts:429` (typed overload) / `:436-437` (untyped). Bound translators keep stable identity per namespace so they survive memoization (`:438-441`).

   Lookup order per key: the active language's fallback chain in the requested namespace, then the same chain in `common`, then the key itself (`locale/README.md:86`; `locale/src/client/index.ts:458-460`).

**Two documented limits** (`locale/README.md:129-130`):
> "- **Registry-held text reads its translation once** — copy captured at registration time outside the slot render path (e.g. the `/model` command description in the command registry) keeps the language it was registered under until re-registration; slot-rendered copy follows switches live.
> - **Language packs own language-specific behavior** — the registry supplies selection, persistence, browser matching, key fallback, and `<html lang>`; it does not add plural rules or bidirectional layout."

### 3.8 How the theme reaches the DOM (what the plugin can rely on)

Two writers, same fields, in sequence:

**Pre-plugin** (`ui-theme/src/boot-theme.ts:13-22`) — an inline script immediately after the opening `<body>` tag (`:36`):
```js
document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
document.body.toggleAttribute('data-ds-dark-theme', dark)
document.body.style.setProperty('--dsh-content-font-size', '14px')
```

**After activation** (`ui-layout/src/client/theme-presenter.ts:41-56`) — `ThemePresenter.apply(snapshot)`:
1. `document.documentElement.style.colorScheme = snapshot.active.colorScheme` (`:43`)
2. `body.setAttribute(DARK_ATTRIBUTE, '')` when dark, else `removeAttribute` (`:45-46`) — `DARK_ATTRIBUTE = 'data-ds-dark-theme'` (`:14`)
3. `body.style.setProperty('--dsh-content-font-size', \`${snapshot.fontSize}px\`)` (`:47`) — `CONTENT_FONT_SIZE_VARIABLE` (`:17`)
4. Retract the previous token set, then `body.style.setProperty(name, value)` for every entry of `snapshot.active.tokens` (`:48-53`)
5. `meta[name="theme-color"]` set from `getComputedStyle(body).backgroundColor` (`:54`)

`dispose()` retracts exactly and only what the presenter wrote — `color-scheme`, the attribute, the font-size variable, its own token set, and its meta node (`:58-67`); the class doc at `:8-9` states "foreign attributes, metadata, and inline styles survive."

`ui-layout/README.md:34`:
> "The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--dsh-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background."

**Consequences for a plugin:**
- Every `--dsw-alias-*` value is resolvable from any element in `document.body` — no `:root` lookup, no JS.
- A third-party theme's overrides arrive as **inline styles on `body`**, which beat any stylesheet rule of equal specificity. A plugin cannot override them by re-declaring the same variable on `body` in CSS.
- The dark selector to test against is exactly `body[data-ds-dark-theme]` (presence, empty value) — but a feature plugin must not write it (§3.1, `docs/web-styling.md:18`).
- `--dsh-content-font-size` is an inline `body` style, so a plugin reading it in JS should use `document.body.style.getPropertyValue('--dsh-content-font-size')`, exactly as `ui-theme/src/client/index.ts:371` does.

---

## 4. Could not determine / not verifiable

1. **No `--dsw-*` radius tokens exist.** Verified by grep for `--dsw-*radius*` and `--dsw-radius` across the checkout — zero matches. **Not** a mapping gap I can close; DSH simply does not tokenize radii. The Agent Note confirms this was deliberate for spacing/sizes (`.agents/notes/implemented/process/2026-07-19-web-styling-system.md:21`: "Font sizes/spacing are not tokenized … tokenization covers only colors/radii/motion/font stacks/shadows" — note this line claims radii *are* tokenized, which the current source contradicts; the 2026-07-22 banner at `:5` supersedes the token table and I found no radius tokens in the replacement).

2. **No token for `--accent-soft`.** Grep for any accent-tinted translucent alias returns only hue-unrelated neutrals (`--dsw-alias-interactive-bg-hover-accent` is grey). The `color-mix` pattern at `ui-dockkit/src/components/dockkit.module.css:581` is a precedent, not a token.

3. **No token for letter-spacing or `text-transform`.** Not found in any sheet. DSH writes both per component.

4. **`--dsw-font-mono` is referenced but never defined.** Five call sites, zero declarations. I could not determine whether this is a known defect or an intentional implicit contract; it is not in `ui-theme/README.md`'s "Known Limitations" section. Do not depend on it.

5. **No 30px radius, and no drawer-radius precedent.** Nearest shipped values are 28px / 24px / 22px / 20px. I did not find any design note fixing a drawer radius.

6. **No tokenized "message body line-height 1.72".** The closest is `--dsw-font-markdown-base` at 14/24 = 1.714. DSH's own bubble uses 14/22 = 1.571. Both are real; neither is exactly 1.72.

7. **`--dsh-chat-content-width`** is read at `ui-chat/src/client/chat/MessageItem.module.css:21` with a `748px` fallback, but I did not locate its declaration — it is outside `ui-theme/src/styles/` and I did not trace its publisher.

8. **No machine gate enforcing "no literal colors in feature CSS."** I searched `scripts/` and found no token/literal-color verification script. The constraints that *are* machine-enforced are the two ui-theme specs (elevation/border pairing at `elevation-styles.client.spec.ts`, corner-shape pairing at `corner-shape-styles.client.spec.ts`) plus `verify-client-ui-i18n`. The `--dsw-alias-*`-only rule is enforced by review and by the package READMEs, not by a script I could find.

9. **`packages/AGENTS.md` contains no styling rules.** The task asked me to extract styling rules from it; I read it and it governs plugin export form, service definitions, `./invariant` publication, naming, and tsconfig layout. The rules live in `packages/client/AGENTS.md`, `docs/web-styling.md`, and the styling Agent Note instead. I did not invent a `packages/AGENTS.md` styling section.

---

## 5. Recommended conversion of the prototype block

The prototype's single `--bg`-style dark palette becomes a scheme-agnostic semantic block. Radii, letter-spacing, and the accent-soft tint are declared locally because DSH has no tokens for them.

```css
/* Palette: DSH semantic aliases only. No literal colors. */
.card {
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l2);   /* 0.5px is mandatory */
  border-radius: 16px;                             /* local; no DSH radius token */
  color: var(--dsw-alias-label-primary);
}

.card:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* Elevated variant: no border at all, stroke lives in the shadow. */
.popover {
  border: 0;
  border-radius: 20px;
  background: var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.hint { color: var(--dsw-alias-label-tertiary); }
.meta { color: var(--dsw-alias-label-secondary); }

/* Accent: brand-primary is near-black/near-white here — do NOT use it. */
.accentFill { background: var(--dsw-alias-brand-primary-new-colorprimary-new-color); }
.accentSoft {                       /* the --accent-soft role, DSH-sanctioned form */
  background: color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 8%, transparent);
  border-color: var(--dsw-alias-brand-primary-new-colorprimary-new-color);
}

/* Full-round shapes opt out of the superellipse. */
.pill { border-radius: 999px; corner-shape: round; }

/* Message body — rides the user's content font size. */
.body {
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(24px + var(--dsh-content-font-delta, 0px));  /* ≈1.71 */
}
.secondary {
  font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}
.micro {
  font: var(--dsw-font-xxxs-strong-11);          /* 500 11px/14px */
  text-transform: uppercase;                     /* local; no token */
  letter-spacing: 0.04em;                        /* DSH's tracking, not 1.3px */
  color: var(--dsw-alias-label-caption);
}
.code { font-family: var(--ds-font-family-code); }  /* --dsw-font-mono does not exist */

@media (prefers-reduced-motion: reduce) {
  .card, .popover { transition: none; }
}
```

---

## 6. File index

| Path | Relevance |
|---|---|
| `docs/web-styling.md` | Authoritative styling rules (30 lines) |
| `packages/client/AGENTS.md` | Styling + localization rules for the client stack |
| `packages/client/ui-theme/README.md` | Token-sheet ownership, elevation/corner-shape contracts, `ctx.theme` extension point |
| `packages/client/ui-theme/src/styles/base.css` | Font stacks + motion |
| `packages/client/ui-theme/src/styles/corner-shape.css` | Superellipse token |
| `packages/client/ui-theme/src/styles/design-platform.css` | All static + alias tokens, both schemes |
| `packages/client/ui-theme/src/styles/scrollbar.css` | Scrollbar rebind contract |
| `packages/client/ui-theme/src/styles/gradient-shadow-text.css` | Elevation, content-font axis, typographic ladder |
| `packages/client/ui-theme/src/styles/shiki.css` | Syntax palette (literal hexes) |
| `packages/client/ui-theme/src/theme-settings.ts` | Font-size range/default |
| `packages/client/ui-theme/src/boot-theme.ts` | Pre-plugin DOM writes |
| `packages/client/ui-theme/src/client/index.ts` | `ThemeRuntime`, `ctx.theme`, dictionary registration |
| `packages/client/ui-theme/tests/elevation-styles.client.spec.ts` | Enforces hairline + no border-with-elevation |
| `packages/client/ui-theme/tests/corner-shape-styles.client.spec.ts` | Enforces full-round pairing |
| `packages/client/ui-theme/tests/stylesheet-scan.ts` | Package-wide CSS discovery |
| `packages/client/ui-layout/src/client/theme-presenter.ts` | Snapshot → DOM projection |
| `packages/client/ui-layout/README.md` | Theme presentation contract |
| `packages/client/locale/README.md` | Localization mechanism + limits |
| `packages/client/locale/src/client/index.ts` | `register` / `bind` / `addLanguage` |
| `packages/client/ui-slots/src/index.ts` | `LocaleNamespaceMap`, `TranslateNS`, the `t` seat |
| `scripts/verify-client-ui-i18n.ts` | The i18n gate's exact rejection rules |
| `.agents/notes/implemented/process/2026-07-19-web-styling-system.md` | Framework rationale (CSS Modules + clsx, no Tailwind) |
