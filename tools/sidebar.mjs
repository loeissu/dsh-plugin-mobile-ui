/**
 * Driving helper shared by the tool-card verification: open the sidebar
 * drawer, pick a session, and wait for its transcript to render.
 *
 * The sidebar is collapsed to a 56px rail by default on a narrow viewport, so
 * a session row does not exist in the DOM until the drawer is opened. Clicking
 * blindly finds nothing — the toggle has to be clicked first.
 */

/**
 * Open the sidebar drawer if it is collapsed.
 * @param evaluate - CDP evaluate function.
 * @returns what the toggle reported.
 */
export async function openSidebar(evaluate) {
  return evaluate(`(() => {
    const frame = document.querySelector('[class*="_frame"]')
    const handle = frame ? frame.querySelector(':scope > [class*="_handle"]') : null
    if (handle) return 'already-open'
    const toggle = document.querySelector('button[aria-label*="侧边栏"]')
      || document.querySelector('button[aria-label*="sidebar" i]')
    if (!toggle) return 'no-toggle'
    toggle.click()
    return 'clicked-toggle'
  })()`)
}

/**
 * Session rows in DSH's sidebar are `div` elements carrying a hashed
 * `*_sessionRow` class — not buttons — so a `button`-only query finds nothing
 * and looks like an empty sidebar. The class prefix is a CSS-Module hash, so it
 * is matched by its stable local suffix.
 */
const ROW_QUERY = `Array.from(document.querySelectorAll('[data-slot="sidebar.workspaces"] div[class*="_sessionRow"]'))`

/**
 * List the session rows now present in the sidebar.
 * @param evaluate - CDP evaluate function.
 * @returns the candidate rows.
 */
export async function listSessions(evaluate) {
  return JSON.parse(await evaluate(`(() => {
    const rows = ${ROW_QUERY}
    return JSON.stringify(rows.slice(0, 40).map((el, i) => ({
      i,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 70),
      selected: (el.className || '').includes('_selected'),
    })))
  })()`))
}

/**
 * Click the sidebar session row at a given index.
 * @param evaluate - CDP evaluate function.
 * @param index - row index from {@link listSessions}.
 * @returns the label clicked.
 */
export async function clickSession(evaluate, index) {
  return evaluate(`(() => {
    const rows = ${ROW_QUERY}
    const el = rows[${index}]
    if (!el) return 'no-row'
    const label = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50)
    el.click()
    return label
  })()`)
}
