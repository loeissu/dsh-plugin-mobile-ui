# DSH Tether 移动端 UI 插件化 · 最终方案报告

> 调研日期：2026-09-11
> 证据来源：本地安装的 `@deepseek-ai/dsh@0.1.5-rc.1`、`codeload` 下载的 DSH 源码（`deepseek-harness-master`，含 0.1.5-rc.2 版本号）、`raw.githubusercontent.com` 读取的 `zexadev/dsh-tether` main 分支、npm registry 双版本 tarball 实测。

---

## 1. 结论摘要

**推荐路径：写一个独立的客户端插件，只使用两个 DSH 版本共有的 slot 子集；不要动 dsh-tether 的 `androidRuntime.dsh` 钉。**

三条实测结论支撑这个选择：

1. **`0.1.2-rc.1` 与 `0.1.5-rc.1` 的 slot 面差异极小**：51 → 61 个 slot，**48 个是共有的且签名零变化**，没有任何 `kind`/`scope` 变更。共同子集覆盖了原型需要的全部关键插槽（`shell.overlay`、`tool.call.toolview`、`conversation.composer`、`sidebar`、`settings.section`、`conversation.session.header` 等）。

2. **升级 Android 本地运行时目前被上游阻塞**：`0.1.5` 新增了 `@deepseek-ai/node-addon-system/flock` 的 per-session 写锁，其加载器在非 linux/darwin 平台**硬抛异常**；Android 上 Node 的 `process.platform === 'android'`（这是本仓库自己 CHANGELOG 记录过的事实），因此本地模式每次会话落盘都会失败。`0.1.2-rc.1` 完全没有这个锁。

3. **只写一个插件即可同时服务两个版本**：slot 注册是「找不到声明就静默不执行」（实测源码 `registry.ts:201`），不是崩溃。所以插件在 `0.1.2` 宿主上不会白屏，只会少渲染那几个新增 slot 的内容。

因此：**远程模式（电脑端 0.1.5）和本地模式（手机端 0.1.2）用同一个插件、同一份构建产物，零 tether 改动**。代价是原型中少数依赖 `0.1.5` 新 slot 的元素需要降级，详见 §5。

---

## 2. 版本策略

### 2.1 关键事实（全部实测）

| 问题 | 结论 | 证据 |
|---|---|---|
| `0.1.5-rc.1` 有 Android 可运行构建吗？ | **有**。构建脚本只用 `npm install @deepseek-ai/dsh@<pin> --os=android --cpu=arm64`，无平台专用产物 | `scripts/build-android-runtime.mjs:118`；我在本机对两个版本各跑了一次同参数安装，均成功产出 `lib/bin.js` |
| 升级是一行改动吗？ | **构建层面是**（`package.json` 一行），但**运行时层面不是** | 见 §2.3 阻塞项 |
| tether 的 peer 范围是否已允许 0.1.5？ | **是**。第三条子句 `>=0.1.5-alpha.0 <0.1.6-0` 命中 | `dsh-tether-main/package.json:48-51` |
| P2P 连接层需要改吗？ | **不需要**。ALPN 是 `dsh-tether/0`，线协议与 DSH 版本正交 | `tether-core/src/lib.rs:13`；`Wire` 枚举无版本字段 |
| slot 面差异 | 见 §2.2 对照表 | 我用自写脚本对两棵真实安装树做了机械比对 |

`@deepseek-ai/dsh` 的 `latest` dist-tag 当前是 `0.1.5-rc.1`；`0.1.5-rc.2` 也已发布。

### 2.2 Slot 对照表（0.1.2-rc.1 → 0.1.5-rc.1）

机械提取自两棵安装树的 `lib/types/**/slots.d.ts` 中的 `declare module ... interface SlotMap` 块。**共 48 个共有 slot，无一个 `kind`/`scope` 发生变化。**

**仅 0.1.5 新增（13 个）**

| slot | kind/scope | 原型是否会用到 |
|---|---|---|
| `main` | keyed/root | 否（布局用） |
| `main.conversation` | single/session-maybe | 否 |
| `rightbar` | single/root | 否 |
| `rightbar.session` | single/session | 否 |
| `sidebar.panellist` | list/root | 否 |
| `sidebar.right.pane.tab` | keyed/session | 否 |
| `sidebar.right.pane.tab.title` | keyed/session | 否 |
| `sidebar.right.tab.document` | keyed/session | 否 |
| `sidebar.right.tab.guide` | chain/session | 否 |
| `sidebar.right.tab.menu.item` | list/session | 否 |
| `settings.plugin.item` | keyed/root | 否 |
| `conversation.session.header.corner` | single/session | **是**（顶栏右侧 `⋯` 设置入口） |
| `tool.call.images` | single/session | 否 |

**仅 0.1.2 有、0.1.5 已移除（3 个）**

