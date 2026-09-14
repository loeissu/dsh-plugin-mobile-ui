# dsh-plugin-mobile-ui · 项目状态报告

> **⚠️ 这是 2026-09-11 的历史快照，不是当前状态。**
>
> 本文的规模数字、开关默认值、以及 §5「没做什么」里的阻塞项清单，大多已被后续工作
> 覆盖或推翻（例如 `DrawerOverlay.tsx` 当时记 805 行，现在 1672 行；文档与脚本数量、
> `FEATURES` 默认值、验证套件数都已变化）。**当前权威描述见
> [docs/00-项目说明.md](docs/00-项目说明.md)**，日常使用与维护见
> [docs/MOBILE-UI-GUIDE.md](docs/MOBILE-UI-GUIDE.md)。
>
> 保留这个文件是因为 **§4 的踩坑记录仍然有效**：那几条「断言通过 ≠ 正确」的教训
> 已被 [docs/00-项目说明.md](docs/00-项目说明.md) §14 引用为「被推翻或已放弃的结论」。
> §10 的凭据提醒也**不是历史**——那两个令牌经复测仍然存在，请按该节操作。

**报告日期**：2026-09-11
**代码版本**：`c09e1a2`（与远端同步，工作区干净）
**提交数**：16

---

## 1. 项目地址与本地位置

| 项 | 值 |
|---|---|
| **远端仓库** | https://github.com/loeissu/dsh-plugin-mobile-ui |
| **本地路径** | `H:\DSH\_work\repo\dsh-plugin-mobile-ui` |
| **包名 / 版本** | `dsh-plugin-mobile-ui` / `0.1.0` |
| **许可** | MIT |
| **分支** | `main` |
| **构建产物** | `lib/client.js`（73.6 KB / gzip 22.0 KB）、`lib/index.js` |

### 运行中的实例

| 端口 | profile | 装了插件 | 装了 tether | 用途 |
|---|---|---|---|---|
| **3080** | `web` | ✅ | ✅ | **你的生产实例**，手机连的就是它 |
| **3099** | `scratchui` | ✅ | ❌ | 隔离测试环境 |

**本机版本**：DSH `0.1.5-rc.1`、dsh-tether `0.1.13`、NDK `27.0.12077973`

---

## 2. 原始需求

> 理解 `github.com/zexadev/dsh-tether`，然后设计一套更优雅的 Android 界面 + 启动屏。

演进后的**硬约束**（你明确要求，逐字）：

- **不 fork dsh-tether**
- **不修改 DSH 源码**
- **不升级 dsh-tether 的 `androidRuntime.dsh`**
- **不替换 sidebar 插槽，不停用 ui-sidebar**
- **每一步在隔离 profile 验证，确认稳定再推**

### 关键设计前提（已验证）

`0.1.2-rc.1`（tether 钉住的手机端）与 `0.1.5-rc.1`（本机）的 slot 面：51 → 61 个，**48 个共有且签名零变化**，无 `kind`/`scope` 变更。

**所以：只使用这 48 个共有 slot，同一份产物即可同时跑在 PC 远程模式和手机本地模式。**

### 实现方式

**独立 DSH 客户端插件**，走官方 slot 系统（`ctx.slots.register` / `ctx.slots.inject`），不注入 hack、不改宿主。

---

## 3. 做了什么

### 3.1 已实现并通过桌面验证的表面

| 模块 | 插槽 | 类型 | 状态 |
|---|---|---|---|
| **启动页** | `shell.overlay` | list（加法式） | ✅ 已验证 |
| **设置页** | `settings.section` | list（加法式） | ✅ 已验证 |
| **工具卡片** | `tool.call.toolview` | keyed（替换式） | ✅ 已验证 |
| **抽屉导航** | `shell.overlay` | list（加法式浮层） | ✅ 24/24 断言 |
| **键盘适配** | 无插槽（样式+监听） | — | ⚠️ **见 §5.1，验证方式有缺陷** |
| **tether 兼容层** | 无插槽（反制样式） | — | ✅ 5/5 真实环境验证 |
| **诊断徽章** | 无插槽 | — | 🔧 临时，待你截图 |

### 3.2 源码规模

