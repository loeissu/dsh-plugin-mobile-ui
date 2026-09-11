# dsh-plugin-mobile-ui

**A mobile-first UI for the DeepSeek Harness Web client — built as an official DSH client plugin. No fork, no CSS injection.**

English · [中文](README.md)

> **Status: working, verified implementation.** Two additive surfaces ship enabled — a boot/transition **splash** (`shell.overlay`) and a **settings page** (`settings.section`). A **tool card** (`tool.call.toolview`) and a **navigation drawer** (`sidebar`) are fully implemented and proven to render, but ship **disabled** because both REPLACE shipped surfaces. See [Opt-in replacement surfaces](#opt-in-replacement-surfaces).

---

## Contents

- [What this is / is not](#what-this-is--is-not)
- [Three findings](#three-findings)
- [Quick start](#quick-start)
- [Verify it actually works](#verify-it-actually-works)
- [How it works](#how-it-works)
- [Opt-in replacement surfaces](#opt-in-replacement-surfaces)
- [Version compatibility](#version-compatibility)
- [Development](#development)
- [Caveats](#caveats)
- [Known limitations and blockers](#known-limitations-and-blockers)
- [Repository layout](#repository-layout)
- [License and notices](#license-and-notices)

---

## What this is / is not

**It is:** an npm package that follows DSH's official client-plugin contract. It registers UI through `ctx.slots.register()`, the exact same mechanism DSH's own ~40 client plugins (`ui-sidebar`, `ui-chat`, `ui-tool`, …) use.

**It is not:**

| Not | Why it matters |
|---|---|
| A fork of dsh-tether | dsh-tether keeps owning the P2P connection layer; this plugin owns UI only. Both install side by side, neither is modified |
| CSS injection | dsh-tether's current narrow-screen fit does `replace('</head>', '<style>…')`. This uses the typed, official extension points instead |
| A DSH patch | DSH source is unmodified and runs as shipped |
| A replacement for dsh-tether | There is no connection layer here. Installed alone, it will not connect your phone to anything — it only changes the interface |

> **Prerequisite:** this plugin is UI only. To connect a phone to your machine you still need `dsh-plugin-tether`. They are complementary.

---

## Three findings

All three are backed by executed evidence, not inference.

### 1. DSH's UI is plugin-based, and the slots are a public extension point

DSH is a public MIT repository (`github.com/deepseek-ai/deepseek-harness`; its own tagline: **"DeepSeek Harness: Everything is a Plugin."**). The frontend is React 18.3 + Vite 6 + TypeScript, split across ~40 `@deepseek-ai/dsh-client-ui-*` packages composed by a compile-time-checked slot registry.

The official docs (`docs/subsystems/slots.md`) state:

> Treat `single` and an occupied keyed cell as replacement points. Use list ids or an unoccupied key for additive extensions.

`list` slots take a new `id` additively; `single` and already-occupied `keyed` slots are **replacement points**. The `tool.call.toolview` type comment says the same: a key the shipped composition covers is *replaced, not shared*.

**This is a supported extension path, not a hack.**

### 2. The two DSH versions differ so little that one plugin serves both

Measured against `0.1.2-rc.1` (bundled by the phone's local mode) and `0.1.5-rc.1` (the desktop version):

| | Count |
|---|---|
| Slots in `0.1.2-rc.1` | 51 |
| Slots in `0.1.5-rc.1` | 61 |
| **Common** | **48** |
| **Common with a changed signature (`kind`/`scope`)** | **0** |
| Added in 0.1.5 only | 13 |
| Present in 0.1.2 only (removed) | 3 |

Every slot the design needs (`shell.overlay`, `tool.call.toolview`, `conversation.composer`, `sidebar`, `settings.section`, `conversation.session.header`) is among the 48 common ones.

### 3. A version mismatch degrades silently; it does not crash

`ui-renderer/src/client/registry.ts:201`:

```ts
const reconcile = (): void => {
  if (stopped) return
  const spec = this._core.specDynamic(key)
  const epoch = this._core.declarationEpoch(key)
  if (active !== undefined && activeEpoch === epoch) return
  const dispose = active
  active = undefined
  activeEpoch = undefined
  dispose?.()
  if (spec === undefined) return          // ← slot undeclared: return, callback never runs
  const disposeEffect = ctx.effect(callback, `slots.inject(...)`)
  active = () => { void disposeEffect() }
  activeEpoch = epoch
}
```

`ctx.slots.inject(key, cb)` simply waits when `key` is undeclared. So on a `0.1.2` host this plugin neither white-screens nor errors — it just renders nothing for the few `0.1.5`-only slots.

> ⚠️ **This holds for `inject` only.** A bare `ctx.slots.register()` into an undeclared slot throws `slot "X" is not declared`. **Always wrap `register` in `inject`.**

---

## Quick start

### Requirements

| Item | Requirement |
|---|---|
| DSH | `0.1.2-rc.1` … `0.1.5-rc.x` (the verified range) |
| Node | `^22.19 \|\| >=24` (DSH's own requirement) |
| Phone↔machine connection (optional) | Install `dsh-plugin-tether` separately; this plugin provides no connection |

### Install

**A — from a clone (the only option until this is published)**

```sh
git clone https://github.com/loeissu/dsh-plugin-mobile-ui.git
cd dsh-plugin-mobile-ui

# 2. Build — REQUIRED. lib/ is not committed.
npm install
npm run bundle

# 3. Self-check the artifact against DSH's loader contract
npm run verify

# 4. Install into your DSH profile
dsh plugin --profile web add .
```

> **Why a build is mandatory:** `lib/` is generated output and is excluded by `.gitignore`. The DSH loader serves `lib/client.js` straight off disk at `/plugins/dsh-plugin-mobile-ui/client.js`, so an unbuilt clone installs and then **does nothing at all**.

**B — from npm (not yet published)**

```sh
dsh plugin --profile web add dsh-plugin-mobile-ui
```

> `--profile web` is the profile holding the Web GUI. Substitute your own profile name if different.

### Restart is required

Plugins are scanned at **startup**. Restart `dsh web` after installing:

```sh
# stop the running dsh web (Ctrl+C), then
dsh web
```

> **Installing without restarting means it silently does nothing.** This is the most common "I installed it and nothing happened" cause.

### Confirm the install

```sh
dsh plugin --profile web list
```

`dsh-plugin-mobile-ui` should appear in the dependency list.

If you instead see:

```
dsh: warning: dsh-plugin-mobile-ui declares no dsh.bundle — installed as a plain dependency, not a profile layer
```

then `dsh.bundle.patch` is missing from `package.json` (see [How it works](#how-it-works)) and the plugin will **not** activate.

### Uninstall

```sh
dsh plugin --profile web remove dsh-plugin-mobile-ui
```

Then restart `dsh web`.

---

## Verify it actually works

Don't stop at "it installed" — confirm it reached the **boot graph**. The commands below were actually run during this project's research.

### Offline check (no browser)

`verify-bundle.mjs` evaluates the built bundle against a stub `window.__ModuleLoader__` and asserts the loader contract:

```sh
npm run verify
```

Expected:

```
loader calls: 1
id: dsh-plugin-mobile-ui
factory: function
externals requested: react, react/jsx-runtime
exports: apply, inject
inject: ["slots"]
slots injected: ["shell.overlay"]
registered -> name=shell.overlay id=mobile-ui-splash order=10 component=function

RESULT: bundle satisfies the loader contract
```

It catches three common mistakes: React **bundled instead of externalized** (visible in `externals requested`, and in an inflated bundle size), a missing `__ModuleLoader__.load` shell (`loader calls` ≠ 1), and missing `apply`/`inject` exports.

### End-to-end check (plugin in the browser boot graph)

```sh
# 1. Boot a separate instance and capture the tokenized URL
dsh web --port 3099 --no-open
# prints: dsh web: http://127.0.0.1:3099/?token=<TOKEN>

# 2. Exchange the token for a cookie (expect 303 + set-cookie)
curl -sS -i "http://127.0.0.1:3099/?token=<TOKEN>" | head -20

# 3. Fetch the index with that cookie and count the plugin id
curl -sS -H "Cookie: <the set-cookie value>" http://127.0.0.1:3099/ \
  | grep -o 'dsh-plugin-mobile-ui' | wc -l
```

Any count **> 0** means the plugin is in `window.__DSH_BOOT__`. Measured here: **5 occurrences**, with the combo URL containing `dsh-plugin-mobile-ui/client.js`.

To confirm the bundle is really served:

```sh
curl -sS -o combo.js -w "%{http_code} %{size_download}\n" "http://127.0.0.1:3099/plugins/??...&rev=..."
grep -c '__ModuleLoader__.load({ id: "dsh-plugin-mobile-ui"' combo.js
```

Measured: HTTP **200**, **11,083,654 bytes** (that is the whole application combo containing all of DSH's frontend plugins, not just this one).

---

## How it works

### A client plugin needs **two** declarations

This was the first trap hit during research, and the most likely cause of "installed but nothing happens".

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-renderer"]
    }
  }
}
```

| Declaration | Purpose | If missing |
|---|---|---|
| `dsh.bundle.patch` | Makes the DSH Loader mount this package as a **profile layer** with a host entry | CLI warns "installed as a plain dependency"; the plugin **never activates** |
| `dsh.client` | Makes `dsh-client-modules` scan the entry into `window.__DSH_BOOT__` and serve the browser half at `/plugins/<package>/client.js` | The host row exists but there is no browser code, so no UI appears |

### The browser half is a closure-factory bundle

DSH's module system uses no import map. Each plugin bundle is a self-wrapped CJS file:

```js
window.__ModuleLoader__.load({ id: "dsh-plugin-mobile-ui", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  /* your code */
  exports.apply = apply;
  exports.inject = inject;
  return module.exports;
} });
```

`require` is injected by the shell and resolves only the **frozen module table**:

```ts
// packages/client/web/src/platform.ts
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const
```

**A plugin must not carry its own React** — the shell seeds the single React instance; a second copy breaks hooks. The build's `external` list must match this table exactly.

### Registration

```tsx
export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'mobile-ui-splash', order: 10 },
      Splash,
    ))
}
```

`shell.overlay` is a `list` slot (additive). The official comment on it:

> Frame-wide floating layer, above every column and outside their scroll containers. Deliberately generic and unowned by any feature […] The layer itself is click-through — entries opt back into pointer events.

A frame-wide, click-through overlay above every column is exactly where a boot splash belongs.

---

## Opt-in replacement surfaces

This plugin registers four surfaces: two **additive** (on by default) and two **replacement** (off by default).

| Surface | Slot | kind | Effect of registering | Default |
|---|---|---|---|---|
| Splash | `shell.overlay` | list | a new `id` sits beside the shipped cells | ✅ on |
| Settings | `settings.section` | list | one more settings page | ✅ on |
| Tool cards | `tool.call.toolview` | keyed | **REPLACES** that tool's shipped card | ⛔ off |
| Drawer | `sidebar` | single | **REPLACES** the whole navigation column | ⛔ off |

The flags live in `src/client/config.ts` → `FEATURES`.

### Why the replacement surfaces are off

DSH's slot contract treats `single` and an already-occupied `keyed` cell as replacement points:

> Treat `single` and an occupied keyed cell as replacement points. Use list ids or an unoccupied key for additive extensions.

- **`toolCards`** — naming a tool takes over its card. `['bash']` means `bash` **loses DSH's own terminal card** and gets the generic card here instead. Empty by default, so nothing is displaced.
- **`replaceSidebar`** — `sidebar` is occupied by ui-sidebar, whose declaration states that registering there "replaces the navigation column outright rather than adding to it, and the seats it declares disappear with it". A takeover must re-declare and re-render `sidebar.workspaces`, `sidebar.settings`, `sidebar.brand.*` and `sidebar.footer.action`, or the user **loses workspace switching and the settings entry point**. `Drawer.tsx` does exactly that (`DRAWER_CHILDREN`), but it has **not been verified on a device**, and the cost of being wrong on a phone is having no way back. Hence the default.

### Enabling the drawer

```ts
export const FEATURES = {
  splash: true,
  settings: true,
  toolCards: ['bash', 'pwsh'],   // ← empty array = replace nothing
  replaceSidebar: true,          // ← take over the navigation column
} as const
```

Then rebuild and restart:

```sh
npm run bundle && npm run verify
# restart dsh web
```

Once enabled, confirm three things immediately: workspace switching works, settings opens, and the session list is present. If any is missing, set `replaceSidebar` back to `false` and rebuild — this is not a persistent breakage.

---

## Version compatibility

| DSH version | Supported | Note |
|---|---|---|
| `0.1.2-rc.1` | ✅ | Bundled by the phone's local mode. `shell.overlay` exists; the splash renders |
| `0.1.5-rc.1` / `0.1.5-rc.2` | ✅ | Current desktop version. Verified in the boot graph and served |
| Earlier (`0.1.0-rc.x`, `0.1.1-rc.x`) | ⚠️ Untested | No slot comparison was run |
| Later | ⚠️ Untested | DSH is in developer preview; the slot contract may evolve |

### Using `0.1.5`-only slots

Of the 13 added slots, the design would use `conversation.session.header.corner` (a header entry point). Registering it:

- On a `0.1.5` host: renders normally
- On a `0.1.2` host: that contribution **silently does not render**; everything else works
- Neither case errors

So it is safe to use — you only have to accept the degradation.

### Authoritative source for the slot contract

Slot count and naming are **not** the contract. The docs point at the generated Client inspect catalog, and a running dynamic package can query the live tree:

```
cordis_inspect what:"client"
```

Check that before implementing new features rather than trusting the tables in these docs.

---

## Development

### Build

```sh
npm install
npm run bundle
```

| File | Format | Role |
|---|---|---|
| `lib/index.js` | ESM | Node half — gives the Loader a host row |
| `lib/client.js` | CJS + closure factory | Browser half |

### The build's load-bearing detail

```ts
{
  format: 'cjs',
  platform: 'browser',
  // ★ top-level external — NOT deps.neverBundle
  external: (specifier) => PLATFORM_MODULES.includes(specifier),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "${ID}", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
```

> ⚠️ **Trap on record:** DSH's in-repo preset uses `deps: { neverBundle, alwaysBundle }`, which is a **different bundler's** (rolldown's) config surface. tsdown 0.15 uses top-level `external` / `noExternal` and **silently ignores** `deps.*`. The first version of this plugin therefore bundled React (16.26 kB, containing `Symbol.for("react.element")`). Switching to top-level `external` dropped it to **5.76 kB** with externals exactly `react, react/jsx-runtime`.

### Rebuild then verify, every time

```sh
npm run bundle && npm run verify
```

After a bundle change, a **running dsh web must be restarted** (or the `@deepseek-ai/dsh-client-hmr` chain must be running) to pick it up. The registry serves the `lib/client.js` file contents, not your sources.

---

## Caveats

### 🔴 Security

**1. This repository contains no credentials.** Neither the build nor the verification uses or stores a token. Please also never commit tokens, `.env` files, `hosts.json`, `identity.key`, and similar.

**2. Never commit DSH runtime data.**

| Path | Contains |
|---|---|
| `$DSH_HOME/.credentials.yaml` | Model API keys |
| `$DSH_HOME/settings.yaml` | Possibly base URLs and model config |
| `$DSH_HOME/profiles/*/node_modules/` | Dependencies, possibly with local link paths |
| `$DSH_HOME/.anonymous-user-id` | Anonymous identity |

**3. This plugin changes your interface.** It floats a splash over everything. If it ever appears somewhere it should not (e.g. covering a DSH dialog), lower the `order` or remove the registration.

**4. Client plugins run in the browser context.** A client plugin can read everything on the page. Installing a third-party client plugin is equivalent to trusting its author — install only code you have reviewed.

### 🟡 Usage

**5. `inject` and `register` go together.** A bare `register` into an undeclared slot **throws** (it is not a silent skip). Always use `ctx.slots.inject(key, () => ctx.slots.register(...))`.

**6. Replacing a slot removes the seats it declared.** Registering into `sidebar` (`single`/`root`) replaces the **entire navigation column**, taking `sidebar.workspaces`, `sidebar.settings` and friends with it — the replacer must render them back.

**7. `shell.overlay` is click-through.** After the splash fades it must **actually unmount** (`return null`). Setting only `opacity: 0` leaves an invisible overlay still swallowing taps.

**8. Do not hardcode theme colors.** Use DSH's semantic tokens (`--dsw-alias-*`). Two counter-intuitive traps:
   - `--dsw-alias-brand-primary` **is not blue** — it resolves to near-black / near-white. Use `--dsw-alias-brand-primary-new-colorprimary-new-color` for the accent.
   - DSH has **no radius tokens at all**; radii are plain numbers.

   See `docs/02-theme-token-mapping.md`.

**9. Product copy goes through the locale dictionary.** DSH's `verify-client-ui-i18n` gate rejects hardcoded copy — including JSX text and `aria-label`-style attributes.

**10. Restart `dsh web` after installing or rebuilding.** Plugins are scanned at startup, and a stale bundle produces **no error at all**.

### 🟢 Using this alongside dsh-tether

**11. They are complementary and do not conflict.** dsh-tether owns P2P and local mode; this plugin only registers UI slots. Installing both into one profile is fine (verified: their registrations do not overlap).

**12. In remote mode the phone loads the desktop's DSH.** Install the plugin in the **desktop profile**; nothing is needed on the phone.

**13. In local mode DSH runs on the phone** at the version bundled in the APK (`0.1.2-rc.1`). This plugin is verified compatible with it.

---

## Known limitations and blockers

### 🔴 Do not bump dsh-tether's `androidRuntime.dsh` to 0.1.5

If you are considering moving dsh-tether's bundled local-mode DSH from `0.1.2-rc.1` to `0.1.5-rc.1`: **it currently breaks local mode.**

`0.1.5` added a per-session write lease to `dsh-session-persistence-jsonl`:

```
persistContiguous() → ensureLease() → acquireWriteLease() → SessionWriteLease.acquire()
  → tryLockExclusive()   [@deepseek-ai/node-addon-system/flock]

  node-addon-system/lib/flock.js:
    if (platform !== 'linux' && platform !== 'darwin')
      throw Error('flock is not supported on ' + platform + '-' + arch)
      // code: ERR_FLOCK_UNSUPPORTED_PLATFORM
```

- `node-addon-system` has **no android platform package** (only darwin-x64/arm64, linux-x64/arm64)
- On Android Node reports `process.platform === 'android'` — a fact **dsh-tether's own CHANGELOG (v0.1.11) already relies on** (which is why a separate `dsh-tether-host-android-arm64` package exists)
- `isLockContention()` only recognises `EAGAIN` / `EWOULDBLOCK`, so the error propagates
- `0.1.2-rc.1` has **no such lock at all**

**Why it is serious:** it is not a boot failure but a **first-durable-write failure** — it surfaces after startup, which makes it harder to diagnose.

**Status:** the chain is fully documented (read from shipped artifacts + Node's `process.platform` semantics + dsh-tether's own CHANGELOG) but was **not reproduced on hardware**. Two cheap steps to reproduce:

```sh
# on Android / Termux
node -p "process.platform"        # expect: android
# then run one session write against the 0.1.5 runtime tree
```

Full evidence in `docs/03-tether-0.1.5-bump-report.md`.

### 🟡 Other

**14. Not verified on a real Android WebView.** The end-to-end verification here stops at **boot-graph injection and bundle serving in a desktop browser context**. Rendering, keyboard occlusion and soft-keyboard behaviour on a device are **not yet verified**.

**15. Only the splash is implemented.** Drawer, tool cards, settings page and floating composer exist as design plus slot mapping only (`docs/01-final-plan.md`).

**16. `0.1.5-rc.1` does not resolve to `0.1.5-rc.1`.** Sub-packages use caret ranges on prereleases (e.g. `^0.1.5-rc.1`) and the build script passes `--no-package-lock`, so the real tree is `1 × 0.1.5-rc.1 (the CLI) + 230 × 0.1.5-rc.2`. The same `package.json` can build different trees.

**17. The first-load combo is ~11 MB.** Perceptible on mobile networks; the splash should show progress rather than a static logo.

**18. No automated tests.** `verify-bundle.mjs` is the only contract check. No unit tests, no CI.

---

## Repository layout

```
dsh-plugin-mobile-ui/
├── package.json            # both declarations: dsh.bundle.patch + dsh.client
├── cordis.patch.yml        # profile layer: one insert row mounting this package
├── tsdown.config.ts        # Node ESM half + browser CJS half
├── verify-bundle.mjs       # browser-free loader-contract verifier
├── LICENSE                 # MIT
├── README.md               # 中文
├── README.en.md            # this file
├── src/
│   ├── index.ts            # Node half: empty apply
│   └── client/
│       ├── index.tsx       # apply: slot registration
│       └── Splash.tsx      # splash component
├── lib/                    # committed build output (installable as-is)
│   ├── index.js
│   ├── client.js
│   └── client.js.map
└── docs/
    ├── 01-final-plan.md            # final plan: version strategy, slot design, roadmap, risks
    ├── 02-theme-token-mapping.md   # token mapping with file:line provenance
    ├── 03-tether-0.1.5-bump-report.md  # tether bump analysis + flock blocker evidence
    └── tools/
        └── slot-diff.ps1           # two-version slot comparison script
```

The `docs/` reports are written in Chinese (the project's working language).

---

## License and notices

MIT — see [LICENSE](LICENSE).

This is an **independent community project**, not affiliated with, authorised by, partnered with, or endorsed by DeepSeek, DeepSeek Harness, or the dsh-tether maintainers. The names "DeepSeek", "DeepSeek Harness" and "dsh" are used only to state compatibility.
