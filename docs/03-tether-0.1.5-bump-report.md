# dsh-tether: bumping `androidRuntime.dsh` from `0.1.2-rc.1` to `0.1.5-rc.1`

**Checkout analysed:** `H:\DSH\_work\src\dsh-tether-main` (package version `0.1.13`, clean tree, no `.git`).
**Evidence trees built for this report** (both via `npm install @deepseek-ai/dsh@<ver> --os=android --cpu=arm64 --ignore-scripts --no-package-lock`):

| label | path | meaning |
|---|---|---|
| **012** | `H:\DSH\_work\v012offline\node_modules` | what the current pin produces |
| **015r1** | `C:\Users\LOE\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules` | the installed published 0.1.5-rc.1 tree (win32) |
| **015r2** | `H:\DSH\_work\androidtest\015\node_modules` | **what `@deepseek-ai/dsh@0.1.5-rc.1` actually resolves to on android-arm64** (pre-existing tree, deps are 0.1.5-rc.2) |

> Registry access from this machine timed out, so version claims are grounded in these on-disk trees plus the local npm cache, not in live registry queries.

---

## VERDICT

**Bumping `androidRuntime.dsh` to `0.1.5-rc.1` is a small change to the build config — but it is currently a BREAKING change for Android local mode, because of a new upstream dependency on a native `flock` addon that does not support Android.**

- The version bump itself is **one line** in `package.json` and has **no other wiring consequences** in `scripts/build-android-runtime.mjs` (the pin is a build-time input, never a runtime gate — §1).
- The **host-side plugin** works unchanged (§2, §3): every DSH API the plugin touches is either byte-identical or semantically identical between 0.1.2-rc.1 and 0.1.5-rc.1/rc.2.
- The **narrow-screen CSS** (§4) has exactly **one dead selector** and one likely-visible regression: `detailsCol` no longer exists.
- **The blocker (§3/§5-adjacent, discovered during this analysis):** `@deepseek-ai/dsh-session-persistence-jsonl` in 0.1.5 acquires a kernel write lock per session via `@deepseek-ai/node-addon-system/flock`, whose loader hard-throws on any platform other than `linux`/`darwin`. The bundled Termux Node reports `process.platform === 'android'`, so **every session write on the phone would reject**. 0.1.2-rc.1 has no such lock at all. See §7 for the exact chain and the confidence level.

---

## 1. How the Android runtime is assembled

**File:** `scripts/build-android-runtime.mjs` (239 lines), read in full.

### Every place the pinned dsh version is consumed

| line | code | what it does |
|---|---|---|
| 23–25 | `const pkg = JSON.parse(...package.json)` / `const pin = pkg.dsh?.androidRuntime` / `if (!pin?.node \|\| !pin?.dsh) throw` | loader + validation |
| 29–31 | `` MIRROR_TAG = `android-runtime-node${pin.node}` `` etc. | Node only — **not** the dsh pin |
| 36 | `` `pool/main/n/nodejs-lts/nodejs-lts_${pin.node}-1_aarch64.deb` `` | Node only |
| 117–119 | `log(\`npm install @deepseek-ai/dsh@${pin.dsh}(os=android cpu=arm64)\`)` and `spawnSync(npm, ['install', \`@deepseek-ai/dsh@${pin.dsh}\`, '--os=android', '--cpu=arm64', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'])` | **the only place the dsh version is fetched** |
| 195 | `` const bundle = join(CACHE, `dsh-${pin.dsh}`) `` (`mirror()`) | cache dir name includes the pin |
| 209 | `` const bundle = join(CACHE, `dsh-${pin.dsh}`) `` (`assemble()`) | cache dir name includes the pin |
| 224 | `writeFileSync(join(stage,'manifest.json'), JSON.stringify({ node: pin.node, dsh: pin.dsh, app: pkg.version }, null, 2))` | the only record written into the APK |

Probe that gates the cached install (line 210):
```js
if (!existsSync(join(bundle, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) npmInstallDsh(bundle)
```

`pin.node` and `pin.dsh` are **independent**: Node comes from the GitHub-Release mirror (`MIRROR_URL`, line 31, keyed only on `pin.node`), dsh comes from npm.

### `writeHomeSkeleton()` (lines 151–172)

It uses **`pkg.name` / `pkg.version` (this plugin), never `pin.dsh`**:

```js
function writeHomeSkeleton(home) {
  const web = join(home, 'profiles', 'web')
  const plugin = join(web, 'node_modules', pkg.name)
  mkdirSync(plugin, { recursive: true })
  for (const f of ['index.js', 'cordis.patch.yml', 'package.json']) copyFileSync(join(root, f), join(plugin, f))
  writeFileSync(join(web, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true, dependencies: { [pkg.name]: pkg.version },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', pkg.name], patchReload: 'live' } },
  }, null, 2) + '\n')
  writeFileSync(join(web, 'cordis.patch.yml'), [...'- id: dsh-tether', '  config:', '    sidecar: false', ...].join('\n'))
  writeFileSync(join(web, 'pnpm-workspace.yaml'), ['packages:', '  - .', '', 'nodeLinker: hoisted', 'autoInstallPeers: false', ''].join('\n'))
}
```