```
src/client/config.ts          287 行   功能开关与文案
src/client/DrawerOverlay.tsx  805 行   浮层抽屉（主要工作）
src/client/Drawer.tsx         232 行   已废弃的侧栏接管式抽屉（保留）
src/client/Splash.tsx         291 行   启动页
src/client/ToolCard.tsx       405 行   工具卡片
src/client/Settings.tsx       242 行   设置页
src/client/theme.ts           150 行   DSH token 映射
src/client/viewport.ts        138 行   键盘适配
src/client/keyboard-debug.ts  120 行   临时诊断徽章
src/client/tether-compat.ts    76 行   tether 反制规则
src/client/index.tsx          208 行   apply 入口
src/index.ts                    5 行
                       合计约 2,959 行
```

配套：**35 个验证/探测脚本**、**14 份文档**（13 份 Markdown + 1 份原生启动屏补丁）。

### 3.3 具体成果

**启动页**
- `createPortal` 到 `document.body` —— 否则被 `position:absolute` 的 overlay 层困住
- 浅色模式对比度修正（`color-mix`）
- 重播按钮修好（原来调的是 `dismissSplash()`，行为相反）
- 版本号 `v0.1.0` 作为**构建探针**，用于识别 WebView 缓存

**工具卡片**（5 个工具：pwsh / read / grep / edit / write）
- keyed 插槽必须用 `priority: -100`（同优先级会抛错）
- 路径缩短 `…/dir/file`
- 剥离 `<path>/<type>/<content>` 信封噪音

**抽屉导航**（主要工作）
- 分组：工作区 → 时间桶（刚刚/今天/昨天/更早）
- 过滤：`origin==='subagent'`、`blank`、`archivedSessionIds`
- 宽度 `min(72%, 300px)`，实测 298px / 412px
- 分组标签**吸附**在顶部滚动
- 底部**渐隐提示**（仅在有更多内容时出现）
- 会话标题**省略号** + 当前会话**跑马灯**
- 桌面宽度**完全隐藏**（不渲染）
- **未替换 sidebar**，通过 CSS 抑制原生侧栏列 + 重写 grid 模板

**tether 兼容层**（解决一个真实缺陷）
- 见 §4.4

---

## 4. 遇到的问题

按"值不值得记住"排序。

### 4.1 ⚠️ 键盘适配：我的验证是**循环论证**（最重要）

**问题**：手机键盘弹出时输入框不上移。

**根因**：Tauri 壳的 `AndroidManifest.xml` 里 `<activity>` **没有 `android:windowSoftInputMode`**，缺省解析成不缩小窗口 → WebView 布局视口不变 → 常规流里的输入框位置不变。

**我做了什么**：`viewport.ts`，用 `visualViewport` 驱动 app frame 高度。逻辑我验证了 **16/16 通过**。

**我的错误**：

> **我用 mock 模拟了「WebView 会通过 `visualViewport` 报告键盘」这个未知前提，然后拿逻辑去验证这个 mock。这只证明了逻辑自洽，没有证明前提成立。**

**后果**：桌面测试全绿，手机上依然不好用。**这个结论我错误地当作"已验证"报告给你了。**

**现状**：真机上是否生效**未知**。已加诊断徽章（§6）来终结这个猜测。若 WebView 不报告键盘，**客户端方案无解**，只能改原生并重编 APK。

### 4.2 sidebar 接管 = 全局崩溃（已放弃该路线）

尝试通过 `sidebar` 插槽整体接管导航栏，导致 **`Failed to load plugins`**：

1. 第一个 cell 冲突
2. `slot "sidebar.brand.mark" is already declared (by an entry in "sidebar")`

**优先级无法解决** —— 一个 slot key 只能有一个声明者。接管就等于停用 `ui-sidebar`，**违反你的约束**。

**已改为浮层方案**（不动 sidebar，抽屉浮在上面）。

### 4.3 CSS 抑制侧栏的 grid 陷阱

只给侧栏 `display:none` **不够** —— 网格模板仍是 `280px 132px 0px`，**中央区域掉进 280px 那条轨道**。

必须同时：重写 `grid-template-columns` + 显式钉住 `grid-column`。

### 4.4 dsh-tether 的过度选择器（两个真实缺陷）

tether 注入的窄屏样式里有两条**作用范围远超本意**的规则：

```css
[class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
[class*="rowText"] { flex: 1 1 100% !important; }
```

