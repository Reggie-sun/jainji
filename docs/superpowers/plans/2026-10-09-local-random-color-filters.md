# Local Random Color Filters

## Goal And Scope

用户要求消除随机包装抽到黑白滤镜导致画面发灰的问题。唯一行为 owner 为 `src/main/agent-provider.ts` 的 `createLocalRandomPlan`：新方案在共享滤镜枚举中排除 `mono`，保留其余滤镜及 0–1 强度。

## Contracts And Compatibility

同步 [Decoration Contract](../../decoration-production-contract.md#local-random-packaging)。保留共享 schema、手动黑白模板、Agent 选款及 compiler 解释；旧冻结任务和重试不重算。文字、贴纸、边框、覆盖及队列均沿原路径，无数据迁移或 UI 变更。

## Implementation And Verification

在 `tests/agent-provider.test.ts` 先复现随机选中 `mono`，再修改选择入口；验证四种允许结果、随机区间边界、跨旧 RuleId 物化与显式黑白兼容。运行受影响测试、typecheck 和 owned-scope Harness，维护 AOCI 后核验 completion，提交并推送。

## Self-Review

本轮是单一局部规则收窄；没有增加第二套 schema 或重新解释历史数据。验收为新随机方案不会选择 `mono`，不把代码测试当作用户视频的人工观看验收。Kimi 仅独立核对不变的 schema/compiler 兼容边界；parent 负责最终 diff 和工程验收。