| slot | kind/scope | 影响 |
|---|---|---|
| `conversation` | single/session-maybe | 被 `main.conversation` 取代；插件不应注册 |
| `details` | single/session | 被 `rightbar.session` 取代 |
| `conversation.details.tool` | single/session | 被 `tool.call.toolview` 体系吸收 |

**共有且签名完全一致（48 个，原型关键项加粗）**

```
**shell.overlay**               list/root        **tool.call.toolview**    keyed/session
**sidebar**                     single/root      **conversation.composer** chain/session
**conversation.session.header** single/session   **settings.section**      list/root
conversation.chat.node          keyed/session    conversation.chat.assistant-actions  list/session
conversation.chat.commandview   keyed/session    conversation.chat.turnTail            chain/session
conversation.view               list/session     conversation.session                  single/session
conversation.session.header.actions    list/session      conversation.session.header.utilities list/session
conversation.session.header.lineage    single/session    conversation.approval.detail          single/session
conversation.composer.bar       single/session-maybe      conversation.composer.dock       list/session
conversation.input.attachments  single/session-maybe      conversation.input.dock          list/session
conversation.input.left         list/session              conversation.input.right         list/session
conversation.input.overlay      list/session              conversation.input.model         single/session
conversation.input.plan         single/session            conversation.message.images      single/session
conversation.trajectory.images  single/session            conversation.hero.workspace      single/root
conversation.hero.brand.mark    single/root               conversation.hero.agentPreset    single/root
conversation.hero.workspace.directoryFlow  single/root  sidebar.brand.mark               single/root
sidebar.brand.name              single/root               sidebar.footer.action            list/root
sidebar.workspaces              single/root               sidebar.workspaces.directoryFlow single/root
sidebar.settings                single/root               settings.action                  list/root
settings.close                  single/root               settings.general.item            list/root
settings.header                 single/root               settings.models.footer           list/root
settings.models.provider-card   keyed/root                settings.onboarding              list/root
settings.plugins.tab            list/root                 settings.trigger                 single/root
tool.view.cordis                keyed/session             root                             single/root
```

### 2.3 为什么推荐「兼容插件」而不是「升级运行时」

**升级路线的阻塞项（P0 级）**：`0.1.5` 给 `dsh-session-persistence-jsonl` 引入了 per-session 写租约：

```
persistContiguous() -> ensureLease() -> acquireWriteLease() -> SessionWriteLease.acquire()
  -> tryLockExclusive()  [@deepseek-ai/node-addon-system/flock]
       lib/flock.js:10-15:
       if (platform !== 'linux' && platform !== 'darwin')
         throw Error('flock is not supported on ' + platform + '-' + arch)  // code: ERR_FLOCK_UNSUPPORTED_PLATFORM
```

- `node-addon-system` 的 optionalDependencies **没有 android 条目**（只有 darwin-x64/arm64、linux-x64/arm64）。
- Android 上 `process.platform === 'android'` —— 这一点**本仓库自己的 CHANGELOG（v0.1.11）已经记录并依赖**（正因如此才有独立的 `dsh-tether-host-android-arm64` 子包）。
- `isLockContention()` 只认 `EAGAIN`/`EWOULDBLOCK`，不认这个 code，因此异常直接冒泡。
- `0.1.2-rc.1` 的同一包里 `SessionWriteLease` / `flock` **零命中**。

**严重性**：不是启动失败，而是**第一次会话落盘时失败** —— 更糟，因为它在启动之后才暴露。

**另外两个次要问题**：

- **`0.1.5-rc.1` 解析出的并不是 `0.1.5-rc.1`**。子包用 `^0.1.5-rc.1` 这样的预发布 caret 范围，而构建脚本带 `--no-package-lock`，所以真实树是 `1 × 0.1.5-rc.1（CLI 自身）+ 230 × 0.1.5-rc.2`。`manifest.json` 记的 `dsh: "0.1.5-rc.1"` 是**不准确的指纹**，且同一份 `package.json` 会构建出不同的树（CI 缓存键 `hashFiles('package.json')` 检测不到漂移）。
- **注入 CSS 里有一个选择器在 0.1.5 已死**：`index.js:430` 的 `[class*="_frame"] > [class*="detailsCol"]`。`detailsCol` 在 0.1.2 存在，在 0.1.5 两棵树里都是 **0 命中**，已更名为 `rightbarCol`。修法是一个词。

**如果将来要解除阻塞**，需要上游让 `flock` 像它的 browser-worker stub 那样优雅降级（`dsh-session-persistence-jsonl` 里已有先例：注释写着「浏览器 worker 把 native flock stub 成立即成功：它是单进程的」），或者发布 android-arm64 预编译。这是上游工作量，不是 tether 能一行解决的。

### 2.4 版本错配的实际失败模式（P0.4 答案）

**不会白屏，不会报错，是静默降级。**

关键源码，`dsh-client-ui-renderer/src/client/registry.ts:192-208`：

