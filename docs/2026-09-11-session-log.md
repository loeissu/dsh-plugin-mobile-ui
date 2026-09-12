# 2026-09-11 会话修改日志

**范围**：代码审查、bug 修复、键盘排查、设置入口恢复、UI / 字号 / 圆角体系  
**代码基线**：工作区相对 `c09e1a2` 的未提交改动  
**产物**：`lib/client.js`（约 91 KB）；3080 每请求读盘，**手机刷新即生效**  
**验证环境**：DSH 3080（装 tether）+ Chrome CDP 412×915；**无 adb / 无真机**

---

## 1. 已完成

### 1.1 诊断徽章不再挡导航

| | |
|---|---|
| **问题** | 左上角键盘诊断徽章盖住抽屉 `☰`，命中测试 FAIL，看起来像按钮坏了 |
| **修复** | `FEATURES.keyboardDebug` 默认 `false`；若开启则移到右下角，z-index 低于抽屉浮层 |
| **文件** | `config.ts`、`keyboard-debug.ts` |

### 1.2 会话标题 PAT 脱敏

| | |
|---|---|
| **问题** | 抽屉里会话标题直接显示完整 `ghp_` GitHub PAT |
| **修复** | 展示层脱敏 `gh[pousr]_*` / `github_pat_*` 为前缀…后缀；**不改底层数据** |
| **文件** | `DrawerOverlay.tsx` |
| **仍须** | 去 GitHub **撤销**该令牌——脱敏只防截图 |

### 1.3 配置与主题卫生

- `config.ts`：`Copy` 接口与中英文案**重复键**清理  
- 抽屉完成态圆点：硬编码 `#34d399` → accent token + opacity  
- `Settings.tsx`：删除未使用的 `expandCards`、`dismissSplash`

### 1.4 键盘 / 输入框（缓解，非根治）

| 改动 | 说明 |
|---|---|
| viewport meta | 注入 `interactive-widget=resizes-visual`，固定 Chromium 键盘布局模式 |
| 阈值 | 启用 **100px** / 释放 **40px**（迟滞），避开 edge-to-edge 系统栏误判 |
| 旋转 | `innerWidth` + `visualViewport.width` 双源重置 layout 高水位 |
| 静默 IME | 200ms 常驻轮询 + focus 后 40–800ms 密集重试 |
| 已聚焦再点 | 强制 `blur→refocus`（800ms 冷却），尝试拉起 IME |

**文件**：`viewport.ts`  
**结论**：真机「首次不弹 / 时好时坏」仍可能存在——根因在原生壳，见 §2。

### 1.5 设置入口恢复（App 上设置按钮消失）

| | |
|---|---|
| **根因** | 窄屏把侧栏 `display:none` 后，ui-settings 弹层渲染在 `sidebar.settings` 席位内，被一起 unpaint（实测 dialog 0×0） |
| **修复 A** | 侧栏改为**视口外停靠**（`display:block` + `left:-10000px`），`position:fixed` 弹层仍按视口绘制；`pointer-events:none`，弹层 opt-in |
| **修复 B** | 抽屉底部增加「设置」：关闭抽屉 → 触发原生设置按钮 |
| **修复 C** | 设置弹层打开时用 `:has()` 隐藏悬浮 `☰`，避免压住标题 |
| **文件** | `DrawerOverlay.tsx`、`config.ts`、`settings-chrome.ts` |

### 1.6 设置弹层字号 / 排布

| 项 | 之前 | 现在 |
|---|---|---|
| 标题「设置」 | 16px | **15px / 600** |
| 分区标题 / 导航 / 选择器 / 主题卡 | 13–14px 混用 | **13px** |
| 说明文字 | 12px | **12px**，行高 17px |
| 双层 padding | `_row` + `_rowText` 各 12px → 行高 ~137px | 内层归零 → **~100px** |
| 主题卡 | 纵向大卡 ~252px | **三列横排**，高 60px |
| 内容总高 | ~809px | **~618px** |

**文件**：`settings-chrome.ts`（主机弹层）、`Settings.tsx`（本插件「移动端」页：间距 26→20，行 padding 收紧）

### 1.7 设计 token（`theme.ts`）

**字号 `TYPE`**

