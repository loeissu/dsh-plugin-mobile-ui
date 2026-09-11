# 浮层抽屉方案 · 第一步验证结果

**日期**：2026-09-11
**环境**：隔离 profile `scratchui`，端口 3099，DSH `0.1.5-rc.1`
**方法**：CDP 对运行实例注入 CSS 并测量 + 截图（只读，不改文件）

---

## 结论：可行，但有一个必须处理的陷阱

**CSS 隐藏原生 sidebar 是可行的方案** —— 不需要停用 `ui-sidebar`，不需要动 `sidebar` 插槽，因此没有「Failed to load plugins」的全局风险。

**但只写 `display: none` 会静默出错。** 必须同时覆盖 frame 的网格模板并把会话列钉回第 1 列。

---

## 实测数据

### 阶段 1 · 基线（原生 sidebar，展开态）

```
frame 网格模板 : 280px 132px 0px
会话列宽       : 132px   ← 侧栏展开时被挤到很窄
```

### 阶段 2 · 只隐藏 sidebar（模板未动）

```
frame 网格模板 : 280px 132px 0px   ← 轨道仍被保留
会话列宽       : 280px              ← 掉进了侧栏的轨道
```

**这是关键发现。** `display: none` 把元素移出了网格流，但**网格模板仍然保留三列**，于是自动排布塌陷：

- 会话列（第二个 grid item）落进了第 1 轨道（280px）
- 空的右栏落进了第 2 轨道
- 第 3 轨道（0px）空着

视觉结果：会话区右边留一条空带，内容被挤在左侧。截图 `02-hidden-no-override.png` 里表格换行严重、顶栏标题被截断成 `h.，`。

**如果只做这一步就上线，用户会看到一个明显错位的界面。**

### 阶段 3 · 隐藏 + 覆盖模板

```css
[class*="_sidebarCol"] { display: none !important; }
[class*="_frame"] {
  grid-template-columns: minmax(0, 1fr) 0px !important;
}
[class*="_frame"] > [class*="centerCol"]  { grid-column: 1 !important; }
[class*="_frame"] > [class*="rightbarCol"] { grid-column: 2 !important; }
```

```
frame 网格模板 : 412px 0px
会话列宽       : 412px   ← 满宽，与视口一致
```

截图 `03-hidden-with-override.png` 确认：表格正常三列展开、顶栏完整、内容占满。

---

## 三点必须写进实现的注意事项

### 1. 模板覆盖不可省略

`display: none` 单独使用会造成**静默的布局塌陷** —— 没有报错，没有异常，只是显示不对。这类问题在真机上很难归因，所以必须与模板覆盖捆绑。

### 2. 列号必须显式钉住

会话列和右栏列原本依赖自动排布（`grid-column: auto`）。一旦侧栏列被移出流，自动排布的位置就全变了。所以两列都要显式指定列号，不能指望默认行为。

### 3. `[class*="_frame"]` 选择器的范围问题

这个选择器在 DSH 里有**多个匹配**（`ui-chat`、`ui-user-questions`、`ui-attachment`、`ui-subagent`、`ui-sidebar-documentpreview` 里都有 `*_frame`）。当前写法会误伤它们。

实现时必须收窄 —— 例如用 `[data-slot="root"] > [class*="_frame"]` 或带 `data-rightbar-col` 属性选择器限定到 AppFrame。**这是第一步没有解决、留待第二步处理的**。

---

## 第二步的输入

已确认可行，可以进入浮层抽屉实现。需要处理：

1. 上述选择器收窄
2. 浮层放在 `shell.overlay`（`list`/`root`，加法式，不影响其他插件）
3. `pointer-events: auto` 显式确认（该层默认点击穿透）
4. 关闭后必须**真正卸载**，不能只设 `opacity: 0`

**未验证**：真机触控、滑动手势、键盘弹出时的表现。

---

## 复现方式

```powershell
# 启动隔离实例
dsh --profile scratchui --port 3099 --no-open

# 数值探测（三个阶段 + 恢复检查）
node tools/probe-hide-sidebar.mjs "http://127.0.0.1:3099/?token=<TOKEN>" --cdp http://127.0.0.1:9222

# 截图存证
node tools/shoot-hide-sidebar.mjs "http://127.0.0.1:3099/?token=<TOKEN>" ./shots --cdp http://127.0.0.1:9222
```