**Verified against 0.1.5** (tree 015r2):
- `dsh-app-boot` `PROFILE_TEMPLATES.web = { bundles: ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'], patchReload: 'live' }` — the skeleton's `bundles` list is a superset of the template (adds `dsh-plugin-tether`), so `normalizeShippedProfile()` (`dsh-app-boot/lib/index.js:776-798`) leaves it alone. ✓
- `PROFILE_PNPM_WORKSPACE` written by `initProfile` (`:365-370`) is **character-identical** to what `writeHomeSkeleton` writes. ✓
- `loadProfileDirectory()` (`:843-871`) still reads `manifest.dsh.profile.bundles`, still requires each bundle to declare `dsh.bundle.patch`, and still validates `patchReload ∈ {live,startup}`. ✓
- `resolveBundleDir()` (`:826-832`) is unchanged: installation anchor first, then the profile dir. So `dsh-plugin-tether` still resolves out of `profiles/web/node_modules`. ✓

### `manifest.json`

Written at line 224 with `{ node, dsh, app }` where `dsh` is the **literal pin string**, not the resolved versions.

Consumed only in `app/src-tauri/src/local.rs:96-100`:
```rust
fn runtime_ready(dir: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join("manifest.json")) else { return false };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
    value.get("app").and_then(|v| v.as_str()) == Some(env!("CARGO_PKG_VERSION"))
}
```
Only `app` is read. Grepping the whole repo for `manifest.json` in `*.rs` returns exactly this one line — **`node` and `dsh` in the manifest are dead data.** The pinned dsh version is therefore **not** a runtime gate anywhere; it is a build-time input and a note.

Cross-check on the `app` value: `writeHomeSkeleton`'s manifest gets `app: pkg.version` (root `package.json` = `0.1.13`) and `runtime_ready` compares against `env!("CARGO_PKG_VERSION")` (`app/src-tauri/Cargo.toml` = `0.1.13`). They agree today. **If they ever drift, the armed failure mode is silent: the runtime re-extracts (~25k files) on every launch.**

### The generated `cordis.patch.yml`

The skeleton's copy is a 5-line array enabling `sidecar: false` for `id: dsh-tether`. It targets a row **inserted by the plugin's own bundle patch** (`cordis.patch.yml` at repo root), i.e. an id-targeted config override across layers — a mechanism present and unchanged in 0.1.5 (the web-app bundle patch itself uses `- id: … config:` overrides extensively, `dsh-web-app/cordis.patch.yml:16-30`).

### Is bumping the pin one line?

**In the build script: yes, one line.** Exactly one place fetches dsh (line 118) and the rest is derived. Worth knowing:
- The cache directory is keyed on the pin (`dsh-${pin.dsh}`), so a bump gets a **fresh cache dir and a full re-install**, not a reuse.
- CI cache key is `android-runtime-${{ hashFiles('package.json') }}` (`\.github\workflows\release.yml:116-119`) — a bump invalidates it correctly.

**But the pin is *not what actually lands in the APK*.** See §7.

---

## 2. Host-side plugin ↔ DSH coupling

**Exact range strings**, `package.json:48-51` (verified in the checkout, matching the value quoted in the task):

```json
"peerDependencies": {
  "@deepseek-ai/dsh-host-webserver": ">=0.1.0-rc.7 <0.1.1-0 || >=0.1.2-alpha.0 <0.1.3-0 || >=0.1.5-alpha.0 <0.1.6-0",
  "@deepseek-ai/dsh-user-approval":   ">=0.1.0-rc.7 <0.1.1-0 || >=0.1.2-alpha.0 <0.1.3-0 || >=0.1.5-alpha.0 <0.1.6-0"
}
```

Both are `optional: true` (`package.json:52-55`).

**Evaluation against `0.1.5-rc.1`** (executed with the `semver@7.8.5` bundled inside the installed dsh):

```
range: >=0.1.0-rc.7 <0.1.1-0 || >=0.1.2-alpha.0 <0.1.3-0 || >=0.1.5-alpha.0 <0.1.6-0
  0.1.5-alpha.0 -> true
  0.1.5-rc.0    -> true
  0.1.5-rc.1    -> true      <-- satisfies
  0.1.5         -> true
  0.1.6-0       -> false
  0.1.4-rc.1    -> false
```

**Which clause admits 0.1.5:** the **third** clause, `>=0.1.5-alpha.0 <0.1.6-0`. Clause 1 (`>=0.1.0-rc.7 <0.1.1-0`) caps below `0.1.1-0`; clause 2 (`>=0.1.2-alpha.0 <0.1.3-0`) caps below `0.1.3-0`. 0.1.5-rc.1 is `>= 0.1.5-alpha.0` and `< 0.1.6-0`, so only clause 3 matches — confirmed by evaluating clause 3 alone (`0.1.5-alpha.0`, `0.1.5-rc.1`, `0.1.5` → true; `0.1.6-0` → false).

**Also admits `0.1.5-rc.2`**, which matters given §7. **Does NOT admit `0.1.4-*`** (there is a deliberate hole at 0.1.3/0.1.4).

`cordis.patch.yml` (repo root, 21 lines) references three upstream packages by name, all of which still exist with unchanged names in 0.1.2 and 0.1.5:
- `@deepseek-ai/dsh-host-directory-picker-browse` — **byte-identical** `lib/` between 012 and 015r1.
- `@deepseek-ai/dsh-client-ui-directory-picker-browse` — **byte-identical**.
- `@deepseek-ai/dsh-host-directory-picker-auto` — **changed**, but only in how SSH is detected:
  ```
  012: if (present(facts.env.SSH_CONNECTION) || present(facts.env.SSH_TTY)) return "browse";
  015: if (facts.ssh) return "browse";     // ssh: launchedThroughSsh(launchEnvironmentOf(ctx))
  ```
  This does not affect the patch: the patch is keyed on `id: directory-picker` (unchanged row id, `dsh-web-app/cordis.patch.yml:97`) and the `name:` assertion (unchanged package name). Semantics on the phone are unchanged either way — the picker is *disabled*, not selected.

