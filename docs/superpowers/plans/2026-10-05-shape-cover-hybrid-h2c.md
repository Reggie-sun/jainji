# H2C Corner Semantic Implementation Plan

**Goal:** 为 Hybrid 默认路线实现四角静态后期贴纸语义确认，停在 H3 输入接口。

**Scope:** 全图 M1 → 固定 CornerScopePolicy/v1 → 每角 H1 图片包与 Luna/Sol → HybridCornerSemanticSet/v1；必要固定 fixture 和 real233s 开发验证。

**Contract Surfaces:** 独立 corner enum/policy/schema/semantic owner；复用原 packet/provider/request lifecycle。旧 H2 JSON、全局 undetectedOverlaySuspected、geometry/proof 与 receipt 解释保持原义。

**Invariants:** fraction=0.30，minimumAreaInside=0.60，center 唯一分配；UNKNOWN 不提案；每角≤3 candidates、≤1 logical target、Luna1/Sol1；source≤4/4/0。局部失败仅跳过该角，source/provider infrastructure/binding 失败清空全部 confirmed。motion 不被后审抹掉，无 JSON repair、重试或投票。PRODUCT_DISABLED，guard unchanged。

**Current / Target Behavior:** full-frame H2 全源 unresolved 路径保留为 diagnostic；默认 corner 产品设计允许其他安全角进入未来 H3。未接产品入口或旧 M3。

**Compatibility:** 历史 strict/global owners、测试和失败记录全部保留；旧 random-background fixture 另记 AMBIGUOUS_SCREEN_SPACE_GRAPHIC diagnostic，不追改历史。

**Out of Scope:** H3 motion/mask/shape/coverage、H4 preview QA、export、activation、proof v3。

**Acceptance Criteria:** real233s 右上入 TOP_RIGHT；非角候选 scope 排除；明确 overlay confirm；product/subtitle negative 不 confirm；多组件同组；复杂/unknown/multiple/motion/冲突仅局部 unresolved；freshness/binding 全源关闭；owned Harness 成立。

**Verification:** policy/schema/runtime 定向测试与 FFmpeg M1 integration；typecheck、旧 H1/H2 回归、owned Harness completion；冻结 six corner cases 和 prompt 后每 case 一次及 real233s，只有 runtime 规定的 Sol 一次升级；MiniMax=0。AOCI 官方维护与 Verify/Check/Guide，保留 foreign 工作树和暂存内容。

**Spec / ADR:** [Hybrid Delta](../../shape-matched-cover-hybrid-v1-spec.md)，2026-10-05 用户 H2C 收缩授权。

## Major Milestones

### 1. Scope and Decision Contract

Create `src/main/shape-cover-vision-corner-policy.ts`、`src/main/shape-cover-vision-corner-schema.ts`；修改 Hybrid spec 分类。policy 独占固定几何与完整分区；新 schema 独占 corner-only 风险字段、严格 CONFIRM partition。边界、面积、确定性与错误输出测试先行。

### 2. Per-corner Runtime and H3 Interface

Create `src/main/shape-cover-vision-corner-semantic.ts`；最小扩展 `shape-cover-vision-router.ts` 支持独立 CORNER session、prompt/schema/context binding 与失败诊断。复用 `buildVisionCandidatePacket`，不新建图像/连接基础设施。结果深冻结、run-local freshness，H3 只经 `getConfirmedCornerTargets` 消费。

### 3. Frozen Development Evidence and Completion

Create corner unit/integration tests、`scripts/shape-cover-hybrid-corner-fixtures.py`、`scripts/shape-cover-hybrid-corner-diagnostic.ts` 及 H2C record；扩展原 Harness 路由。构造 TL product、BL subtitle、BR physical sign、TR overlay/multi/two overlays；真实运行不根据结果调参或重发。验证后 parent risk gate、AOCI、owned commit/push/远端核验，保持所有旧能力。

## Self Review

已按用户 46 项逐项核对：固定范围、local partial、源级关闭、新字段与旧语义兼容、观察不授 mask/运动资格、请求预算独立 H4；无需新批准步骤。主线程单 writer；Kimi deep 只读 frozen H1/H2 reuse mapping，不拥有验收。
