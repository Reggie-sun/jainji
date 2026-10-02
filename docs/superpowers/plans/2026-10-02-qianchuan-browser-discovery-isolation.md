# Qianchuan Browser Discovery Isolation Plan

## Goal And Scope

软件在首次绑定、端点发现与已绑定连接时隔离无关浏览器故障，保持明确目标的安全校验。适用 [Spec](../specs/2026-10-02-qianchuan-browser-discovery-isolation.md)。不更改已有账号设置、上传 ledger、renderer 输入或真实 Chrome 登录目录。

## Owners And Compatibility

`src/main/qianchuan-browser-discovery.ts` 负责有限扫描、内部失败类别和独立 HTTP 结算；`src/main/qianchuan-browser-manager.ts` 负责目标异常拒绝及原绑定生命周期。`tests/qianchuan-browser-discovery.test.ts` 承担对应回归和首次绑定集成接缝，避开已有其他会话改动的 manager 测试文件。可选内部字段兼容已有 mock；无私有状态格式迁移。

## Milestone 1: Isolate Identifiable Browser Failures

新增回归先证明全量扫描被无关目录阻断；实现可归属失败记录且无 endpoint，精确扫描仍拒绝目标损坏。保留不能归属的异常、数量上限和 duplicate target 拒绝。原 manager 不将异常目标误报为可重新创建的账户目录。

## Milestone 2: Settle Account Probes Independently

复现有效目标与拒绝/超时端点共存的失败，在两个发现入口使用独立结算；保留无匹配时的故障与缺失区分。拒绝多个正匹配及目标同 profile/端口的失败成员。用原 manager 接缝证明首次绑定保存正确身份，无新窗口/文件动作。

## Milestone 3: Verify And Deliver

运行 typecheck、浏览器及上传相关测试，按 owned scope 执行 Harness/receipt verify。只读发现本机六个账户，不制作或上传。稳定后维护本轮 AOCI index 对象及 observe 文档/测试，执行官方 Verify、Check、Guide；按最终风险评估审查；仅提交本轮 files/hunks，保留其他会话改动。

## Self-Review

三个 milestone 覆盖 Spec 的失败归属、独立探测、目标异常/重复、首次绑定、资源限制及不授上传权。无未知恢复或新 provider，验证和 source owners 不重复；实现由 Native Codex 串行执行。
