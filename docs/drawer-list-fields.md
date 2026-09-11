# 抽屉列表 · 字段清单与数据来源

**日期**：2026-09-11
**用途**：第三步（工作区 + 会话列表）的字段依据。所有字段均从已安装包的 `.d.ts` 读出，附出处。

---

## 0. 前提：hook 可用性已实测确认

`useSessions` / `useWorkspaces` 都声明在 `GlobalStandardProps` 里，按 `docs/subsystems/slots.md` 的「every scope」覆盖 `root`，而 `shell.overlay` 正是 `root` scope。

**不看类型，实测**（读运行实例的 React fiber props）：

```
DrawerOverlay（本插件的 shell.overlay 组件）收到的 props：
  useSessions                    ✓
  useWorkspaces                  ✓
  useSessionPendingInteraction   ✓
  usePanelInfo                   ✓
  useResource                    ✓
```

对照组（`ui-workspace` 自己的 `SidebarRoot`，必然拿得到）返回同样几个 hook，说明探测方法没有看错节点。

**结论：不需要走 connection RPC，不需要自己处理分页/重连/状态同步。**

---

## 1. 概念校正：机器 ≠ 工作区

必须先说清楚，否则第三步会做错：

| | 原型里的「机器」 | DSH 的「工作区」 |
|---|---|---|
| 例子 | MacBook Pro / dev-server-01 | `H:\DSH`、`zexadev` |
| 语义 | **连接目标** —— 切换会断开当前 P2P、连另一台电脑 | **当前连接的那台电脑上的项目目录** |
| 归属 | dsh-tether 插件的状态 | DSH 的 Workspace Controller |

**在 `shell.overlay` 里拿不到 tether 的机器列表** —— 那是另一个插件的状态，插件之间不共享。所以抽屉顶部放的是**当前电脑的工作区列表**，不是多台电脑的列表。

这是 DSH 内能做的最接近原型的形态。

---

## 2. `SettingsSummary`… 更正：`SessionSummary`

**出处**：`dsh-api-session-controller/lib/types/client/sessions/service.d.ts:32`

| 字段 | 类型 | 用途 |
|---|---|---|
| `id` | `SessionId` | React key；点击目标 |
| `title` | `string?` | 持久标题，**宿主投影出来之前不存在** |
| `displayTitle` | `string` | **始终存在** —— 回退顺序：持久标题 → 项目 basename → 会话 id |
| `cwd` | `string?` | 会话工作目录。**若走 WorkspaceView 分组则不需要** |
| `parentId` | `SessionId?` | 子代理的父会话 |
| `origin` | `'subagent'?` | 粗粒度来源，用于**过滤掉子代理会话** |
| `running` | `boolean` | 状态点（运行中） |
| `completed` | `boolean?` | 完成但未打开 —— 原生侧栏的绿色「完成」提醒。缺省 = false |
| `blank` | `boolean` | 空日志位。新建会话会复用同工作区的空会话。**列表里应过滤掉** |
| `updatedAt` | `number` | **时间分组依据**（刚刚/今天/昨天/更早） |
| `projectionValues` | `Partial<SessionProjectionMap>?` | 宿主投影值 |

**列表渲染用 `displayTitle`，不要用 `title`** —— 后者可能还没投影出来。

---

## 3. `SessionListState`（`useSessions` 的整体快照）

**出处**：同上 `:61`

| 字段 | 类型 | 用途 |
|---|---|---|
| `ids` | `SessionId[]` | 宿主列表顺序 |
| `byId` | `Record<SessionId, SessionSummary>` | 按 id 查摘要 |
| `current` | `SessionId \| undefined` | **高亮当前会话** |
| `phase` | `SessionListPhase` | 加载/空状态（`empty-with-ready` = 真的没有会话） |
| `subagentsByParent` | `Record<...>` | 子代理目录，列表不需要 |
| `jobsBySession` | `Record<SessionId, readonly JobView[]>` | 每个会话可见的后台任务，可用于显示任务数 |
| `currentAddress` | `SubagentAddress \| undefined` | 子代理路由地址，列表不需要 |

---

## 4. `WorkspaceSnapshot`（`useWorkspaces` 的整体快照）

**出处**：`dsh-api-workspace-controller/lib/types/client/model.d.ts:9`