```ts
const reconcile = (): void => {
  if (stopped) return
  const spec = this._core.specDynamic(key)          // 该 slot 当前有没有被声明
  const epoch = this._core.declarationEpoch(key)
  if (active !== undefined && activeEpoch === epoch) return
  ...
  if (spec === undefined) return                     // ★ 未声明 → 直接返回，回调永不执行
  const disposeEffect = ctx.effect(callback, `slots.inject(...)`)
}
```

`ctx.slots.inject(key, cb)` 只在 key 被声明时运行 `cb`；未声明时是一个**待命状态**，等声明出现再运行。因此：

| 场景 | 行为 |
|---|---|
| 插件注册 `0.1.5` 独有 slot，跑在 `0.1.2` 上 | 该条贡献静默不渲染，**其余贡献正常工作**，控制台无错误 |
| 插件注册一个两个版本都没有的 slot | 同上 |
| 组件内部抛异常 | 该 entry 从 cell 中退位（abdicate），下一个幸存者渲染 |

这是**兼容插件方案的可行性基础**：可以放心写只针对 `0.1.5` 的 slot，不会拖垮 `0.1.2`。

**但要区分两种失败**（实测差异）：
- `ctx.slots.inject()` 到未声明 slot → **安全**，静默跳过。
- `ctx.slots.register()` 直接注册到未声明 slot → **抛异常**，`slot "X" is not declared`（`ui-slots/src/index.ts:829`）。所以**必须用 `inject` 包裹 `register`**，不能裸调 `register`。

---

## 3. UI 插件设计

### 3.1 架构定位

DSH 是公开 MIT 仓库（`github.com/deepseek-ai/deepseek-harness`，React 18.3 + Vite 6 + TypeScript，仓库简介一句话：**"DeepSeek Harness: Everything is a Plugin."**）。前端拆成约 40 个 `@deepseek-ai/dsh-client-ui-*` 包，通过**带类型检查的 slot 注册表**组合。官方文档 `docs/subsystems/slots.md` 明确：

> "Treat `single` and an occupied keyed cell as replacement points. Use list ids or an unoccupied key for additive extensions."

即：`list` 类 slot 用新 `id` 追加，`single`/已占用的 `keyed` 是替换点。`tool.call.toolview` 的类型注释亦写明「已覆盖的 key 是**替换**而非共享」。

**所以这是一个官方支持的扩展点，不是 hack。** 不需要 fork DSH，也不需要改 tether 源码。

### 3.2 插件文件结构

```
dsh-plugin-mobile-ui/
├── package.json          # 双声明：dsh.bundle.patch + dsh.client（缺一不可，见 §3.5）
├── cordis.patch.yml      # profile 层：insert 一行挂载自己
├── tsdown.config.ts      # 两个产物：Node 半边 ESM + 浏览器半边 CJS
├── verify-bundle.mjs     # 无浏览器验证 loader 契约（本次调研产出，建议保留）
├── src/
│   ├── index.ts          # Node 半边：空 apply
│   └── client/
│       ├── index.tsx     # apply：ctx.slots.inject(...)
│       ├── Splash.tsx    # 启动页 → shell.overlay
│       ├── ToolCard.tsx  # 工具卡片 → tool.call.toolview
│       ├── Drawer.tsx    # 抽屉 → sidebar
│       ├── Settings.tsx  # 设置页 → settings.section
│       └── theme.ts      # token 读取与映射（不硬编码颜色）
└── lib/                  # 构建产物（lib/index.js, lib/client.js, lib/client.js.map）
```

### 3.3 两个声明缺一不可（本次实测踩到的坑）

我第一版只写了 `dsh.client`，CLI 明确警告：

```
dsh: warning: dsh-plugin-mobile-ui declares no dsh.bundle —
     installed as a plain dependency, not a profile layer
```

**`dsh.client` 只是「告诉 client-modules 这是个浏览器插件」；真正让 Loader 挂载宿主行、从而进入 `window.__DSH_BOOT__` 的是 `dsh.bundle.patch`。** 两者都要：

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-layout"
      ]
    }
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: mobile-ui
      name: dsh-plugin-mobile-ui
```

> `dsh.client.inject` 是**信息性**的包名边（预检显示、HMR diff），不决定激活顺序；激活顺序由 Cordis 服务注入决定。

### 3.4 构建配置（关键：external 必须精确对齐 `PLATFORM_MODULES`）

外壳播种一张**冻结模块表**，插件 bundle 只能 require 这张表里的东西：

```ts
// packages/client/web/src/platform.ts —— 全部 9 项，一项不多
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const
```

产物必须是 **CJS + closure-factory**，带 banner/footer，**不能自带 React**：

```ts
import { defineConfig } from 'tsdown'

const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]
const ID = 'dsh-plugin-mobile-ui'
const isShared = (s: string) => PLATFORM_MODULES.includes(s)