`_row` 是 **CSS Module 局部名后缀**。tether 故意匹配局部名（只有 hash 前缀随构建变），**但这个后缀在很多 DSH 包里都有 —— 实测命中 26 个元素**。

**缺陷 A：抽屉被撑到全宽**
tether 有条规则把 `[role="dialog"][aria-modal="true"]` 强制 `width:100%!important`，命中我的抽屉面板（413px / 412px）。

**修法**：改用 `role="navigation"`，不用 `aria-modal`。

**教训**：只在隔离 profile 测会漏掉这个 —— **3099 没装 tether，两个插件从未同场运行过**。

**缺陷 B：排队栏被压成细缝**
排队行 `li._7yHdaG_row` 被 DSH 设计成单行，被 tether 强制 `wrap` 后折成三行，内容要 **86px**，父容器固定 **36px + `overflow:auto`** → **裁掉 50px**。

**A/B 铁证**（只切 tether 样式表）：

```
            flex-wrap   子元素位置         内容高  盒子高  被裁
有 tether   wrap        756,780,810 三行    86      36     ✓
无 tether   nowrap      763,760,756 一行    36      36     ✗
```

**修法**：限定在排队栏 slot 内的反制规则，特异性 (0,3,0) 压制 (0,2,0)。

**差点犯的错**：我本想对所有 `_row` 强制 `nowrap`。范围探测发现 composer 里**还有第二个 `_row`**（权限/模型那行），**有无 tether 都是 `wrap`** —— 那是 DSH 的本意，强制 `nowrap` 会弄坏它。

**这是权宜之计**：缺陷在上游。tether 修好后关掉 `FEATURES.tetherCompat` 即可。

### 4.5 吸附标签吞掉触摸事件

抽屉"没有滚动效果"。`elementFromPoint` 显示触摸点上最顶层是**我加的 sticky 分组标签**（有背景、z-index:1），**把拖拽吃掉了**。

**为什么没早发现**：我用**程序化** `scrollTop` 验证（`0 → 212` 成功）。那证明**容器能滚**，不证明**手指能滚**。两者之间隔着 `pointer-events`、`touch-action`、`overscroll-behavior` 和点击穿透层。

**修法**：标签加 `pointer-events: none`。

**⚠️ 这个修复本身也没能在 CDP 里验证** —— 三次尝试全失败：

| 方法 | 结果 | 原因 |
|---|---|---|
| `synthesizeScrollGesture` | 失败 | headless 下不可信 |
| 手写 `TouchEvent` | 失败 | 合成事件**不触发原生滚动**，方法本身无效 |
| `dispatchTouchEvent`（真实输入通道） | **控制组也失败** | 抽屉面板 `x=-149`（收起态 `translateX(-100%)`），触摸点落在视口外 |

**第三次我特意加了控制组** —— 控制组失败**正确地阻止了我得出"抽屉坏了"的错误结论**。

### 4.6 会话标题被硬切（inline 元素陷阱）

标题是 `span`，父容器是 `display:block` 的 button → **保持 inline** → `overflow` / `text-overflow:ellipsis` **对 inline 盒子无效**。

实测：`display=inline, clientWidth=0, scrollWidth=0`，但盒子渲染 257px 宽 → 硬切 + 列表横向溢出 39px。

**对照**：工作区那两条正常，因为父容器是 `display:flex`，**flex item 会被自动 blockify**。

**修法**：`display:block` 外壳 + 内层 span 承载省略号（便于切换跑马灯）。

**顺带**：跑马灯阈值我定 12px，而目标标题刚好溢出 **12px** → 被跳过。改成 4px。

### 4.7 桌面端漏出一坨裸文本

抽屉组件**无条件渲染 DOM**，但**所有样式都在 `@media (max-width:768px)` 里** → 桌面宽度下变成**无样式裸内容**，以文档流铺在页面底部（实测 1432×249，245 个字符）。

**修法**：改成"**默认隐藏，窄屏启用**"（`display:none` 同时解决渲染和命中测试）。

**为什么测试没拦住**：我的桌面断言只检查"**原生侧栏还在**"，没检查"**我的东西不在**"。**判据错了** —— DOM 里存不存在是错的问题（组件总是存在），**是否绘制**才是对的问题。

### 4.8 构建陷阱：模板字符串里的反引号（踩了两次）

CSS-in-TS 的模板字符串里，**注释中写反引号会提前终止字符串**：

