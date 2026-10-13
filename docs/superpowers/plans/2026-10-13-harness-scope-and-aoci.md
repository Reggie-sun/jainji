# Harness Scope And AOCI Implementation Plan

## Goal

按用户 2026-10-13 的修改授权，减少无关验证，补齐源码到业务测试的路由，并让 AOCI 按必要性维护。

## Scope And Ownership

Native Codex Parent 串行修改 `src/harness/{types,routing,completion,cli}.ts`、Harness tests、`.agent/harness/policy.json`、`AGENTS.md` 和现有 Harness contracts。共享 policy 与 AOCI 资产已获用户归属授权；保留千川插件等现有改动，仅提交本轮增量。不修改产品代码，不创建 worktree。

## Contracts And Invariants

- 保留 code/media/verify CLI、v1 读取、v2 scoped receipt、完整 source identity、required/skip/report/hash gates 和只读 verifier。
- Vitest 的 test-only contribution 可收敛到被改动的已登记测试；源码、helper、fixture、删除测试及明确固定回归子集保持对应回归范围。混合 scope 逐检查取 union。
- baseline 不代替行为源码的 domain/fallback 归属。缺业务映射须明确拒绝；补齐已发现的 output-directory / ResultsPanel 路由。
- Harness 自身测试由 Harness / policy 改动触发；普通文档、CSS 与业务改动不默认执行 Harness tests 或 AOCI。
- scope 可声明 `aoci: { reason, paths }`，仅增加 required AOCI，paths 必须属于 ownedChanges。正式 AOCI 资产、配置和 AGENTS 规则修改由 policy 自动触发，不可用声明解除。
- completion 只复核实际选中的 controls，并核对它们的 required/PASS；必要的 AOCI 保留官方版本、身份、drift、CAS 与恢复约束。
- AOCI 读取、Entry 更新、baseline 更新和治理分别判断；已有索引描述失准、对象身份变化、实际依赖的索引过期或明确治理任务才维护，普通变更不机械触发全库维护。

## Acceptance Criteria

单改 results-panel 测试只执行该测试；改对应源码实际包含该测试；output-directory 源码包含其业务测试；batch CSS 不执行 Harness tests/AOCI；纯文档只做文档检查；未登记行为源码、缺 required control、声明非 owned AOCI 路径、旧字节/伪造报告仍拒绝。真实产品/平台/媒体验收边界不变。

## Milestones

1. 添加上述正反例，观察现有实现失败；修订 scope/routing/completion/CLI 和 policy，使 focused tests 通过。
2. 更新现有合同和根规则，完成 self-review；执行 typecheck、全部 Harness tests 和必要的定向业务测试。
3. 针对本轮实际索引语义变化按官方 AOCI 合同维护；取得 stable owned Harness/completion evidence，判断 Implementation Review Risk Gate，检查最终 diff。
4. 单独提交本轮增量，保留外部暂存内容，push 当前 upstream 并核对 remote SHA。

## Verification

`npm run typecheck`；`node node_modules/vitest/vitest.mjs run tests/harness*.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1`；当前 policy 的 owned scoped code/verify。AOCI 与外部子代理只采用 canonical receipt，不把 transport success、静态映射或测试通过升级为产品验收。

## Self-Review

新字段仅增加检查，不授权模型、生产任务或跳过已选 required gates；既有 full regression/Hybrid Activation 与媒体检查保留。source manifest 本轮不收窄，以免未证明的依赖选择导致旧证据误用。未映射源码会暴露需补充的真实路由，不能靠 baseline 掩盖。
