# H4 QA Consistency Closure

## Goal and Scope

基线 `479740613c09c79329e778703f6a33e7cb608667`，在已有 `feat/hybrid-corner-h4` 工作区关闭 Preview QA 内部矛盾。Native Codex 拥有实现和最终裁决；受管 Kimi 只读调查，不写源码、不执行视觉模型。合同见 [Hybrid Delta](../../shape-matched-cover-hybrid-v1-spec.md)。

## Contract and Invariants

- 唯一决策 owner 仍为 `shape-cover-vision-schema.ts`，请求与完整 receipt 仍由 `ShapeCoverVisionSession` 管理。先检查结构化自洽性，再解析 MiniMax → Sol 的最终判定。
- 明确映射：`PERSON_OCCLUSION_RISK` → `unintendedOcclusion`；`TEMPORAL_INCONSISTENCY` → `temporalMismatch`；`UNDETECTED_OVERLAY_SUSPECTED` → `oldOverlayResidual`。对应 verdict 为 PASS 才构成 contradiction；FAIL/UNKNOWN 不构成这种矛盾。其他 flags 不靠文本推测映射。
- 解析成功与 review 有效性分开。receipt 保留完整 output、riskFlags、raw hash、图片与 packet 身份，增加版本化 consistency 和结构化 contradictions；不删除原 flags，不修改历史回执。
- 首审 inconsistent 且四项全部 PASS，才可由同 packet 的一次独立 Sol 四项 PASS、无 flags 关闭。混有真实 FAIL/UNKNOWN 仍 UNSAFE。自洽真实 FAIL/UNKNOWN 或未解决 risk 不可被 Sol PASS 覆盖。Sol 同样检查自洽性；无效/缺失、错 packet、stale、timeout、取消与 transport 失败仍关闭，无第三审。
- 原 preview prompt/version、provider/model routing 与图片字节不变。H3、mask、motion、选款、placement、coverage、renderer、compiler 与导出准入全部不改；PRODUCT_DISABLED、authority=none，不开始 Activation。

## Implementation and Verification

1. 在既有 vision/H4 tests 增加可复现矛盾、有效 FAIL/UNKNOWN、混合矛盾、Sol 不通过和完整 receipt 的回归；先确认失败，再修改 schema/resolver 与 router 的 receipt metadata。
2. 固定 real233s packet 与12张 PNG，校验 preview/原图/图层/归档及原 receipt 的 hash，使用已取得的 MiniMax/Sol output 对当前 canonical QA 路径做一次 `ARCHIVED_RECEIPT_REPLAY`。真实原审查与本次零 live model requests 的 replay 明确分开；不重新选款、抽图、渲染或调用模型。重核完整 preview decode 和原技术回执身份。
3. 跑 typecheck、H4/vision 与 H3/H4 focused tests；使用按实际 owned paths 路由的 Harness 和 scoped verify。policy 将原 H3 注册文件按现有“不允许重复 testFiles”合同拆为 required `hybrid-corner-h3-focused`（motion/shape）和 required `hybrid-corner-h3`（完整 integration）；H3 route 仍要求二者，H4 QA route 只要求 focused，extended-regressions 不变。原 H3 集成测试本轮仍120秒超时，保留8PASS/1FAIL；开发 READY 不冒充全仓最终 completion，Activation 集成再处理并跑完整 gate，不改 required、不伪造 PASS。
4. 在稳定 candidate 完成 AOCI 逐对象维护、Verify/Check/Guide 和 implementation Review Risk Gate；更新 canonical H4 record，提交本轮文件、push 当前 upstream 并核对远端 HEAD。

## Acceptance and Self-Review

同字节 real233s 技术证据 PASS、uncoveredPixels=0、MiniMax 被明确标为 inconsistent、同包独立 Sol 四项 PASS 且 riskFlags=[]，以及本轮必需 focused/owned verification 均通过时，才标 `HYBRID_CORNER_H4_READY`。该状态仅为 H4 development milestone；产品仍禁用，完整发布/整片人工验收/未确认角落及 Activation 不获准入。

Self-review：覆盖用户本轮八项交付边界；不扩大模型预算或视觉设计；不从 shortReason 推断/删 flag；混合真实失败和 UNKNOWN 有独立否决测试；无效首审/Sol 二审仍保留原失败处理。历史失败只追加新结果，不回写。