```ts
const CSS = `
  /* 不要写 \`这样\` 的反引号 */
`
```

报错是 `Expected a semicolon`，**指向下一行**，极易误判成别处语法错误。

**我在同一个坑里踩了两次**（第二次是在已经记录过之后）。

### 4.9 我自己的错误断言（多次）

| 错误 | 后果 |
|---|---|
| 断言用标签白名单 + "drawer" 子串 | 在正确的页面上失败 |
| 读**外层** `scrollWidth` 判溢出 | 恒等于 `clientWidth`，**断言通过但什么都没测** |
| 按子元素 `top` 去重数行数 | 同一行基线不同被误判成 3 行 |
| 桌面断言只查原生侧栏 | 漏掉整坨裸文本泄漏 |

**共同点：断言写得太宽泛或选错判据，于是"绿"了但没有覆盖力。**

### 4.10 其他

- **keyed 插槽同优先级会抛错** —— 必须 `priority: -100`
- **一个 slot key 只能有一个声明者**
- **`tsdown` 用顶层 `external`**，不是 `deps.neverBundle`（后者是 rolldown API，静默忽略）
- **客户端插件必须同时有 `dsh.bundle.patch` 和 `dsh.client`**
- **PowerShell 5.1 的 `Get-Content -Raw` 会破坏 UTF-8 中文**（GBK）→ 改用 `[System.IO.File]::ReadAllText(..., UTF8)`
- **Node 24 的 `globalThis.navigator` 是只读 getter** → 需 `Object.defineProperty`
- **3080 是每次请求从磁盘读 `lib/client.js`** → 改代码**不需要重启服务**，刷新页面即可

---

## 5. 没做什么

### 5.1 真机验证（**最重要**）

**所有验证都在桌面 Chromium 的 CDP 里完成。** 以下**全部需要真机**：

| 项 | 为什么 CDP 测不了 |
|---|---|
| 键盘是否真的不遮挡输入框 | 需要真实 IME 和 Android WebView |
| 抽屉**手指**能否滚动 | 三种触摸模拟方法全部失败（§4.5） |
| 悬浮 `☰` 能否点开 | 只有 CDP 命中测试，非真实触控 |
| 跑马灯节奏是否舒服 | 需要真实观感 |
| tether 兼容层在手机上的效果 | 桌面用的 412px 视口，非真实设备 |

### 5.2 原生启动屏（Phase 2）—— 阻塞

**变更集已完成并验证**（aapt2 资源校验通过），补丁在 `docs/android-native-splash.patch`（10,316 字节）。

**阻塞于工具链**：

```
link.exe         : 未找到
Visual Studio    : 不存在
NDK 27.0.12077973: 存在
```

缺少 MSVC，无法构建 APK。**未尝试安装**（`winget install Microsoft.VisualStudio.2022.BuildTools` 是可能的路径，但未执行 —— 这会是几个 GB 的下载，需要你同意）。

### 5.3 第 4 步：会话顶栏与输入框插槽

计划中但未做：

- `conversation.session.header`（single / session 作用域）
- `conversation.composer`（chain / session 作用域）

### 5.4 `ctx.locale` 接入

目前文案**只按浏览器语言**判断（`navigator.language`），**没有接 DSH 的 `ctx.locale`**。

### 5.5 侧栏接管式抽屉

**已放弃**（§4.2）。代码保留在 `Drawer.tsx`，`replaceSidebar: false`。

### 5.6 排队栏的键盘行为

你报告"**有待发送内容时输入栏不上弹**"。这个**仍未解决** —— 它和 §4.1 是同一个问题，卡在"WebView 是否报告键盘"这个未知前提上。

### 5.7 未做的事（故意的）

**没有**为了"看起来在修"而加防御性 CSS。例如给 composer 加 `flex-shrink: 0`：键盘全开时 frame 很矮，不可压缩的 composer **会溢出被 `overflow:hidden` 裁掉** —— 那是拿一个未查明的问题换一个已知风险。

---

## 6. 现在需要你做的一件事

我在页面上加了一个**诊断徽章**（左上角黑色小方块），显示**真实数据**：

```
iH 915  vV 915  min 915
gap 0  var -  eng no
ev v0/0 w0 f0
kbd ever no   (tap to hide)
```

**请：刷新手机页面 → 点输入框弹出键盘 → 截图徽章（或把四行数字告诉我）。**

