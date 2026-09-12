# dsh-plugin-mobile-ui

**把 DeepSeek Harness 的 Web 界面改造成移动端优先的界面 —— 以官方 slot 客户端插件的形式，不 fork、不注入 CSS。**

[English](README.en.md) · 中文

> **状态（2026-09-12）：手机端可用。** 手机上以顶栏**「导航」**文字打开浮层抽屉，做会话切换、设置、重连；**启动页**、**移动端设置页**、**5 张工具卡**（替换式）默认开启；侧栏整体接管（`sidebar` single 插槽）**已放弃并默认关闭**，代码保留在 `Drawer.tsx`。
>
> - 当前实现与真机操作一览：**[`docs/MOBILE-UI-GUIDE.md`](docs/MOBILE-UI-GUIDE.md)** ← 建议先读这一份
> - 逐场修改日志：**[`docs/2026-09-11-session-log.md`](docs/2026-09-11-session-log.md)**
> - 键盘「首次不弹 / 时好时坏」的根因在 Tauri 壳（缺 `windowSoftInputMode`），客户端只能缓解，根治需重编 APK —— 见 [键盘 / 输入框](docs/MOBILE-UI-GUIDE.md#7-键盘--输入框重要)
>
> 下文（含「可选的替换式表面」「版本兼容性」）描述的是本 README 写作时的较早状态，凡与 `docs/MOBILE-UI-GUIDE.md` 冲突处，以该文档为准。

---

## 目录

- [这是什么 / 不是什么](#这是什么--不是什么)
- [三条核心结论](#三条核心结论)
- [快速开始](#快速开始)
- [验证它真的生效了](#验证它真的生效了)
- [工作原理](#工作原理)
- [可选的替换式表面](#可选的替换式表面)
- [版本兼容性](#版本兼容性)
- [开发](#开发)
- [注意事项](#注意事项)
- [已知限制与阻塞项](#已知限制与阻塞项)
- [目录结构](#目录结构)
- [文档索引](#文档索引)
- [许可与声明](#许可与声明)

---

## 这是什么 / 不是什么

**是：** 一个符合 DSH 官方客户端插件规范的 npm 包。它通过 `ctx.slots.register()` 把 UI 注册进 DSH 的插槽系统，和 DSH 自带的 `ui-sidebar`、`ui-chat`、`ui-tool` 等约 40 个客户端插件走**完全相同**的机制。

**不是：**

| 不是 | 为什么这很重要 |
|---|---|
| 不是 dsh-tether 的 fork | dsh-tether 继续负责 P2P 连接层，本插件只管 UI。两者并行安装，互不修改 |
| 不是 CSS 注入 | dsh-tether 现有的窄屏适配是往 HTML 里 `replace('</head>', '<style>…')`；本插件走有类型检查的官方扩展点 |
| 不是 DSH 的 patch | 不修改 DSH 源码，DSH 以原样运行 |
| 不是 dsh-tether 的替代品 | 没有连接层，本插件**单独安装时手机上什么也连不上** —— 它只改界面 |

> **重要前提：** 本插件只负责界面。要让手机连上电脑，你仍然需要 `dsh-plugin-tether`。两者是互补关系。

---

## 三条核心结论

这三条都有实测证据，不是推断。

### 1. DSH 的 UI 是插件化的，插槽是公开扩展点

DSH 是公开 MIT 仓库（`github.com/deepseek-ai/deepseek-harness`，仓库简介：**"DeepSeek Harness: Everything is a Plugin."**），前端为 React 18.3 + Vite 6 + TypeScript，拆成约 40 个 `@deepseek-ai/dsh-client-ui-*` 包，由一套带编译期类型检查的 slot 注册表组合。

官方文档 `docs/subsystems/slots.md` 明确写道：

> Treat `single` and an occupied keyed cell as replacement points. Use list ids or an unoccupied key for additive extensions.

即：`list` 类插槽用新 `id` 追加，`single` 与已被占用的 `keyed` 插槽是**替换点**。`tool.call.toolview` 的类型注释也写明「已覆盖的 key 是替换而非共享」。

**所以这是官方支持的扩展方式，不是 hack。**

### 2. 两个 DSH 版本的插槽面差异极小，可以写一个插件同时兼容

实测对照 `0.1.2-rc.1`（手机本地模式打包的版本）与 `0.1.5-rc.1`（电脑端当前版本）：

| | 数量 |
|---|---|
| `0.1.2-rc.1` 插槽 | 51 |
| `0.1.5-rc.1` 插槽 | 61 |
| **共有** | **48** |
| **共有但签名（`kind`/`scope`）有变化** | **0** |
| 仅 0.1.5 新增 | 13 |
| 仅 0.1.2 有（已移除） | 3 |

原型所需的关键插槽（`shell.overlay`、`tool.call.toolview`、`conversation.composer`、`sidebar`、`settings.section`、`conversation.session.header`）**全部落在 48 个共有点里**。

### 3. 版本错配是静默降级，不是崩溃

`ui-renderer/src/client/registry.ts:201`：

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
  if (spec === undefined) return          // ← 插槽未声明：直接返回，回调永不执行
  const disposeEffect = ctx.effect(callback, `slots.inject(...)`)
  active = () => { void disposeEffect() }
  activeEpoch = epoch
}
```

`ctx.slots.inject(key, cb)` 在 `key` 未被声明时只是**待命**，不抛错。因此本插件在 `0.1.2` 宿主上运行时不会白屏、不会报错，只是少渲染那几个 `0.1.5` 独有插槽的内容。

> ⚠️ **但这条只对 `inject` 成立。** 裸调 `ctx.slots.register()` 注册到未声明的插槽会抛 `slot "X" is not declared`。**必须用 `inject` 包裹 `register`。**

---

## 快速开始

### 前置条件

| 项 | 要求 |
|---|---|
| DSH | `0.1.2-rc.1` ~ `0.1.5-rc.x`（已验证范围，见[版本兼容性](#版本兼容性)） |
| Node | `^22.19 \|\| >=24`（DSH 自身要求） |
| 手机连电脑（可选） | 需要另外安装 `dsh-plugin-tether`；本插件不提供连接能力 |

### 安装

**方式 A：从本仓库目录安装（唯一尚未发布的方式）**

```sh
# 1. 取得源码
git clone https://github.com/loeissu/dsh-plugin-mobile-ui.git
cd dsh-plugin-mobile-ui

# 2. 安装依赖并构建 —— 必须做。lib/ 不入版本库
npm install
npm run bundle

# 3. 自检产物是否符合 DSH 的 loader 契约
npm run verify

# 4. 装进你的 DSH profile
dsh plugin --profile web add .
```

> **为什么必须先构建：** `lib/` 是构建产物，已在 `.gitignore` 中排除。DSH 的 Loader 直接从磁盘读 `lib/client.js` 并把它发布到 `/plugins/dsh-plugin-mobile-ui/client.js`，所以没有构建过的克隆装上去会**完全不生效**。

**方式 B：从 npm 安装（尚未发布）**

```sh
dsh plugin --profile web add dsh-plugin-mobile-ui
```

> `--profile web` 是 Web GUI 所在的 profile 名。如果你用的是其它 profile，替换成对应的名字。

### 重启才能生效

插件在**启动时**被 Loader 扫描。装完必须重启 `dsh web`：

```sh
# 停掉当前 dsh web（Ctrl+C），然后重新启动
dsh web
```

> **装完不重启 = 不生效**，且不会有任何报错 —— 这是最常见的「装了没反应」原因。

### 确认安装成功

```sh
dsh plugin --profile web list
```

应当在依赖列表里看到 `dsh-plugin-mobile-ui`。

如果你看到这样一条警告：

```
dsh: warning: dsh-plugin-mobile-ui declares no dsh.bundle — installed as a plain dependency, not a profile layer
```

说明 `package.json` 里缺少 `dsh.bundle.patch` 声明（见[工作原理](#工作原理)），插件**不会生效**。

### 卸载

```sh
dsh plugin --profile web remove dsh-plugin-mobile-ui
```

然后重启 `dsh web`。

---

## 验证它真的生效了

不要只看「装上了」，要确认它进了**启动图**。以下命令在本仓库的调研过程中实际执行过。

### 自动验证（离线，不需要浏览器）

`verify-bundle.mjs` 用一个模拟的 `window.__ModuleLoader__` 执行构建产物，断言它满足 DSH 的 loader 契约：

```sh
npm run verify
```

期望输出：

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

这个脚本会拦截三类常见错误：
- bundle 里**自带了 React**（会从 `externals requested` 里看出来，且体积明显偏大）
- bundle 没有包 `__ModuleLoader__.load` 外壳（`loader calls` 不等于 1）
- `apply` / `inject` 导出缺失，或没有注册到预期的插槽

### 端到端验证（确认插件进了浏览器启动图）

```sh
# 1. 用独立端口起一个实例，拿到带 token 的 URL
dsh web --port 3099 --no-open
# 输出形如：dsh web: http://127.0.0.1:3099/?token=<TOKEN>

# 2. 用 token 换 cookie（会返回 303 和 set-cookie）
curl -sS -i "http://127.0.0.1:3099/?token=<TOKEN>" | head -20

# 3. 带 cookie 抓首页，搜插件名
curl -sS -H "Cookie: <上一步的 set-cookie 值>" http://127.0.0.1:3099/ | grep -o 'dsh-plugin-mobile-ui' | wc -l
```

命中次数 **> 0** 即表示插件已进入 `window.__DSH_BOOT__` 启动图。本次调研中的实测结果是命中 **5 次**，且 combo URL 里包含 `dsh-plugin-mobile-ui/client.js`。

进一步确认 bundle 真的被服务了：

```sh
# 从首页 HTML 里取出含本插件的 combo URL，直接请求它（未转义的 & 需要还原）
curl -sS -o combo.js -w "%{http_code} %{size_download}\n" "http://127.0.0.1:3099/plugins/??...&rev=..."
grep -c '__ModuleLoader__.load({ id: "dsh-plugin-mobile-ui"' combo.js
```

实测：HTTP **200**，**11,083,654 字节**（这是整个 application combo 的体积，含 DSH 全部前端插件，不只是本插件）。

### 肉眼验证

启动后应当看到启动页（品牌标记 + `DSH Tether` + 一行提示 + 脉冲小点），约 0.9 秒后淡出，露出 DSH 界面。**若无白屏闪烁**，说明接缝正确。

---

## 工作原理

### 一个客户端插件需要**两个**声明，缺一不可

这是本次调研踩到的第一个坑，也是最容易「装了没反应」的原因。

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

| 声明 | 作用 | 缺了会怎样 |
|---|---|---|
| `dsh.bundle.patch` | 让 DSH Loader 把这个包当作**profile 层**挂载一行宿主 entry | CLI 警告 "installed as a plain dependency"，**插件完全不生效** |
| `dsh.client` | 让 `dsh-client-modules` 的宿主半侧把这个 entry 扫进 `window.__DSH_BOOT__`，并把浏览器半侧发布到 `/plugins/<包名>/client.js` | 宿主行存在但没有浏览器侧代码，界面上什么都不会出现 |

### 浏览器半侧是一个 closure-factory bundle

DSH 的模块系统不使用 import map。每个插件 bundle 是一个自带外壳的 CJS 文件：

```js
window.__ModuleLoader__.load({ id: "dsh-plugin-mobile-ui", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  /* ... 你的代码 ... */
  exports.apply = apply;
  exports.inject = inject;
  return module.exports;
} });
```

`require` 由外壳注入，只能解析**冻结模块表**里的 9 个 specifier：

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

**插件不能自带 React** —— 外壳已经播种了唯一的 React 实例，自带会导致 hooks 失效。构建配置里的 `external` 必须精确对齐这张表。

### 注册方式

```tsx
export const inject = ['slots']          // 声明依赖 ctx.slots 服务

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () =>   // 等待该插槽被声明
    ctx.slots.register(
      { name: 'shell.overlay', id: 'mobile-ui-splash', order: 10 },
      Splash,
    ))
}
```

`shell.overlay` 是 `list` 类插槽（追加语义）。官方对它的注释：

> Frame-wide floating layer, above every column and outside their scroll containers. Deliberately generic and unowned by any feature […] The layer itself is click-through — entries opt back into pointer events.

即：这是**frame 级浮层**，位于所有列之上、滚动容器之外，**可点击穿透**（占位者需自行 opt-in 指针事件）。它是启动页的理想位置。

---

## 可选的替换式表面

本插件注册四个表面，其中两个是**加法式**（默认开启），两个是**替换式**（默认关闭）。

| 表面 | 插槽 | kind | 语义 | 默认 |
|---|---|---|---|---|
| 启动页 | `shell.overlay` | list | 新 `id` 追加，不挤掉任何东西 | ✅ 开 |
| 设置页 | `settings.section` | list | 多一个设置页 | ✅ 开 |
| 工具卡片 | `tool.call.toolview` | keyed | **替换**该工具名自带的卡片 | ⛔ 关 |
| 抽屉 | `sidebar` | single | **替换**整个导航列 | ⛔ 关 |

开关都在 `src/client/config.ts` 的 `FEATURES`。

### 为什么替换式默认关闭

DSH 的插槽契约里，`keyed` 已占用的 key 与 `single` 都是**替换点**：

> Treat `single` and an occupied keyed cell as replacement points. Use list ids or an unoccupied key for additive extensions.

- **`toolCards`**：填入工具名即接管该工具的卡片。填 `['bash']` 就让 `bash` **失去 DSH 自带的终端卡片**，换成这里的通用卡片。默认空数组，所以什么都不替换。
- **`replaceSidebar`**：`sidebar` 由 ui-sidebar 占据，而它的声明写明「注册到这里直接替换整个导航列，它声明的席位也随之消失」。一旦接管，必须自己把 `sidebar.workspaces`、`sidebar.settings`、`sidebar.brand.*`、`sidebar.footer.action` 全部重新声明并渲染回来，否则用户会**失去工作区切换和设置入口**。`Drawer.tsx` 已经这么做了（`DRAWER_CHILDREN`），但**尚未在真机上验证**，而失败代价是手机上没有别的路可以退回。所以默认关闭。

### 如何开启抽屉

编辑 `src/client/config.ts`：

```ts
export const FEATURES = {
  splash: true,
  settings: true,
  toolCards: ['bash', 'pwsh'],   // ← 按需填写；空数组 = 不替换任何工具卡片
  replaceSidebar: true,          // ← 接管导航列
} as const
```

然后 **重新构建并重启**：

```sh
npm run bundle && npm run verify
# 重启 dsh web
```

开启后请立刻确认三件事：能切换工作区、能打开设置、会话列表还在。若任一丢失，把 `replaceSidebar` 改回 `false`、重新构建即可恢复 —— 这不是持久性破坏。

---

## 版本兼容性

| DSH 版本 | 支持 | 说明 |
|---|---|---|
| `0.1.2-rc.1` | ✅ | 手机本地模式打包的版本。`shell.overlay` 存在，启动页正常 |
| `0.1.5-rc.1` / `0.1.5-rc.2` | ✅ | 电脑端当前版本。已验证插件进入启动图并被实际服务 |
| 更早版本 | ⚠️ 未验证 | `0.1.0-rc.x` / `0.1.1-rc.x` 未做插槽对照 |
| 更晚版本 | ⚠️ 未验证 | DSH 处于 developer preview，插槽契约可能演进 |

### 若要用 `0.1.5` 独有的插槽

13 个新增插槽中，原型会用到的是 `conversation.session.header.corner`（顶栏右侧入口）。注册它之后：

- 在 `0.1.5` 宿主上：正常渲染
- 在 `0.1.2` 宿主上：该条贡献**静默不渲染**，其余一切正常
- 两者都不报错

因此可以放心使用，只需接受降级。

### 上游插槽契约的权威来源

插槽数量与命名**不是契约**。官方文档指出生成的 Client inspect catalog 才是详尽契约，且运行中的动态包可以查询实时插槽树：

```
cordis_inspect what:"client"
```

实现新功能前建议先查这个，而不是照抄本文档的表格。

---

## 开发

### 构建

```sh
npm install
npm run bundle
```

产出两个文件：

| 文件 | 格式 | 作用 |
|---|---|---|
| `lib/index.js` | ESM | Node 半边，给 Loader 一个宿主行 |
| `lib/client.js` | CJS + closure factory | 浏览器半边 |

### 构建配置的关键点

```ts
// tsdown.config.ts
{
  format: 'cjs',
  platform: 'browser',
  // ★ 顶层 external —— 不是 deps.neverBundle
  external: (specifier) => PLATFORM_MODULES.includes(specifier),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "${ID}", factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
```

> ⚠️ **踩坑记录：** DSH 仓库内部用的构建预设写的是 `deps: { neverBundle, alwaysBundle }`，那是**另一个打包器（rolldown）的配置面**。tsdown 0.15 用的是顶层 `external` / `noExternal`，`deps.*` 会被**静默忽略**。本插件第一版因此把 React 打进了 bundle（16.26 kB，含 `Symbol.for("react.element")`），改用顶层 `external` 后降到 **5.76 kB**，externals 正好是 `react, react/jsx-runtime`。

### 每次改完都要验证

```sh
npm run bundle && npm run verify
```

改完 bundle 后，**运行中的 dsh web 需要重启**（或依赖 `@deepseek-ai/dsh-client-hmr` 的热重载链路）才会用到新产物。注册表服务的是 `lib/client.js` 文件内容，不是源码。

### 加新插槽的步骤

1. 先查该插槽的契约（`kind` / `scope` / owner props）：
   - `docs/subsystems/slots.md` 的层级树
   - 或运行中的 `cordis_inspect what:"client"`
2. 确认它在 `0.1.2` 和 `0.1.5` 都存在（用 `docs/tools/slot-diff.ps1`）
3. 在 `src/client/index.tsx` 里用 `ctx.slots.inject(name, () => ctx.slots.register(...))` 注册
4. 只对跨包**类型声明**使用 `import type`；**绝不要**运行时 import 另一个插件包的值（构建会被纯度门拦下）

---

## 注意事项

### 🔴 安全

**1. 本仓库不含任何凭据。** 构建与验证全过程不使用、不存储任何 token。请你自己也不要往仓库里提交 token、`.env`、`hosts.json`、`identity.key` 等敏感文件。

**2. 不要提交 DSH 的运行时数据。** 以下路径含凭据或设备身份，**永远不要**放进仓库：

| 路径 | 内容 |
|---|---|
| `$DSH_HOME/.credentials.yaml` | 模型 API 密钥 |
| `$DSH_HOME/settings.yaml` | 可能含 base URL 与模型配置 |
| `$DSH_HOME/profiles/*/node_modules/` | 依赖，且可能含 link 路径 |
| `$DSH_HOME/.anonymous-user-id` | 匿名身份 |

**3. 这个插件会改变你的界面。** 它把启动页浮在所有内容之上。若你的启动页出现在不该出现的位置（例如覆盖了 DSH 自己的弹窗），把 `order` 调小或临时移除注册。

**4. 客户端插件运行在浏览器上下文。** 它能读取页面里的所有数据。安装第三方客户端插件等同于信任其作者 —— 请只装你审过的代码。

### 🟡 使用

**5. `inject` 与 `register` 必须配对。** 只写 `register` 注册到未声明插槽会**抛异常**（不是静默跳过）。始终用 `ctx.slots.inject(key, () => ctx.slots.register(...))`。

**6. 插槽被替换后，原席位会消失。** 例如注册到 `sidebar`（`single`/`root`）会**整个替换导航列**，连同它声明的 `sidebar.workspaces`、`sidebar.settings` 等席位一起消失 —— 替换方必须自己把它们渲染回来。

**7. `shell.overlay` 可点击穿透。** 启动页淡出后必须**真正卸载**（`return null`），只设 `opacity: 0` 是不够的：透明的浮层仍然占据点击区域。

**8. 主题不要写死颜色。** 用 DSH 的语义 token（`--dsw-alias-*`）。注意两个反直觉的坑：
   - `--dsw-alias-brand-primary` **不是蓝色**，它解析成近黑/近白。强调色要用 `--dsw-alias-brand-primary-new-colorprimary-new-color`。
   - DSH **没有任何圆角 token**，圆角一律写数值。

   详见 [`docs/02-theme-token-mapping.md`](docs/02-theme-token-mapping.md)。

**9. 产品文案要走 locale 字典。** DSH 的 `verify-client-ui-i18n` 会拒绝硬编码文案。硬编码的 JSX 文本、`aria-label` 等属性都会被拦。

**10. 装完或改完必须重启 `dsh web`。** 插件在启动时扫描；产物变更不重启不会生效，且**没有任何报错**。

### 🟢 与本插件共同使用 dsh-tether

**11. 两者是互补的，不冲突。** dsh-tether 负责 P2P 连接与本地模式托管，本插件只注册 UI 插槽。它们安装进同一个 profile 不产生冲突（已验证：插件与 dsh-tether 的插槽注册互不重叠）。

**12. 远程模式下，手机加载的是电脑上的 DSH。** 所以插件要装在**电脑的 profile** 里，手机端无需任何操作。

**13. 本地模式下，DSH 跑在手机上，版本是 APK 里打包的 `0.1.2-rc.1`。** 本插件已针对该版本验证兼容。

---

## 已知限制与阻塞项

### 🔴 不要升级 dsh-tether 的 `androidRuntime.dsh` 到 0.1.5

如果你正在考虑把 dsh-tether 手机本地模式打包的 DSH 从 `0.1.2-rc.1` 升到 `0.1.5-rc.1`：**目前会破坏本地模式**。

`0.1.5` 给 `dsh-session-persistence-jsonl` 引入了 per-session 写租约：

```
persistContiguous() → ensureLease() → acquireWriteLease() → SessionWriteLease.acquire()
  → tryLockExclusive()   [@deepseek-ai/node-addon-system/flock]

  node-addon-system/lib/flock.js:
    if (platform !== 'linux' && platform !== 'darwin')
      throw Error('flock is not supported on ' + platform + '-' + arch)
      // code: ERR_FLOCK_UNSUPPORTED_PLATFORM
```

- `node-addon-system` 的平台包**没有 android 条目**（只有 darwin-x64/arm64、linux-x64/arm64）
- Android 上 Node 报告 `process.platform === 'android'` —— 这一点 **dsh-tether 自己的 CHANGELOG（v0.1.11）已经记录并依赖**（正因如此才有独立的 `dsh-tether-host-android-arm64` 子包）
- `isLockContention()` 只认 `EAGAIN` / `EWOULDBLOCK`，异常会直接冒泡
- `0.1.2-rc.1` 里**完全没有**这个锁

**为什么严重：** 它不是启动失败，而是**第一次会话落盘时失败** —— 在启动之后才暴露，更难诊断。

**状态：** 证据链完整（读遍发布的构建产物 + Node 的 `process.platform` 语义 + dsh-tether 自身 CHANGELOG），但**未在真机复现**。复现最省的两步：

```sh
# 在 Android / Termux 上
node -p "process.platform"        # 期望输出 android
# 然后用 0.1.5 的运行时树跑一次会话写入
```

完整证据见 [`docs/03-tether-0.1.5-bump-report.md`](docs/03-tether-0.1.5-bump-report.md)。

### 🟡 其它限制

**14. 未在真机 Android WebView 上验证。** 本次调研的「端到端验证」止于**桌面浏览器上下文中的启动图注入与 bundle 服务**。真机 WebView 上的渲染、键盘遮挡、软键盘行为**尚未验证**。

**15. 当前只实现了启动页。** 抽屉、工具卡片、设置页、悬浮输入框都还没写，只有设计与插槽映射（见 `docs/01-final-plan.md`）。

**16. `0.1.5-rc.1` 解析出的不是 `0.1.5-rc.1`。** 子包使用 `^0.1.5-rc.1` 这样的预发布 caret 范围，构建脚本又带 `--no-package-lock`，因此真实的依赖树是 `1 × 0.1.5-rc.1（CLI 自身）+ 230 × 0.1.5-rc.2`。同一份 `package.json` 会构建出不同的树。

**17. 首次加载的 combo 体积约 11 MB。** 移动网络下首次打开可感知。启动页应给出进度反馈，而不是只有一个静态 logo。

**18. 无自动化测试。** 目前只有 `verify-bundle.mjs` 这一个契约检查器，没有单元测试、没有 CI。

---

## 目录结构

```
dsh-plugin-mobile-ui/
├── package.json            # 双声明：dsh.bundle.patch + dsh.client（缺一不可）
├── cordis.patch.yml        # profile 层：insert 一行挂载自己
├── tsdown.config.ts        # 构建：Node ESM 半边 + 浏览器 CJS 半边
├── verify-bundle.mjs       # 无浏览器的 loader 契约验证器（含渲染冒烟）
├── LICENSE                 # MIT
├── README.md               # 本文件
├── README.en.md            # English
├── src/
│   ├── index.ts            # Node 半边：空 apply
│   └── client/
│       ├── index.tsx       # apply：注册全部表面（每处都包在 slots.inject 里）
│       ├── config.ts       # FEATURES 功能开关 + 全部用户可见文案（zh/en）
│       ├── theme.ts        # TYPE / R / MOTION token 与 injectStyles，不硬编码颜色
│       ├── typography.ts   # 移动端排版基线（字体放大、行高、去点按闪灰）
│       ├── Splash.tsx      # 启动页 → shell.overlay（冷/热启动两套时长）
│       ├── Settings.tsx    # 「移动端」设置页 → settings.section
│       ├── ToolCard.tsx    # 工具卡片 → tool.call.toolview（默认 5 个工具）
│       ├── DrawerOverlay.tsx  # 浮层抽屉（主交互）→ shell.overlay
│       ├── Drawer.tsx      # 侧栏接管 → sidebar（已放弃，默认关闭，代码保留）
│       ├── viewport.ts     # 键盘适配（visualViewport 缩 frame，缓解非根治）
│       ├── tether-compat.ts   # 反制 dsh-tether 过宽的 `_row` 选择器
│       ├── settings-chrome.ts # 主机设置弹层窄屏排版
│       ├── connection-recovery.ts # 回前台自动重连
│       └── keyboard-debug.ts  # 键盘诊断徽章（临时，默认关）
├── lib/                    # 构建产物，不入版本库（npm run bundle 生成）
├── tools/                  # CDP 探针（probe-*.mjs）与验收脚本（verify-*.mjs）
└── docs/
    ├── MOBILE-UI-GUIDE.md           # 当前实现总说明（先读这份）
    ├── 00-项目说明.md                # 项目背景与范围
    ├── 2026-09-11-session-log.md    # 逐场修改日志（含 P0/P1 清单）
    ├── 2026-09-12-typography.md     # 排版基线调查
    ├── 2026-09-12-overlap-audit.md  # 重叠 / 遮挡审计
    ├── plan.md                      # 设计说明：插槽映射、组件职责、取舍
    ├── 01-final-plan.md             # 最终方案：版本策略、插槽对照、路线图、风险
    ├── 02-theme-token-mapping.md    # 配色 token 映射表（带 file:line 出处）
    ├── 03-tether-0.1.5-bump-report.md  # tether 升级兼容性与 flock 阻塞证据
    ├── keyboard-occlusion.md        # 键盘遮挡诊断与缓解
    ├── android-native-splash.md     # 原生启动屏（阻塞：本机缺 MSVC）
    └── tools/
        └── slot-diff.ps1            # 两版本插槽对照脚本
```

---

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/MOBILE-UI-GUIDE.md`](docs/MOBILE-UI-GUIDE.md) | **当前实现总说明。** 表面/插槽对照、抽屉交互、设计 token、连接恢复、键盘根因、验证清单、运行实例 |
| [`docs/2026-09-11-session-log.md`](docs/2026-09-11-session-log.md) | 逐项修改日志：修了哪些 bug、每批验收结果、未完成项 |
| [`docs/00-项目说明.md`](docs/00-项目说明.md) | 项目背景、范围与硬约束 |
| [`docs/01-final-plan.md`](docs/01-final-plan.md) | **主报告。** 结论摘要、版本策略、完整插槽对照表、插件设计、五阶段实施路线图、12 项风险与降级、已验证清单、8 项待确认问题 |
| [`docs/02-theme-token-mapping.md`](docs/02-theme-token-mapping.md) | 原型硬编码配色 → DSH 语义 token 的完整映射，每个 token 带源码 file:line。含「无对应 token」的明确清单 |
| [`docs/03-tether-0.1.5-bump-report.md`](docs/03-tether-0.1.5-bump-report.md) | dsh-tether 升级 0.1.5 的完整兼容性分析，含 `flock` 阻塞链、wire 协议版本性、Android 构建面 |
| [`docs/keyboard-occlusion.md`](docs/keyboard-occlusion.md) | 键盘遮挡现象的实测诊断，以及为什么客户端修不掉 |
| [`docs/tools/slot-diff.ps1`](docs/tools/slot-diff.ps1) | 对两棵安装树机械提取并比对 `SlotMap` 声明。用法见脚本头注释 |

---

## 许可与声明

MIT，见 [LICENSE](LICENSE)。

本项目是**独立的社区项目**，与 DeepSeek、DeepSeek Harness、dsh-tether 的维护者均无隶属、合作、授权或背书关系。"DeepSeek"、"DeepSeek Harness"、"dsh" 等名称仅用于陈述兼容性。
