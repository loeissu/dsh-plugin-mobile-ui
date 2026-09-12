# dsh-plugin-mobile-ui · 完整说明

**日期**：2026-09-12（在 2026-09-11 会话基础上续写）  
**包名 / 版本**：`dsh-plugin-mobile-ui` / `0.1.0`  
**本地路径**：`H:\DSH\_work\repo\dsh-plugin-mobile-ui`  
**远端**：https://github.com/loeissu/dsh-plugin-mobile-ui  
**验证环境**：DSH `0.1.5-rc.1` @ 3080（装 dsh-tether `0.1.13`）+ Chrome CDP 412×915  

---

## 1. 这是什么

把 DeepSeek Harness **Web 客户端**改成更适合手机用的界面，以 **官方 slot 客户端插件** 形式交付：

- **不是** dsh-tether 的 fork  
- **不是** CSS 注入 hack  
- **不是** 修改 DSH 源码  
- 走 `ctx.slots.register` / `ctx.slots.inject`，与官方 `ui-sidebar` 等同级  

**硬约束**（逐字遵守）：

1. 不 fork dsh-tether  
2. 不修改 DSH 源码  
3. 不升级 dsh-tether 的 `androidRuntime.dsh`  
4. 不替换 sidebar 插槽、不停用 ui-sidebar  
5. 每步先在隔离 profile 验证，再推生产  

---

## 2. 快速使用

```powershell
# 构建 + 契约自检
npm run bundle
npm run verify

# 装进 profile（已装过则跳过）
dsh plugin --profile web add .

# 重启 dsh web 后，手机刷新页面
# 3080 每请求从磁盘读 lib/client.js，改完 bundle 刷新即可，不必重启服务
```

### 真机操作一览

| 动作 | 操作 |
|---|---|
| 打开导航抽屉 | 顶栏 **「导航」**（在「对话」「轨迹」左侧） |
| 关闭抽屉 | 点遮罩 / 面板内**左滑** / 右上角 `×` / Esc |
| 新建会话 | 抽屉标题栏 **＋** |
| 设置 | 抽屉底部 **设置** |
| 手动重连 | 抽屉底部 **刷新连接** |
| 连接状态 | 抽屉底部圆点：蓝=已连接，蓝呼吸=连接中，灰=未连接 |
| 回前台 | 页面重新可见且断线时**自动** `reconnect` |

---

## 3. 功能总览

### 3.1 表面（slot）

| 表面 | 插槽 | 语义 | 默认 |
|---|---|---|---|
| 启动页 Splash | `shell.overlay` | list 加法 | 开 |
| 浮层抽屉 Drawer | `shell.overlay` | list 加法 | 开 |
| 设置页（移动端） | `settings.section` | list 加法 | 开 |
| 工具卡片 | `tool.call.toolview` | keyed **替换** | 开（5 个工具） |
| 侧栏接管 Drawer | `sidebar` | single **替换** | **关**（已放弃） |

### 3.2 非 slot 能力

| 能力 | 文件 | 说明 |
|---|---|---|
| 键盘适配 | `viewport.ts` | `visualViewport` 缩 frame；**缓解，非根治** |
| tether 兼容 | `tether-compat.ts` | 反制 tether 过宽选择器：① `_row` 规则压扁排队栏；② 模态框规则让确认弹层标题压住正文、按钮被卡片裁掉 |
| 排版基线 | `typography.ts` | 关 WebView 字体放大、行高下限、去点按闪灰 |
| 主机设置弹层排版 | `settings-chrome.ts` | 窄屏字号/间距/主题三列 |
| 键盘诊断徽章 | `keyboard-debug.ts` | 临时，默认关 |
| 回前台自动重连 | `connection-recovery.ts` | `visibilitychange` + disconnected → reconnect |

### 3.3 功能开关 `FEATURES`

