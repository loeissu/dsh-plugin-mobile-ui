# 升级与维护手册

**日期**：2026-09-12
**适用**：`dsh-plugin-mobile-ui` 0.1.0
**验证环境**：DSH `0.1.5-rc.1`（profile `web`，3080）+ dsh-tether `0.1.13` + Chrome CDP 412×915

本文回答三件事：**交付物是什么、怎么用、DSH 或手机客户端升级后会不会坏**。所有结论都落在具体文件与具体风险点上，不写没有证据的保证。

---

## 1. 交付物清单

| 交付物 | 位置 | 说明 |
|---|---|---|
| 插件源码（npm 包结构） | `H:\DSH\_work\repo\dsh-plugin-mobile-ui` = <https://github.com/loeissu/dsh-plugin-mobile-ui> | `package.json` 双声明 `dsh.bundle.patch` + `dsh.client`，走官方 slot 客户端插件规范 |
| 构建产物 | `lib/client.js`（约 105 KB）+ `lib/index.js` | **不入 git**，由 `npm run bundle` 生成；DSH 每请求从磁盘读 `lib/client.js` |
| 线上部署 | profile `web`（`~/.dsh/profiles/web`） | `package.json` 里是 `"dsh-plugin-mobile-ui": "link:H:/DSH/_work/repo/dsh-plugin-mobile-ui"`，`node_modules` 里是 **junction**；即"仓库源码 = 线上插件" |
| 无浏览器契约检查 | `verify-bundle.mjs` | `npm run verify` 会在 Node 里模拟 loader，校验注册/渲染契约 |
| 浏览器验收脚本 | `tools/`（73 个：33 个回归套件 + 探针；`retired/` 另存已放弃设计） | `probe-*.mjs` 一次性探针；`verify-*.mjs` 是回归套件，需 3080 + Chrome `:9222` + token |
| 文档 | `docs/` | 现状总说明看 `MOBILE-UI-GUIDE.md`，逐场日志看 `2026-09-11-session-log.md` |
| **未交付** | 原生 APK | 原生启动屏与 `windowSoftInputMode` 根治都需要重新出包；本机缺 MSVC / `link.exe`，出不了包（见 §6） |

---

## 2. 怎么用

### 2.1 电脑侧（只做一次）

```powershell
cd H:\DSH\_work\repo\dsh-plugin-mobile-ui
npm install
npm run bundle          # 生成 lib/
npm run verify          # 应打印 "bundle satisfies the loader contract"
dsh plugin --profile web add .   # 已装过则跳过（现在已装）
# 重启 dsh web
```

### 2.2 手机侧（日常）

| 动作 | 操作 |
|---|---|
| 打开导航抽屉 | 顶栏文字 **「导航」**（在「对话」「轨迹」左侧） |
| 新建会话 | 抽屉标题栏 **＋** |
| 设置 | 抽屉底部 **设置** |
| 手动重连 | 抽屉底部 **刷新连接**（换 mux socket）；链路假活时按钮变 **重试**，并自动轮询直到恢复（不导航） |
| 连接状态 | 底部圆点：蓝=已连接，蓝呼吸=连接中，灰=未连接，**深色圆环=链路已断** |
| 关闭抽屉 | 遮罩 / 面板内左滑 >72px / `×` / Esc |

### 2.3 改完代码怎么生效

```powershell
npm run bundle
npm run verify
# 手机上刷新页面即可 —— 3080 每请求读 lib/client.js，不必重启 dsh，也不必动 APK
```

### 2.4 卸载 / 回滚

```powershell
dsh plugin --profile web remove dsh-plugin-mobile-ui   # 整插件下线
# 或：只关某一块能力 —— 改 src/client/config.ts 的 FEATURES，重新 bundle
# 或：git checkout <上一个提交> 后 npm run bundle
```

---

## 3. DSH 升级后还能用吗

**结论：小版本（0.1.x）升级通常只需"重新构建 + 看一眼页面"；全项目只有一处会让整站挂掉，且症状与处理都明确。**

> 现状：npm 上 `@deepseek-ai/dsh` 的 latest 就是 **0.1.5-rc.1**（本机已装同版本），`0.1.5-rc.2` 已发布；`dsh-plugin-tether` latest 是 **0.1.13**（本机已装）。所以此刻没有必须做的升级。

### 3.1 为什么大概率没事

