/**
 * Touch comfort for the host conversation's small controls.
 *
 * Everything below is the HOST's markup, not this plugin's. Measured at 412x915 on
 * the live client (DSH 0.1.5-rc.1), these are the controls a phone user taps most
 * and every one of them is well under the 44px touch minimum:
 *
 *   surface                                   painted   pitch   where
 *   message actions (复制/反馈/分支/用量/用时)   6 x 28x28   36    conversation.chat.*
 *   composer controls (指令/附件/权限/模型/上下文)   28x28     40    conversation.composer.bar
 *   send button                                 34x34     —    conversation.composer.bar
 *   host tabs (对话 / 轨迹)                      26x25     62    conversation.session.header
 *
 * The fix is a hit layer, never a resize: a pseudo-element grows the target and the
 * painted control keeps its size, so nothing moves and nothing new appears. Each
 * expansion is bounded by the neighbour's pitch — the reach only ever goes into the
 * gap, so two adjacent targets touch at most, and the row keeps a deterministic
 * winner (DOM order) instead of a dead strip between buttons.
 *
 * Anchored by `data-slot`, which is the host's published extension surface, so this
 * survives CSS-Module hash rotation. Every target was checked to have no existing
 * `::after` (all `none`) and `position: static`, so the pseudo-element is free.
 */
import { injectStyles, PHONE_MEDIA, TYPE } from './theme.ts'

const STYLE_ID = 'conversation-chrome'

/**
 * The plugin's phone condition, landscape included.
 *
 * These are hit layers only — no size, position or content changes — so applying
 * them to a phone held sideways (wide but short, coarse pointer) is exactly as safe
 * as applying them in portrait. Without it a landscape phone loses every 44px target
 * this module exists to provide, because the desktop layout comes back above 768px.
 */
const NARROW = PHONE_MEDIA

/** Every control that gets a hit layer, so the `position: relative` stays in one place. */
const TARGETS = [
  '[data-slot="conversation.chat.assistant-actions"] button',
  '[data-slot="conversation.chat.node"] button[class*="_action"]',
  '[data-slot="conversation.chat.node"] button[class*="_trigger"]',
  '[data-slot="conversation.composer.bar"] button',
  '[data-slot="conversation.input.model"] button',
  '[data-slot="conversation.session.header"] [role="tablist"] [role="tab"]',
].join(',\n  ')

