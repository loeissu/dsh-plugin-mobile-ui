# 抽屉接管 `sidebar`：为什么它需要改 profile 配置

本文件记录一个**架构性约束**。它决定了「把常驻的 56px 图标栏改成滑出式抽屉」这件事能不能做、以及代价是什么。

---

## 结论

**插件无法单独接管 `sidebar`。** 必须在 profile 的 `cordis.patch.yml` 里把 DSH 自带的 `ui-sidebar` 停掉：

```yaml
- id: ui-sidebar
  disabled: true
```

这是对用户 profile 的**侵入式改动**，因此 `FEATURES.replaceSidebar` 默认 `false`。

---

## 为什么

`sidebar` 是 `single`/`root` 插槽。按插槽文档的说法，「已占用的 `single` 是替换点」，读起来像是注册即替换。**但运行时的约束比这句话严格两层**：

### 第一层：同优先级注册直接报错

在 priority 0 注册时（实测）：

```
Failed to load plugins
@deepseek-ai/dsh-client-ui-sidebar
failed to apply loader entry (@deepseek-ai/dsh-client-ui-sidebar):
single slot "sidebar" already has a registration at priority 0 (registered by Z8)
— register at a different priority to shadow it (lowest renders)
```

修法是注册到**更低**的 priority（`SHADOW_PRIORITY = -100`）。这与 `keyed` 插槽（`tool.call.toolview`）是同一个规则 —— 一个 cell 每个优先级只接受一个 entry，较低者渲染。

### 第二层：子插槽声明冲突（真正的阻塞）

优先级修好之后，换成另一个错误：

```
Failed to load plugins
failed to apply loader entry (@deepseek-ai/dsh-client-ui-sidebar):
slot "sidebar.brand.mark" is already declared (by an entry in "sidebar" (Z8))
```

**一个插槽只能有一个声明者。** 抽屉要重新声明 ui-sidebar 拥有的 6 个席位（`sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.workspaces`、`sidebar.panellist`、`sidebar.settings`、`sidebar.footer.action`），而只要 ui-sidebar 还挂载着，它就会声明同样这 6 个 —— 声明冲突。

**提高优先级解决不了这一层**：优先级只影响 cell 竞争，不影响「谁声明了这个 key」。必须让 ui-sidebar 不再挂载。

### 失败的后果是全局的

两次失败都不是「侧栏坏了」，而是：

```
Failed to load plugins
```

整个应用只渲染 DSH 的报错启动卡片，**什么都用不了**。在手机上这意味着 App 打不开。

---

## 代价与收益

停掉 `ui-sidebar` 意味着：

| 影响 | 说明 |
|---|---|
| 必须自己渲染全部 6 个席位 | `Drawer.tsx` 已经做到，实测 6 个 `data-slot` outlet 全部出现 |
| 失去 ui-sidebar 的自有行为 | 例如会话分组、搜索、右键菜单等它内部实现的逻辑 |
| profile 配置被改动 | 用户升级 dsh-tether 或 DSH 时，这条 patch 需要保留 |
| 两处都要对 | 插件开 `replaceSidebar` **且** profile 停 `ui-sidebar`；只做一半就是「Failed to load plugins」 |

---

## 验证方式

`tools/verify-drawer.mjs` 针对**运行实例**检查功能而非外观：

1. 抽屉挂载并占据了 sidebar outlet（ui-sidebar 确实被替换）
2. 6 个声明席位全部渲染出内容
3. 设置入口仍能打开设置弹窗 ← **最关键**：这一条失败就等于用户失去设置
4. 抽屉自己的开关能展开列

在一个隔离 profile（`scratchui`，端口 3099）实测结果：

```
PASS  drawer mounted into the sidebar slot
PASS  the drawer occupies the sidebar outlet (ui-sidebar replaced)
PASS  all six declared seats rendered
      outlets: sidebar.brand.mark, sidebar.brand.name, sidebar.workspaces,
               sidebar.workspaces.directoryFlow, sidebar.panellist,
               sidebar.footer.action, sidebar.settings, settings.trigger
PASS  drawer has its own expand toggle
PASS  settings dialog opens from the drawer
PASS  no page exceptions with the drawer mounted
RESULT: the sidebar takeover preserves every entry point
```

展开后的几何：`drawerW 279`、`drawerH 915`、`frameCols "280px 132px 0px"` —— frame 确实分配了 280px。

---

## 仍需在真机确认的视觉问题

CDP 截图暴露了几处，**功能正常但排版不够好**：

1. **收起态标签竖排**：56px 窄栏里「我的电脑」被折成「我的 / 电脑」
2. **空状态没有说明**：无工作区/无会话时只剩标题，看起来像坏了
3. **不是真正的浮层抽屉**：当前是推挤布局（frame 分配 280px），不是覆盖在内容之上；若要浮层效果需要 CSS 定位 + 遮罩，而列宽仍由 frame 控制
4. **未在真机验证**：触控命中区、滑动手势都没测

---

## 如果要启用

1. profile 的 `cordis.patch.yml` 加：
   ```yaml
   - id: ui-sidebar
     disabled: true
   ```
2. 插件 `src/client/config.ts` 里 `replaceSidebar: true`
3. `npm run bundle`，重启 dsh web
4. **立刻确认**：能打开设置、能切换工作区、会话列表在
5. 任一出问题：把 `replaceSidebar` 改回 `false` 重新构建 —— 这是持久性修复，不是临时绕过

**回滚只需改插件配置**：ui-sidebar 在 profile 里保持 `disabled: true` 时，插件关掉 `replaceSidebar` 会导致 sidebar 空着（没有声明者），所以两处必须一起改回来。
