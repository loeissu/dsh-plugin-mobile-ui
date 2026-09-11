# 浮层抽屉方案 · 第二步：最小骨架

**日期**：2026-09-11
**环境**：隔离 profile `scratchui`，端口 3099
**状态**：已完成并验证，**尚未推送到生产 profile**

---

## 交付内容

最小骨架，不含工作区/会话列表：

| 部件 | 实现 |
|---|---|
| 浮层容器 | `shell.overlay`（`list`/`root`），`id: mobile-ui-drawer`，`order: 20` |
| 悬浮触发按钮 | 左上角 `☰`，40×40，圆角 13px |
| 抽屉面板 | 左侧滑出，宽 80%（上限 320px），右侧圆角 30px |
| 遮罩 | `rgba(0,0,0,.45)`，点击关闭 |
| 关闭按钮 | 面板标题栏右侧 |

文件：`src/client/DrawerOverlay.tsx`

---

## 两个用户决定的落实

### 1. 只在窄屏注入 —— `@media (max-width: 768px)`

整个样式块（含隐藏原生 sidebar 的部分）都包在媒体查询里。实测验证：

```
手机宽度 412px :  sidebar display=none   frame 模板 412px 0px     会话列 412px
桌面宽度 1280px:  sidebar display=block  frame 模板 280px 992px 0px
```

桌面端完全不受影响 —— 调试时不会混淆「这是插件效果还是原生效果」。

### 2. 悬浮按钮，不用边缘滑动

**原因（真机硬约束）**：Android 10+ 的 gesture navigation 把「从左边缘右滑」保留给系统返回手势，WebView 收不到该事件。这是系统层拦截，页面无法认领。

所以入口是按钮，且它是隐藏原生图标栏后**唯一的入口**。

---

## `pointer-events` 的三个处理

`shell.overlay` 是可点击穿透层，每个表面都要显式 opt-in，而且**两个表面的处理方向相反**：

```css
.dsh-mobile-drawer-root      { pointer-events: none; }   /* 容器保持穿透 */
.dsh-mobile-drawer-trigger   { pointer-events: auto; }   /* 永久可点：唯一入口 */
.dsh-mobile-drawer-panel     { pointer-events: none; }   /* 关闭时穿透 */
[data-open='true'] .dsh-mobile-drawer-panel { pointer-events: auto; }
.dsh-mobile-drawer-scrim     { pointer-events: none; opacity: 0; }
[data-open='true'] .dsh-mobile-drawer-scrim { pointer-events: auto; opacity: 1; }
```

**关闭态必须真正穿透** —— 一个留在页面上、`pointer-events: auto` 的浮层会吞掉所有点击，表现和「应用卡死」完全一样。这与启动页是同一个陷阱。

---

## 实测结果

```
PASS  drawer overlay mounted into shell.overlay
PASS  native sidebar hidden at phone width            display=none
PASS  conversation filled the freed space             centre=412 viewport=412x915
PASS  floating trigger accepts taps
PASS  trigger is the topmost element at its own centre while closed
PASS  drawer starts closed
PASS  CLOSED drawer does not capture pointer events    panel pointer-events=none
PASS  CLOSED scrim does not capture pointer events     scrim pointer-events=none
PASS  a tap at the centre reaches the application      (insideOverlay=false)
PASS  trigger opened the drawer
PASS  OPEN panel accepts taps
PASS  OPEN scrim accepts taps (dismissable)
PASS  panel is 80% of the viewport                     321px (expected ~320px)
PASS  scrim is visible                                 opacity=1
PASS  scrim tap closed the drawer
PASS  panel returned to click-through after closing
PASS  taps reach the application again after closing   (insideOverlay=false)
PASS  close button closed the drawer
PASS  native sidebar is NOT hidden at desktop width    display=block
PASS  no page exceptions

RESULT: overlay drawer skeleton behaves correctly at phone and desktop widths
```

截图 `01-closed.png` 确认：原生 56px 图标栏消失，左上角是悬浮 `☰`，会话区占满全宽。
截图 `02-open.png` 确认：抽屉从左侧滑出，遮罩压暗后方内容（浮层而非推挤布局）。

---

## 回退路径

**隐藏 sidebar 与悬浮按钮是两件独立的事**，可以分别回退：

| 想要的效果 | 做法 |
|---|---|
| 完全关闭这个功能 | `FEATURES.drawerOverlay = false` → 重新构建 |
| 只恢复原生图标栏，保留抽屉代码 | 删掉 `DrawerOverlay.tsx` 里 `@media` 块中的 sidebar 隐藏规则 |
| 抽屉不显示但什么都不坏 | 同上；原生 56px 栏回来，抽屉不出现 |

**关键**：这条路的失败模式是「图标栏回来了」，**不是「应用打不开」** —— 与之前 `sidebar` 接管路线（`Failed to load plugins`）有本质区别。

---

## 未验证 / 待办

- **真机触控**：`elementFromPoint` 验证了命中测试，但手指触控的实际体验（按钮热区、滑出手感）未测
- **键盘弹出**：抽屉打开时软键盘的行为未测
- **列表内容**（第三步）：工作区与会话列表尚未移植。**数据来源待确认** —— 原 `Drawer.tsx` 依赖 `renderSlot` 渲染 ui-sidebar 的席位，浮层版本拿不到这些席位，需要自己从 store 或 API 取
- **顶栏与输入框**（第四步）：未开始

---

## 复现方式

```powershell
dsh --profile scratchui --port 3099 --no-open

node tools/verify-drawer-overlay.mjs "http://127.0.0.1:3099/?token=<TOKEN>" ./shots --cdp http://127.0.0.1:9222
```

验证脚本会依次断言：关闭态穿透、触发按钮命中测试、开启、遮罩关闭、关闭按钮、桌面宽度不受影响、无异常。
