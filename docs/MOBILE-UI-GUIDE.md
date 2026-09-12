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
| 会话控件命中区 | `conversation-chrome.ts` | 宿主的消息操作/composer/`对话`·`轨迹` 命中区扩大到 35–43px（绘制尺寸不变）；会话标题让出空间（隐藏装饰性 `/` 与重复的模式标签、子代理 chip 折叠成图标）；底部指标行不再裁字（2026-09-12 新增）|
| 键盘诊断徽章 | `keyboard-debug.ts` | 临时，默认关 |
| 回前台自动重连 | `connection-recovery.ts` | `visibilitychange` + disconnected → reconnect |

### 3.3 功能开关 `FEATURES`

```ts
splash: true
settings: true
keyboardFit: true
tetherCompat: true
typography: true
conversationChrome: true      // 宿主会话控件的命中层（只改命中区，不改绘制）
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
  - 字号对齐「对话 / 轨迹」（13px），**字重 600**（宿主两个 tab 是 500）：实测导航比它们明显更重，入口一眼可辨
  - **三个标签等距**：间距与宿主自己的 tab 间距一致（实测宿主 `column-gap: 36px`，所以 导航↔对话 = 对话↔轨迹 = **36px**，节距统一 62px）
  - 位置：tablist 最左侧（实测 left≈20，top≈50）
  - 宿主 tablist 的 `padding-left` 由**运行时测量**写入 `--dsh-mobile-nav-reserve`：= 标签宽度 + 宿主自己的 gap（中文 62px / 英文 `Navigation` 101px），因此换语言也不会与「对话」重叠；62px 只是首帧兜底
  - 命中区 45×45（伪元素扩张，绘制仍是 26×25）
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
| 手动刷新 | `ctx.connection.reconnect()` → 旧 socket 以 **code 4000 / "reconnect requested"** 关闭、新 socket 立即建立（实测：120ms 内 `connecting → connected`）；busy 最短 700ms、上限 4s，由连接状态派生而不是定时器 |
| **链路探针** | reconnect 之后用 `fetch(location.href, {cache:'no-store'})` **验证请求真的到达电脑**（响应里必须有宿主注入的 `__DSH_BOOT__`）。4s 超时 |
| **链路已断（第三态）** | 探针失败 = socket 连着但后面没有隧道 → 状态点变成 `dead`（主标签色圆环 + 文案「链路已断」），按钮变成 **「重新加载」**（点击 `location.reload()`） |
| 前台回归 | page 变 visible 时**自动跑一次探针**，不需要用户点；`state === 'disconnected'` 时仍会 reconnect（2.5s 防抖） |
| 状态点 | 订阅 `ctx.connection.state`，四种：蓝填充=已连接 / 蓝脉冲=连接中 / 灰填充=未连接 / 深色圆环=链路已断 |

**为什么需要探针（这是手机上「点了没用」的根因）**：手机上页面的 origin 是 **tether App 内的回环代理** `http://127.0.0.1:<端口>`（tether 自己的 CHANGELOG 写明），所以 app socket 的对端是**手机本机的代理**，不是电脑。App 切后台后真正断掉的是代理背后的 **P2P 隧道**，而 `reconnect()` 换一条到本机代理的 socket 总是**瞬间成功** → 连接状态回到 `connected`、点变蓝，但数据到不了电脑。客户端**检测不到**这种假活：连接层没有心跳（只有 15s 的首代就绪计时），tether 注入的脚本也没有任何连接恢复（实测只有抽屉遮罩、文件查看、设备列表三件事）。

**所以**：假活时点「重新加载」才是对的动作——重新加载会重跑握手，而 tether 客户端在每次页面加载时都会重建隧道（主机日志里每次「手机已开始加载界面」后面都跟着一条新的 `连接路径: P2P 直连(NAT 打洞成功)`）。如果连重新加载也回不来，问题在更外层（Android 客户端的配对/认证，主机 err 日志里能看到 `authentication failed`），需要去 tether 的「主机」页重新配对。

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
- **标题行给足高度（`_navTitle` min-height 44px）**：标题行原本只有 22px 高，却放着 32px 的关闭按钮与 28px 的「打开配置文件」——桌面下 nav 是左栏、戳出去没东西可撞，**手机上 tether 把 nav 变成标题下方的横排 tab 条，两个按钮就直接压在那条上**（实测重叠 18px，× 盖住被选中的「移动端」胶囊）。不是把控件改小，而是把行高还给它，关闭按钮的 44px 命中层保持不变
- **五个 tab 必须在 392px 内放得下（不横滚）**：授权间距下五格共需 **453px** → 横滚，而选中的是最后一格（本插件的「移动端」）时条带会滚到右端，**最左的「通用设置」被裁成「设置」**。只回收间距、不动字号与内容：格子 padding 11→7px（−40）、图标与文字间距 8→4px（−20）、条带 gap 4→2px（−8）→ **实测 392/392，五格共 377px，无滚动**，13px 文字与 16px 图标原样保留

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
node tools/verify-tap-targets.mjs $url          # 插件自己控件的真实命中区（逐像素外扩）
node tools/verify-conversation-touch.mjs $url   # 宿主会话控件的命中区（消息操作/composer/tab）
node tools/verify-conversation-chrome.mjs $url  # 会话标题空间 + 底部指标行不裁字（412/360）
node tools/verify-settings-chrome.mjs $url      # 宿主设置弹层：标题行控件不压 tab 条、五个 tab 不需横滚
node tools/verify-refresh-honesty.mjs $url      # 刷新连接：换 socket + 假活时给出「重新加载」
node tools/verify-nav-tab-locale.mjs $url       # 中英文下「导航」预留与宿主首个 tab 不重叠
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