```ts
splash: true
settings: true
keyboardFit: true
tetherCompat: true
typography: true
resumeReconnect: true
keyboardDebug: false          // 临时诊断，默认关
toolCards: ['pwsh', 'read', 'grep', 'edit', 'write']
replaceSidebar: false         // 已放弃的接管路线
drawerOverlay: true
```

---

## 4. 抽屉（当前交互）

### 4.1 打开 / 关闭

- **唯一打开入口**：顶栏文字 **「导航」**  
  - 样式对齐「对话 / 轨迹」（13px）  
  - 位置：tablist 最左侧（实测 left≈20，top≈50）  
  - 宿主 tablist `padding-left: 56px` 给「导航」让位  
- **已移除**：悬浮 ☰、左缘点击/滑动打开  
- **关闭**：遮罩点击 / 面板内**左滑 >72px** / 关闭钮 / Esc  

### 4.2 布局

- 窄屏（≤768px）把原生侧栏 **停靠到视口外**（`display:block` + `left:-10000px`），不是 `display:none`  
  - 原因：ui-settings 弹层渲染在 `sidebar.settings` 席位内，`display:none` 会让弹层 0×0 不可见  
- AppFrame `grid-template-columns: minmax(0,1fr) 0px`，对话占满  
- 面板宽 `min(72%, 300px)`，浮层 + 全屏半透明遮罩  
- 列表行 `content-visibility: auto` 减轻长列表绘制  

### 4.3 抽屉内能力

- 工作区列表 + 会话按「刚刚 / 今天 / 昨天 / 更早」分组  
- 过滤 subagent / blank / archived  
- 标题省略号；当前会话跑马灯（阈值 4px）  
- 标题展示层脱敏 GitHub PAT  
- 底部：**● 状态点 · 设置 · 刷新连接**  
- 标题栏：**＋ 新建会话 · ×**

---

## 5. 设计 token（`theme.ts`）

### 字号 `TYPE`

| 键 | 值 | 用途 |
|---|---|---|
| micro | 11px | 分组标签、计数、路径 |
| caption | 12px | 时间、脚注、工具正文 |
| bodySm | 13px | 次级行、工具标题、设置控件 |
| body | 14px | 主列表正文 |
| bodyLg | 15px | 抽屉标题、弹层标题 |
| display | 19px | 启动页品牌名 |

### 圆角 `R`

`xs 5` / `sm 9` / `md 12` / `lg 14` / `xl 16` / `panel 30` / `pill 999`

### 行高 `TYPE_LH`（2026-09-12 新增）

每个字号配一个行高，避免同一步骤在不同组件里出现多种节奏：

| 字号 | 行高 |
|---|---|
| micro 11 | 16px |
| caption 12 | 18px |
| bodySm 13 | 18px |
| body 14 | 21px |
| bodyLg 15 | 22px |
| display 19 | 28px |
| code 12（等宽） | 20px（代码比 UI 文案需要更多空气） |

### 间距 `SPACE` / 层序 `Z`（2026-09-12 新增）

- `SPACE`：`xs 4` / `sm 6` / `md 8` / `lg 12` / `xl 16` / `xxl 20`，另有具名的 `rowY 11`（11 + 21 + 12 = 44px 行高的来源）。采用是**机会式**的：新写或正在改的规则用它，其它保持字面量直到下次需要动。
- `Z`：`splash 2147483000` / `sheet 2147482000` / `debug 2147481000` / `local 2` / `sticky 1`。抽屉必须在宿主弹层之上，而我们无法预知宿主的层序，所以前三个刻意贴近 32 位上限。

### 动效 `MOTION`

`base 200ms` · `sheet 220ms` · `expand 200ms` · `spin 900ms` · `pulse 1200ms` · `cubic-bezier(.4,0,.2,1)`

遮罩与面板**成对**（同 220ms、同曲线）；工具卡展开用 `expand`；所有过渡的 `var()` 兜底都是 `MOTION.ease`（早期写的 CSS 关键字 `ease` 是另一条曲线，已改掉）。