| 键 | 值 | 用途 |
|---|---|---|
| `micro` | 11px | 分组标签、计数、路径 |
| `caption` | 12px | 时间、脚注、工具正文 |
| `bodySm` | 13px | 次级行、工具标题、设置控件 |
| `body` | 14px | 主列表正文 |
| `bodyLg` | 15px | 抽屉标题、弹层标题 |
| `display` | 19px | 启动页品牌名 |

**圆角 `R`**

| 键 | 值 | 用途 |
|---|---|---|
| `xs` | 5px | 行内 chip |
| `sm` | 9px | 徽章 |
| `md` | 12px | 图标按钮、设置行 |
| `lg` | 14px | 工具卡 |
| `xl` | 16px | 设置卡片 |
| `panel` | 30px | 抽屉端帽 |
| `pill` | 999px | 圆点 / 开关 |

**动效 `MOTION`**：`base 200ms` / `sheet 220ms` / `expand 280ms`，统一 `cubic-bezier(.4,0,.2,1)`。

已套用：抽屉、设置页、工具卡、启动页、主机设置弹层、诊断徽章。

### 1.8 自审与终审

- 移除死代码与未用 import  
- 活动组件不再手写 `11.5px` / `12.5px` / `13.5px`  
- CDP 回归见 §4  

---

## 2. 未完成 / 阻塞

| 项 | 状态 | 原因 |
|---|---|---|
| **真机键盘根治** | 未完成 | Tauri `AndroidManifest` 无 `windowSoftInputMode` + `MainActivity.enableEdgeToEdge()`；页面无法可靠 `showSoftInput` |
| **原生启动屏 APK** | 阻塞 | 缺 MSVC / `link.exe`，本机出不了包 |
| **真机触摸 / IME 验证** | 未做 | 无 adb、无 Android 设备；仅有 CDP 模拟 |
| **`ctx.locale` 接入** | 未做 | 文案仍按 `navigator.language` |
| **顶栏 / composer 插槽** | 未做 | `conversation.session.header`、`conversation.composer` |
| **侧栏接管式抽屉** | 故意放弃 | `replaceSidebar: false`，代码保留在 `Drawer.tsx` |
| **GitHub PAT 撤销** | **需你操作** | 会话标题中的 `ghp_` 仍有效 |
| **排队栏键盘行为** | 未定论 | 与键盘同一根因 |

### 建议的原生修法（需出包）

```xml
<activity
    android:windowSoftInputMode="adjustResize"
    ...>
```

或 edge-to-edge 正规路径：`WindowCompat` + `Type.ime()` insets。

---

## 3. 本会话修掉 / 规避的 bug

1. 诊断徽章挡抽屉按钮 — 命中测试 FAIL → PASS  
2. PAT 明文出现在抽屉 — 已脱敏  
3. 设置入口在 App 上消失 — 侧栏停靠 + 抽屉设置按钮  
4. 设置弹层 0×0 不可见 — `display:none` 祖先 unpaint  
5. 设置行双层 padding — 行高 137 → 100  
6. 主题卡手机纵排占满 — 强制三列  
7. viewport 阈值贴系统栏 — 60 → 100 + 迟滞  
8. 旋转被当成键盘 — 宽度双源重置  
9. 首次进页键盘不跟 — 轮询 / focus 重试 / blur-refocus（**真机仍可能无效**）  
10. CSS 模板字符串注释里反引号截断构建（第二次）— 去掉反引号  
11. 字号 / 圆角硬编码散落 — token 统一  
12. `config.ts` 接口与文案重复键 — 已清理  

---

## 4. 验证结果（3080 + CDP）

| 套件 | 结果 |
|---|---|
| `npm run bundle` + `verify` | PASS |
| `verify-drawer-overlay` | PASS（含桌面宽度不泄漏） |
| `verify-drawer-settings` | PASS（弹层 412×915 可绘制） |
| `verify-toolcards` | PASS（47 张卡展开） |
| `verify-title-marquee` | PASS |
| `verify-keyboard-fit` | PASS（mock；**≠ 真机结论**） |
| `verify-keyboard-focus-poll` | PASS（静默 IME 缩小） |
| `verify-ime-refocus` | PASS（blur 调用计数） |
| `verify-tether-compat` / coexistence | PASS |

---

## 5. 改动文件（活动源码）

