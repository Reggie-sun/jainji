# M2-G Multi-Component Static Target Confirmation

## Goal and Authority

仅修复一个逻辑 static target 只能确认一个 discovery component 的建模缺口。依据 [Delta Spec](shape-matched-cover-v1-simplification-spec.md)、[主Plan](shape-matched-cover-v1-simplification-plan.md)、[M2-F](shape-matched-cover-m2f-plan.md) 及用户本轮明确范围；Native Codex 为唯一串行 writer，不创建 worktree。modelRequests=0 优先于通常委派规则，不发 Kimi 或其他模型请求。

## Discovery Decision

先重跑历史 disconnected-components 的原 M1：4×4 contribution x83..86/y41..44 是独立 CANDIDATE，id `657afc01600a193b50e7080856918291568c4941540e5a17a59e287831e61888`、sourceBox81/39/8/8、stablePixels16、edgePixels13、原像素stableFraction1。完整两 component table 保存于 `~/.local/state/jianji-source-fact-qualification/m2g-20261004/discovery.json`。Case A 成立；不修改 M1 或 mask thresholds。

## Contract Surfaces and Ownership

- `source-mask-static-target.ts`：新 `confirmed-static-target-development/v2`；单 ID 输入仅作 in-process API compatibility，内部统一 `confirmedCandidateIds[]` / `confirmedSourceBoxes[]`，绑定每个 component digest、source/discovery/result/target/range/confirmation source。拒绝重复、空、未知、跨源 IDs、caller box/mask；WeakMap 不从 JSON 恢复 ownership。
- `source-mask-static-extraction.ts`：v2 membership 为 intersectsAny(confirmedSourceBoxes)；union envelope 只用于既有 12px padded ROI 与预算，不能决定 membership。extent/margin unresolved 仍 INCOMPLETE。
- `shape-cover-static-engineering-corpus.ts`：固定 construction logical identity 后匹配 M1 group，再冻结 group/extract；alpha 只用于 construction/comparator，不传产品 owner。完整19正例及1px negative。
- `shape-cover-static-engineering.py` / diagnostic：保存新方法和真实重新提取证据，验证旧 geometry 全范围绑定并重建 M2-F v2。旧 review identity 专门保留，当前 confirmation 单独绑定；合法复用需逐字节相同 package 与原 actual user evidence。
- 既有 `source-mask-static.test.ts` / Python engineering controls：扩展原注册 seam，不新增 foreign policy 改动。
- 本 plan、最小 Delta Spec 和 stationary record：保存方法修复、实际结果与停止点。

## Invariants and Compatibility

不改 M1 thresholds、dilation3、预算、geometry thresholds、construction alpha/truth/comparator分母。原 v1 receipts 原语义保留，不自动迁移。源仍 DEVELOPMENT SOURCE；真实3395px、bbox628/1/81/59、SHA fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893 必须完全相同，否则STOP。历史133 RGB anomalies保留。没有UI、自动 proximity grouping、unseen/holdout/M5/M3或产品模块改动。

## Major Milestones

1. 已完成 M1 复现；扩展显式组合同及产品边界负例，先取得旧实现失败证据再实现。
2. 冻结新方法后完整跑19正例、1px negative及233s single-component regression；逐帧ROI/clock/geometry重新绑定，重建70帧包，逐项比较review-set/assets。不一致即 HUMAN_REVIEW_REFRESH_REQUIRED，不制造新真人答复。
3. 最后修改后 typecheck、target/extraction/engineering/anomaly/geometry/activation tests、owned Harness与diff；官方 AOCI Maintain/Verify/Check/Guide，foreign漂移单报。仅本轮文件一个 verified commit。

## Acceptance and Stop

19/19 complete，requiredPixels183693、missedRequiredPixels0、missingRequiredFrames0；disconnected old480→new0；intentional negative保持miss1/frame1/max1且拒绝；未选中间/附近文字component不收入，遗漏confirmation由comparator暴露。真实mask与review包严格相同且合法复用观察，geometry有效、freshness全部成立才允许新 M2-F ENGINEERING_ACCEPTED。只允许三条限定工程claims；M2 product proof未签、M3 BLOCKED、PRODUCT_DISABLED、guard unchanged。唯一下一slice为 versioned confirmed-target proof。

## Self-Review

显式集合与搜索ROI分开；construction身份匹配不由comparison反馈修正；组件JSON摘要不授authority；真实RGB与geometry证据不等于真实alpha truth。confirmation方法变化不改旧receipt或旧review身份，新receipt绑定两者及byte-equivalence证据。仅相关owner修改，保持原产品拒绝。
