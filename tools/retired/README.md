# Retired verification scripts

These scripts assert designs that **no longer ship**. They are kept because they
document what was tried and because the behaviour could be re-enabled deliberately —
but they are not part of the suite, and running them against the current build will
fail by design.

| Script | What it asserts | Why it is retired |
|---|---|---|
| `verify-drawer.mjs` | The `sidebar` slot **takeover**: `replaceSidebar: true`, the drawer replacing `ui-sidebar`, all six `DRAWER_CHILDREN` seats rendered | Off by default (`replaceSidebar: false`) and forbidden by the project's hard constraints — taking a `single`/`root` slot collapses every seat the host declared, and the shipped drawer is an overlay instead. `drawer-takeover.md` carries the same warning. Enable the flag to run it. |
| `verify-drawer-push.mjs` | **Push mode**: opening the drawer pads the AppFrame so the conversation slides right | The overlay drawer covers instead of pushing (deliberate: on a 412px screen, padding the frame leaves the conversation too narrow to read). Nothing sets the push flag any more. |
| `verify-drawer-edge.mjs` | Opening by dragging from a 24px **left-edge strip** (and the absence of a floating ☰) | The left-edge open was removed on purpose — it conflicted with the host's own edge gestures. The only entry point is the 导航 tab, which `verify-drawer-open.mjs` and `verify-nav-tab-locale.mjs` cover. |

Current coverage for the shipped design lives one directory up:

- `verify-drawer-open.mjs`, `verify-nav-tab-locale.mjs` — the 导航 entry point and its reservation.
- `verify-drawer-overlay.mjs`, `verify-coexistence.mjs` — the overlay skeleton and its interaction with tether's injected sheet.
- `verify-drawer-swipe.mjs`, `verify-touch-scroll.mjs` — swipe-to-close, and that the panel scrolls under touch.
- `verify-drawer-list.mjs`, `verify-drawer-new-session.mjs`, `verify-drawer-settings.mjs`, `verify-drawer-refresh.mjs`, `verify-drawer-windowing.mjs`, `verify-conn-dot.mjs` — the panel's contents.