| 字段 | 类型 | 用途 |
|---|---|---|
| `items` | `readonly WorkspaceView[]` | **工作区列表本体** |
| `archivedSessionIds` | `WorkspaceArchiveValue['archivedSessionIds']` | **已归档会话，需过滤掉** |
| `state` | `'idle' \| 'loading' \| 'error'` | 加载态 |
| `phase` | `WorkspaceListPhase` | 列表阶段 |
| `error` | `RemoteFailure \| null` | 错误信息 |

---

## 5. `WorkspaceView`（单个工作区，客户端投影）

**出处**：`dsh-api-workspace-controller/lib/types/types.d.ts:12`

| 字段 | 类型 | 用途 |
|---|---|---|
| `workspaceId` | `WorkspaceId` | React key；点击时传给 `openWorkspace` |
| `path` | `string` | 规范目录路径（`fs.realpath` 解析过）—— 可作为次要文字显示 |
| `title` | `string` | **用户可见标题**，默认是路径最后一段 |
| `sessionIds` | `readonly SessionId[]` | **★ 分组依据** —— 该工作区名下的会话，手工顺序 |
| `createdAt` / `updatedAt` | `string` | ISO-8601 |

### ★ 这是最重要的发现

`sessionIds` 意味着**分组是直接关联，不需要拿 `cwd` 去和工作区 `path` 做字符串匹配**。

`SessionSummary` 里**没有** `workspaceId` 字段——如果只查会话摘要，就得靠 `cwd` 匹配路径，那是一堆边界情况（大小写、斜杠方向、符号链接、尾斜杠）。`WorkspaceView.sessionIds` 把这个完全绕开了。

分组逻辑因此是：

```
for each workspace in useWorkspaces(s => s.items):
    for each sessionId in workspace.sessionIds:
        summary = byId[sessionId]     // 从 useSessions 查
        skip if summary 缺失 / origin === 'subagent' / blank / 已归档
```

---

## 6. 导航 API（点击行为）

**出处**：`dsh-client-ui-workspace/lib/types/client/navigation.d.ts:8`（`ctx.uiWorkspace`，Cordis 服务）

| 方法 | 签名 | 用途 |
|---|---|---|
| `openSession` | `(sessionId: SessionId) => void` | **点击会话** —— 选中并显示其对话 |
| `openWorkspace` | `(workspaceId, beforeOpen?) => Promise<void>` | 连接工作区并打开其会话 |
| `startSession` | `(workspaceId?) => void` | 新建会话并跳转 |
| `archiveSession` | `(sessionId) => Promise<void>` | 归档 |

**组件不能直接调 `ctx`** —— 必须经注册的 `inject` face 传进去：

```ts
ctx.slots.register({
  name: 'shell.overlay',
  inject: () => ({
    openSession: (id) => { ctx.uiWorkspace.openSession(id) },
    ...
  }),
}, DrawerOverlay)
```

需要在 `export const inject` 里加上 `uiWorkspace`。

---

## 7. 实现要点

1. **选择器只返回稳定引用**，派生数据用 `useMemo` 算 —— 符合 DSH 的「Derived data is a pure function over framework-hook data (`useMemo`), never its own subscription」。
   ```ts
   const items = useWorkspaces(s => s.items)        // 数组引用，稳定
   const byId = useSessions(s => s.byId)            // 记录引用，稳定
   const current = useSessions(s => s.current)      // 原始值
   const grouped = useMemo(() => ..., [items, byId, archived])
   ```
   不要在 selector 里返回新构造的数组 —— 每次新引用会导致重渲染循环。

2. **过滤三件事**：`origin === 'subagent'`、`blank === true`、`archivedSessionIds` 包含的。

3. **时间分组**用 `updatedAt`（毫秒时间戳）：刚刚 / 今天 / 昨天 / 更早。

4. **空状态要区分**：`phase` 表示「正在加载」还是「真的没有」，两者的文案不同。

5. **`displayTitle` 而非 `title`**。

---

## 8. 遗留未知

- `SessionListPhase` / `WorkspaceListPhase` 的**具体枚举值**未查（实现空状态时需要）。实现时按字符串比较处理，或再查一次。
- `WorkspaceArchiveValue['archivedSessionIds']` 的确切形状未查（推测是 `readonly SessionId[]` 或 Set）。
- 点击会话后**抽屉是否自动关闭**：原型的预期是关闭，但 `openSession` 是同步的，关闭时机需要实测确认不会打断导航。
