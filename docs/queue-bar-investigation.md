# 排队栏被压缩 · 调查记录（未定论）

**日期**：2026-09-11
**现象**：手机上 agent 运行中，输入框上方的「待发送」排队消息栏被压缩到几乎看不见。
**状态**：**未复现，未定论**。已排除若干嫌疑，剩余怀疑需要真机信息确认。

---

## 1. 已排除：键盘修复导致 frame 变矮

**假设**：`visualViewport` 与 `innerHeight` 在 edge-to-edge 下有稳定差值，误判成键盘 → frame 永久压矮 → 输入框区被 flex 压缩。

**测量否定**。逐级压低 frame（通过键盘修复写入的同一个变量）：

```
frame=915  composerCard=128  centre=915
frame=850  composerCard=128  centre=850
frame=700  composerCard=128  centre=700
frame=560  composerCard=128  centre=560
frame=420  composerCard=128  centre=420
frame=300  composerCard=128  centre=300   ← 纹丝不动
```

**输入框卡片高度完全不随 frame 变化。** 原因是对话区是 `flex: 1 1 0%`（flex-basis 为 0），它吸收了全部空间变化，其他项不受影响。

复现：`tools/probe-composer-compression.mjs`

---

## 2. 已排除：`composerStack` 的 `flex-shrink: 1` 被触发

**测量发现** `wSkVaW_composerStack` 确实是 `flex-shrink: 1`（有被压缩的资格）。

**于是做了针对性实验**：往 stack 里塞一个 90px 的伪排队项，再把 frame 压到 340px：

```
frame=560  stackH=232  fakeH=90  squeezed=false  conv=484
frame=420  stackH=232  fakeH=90  squeezed=false  conv=344
frame=340  stackH=232  fakeH=90  squeezed=false  conv=264
```

**stack 高度恒为 232，`squeezed` 始终 false** —— 内容从未超出容器。

（顺带验证 `flex-shrink: 0` 的效果：无差异。因为对话区 flex-basis 为 0，压缩根本没轮到 composer。）

复现：`tools/probe-composer-squeeze.mjs`

---

## 3. 已排除：本插件的 CSS 命中输入框

本插件对 frame 只做两件事：

```css
/* viewport.ts */
[data-slot="root"] > [class*="_frame"] {
  height: var(--dsh-mobile-vv-height, 100%) !important;
  top: var(--dsh-mobile-vv-top, 0px) !important;
}
/* DrawerOverlay.tsx */
grid-template-columns: minmax(0, 1fr) 0px !important;
grid-column: 1 / 2（centerCol / rightbarCol）
```

其余全部以 `.dsh-mobile-drawer-*` 前缀限定。**没有任何规则指向 composer / queue / input。**

---

## 4. 发现的真实问题（但未确认与此现象相关）

### 4.1 tether 的 `_row` 规则命中 26 个 DSH 元素

tether 注入的窄屏样式里有：

```css
[class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
[class*="rowText"] { flex: 1 1 100% !important; }
```

实测注入后，一个我故意起名 `probe_row` / `probe_rowText` 的元素：

```
probe_rowText : flex: "1 1 100%"   ← 被强制撑满整行
probe_row     : flexWrap: "wrap"   ← 兄弟元素被迫换行
```

**规则确实生效且范围很广**（`_row` 全页命中 **26 个** DSH 元素）。但：

- `rowText` 命中 **0 个** DSH 元素（当前页面）
- 命中的 `_row` 元素多在思考块等处，**不在 composer 内**

所以这条规则**理论上危险，但当前未证实命中排队栏**。

### 4.2 排队栏的位置已定位

```
conversation.composer.dock  →  子元素 bOPqQW_root   （QueueDock，空时高 0）
conversation.input.dock     →  空
```

---

## 5. 为什么没复现

**环境中没有排队消息。** 排队栏只在 agent 运行中且有消息排队时才渲染（`conversation.composer.dock` 的 `bOPqQW_root` 在空态高度为 0）。要复现需要真实触发一次排队，本机测试环境没有做。

**另一个结构性盲区**：3099 隔离 profile **没有安装 tether**，所以 tether 注入的 CSS 全部缺席。这与之前发现的抽屉 CSS 冲突是同一个盲区 —— 那次的教训已经证明，只在隔离环境测会漏掉真机上的问题。

---

## 6. 下一步需要的信息

**最有价值的三个问题**（任一即可缩小范围）：

1. **只在有排队消息时出现，还是任何时候都这样？**
   —— 若是后者，与排队栏无关，是输入框区整体问题。
2. **抽屉关着时也这样吗？**
   —— 若是，与浮层无关。
3. **键盘收起时也这样吗？**
   —— 若是，与键盘适配无关。

**可执行的二分法**：本插件有 `FEATURES.keyboardFit` 开关。我可以构建一个关掉它的版本（3080 是每次请求从磁盘读 `lib/client.js`，**不需要重启服务**，你刷新页面即可），你对比一下是否还有此现象。这能一次性确认或排除键盘适配。

---

## 7. 未做的（避免无依据地改动）

**没有**加 `flex-shrink: 0` 之类的"保护性" CSS。理由：在 frame 极矮时（键盘全开），不可压缩的 composer 会**溢出被 frame 的 `overflow: hidden` 裁掉**，可能比现在更糟。在没有复现的前提下改这个，是拿一个未知问题换一个已知风险。
