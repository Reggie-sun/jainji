# Hybrid Corner H3 Implementation Plan

## Goal and Scope

基线 `8cac9c44d33a64431026df1084103197dcc94d31`。把 fresh H2 confirmed corners 转成 deterministic frozen PNG，优先 real233s TOP_RIGHT；遵守 [Hybrid Delta](../../shape-matched-cover-hybrid-v1-spec.md)。Native Codex primary，受管 Kimi 只读映射辅助。

## Contract Surfaces and Invariants

- `getConfirmedCornerTargets()` 是唯一 semantic 输入。绑定同一 owned DiscoveryEvidence、sourceKey、candidate IDs 和 receipt digests；clone/stale/cancel 拒绝。partial source 的其他角失败不阻断已确认角。
- 原 `confirmStaticDiscoveryTarget` / `prepareStaticTargetEvidence` / `extractStaticConservativeMask` 原字节复用，包括 multi-component membership 和有限 dilation。mask 保持 M1 默认96张代表帧；密集候选必须唯一且完全处于对应 H2-confirmed component box，否则该角 MASK_TARGET_AMBIGUOUS。H2小图片预算不改 mask 代表帧总体。旧 extractor 的 full-range RGB observations 仅保留 diagnostic；仅 `FULL_RANGE_STATIC_CONTRADICTION` 可不作 Hybrid blocker，其他 mask reasons 均拒绝。不调用 geometry/proof，不修改固定 method SHA。
- H3 独立检查原有 16–32 representative samples（短片全部）：每个 confirmed component 的 mask interior 内局部contrast≥64的reference可追踪点需≥8，再做RGB有限平移匹配。纯色共同内核不变仍可移动，缺信号UNOBSERVABLE；明显移动、消失或不可观察仅跳该角；H2 STABLE 不授 motion authority。contrast来自纯色移动12px的可复现反例，先固定再重跑real233s，不据真实结果调参。
- 复用当前本地内置/有效上传 cover pool，按 ID 排序，最多 256 个（当前实际池超过128）。允许仅裁掉全透明外边；等比尺寸阶梯及小平移搜索限定 corner scope 和输出画布，≤1280尺寸栅格/≤11520摆放/180秒。耗尽是显式 skip，不能当 exhaustive NO_SHAPE_MATCH。
- 复用 pixel gate 的 fully opaque alpha、radius≤8 source px、area≤1.35/span≤1.16 规则；最终解码 PNG 对 projected oldMask 必须 uncoveredPixels=0。无白矩形 fallback、不伸缩变形、不创作素材。
- H3 frozen record 单独绑定 semantic/mask/motion/asset/trim/placement/output/PNG hashes，仅为 H4 几何输入，无 Knowledge Store、生产批准或 export authority。相同字节生成相同 selection、placement、PNG 与 binding digest；文件独占发布，失败清理本操作目录。

## Files and Owners

- 新建 `src/main/shape-cover-hybrid-motion.ts`：固定 sampled motion 算法与结果。
- 新建 `src/main/shape-cover-hybrid-shape.ts`：本地 bounded deterministic placement search。
- 新建 `src/main/shape-cover-hybrid-h3.ts`：H2→mask→motion→shape→freeze 与 fresh H4 交接。
- 修改 `src/main/shape-cover-alpha.ts` / `shape-cover-freeze.ts`：复用 transparent trim、opaque contour 和 PNG roundtrip/publication 接缝，旧冻结行为保持。
- 新建 focused unit/真实 FFmpeg integration tests 与 development diagnostic；Harness policy 登记新 tests/paths。
- 更新 Hybrid Delta、H3 record 与本任务 AOCI entries/baseline；共享 dirty 索引仅提交本轮 owned hunks。

## Major Milestones

1. 对运动/消失、透明孔洞、100% coverage、确定性及 per-corner isolation 先建立 failing tests，再实现 reusable geometry 与 H3 owners。
2. 同一 H2 historical receipt 严格绑定重放 real233s（新增模型请求=0），重新核对3395px/bbox628,1,81,59/SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`，测 motion、真实 pool/search 与最终 PNG。真实 mask 不同则停止该 real case，保留结果。
3. typecheck、focused tests、registered owned Harness、AOCI Verify/Check/Guide、Parent Risk Gate、completion receipt、final diff、commit/push/核 remote HEAD。

## Acceptance and Limits

至少一个 confirmed target 可在真实 FFmpeg 链得到可重复 frozen overlay；移动/消失不能继续；最终 decoded alpha 100% 覆盖。real233s 若 pool 无合适形状，如实 NO_SHAPE_MATCH；预算或工具失败分别报告。sampled motion 不能证明所有未采样帧，coverage 是 mask/PNG 像素关系，不证明视觉自然、内容安全或全片遮挡。

不做 H4视觉QA、MiniMax、preview render、export、UI、activation、Knowledge Store、proof v3；PRODUCT_DISABLED。当前环境 Linux，Windows 未评估。session capture 无 repository 专用 Skill，H3 record 承担 durable checkpoint。

## Self Review

已核对现有 owner 与 pinned strict method sources。不会修改旧 extraction/proof 源文件、阈值或解释；仅复用已有 mask 输出并保留历史 anomalies。固定预算、source freshness、partial 与最终 decoded pixel gate 均独立于模型 confidence。上述全部 scope 由当前用户 H3 请求授权，无额外 approval gate。