export default defineConfig([
  { name: ID, entry: ['src/index.ts'], outDir: 'lib', format: ['esm'],
    platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false },

  { name: `${ID}/client`, entry: { client: 'src/client/index.tsx' }, outDir: 'lib',
    format: 'cjs', platform: 'browser', target: 'es2024', dts: false, clean: false,
    sourcemap: true,
    // ★ 顶层 external（不是 deps.neverBundle —— 那是 DSH 内部用的另一个打包器 API，tsdown 会静默忽略）
    external: (specifier: string) => isShared(specifier),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
```

**实测教训**：我第一次写的是 DSH 内部预设里的 `deps: { neverBundle, alwaysBundle }` —— 那是 rolldown 的配置面，tsdown 0.15 用的是顶层 `external`/`noExternal`，**结果被静默忽略，React 被打进了 bundle**（16.26 kB，`Symbol.for("react.element")` 命中 3 次）。改成 `external` 后降到 **5.76 kB**，externals 正好是 `react, react/jsx-runtime`。

### 3.5 Slot 注册代码骨架

```tsx
// src/client/index.tsx
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'   // 只为类型声明合并
import { Splash } from './Splash.tsx'

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  // 必须 inject 包裹 register：对未声明的 slot，inject 是静默待命，
  // 裸 register 会抛 "slot is not declared"。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'mobile-ui-splash', order: 10 },
      Splash,
    ))
}
```

启动页组件（`shell.overlay` 是 **list/root** 语义：新 `id` 追加而非替换，且该层可点击穿透，占用者需自行 opt-in 指针事件）：

```tsx
export function Splash() {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), 900)
    const drop = setTimeout(() => setGone(true), 1100)
    return () => { clearTimeout(fade); clearTimeout(drop) }
  }, [])
  if (gone) return null
  return <div className="dsh-mobile-splash" data-leaving={leaving}>…</div>
}
```

### 3.6 配色 token 映射表

DSH 的 token 在 `packages/client/ui-theme/src/styles/`，由 theme presenter 投影到 `document.body`。**原型的深色配色是蓝调的，DSH 的深色是中性灰调 —— 映射是语义层面的，不是色相层面的。** 插件因此获得 DSH 的主题行为（浅/深/跟随系统三态自动生效），而不是把颜色写死。

| 原型 token | DSH token | light | dark | 备注 |
|---|---|---|---|---|
| `--bg` `#0B0D10` | `--dsw-alias-bg-base` | `#FFFFFF` | `rgb(21,21,23)` | |
| `--surface` `#14171C` | `--dsw-alias-bg-layer-1` | `#FFFFFF` | `rgb(35,35,36)` | 浅色下与 bg-base 同值：浅色靠描边/阴影分层，不靠填充 |
| `--surface-2` `#1A1E24` | `--dsw-alias-interactive-bg-hover` / `-active` | `rgba(38,49,72,.06)` / `.1` | `rgba(255,255,255,.08)` / `.14` | 是**半透明覆盖层**，不是不透明填充 |
| `--border` `#232830` | `--dsw-alias-border-l2` | `rgba(0,0,0,.1)` | `rgba(255,255,255,.12)` | 必须画成 **0.5px** |
| `--text` `#E8EAED` | `--dsw-alias-label-primary` | `rgb(15,17,21)` | `rgb(249,250,251)` | |
| `--text-dim` `#8B93A1` | `--dsw-alias-label-secondary` | `rgb(97,102,107)` | `rgb(207,211,214)` | |
| `--text-faint` `#5A6272` | `--dsw-alias-label-tertiary` | `rgb(129,133,140)` | `rgb(173,178,184)` | 微标签用 `--dsw-alias-label-caption`（值相对 tertiary 是反的） |
| `--accent` `#4D6BFE` | `--dsw-alias-brand-primary-new-colorprimary-new-color` | `#4176E6` | `rgb(86,134,254)` | **注意：`--dsw-alias-brand-primary` 不是蓝色**，它解析成近黑/近白。平台自己写明了这点（`ui-dockkit/README.md:72`：「Emphasis takes the platform's accent, never `--dsw-alias-brand-primary`」） |
| `--accent-soft` | **无 token** | — | — | 官方表达是 `color-mix(in srgb, <accent> 8%, transparent)`（先例：`ui-dockkit/.../dockkit.module.css:581`） |
| 阴影 | `--dsw-elevation-panel` / `-prominent` / `-soft` | — | — | 用阴影时须 `border: 0`；规范明确禁止「`--dsw-alias-border-*` 描边 + elevation 阴影」同时出现 |
| 26px 胶囊 / 14–16px 卡片 / 30px 抽屉 / 18px 气泡 | **无圆角 token** | — | — | 全仓库 grep `--dsw-*radius*` 零命中。圆角写实数；DSH 自己的气泡是 22px |
| 正文 14.5/1.72 | `--dsh-content-font-size` + `--dsw-font-markdown-base` | 默认 14px | — | 14/22=1.571；要 ~1.72 用 markdown-base 的 14/24=1.714 |
| 次要 13–13.5 | `--dsh-content-font-size-secondary` / `--dsw-font-xs-13` | 13px | — | |
| 微标签 11px/1.3px/uppercase | `--dsw-font-xxxs-11` | 11px/14px | — | **letter-spacing / text-transform 无 token**；DSH 实际字距约 `0.04em`（11px ≈ 0.44px），原型 1.3px 偏大 2–3 倍 |
| 等宽 | `--ds-font-family-code` | — | — | **不是 `--dsw-font-mono`**：那个变量被 5 个样式表引用但**全仓库从未定义**，一处调用还没写 fallback |
| 动效 | `--ds-transition-duration` (.2s) / `-fast` (.1s) / `--ds-ease-in-out` | — | — | 前缀是 `--ds-` 不是 `--dsw-` |

