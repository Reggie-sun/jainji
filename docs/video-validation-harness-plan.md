---
title: Lightweight Video Validation Harness Implementation Plan
status: draft
execution: not executed
version: 0.1
date: 2026-09-17
baseline: 20c270f
---

# Goal And Authority

实施[规格](video-validation-harness-spec.md)定义的 code 与 media 两个入口，共用 policy 和 runs。用户当前要求先写 specs 和 plan；本文件不构成已开始实现或已运行验证的声明。

采用当前工作树内的有界实现，保留无关文档和用户项目文件。实现前重新检查 Git 状态与精确目标文件 ownership；不创建 worktree，不调用真实模型，不启动用户生产任务。

# Scope And Owners

预期新增 `.agent/harness/policy.json`、`scripts/harness/` 下的 CLI/runner 与媒体检查模块、`tests/harness*.test.ts`；仅为接入命令、忽略本地运行产物和使用说明，修改 package.json、.gitignore、README.md。具体文件拆分以 runner 与 media 两种职责为界，不为每个检查创建框架或单独模块。

直接复用 domain schemas、outputDimensions、fingerprintFile 和 FFmpeg 工具能力；不修改制作、队列、模板或持久化 owner。必要的 TypeScript 执行方式复用已有 esbuild，并纳入类型检查范围，不引入新运行时依赖。不得因新 CLI 另建一份 ExportBatch 或展示文字 schema。

# Milestones

| Milestone | Deliverable and boundary | Verification and done condition |
| --- | --- | --- |
| M1 — Runner and policy | policy 校验、CLI 入口、唯一 run、回执状态、日志、超时与无 shell 进程执行；先用 fixture 命令验证 | AC-01/02；非零、跳过、空报告、超时和中断均非 PASS；无执行时仍可读失败回执 |
| M2 — Code regression | 接入 typecheck 和固定核心测试组，解析 Vitest JSON；记录代码与工具身份 | AC-03；执行所有指定文件，报告数量与 skip；执行期间源码变化使证据失效 |
| M3 — Actual media | 读取项目+显式批次 ID 或 QueueState；冻结快照、任务核对、真实媒体技术检查及抽帧索引 | AC-04/05/06/07；真实小视频正反例均达到预期，VFR/缺失证据不会误通过 |
| M4 — Integration and handoff | README 命令、范围、隐私及判定语义；review 最终 diff；保存演示 runs | AC-08；相关类型检查与测试通过，交付回执及未验证边界，仅提交本任务文件 |

M1 → M2/M3 → M4；默认顺序完成，不为可并行性增加协调成本。到实施阶段按语义风险选择一次独立审查，重点看误报 PASS、scope 丢失、冻结数据绑定、跨平台启动和进程清理；不叠加重复评审流程。

# Verification Strategy

对结果汇总、输入选择、缺失证据和媒体比较先写能失败的行为测试，再实现。只验证可观察合同，不用测试镜像实现细节。媒体 fixture 在临时目录生成；复用本地 FFmpeg，所有破坏性反例只改测试副本。

必要反例：必需测试 skip/零发现、返回 0 但报告缺失、命令失败/超时、未知批次、重复 task/输出、非 completed、partial、快照缺失、源 hash 改变、输出损坏、缺音轨、错误尺寸/帧率/时长、VFR 无充分证据、运行中输入变化。覆盖至少一个多素材多批次输入，证明不会把历史输出计算在本次数量内。

验收时执行 `npm run typecheck`、harness 自身测试、`npm run harness -- code` 和至少一组成功及故意失败的 `media` fixture。避免重复运行完全相同检查；若 code 已包含所需测试，其回执作为一次完整证据。Windows 路径与进程启动使用定向测试；无 Windows 主机则明确实机未验证。

不要求本轮运行桌面 smoke：本计划不修改 UI/IPC。若实现阶段实际扩大到这些边界，重新评估对应验证。真实用户视频不作为 fixture；未指定项目及批次之前，只能声明合成媒体检查已完成。

# Risks And Decisions

- VFR 的平均帧率不足以证明帧序列保留：首版无法可靠验证就 NOT_EVALUATED，完整时间戳比较留到有实际需求时。
- 历史任务缺少冻结素材：不从当前项目静默补齐；明确缺失证据，不自动迁移或重建任务。
- 全量解码与 hash 会增加大批次耗时：顺序执行、同 run 内复用未变化源证据；先记录实测，再决定优化。
- 成片 hash 能绑定本次检查对象，但旧任务没有导出时 hash：不能据此证明历史文件从未被修改。
- 文字模板合规和抽帧不等于最终画面合规：报告必须保留人工观看边界，不做自动视觉通过声明。

# Completion And Record

文档阶段仅检查路径引用、合同一致性、范围和 diff，不制造测试 run。仓库当前未发现专用 session-record/capture skill，采用这两份规格与计划作为本次文档产物；不新增运行记录体系。

实施阶段交付：task-only commit、实际执行的检查与退出码、成功和失败示例 run 路径、未验证项及剩余限制。不得把本文件的验收标准勾选为已经通过，也不得将生成文档计为 harness 实现完成。
