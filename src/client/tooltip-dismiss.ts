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
 * Build the leave event the host is listening for.
 *
 * Prefers `PointerEvent` because that is what the host's hover-intent hooks receive
 * on a real pointer device, and falls back to `MouseEvent` — which carries the same
 * coordinates-less shape and is also listened for — on engines without the
 * constructor. A missing constructor would otherwise throw inside a timer callback,
 * i.e. as an uncaught global error, for a purely cosmetic cleanup.
 * @param type - one of the four leave event names.
 * @returns the event to dispatch, or null when neither constructor exists.
 */
function leaveEvent(type: string): Event | null {
  const bubbles = type.endsWith('out')
  try {
    return new PointerEvent(type, { bubbles, composed: true })
  } catch {
    // No PointerEvent constructor on this engine.
  }
  try {
    return new MouseEvent(type, { bubbles, composed: true })
  } catch {
    return null
  }
}

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
        const event = leaveEvent(type)
        if (event !== null) target.dispatchEvent(event)
      }
      told += 1
    }
  }
  return told
}

/**
 * Install the dismissal. Disposed with the plugin.
 * @returns disposer removing the listeners.
 */
export function installTooltipDismiss(): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
  let timer: number | undefined

  const arm = (): void => {
    if (!window.matchMedia(PHONE_MEDIA).matches) return
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      releaseTooltips()
    }, TOOLTIP_LINGER_MS)
  }

  document.addEventListener('touchend', arm, { passive: true, capture: true })
  document.addEventListener('click', arm, { capture: true })

  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
    document.removeEventListener('touchend', arm, { capture: true })
    document.removeEventListener('click', arm, { capture: true })
  }
}