**必须遵守的规范**（`docs/web-styling.md`，超标会被 gate 拒绝）：

- 用 `--dsw-alias-*` 语义 token，**feature 组件里不许写死颜色**（`:17`）。注意：这条目前是**评审约束，没有机器 gate**（我查过 `scripts/`，只有 elevation 与 corner-shape 两个 spec + i18n gate）。
- feature 包**不得定义自己的全局主题**（`:9`）。
- 中性描边统一 `0.5px`（`:25`）。
- 用 CSS Modules + `clsx`；**禁止**引入组件库或 Tailwind（`:16`）。
- 全圆角须配 `corner-shape: round`（`:23`）。
- 尊重 `prefers-reduced-motion`（`:22`）。
- **产品文案必须走 locale 字典**：`verify-client-ui-i18n` 会拒绝 JSX 文本、14 个具名属性、以及匹配 `/Aria|Copy|Description|Heading|Label|Message|Placeholder|Summary|Text|Title|Tooltip$/` 的 prop 中的硬编码文案。机制四步：`zh`/`en` 字典 → `declare module` 合并 `LocaleNamespaceMap` → `ctx.locale.register(ns, {zh,en})` → `register({ locale: ns })` 后渲染器合成 `t`。

**顺手发现的坑**：主题 presenter 把 token 作为 **`body` 上的 inline style** 写入，因此**插件不能靠在 CSS 里重新声明同名变量来覆盖第三方主题** —— inline style 优先级更高。

### 3.7 各页面实现要点

| 原型元素 | 目标 slot | kind | 要点 |
|---|---|---|---|
| **启动页** | `shell.overlay` | list/root | 官方注释直接点名这是「帧级浮层，位于所有列之上、滚动容器之外，故意通用且不归属任何 feature：徽章、toast 栈、状态胶囊都属于这里」，且**可点击穿透**。挂 `id` 追加即可。`0.1.2`/`0.1.5` **都有**此 slot |
| **工具卡片** | `tool.call.toolview` | keyed/session | 按 wire tool name 键控。**已有的 key 是替换，未认领的 key 回退到通用 tool row** —— 对自有工具是追加，对自带工具是接管。owner props 提供 `callId`/`toolName`/`block`/`cwd`/`openFile`。两版本一致 |
| **抽屉** | `sidebar` | single/root | 官方注释：注册到这里「直接替换整个导航列，而不是往里加东西」。被替换掉的席位（`sidebar.workspaces` 等）随之消失 —— **替换方必须自己把它们渲染回来**。两版本一致 |
| **输入框** | `conversation.composer` | chain | chain 语义：每个 entry 提供 `select(owner)`，按 priority 升序取第一个非 null，全 null 则用 owner fallback。已占用的 key 可替换。另有 `conversation.input.left/right/overlay/dock` 等细粒度 list 席位可只做加法。两版本一致 |
| **会话顶栏** | `conversation.session.header` + `.actions`/`.utilities` | single + list | `.actions`/`.utilities` 是 list，适合放 `⋯` 之类的按钮。`.corner` 是 **0.1.5 新增**，若要放右侧入口需接受 `0.1.2` 上不出现 |
| **设置页** | `settings.section` | list/root | list 席位，用新 `id` 追加一个分组卡片；`settings.general.item` 是单行席位。两版本一致 |
| 主界面整体 | `main.conversation` | single/session-maybe | **0.1.5 新增**。整体接管对话区属于高耦合操作，建议放到最后阶段，且需接受 `0.1.2` 降级 |

**注意 slot 数量与命名不是契约**：`docs/subsystems/slots.md` 说「生成的 Client inspect catalog 才是每个 key 的详尽契约」，且运行中的动态包可以用 `cordis_inspect what:"client"` 查询实时 slot 树。建议实现期以此为唯一真源。

---

## 4. 实施路线图

