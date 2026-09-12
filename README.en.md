# dsh-plugin-mobile-ui

A mobile-first UI for the DeepSeek Harness (DSH) web client, shipped as an official
slot-based client plugin: no DSH source changes, no dsh-tether fork, no `sidebar`
takeover.

English · [中文](README.md)

Status: usable on a phone (2026-09-12; verified against a physical-device screenshot
and driven CDP measurements). Portrait 320–430px and landscape 915×412 are covered;
mouse-primary desktops are untouched.

```
Connecting the phone to the computer is dsh-plugin-tether's job. This plugin only
makes the result usable on a phone.
```

## Install

```sh
git clone https://github.com/loeissu/dsh-plugin-mobile-ui.git
cd dsh-plugin-mobile-ui
npm install
npm run bundle          # required: lib/ is not committed, an unbuilt clone does nothing
npm run verify          # optional: checks the artifact against DSH's loader contract
dsh plugin --profile web add .
```

Then **restart `dsh web`** — plugins are scanned at startup, and installing without a
restart fails silently.

`dsh plugin --profile web list` should show `dsh-plugin-mobile-ui`.

## After a change

```sh
npm run bundle
```

**Refresh the phone page** — no restart needed: `dsh-client-hmr` notices the rebuilt
bundle and pushes it to the client (every verification in this repo works that way).
Without that plugin in your profile, restart `dsh web`.

## Using it on a phone

| Goal | How |
|---|---|
| Open navigation | Tap the **导航** text tab at the left of the header (it replaces ☰) |
| Close it | Tap the scrim / swipe left >72px inside the panel / × / Esc |
| Switch workspace or session | Grouped list: just now / today / yesterday / earlier |
| New session | **＋** at the foot of the panel |
| Host settings | **设置** at the foot of the panel; swipe left/right there to change section |
| Connection looks stuck | **刷新连接** replaces the mux socket; if the liveness probe proves the link is down, the button becomes **重试** and retries on its own every 4s (15s after the first minute) until the link is back |
| Connection state | Dot in the panel foot: blue = connected, pulsing = connecting, grey = disconnected, dark ring = link down |
| Tool output | Cards are collapsed by default; **failed cards open themselves** |
| Landscape | Same mobile UI as portrait — drawer, hit areas and settings page included |

**Why a retry, and why it does not reload.** On a phone the page is served from
tether's own loopback proxy, so the app socket's peer is the phone, not the computer.
When the app is backgrounded the P2P tunnel behind that proxy can die while the local
socket keeps connecting instantly: the state returns to "connected" and nothing reaches
the host. A tap therefore probes the link for real (it fetches this page and requires
the answer to have come from the host) and only then switches the button to **重试**.

**Not reloading was learned from a device.** With the proxy gone, `location.reload()`
cannot even fetch the document and the WebView lands on Chrome's error page
(`net::ERR_SOCKET_NOT_CONNECTED`, reported with a screenshot) — an app to kill and
reopen. A retry costs one request, survives the outage, and reconnects by itself the
moment tether rebuilds the proxy/tunnel; the page never leaves. While the link is down
it retries every 4s (15s after the first minute), and a tap retries immediately.

## Feature flags

`FEATURES` in `src/client/config.ts`:

| Flag | Default | Effect |
|---|---|---|
| `splash` | `true` | Splash screen (700ms cold / 120ms warm, 4s cap) |
| `drawerOverlay` | `true` | The overlay drawer — the only navigation entry point |
| `settings` | `true` | The 移动端 settings section **and** the host settings dialog's phone layout |
| `toolCards` | `['pwsh','read','grep','edit','write']` | Tool cards — see the trade-off below |
| `keyboardFit` | `true` | Soft-keyboard occlusion via `visualViewport` |
| `tetherCompat` | `true` | Counter-rules for two layout accidents caused by tether's injected sheet |
| `typography` / `conversationChrome` / `settingsSwipe` | `true` | Type scale / host conversation hit areas / settings swipe |
| `resumeReconnect` | `true` | Reconnect when the page returns to the foreground |
| `keyboardDebug` / `replaceSidebar` | `false` | Diagnostic overlay / sidebar takeover (**conflicts with the project's constraints — do not enable**) |

## Verification

```sh
npm run verify                       # offline: loader contract + staleness guard
node tools/verify-render.mjs <url>   # with a browser: assertion suites over CDP
```

`<url>` is the token URL, e.g. `http://127.0.0.1:3080/?token=<TOKEN>` (from the
`dsh web` output or `H:\DSH\dsh-web.log`).

`tools/` holds 30 assertion suites, all passing, plus probes. The names say what they
cover: `verify-drawer-overlay`, `verify-nav-tab-locale`, `verify-refresh-honesty`,
`verify-tap-targets`, `verify-conversation-chrome`, `verify-settings-chrome`,
`verify-swipe-and-landscape`, `verify-keyboard-fit`, `verify-toolcards` and so on.
`tools/retired/` holds three scripts that assert abandoned designs (sidebar takeover,
push layout, left-edge open); see its README.

## Known trade-offs and limits

- **Tool cards replace four shipped ones.** `read/grep/edit/write` are replacement
  registrations at a lower priority, so the shipped cards never render and their
  "view in trajectory" and file-open controls go with them. Set `toolCards` to `[]` to
  keep every shipped card (`pwsh` is purely additive).
- **Keyboard/IME behaviour is CDP-derived, not measured on a device.** `viewport.ts`
  works from `visualViewport`; long-press selection and IME shape differences may
  still surprise.
- **Long-press selection vs scrolling** was verified under emulation only.
- **The native splash patch** (`docs/android-native-splash.md`) is complete but
  unapplied — it needs an Android build environment, which this repo does not carry.
- **No CI and no unit tests**: verification is `npm run verify` plus the CDP suites.

## How it works (one screen)

The artifact is a single IIFE registered through
`window.__ModuleLoader__.load({ id, factory })`, exporting `apply` / `inject`:

```ts
export const inject = ['slots', 'layout', 'uiWorkspace', 'connection']
```

All four services are **required**: if one is missing the plugin does not apply at all
rather than degrading locally.

Surfaces: `shell.overlay` ×2 (splash, drawer), `settings.section` (the 移动端
section), `tool.call.toolview` keyed ×5 (tool cards), `sidebar` single (takeover, off by
default).

Polishing the host's own chrome (settings dialog layout, session title room, hit
areas, tether counter-rules) registers no slots: it injects **tagged stylesheets**
(`<style data-plugin-css="dsh-mobile-ui/…">`) plus a little runtime measurement, all
scoped by `data-slot` anchors and by CSS-Module local-name **suffixes** — never by the
rotating hash prefix.

## Docs

- **[docs/MOBILE-UI-GUIDE.md](docs/MOBILE-UI-GUIDE.md)** — the main usage/maintenance guide.
- **[docs/2026-09-12-upgrade-and-maintenance.md](docs/2026-09-12-upgrade-and-maintenance.md)** — DSH / tether upgrade impact and checklist.
- **[docs/README.md](docs/README.md)** — index of every document, marked current or historical.

## Licence and disclaimer

MIT. Not affiliated with DeepSeek; no DeepSeek names, logos or brand assets are used.
Every colour comes from the running DSH's own `--dsw-alias-*` semantic tokens, so the
plugin carries no design assets. It only adds to official slots and applies
deliberately scoped layout/hit-area polish to host chrome; it never modifies DSH
sources and never forks dsh-tether.
