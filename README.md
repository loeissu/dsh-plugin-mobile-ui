# dsh-plugin-mobile-ui

把 DeepSeek Harness 的 Web 界面改造成**手机能用**的界面。以官方 slot 客户端插件交付：不改 DSH 源码、不 fork dsh-tether、不替换 `sidebar` 插槽。

状态：手机端可用（2026-09-12，真机截图复核 + CDP 实测）。竖屏 320–430px 与横屏 915×412 均已验证；桌面（鼠标优先）不受影响。

```
手机连电脑交给 dsh-plugin-tether；本插件只负责「在手机上好不好用」。
```

---

## 装

### 方式一：从发布包安装（使用者推荐）

到 [Releases](https://github.com/loeissu/dsh-plugin-mobile-ui/releases) 下载 `dsh-plugin-mobile-ui-<版本>.tgz`，
**放在一个不会被清理的固定目录**（**不要放 `%TEMP%`**），然后：

```sh
dsh plugin --profile web add <那个 tgz 的完整路径>
```

发布包**已自带构建产物 `lib/`**，不需要自己构建。

> ⚠️ **不要删掉那个 tgz。** 它的路径会被写进 profile 的 `package.json`（`file:` 引用），
> 而 pnpm 每次操作都会重新解析整棵依赖树 —— 文件一旦消失，**之后装 / 卸载任何插件都会失败**：
>
> ```
> Could not install from "…/dsh-plugin-mobile-ui-0.1.0.tgz" as it does not exist.
> ```
>
> 把文件放回**同一路径**即可恢复。运行时不受影响（已装好的插件照常工作）——
> 所以这个问题会在"下次装插件"时才暴露，尤其难查。

### 方式二：从源码安装（开发者推荐）

```sh
git clone https://github.com/loeissu/dsh-plugin-mobile-ui.git
cd dsh-plugin-mobile-ui
npm install
npm run bundle          # 必须：lib/ 不入版本库，没有产物装上去完全不生效
npm run verify          # 可选：离线校验产物是否符合 DSH 的 loader 契约
dsh plugin --profile web add .
```

然后**重启 `dsh web`**——插件在启动时被扫描，装完不重启不会生效，也不会报错。

确认：`dsh plugin --profile web list` 里能看到 `dsh-plugin-mobile-ui`。

## 改完怎么生效

```sh
npm run bundle          # 重新构建（含反引号预检）
```

**刷新手机页面即可**，不必重启服务：产物变更由 `dsh-client-hmr` 轮询后推给客户端（本仓库所有实机/模拟验证都是这么做的）。若你的 profile 没启用该插件，则需重启 `dsh web`。

## 手机上怎么用

| 想做什么 | 怎么做 |
|---|---|
| 打开导航 | 点顶栏最左的文字 **「导航」**（原来那里是 ☰） |
| 关掉导航 | 点遮罩 / 面板内**左滑 >72px** / 右上 × / Esc |
| 换工作区、开会话 | 抽屉里分组列表：**刚刚 / 今天 / 昨天 / 更早** |
| 新建会话 | 抽屉底部 **＋** |
| 打开主机设置 | 抽屉底部 **设置**（可以在设置页里**左右滑动**换分区） |
| 连接看起来卡住 | 抽屉底部 **刷新连接**：换掉 mux socket。若探针证明链路其实断了，按钮会变成 **重试**，并每 4s（一分钟后 15s）自动重试直到恢复（详见下） |
| 看连接状态 | 抽屉底部状态点：蓝=已连接 / 蓝脉冲=连接中 / 灰=未连接 / 深色圆环=链路已断 |
| 看工具输出 | 工具卡默认折叠；**失败卡自动展开** |
| 复制某条回答 | 消息下方的 **复制**：WebView 里 async 剪贴板常被拒，本插件接通宿主自己的兜底，因此真的能写进剪贴板（详见下） |
| 横屏 | 和竖屏同一套界面（抽屉、命中区、设置页都在） |

**为什么会有「重试」，以及为什么它不重新加载**：手机上页面的 origin 是 tether App 内的回环代理，app socket 的对端是**手机本机代理**而不是电脑。App 切后台后真正断掉的是代理背后的 P2P 隧道，而「刷新连接」换一条到本机代理的 socket 总是瞬间成功——状态回到已连接、点变蓝，数据却到不了电脑。所以点击后会实测一次链路（拉本页并要求响应来自电脑），确认断了才把按钮换成**重试**。

**不重新加载是被真机教出来的**：代理不在时 `location.reload()` 连文档都取不到，WebView 直接落到 Chrome 错误页（`net::ERR_SOCKET_NOT_CONNECTED`，实机截图报告），用户只能杀掉 App 重开。**"重试"不会有这个问题**：它只发一个请求，代理一恢复（tether 客户端重建隧道）就自动接上，页面从不离开。第三态期间每 4s 自动重试一次（持续一分钟后改为每 15s），点按钮也会立刻重试。

**为什么「复制」要额外修**：DSH 的复制助手写成 `if (async 剪贴板可用) { try … catch { return false } }`，**只有 async API 不存在时才会走它自己的 legacy 兜底**。Android WebView 里 async 剪贴板通常是"存在但被拒"，于是它直接返回失败，而调用方失败即静默返回 —— 点「复制」什么都不会发生。本插件包一层 `navigator.clipboard.writeText`：真 API 仍先试，**只在被拒时**走宿主本来就写好的 legacy 路径（离屏 textarea + `execCommand('copy')`）。桌面不受影响（桌面上的被拒是真错误，应当暴露）。

**同一次修复还收拾了提示残留**：复制成功后宿主会显示一个深色「复制成功」气泡，但触摸设备永远不会产生 `pointerleave`，这类 hover 提示会**永久停在输入框上方**（实机截图）。本插件在触摸交互后补发宿主本来就在监听的离开事件，提示显示约 1.2s 后自行消失；桌面照旧（鼠标移开即消失）。

## 开关

`src/client/config.ts` 的 `FEATURES`：

| 开关 | 默认 | 作用 |
|---|---|---|
| `splash` | `true` | 启动页（冷启动 700ms / 热启动 120ms，最长 4s） |
| `drawerOverlay` | `true` | 悬浮抽屉 = 唯一导航入口 |
| `settings` | `true` | 设置页「移动端」分区 **+** 宿主设置弹层的手机排版 |
| `toolCards` | `['pwsh','read','grep','edit','write']` | 工具卡；见下方「已知取舍」 |
| `keyboardFit` | `true` | 软键盘遮挡（`visualViewport`） |
| `tetherCompat` | `true` | 抵消 tether 注入样式带来的两处排版事故 |
| `typography` / `conversationChrome` / `settingsSwipe` | `true` | 字号字重 / 宿主会话控件命中区 / 设置页左右滑动 |
| `clipboardFallback` | `true` | WebView 里 async 剪贴板被拒时接通宿主的 legacy 兜底（否则点「复制」静默失败） |
| `tooltipDismiss` | `true` | 手机不残留 hover 提示（触摸没有 `pointerleave`，补发离开事件）；桌面不受影响 |
| `resumeReconnect` | `true` | 回到前台自动重连 |
| `keyboardDebug` / `replaceSidebar` | `false` | 诊断浮层 / 接管 sidebar（**后者与本项目硬约束冲突，勿开**） |

## 验证

```sh
npm run verify                                  # 离线：loader 契约 + 产物是否比源码旧
node tools/verify-render.mjs <url>              # 有浏览器时：逐项 CDP 断言
```

`<url>` 是带 token 的地址，形如 `http://127.0.0.1:3080/?token=<TOKEN>`（从 `dsh web` 的输出或 `H:\DSH\dsh-web.log` 里取）。

主要套件（`tools/`，共 33 个，全部通过；`tools/retired/` 里三个断言的是已放弃的设计，不参与）：

| 套件 | 保证什么 |
|---|---|
| `verify-render` / `verify-splash-warm` | 启动页渲染与冷热启动时长 |
| `verify-drawer-overlay` / `verify-coexistence` | 抽屉骨架；与 tether 注入样式共存时面板不被拉满 |
| `verify-drawer-open` / `verify-nav-tab-locale` | 「导航」入口；中英文标签下让位宽度都正确 |
| `verify-drawer-swipe` / `verify-touch-scroll` | 左滑关闭；面板在触摸下真的能滚 |
| `verify-drawer-list` / `-new-session` / `-settings` / `-refresh` / `-windowing` / `verify-conn-dot` | 面板内容与状态 |
| `verify-refresh-honesty` | 刷新连接换 socket；链路假活时改为「重试」且**不会导航**、恢复后自愈 |
| `verify-clipboard-fallback` | 「复制」在 async 剪贴板被拒时仍写入真剪贴板；健康与桌面路径不受影响 |
| `verify-tooltip-dismiss` | 手机不残留 hover 提示（期间确实出现过），桌面照常 |
| `verify-tap-targets` / `verify-conversation-touch` | 手机控件命中区 ≥44px |
| `verify-conversation-chrome` | 会话标题让位、底部指标行不裁字 |
| `verify-settings-chrome` | 设置弹层：标题行不压 tab 条、320–430px 五个 tab 不需横滚 |
| `verify-swipe-and-landscape` | 设置页左右滑动；横屏手机保留移动端表面 |
| `verify-keyboard-fit` / `verify-ime-refocus` / `verify-keyboard-focus-poll` | 键盘遮挡与输入法重新聚焦 |
| `verify-risk-dialog` / `verify-tether-compat` / `verify-tether-queue` | 宿主弹窗与 tether 的两处排版事故 |
| `verify-toolcards` / `verify-toolcard-fail-open` | 工具卡渲染；失败卡自动展开 |

## 已知取舍与限制

- **工具卡替换了 4 张官方卡**：`read/grep/edit/write` 是**替换式**（注册在更低优先级，宿主的原卡不再渲染），因此会失去官方的「在轨迹中查看」和点开文件。想要全部保留官方卡就把 `toolCards` 设为 `[]`（`pwsh` 是新增，不替换任何东西）。
- **键盘/输入法是 CDP 推断，不是真机实测**：`viewport.ts` 依据 `visualViewport` 工作，真机长按选择、输入法形态差异仍可能有出入。
- **长按选中/滚动冲突**只在 CDP 里验证过。
- 原生启动页（`docs/android-native-splash.md`）改动完整但**未应用**：需要 Android 侧构建环境（MSVC），当前仓库不含该产物。
- 没有 CI、没有单元测试：验证靠 `npm run verify` + 上表的 CDP 套件。

## 工作原理（一屏）

产物是**单个 IIFE**，通过 `window.__ModuleLoader__.load({ id, factory })` 注册，导出 `apply` / `inject`：

```ts
export const inject = ['slots', 'layout', 'uiWorkspace', 'connection']
```

四个服务都是**必需依赖**：任何一个缺失，插件整体不 apply（不是局部失效）。

注册的表面：

| 插槽 | 形式 | 内容 |
|---|---|---|
| `shell.overlay` | list | 启动页 |
| `shell.overlay` | list | 抽屉（「导航」入口 + 面板） |
| `settings.section` | list | 设置页「移动端」分区 |
| `tool.call.toolview` | keyed ×5 | 工具卡（见「已知取舍」） |
| `sidebar` | single | 接管式抽屉，**默认关闭** |

宿主自带界面的打磨（设置弹层排版、会话标题让位、命中区、tether 抵消规则）不注册插槽，而是**带标记注入样式表**（`<style data-plugin-css="dsh-mobile-ui/…">`）+ 少量运行时测量，全部按 `data-slot` 锚点与 CSS-Module 本地名**后缀**选择器限定范围，不碰哈希前缀。

## 目录

```
src/index.ts                 插件入口声明（5 行）
src/client/                  18 个模块，约 5.7k 行
  index.tsx                  apply()：注册表面 + 装配各模块
  config.ts                  FEATURES 开关 + zh/en 文案（两套字典键完全一致）
  theme.ts                   设计 token（全部取 DSH 的 --dsw-alias-*）、PHONE_MEDIA、injectStyles
  DrawerOverlay.tsx          抽屉：列表 / 新建 / 设置 / 刷新连接 / 状态点 / 左滑关闭 / 让位测量
  Splash.tsx                 Splash.tsx 启动页（冷热启动时长策略）
  Settings.tsx               设置页「移动端」分区
  ToolCard.tsx               工具卡（折叠、失败自动展开、输出截断）
  Drawer.tsx                 sidebar 接管式抽屉（默认关闭，禁止开启）
  viewport.ts                软键盘遮挡（visualViewport + 延迟回调池 + 完整释放）
  conversation-chrome.ts     宿主会话控件：命中区（横竖屏）+ 标题让位/指标行（仅窄屏）
  settings-chrome.ts         宿主设置弹层：窄屏排版 + 两种朝向的触控层
  settings-swipe.ts          设置页左右滑动换分区
  connection-recovery.ts     回到前台自动重连
  typography.ts              字号字重（窄屏）
  tether-compat.ts           抵消 tether 注入样式的两处事故
  keyboard-debug.ts          诊断浮层（默认关闭）
verify-bundle.mjs            离线 loader 契约校验 + 陈旧产物守卫
check-css-backticks.mjs      构建前预检：CSS 模板串里不许有反引号
tools/                       CDP 验收脚本（verify-*.mjs）与探针；retired/ 见其 README
docs/                        见 docs/README.md（现行 vs 历史分类）
```

## 文档

- **[docs/00-项目说明.md](docs/00-项目说明.md)** — **完整项目说明**：背景与硬约束、加载原理、功能全表、每个模块、设计 token、验证体系、上游缺陷反制、维护手册、被推翻的结论。
- **[docs/MOBILE-UI-GUIDE.md](docs/MOBILE-UI-GUIDE.md)** — 使用与维护指南（能力、token、开关、验证、键盘、横屏）。
- **[docs/2026-09-12-upgrade-and-maintenance.md](docs/2026-09-12-upgrade-and-maintenance.md)** — DSH / tether 升级影响面与检查清单。
- **[docs/README.md](docs/README.md)** — 全部文档的索引，标明哪些是**现行**、哪些是**历史记录**。

## 许可与声明

MIT。与 DeepSeek 官方无关，不使用其名称、标识或品牌资源；界面配色全部取自运行中 DSH 暴露的 `--dsw-alias-*` 语义 token，自身不带设计资产。本插件只往官方 slot 里追加内容，并对宿主自带界面做**限定范围**的排版/命中区打磨；不修改 DSH 源码，不 fork dsh-tether。