---

## 3. What DSH host APIs the plugin actually uses

`index.js`, 749 lines, read in full. `export { name, inject, apply }` at line 749; `const inject = ['webServer', 'settings']` at line 18.

| # | site | API | stability |
|---|---|---|---|
| 1 | `index.js:91` | `ctx.effect(() => ctx.webServer.tapIndex(injectNarrowScreenCss))` | **Stable documented extension point.** `tapIndex` is documented in `dsh-host-webserver/src/index.ts:204-217` ("Register a raw-HTML index transform, the escape hatch for markup no IndexInjection row expresses"). `dsh-host-webserver/lib` is **byte-identical (SHA-256 per file) between 0.1.2-rc.1 and 0.1.5-rc.1**, and the rc.2 tree still has `tapIndex(transform)` at `lib/index.js:219`. |
| 2 | `index.js:96-121` | `ctx.webServer.register({ kind:'exact', path, handler })` | Stable; `WebRoute`/`WebRouteKind` unchanged. Routes used: `/dsh-tether/config-document` (:21), `/dsh-tether/pairing` (:23), `/dsh-tether/devices` (:24). Duplicate `(kind,path)` still throws (:167-169). |
| 3 | `index.js:146` | `ctx.webServer.host`, `ctx.webServer.port` | Stable getters (`dsh-host-webserver/src/index.ts:150-157`). |
| 4 | `index.js:101` | `await ctx.settings.prepareDocument()` → `string \| undefined` | Stable. `dsh-settings/lib/index.js` is **byte-identical** between the two versions; `prepareDocument()` at :267, `get documentPath()` at :260 in both. rc.2 identical. |
| 5 | `index.js:237-268` | `ctx.inject(['connection'], …)`, `connCtx.connection.authenticatedUrl(url)` | Stable by *capability probe*, and the probe is correct: `authenticatedUrl` exists in 0.1.2 (`dsh-client-connection/lib/index.js:347`, `:539`) and 0.1.5 (:370, :562). |
| 6 | `index.js:243-249` | `fetch(url,{redirect:'manual'})`; assert `res.status === 303` and `setCookie.length === 1` | **Version-coupled but unchanged.** 0.1.2 `:378` and 0.1.5 `:401` both `res.writeHead(303, { ..., "set-cookie": sessionCookie(...) })` with a single cookie, and `COOKIE_PAYLOAD_VERSION = 1` in both. Same shape in rc.2. |
| 7 | `index.js:344-352` | `ctx.on('approval/request', async (req, next) => …)`, reading `req.callId`, `req.toolName ?? ''`, `req.reason ?? ''`, then `await next()` | **Stable.** `dsh-user-approval/lib` is **byte-identical** between 0.1.2-rc.1 and 0.1.5-rc.1. `ApprovalRequestEvent` still declares `toolName: string`, `callId?: ToolCallId`, `reason?: string` (`types.d.ts:59-63`); rc.2 identical. The waterfall contract (`next()` delegates) is unchanged. |
| 8 | `index.js:18` | service injection names `webServer`, `settings` | Both still the registered service names. |
| 9 | `index.js:128-135` | `apply(ctx, config = {})`, `config.sidecar === false` | Plugin-local; there is **no DSH `Config` schema** in this plugin (no named `Config` export). |

**Nothing in the host half is a private/internal API.** The only two "we reimplemented upstream logic" spots are deliberate and each is guarded against version drift:
- `isTrustedRequest()` (`index.js:45-63`) — re-implements DSH's `isTrustedApiRequest`, which the comment notes "没有从包里导出" (not exported).
- the `connection.authenticatedUrl` capability check (`index.js:240`) — correctly tests the *function*, not the service's existence, with a comment recording that rc.7/rc.8 have `connection` but no browser auth.

**Flagged as version-sensitive but currently safe:** item 6 (the exact 303 + one-`set-cookie` handshake) and item 4 (`prepareDocument` semantics). Both hold across 0.1.2 → 0.1.5-rc.1 → 0.1.5-rc.2, verified by file hash where possible.

---

## 4. The narrow-screen CSS injection — every selector

`injectNarrowScreenCss(html)` at `index.js:360-724`. It returns `html.replace('</head>', '<style…>…</style><script…>…</script></head>')` (:720-723). The `</head>` marker still exists in 0.1.5's `dist/index.html`, and `dsh-host-frontend-static` (which calls `ctx.webServer.renderIndex(...)`) is **byte-identical** between 0.1.2-rc.1 and 0.1.5-rc.1 — so taps still run.

Naming style confirmed empirically: CSS-module classes are `_<localName>_<hash>_<line>` in the frontend bundle and `<hash>_<localName>` in per-package `client.js` maps (e.g. `"footArea": "hHd-Xa_footArea"`). Note the **hash prefixes are stable across 0.1.2→0.1.5 for the packages involved** (they are derived from module content/path); the *local names* are the real contract.

### CSS selectors

