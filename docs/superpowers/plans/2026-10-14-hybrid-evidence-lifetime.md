# Hybrid Evidence Lifetime Repair

## Goal

修复有效 Hybrid 分析在模型等待后因 discovery 原 300 秒计时中止，导致同源各版本均显示 `UNSAFE: Hybrid This operation was aborted`。

## Scope and Owners

- `src/main/source-fact-discovery-evidence.ts`：独占准备与保留预算、证据读取消和 freshness；新增有限 `lifetimeMs`，成功准备后切换计时，绝不续期。
- `src/main/hybrid-cover-session.ts`：仅两份原 discovery 请求显式选择 2 小时保留预算，继续原缓存、H2/H3/H4 和生产流程。
- `tests/shape-cover-stationary-discovery.test.ts`、`tests/hybrid-cover-session.test.ts`：实际 FFmpeg 证据时间边界与 Hybrid 接线回归。
- [Hybrid Contract](../../shape-matched-cover-hybrid-v1-spec.md#evidence-lifetime-repair)：任务内接受并 self-reviewed 的兼容修订。

## Contract and Compatibility

准备仍最多 300 秒，scratch/frames/working bytes 不变。`lifetimeMs` 最大 7,200,000 ms、不得小于准备 wall，起点固定于调用开始；省略等于 `wallMs`。准备完成且仍有效后，预算 timer 与对外 `deadline` 同步切换到固定保留终点；取消、超时和 close 不能恢复。时间到期呈现受控 `INCOMPLETE` 原因。

保留期间仍核验源/引擎身份与 bytes、spool generation、pixel digest、原 clock/decode/candidate/packet 和 live ownership。H3 目标 evidence 的既有 300 秒上限及 discovery clamp 保持，无须修改 proof-pinned owners。两小时由原四角有限请求与本地预算累计导出，不增加调用额度或重试。

## Out of Scope

不修改已有连接、算法阈值、H4、coverage、模型路线、队列或历史失败状态；不启动真实模型或自动重新制作用户失败项。保留其他会话工作。

## Acceptance Criteria

1. 真实 FFmpeg 准备的长保留 evidence 在原 300 秒之后仍能 read/verify/discover，同字节身份保持绑定。
2. 默认 evidence 仍在原期限到期；显式长保留也在自身固定终点到期，不续期。
3. 短准备 deadline 不被长保留时间放宽；非法、无穷及过大预算拒绝。
4. 长保留期间取消、源/引擎变化、关闭或伪造仍拒绝；Hybrid 同源多版仍只准备一次，失败不自动重试。
5. 受影响 tests、typecheck、owned Harness/completion 有对应当前字节证据；必要 AOCI 通过官方流程维护，真实共享冲突如实报告。

## Milestones

### Reproduction and Repair

以真实小视频和受控 clock/timer 先复现 retained evidence 原截止问题；在 canonical owner 分开两阶段计时并接入 Hybrid。运行 `npx vitest run tests/shape-cover-stationary-discovery.test.ts tests/hybrid-cover-session.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1` 和 `npm run typecheck`。

### Verification and Delivery

按当前 policy 生成本任务 scope 并执行 Harness/completion。最终稳定候选按 Risk Gate 判断一次，Parent 核查 diff，官方 AOCI 收尾，提交 owned 文件并 push 当前 upstream、核对 remote HEAD。真实模型/整片播放/Windows 实机不由 fixture 证明。

## Self Review

scope 与修订逐项对应；只有一个证据生命周期 owner，没有无限保留、第二队列、未知重试或 proof-pinned 修改。测试须覆盖行为和真实拒绝方向；共享 source 漂移使 Harness 失效，不能以旧回执完成。
