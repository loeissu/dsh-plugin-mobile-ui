/**
 * Stop the host's hover tooltips from sticking on a phone.
 *
 * ## The defect this closes
 *
 * The message actions show a hover tooltip (`role="tooltip"`, a dark bubble) when the
 * pointer rests on a control. On a touch device the tap synthesises `pointerenter` but
 * never a matching `pointerleave`, so the host's hover-intent hook opens the bubble and
 * nothing ever closes it: measured after tapping 复制 on a 412x915 phone, the bubble was
 * still on screen at 1.2s, 3s, 6s and 8s, positioned over the composer. It is present in
 * a screenshot from the device.
 *
 * What does close it, measured one by one:
 *   - blurring the focused control .................... no
 *   - focusing the composer ........................... no
 *   - a synthetic pointerdown elsewhere ................ no
 *   - a real tap elsewhere in the transcript .......... yes (same thing, really)
 *   - `pointerout`/`pointerleave` on the anchor ....... yes
 *
 * So the fix is to tell the host what a mouse user's moving-away would: after a touch
 * interaction, dispatch the leave events on the tooltip's anchor. Nothing is hidden and
 * no host state is faked — the host runs its own dismissal path.
 *
 * Attribution: this is NOT caused by this plugin's stylesheets (with all eight removed
 * the bubble appears and sticks exactly the same), and on a desktop it dismisses
 * normally as soon as the pointer moves, which is why the dispatch is gated to phones.
 *
 * Timing: the host opens the bubble after its own hover delay, so the leave is sent a
 * moment later. If it lands before the bubble opens it cancels the open — which is the
 * honest behaviour for a device without hover — and if it lands after, the bubble has
 * been visible long enough to read.
 */
import { PHONE_MEDIA } from './theme.ts'

/** How long a touch tooltip may stay before the pointer is reported as gone. */
const TOOLTIP_LINGER_MS = 1200

/**
 * Report the pointer as having left the anchor of every visible tooltip.
 *
 * The anchor is resolved the way the host builds these: the tooltip is a sibling of the
 * control inside the action row (measured: `span._bubble` inside `div._actions`, whose
 * only button is the copy control). An `aria-describedby` link is used when a host build
 * provides one, and the tooltip itself is the last resort.
 * @returns how many anchors were told.
 */
function releaseTooltips(): number {
  let told = 0
  for (const tip of document.querySelectorAll('[role="tooltip"]')) {
    const box = tip.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) continue
    const id = tip.id
    const described = id === '' ? null : document.querySelector(`[aria-describedby~="${CSS.escape(id)}"]`)
    const anchors = described !== null
      ? [described]
      : [...(tip.parentElement?.querySelectorAll('button, [role="button"]') ?? [])]
    const targets = anchors.length > 0 ? anchors : [tip.parentElement ?? tip]
    for (const target of targets) {
      // Not bubbles: the host listens for the leave on the control itself, and a
      // leaving pointer does not re-enter anything on its way out.
      for (const type of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: type.endsWith('out'), composed: true }))
      }
      told += 1
    }
  }
  return told
}

/**
 * Install the dismissal. Idempotent per page; disposed with the plugin.
 * @returns disposer removing the listeners.
 */
export function installTooltipDismiss(): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
  let timer: number | undefined
  let released = 0

  const arm = (): void => {
    if (!window.matchMedia(PHONE_MEDIA).matches) return
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      released += releaseTooltips()
    }, TOOLTIP_LINGER_MS)
  }

  document.addEventListener('touchend', arm, { passive: true, capture: true })
  document.addEventListener('click', arm, { capture: true })

  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
    document.removeEventListener('touchend', arm, { capture: true })
    document.removeEventListener('click', arm, { capture: true })
    void released
  }
}
