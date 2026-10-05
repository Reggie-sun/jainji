# Agent Contract Index

## Authority

[AGENTS.md](../AGENTS.md) 是项目规则入口并优先于旧 `CLAUDE.md` 副本。本文只导航到唯一 concern owner，不保存 executable paths/argv/testFiles catalog。历史 spec 的实施状态必须核对当前源码；record 不授予 authority。

## Contract Navigation

| Concern | Contract owner | Engineering evidence |
| --- | --- | --- |
| 展示文字、普通装饰、矩形/随机覆盖、时序、数量 | [Decoration Contract](decoration-production-contract.md) | policy 中 text-and-plan、local-random、layout、lifecycle、output-publication |
| 源身份、修订、争议与静态 mask | [Source Knowledge](source-sticker-knowledge-spec.md) | cover-contracts、shape-boundaries |
| assisted 人工决定、冻结预览与批准 | [Assisted Review](semi-automatic-cover-review-spec.md) | cover-contracts、lifecycle |
| shape geometry、共同候选与输出准入 | [Shape V1](shape-matched-cover-spec.md)、[Simplification Delta](shape-matched-cover-v1-simplification-spec.md) | shape-boundaries；研究 PASS 无 production authority |
| Hybrid静态overlay语义与预览QA | [Hybrid V1 Delta](shape-matched-cover-hybrid-v1-spec.md) | hybrid-vision；旧strict proof为研究路径，H1保持PRODUCT_DISABLED |
| Harness scope、检查和 completion | [Harness Delta](superpowers/specs/2026-10-02-agents-harness-governance-design.md)、[Harness Contract](video-validation-harness-spec.md) | [policy](../.agent/harness/policy.json) 独占路由与命令 |
| 启动与手动运行 | [README](../README.md) | 当前 runtime 与实际命令 |
| AOCI 创作与维护 | 当前官方 Guide 与工具合同 | Verify / Check / Guide；本文不复制状态机 |

## Production Owners

- `assisted` 是显式半自动覆盖模式：算法候选与人工决定分开保存；草稿编辑使旧预览和批准失效。所有版本冻结并经动态预览、用户明确确认后，才可通过原导出队列幂等提交。独立复核默认关闭，只报告问题，不能批准或自动改稿；退出保留可恢复草稿，不自动调用模型或提交未入队版本。

| Concern | Canonical owner |
| --- | --- |
| 制作请求、价格与装饰数据校验 | [agent.ts](../src/shared/agent.ts)、[decorations.ts](../src/shared/decorations.ts) |
| 模板约束与布局几何 | [agent.ts](../src/shared/agent.ts)、[layout-policy.ts](../src/shared/layout-policy.ts) |
| 制作准入、取消与逐素材执行 | [agent-controller.ts](../src/main/agent-controller.ts)、[agent-runner.ts](../src/main/agent-runner.ts) |
| 模型方案校验与本地图层生成 | [agent-provider.ts](../src/main/agent-provider.ts) |
| 自动四角覆盖优先与补齐时段 | [automatic-corner-layout.ts](../src/main/automatic-corner-layout.ts) |
| 自动主管协议、修正与样片检查 | [supervisor-protocol.ts](../src/main/supervisor-protocol.ts)、[collaborative-cover.ts](../src/main/collaborative-cover.ts)、[supervised-preview.ts](../src/main/supervised-preview.ts)、[supervisor-evidence.ts](../src/main/supervisor-evidence.ts) |
| 近似自动覆盖合同、定框与逐版复核 | [cover-placement.ts](../src/shared/cover-placement.ts)、[cover-placement-proposal.ts](../src/main/cover-placement-proposal.ts)、[cover-placement-session.ts](../src/main/cover-placement-session.ts) |
| 原贴纸自动识别与跟随轨迹 | [source-sticker-recognition.ts](../src/main/source-sticker-recognition.ts)、[cover-track-provider.ts](../src/main/cover-track-provider.ts)、[automatic-cover-tracks.ts](../src/main/automatic-cover-tracks.ts) |
| 可复用源贴纸合同、静态 mask 准入、持久化与逐版本修订传播 | [source-sticker-knowledge.ts](../src/shared/source-sticker-knowledge.ts)、[source-mask-admission.ts](../src/main/source-mask-admission.ts)、[source-sticker-knowledge-store.ts](../src/main/source-sticker-knowledge-store.ts)、[source-sticker-knowledge-session.ts](../src/main/source-sticker-knowledge-session.ts) |
| 半自动审阅、证据与批准 | [cover-review.ts](../src/shared/cover-review.ts)、[cover-review-controller.ts](../src/main/cover-review-controller.ts)、[cover-review-session.ts](../src/main/cover-review-session.ts)、[cover-review-evidence.ts](../src/main/cover-review-evidence.ts)、[cover-review-approval.ts](../src/main/cover-review-approval.ts) |
| 已知持久格式迁移与旧副本 | [state-migrations.ts](../src/main/state-migrations.ts)、[store.ts](../src/main/store.ts) |
| 模板领域、编译、导出生命周期与文件验证 | [domain.ts](../src/main/domain.ts)、[compiler.ts](../src/main/compiler.ts)、[queue.ts](../src/main/queue.ts)、[artifact.ts](../src/main/artifact.ts) |
| 模型连接、凭据与 ChatGPT 会话 | [model-connections.ts](../src/main/model-connections.ts)、[connection-store.ts](../src/main/connection-store.ts)、[chatgpt-session.ts](../src/main/chatgpt-session.ts) |