### Phase 0 · 已完成（本次调研）

产出：本报告 + slot 对照表 + 可构建的最小插件 + 验证脚本。
验收：见 §6「已验证清单」，全部为可复现命令产出的结果，非推断。

### Phase 1 · 启动页（`shell.overlay`）

- 目标：冷启动无白屏，启动页淡出接续 DSH 首帧。
- 产出：`src/client/Splash.tsx` + 样式 + 构建配置。
- 验收：
  1. `npm run bundle` 产出 `lib/client.js`，externals 仅 `react` / `react/jsx-runtime`。
  2. `node verify-bundle.mjs lib/client.js` 打印 `RESULT: bundle satisfies the loader contract`。
  3. 真机打开 App，冷启动看到启动页，淡出后进入 DSH，**无白闪**。
  4. `0.1.2` 宿主上同样渲染（`shell.overlay` 两版本共有）。

### Phase 2 · 原生启动主题（Android 侧，与 Phase 1 互补）

- 现状实测：`values/themes.xml` 与 `values-night/themes.xml` **内容逐字相同**，都是未改动的 Tauri 模板；**没有 `windowBackground`，没有 `core-splashscreen` 依赖**；`tauri.conf.json` 无 splash 段；`compileSdk`/`targetSdk` 36，`minSdk` 24；edge-to-edge 只在 `MainActivity.kt:8` 调用 `enableEdgeToEdge()`。
- 目标：让系统级 splash 与 Phase 1 的 HTML 启动页在视觉上是同一屏。
- 产出：`core-splashscreen` 依赖 + `windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon` + `postSplashScreenTheme`。
- 验收：冷启动第一帧即为品牌底色与标记，无原生白闪；启动页 → DSH 首帧的接缝不可辨。
- 注意：`targetSdk ≥ 31` 时系统本来就有默认 splash（窗口背景 + 启动图标），不配置就是 Material 默认外观 —— 这是「启动页不好看」的主要来源之一。

### Phase 3 · 工具卡片（`tool.call.toolview`）

- 目标：工具调用内嵌为消息流里的折叠卡片。
- 产出：按工具名逐个注册的 keyed view。
- 验收：
  1. 折叠态一行摘要，展开动画 `grid-template-rows: 0fr → 1fr`。
  2. 未认领的工具仍回退到通用 tool row（不能把没注册的工具变成空白）。
  3. 在 `0.1.5` 上验证；`0.1.2` 上同一份产物行为一致（slot 共有）。

### Phase 4 · 抽屉与设置页

- 目标：机器/会话管理入抽屉，设置退二级页。
- 产出：`sidebar` 替换 + `settings.section` 追加。
- 验收：
  1. 抽屉的机器切换、会话列表可用；**被替换掉的 `sidebar.workspaces` 等席位已自行渲染回来**。
  2. 设置页可进入可返回，返回后主界面状态不变。
  3. 所有行可点区域 ≥44px。
  4. 开关状态持久化。

### Phase 5 · 主题一致性与收尾

- 目标：消除 tether 现有 CSS 注释里自己承认的毛病（「用户在 dsh 里显式选了与系统相反的主题时，外壳这一条窄带会不一致」）。
- 产出：插件内统一走 `--dsw-alias-*`；若外壳仍需保留，用注入脚本观察 `body[data-ds-dark-theme]` 并 postMessage 同步。
- 验收：DSH 内切换浅/深/跟随系统，插件所有表面同步变色，无残留。

---

## 5. 风险与降级

| # | 风险 | 严重度 | 应对 / 降级 |
|---|---|---|---|
| 1 | **`0.1.2` 与 `0.1.5` 的 slot 差异导致行为不一致** | 低 | 只使用 48 个共有 slot。必须用 `0.1.5` 独有 slot 时（如 `conversation.session.header.corner`），接受 `0.1.2` 上不渲染。**已实测：未声明 slot 是静默跳过，不崩溃** |
| 2 | **升级 Android 运行时被 `flock` 阻塞** | 高（若强行升级） | **不升级**。若将来必须升级，先在上游解决 `flock` 的 Android 行为 |
| 3 | **slot 契约在上游演进中变化** | 中 | 用语义化 slot key（不用 CSS Module 哈希类名）；启动时做「注入健康检查」，关键 slot 缺失则降级到基础样式。这比现有 `[class*="..."]` 注入稳健得多 |
| 4 | **`shell.overlay` 可点击穿透** | 中 | 占用者需显式 opt-in 指针事件，否则启动页挡不住也点不到 —— 淡出后必须真正卸载，不能只设 `opacity: 0` |
| 5 | **键盘遮挡悬浮输入框** | 中 | 用 `visualViewport` 监听键盘高度动态调整；或改 `position: sticky` 配合 flex。Android WebView 上必须真机验证，模拟器不可信 |
| 6 | **自带 React 导致运行时不匹配** | 中 | bundle 里 React 必须是 external。**用 `verify-bundle.mjs` 在 CI 里断言 externals 集合**，可机械拦截 |
| 7 | **代码块/长行横向溢出** | 低 | 容器 `overflow-x: auto` + `white-space: pre` |
| 8 | **i18n gate 拒绝硬编码文案** | 低 | 所有产品文案走 locale 字典（§3.6 四步） |
| 9 | **`0.1.5` 客户端 combo 体积大** | 中 | 我实测单个 application combo **约 11 MB**。移动网络下首次加载可观 —— 启动页应给出进度反馈，不要只有一个静态 logo |
| 10 | **本地模式与远程模式是两套独立存储** | 低（产品语义） | DSH 自身设计如此，UI 需在切换时明确提示当前是「本机」还是「某台电脑」 |
| 11 | **集成：插件不是 profile 层** | 中 | `dsh.bundle.patch` 与 `dsh.client` 必须同时声明（§3.3）。漏了前者会被静默装成普通依赖、完全不生效 |
| 12 | **profile 的 `minimumReleaseAgeExclude`** | 低 | 本机 profile 用 pnpm 的发布年龄门控，新发布的包需要显式 `minimumReleaseAgeExclude` 才能立刻装上（tether 的 install 已在做这件事） |

