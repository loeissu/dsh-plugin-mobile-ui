/**
 * Browser half: registers this plugin's surfaces into DSH's slot registry.
 *
 * ## The one rule that matters
 *
 * Every registration is wrapped in `ctx.slots.inject(key, () => register(...))`.
 * That is required, not stylistic:
 *
 *  - `inject` waits for the slot to be DECLARED. If the running DSH build never
 *    declares `key`, the callback simply never runs — a silent no-op. This is
 *    what makes one build safe on both `0.1.2-rc.1` and `0.1.5-rc.x`, where the
 *    slot sets differ: ui-renderer's `reconcile()` returns early when
 *    `specDynamic(key)` is undefined.
 *  - A bare `ctx.slots.register()` into an undeclared slot THROWS
 *    (`slot "X" is not declared`). It is not a silent skip.
 *
 * ## Slot semantics used here
 *
 * | slot | kind | effect of registering |
 * |---|---|---|
 * | `shell.overlay` | list | additive — a new `id` sits beside the shipped cells |
 * | `settings.section` | list | additive — one more settings page |
 * | `tool.call.toolview` | keyed | REPLACES the shipped card for that tool name |
 * | `sidebar` | single | REPLACES the whole navigation column |
 *
 * Only the two additive slots are enabled by default. See `config.ts`.
 *
 * Only `import type` is used for cross-package declarations, so no runtime value
 * import crosses a plugin boundary (DSH's client bundle purity rule).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FEATURES } from './config.ts'
import { DRAWER_CHILDREN, Drawer } from './Drawer.tsx'
import { SECTION_OPTIONS, SettingsSection } from './Settings.tsx'
import { Splash } from './Splash.tsx'
import { ToolCard } from './ToolCard.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/** Order for the splash cell; lower renders first within the list. */
const SPLASH_ORDER = 10

/**
 * Install this plugin's surfaces.
 *
 * Each surface is independent: a slot missing on the running DSH build removes
 * exactly that contribution and nothing else.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (FEATURES.splash) {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'mobile-ui-splash', order: SPLASH_ORDER },
        Splash,
      ))
  }

  if (FEATURES.settings) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(SECTION_OPTIONS, SettingsSection))
  }

  // Keyed dispatch: one registration per tool name, each REPLACING that tool's
  // shipped card. Empty by default, so nothing shipped is displaced.
  for (const toolName of FEATURES.toolCards) {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        { name: 'tool.call.toolview', key: toolName },
        ToolCard,
      ))
  }

  // `sidebar` is single/root: this takes over the entire navigation column and
  // every seat ui-sidebar declared collapses with it, which is why the entry
  // declares them as children and renders each one back.
  if (FEATURES.replaceSidebar) {
    ctx.slots.inject('sidebar', () =>
      ctx.slots.register(
        { name: 'sidebar', children: DRAWER_CHILDREN },
        Drawer,
      ))
  }
}
