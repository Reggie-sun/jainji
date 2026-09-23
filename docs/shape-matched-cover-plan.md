---
title: Shape-Matched Static Cover V1 Implementation Plan
status: draft-not-executed
version: 0.1
date: 2026-09-24
spec: shape-matched-cover-spec.md
---

# Goal And Authority

按 [V1 Spec](shape-matched-cover-spec.md)替换**合格自动覆盖**的白色矩形路径：可信源像素 mask → 同轮安全候选 → 小幅不透明轮廓 → 最终输出像素 coverage → 独立内容安全 → 原队列导出。当前只编写 plan，未实施代码或更改产品规则。用户已排除 `delogo` 和移动旧贴纸；本计划不增加这两项。

# Baseline And Dependencies

- [Source knowledge](../src/shared/source-sticker-knowledge.ts)和其 [store](../src/main/source-sticker-knowledge-store.ts)是源身份、事实修订及证据的 owner；现有事实只有轨迹/矩形，没有像素 mask。[近似覆盖方案](../src/main/cover-placement-session.ts)只属于渲染决定，不能直接升级成源事实。
- [AgentRunner](../src/main/agent-runner.ts)当前在第一条合格素材上选同轮统一贴纸；[AgentController](../src/main/agent-controller.ts)传入完整本地候选目录。新门槛必须在轮次选择前收集全部目标的可信 mask，并仅给选款流程共同安全候选。
- [cover-sticker.ts](../src/main/cover-sticker.ts)负责覆盖图层，[compiler.ts](../src/main/compiler.ts)负责当前白底 FFmpeg 图形，[cover-motion.ts](../src/main/cover-motion.ts)负责输出偶数像素栅格。新轮廓要沿现有模板、预览、队列和冻结重试路径，避免独立第二 renderer。
- 本计划与现行白色矩形产品规则存在预期差异；只有新实现和验证稳定后才同步修改 [AGENTS.md](../AGENTS.md)及相应用户提示，不提前宣称规则已切换。历史任务及手动/`assisted` 合同保留。

# Milestones

依赖顺序为 `M1 → M2 → M3 → M4 → M5`。每一阶段先满足收敛条件再进入下一阶段；不以 schema 存在或测试通过替代真实媒体证据。

## M1 — Prove The Mask Evidence Seam

**Work:** 在已有真实静态旧贴纸素材上设计并验证源像素 mask 的建立、保守边缘核查及多时点时段证据。可复用现有抽帧、局部放大与源知识证据，不自动导入保存框或实验脚本掩膜。分别记录人工核查、可自动建立和无法可信建立的样本。冻结 mask 坐标/压缩/版本/负载界限及最小时间证据要求；小幅扩张的面积、宽高、半径上限通过开发样本定标，留出样本只验收不调参。

**Convergence:** 可解释地取得至少一类真实静态 mask，细尖/描边/半透明边缘保守纳入；无贴纸、形变、时段不明和证据矛盾可重复地拒绝。若真实素材不能可靠建 mask，暂停后续生产渲染切换并报告缺口。

## M2 — Source Fact And Persistence

**Work:** 扩展 `SourceFactsSchema` 及单一知识 store 的版本化记录，绑定现有 `SourceIdentity`、segment、整数 bbox、无损 mask、摘要、创建/核查元数据和原帧证据。明确旧修订的兼容读取：无 mask 的历史知识继续用于原占位职责，但不能通过新自动覆盖门槛。证据变更/争议按现有不可变修订与传播规则失效，不建立第二知识库。

**Convergence:** schema 与 store 测试覆盖有效读取、跨版本、改源、坏摘要、坏尺寸、恶意大记录、证据缺失和争议；错误不导致 bbox fallback 或覆盖源文件。记录能在重启后按精确源身份复用，不能把旧近似框当作 mask。

## M3 — Shape And Final-Pixel Gate

**Work:** 在聚焦模块实现候选 alpha 栅格、形状预筛、有限轮廓扩张、源 mask 到输出像素的保守变换，以及逐帧逻辑 coverage。按当前真实 FFmpeg 缩放/补边和像素舍入处理；相同栅格状态可缓存，时序必须逐输出帧证明。冻结所需的算法版本、参数、贴纸资产指纹、输出设置及 coverage 结果。无新依赖或 GPU 要求，优先 CPU bitmask 与已有 FFmpeg 能力。

**Convergence:** 像素测试覆盖 AC-03；真实星形素材在不同输出设置中得到可重算的通过/拒绝结果。叶子、竖向及边缘不足的候选不能因 bbox 相交或 alpha>0 而通过。对实际 FFmpeg 图层/导出帧进行配对核对，发现计算与渲染不一致即停止。

## M4 — Selection, Preview And Fail-Closed Integration

**Work:** 调整轮次准备顺序，让本轮全部自动覆盖目标先取得 mask 和共同安全候选，再进行现有选材/创作；Agent 只接收合格目录，选择后重新验证实际模板。把新轮廓作为显式版本化渲染策略接入原编译器/预览/队列；手动、`assisted` 和旧冻结任务不改变解释。沿现有真实样片复核检查人物、手、商品和字幕侵入，并给 `UNSAFE` 保留准确原因。对源事实修订、素材变更、取消和重试重新核对冻结绑定。

**Convergence:** 一轮多素材混合形状无共同候选时停止，不能由首素材的选款放行；无 mask、坏 mask、超限扩张、coverage 失败、内容安全失败均不入队或退回白底。合法样片仍由原队列验证后发布；历史冻结输出像素保持原样。

## M5 — Real-Media Acceptance And Rule Switch

**Work:** 使用冻结留出集做真实导出、逐时段原片/成片查看、边界场景复核和长片多素材耗时/内存记录；覆盖实验中已见的星形、叶子、竖向、字幕邻近、人脸/手、商品、高纹理、切镜、无贴纸样本。先运行类型检查、受影响单元/集成测试及实际 FFmpeg 输出验证，再做适用的独立审查。稳定后同步更新现行白底规则、提示、文档和回归测试；只对新自动覆盖任务启用新策略。

**Convergence:** Spec AC-01–07 均有可追溯结果；真实成片无已知旧贴纸露出及受保护内容侵入；成本有长片证据。人工未看全片、Windows 实机或更广素材泛化若未做，明确标为未验收。若门槛不满足，保留现行生产行为并报告 `UNSAFE`，不以试验性轮廓替换它。

# Verification And Handoff

未来实施需运行 `npm run typecheck`、受影响测试、跨制作/导出集成测试，并用真实 FFmpeg 导出与配对截图核对输出；在声称通过、commit 或 PR 前执行 `verification-before-completion`。测试文件与命令以实际实现确定，不把尚未创建的测试列作已运行证据。文档本次只检查链接、合同与当前源码的一致性。

实施时保留现有未提交文件；修改前重新核对 `git status` 和目标文件 ownership。代码变更的提交、审查及运行证据按当时有效仓库规则执行。本 plan 的 `draft-not-executed` 状态不得解释为实施授权或通过验收。