```
src/client/theme.ts              TYPE / R / MOTION token
src/client/config.ts             文案去重、keyboardDebug=false
src/client/viewport.ts           键盘缓解加固
src/client/DrawerOverlay.tsx     侧栏停靠、设置入口、token、PAT 脱敏
src/client/Settings.tsx          token、间距、死代码清理
src/client/ToolCard.tsx          token、动效统一
src/client/Splash.tsx            token
src/client/settings-chrome.ts    新建：主机设置弹层窄屏排版
src/client/keyboard-debug.ts     徽章位置 / 圆角
src/client/index.tsx             挂载 settings-chrome
tools/verify-drawer-settings.mjs 等探针 / 验证脚本
```

---

## 6. 一句话（前半场）

**桌面可验证的 UI / 导航 / 设置链路已收紧并回归全绿；键盘「时好时坏 / 首次不弹」根因在原生壳，客户端只能缓解，根治需改 APK。**

---

## 7. 后半场：P0 / P1 逐项落地

按「一个一个做并验证」完成。

### 7.1 回前台自动重连（P0-1）

| | |
|---|---|
| **场景** | App 切后台后 WebSocket 半死，且常无 `offline` 事件，DSH 自身重连不跑 |
| **实现** | `connection-recovery.ts`：`visibilitychange` / `pageshow` 且 state=`disconnected` 时调用 `ctx.connection.reconnect()`；2.5s 防抖 |
| **开关** | `FEATURES.resumeReconnect: true` |

### 7.2 连接状态点（P0-2）

抽屉底部 `●`：connected 蓝 / connecting 蓝呼吸 / disconnected 灰。订阅 `ctx.connection.state`。

### 7.3 Splash 热启动降噪（P0-3）

| | 冷启动 | 热启动（同 session） |
|---|---|---|
| min | 700ms | **120ms** |
| max | 4000ms | **900ms** |

`sessionStorage` 标记。

### 7.4 列表窗口化（P0-4）

会话/工作区行：`content-visibility: auto` + `contain-intrinsic-size`。不破坏 sticky 标签与点击。

### 7.5 刷新连接按钮

设置右侧 `⟳ 刷新连接` → `ctx.connection.reconnect()`，1.2s busy 转圈。

### 7.6 新建会话（P1-5）

抽屉标题栏 `＋` → `uiWorkspace.startSession()`。

### 7.7 面板内右滑关闭（P1-6）

仅横向右滑（\|dx\|>1.2\|dy\|）；>72px 关闭；拖动跟手；纵向不抢列表滚动。

### 7.8 失败工具卡默认展开（P1-8）

`useEffect` 在 `failed` 时 `setOpen(true)`；失败图标改为警示三角。

### 7.9 本批验证

| 套件 | 结果 |
|---|---|
| `verify-resume-reconnect` | PASS |
| `verify-conn-dot` | PASS（connected 蓝点） |
| `verify-drawer-refresh` | PASS |
| `verify-splash-warm` | PASS |
| `verify-drawer-windowing` | PASS |
| `verify-drawer-new-session` | PASS |
| `verify-drawer-swipe` | PASS |
| `verify-toolcard-fail-open` | PASS（当前 transcript 无失败卡，空真） |
| `verify-toolcards` / overlay / settings | PASS |

### 7.10 新增 / 改动文件（后半场）

```
src/client/connection-recovery.ts   新建
src/client/config.ts                resumeReconnect、连接/新建会话文案
src/client/index.tsx                inject connection + startSession + recovery
src/client/DrawerOverlay.tsx        状态点、刷新、新建、右滑、content-visibility
src/client/ToolCard.tsx             失败默认展开 + 警示图标
src/client/Splash.tsx               冷/热计时
tools/verify-resume-reconnect.mjs
tools/verify-conn-dot.mjs
tools/verify-splash-warm.mjs
tools/verify-drawer-windowing.mjs
tools/verify-drawer-new-session.mjs
tools/verify-drawer-swipe.mjs
tools/verify-toolcard-fail-open.mjs
tools/verify-drawer-refresh.mjs
```

---

## 8. 仍待做

- P2-9 拆分 `DrawerOverlay.tsx`（约 1080 行）  
- P2-11 README 与现状对齐  
- 真机键盘根治（原生 APK）  
- 无单元测试 / CI  

**手机刷新即可用后半场全部改动。**