1. **每一处注册都包在 `ctx.slots.inject(key, …)` 里**（`src/client/index.tsx`）。宿主没声明该插槽时，回调只是**待命**，不抛错、不白屏，只少渲染那一块。这是本插件跨 `0.1.2-rc.1` ~ `0.1.5-rc.x` 都验证过的机制。
2. **服务依赖声明式**：`export const inject = ['slots','layout','uiWorkspace','connection']`。服务缺失时插件整体不 apply —— 退化成"没有移动端增强的原版界面"，而不是崩。
3. 浏览器半侧是封闭 bundle，只把 `react` / `react-dom` 外部化，不跨插件边界加载运行时值。

### 3.2 唯一会"整站不可用"的点（必须知道）

`tool.call.toolview` 是 **keyed** 插槽，本插件用 `priority: -100` 遮蔽官方卡片（`src/client/index.tsx`，常量 `SHADOW_PRIORITY`）。keyed 插槽**同一 priority 只允许一个注册**，重复即抛错：

```
keyed slot "tool.call.toolview" already has an entry for key "read" at priority -100
```

一旦插件激活失败，页面渲染的是 **「Failed to load plugins」**，什么都不工作。

- **触发条件**：未来 DSH 把官方工具卡的优先级也改成 `-100`，或改掉 keyed 插槽的优先级语义。
- **处理**：把 `SHADOW_PRIORITY` 改成一个没被占用的值 → `npm run bundle`。
- **紧急恢复**：`dsh plugin --profile web remove dsh-plugin-mobile-ui`，或把 `FEATURES.toolCards` 清空后重新 bundle。

### 3.3 只会"局部失效"的耦合点（不致命）

| 依赖 | 位置 | 断了会怎样 |
|---|---|---|
| CSS Module **本地名后缀**（`_row`/`_rowText`/`_navCell`/`_themeCube`/`_header`/`_title`/`_selector`…） | `settings-chrome.ts`、`tether-compat.ts` | 主机设置弹层的窄屏排版回到原样；排队栏可能又变成细条 |
| AppFrame 结构 `[data-slot="root"] > [class*="_frame"] > [class*="sidebarCol"]` | `DrawerOverlay.tsx` | 原生侧栏不再停靠到视口外 → 抽屉旁边多出一列原生侧栏 |
| `[data-slot="sidebar.settings"] button` / `[data-slot="settings.trigger"] button`（含按文本兜底扫描） | `DrawerOverlay.tsx` | 抽屉底部 **设置** 点不开 |
| `ctx.uiWorkspace.{openSession,openWorkspace,startSession}`、`ctx.connection.{reconnect,state}` | `src/client/index.tsx` | 抽屉导航 / 重连按钮 / 状态点失效 |

注意：类名哈希**每次构建都会变**，所以这里刻意只匹配本地名后缀（`[class*="_row"]`），不匹配哈希前缀 —— 这条设计已经扛过一次 DSH 构建更替。

### 3.4 升级后 5 分钟检查清单

1. `npm run bundle && npm run verify` → 必须打印 `bundle satisfies the loader contract`
2. 重启 `dsh web`；手机/浏览器**强制刷新**
3. 页面有没有 **「Failed to load plugins」**（有 → §3.2，先 remove 再排查）
4. 手机：顶栏 **「导航」** → 抽屉能开；点一次 **刷新连接**；看状态点颜色
5. 窄屏进设置：标题 15px、正文/选择器 13px、主题三列横排、行高约 100px
6. 有 CDP Chrome（`:9222`）就跑回归：`node tools/verify-drawer-open.mjs <url>`，其余 `verify-*.mjs` 同法（token 从 `H:\DSH\dsh-web.log` 取）

### 3.5 让类型系统替你预警

`package.json` 的 `devDependencies` 固定 `@deepseek-ai/dsh-client-ui-slots@0.1.5-rc.1`（只用于类型，运行时外部化）。**DSH 升级后先把这一行改成新版本，再 `npm install && npm run bundle`** —— 服务/插槽签名若有变动，TypeScript 会直接报错指到 `index.tsx`，比在手机上瞎试快得多。

---

## 4. 手机客户端（tether / APK）升级

**结论：不需要重编、重发插件。** 插件装在**电脑侧**的 profile 里，APK 只是渲染电脑发来的页面的 WebView 客户端；手机刷新即拿到最新 `lib/client.js`。

