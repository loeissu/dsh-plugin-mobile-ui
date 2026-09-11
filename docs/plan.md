# 设计说明

本文件记录这套移动端 UI 的**设计意图与取舍**：每个组件为什么落在那个插槽、为什么某些表面默认关闭、以及哪些结论有实测支撑。

调研数据与完整证据链在 `01-final-plan.md` / `02-theme-token-mapping.md` / `03-tether-0.1.5-bump-report.md`，本文件只讲设计与实现决策。

---

## 1. 总体原则

### 1.1 只用加法式插槽作为默认路径

DSH 的插槽分两类语义：

- **加法式**（`list` 的新 `id`）：注册只是多一个 cell，不可能挤掉任何东西。
- **替换式**（`single`，以及 `keyed` 中已被占用的 key）：注册即接管，原占位者及其声明的子席位一起消失。

默认只开加法式。替换式完整实现但默认关闭，理由不是保守，而是**失败代价不对称**：加法式出错最多是某个界面不出现；替换式出错会让用户失去工作区切换或设置入口，而手机上这类功能**没有第二条路可以退回**（`sidebar` 一被接管，它里面的 `sidebar.settings` 入口也随之消失）。

### 1.2 版本兼容靠插槽子集，不靠版本判断

本插件不检测宿主 DSH 版本。它只使用 `0.1.2-rc.1` 与 `0.1.5-rc.x` **共有的 48 个插槽**，其余通过 `inject` 注册 —— 未声明时静默跳过。

这比版本嗅探更稳：不需要维护版本号到插槽集的映射，也不需要处理「版本号对了但构建被裁剪过」的情况。

### 1.3 所有视觉值走 DSH token

没有任何调色板字面量进入样式表。见 `02-theme-token-mapping.md`。两个必须记住的坑：

- `--dsw-alias-brand-primary` **不是蓝色**，它解析成近黑/近白。强调色用 `--dsw-alias-brand-primary-new-colorprimary-new-color`。
- 等宽字体是 `--ds-font-family-code`，不是 `--dsw-font-mono`（后者被 DSH 自己引用 5 次但从未定义）。

`theme.ts` 的 `V` 对象把每个 token 连同 **DSH 自己的 boot token** 作为回退（`var(--dsw-alias-*, var(--dsh-boot-*))`）。这样即使主题呈现器还没把变量写到 `body`，颜色仍然来自 DSH 的词表，而不是我自己编的值。

---

## 2. 插槽映射

| 界面元素 | 插槽 | kind / scope | 组件 | 默认 |
|---|---|---|---|---|
| 启动页 | `shell.overlay` | list / root | `Splash.tsx` | ✅ |
| 设置页 | `settings.section` | list / root | `Settings.tsx` | ✅ |
| 工具卡片 | `tool.call.toolview` | keyed / session | `ToolCard.tsx` | ⛔ |
| 抽屉 | `sidebar` | single / root | `Drawer.tsx` | ⛔ |

### 2.1 `shell.overlay` —— 启动页

官方对该插槽的注释直接描述了它的用途：

> Frame-wide floating layer, above every column and outside their scroll containers. Deliberately generic and unowned by any feature […] The layer itself is click-through — entries opt back into pointer events.

「帧级浮层、位于所有列之上、滚动容器之外、可点击穿透」—— 启动页正是这个形状。因为它是 `list`，注册**不可能**挤掉 DSH 自带的东西。

两个实现细节：

1. **可点击穿透要显式夺回。** 插槽层本身不接收指针事件，所以启动页必须自己设 `pointer-events: auto`，否则用户能点穿到下面的应用。
2. **淡出后必须真正卸载。** 只设 `opacity: 0` 会留下一个看不见但仍占据点击区域的浮层。组件在淡出结束后 `return null`。

### 2.2 `settings.section` —— 设置页

`list` / `root`，注册选项携带导航身份（`id` / `order` / `label`），owner 只提供 `close`。纯加法，风险最低，因此默认开启。

### 2.3 `tool.call.toolview` —— 工具卡片

`keyed` / `session`，按 wire tool name 分派。契约原文：

> A key the shipped composition already covers is replaced, not shared; an unclaimed key falls back to the generic tool row.

所以注册 `key: 'bash'` 是**接管** `bash`，不是并列。`FEATURES.toolCards` 默认空数组，什么都不接管。

**数据形状**（`ToolCallBlock` 是可辨识联合）：

```
RunningToolCall  { callId, name, argsRaw, turn, step, time, subCalls }   // 无 kind 字段
ToolResultNode   { kind: 'tool-result', callId, call: {name,argsRaw}|null,
                   content, isError, error?, subCalls, ... }
```

判定方式按结构：`block.kind === 'tool-result'` 即已结算。**不 import DSH 的 `isRunningTool`** —— 那会是跨插件运行时值导入，被 DSH 的 bundle 纯度检查拒绝。

**防御式渲染**：`call` 字段在窗口截断时**显式可能为 null**，所以组件不假设任何字段存在，无法识别的形状退化成最简行而不是抛错。输出上限 20000 字符，避免超大结果卡死手机。

展开动画用 `grid-template-rows: 0fr → 1fr` —— 不需要在 JS 里测量内容高度就能过渡到自然高度。

### 2.4 `sidebar` —— 抽屉

`single` / `root`，契约原文：

> The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which declares the workspace and settings seats inside it — registering here replaces the navigation column outright rather than adding to it, and the seats it declares disappear with it.