颜色一律走 DSH `--dsw-alias-*`（accent 用 `--dsw-alias-brand-primary-new-colorprimary-new-color`，**不是** `brand-primary`）。

---

## 6. 连接与后台

| 机制 | 行为 |
|---|---|
| 手动刷新 | `ctx.connection.reconnect()`，1.2s busy 转圈 |
| 自动恢复 | 页面变 visible 且 `state === 'disconnected'` 时 reconnect，2.5s 防抖 |
| 状态点 | 订阅 `ctx.connection.state` |

**场景**：App 切后台后 WebSocket 常半死且不发 `offline`，DSH 自身重连不会跑——自动恢复 + 手动按钮覆盖。

---

## 7. 键盘 / 输入框（重要）

### 现象

进页第一次点输入框，输入法常不弹；点别处再回来才正常；时好时坏。

### 根因（原生，已调研钉死）

1. Tauri `AndroidManifest.xml` **没有** `android:windowSoftInputMode`（缺省 `adjustUnspecified`）  
2. `MainActivity` 调了 `enableEdgeToEdge()`，未处理 IME insets  
3. 文档 `html/body` ≈ 视口高且不可滚，系统 pan 也无处可 pan  
4. 已 autofocus 的输入框再点，WebView 常不 `showSoftInput`

### 客户端缓解（已做，**不能根治**）

- viewport meta：`interactive-widget=resizes-visual`  
- 阈值：启用 100px / 释放 40px（迟滞）  
- 旋转：`innerWidth` + `vv.width` 双源重置  
- 静默 IME：200ms 常驻轮询 + focus 后 40–800ms 重试  
- 已聚焦再点：强制 `blur→refocus`（800ms 冷却）  

### 根治（需出 APK）

```xml
android:windowSoftInputMode="adjustResize"
```

本机缺 MSVC/link.exe，**出不了包**。

---

## 8. 启动页

| | 冷启动 | 热启动（同 session） |
|---|---|---|
| 最短可见 | 700ms | **120ms** |
| 硬上限 | 4000ms | **900ms** |

`sessionStorage` 键：`dsh-mobile-ui/splash-warm`。刷新/再进不再坐满品牌节拍。

---

## 9. 工具卡片

- 替换 `pwsh / read / grep / edit / write` 的 shipped 卡片（`priority: -100`）  
- 默认折叠；**失败卡自动展开** + 警示三角图标  
- 路径缩短 `…/dir/file`；剥离 `<path>/<type>/<content>` 信封  
- 展开动画 `grid-template-rows 0fr→1fr`

---

## 10. 设置

### 主机设置弹层（DSH 自带）

窄屏 `settings-chrome.ts`：

- 标题 15px / 正文·导航·选择器 13px / 说明 12px  
- 消掉 `_row` + `_rowText` 双层 padding（行高 ~137→~100）  
- 主题三列横排（浅色 / 深色 / 跟随系统）  
- 弹层打开时隐藏顶栏「导航」，避免压标题  

### 本插件「移动端」页

版本号、主题跟随、工具卡数量、重放启动页；文案在 `config.ts` zh/en。

---

## 11. 验证

### 契约（无浏览器）

```powershell
npm run bundle && npm run verify
```

### CDP（需 3080 + token + Chrome `:9222`）

```powershell
# token 从 H:\DSH\dsh-web.log 取最新
$url = "http://127.0.0.1:3080/?token=..."

node tools/verify-drawer-open.mjs $url
node tools/verify-drawer-overlay.mjs $url <out-dir>
node tools/verify-drawer-settings.mjs $url <out-dir>
node tools/verify-drawer-swipe.mjs $url
node tools/verify-drawer-push.mjs $url      # 若再启用推挤模式
node tools/verify-conn-dot.mjs $url
node tools/verify-drawer-refresh.mjs $url
node tools/verify-resume-reconnect.mjs $url
node tools/verify-splash-warm.mjs $url
node tools/verify-toolcards.mjs $url <out-dir>
node tools/verify-title-marquee.mjs $url <out-dir>
node tools/verify-risk-dialog.mjs $url          # 确认弹层：标题在正文之上、按钮不被卡片裁掉
node tools/verify-keyboard-fit.mjs $url <out-dir>   # mock ≠ 真机
```

