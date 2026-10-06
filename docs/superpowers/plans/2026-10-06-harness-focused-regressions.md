# Focused Regression Plan

## Goal

完成新增十款边框，同时把边框改动误选 191 个测试文件的回归收敛到资源、准入、冻结、追加、编译和实际渲染接缝。运行过程中显示检查进度、文件与耗时，报告定位失败案例。

## Scope And Contracts

复用 `src/harness/` 与 `.agent/harness/policy.json`；合同 owner 为 [Harness Contract](../../video-validation-harness-spec.md)。policy 增加可选 baseline/domain/fallback 路由分类及固定 `testFilesByCheck` 子集。旧路由缺分类时仍按 domain 聚合。逐 owned path 选择：baseline 始终加入，存在 domain 时不用 fallback；多个文件分别选择后取 union，任何要求完整检查的 route 优先于子集。子集只能引用该 route 已选择的 Vitest 检查及其已登记文件，不提供 CLI 临时跳过。

边框专用资源回归从 extended registry 移出，保持全 registry 文件唯一；边框 route 固定选择对应生产接缝。Harness 自身源码与 policy 使用专用 Harness 回归。正式 AOCI 资产只触发既有治理检查。未知入口仍走保守 fallback；Hybrid Activation 保留原全量集成集合及移动后的边框检查。

源码/config/resource 身份仍使用既有完整 manifest；不编辑 `scope.ts`，不缓存 PASS、不放宽 skip/timeout/中断/报告缺失和 completion。进度写 stderr，保持 stdout 的结果接口；default 与 JSON reporter 同时使用。命令参数由执行和 completion 共用一个 owner。

## Milestones

1. 增加选择、子集合并、非法配置、全量边界和实时输出的失败测试，完成合同 Self-Review。
2. 实现 schema、逐路径路由、边框与 Harness policy；加入有界实时输出和报告中的案例耗时/失败位置。
3. 运行 typecheck、受影响测试和真实 scoped Harness/completion；维护本轮 AOCI；按 Risk Gate 裁决 review，提交并 push owned files。

## Acceptance And Verification

- 单独边框 scope 必须执行目录/透明像素/随机池/手动和逐素材设置、冻结重试、追加和渲染相关文件，不选千川或源掩码检查。
- 混合 scope 的保守文件仍选完整检查；未分类旧 route 维持 union。所有登记测试必须路由到自己，子集不得藏住 changed test。
- 全量 registry 文件集合不丢失、无重复；默认和 Hybrid Activation 仍含各自必需集合。
- 实时输出在子进程退出前交付并受日志字节预算限制；JSON 仍是通过判据，报告列出耗时和失败案例。
- 现有 identity、completion、进程树终止及报告拒绝测试全部通过，实际回执须对应最终字节；并发源码漂移仍拒绝 PASS。
- 新十款边框已有实际 Electron 手动/随机交互及 26 条原队列 FFmpeg 输出证据；不升级为全片人工视觉验收。

## Self-Review

191 文件问题来自粗路由，没有重复执行文件。仅调整选取范围，避免用提高并发放大 FFmpeg/GPU 干扰。逐文件 domain/fallback 判断与完整贡献者优先规则保护混合改动；强制 changed-test 覆盖和 completion 重算防止子集伪造。完整源码身份保留，并发源码改动仍会使运行失效。没有新依赖、用户媒体或付费模型调用。
