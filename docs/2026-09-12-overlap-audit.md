# 2026-09-12 · UI 重叠排查

**方法**：3080 真实环境（含 tether）+ Chrome CDP 412×915 + `tools/probe-overlap-audit.mjs`
**证据**：真实 CDP 点击（非合成事件）+ `elementsFromPoint` 堆叠取证 + 三态截图（`shots-overlap/`）
**结果**：**10/10 通过 —— 审计范围内没有发现会偷点击或互相遮挡的重叠**

---

## 层叠地图（窄屏）

```
z 2147483000  启动页 Splash（portal 到 body；淡出即卸载；pointer-events 仅可见期开启）
z 2147482000  抽屉根 DrawerOverlay（portal 到 body；关闭时整根穿透）
  ├─ 触发按钮 ☰（常显，opt-in pointer-events）
  └─ scrim + 面板（仅 data-open=true 时 opt-in）
z 2147481000  键盘诊断徽章（默认关；刻意低于抽屉，§1.1 的教训）
───────────── 以下为宿主 ─────────────
pI_x6G_overlayLayer / VOzbGW_overlay+mask   壳的浮层 chrome，全屏但 pointer-events:none，不拦截
设置弹层 dialog（停靠侧栏内，弹层 opt-in pointer-events）
```

## 逐态断言

| 态 | 检查 | 结果 |
|---|---|---|
| A 关闭 | ☰ 中心命中是按钮自身（SVG 子元素，冒泡可达） | ✅ |
| A 关闭 | 无外来表面遮挡 ☰（pe:none 的壳层除外——它们不拦截） | ✅ |
| A 关闭 | 无横向溢出（scrollWidth − innerWidth = 0） | ✅ |
| B 打开 | 真实 CDP 点击 ☰ 能打开抽屉 | ✅ |
| B 打开 | 面板中心命中直达会话行（不是 chrome 层） | ✅ |
| B 打开 | 底部渐隐带不吞行点击（pointer-events:none 生效） | ✅ |
| B 打开 | 底部「设置」按钮可达 | ✅ |
| C 设置 | 弹层能打开 | ✅ |
| C 设置 | 弹层打开时 ☰ 被抑制（opacity 0 + pe none，`:has(_navCell)` 规则生效） | ✅ |
| C 设置 | 弹层标题自己吃命中（navTitle 在顶） | ✅ |

历史上修过的重叠（徽章挡 ☰、吸附标签吞滚动、tether 撑爆抽屉宽度）本轮全部复核未见复发。

## 复查中纠正的探针误报（不是产品缺陷）

1. `pI_x6G_overlayLayer` / `VOzbGW_overlay` / `VOzbGW_mask` 全屏覆盖 ☰ —— 但 `pointer-events: none`，物理上偷不到点击。
2. ☰ 中心栈顶是按钮**内部 SVG 图标** —— 命中冒泡到按钮，正常。
3. 探针跨运行状态残留（上一轮的设置弹层没关导致本轮抽屉"打不开"）—— 已给探针加「开跑先 reload、结束关弹层」。

## 残余风险（记录，非当前缺陷）

| 风险 | 说明 | 建议 |
|---|---|---|
| ☰ 抑制依赖单一类名 | `settings-chrome.ts` 用 `body:has(dialog [class*="_navCell"])` 检测设置弹层。上游若改名 `_navCell`，弹层打开时 ☰ 会重新浮在左上角，可能吃掉弹层左上角的点击 | 可放宽为 `body:has([role="dialog"])` 时隐藏 ☰——任何模态盖屏时 ☰ 都不该可点。一行改动，本轮未动（排查任务，不擅自扩权） |
| 非审计态 | 工具卡展开、会话进行中的排队栏、键盘弹出的抽屉未逐一做命中测试 | 需要时扩展 probe-overlap-audit.mjs 的状态机 |

## 复现

```bash
# 需 9222 有 Chrome 指向 3080（本仓库惯例）；token 见 dsh-web.log
node tools/probe-overlap-audit.mjs "<url>?token=..." shots-overlap
```