### 这四行决定走哪条路

| 你看到 | 含义 | 对策 |
|---|---|---|
| `min` **变小**、`ev` **增加** | WebView **会**报告键盘 | 前提成立，问题在逻辑，我继续改 |
| `min` **一直 915**、`ev` **全 0** | WebView **完全不报告** | **客户端无解**，必须改原生重编 APK |

`min` 是"历史最小高度"，**即使截图时键盘已收起也能看出来**。徽章可点击隐藏。

`FEATURES.keyboardDebug` 关掉即可移除。

---

## 7. 当前功能开关

```js
FEATURES = {
  splash:        true,   // 启动页（加法式）
  settings:      true,   // 设置页（加法式）
  keyboardFit:   true,   // ⚠️ 验证方式有缺陷，见 §4.1
  tetherCompat:  true,   // tether 反制规则（上游修好后可关）
  keyboardDebug: true,   // 🔧 临时诊断徽章
  toolCards: ['pwsh','read','grep','edit','write'],  // 替换式
  replaceSidebar: false, // 已放弃的路线
  drawerOverlay:  true,  // 浮层抽屉
}
```

---

## 8. 验证工具怎么用

```powershell
# 构建 + 载入契约校验
npm run bundle
npm run verify

# 需要真实浏览器的验证（CDP，默认 http://127.0.0.1:9222）
node tools/verify-drawer-overlay.mjs "<url>?token=..." <out-dir>
node tools/verify-title-marquee.mjs  "<url>?token=..." <out-dir>
node tools/verify-tether-compat.mjs  "<url>?token=..."      # 必须用装了 tether 的 3080
node tools/verify-keyboard-fit.mjs   "<url>?token=..." <out-dir>
```

**关键纪律**：

1. **必须驱动真实浏览器** —— `verify-bundle.mjs` 单独跑会漏掉 DOM/布局真相
2. **必须在装了 tether 的环境测** —— 隔离 profile 已经藏过两次真 bug
3. **断言通过 ≠ 正确** —— 有两个缺陷（路径溢出、信封噪音）**只有读截图才发现**

---

## 9. 目录结构

```
dsh-plugin-mobile-ui/
├── src/
│   ├── index.ts                    服务端半（5 行）
│   └── client/                     浏览器半
│       ├── index.tsx               apply 入口
│       ├── config.ts               功能开关 + 中英文案
│       ├── theme.ts                DSH token 映射
│       ├── Splash.tsx              启动页
│       ├── Settings.tsx            设置页
│       ├── ToolCard.tsx            工具卡片
│       ├── DrawerOverlay.tsx       浮层抽屉（主要工作）
│       ├── Drawer.tsx              已废弃的侧栏接管式
│       ├── viewport.ts             键盘适配
│       ├── keyboard-debug.ts       临时诊断徽章
│       └── tether-compat.ts        tether 反制规则
├── tools/                          35 个验证/探测脚本
├── docs/                           13 份 Markdown + 原生启动屏补丁（共 14 个文件）
├── lib/                            构建产物
├── verify-bundle.mjs               载入契约 + 渲染冒烟
├── tsdown.config.ts
└── README.md / README.en.md
```

---

## 10. ⚠️ 安全提醒

会话历史里出现过两个 GitHub PAT（个人访问令牌）：

1. 聊天中明文出现过一个 `ghp_` 开头的令牌
2. **另一个出现在会话标题里**，因此**会显示在抽屉的会话列表中**（截图中可见）

两者都**仍然有效**（未撤销）。建议**立即去 GitHub → Settings → Developer settings → Personal access tokens 撤销它们**。

当前推送使用的是**缓存的 GCM 凭据**，不再需要明文令牌。

> 本文件刻意不记录令牌的具体字符。第一次提交此报告时因包含完整令牌被 GitHub Push Protection 拒绝，这正好说明这类信息不该写进任何仓库。

---

## 11. 一句话总结

**加法式表面（启动页 / 设置页）已经可用，浮层抽屉在桌面上经过扎实验证。两个真实的上游缺陷（tether 选择器过宽）已定位并加了范围极窄的反制。**

**但键盘遮挡问题卡在一个未验证的前提上** —— 而我之前用"验证 mock"的方式错误地报告它已完成。**一个诊断徽章的截图就能定案。**