---

## 6. 已验证清单（可复现）

以下每一项都在本机实际执行过，非推断。

| 验证项 | 命令 / 方法 | 结果 |
|---|---|---|
| 两个 dsh 版本都能为 android-arm64 安装 | `npm install @deepseek-ai/dsh@<ver> --os=android --cpu=arm64 --ignore-scripts --no-package-lock` | `0.1.2-rc.1` ✅ `bin.js` present；`0.1.5-rc.1` ✅ `bin.js` present |
| slot 对照 | `slot-diff.ps1 -OldRoot <0.1.2树> -NewRoot <0.1.5树>` | 51 → 61；共有 48，**spec 变更 0**；新增 13；移除 3 |
| plugin 可构建 | `npm run bundle`（tsdown 0.15.12） | `lib/index.js` 205 B，`lib/client.js` 5,756 B |
| bundle 满足 loader 契约 | `node verify-bundle.mjs lib/client.js` | `loader calls: 1`；`externals: react, react/jsx-runtime`；`exports: apply, inject`；`registered -> name=shell.overlay id=mobile-ui-splash`；`RESULT: bundle satisfies the loader contract` |
| 插件可作为 profile 层安装 | `dsh plugin --profile scratchui add <dir>` | 无警告，写入 `dependencies` |
| profile 可启动 | `dsh --profile scratchui --port 3099 --no-open` | `dsh web: http://127.0.0.1:3099/?token=…` |
| **插件进入 boot graph** | 带 cookie GET `/`，搜 `__DSH_BOOT__` | `dsh-plugin-mobile-ui` 命中 **5** 次；combo URL 含 `dsh-plugin-mobile-ui/client.js` |
| **插件 bundle 被实际服务** | GET 该 combo URL | HTTP 200，11,083,654 B；含 `window.__ModuleLoader__.load({ id: "dsh-plugin-mobile-ui", …})`；含 `mobile-ui-splash` / `shell.overlay` |
| 未声明 slot 的失败模式 | 读 `ui-renderer/src/client/registry.ts:201` | `if (spec === undefined) return` —— 静默跳过 |

**复现所需命令**（依序）：

```powershell
# 1. 取源码（git clone 在本机不通 github.com，用 codeload）
curl.exe -L -o dsh-tether.tar.gz https://codeload.github.com/zexadev/dsh-tether/tar.gz/refs/heads/main
curl.exe -L -o dsh.tar.gz       https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/refs/heads/master

# 2. 取两个版本的 slot 类型
curl.exe -L -o v012.tgz https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-tool/-/dsh-client-ui-tool-0.1.2-rc.1.tgz

# 3. 构建插件
cd H:\DSH\_work\plugin; npm install; npm run bundle

# 4. 验证契约 + 实机加载
node verify-bundle.mjs lib/client.js
node <dsh>/lib/bin.js plugin --profile scratchui add .
node <dsh>/lib/bin.js --profile scratchui --port 3099 --no-open
```

---

## 7. 真机验证路径

仓库自带 `scripts/android-webview-cdp.mjs` 与 `scripts/android-device.mjs`，走 Chrome DevTools Protocol 驱动真机 WebView。

**建议流程**：

1. 确保插件已装进**远程模式**使用的 profile（电脑端 `0.1.5`），因为手机加载的是电脑上的 DSH。
2. `dsh web` 起动，手机 `dsh-tether` 配对连接。
3. 用 `android-webview-cdp.mjs` 连接 WebView，逐项断言：
   - `document.querySelectorAll('[data-slot="shell.overlay"]').length`（`ui-renderer` 会输出 `data-slot` 属性）
   - 启动页元素存在并已淡出卸载
   - `getComputedStyle(el).getPropertyValue('--dsw-alias-bg-base')` 与预期 token 一致
   - 深浅色切换后启动页/卡片颜色同步