| line | selector | 0.1.5 status | fragility |
|---|---|---|---|
| 367 | `[class*="footArea"] > [class*="footerActions"]` | **OK** — `"footArea":"hHd-Xa_footArea"`, `"footerActions":"hHd-Xa_footerActions"` in `dsh-client-ui-sidebar/lib/client.js`, **identical in 012 and 015r2** | Low. Also matches `"footerActions":"Mbwy4a_footerActions"` in `dsh-client-ui-user-questions` — an unrelated element. Pre-existing over-match, benign. |
| 371 | `[class*="collapsed"] [class*="footArea"] > [class*="footerActions"]` | **OK** — `"collapsed":"hHd-Xa_collapsed"` present in both | Low, but `[class*="collapsed"]` is very broad as an ancestor test. |
| 374 | `html, body { overflow-x: hidden }` | n/a | None. |
| 376, 394, 474 | `[role="dialog"][aria-modal="true"]:not([data-dsh-tether])` | **OK** — settings dialog still renders `role:"dialog"`, `"aria-modal":"true"` at `dsh-client-ui-settings-general/lib/client.js:124-125`, **identical in 012 and 015r2** | Low. Semantics fine. Broad: matches *any* modal dialog, incl. `dsh-client-ui-attachment`'s. |
| 388 | `[class*="_row"]:not([class*="rowText"])` | **OK** but blast radius grew — `_row` classes exist in 21 packages in 015r2 vs 20 in 012 (`dsh-client-ui-sidebar-files` is new) | **Highest fragility in the file.** Depends on the hash↔name separator staying `_`. Over-broad by construction: it restyles every `*_row` element in every plugin. |
| 389 | `[class*="rowText"]` | **OK** — `rowText` in the same 5 packages with **identical hashes** in 012 and 015r2 (`hVGvvW_`, `lats3W_`, `T1PP_q_`, `oY77xG_`, `bVCLcG_`) | Low. |
| 395 | `… > nav` | **OK** — dialog's first child is `<nav className=…nav>` (`settings-general:127`) | Low. |
| 400, 407 | `… > nav [class*="navList"]` | **OK** — `"navList":"VOzbGW_navList"` present in both | Low. |
| 408 | `… > nav [class*="navCell"]` | **OK** — `"navCell":"VOzbGW_navCell"` present in both | Low. |
| 413 | `… > div` | **OK** — dialog's second child is `<div class=content>` | Low. |
| 426 | `[class*="_frame"] { grid-template-columns: 56px minmax(0,1fr) 0px !important }` | **OK** — `"frame":"pI_x6G_frame"` present in both | Medium: `_frame` also exists in `dsh-client-ui-chat` (`eGxaPq_frame`), `dsh-client-ui-user-questions` (`LVzXQa_`, `Mbwy4a_`), `dsh-client-ui-attachment`, `dsh-client-ui-subagent`, and (new in 0.1.5) `dsh-client-ui-sidebar-documentpreview` (`HyIruq_frame`, `JFRUHG_frame`). All those get the grid override too. Pre-existing over-match, **grew** with 0.1.5. |
| 429 | `[class*="_frame"] > [class*="centerCol"]` | **OK** — `"centerCol":"pI_x6G_centerCol"` in both | Low. |
| **430** | **`[class*="_frame"] > [class*="detailsCol"]`** | **❌ DEAD.** `detailsCol` **exists in 012** (`"detailsCol": "pI_x6G_detailsCol"`) and is **0 hits in 015r1 AND 015r2**. Replaced by `rightbarCol` (`"rightbarCol": "pI_x6G_rightbarCol"`). | **Broken.** |
| 431 | `[class*="_frame"] > [class*="sidebarCol"]` | **OK** — present in both | Low. |
| 441 | `[class*="_frame"]:has(> [class*="_handle"]) > [class*="sidebarCol"]` | **OK syntactically** — `"handle":"pI_x6G_handle"`, and `_handle` is a substring of `pI_x6G_handle`; the handle renders as a direct child only when `!sidebarCollapsed` (`dsh-client-ui-layout/lib/client.js:306`) | **Medium — semantics shifted.** See below. |
| 447, 457 | `[class*="_frame"]::after` | n/a (plugin's own pseudo-element) | Low. |
| 458 | `[class*="_frame"] > [class*="_handle"]` | **OK** | Low. |
| 461–462 | `[data-dsh-tether="hosts-label"]` | plugin's own attribute | None. |
| 470 | `* { -webkit-tap-highlight-color: transparent }` | n/a | None. |
| 475 | `… > div > [class*="_header"]` | **OK** — `"header":"VOzbGW_header"` is inside `<div class=content>` (`settings-general:42`, `:151`) | Low. |

### JS selectors / DOM probes

| line | code | status |
|---|---|---|
| 492 | `document.querySelector('[class*="_frame"]')` | Picks the **first** `_frame` in document order. `dsh-client-ui-layout` owns the `root` slot (renderer `data-slot:"root"`, `dsh-client-ui-renderer/lib/client.js:891`) so it comes first today. Medium fragility: any root-level overlay with `_frame` rendered earlier would hijack the drawer. |
| 493 | `frame.querySelector(':scope > [class*="_handle"]')` | The "expanded" signal. **Semantics changed** — see below. |
| 494 | `frame.querySelector(':scope > [class*="sidebarCol"]')` | OK in both. |
| 496 | `document.querySelector('button[aria-label*="侧边栏"], button[aria-label*="sidebar" i]')` | **OK** — `dsh-client-ui-sidebar/lib/client.js` sets `"aria-label": collapsed ? t("toggle.open") : t("toggle.collapse")` (:239), with both locales shipped: `"打开侧边栏"/"收起侧边栏"` (:312-313) and `"Open sidebar"/"Collapse sidebar"` (:320-321) — **identical in 012 and 015r2** |
| 673 | `[data-slot="sidebar.footer.action"]` | **OK** — slot exists in both (`dsh-client-ui-sidebar/lib/client.js:293-295`); the attribute is emitted by `dsh-client-ui-renderer` `"data-slot": slotKey` (:773, **identical line in 012 and 015r2**) |
| 675 | `[data-slot="settings.trigger"]` | **OK** — `dsh-client-ui-settings-general/lib/client.js` |
| 711 | button text regex `/打开配置文件\|Open config\|open the config/i` | Depends on DSH copy, which is locale-owned upstream (`verify-client-ui-i18n`); not re-verified for 0.1.5 in this pass. |

### Two concrete consequences of the `detailsCol` change

**(a) The rule at `index.js:430` is dead in 0.1.5.** The third grid column is `rightbarCol` and is **not** re-pinned to `grid-column: 3`. In 0.1.2 the third child was `DetailsColumn` (class `pI_x6G_detailsCol`); in 0.1.5 it is `RightbarColumn` (class `pI_x6G_rightbarCol`, plus `data-rightbar-col`) — `dsh-client-ui-layout/lib/client.js:122-128`, `:296`.

**(b) The `:has(> [class*="_handle"])` "expanded" signal was already ambiguous and stays ambiguous.** In 0.1.2 the frame rendered a **second** `DragHandle` whenever `cols.details > 0` (`dsh-client-ui-layout/lib/client.js:270-276`); in 0.1.5 it renders one whenever `layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0` (`:313-319`). So a third-party plugin that claims the `rightbar` slot could make the injected script believe the sidebar drawer is open. The trigger condition differs between versions, so the *probability* changes even though the mechanism doesn't.

With the plugin's own `grid-template-columns: 56px minmax(0,1fr) 0px !important` (line 426) still applied but `rightbarCol` no longer pinned, the right column becomes an auto-placed grid item with no explicit track. **Inference (not observed on a device):** it would be auto-placed into the first free cell — the 56 px column — instead of the 0 px third track. Treat as "needs device verification", but it is a plausible visible defect and the fix is a one-word change (`detailsCol` → `rightbarCol`).

### Replaceability by an official client plugin

0.1.5 exposes a real client-plugin path: `@deepseek-ai/dsh-client-modules` scans `dsh.client` rows into `window.__DSH_BOOT__` and serves `/plugins/<id>/client.js` (`dsh-web-app/cordis.patch.yml:172-177`), and slots are registered through `ctx.slots.inject('<slot>', () => ctx.slots.register({...}))` — e.g. `sidebar.footer.action` and `settings.trigger` themselves are registered that way (`dsh-client-ui-cordis/lib/client.js`, `dsh-client-ui-settings-general/lib/client.js`), with a worked example in `dsh-cordis-client-runner/lib/client.js`. So the **"Hosts" button** (`index.js:672-705`) can be replaced by a proper React slot occupant instead of DOM cloning.

But there is **no official slot for "restyle the shell for narrow screens"**. Replacing the CSS *mechanism* still means styling DSH's DOM; what a client plugin buys you is that the injection becomes version-pinned, HMR-able, and reviewable rather than a string `replace('</head>', ...)`. The selector debt in the table above does not go away by itself.

---

## 5. The Rust side

**Files:** `app/src-tauri/src/lib.rs` (452 lines), `app/src-tauri/src/local.rs` (330 lines), `host/src/main.rs` (617 lines), plus `tether-core/src/lib.rs` (415 lines) which owns the wire protocol.

### Is anything coupled to the DSH version?

**No.** Zero references to a DSH version number anywhere in the Rust. Verified by grep:
- `manifest.json` appears in exactly one place as a path string (`local.rs:97`), and only `.get("app")` is compared.
- The only DSH-version-shaped assumptions are **three external contracts**, all unchanged in 0.1.5:

| site | contract | verified |
|---|---|---|
| `local.rs:148-153` `parse_ready_line()` | stdout line `dsh web: http://127.0.0.1:<port>/?token=<token>` | `dsh-web-app/lib/index.js` `console.log(\`dsh web: ${authenticatedUrl}${lanUrl === void 0 ? "" : \` (LAN: ${lanUrl})\`}\`)` at **012:211 / 015r1:203 / 015r2:203** — identical shape, and the `(LAN: …)` suffix is present in **both** versions (so the existing `query.trim()` over-capture is pre-existing, not a bump regression; it only bites when a LAN address is resolved, which does not happen for the loopback bind on the phone) |
| `local.rs:156-181` `exchange_cookie()` | `GET /?token=` → 303 + `set-cookie` | `dsh-client-connection` 012:378 / 015r1:401, `COOKIE_PAYLOAD_VERSION = 1` in both |
| `local.rs:245-264` spawn args | `node --expose-internals <…>/@deepseek-ai/dsh/lib/bin.js web --no-open --port 0` with `DSH_HOME`, `HOME`, `TMPDIR`, `LD_LIBRARY_PATH`, `OPENSSL_CONF`, `PATH=/system/bin:/system/xbin` | `--no-open`, `--port <port>` incl. `0`, and the `web` alias all still exist (`dsh-web-app/lib/startup.js`; `dsh/lib/bin.js`). `--expose-internals` is still the HMR/loader fast path (`cordis-plugin-loader/lib/index.js:11`) and is what avoids needing the no-android `node-addon-require-builtin` native fallback. |

`lib.rs` in full is iroh + Tauri commands; its only DSH contact is spawning `local::start()` and forwarding `remote:approval` events. Nothing version-coupled.

### iroh ALPN and the wire protocol

`tether-core/src/lib.rs`:
```rust
pub const ALPN: &[u8] = b"dsh-tether/0";            // :13
pub const MAX_LINE: usize = 64 * 1024;              // :15
pub const MAX_UNPAIRED_LINE: usize = 512;           // :17

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Wire {                                     // :20-36
    Hello { name: String },
    Pair { code: String, name: String },
    Proxy,
    PairOk,
    PairFail { reason: String },
    Approval { id: String, tool_name: String, reason: String },
    ApprovalCancel { id: String },
    Decision { id: String, outcome: String },
}
```

**Verdict: the wire protocol is implicit, not negotiated.** Findings:

1. **The only version carrier is the ALPN string** `dsh-tether/0`. The host pins it (`host/src/main.rs:238` `.alpns(vec![ALPN.to_vec()])`); the phone passes it to `connect()` (`lib.rs:141`, `main.rs:556`). A future `dsh-tether/1` would fail the QUIC/TLS handshake against a `/0` peer — a **clean fail-closed refusal, not a misparse**. That is the good half.
2. **Within `/0` there is no negotiation and no capability exchange.** `Wire` has no version field, no `#[serde(other)]` catch-all, no `#[non_exhaustive]`. An unknown `type` tag is a **hard serde decode error**.
   - Host, control-stream first line (`main.rs:366-367`): `let hello: Wire = serde_json::from_str(&first).context("首行不是合法消息")?;` → on error the ARM at `:412-415` runs `conn.close(1u8.into(), b"protocol")` and bails.
   - Host, steady state (`main.rs:462-465`): logs `忽略非决定消息` / `无法解析手机消息` and keeps reading.
   - Phone (`lib.rs:197-205`): `match serde_json::from_str::<Wire>(&line) { Ok(Wire::Approval{..}) => …, Ok(Wire::ApprovalCancel{..}) => …, _ => {} }` — **silently ignores** unknown variants. So a new host→phone message type would be dropped quietly rather than erroring.
   - Phone pairing response (`lib.rs:149-166`): `serde_json::from_str::<Wire>(&resp)?` → a decode error aborts the connect.
3. **Consequence for mixed versions:** a phone running one build *can* connect to a machine running another **only if the ALPN and every exchanged `Wire` variant are identical**. Because ALPN is a single global constant at `/0`, adding a variant is a breaking change in the new→old direction (old peer errors on the unknown tag), and *nothing in the protocol surfaces that as a version mismatch* — you get "protocol error" / a silently dropped message.
4. The ALPN carries **no DSH version**, so the DSH-version question is orthogonal to the wire protocol: the phone and the machine each run whatever dsh they have, and the plugin is the only interface between them. This is why bumping the *bundled local-mode* dsh only affects the phone-internal path, never the pairing path.

---

## 6. Android build surface

**`app/src-tauri/tauri.conf.json`** (29 lines) — **no splash section at all**. No `plugins`, no `android`, no window-background keys. The single window is `{ title: "DSH Tether", width: 420, height: 780 }`; `app.security.csp = null`; `bundle.iOS.frameworks = ["SystemConfiguration"]`.

**`app/src-tauri/gen/android/app/src/main/res/values/themes.xml`** (6 lines) — the whole file:
```xml
<resources xmlns:tools="http://schemas.android.com/tools">
    <style name="Theme.dsh_tether_app" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <!-- Customize your theme here. -->
    </style>
</resources>
```
**`values-night/themes.xml`** (6 lines) — **byte-for-byte the same content**, same parent, same empty body.
→ **No `windowBackground`. No `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` / `windowSplashScreenIconBackgroundColor`. No `postSplashScreenTheme`.**

**`build.gradle.kts` dependencies** (`app/src-tauri/gen/android/app/build.gradle.kts:94-103`):
```kotlin
implementation("androidx.webkit:webkit:1.14.0")
implementation("androidx.appcompat:appcompat:1.7.1")
implementation("androidx.activity:activity-ktx:1.10.1")
implementation("com.google.android.material:material:1.12.0")
implementation("androidx.lifecycle:lifecycle-process:2.10.0")
```
→ **No `androidx.core:core-splashscreen`.** So there is no themed splash and no `installSplashScreen()` call.

**SDK levels** (`build.gradle.kts:27,32-33`):
```kotlin
compileSdk = 36
minSdk = 24
targetSdk = 36
```
`namespace = "cc.zexa.dshtether"`, `applicationId = "cc.zexa.dshtether"`, `versionCode`/`versionName` from `tauri.properties`. Because `targetSdk = 36` (≥ 31), Android applies the **platform** default splash screen (window background + launcher icon) on API 31+ — configured nowhere in this project, so it is whatever `Theme.MaterialComponents.DayNight.NoActionBar` yields. `compileSdk`/`targetSdk` are independent of the DSH version.

**Edge-to-edge: enabled, in one place.** `app/src-tauri/gen/android/app/src/main/java/cc/zexa/dshtether/MainActivity.kt` (11 lines, whole file):
```kotlin
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
```
`enableEdgeToEdge()` comes from `androidx.activity:activity-ktx:1.10.1`. Note it is called **before** `super.onCreate` (works, but unconventional). No `WindowCompat.setDecorFitsSystemWindows` anywhere.

**Also worth noting** (`app/src-tauri/gen/android/app/build.gradle.kts:78-81`) — this is why `libnode.so` is exec-able:
```kotlin
packaging {
    // 让 libnode.so 落成真实文件而不是留在 APK 里按需 mmap:exec 需要一个路径
    jniLibs.useLegacyPackaging = true
}
```
and the runtime source dirs are wired at `:72-77` (`jniLibs.srcDirs("../../../android-runtime/jniLibs")`, `assets.srcDirs("../../../android-runtime/assets")`) — **absent in this checkout**, so no runtime was built here and no APK size delta could be measured.

**`AndroidManifest.xml`** (38 lines): one permission (`INTERNET`), Leanback feature, one `MainActivity` (`launchMode="singleTask"`, `exported="true"`), a `FileProvider`. Theme is `@style/Theme.dsh_tether_app`. No splash theme reference.

---

## 7. What actually lands in the APK — and the blocker

### 7a. The pin is not reproducible: `0.1.5-rc.1` resolves to a **mixed tree**

Census of `@deepseek-ai/*` package versions per tree:

| tree | result |
|---|---|
| **012** (`@deepseek-ai/dsh@0.1.2-rc.1`) | **214 × `0.1.2-rc.1`** (+ `0.1.1` for `node-addon-landlock-run`). Effectively homogeneous. |
| **015r1** (installed published `0.1.5-rc.1`, older install) | **230 × `0.1.5-rc.1`**. Homogeneous. |
| **015r2** (`@deepseek-ai/dsh@0.1.5-rc.1`, current resolution) | **1 × `0.1.5-rc.1` (`@deepseek-ai/dsh` itself) + 230 × `0.1.5-rc.2`**. |

`@deepseek-ai/dsh@0.1.5-rc.1`'s own manifest declares sub-packages with **caret ranges on a prerelease**, e.g. `"@deepseek-ai/dsh-base": "^0.1.5-rc.1"`, `"@deepseek-ai/dsh-web-app": "^0.1.5-rc.1"`. `semver@7.8.5` confirms `0.1.5-rc.2` satisfies `^0.1.5-rc.1` (and that `^0.1.2-rc.1` does *not* admit `0.1.5-*`). Combined with `--no-package-lock` (`build-android-runtime.mjs:119`), the resolved tree is **whatever the newest `0.1.5-rc.*` is at build time** — it drifts forward with every upstream pre-release and is not pinned by this repo.

Corroboration: a fresh offline install of the same spec failed with
```
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/@deepseek-ai/dsh-web-frontend/-/dsh-web-frontend-0.1.5-rc.2.tgz failed:
cache mode is 'only-if-cached' but no cached response is available.
```
i.e. resolving `@deepseek-ai/dsh@0.1.5-rc.1` *requires* `dsh-web-frontend@0.1.5-rc.2`. (The rust source checkout is also `0.1.5-rc.2`.)

**Consequences:**
- `manifest.json` records `dsh: "0.1.5-rc.1"` — an **inaccurate** fingerprint. An APK built today contains 0.1.5-rc.2 code. Two builds a week apart can differ while claiming the same version.
- The label in `README.md:90,93` / `README.zh.md` and `CHANGELOG.md:9` ("currently `0.1.2-rc.1`") would become wrong in a subtler way than a normal version bump.
- The `package-lock`-less install also means the **CI cache key** (`hashFiles('package.json')`) will not detect an upstream drift — same `package.json`, different tree.

### 7b. **Blocker: `0.1.5` session writes require a native `flock` that hard-fails on Android**

`@deepseek-ai/node-addon-system` is **new in 0.1.5** (absent in 012, present in 015; `node-addon-landlock-run` is dropped). Its platform packages are declared as optionalDependencies with **no Android entry**:
```json
"optionalDependencies": {
  "@deepseek-ai/node-addon-system-darwin-arm64": "0.1.2",
  "@deepseek-ai/node-addon-system-darwin-x64":     "0.1.2",
  "@deepseek-ai/node-addon-system-linux-x64":      "0.1.2",
  "@deepseek-ai/node-addon-system-linux-arm64":    "0.1.2"
}
```

`@deepseek-ai/dsh-session-persistence-jsonl` gained a **`SessionWriteLease`** in 0.1.5 that did not exist in 0.1.2 (`SessionWriteLease`, `session.lock`, `LEASE_FILENAME`, `flock`, `node-addon-system` all → **0 hits** in the 012 copy of that file; its 012 deps are only `{koffi, schemastery}`).

The chain on the phone:

```
dsh-base/cordis.patch.yml:110-111   mounts @deepseek-ai/dsh-session-persistence-jsonl   (base layer — always active)
dsh-session-persistence-jsonl/lib/index.js:11   import { tryLockExclusive } from "@deepseek-ai/node-addon-system/flock"
  :224  persistContiguous()  ->  await this.ensureLease()        // every durable append
  :133  flush()              ->  await this.ensureLease()
  :247  async ensureLease() { this.lease ??= await this.storage.acquireWriteLease(this.header) }
  :2787 async acquireWriteLease(header) -> this.acquireLease(...)
  :2776 acquireLease(...) { return SessionWriteLease.acquire(dir, id) }
  :670  if (process.platform === "win32") { …Win32 semaphore… }     // skipped on Android
  :684  for (let attempt = 0; attempt < 3; attempt += 1) {
  :685      const handle = await open(path, "w");
  :688      await tryLockExclusive(handle.fd);
  :690      if (isLockContention(error)) throw new SessionAlreadyOwnedError(id);
  :691      throw error;                                            // <- non-contention rethrown
  :642  isLockContention(e) => e.code === "EAGAIN" || e.code === "EWOULDBLOCK"   // does not match

node-addon-system/lib/flock.js:10-15
  if (platform !== 'linux' && platform !== 'darwin') {
      throw Object.assign(new Error(`flock is not supported on ${platform}-${arch}`),
                          { code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM', syscall: 'flock' });
  }
```

`process.platform` on the bundled runtime is `'android'` — Node's `NodeJS.Platform` includes `'android'`, and **this repo already relies on that fact**: `CHANGELOG.md:29` (v0.1.11) states *"Termux 的 Node 把 `process.platform` 报成 `android`(不是 `linux`),`index.js` 现有的自动选包逻辑按这个字段筛,所以是新增一个平台子包而不是复用 linux-arm64"*. That is why `dsh-tether-host-android-arm64` exists as a separate platform package.

Therefore: **on the phone, `ensureLease()` throws `ERR_FLOCK_UNSUPPORTED_PLATFORM` on the first durable write of every session**, and nothing in the chain catches it. Expected user-visible effect: conversations in local mode fail to persist / the composer errors out.

Additional notes:
- The module is **not** dependency-injected. `tryLockExclusive` is a static ESM import at line 11. The package's `withOverrides()` (`:2059-2068`) / `createJsonlGenerationRuntime()` (`:2152`) mechanism covers only the **generation/migration** runtime (`JsonlGenerationRuntimeOverrides` overrides `fs`, `platform`, `barrier`, …) — **not** the lease.
- The asynchrony/import-time hazard is *not* the problem: `flock.js:1` says *"Lazy POSIX flock entry; importing it does not load a native addon"* — the throw is at **call** time. So boot succeeds and the failure surfaces on first write (worse for diagnosis).
- The sibling `landlock-run` entry (`node-addon-system/lib/index.js`) **is** fail-safe by design: `launcherPath()` catches resolve failure and returns a nonexistent path; `probe()` then returns `'unusable'`. So the *sandbox* integration degrades gracefully on Android; only `flock` hard-throws.
- **0.1.2-rc.1 has no such lock**, which is exactly the version currently verified working on a Redmi (`README.md:147`).

**What a fix would require** (i.e. why this is not a one-line bump): either an upstream change so `flock` degrades like the browser-worker stub described at `dsh-session-persistence-jsonl/lib/index.js:634-636` (*"The browser worker stubs the native flock entry to immediate success: it is single-process"*), or a shipped `node-addon-system-android-arm64` prebuild (and even then, bionic's `flock` availability would have to be confirmed). Alternatively a local runtime patch in `build-android-runtime.mjs` plus a Node loader hook to substitute the module — real work, and it would be an unlogged fork of upstream behaviour.

**Confidence:** high, but **read-not-executed**. The chain is read from the shipped built JS (not minified beyond recognition) plus Node's documented `process.platform` value and this repo's own CHANGELOG. It has **not** been reproduced on a device or emulator. Verification is cheap: on an Android/Termux node 24, `node -e "require('@deepseek-ai/node-addon-system/flock')"`… or simply `node -p "process.platform"` and then attempt one session write with `dsh web` from the 015 tree.

---

## What could NOT be determined

1. **Whether §7b actually breaks local mode on a real device.** The chain is read from source; no Android device/emulator was available and the runtime was not built (`app/src-tauri/android-runtime/` is absent from this checkout). This is the single item that should be verified before committing to the bump.
2. **Whether the `detailsCol` → `rightbarCol` breakage is visually harmful.** My claim that `rightbarCol` gets auto-placed into the 56 px column is an inference from CSS grid auto-placement, not an observation.
3. **Whether `import sharp` succeeds on android-arm64.** `sharp@0.35.4` ships **no** Android platform package or libvips binary in either the 0.1.2 or the 0.1.5 android tree (only `@img/colour` is present), yet `@deepseek-ai/dsh-attachment-local` imports it statically at `lib/index.js:8` and is mounted by `dsh-base/cordis.patch.yml:119`. Since 0.1.2-rc.1 is reported working on a real device, some fallback must exist — I did not find it. **Identical in both versions, so it does not affect the bump verdict.**
4. **Whether `dsh-session-persistence-jsonl` was already broken on Android in 0.1.5-rc.1 before rc.2** — I confirmed the lease exists in the rc.2 tree (015r2). The 015r1 (rc.1) tree was not inspected for the lease specifically. The lease is present in the 0.1.5 family generally.
5. **Live registry state.** `https://registry.npmjs.org` timed out from this machine, so I could not enumerate which `0.1.5-rc.*` versions exist or what the newest one is today; the rc.2 conclusion rests on the on-disk 015r2 tree and the ENOTCACHED failure.
6. **Actual APK size delta** for the bump. Not measured — the runtime was not built. `CHANGELOG.md:9` gives the current split (arm64 ≈ 71 MB vs ≈ 32 MB for the others), and 0.1.5 adds ~17 packages including the new client-UI packages, so expect a further increase.
7. **Whether Node 24.18.0 remains sufficient.** I checked every `engines.node` in the 015r2 tree: `chokidar >= 20.19.0`, `readdirp >= 20.19.0`, `@deepseek-ai/node-addon-system >= 20`. No requirement above 24.18.0 found, and `cordis-plugin-loader` needs Node ≥ 22 / ≥ 24.12 for loader-v2 detection. But I did not execute the runtime on arm64.
8. **iOS and the `app/ui` frontend** were not examined (out of scope for this question).
9. **The 0.1.5 button-text regex** at `index.js:711` (`打开配置文件|Open config|open the config`) was not re-verified against 0.1.5's shipped locales.
10. **`git` history** is unavailable (no `.git` in the checkout, and `H:\DSH\_work\src\deepseek-harness-master` has none either), so the 0.1.2→0.1.5 change set is inferred from tarball/release artifacts rather than commits.