`Drawer.tsx` 通过 `DRAWER_CHILDREN` 重新声明了全部 6 个席位并在渲染中逐个调用 `renderSlot`：

```
sidebar.brand.mark      sidebar.brand.name       sidebar.panellist
sidebar.workspaces      sidebar.settings         sidebar.footer.action
```

漏掉任何一个都等于从用户界面上删掉一个功能。这也是它默认关闭的直接原因 —— 代码写完了，但**没有在真机上验证过**，而验证成本高于把默认值设成 `false` 的成本。

---

## 3. 启动页的真实定位

必须说清楚一件事，否则容易误判它的价值：

**`shell.overlay` 的启动页不覆盖冷启动窗口。** 它在 DSH 应用帧挂载后才渲染，而在此之前：

1. 浏览器先画白帧；
2. DSH 自己的 `_boot_` 卡片（`dsh-web-frontend` 里实打实存在）显示 spinner；
3. 然后是应用帧，然后才是我们的浮层。

所以**真正的冷启动启动屏属于宿主外壳的原生主题**（Android 的 `windowSplashScreenBackground` + `postSplashScreenTheme`），那是 Tauri 壳的职责，客户端插件够不到。这一项在 `01-final-plan.md` 的 Phase 2，不在本插件范围内。

那这个浮层有什么用？它覆盖的是**客户端插件确实能观察到的等待**：

- 连接某台电脑的过程；
- 本地模式首次启动解压运行时（实测约 9 秒）；
- 切换机器时的品牌化过渡。

而且它**永远不会困住用户**：三重兜底 —— 最短可见时间（不闪）、`dismissSplash()`（真实就绪信号）、硬上限 4 秒（信号没来也只是稍长一点）。淡出后卸载。

---

## 4. 配置为什么在源码里而不在 cordis.yml

DSH 的客户端插件**收不到** profile 层配置：`dsh-client-modules` 组合出的启动图每行只有 `{ id, url, rev, inject, immediately, external }`，没有 config 通道到达浏览器半边。

可选的替代是构建期 `process.env.DSH_CLIENT_*` define（DSH 自己就为这个目的提供了 `clientBuildEnvironmentDefines`）。本插件的值都在 `src/client/config.ts` 一次性读取，改开关需要重新构建。

这是有意的取舍：**把「需要重新构建」当成一个摩擦点**。接管 `sidebar` 这种操作，值得让人停下来想一下。

---

## 5. 文案与本地化

所有用户可见字符串集中在 `config.ts` 的 `ZH` / `EN` 两张表，按文档语言选择。

DSH 的做法是走 `ctx.locale.register(ns, {zh, en})`，由渲染器合成 `t` 席位，并由 `verify-client-ui-i18n` 门禁强制。那个门禁跑在 DSH 仓库内部，**不作用于第三方插件**；但把文案集中在一处至少保证了单一来源。

完整接入 `ctx.locale` 是后续工作（见根 README 的已知限制）—— 那样才能让插件文案跟随 DSH 的语言切换，而不是跟随浏览器语言。

---

## 6. 验证策略

`verify-bundle.mjs` 在没有浏览器的情况下模拟 `window.__ModuleLoader__` 与模块表，然后：

1. 断言 loader 调用恰好 1 次（产物带对了 closure 外壳）；
2. 断言请求的 external 是平台表的子集 —— **能拦住「React 被打进 bundle」**，这是本轮实际踩到的坑（16.26 kB → 5.76 kB）；
3. 断言 `apply` / `inject` 导出存在；
4. 用 stub 注册表驱动 `apply()`，断言注册到了预期的插槽集合；
5. **渲染冒烟**：用假 props 调用每个已注册组件，执行组件体，捕获抛错、坏 JSX、未定义 token。

第 5 步是加进来的原因：只检查注册会漏掉组件体的运行时错误。开发过程中用两个开关组合各跑一遍，四个表面全部通过渲染冒烟。

两个 Windows 上踩到的坑，值得记下来：

- **不要在 Windows PowerShell 5.1 里用 `Get-Content -Raw` 读含中文的 UTF-8 文件再写回。** 它按系统 ANSI（中文系统上是 GBK）解码，写回时双重编码，`装进口袋` 会变成 `锛岃杩涘彛琚`。用编辑工具，或显式 `[System.IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`。
- **Node 24 的 `globalThis.navigator` 是只读的**，要用 `Object.defineProperty` 覆盖，不能赋值。

---

## 7. 已知不足

| 项 | 说明 |
|---|---|
| 抽屉未真机验证 | 代码完整、渲染冒烟通过，但接管导航列的后果需要在设备上确认 |
| 工具卡片未在真实工具流上验证 | 只验证了渲染，没有验证真实 `ToolCallBlock` 数据的各种边角 |
| 冷启动启动屏不在本插件内 | 属于 Tauri 壳的原生主题，见 `01-final-plan.md` Phase 2 |
| 文案未接入 `ctx.locale` | 集中在一处，但跟随浏览器语言而非 DSH 语言设置 |
| 设置页开关无写路径 | `settingsToolCards` 一行目前只显示有效配置，不是可写开关 |
| 无单元测试 | 只有 `verify-bundle.mjs` 这一个契约 + 渲染冒烟检查 |
| 首次 combo ~11 MB | 移动网络下首次加载可感知；启动页应给进度反馈而不是静态 logo |
