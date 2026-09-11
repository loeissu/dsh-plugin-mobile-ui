# 抽屉滚动 · 触摸问题调查

**日期**：2026-09-11
**现象**：手机上抽屉「没有滚动效果」。
**状态**：**找到一个真实缺陷并修复**；触摸滚动的最终确认**在 CDP 里无法完成**，需真机。

---

## 1. 已修复：吸附标签吞掉触摸事件

上一轮为了「文字在上方滚动」加了 `position: sticky` 的分组标签。它**有背景色、覆盖在滚动区上方、位于 z-index: 1** —— 于是成为触摸点上最顶层的元素，**把拖拽手势吃掉了**。

实测证据（`elementFromPoint` 打在滚动区中心）：

```
修复前: hitCls = "dsh-mobile-drawer-label"   ← 命中标签，不是内容
修复后: hitCls = ""                           ← 命中内容
```

**修法**：给标签加 `pointer-events: none`。

```css
.dsh-mobile-drawer-label {
  position: sticky;
  top: 0;
  z-index: 1;
  pointer-events: none;   /* ← 关键：否则标签拦截触摸 */
  background: ...;
}
```

**为什么之前没发现**：我此前只用**程序化** `scrollTop` 验证滚动（`scrollTop = 212` 成功），那证明的是「容器能滚」，**不能证明「手指能滚」**。这两者之间隔着 `pointer-events`、`touch-action`、`overscroll-behavior` 和点击穿透层。

---

## 2. 无法在 CDP 里完成的部分（诚实记录）

**没能用 CDP 证明触摸拖拽现在可用了。** 三次尝试都不成立，原因各不相同：

| 方法 | 结果 | 为什么不成立 |
|---|---|---|
| `Input.synthesizeScrollGesture` | `scrollTop` 始终 0 | headless 下行为不可信 |
| 手写 `TouchEvent` 序列 | `scrollTop` 始终 0 | 合成事件**不触发浏览器原生滚动**，方法本身无效 |
| `Input.dispatchTouchEvent`（真实输入通道） | 控制组也失败 | **抽屉面板 `x = -149`** —— 收起态的 `transform: translateX(-100%)` 让面板在视口外，触摸点落在屏幕外 |

**关键教训**：第三次尝试我特意加了"控制组"（先在一个已知可滚的容器上验证方法有效），结果**控制组失败** —— 这正确地阻止了我据此得出"抽屉坏了"的错误结论。

控制组选中的容器是 `dsh-mobile-drawer-body` 本身（`x=-149`），因为此时它是页面上唯一有溢出的元素。

**结论：触摸滚动需要真机确认。**

---

## 3. 附带确认的事实

### 3.1 深色模式正常

在 `prefers-color-scheme: dark` 下实测：

```
panelBg  = rgb(35, 35, 36)      ← 面板背景正确
labelBg  = rgb(35, 35, 36)      ← 标签背景与面板一致（吸附时不透出内容）
fadeShown = true                 ← 滚动提示正常
overscroll = "contain"
```

**本插件不写死任何颜色**，全部来自 DSH 的 `--dsw-alias-*`，所以深浅色自动跟随。深色截图确认渲染正常。

### 3.2 输入框区在深色下看起来正常

```
cardH = 114    cardBottom = 367    viewportH = 560
belowViewport = false
```

截图确认：圆角、深色卡片、按钮齐全。`bg: transparent` / `radius: 0px` 量到的是外层 wrapper，实际视觉卡片在其内部。

**我无法复现「打字栏怪怪的」。** 可能与上面的触摸问题同源（标签吃掉交互），也可能是别的 —— 需要真机截图或更具体的描述。

---

## 4. 顺带发现的构建陷阱

在 CSS-in-TS 的模板字符串里，注释中写反引号会**提前终止模板字符串**：

```ts
const CSS = `
  /* 不要在这里写 \`这样\` 的反引号 */
`
```

报错是 `Expected a semicolon`，位置指向下一行，**很容易误判成别处的语法错误**。写 CSS 注释时避免反引号，或用 `\`` 转义。

---

## 5. 需要真机确认

1. **抽屉能否用手指滚动** —— 这是本次修复的目标
2. **吸附标签是否仍正确**（`pointer-events: none` 不应影响吸附本身）
3. **「打字栏怪怪的」的具体表现** —— 若能描述（位置错位？高度异常？点了没反应？），可直接定位