const CSS = `
@media ${NARROW} {
  ${TARGETS} {
    position: relative;
  }

  /* Message actions: 28x28 on a 36px pitch, so the reach is -4px horizontally
     (36 = the pitch: adjacent targets touch) and -8px vertically, where the space
     is free — the row above is the message and the row below is the composer.
     Measured result: 35x43 by pixel walk (the far edge is exclusive, so a nominal
     36x44 measures one pixel short). */
  [data-slot="conversation.chat.assistant-actions"] button::after,
  [data-slot="conversation.chat.node"] button[class*="_action"]::after,
  [data-slot="conversation.chat.node"] button[class*="_trigger"]::after {
    content: '';
    position: absolute;
    top: -8px;
    bottom: -8px;
    left: -4px;
    right: -4px;
  }

  /* Composer: 28x28 on a 40px pitch. Horizontally ±6px lands exactly on the pitch.
     Vertically the nominal ±8px does NOT all survive: the metric dock below covers
     the band under the row, so the measured reach is ~37px (up 22, down 15). Going
     further would mean either growing the composer bar (+7px of layout) or moving
     the dock, which is a design change rather than a hit layer — so this stops at
     what the layout actually offers. */
  [data-slot="conversation.composer.bar"] button::after,
  [data-slot="conversation.input.model"] button::after {
    content: '';
    position: absolute;
    inset: -8px -6px;
  }

  /* Host tabs: 26x25 on a 62px pitch, sandwiched between the session crumb above
     and the transcript below — so the reach grows mostly SIDEWAYS, into the tab
     row's own empty width, and only 10px upward (the crumb sits 11px above).
     ::before, not ::after: the host already draws the active-tab underline
     with ::after (measured: content "" with height 2px), and taking that slot
     would delete the underline and collapse the box to 2px.
     Horizontally the reach goes RIGHT only on the first tab, because this plugin's
     own 导航 target already ends at that tab's painted left edge — expanding left
     would steal taps meant for 导航, which paints on top and would win. */
  [data-slot="conversation.session.header"] [role="tablist"] [role="tab"]::before {
    content: '';
    position: absolute;
    top: -10px;
    bottom: 0;
    left: 0;
    right: 0;
  }
  [data-slot="conversation.session.header"] [role="tablist"] [role="tab"]:first-of-type::before {
    right: -18px;
  }
  [data-slot="conversation.session.header"] [role="tablist"] [role="tab"]:last-of-type::before {
    left: -16px;
    right: -16px;
  }

  /* ── the session title row: give the title its width back ─────────────────
   *
   * Measured at 412x915: the title container gets 118px while the text needs
   * 281px, so 58% is ellipsised (at 360 it is 106 of 281), while the row's own
   * controls account for roughly 191px. Worse, the subagents chip (an 80px child)
   * is clipped by the crumb strip's overflow:hidden down to its 36px parent.
   *
   * Two occupants are removed, and only these:
   *   - the "/" separator before the subagents chip — pure decoration (5px plus
   *     the 10px flex gap that goes with it);
   *   - the mode chip (标准模式, 68px) — informational, and the same state is
   *     exposed by the composer's 访问模式 control on the same screen.
   * The subagents chip keeps its BUTTON but drops its count text, so the entry
   * stays reachable as an icon (it used to be cut mid-word: an 80px child inside
   * a 36px parent, clipped by the crumb strip).
   *
   * 打开方式 is deliberately KEPT: the 更多 menu was measured to contain only
   * "下载 Session 日志", so hiding that pair would remove the only route to it.
   */
  [data-slot="conversation.session.header"] [class*="_separator"] {
    display: none;
  }
  [data-slot="conversation.session.header"] [class*="_headerActions"] [class*="_label"] {
    display: none;
  }
  /* The chip's own text span (the icon is an svg sibling and stays). */
  [data-slot="conversation.session.header"] [class*="_trigger"] > span:first-of-type {
    display: none;
  }

  /* ── the metrics footer: stop cutting the text ────────────────────────────
   *
   * Root cause measured, and it was not the font size. The row is 370px wide with
   * 32px of horizontal padding on each side, so its content box is 306px while the
   * two pills need ~341px (each pill is an _anchor whose base size is the pill's
   * max-content width: icon + gap + label + padding). The flex line is therefore
   * 35px short and BOTH labels ellipsise: measured 140px needed inside a 107px label
   * box at 412, and 82px at 360. Two changes, neither of which moves anything that
   * carries information:
   *   - the row's side padding drops to 8px on phones (the 32px was for a wide
   *     desktop row; it is 64px of empty gutter on a 412px screen), and
   *   - the label steps down to 12px for headroom.
   * Below 380px the row may also wrap, where a second 22px line beats a cut number.
   * The grow on the anchors is kept from the investigation above: it is what lets
   * the two pills share the freed gutter evenly.
   */
  [data-slot="conversation.composer.dock"] > [class*="_root"] {
    padding-left: 8px;
    padding-right: 8px;
  }
  [data-slot="conversation.composer.dock"] > [class*="_root"] > [class*="_anchor"] {
    flex: 1 1 auto;
    min-width: 0;
  }
  [data-slot="conversation.composer.dock"] [class*="_label"] {
    font-size: ${TYPE.caption};
  }
  @media (max-width: 380px) {
    [data-slot="conversation.composer.dock"] > [class*="_root"] {
      flex-wrap: wrap;
      row-gap: 2px;
    }
  }
}
`

/**
 * Install the conversation hit layers. Stylesheet only, no listeners, and inert
 * above the phone breakpoint.
 */
export function installConversationChrome(): void {
  injectStyles(STYLE_ID, CSS)
}