- 复用上述 owner，不新增第二套价格来源、模型选择器、导出队列或任务生命周期。前端展示状态不能替代主进程校验。
- 预览与实际导出应遵守同一模板和布局约束；静态预览不等于逐帧主体避让，也不能证明成片质量。


## Migration Ledger

一次规则迁移的追溯表；稳定 ID 对应 2026-10-02 迁移前根规则的顺序。此表不成为第二份合同正文或测试清单。

| Rule IDs | Destination | Disposition |
| --- | --- | --- |
| A01–A04 | AGENTS Authority / README | keep-root |
| T01–T03 | AGENTS Development Boundaries | keep-root |
| P01 | [Decoration P01](decoration-production-contract.md#p01) | contract-owner；可执行部分按 policy |
| P02 | [Decoration P02](decoration-production-contract.md#p02) | contract-owner；可执行部分按 policy |
| P03 | [Decoration P03](decoration-production-contract.md#p03) | contract-owner；可执行部分按 policy |
| P04 | [Decoration P04](decoration-production-contract.md#p04) | contract-owner；可执行部分按 policy |
| P05 | [Decoration P05](decoration-production-contract.md#p05) | contract-owner；可执行部分按 policy |
| P06 | [Decoration P06](decoration-production-contract.md#p06) | contract-owner；可执行部分按 policy |
| P07 | [Decoration P07](decoration-production-contract.md#p07) | contract-owner；可执行部分按 policy |
| P08 | [Decoration P08](decoration-production-contract.md#p08) | contract-owner；可执行部分按 policy |
| P09 | [Decoration P09](decoration-production-contract.md#p09) | contract-owner；可执行部分按 policy |
| P10 | [Decoration P10](decoration-production-contract.md#p10) | contract-owner；可执行部分按 policy |
| P11 | [Decoration P11](decoration-production-contract.md#p11) | contract-owner；可执行部分按 policy |
| P12 | [Decoration P12](decoration-production-contract.md#p12) | contract-owner；可执行部分按 policy |
| P13 | [Decoration P13](decoration-production-contract.md#p13) | contract-owner；可执行部分按 policy |
| P14 | [Decoration P14](decoration-production-contract.md#p14) | contract-owner；可执行部分按 policy |
| P15 | [Decoration P15](decoration-production-contract.md#p15) | contract-owner；可执行部分按 policy |
| O01–O03 | Production Owners / AGENTS ownership | contract-owner / keep-root |
| D01–D05 | AGENTS Safety Boundaries | keep-root |
| V01–V06 | AGENTS Completion / Harness contract | keep-root / executable-check |
| C01–C07 | AGENTS AOCI / 官方 Guide | keep-root / executable-check；不复制 machine contract |

迁移的语义 self-review：保留所有默认值、逐素材开关、uploaded 文字例外、精确条数、旧冻结解释、有限主管修正、未知结果停止、shape 产品关闭及本 session AOCI 归属。根入口切换须待适用 gates 完成。