4. **键盘遮挡必须真机验证**：模拟器的软键盘行为与真机不同。用 `visualViewport.height` 变化量判断键盘高度，断言输入框未被遮挡。
5. 本地模式（手机端 `0.1.2`）单独回归一遍，确认未声明 slot 静默跳过、其余功能正常。

**注意**：远程模式下手机是通过本地代理（`127.0.0.1:<派生端口>`）加载 DSH 的，`dsh-client-modules` 的 `/plugins` 路由同样经代理，实测可正常服务 combo（我本地已验证该路由此形态存在）。

---

## 8. 待确认问题（未能确定，不猜测）

1. **`flock` 阻塞是否真机复现。** 证据链完整（读遍 shipped 构建产物 + Node 的 `process.platform` 语义 + 本仓库 CHANGELOG 自述），但**未在真机/模拟器上执行过**。最省的验证：Android/Termux 上 `node -p "process.platform"`，再用 `0.1.5` 树跑一次会话写入。**在据此下任何结论前应先做这一步。**
2. **`sharp` 在 android-arm64 上如何工作。** 两棵树里 `sharp@0.35.4` 都**没有** Android 平台包或 libvips 二进制（只有 `@img/colour`），而 `dsh-attachment-local` 是静态 `import sharp`，且被 `dsh-base` 挂载。既然 `0.1.2-rc.1` 真机可用，必然存在某种回退 —— 但我没找到。**两版本一致，故不影响版本策略结论。**
3. **`0.1.5-rc.1` 的确切解析结果**：我确认了「是 rc.2 大家庭」，但没能枚举当前所有 `0.1.5-rc.*`（registry 在该子任务执行期间超时）。
4. **`detailsCol` → `rightbarCol` 的视觉影响**。我确认选择器在 `0.1.5` 已死（0 命中），但「右栏被自动放进 56px 列」是从 CSS Grid 规则推出的**推断**，未在设备上观察。
5. **APK 体积增量**：未测量。`app/src-tauri/android-runtime/` 在本 checkout 中不存在（未构建运行时）。
6. **`0.1.5` 里 `index.js:711` 那个「打开配置文件」按钮文案正则**是否仍匹配（依赖上游 locale 文案）。
7. **`conversation.session.header.corner` 在 `0.1.2` 上的替代方案**：`0.1.2` 没有这个 slot，也没有 `main.conversation`/`rightbar.session`。若顶栏右侧入口必须出现，需找到 `0.1.2` 上等价的 list 席位（候选：`conversation.session.header.utilities`，两版本共有）—— 尚未逐一核实其视觉位置是否等价。
8. **两个 tarball checkout 都没有 `.git`**，故 0.1.2 → 0.1.5 的变更集是从产物反推的，不是从提交历史读的。

---

## 9. 附：本次调研产出的文件

| 路径 | 内容 |
|---|---|
| `H:\DSH\dsh-theme-token-mapping.md` | 完整 token 映射表（含每个 token 的 file:line 出处） |
| `H:\DSH\_work\dsh-tether-dsh-0.1.5-bump-report.md` | tether 升级兼容性完整报告（含 flock 阻塞链） |
| `H:\DSH\_work\slot-diff.ps1` | 可复用的 slot 对照脚本（对两颗安装树机械提取） |
| `H:\DSH\_work\plugin\` | **可构建、已实测加载的最小客户端插件** |
| `H:\DSH\_work\plugin\verify-bundle.mjs` | 无浏览器的 loader 契约验证器（建议进 CI） |
| `H:\DSH\_work\v012offline\` / `H:\DSH\_work\npmdiff\v012\` | `0.1.2-rc.1` 的 android-arm64 安装树与客户端包解包 |

---

## 10. 对最初规格书的偏差说明

规格书假设了「路径 A（纯注入）/ 路径 A+（注入 + JS）/ 路径 B（fork 前端）」三分法。调研结论是**三者都不必选**：

- **不必 fork**（路径 B 的代价）：官方 slot 系统就是公开扩展点，MIT 仓库，无需改上游源码。
- **不必止于纯注入**（路径 A 的天花板）：工具卡片内嵌、抽屉替换、设置页这些原型核心元素都有官方 slot，可以做到接近 100% 还原。
- **真实路径是 D′**：一个独立的客户端插件包，同时兼容两个 DSH 版本，零 tether 改动、零 DSH 改动。

规格书中「如果前端闭源则降级」的判定分支不适用于本项目 —— 前端是开源的，但**关键不在于能改它的源码，而在于它已经提供了带类型检查的替换点**。这是比 fork 更好的位置。
