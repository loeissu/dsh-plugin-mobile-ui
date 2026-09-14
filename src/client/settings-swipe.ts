/**
 * Swipe left/right on the host settings dialog to move between its pages.
 *
 * The dialog's section nav is a set of buttons (`_navCell`), and its page area
 * (`_options`) is a plain vertical scroller: on a phone the only way to change page
 * is to hit a tab, which on a five-tab strip is a small target at the top of a tall
 * dialog — exactly the kind of reach this plugin exists to remove. Swiping the
 * content sideways is the gesture a phone user already expects.
 *
 * How the page is identified: the active cell carries `aria-current="true"`
 * (measured; the host also marks it with an `_active` class, but the ARIA attribute
 * is the semantic one), so switching is "click the neighbour of the current cell".
 * Clicking is the only lever available — the page state belongs to the host — and it
 * keeps the nav strip, the URL and any future host behaviour in sync for free.
 *
 * Deliberate bounds:
 *  - no wrap-around: the ends are ends, like every tab strip;
 *  - vertical drags are never claimed (list scrolling must stay intact);
 *  - gestures that start on a control that drags horizontally itself (range inputs,
 *    the nav strip, text fields) are ignored;
 *  - only on phones, in either orientation (`PHONE_MEDIA`), which is also where the
 *    desktop dialog would otherwise offer a mouse-only affordance.
 */
import { PHONE_MEDIA } from './theme.ts'

/** Horizontal distance that counts as a page turn. */
const SWIPE_MIN_PX = 56

/** Distance before the gesture is claimed, so a tap or a jitter never switches. */
const CLAIM_MIN_PX = 24

/** How much more horizontal than vertical the gesture must be to be claimed. */
const CLAIM_RATIO = 1.5

/** The host's section buttons. */
const CELL_SELECTOR = '[role="dialog"] [class*="_navCell"]'

/** Controls that own horizontal gestures themselves. */
const IGNORE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[role="slider"]',
  '[contenteditable="true"]',
  '[class*="_navList"]',
  '[class*="_navCell"]',
].join(', ')

/**
 * Install the swipe gesture. Listeners only; disposed with the plugin.
 * @returns disposer removing every listener.
 */
export function installSettingsSwipe(): () => void {
  // A document that cannot take listeners means there is no gesture surface at all;
  // degrade to a no-op rather than throwing during plugin activation (a throw there
  // is what puts the host's "Failed to load plugins" card on screen). The offline
  // loader harness stubs `document`, and it caught exactly this.
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    return () => {}
  }

  let start: { x: number; y: number; id: number } | null = null
  let claimed = false
  let dx = 0

  const cells = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(CELL_SELECTOR)]

  const activeIndex = (list: HTMLElement[]): number =>
    list.findIndex((cell) => cell.getAttribute('aria-current') === 'true')

  const onStart = (event: TouchEvent): void => {
    start = null
    claimed = false
    dx = 0
    if (event.touches.length !== 1) return
    if (!window.matchMedia(PHONE_MEDIA).matches) return
    if (cells().length < 2) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(IGNORE_SELECTOR) !== null) return
    const touch = event.touches[0]
    start = { x: touch.clientX, y: touch.clientY, id: touch.identifier }
  }

  const onMove = (event: TouchEvent): void => {
    if (start === null) return
    // Index walk, not `[...event.touches].find(...)`: `TouchList` iteration needs
    // `Symbol.iterator`, and a spread that throws would abort the gesture mid-swipe on
    // an engine without it. `item()` is the accessor the spec guarantees.
    let touch: Touch | undefined
    for (let i = 0; i < event.touches.length; i += 1) {
      const candidate = event.touches.item(i)
      if (candidate !== null && candidate.identifier === start.id) {
        touch = candidate
        break
      }
    }
    if (touch === undefined) return
    dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (claimed) return
    if (Math.abs(dx) < CLAIM_MIN_PX) return
    // A vertical gesture belongs to the list, not to the pager.
    if (Math.abs(dx) < Math.abs(dy) * CLAIM_RATIO) {
      start = null
      return
    }
    claimed = true
  }

  const onEnd = (): void => {
    const from = start
    start = null
    if (from === null || !claimed) return
    claimed = false
    if (Math.abs(dx) < SWIPE_MIN_PX) return
    const list = cells()
    const current = activeIndex(list)
    if (current < 0) return
    // Swiping left (dx < 0) moves the content left, i.e. to the NEXT page.
    const next = dx < 0 ? current + 1 : current - 1
    if (next < 0 || next >= list.length) return
    list[next].click()
  }

  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', onEnd, { passive: true })
  document.addEventListener('touchcancel', onEnd, { passive: true })

  return () => {
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
    document.removeEventListener('touchcancel', onEnd)
  }
}