**纪律**：必须驱动真实浏览器；断言通过 ≠ 真机正确；触摸/IME 只能真机定论。

---

## 12. 目录结构（活动源码）

```
src/
  index.ts                      Node 半边（空 apply）
  client/
    index.tsx                   apply：注册全部表面
    config.ts                   FEATURES + zh/en 文案
    theme.ts                    V / TYPE / TYPE_LH / R / SPACE / Z / MOTION / injectStyles
    typography.ts               排版基线
    Splash.tsx                  启动页
    Settings.tsx                设置节
    ToolCard.tsx                工具卡
    DrawerOverlay.tsx           浮层抽屉（主交互）
    Drawer.tsx                  已废弃侧栏接管（保留）
    viewport.ts                 键盘适配
    tether-compat.ts            tether 反制
    settings-chrome.ts          主机设置弹层排版
    connection-recovery.ts      回前台自动重连
    keyboard-debug.ts           诊断徽章（默认关）
lib/                            构建产物（不入 git）
tools/                          探针与 verify 脚本
docs/                           报告与日志
```

---

## 13. 已知限制与风险

| 项 | 说明 |
|---|---|
| 键盘真机行为 | 客户端只能缓解；根治要改 APK |
| 无 adb / 无真机自动化 | 触摸、IME、tether 真机宽度未在 CI 验证 |
| tether 选择器过宽 | 上游缺陷，两处：`_row` 规则压扁排队栏；模态框规则（全屏 + header 绝对定位 + 对 content-box 用 `width:100%`）让确认弹层标题压住正文、右侧按钮被卡片裁掉。我们用窄范围反制，见 `tether-compat.ts` |
| `ctx.locale` 未接 | 文案按 `navigator.language` |
| 无单元测试 / CI | 仅 CDP 脚本 |
| GitHub PAT | 会话标题里出现过 `ghp_`；**请去 GitHub 撤销**；抽屉已脱敏显示 |
| README 可能滞后 | 以本文与 `docs/2026-09-11-session-log.md` 为准 |

### 已放弃 / 撤回

- **侧栏 slot 整体接管** — 与 ui-sidebar 抢 slot，失败即全局 “Failed to load plugins”  
- **推挤式左栏**（2026-09-12 试过并撤回）— 打开时 padding-left 把对话顶栏一起右移；已恢复浮层模式  
- **仅左缘滑动打开** — 真机不可靠（与系统返回抢边缘），已改为顶栏「导航」文字  

---

## 14. 运行中的实例

| 端口 | profile | 插件 | tether | 用途 |
|---|---|---|---|---|
| **3080** | `web` | ✅ | ✅ | 生产，手机连的这个 |
| 3099 | `scratchui` | ✅ | ❌ | 隔离测试（当前未起） |

DSH 读盘 `lib/client.js`：**改完 bundle 刷新页面即可**。

---

## 15. 相关文档

| 文件 | 内容 |
|---|---|
| `docs/2026-09-11-session-log.md` | 会话修改日志（含后半场 P0/P1） |
| `docs/keyboard-occlusion.md` | 键盘遮挡诊断与缓解 |
| `docs/queue-bar-investigation.md` | 排队栏调查 |
| `STATUS.md` | 更早的项目状态报告 |
| `README.md` | 安装与原理（部分章节可能滞后） |

---

## 16. 一句话

**手机上用顶栏「导航」开抽屉做会话/设置/重连；工具卡与启动页已收紧；键盘问题根因在 Tauri 壳，客户端只能缓解，根治需改 `windowSoftInputMode` 并重编 APK。**
