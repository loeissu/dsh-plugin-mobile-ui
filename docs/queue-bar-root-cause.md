# 排队栏被压缩 —— 根因确认：dsh-tether 的过度选择器

**日期**：2026-09-11
**现象**：手机端 agent 运行中，输入框上方的「待发送」排队消息被压成一条细缝。
**状态**：**根因确认，已用反制规则修复**。根治需要改 dsh-tether。

---

## 1. 根因

**不是 DSH 的 bug，也不是本插件的 bug —— 是 dsh-tether 注入的窄屏样式选择器过宽。**

tether 注入的样式里有：

```css
[class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap !important; }
[class*="rowText"] { flex: 1 1 100% !important; }
```

`_row` 是 **CSS Module 的局部名后缀**。tether 注释里说明它**故意**匹配局部名（因为只有 hash 前缀会随构建变化），但这个后缀出现在很多 DSH 包里，所以这条规则的作用范围**远远超出了它本来针对的设置对话框**。

**实测：这条规则在当前 UI 里命中 26 个元素。**

### 它怎么弄坏排队栏

排队行 `li._7yHdaG_row` 被 DSH 设计成**单行 flex**：文本 + 编辑按钮 + 删除按钮并排。

被 tether 强制 `flex-wrap: wrap` 后，三个子元素**折成三行**，内容需要 **86px**；而它的滚动父容器 `ul._7yHdaG_list` 是 **固定 36px + `overflow: auto`** → **内容被裁掉 50px，只剩一条细缝**。

---

## 2. A/B 确认（只切换 tether 样式表）

```
              flex-wrap   子元素 top          内容高  盒子高  被裁
有 tether     wrap        756, 780, 810       86      36     ✓
无 tether     nowrap      763, 760, 756       36      36     ✗
```

**只有 tether 样式表这一个变量，`flex-wrap` 和裁剪状态就随之改变。** 复现：`tools/verify-tether-queue.mjs`

---

## 3. 修法：范围极窄的反制规则

```css
@media (max-width: 768px) {
  [data-slot="conversation.input.dock"] [class*="_row"]:not([class*="rowText"]) {
    flex-wrap: nowrap !important;
  }
}
```

**特异性竞争**：本选择器 (0,3,0) 胜过 tether 的 (0,2,0)，所以**不依赖注入顺序**。

### 为什么选择器必须这么窄

**这是我差点犯的错。** 我原本想对所有 `_row` 强制 `nowrap`。范围探测救了我：

```
                有 tether              无 tether           结论
[0] _7yHdaG_row  wrap  (3行,被裁)  →   nowrap  (1行)      ← tether 改坏了
[1] uV2eYG_row   wrap              →   wrap               ← DSH 本来就想要 wrap！
```

**composer 里还有第二个 `_row`（权限/模型那行），它在有无 tether 时都是 `wrap`** —— 那是 DSH 的本意，强制 `nowrap` 会把它弄坏。

所以反制规则**限定在排队栏的 slot 内**。验证同时断言两件事：排队行修好 **且** 其他行不受影响。复现：`tools/probe-row-scope.mjs`

---

## 4. 验证（5/5）

```
tether present: true
compat stylesheet: true
[dock]  _7yHdaG_row   wrap=nowrap  h=36  lines=1  clipped=false
[other] uV2eYG_row    wrap=wrap    h=42  lines=1  clipped=false

PASS  tether stylesheet is active in this environment
PASS  the queue row is not force-wrapped            nowrap
PASS  the queue row is no longer clipped            h=36 clipped=false
PASS  the queue row lays out on one line            1 line(s)
PASS  other composer rows keep their own wrap behaviour   uV2eYG_row=wrap
```

复现：`tools/verify-tether-compat.mjs`（**必须在装了 tether 的环境跑，3099 隔离 profile 没有 tether，跑不出结果**）

---

## 5. 这是权宜之计，不是根治

**缺陷在 tether**：它的选择器本该收窄到它针对的设置对话框。本插件的反制规则只是让界面在此期间可用。

正确的上游修法（建议反馈给 tether）：

```css
/* 不要匹配裸 _row，加上 tether 自己的作用域 */
[data-dsh-tether] [class*="_row"]:not([class*="rowText"]) { flex-wrap: wrap; }
```

**`FEATURES.tetherCompat` 开关存在的意义**：tether 修好后把这个开关关掉即可，不需要删代码。

---

## 6. 方法论教训

**这次能定位，靠的是两件之前没做的事：**

1. **在真实环境测**（3080，装了 tether、有真实排队消息），而不是隔离 profile。之前三轮失败全是因为 3099 既没有 tether 也没有排队消息 —— **那个盲区已经藏过一次真 bug（抽屉 CSS 冲突）**。

2. **用 CDP 的 CSS 域直接问"哪些规则作用在这个元素上"**（`CSS.getMatchedStylesForNode`），而不是从测量结果反推。直接列出了选择器、来源和声明值。

**以及一次差点犯的错**：A/B 只证明"tether 改了这一行"，**不证明"所有 `_row` 都该 nowrap"**。范围探测（对比每个 `_row` 的 before/after）才排除了误伤。

---

## 7. 仍未解决

**「待发送栏压缩」修了，但截图里还有另一个问题**：

> 在手机端有待发送内容时候 输入栏不会上弹会在原地

这是**排队消息的文本内容**（用户排队的一条消息），描述的是**键盘弹出时输入栏不上移** —— 也就是 `docs/keyboard-occlusion.md` 里那个问题。**那个仍未在真机验证过。**
