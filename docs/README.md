# 文档索引

先读哪一篇：

- **要了解整个项目** → [00-项目说明.md](00-项目说明.md)（**完整项目说明**：背景/约束/加载原理/功能全表/模块参考/token/验证体系/上游缺陷反制/维护手册/历史结论）
- **要使用或维护这个插件** → [MOBILE-UI-GUIDE.md](MOBILE-UI-GUIDE.md)（能力、token、开关、验证清单、键盘、横屏、复制与提示）
- **要升级 DSH 或 tether** → [2026-09-12-upgrade-and-maintenance.md](2026-09-12-upgrade-and-maintenance.md)（影响面 + 检查清单）
- **只想快速上手** → 根目录 [README.md](../README.md) / [README.en.md](../README.en.md)

下面是全部文档，按「现行」与「历史」分开。**历史文档是当时的证据与过程记录，不要当成操作说明**：其中的行号、行数、开关默认值多数已经过期。

---

## 现行（与当前代码一致，跟着代码一起更新）

| 文档 | 内容 |
|---|---|
| [00-项目说明.md](00-项目说明.md) | **完整项目说明（权威）**：一页速览、背景与硬约束、加载原理、功能全表、17 个模块参考、设计 token、32 个套件的验证体系、上游缺陷反制清单、维护手册、被推翻的结论 |
| [MOBILE-UI-GUIDE.md](MOBILE-UI-GUIDE.md) | 使用与维护指南：各表面与开关、设计 token、宿主钩子、验证清单、键盘/横屏、复制与提示 |
| [2026-09-12-upgrade-and-maintenance.md](2026-09-12-upgrade-and-maintenance.md) | DSH / tether 升级时会断什么、怎么查、可维护性结论 |
| [2026-09-12-overlap-audit.md](2026-09-12-overlap-audit.md) | 与 tether 注入样式的重叠规则清单（结论仍然成立） |

## 计划中 / 已完成但未应用

| 文档 | 状态 |
|---|---|
| [android-native-splash.md](android-native-splash.md) + [.patch](android-native-splash.patch) | 原生启动页改动集完整，但**未应用**：需要 Android 构建环境（MSVC）。补丁是针对 `cc.zexa.dshtether` 源的上游提案，不是本仓库的 fork。 |

## 历史（过程与证据，勿当说明）

| 文档 | 记录了什么 |
|---|---|
| [2026-09-12-ui-audit.md](2026-09-12-ui-audit.md) | 全面 UI 审查；§3 的清单大多已由同文 §5b–5g 落地，行号已过期。仍开放：工具卡取舍、`layoutRef` 在纯高度变化下的复位、抽屉设置入口失败时无反馈、`Drawer.tsx` 与 `DrawerOverlay.tsx` 的样式 id 冲突（已修） |
| [2026-09-11-session-log.md](2026-09-11-session-log.md) | 早期一轮调研日志 |
| [2026-09-12-typography.md](2026-09-12-typography.md) | 字号字重批次的设计依据 |
| [drawer-list-fields.md](drawer-list-fields.md) | 抽屉数据字段（当时实测的宿主 props） |
| [drawer-scroll-touch.md](drawer-scroll-touch.md) | 「抽屉不滚动」调查。**结论后续被推翻**：实测是探针方法问题（控制组停在滚动底部 + 未开 touch 模拟），抽屉在触摸下正常滚动，见 `tools/verify-touch-scroll.mjs` |
| [drawer-takeover.md](drawer-takeover.md) | 接管 `sidebar` 插槽的路线。**与本项目硬约束冲突**（需停用 ui-sidebar），默认关闭；文件内的启用步骤仅为记录，勿照做 |
| [overlay-drawer-step1.md](overlay-drawer-step1.md) / [step2.md](overlay-drawer-step2.md) | 悬浮抽屉的两步实施记录（step2 的「尚未推送到生产 profile」早已过期） |
| [queue-bar-investigation.md](queue-bar-investigation.md) / [queue-bar-root-cause.md](queue-bar-root-cause.md) | 队列条排版事故的排查与根因（已由 `tether-compat.ts` 抵消） |
| [keyboard-occlusion.md](keyboard-occlusion.md) | 键盘遮挡的早期分析 |
| [plan.md](plan.md) / [01-final-plan.md](01-final-plan.md) | 早期计划（`plan.md` 里「工具卡默认空数组」已不成立） |
| [02-theme-token-mapping.md](02-theme-token-mapping.md) | DSH token 与界面元素的对应表 |
| [03-tether-0.1.5-bump-report.md](03-tether-0.1.5-bump-report.md) | tether 内置 DSH 运行时版本的影响评估（结论：不要提升） |

## 仓库外

`01` / `02` / `03` 三篇引用的是仓库外的调研路径（`H:\DSH\_work\src\deepseek-harness-master` 等），克隆本仓库的人看不到那些文件；它们保留为当时的结论记录。