但下面三件事要在升级后复核：

1. **tether 注入的窄屏 CSS**（`replace('</head>', '<style data-dsh-tether="narrow-screen">…')`，规则在 `@media (max-width: 640px)`）。当前已知两处过宽：
   - `[class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important }` —— 实测命中 26 个元素，把排队消息栏压成细条。
   - 模态框规则：把**每个** `aria-modal` 弹层拉成全屏、把 `> div > [class*="_header"]` 改成绝对定位，并对 content-box 的包裹 div 用 `width:100% !important`。这三条只对设置弹层成立，套到「确认启用完全权限？」这类确认弹层上：标题压住正文（header 脱离文档流），右侧按钮被卡片裁掉（footer 388px 挤进 340px 卡片）。

   两处都由 `tether-compat.ts` 窄范围反制（反制规则只作用于「无 nav 条」的模态框，设置弹层保留 tether 的全屏处理）。
   - 上游修好 → 把 `FEATURES.tetherCompat` 关掉，`tether-compat.ts` 可以删。
   - 上游改名/换注入方式 → 反制规则空转，**无副作用**；但排队栏、确认弹层各看一眼（`node tools/verify-risk-dialog.mjs <url>`）。
2. **键盘**：若新 APK 补上 `android:windowSoftInputMode="adjustResize"`（或走 edge-to-edge 的 `Type.ime()` insets），**建议关掉 `FEATURES.keyboardFit`** —— `viewport.ts` 的 200ms 轮询与点击后 `blur→refocus` 就不必再跑。反过来，若新客户端的 WebView 改了 `visualViewport` 行为，先看 `keyboard-debug` 徽章（`FEATURES.keyboardDebug = true`）再调阈值。
3. **tether 的注入方式**：它是 `replace('</head>', '<style>…')`。若改成别的机制或加了 CSP，重跑 §3.4 的 3–5 步。

**不要做**：把 tether 的 `androidRuntime.dsh` 从 `0.1.2-rc.1` 升到 `0.1.5` —— `0.1.5` 引入的 per-session 写租约会在 Android 上破坏**手机本地模式**（见 `README.md`「已知限制」与 `docs/03-tether-0.1.5-bump-report.md`）。当前架构（手机连电脑 3080）不受这条影响。

---

## 5. 维护成本

- 源码 **4799 行 / 16 个文件**；最大单文件 `DrawerOverlay.tsx` **1467 行**（欠账 P2-9：待拆分）。
- 设计面收敛得比较好：`theme.ts` 统一 `TYPE`/`R`/`MOTION` token，颜色全走 `--dsw-alias-*`；`config.ts` 一个 `FEATURES` 表 + zh/en 文案，关功能不用改组件。
- 验证：`verify-bundle.mjs`（离线、无浏览器）+ 73 个 `tools/` 脚本（其中 30 个 `verify-*.mjs` 回归套件）。**没有单元测试、没有 CI**。
- 无 adb / 无真机自动化：**触摸、IME、tether 真机宽度都没在 CI 验证过**，只能真机定论。
- `ctx.locale` 未接，文案按 `navigator.language`。
- `keyboard-debug.ts` 是临时诊断，默认关，问题定性后可删。

**判断**：DSH **补丁级升级**（0.1.x → 0.1.y）的成本大约是"§3.4 五分钟"；若 DSH 改了 AppFrame/DOM 结构或本地类名，则要按 §3.3 表逐项修 CSS，属于半天量级。tether 升级基本零成本，除非它修好了那个 `_row` 缺陷（那我们反而是删代码）。

---

## 6. 已知阻塞（不变）

- **键盘首次不弹 / 时好时坏**：根因在 Tauri 壳（`AndroidManifest.xml` 无 `android:windowSoftInputMode`；`MainActivity` 调了 `enableEdgeToEdge()` 但没处理 IME insets），客户端只能缓解。根治要改壳并重新出包。
- **原生启动屏**：同样卡在出包环节（本机缺 MSVC / `link.exe`；`docs/android-native-splash.md` 里有完整改动集与验收方法）。

---

## 7. 安全提醒

会话标题里出现过完整 GitHub PAT（`ghp_…`）。**请到 GitHub 撤销它** —— 抽屉里的脱敏只防截图，不防数据本身。撤销后，`git push` 会用 Windows 凭据管理器里 `git:https://github.com` 那条记录重新走一次认证。
