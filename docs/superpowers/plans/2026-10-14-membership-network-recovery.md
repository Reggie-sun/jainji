# Membership Network Recovery Implementation Plan

## Goal And Binding Contract

按 [Recovery Spec](../specs/2026-10-14-membership-network-recovery.md) 实现有限只读核验恢复与脱敏诊断，Native Codex 保持实现及验收 owner。权限仍每次在线验证；两次失败或确认拒绝不会放行。

## File Boundaries

修改 `src/main/membership-session.ts`、`src/main/membership-desktop.ts`、`tests/membership-desktop.test.ts` 与 `docs/membership.md`；新建 `membership-check.ts`、`membership-network.ts`、`membership-diagnostics.ts` 三个直接职责模块。测试放入既有已登记会员测试文件，覆盖启动 mock 兼容，不新增第二检查 registry。其他会话的自动化、千川及 Hybrid 改动保留。

## Major Milestones

### Read-Only Recovery

新增可信的单次抖动复现与准入等待测试；实现两次/22 秒预算、250 ms 延迟、响应错误分类及取消信号。`MembershipSession` 只在逻辑核验最终结果上更新状态和执行取消/清凭据；代际 fence 及并发 pending 仍独占。

### Network And Diagnostics

通过 `membership-network.ts` 创建分别用于只读核验和原登录/续费的 direct Sessions；恢复只读连接与 DNS。接入固定私有轮转日志，使用白名单序列化，验证网络原始异常、响应和凭据不会进入文件。更新当前账号合同。

### Verification And Delivery

运行现有会员与启动恢复测试、typecheck；用隔离 Electron 与本地服务验证实际生产模块的单故障恢复、持续故障和直连/敏感连接边界。完成 owned Harness/verify、必要 AOCI 对象维护及 Risk Gate，检查最终 diff，仅提交 owned files/hunks 并 push，核对 remote SHA。不操作真实客户凭据或部署 VPS。

## Acceptance And Self-Review

瞬时失败自动恢复且不会取消原工作；新准入在重试期间等待，旧状态不能授权。持续故障有界失败，退出不会继续发请求，确认拒绝和无效响应不重试。日志有界脱敏，不影响认证。模块划分对应三个新增职责，公开协议与生产生命周期不变；每条 Spec 要求都有行为或运行验证接缝，没有额外审批或外部动作。
