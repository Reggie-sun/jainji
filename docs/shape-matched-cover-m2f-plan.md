# M2-F Static Mask Boundary Engineering Acceptance

## Goal and Authority

依据当前 [Delta Spec](shape-matched-cover-v1-simplification-spec.md#default-m2-static-engineering-acceptance)、[Plan](shape-matched-cover-v1-simplification-plan.md) 和 [Course Correction](shape-matched-cover-v1-simplification-audit.md#m2-qualification-boundary-course-correction--2026-10-02)，执行有限、可重算的 static engineering evidence。Native Codex 串行实施，使用 writing-plans / verification-before-completion；本轮显式 modelRequests=0 覆盖通常委派路线。不调用模型，不创建 worktree。

## Scope and Ownership

- `scripts/shape-cover-static-engineering-corpus.ts`：construction alpha 先冻结，再调用现有 canonical discovery/confirmation/extractor；逐帧比较独立 required pixels，保留正例和精确 1px negative。
- `scripts/shape-cover-static-engineering.py`：离线统一 receipt、历史 freshness、deterministic risk-set、candidate-visible boundary package；复用 M2-B decoder、M2-D comparator 和既有 original ROI risk metrics。不签发 source/product authority。
- `tests/shape-cover-static-engineering.test.py`、现有 `tests/shape-cover-static-holdout.test.ts` bridge：纯工程正反例，不伪造真实 human review。通过已有 policy 路由运行；不修改 foreign dirty policy。
- 本 plan 与 stationary record：保存实际工程结果、支持范围、失败和唯一后续边界。

## Invariants and Compatibility

3395px / bbox628/1/81/59 / SHA fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893 完全冻结。原 M2-A/B/C/D/E 源码、阈值、receipt 和历史失败均不改。开发源 a18f7e4e… 始终 DEVELOPMENT SOURCE；不读取 unseen inventory/media、不进入 M3、不接 knowledge/admission/assembler/renderer。旧 RGB contradiction 是历史 REJECTED appearance criterion，不能改成 false positive。guard 保持关闭。

## Acceptance Contract

独立 construction alpha>0 提供 exact pixel-frame denominator；每个正例全部帧要求 missedRequiredPixels=0、missingRequiredFrames=0，不平均。精确 1px 故意漏失必须拒绝，单独报告其 denominator。受控失败不调算法、不删难例。

真实 lane 只复用冻结 M2-C full[0,6990) geometry 的有限灵敏度结论；验证当前 source、clock、engine、方法/config 与历史 digest。有限 review set 覆盖首尾、正常代表、233/710/715/3764、最强异常、全部 distinct risk signatures、local-offset extrema、edge/background extrema、scene context。优先≤32；若 distinct signatures 要求更多，完整保留并解释，禁止截断。

boundary package 显示 original ROI、边界 overlay、inside/outside 和整数 nearest-neighbor edge view，ordinal/PTS/risk reasons；无预期结论或 confidence。一个具名真人仅回答 mask 外是否存在明显旧贴纸贡献：NO_VISIBLE_RESIDUAL_OBSERVED / VISIBLE_RESIDUAL_OBSERVED / UNKNOWN。缺真人或歧义即 UNKNOWN；不调用视觉模型代替观察，不补签 blind truth。

`StaticMaskEngineeringEvidence/v1` 固定 authority=none / eligible=false；controlled miss、visible residual、geometry contradiction 或已知 source/mask/config 变化为 ENGINEERING_REJECTED；未知 freshness、stale method/geometry、缺 corpus/review/coverage 为 ENGINEERING_INCOMPLETE。只有全部正向工程证据齐全才 ENGINEERING_ACCEPTED，且限定三条 claim。JSON clone 仍是无 authority 的报告。

## Major Milestones

1. 核对 HEAD 和历史 owner；冻结 source/method、controlled construction 与风险选择规则。
2. 执行 controlled corpus 和真实原 ROI 重新 decode/hash；构建有限 package，保留所有失败与性能证据；完成可获得的真人工程观察，否则 UNKNOWN。
3. 统一 receipt、相关回归、typecheck、diff check、owned Harness、官方 AOCI Maintain/Verify/Check/Guide；final diff 后只提交 owned 文件一个 commit。

## Verification and Completion

运行 corpus 真正 canonical extractor、M2-F Python controls、M2-A extraction、M2-B anomaly、M2-C geometry、activation regression。scope 使用 before/after SHA 和当前 policy 的必需检查；foreign/global failure 与 slice results 分开，不改超时/GPU/upload/千川/旧文档链接。AOCI 按实际 role 和官方完整批次维护，不以治理 PASS 覆盖 Harness FAIL。无专用 capture skill时 record 保存 checkpoint。

## Self-Review

工程 receipt 不恢复 private capability，也不修改原 qualification；受控 alpha 不能外推压缩视频完整像素 truth。实际未观察的真实帧/范围明确不声明零漏。M2 product proof 未签发、M3 BLOCKED、PRODUCT_DISABLED；下一边界仅在工程证据明确后设计版本化 confirmed-target proof，未完成的观察优先闭合。
