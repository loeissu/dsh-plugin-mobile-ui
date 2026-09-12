# 2026-09-12 · 字体显示效果优化

**范围**：插件自有表面的文字渲染质量 + 设置相关表面（插件设置页、主机设置弹层）的字体细节
**开关**：`FEATURES.typography`（默认开，纯样式表，作用域 `[data-dsh-mobile-ui]`，不触碰宿主文本）

---

## 新增：`src/client/typography.ts`（基础排版层）

之前只统一了**字号**（TYPE token），文字**渲染**交给宿主文档，在 Android 壳上有三个可见缺陷：

| 缺陷 | 修法 |
|---|---|
| Android WebView「字体放大」（font boosting）按启发式把正文块撑大，12px 说明文字可能被放大到 15px，与相邻行不一致 | `text-size-adjust: 100%`（含 `-webkit-` 前缀），根节点**及全部后代**都声明——该属性继承行为跨引擎不可靠，而 font boosting 作用在子级文本块上，只写根会漏 |
| 时间 / 年龄 / 计数等数字随跳动横向抖动 | 数字表面各自在**本表面样式表**里声明 `font-variant-numeric: tabular-nums`（本次补齐 sess-meta、splash__status；ws-count、tool__count、settings__value 原本就有） |
| 未声明行高的文字继承宿主（对话区是 markdown 调的节奏，与设置弹层不一致） | 插件根节点及后代 `line-height: 1.5` 兜底；需要更紧的步骤自己声明（同特异性下靠「表面表后注入」赢得级联） |

**设计取舍**：tabular-nums 不放进排版层的集中清单——各表面已有本地声明，两个家会漂移；排版层只管真正跨表面的渲染问题（放大 / 平滑 / 行高 / 点按高亮）。

附带：`-webkit-tap-highlight-color: transparent`（插件行/按钮自带 `:active` 样式，去掉系统默认灰闪）。

**刻意不做**：不覆盖 `font-family`。DSH 把品牌字体投到 `body`，插件继承它；强制字体栈会让抽屉/设置和周围应用不同脸。等宽字体是唯一例外，见下。

## 各表面细节

| 文件 | 改动 |
|---|---|
| `theme.ts` | `V.mono` 加回退链 `ui-monospace → Cascadia Mono → Roboto Mono → monospace`——token 缺失时不再退化到浏览器默认衬线感等宽 |
| `Settings.tsx` | 「重放」按钮 `font-weight: 500`（12px/400 在手机上偏瘦）；脚注 `text-wrap: pretty`（避免 CJK 换行末行悬挂单字） |
| `settings-chrome.ts` | 主机设置弹层 `_desc` 行高 17→18px（12px 中文换行更松）；`_value` / `_unit` 加 tabular-nums（字号步进器等数字不再抖） |
| `DrawerOverlay.tsx` | 会话标题行高 1.4 → 1.45（CJK 呼吸感） |
| `ToolCard.tsx` | 工具输出 `font-variant-ligatures: none`——输出是给用户逐字复制/阅读的代码，禁止连字融合字符 |

## 验证

- `npm run bundle` + `npm run verify`：PASS（含渲染冒烟）
- 三轮自迭代审查通过（2026-09-12）：①作用域从「仅根」扩为「根 + 后代」（text-size-adjust 继承性不可靠）；②tabular-nums 收敛到各表面本地声明，消除双家漂移；③产物断言 + 渲染冒烟回归全绿
- **第三次踩中 STATUS §4.8 的坑**：CSS 模板字符串注释里的反引号截断构建（报错指向下一行，极具迷惑性）。本文件已留注释防第四次
- **字体渲染的最终观感需真机确认**（font boosting 只在真 WebView 上发生）；3080 每请求读盘，手机刷新即生效
