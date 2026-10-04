# M2-H Versioned Confirmed-Target Static Proof

## M2-HC Correctness Closure Contract

本节依据2026-10-04用户 accepted M2-HC contract，覆盖下文旧 M2-H 的下一slice建议，实施仍由 Native Codex 主线程负责。基线 `33ef8ea` 的 v1 仅为 `HISTORICAL_DEVELOPMENT_PROOF / KNOWN_CORRECTNESS_LIMITATIONS`，不再新签发。目标仅关闭 arbitrary-range boundary sampling 依赖和 union-envelope geometry false acceptance。

### Ownership and Milestones

1. 修改前保存真实/controlled [0,6990)、[1000,3000)、双range issuer结果和96个实际ordinal；原M2-C kernel实际运行三个背景主导反例。新增窄 `source-fact-exact-frames.ts`，复用canonical clock/FFmpeg stream/freshness owners，重新核对传入clock，顺序解码按ordinal select，只返回有界full-frame RGBA，不修改M1抽样或receipt。返回source/engine/clock/PTS/endPTS/ordinal/pixel绑定，有限count/bytes/wall、取消及前后generation/hash复核。
2. 新 `cpu-static-geometry/v2` 共享ROI decode，逐confirmedSourceBox独立使用原M2-C梯度/correlation/translation/presence阈值。参考landmarks仅来自sourceBox内部；卷积和search只使用有界邻域。每component保留identity/reference/metrics/range/issues/summary，ALL supported才支持logical target。选择Option A：原3×3/minimum-cell method不能观察的小component明确COMPONENT_GEOMETRY_UNOBSERVABLE，整target INCOMPLETE；不新增小component算法，不降低阈值。
3. 新issuer只创建 `confirmed-target-static-v2`。首尾original evidence来自exact reader，v2将有界原始RGBA字节作为source artifact归档并绑定完整frame描述，避免历史replay依赖当前PNG decoder/FFmpeg。v1仍保留原PNG合同；M1仅提供candidate identity。归档版本各自dispatch不可变validator、mask/geometry配置及CONFIRMED_STATIC_METHOD_V1/V2；只有issuance检查current source/method/runtime freshness。schemaVersion保持1，不迁移旧store；old reader无法消费新variant，downgrade unsupported且必须拒绝、不能reinterpret/overwrite。

### Verification and Exit

新增exact boundary tests覆盖非样本1000/2999、四边界、多target共享ordinal、PTS/endPTS/bytes错误、source/engine漂移、取消。短range reader可用与mask代表帧不足分别验证。geometry v1 historical controls、v2逐component controls及三个pre-fix反例，证明stable disconnected可支持、1px/disappearance/unobservable不能PASS。固定历史v1 fixture可replay但不可new issue；v2 roundtrip/clone/tamper/cancel/dispute及unknown variant拒绝。真实233s仍单target/单component，mask3395px/bbox628/1/81/59/SHA fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893不变，并对旧M2-C建立可解释geometry equivalence。

最后源码修改后fresh typecheck和相关tests；current owned scope Harness code/verify；diff review/diff --check；AOCI Maintain/Verify/Check/Guide及逐path role；Parent Risk Gate，单slice commit。全部exit成立才M2-HC CORRECTNESS_CLOSED，不称PRODUCT_READY。

### Boundaries and Self-Review

M3 consumer、production、assembler、activation、Controller/Runner/compiler/queue/artifact store及upload均不改；M1/M2 mask thresholds不改，不读取210 unseen。Linux/Python/固定NumPy/OpenCV仅development/internal，NOT PRODUCT PORTABLE；Windows runtime策略及per-source boundary applicability留下一slice决策，M3 BLOCKED、PRODUCT_DISABLED、guard unchanged、modelRequests=0。不新增人工review，不声称human-reviewed-real-source、SAFE/NATURAL或REAL_PIXEL_ZERO_MISS。确认集合不缩小；union envelope只供decode/budget/visualization，不是component geometry unit。Self-review已对照用户exit和当前owner，历史v1语义与当前issuance明确分离。

## Goal and Authority

依据用户本轮 accepted contract，将 confirmed-target-only、target-range-bound static 证据接入既有 knowledge schema/store。Native Codex 串行执行，current working tree，保留 foreign 千川/AOCI 改动；explicit modelRequests=0 优先于通常委派。不修改 M3 consumer、production、assembler、activation、queue 或 artifact store。

## Current Source Audit

`SourceMaskAdmissionProofSchema` 仅 source-mask-only-v1；store `checkProof` 的旧 branch 限一个 target/segment、temporal-stability/contact-sheet v1、30–100 帧、两张原图和三份旧审核 artifact。verification 仅 sampled/source-mask-only；`readAdmittedShapeCoverTarget` 和 assembler 仅接旧 proof。M2-C 位于 Python diagnostic，尚无 application-owned geometry object；工程 JSON 不授 source authority。

## Ownership and Geometry Gate

首先新增 `source-mask-static-geometry.ts` live WeakMap owner，通过受控 Python worker复用 exact frozen M2-C v2 kernel，不复制数学、不改阈值。验证 exact owned target/evidence/candidate、source、engine、method bytes、canonical ordinals/PTS/endPTS/ROI SHA；子进程输出仅计算结果，不接受 caller geometry JSON。缺 Python/dependencies、取消、超预算、hash 漂移或数值问题 fail closed，不安装依赖、不承诺打包支持。

先对真实233s完整6990帧比较原 M2-C：global offsets、correlations、peak gap、lost fraction、energy/local extrema、issues/ranges，容差1e-12且离散事实完全相同。不能建立 equivalence 即 INCOMPLETE / OWNED_GEOMETRY_EVIDENCE_NOT_ESTABLISHED；不继续新增 proof。

## Durable Contract

geometry gate 成立后在 `source-sticker-knowledge.ts` 增加 confirmed-target-static-v1 proof variant、bounded confirmed-target-proof artifacts 和 verification=confirmed-target-static；global schemaVersion保留1，旧 variants 不改语义。新 issuer 拒绝 clone，按 targetId/segmentId 确定排序，精确绑定 facts 的全部 confirmed target/segments、confirmation components、mask、clock、full range geometry及固定 method support。envelope 不决定组件 membership。

publication 通过新 `publishConfirmedStaticTargets` API，共用既有 durable append/run/source/base/dispute owner。首次发布要求 live issuer proof；reload只验证已由store持久化的严格proof及artifact字节，不恢复 live ownership。原帧仅保存 first/last bounded PNG；完整geometry存绑定/summary/digests，不存6990 RGBA或完整metrics。不存在 exhaustive source/no-sticker/SAFE/NATURAL/output authority claim。

## Candidate Classification

只允许 exact extractor v2/config、owned supported geometry、且唯一 reason=FULL_RANGE_STATIC_CONTRADICTION 时保留历史RGB signal后继续。其他已知hard reason、未知字符串、缺mask、range/source/config漂移全部拒绝。不改candidate状态或删除133 anomalies。

## Milestones and Verification

1. geometry owner/worker、真实6990帧equivalence；先证明 gate，再进入schema。
2. proof issuer/schema/store branch与registered测试：single/group/multiple targets、exact completeness、全部绑定错配、clone/stale/cancellation/conflict/dispute/reload/tamper、legacy sampled/source-mask-only兼容。
3. 新private qualification store真实整链，3395px/bbox628/1/81/59/SHA fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893，完整[0,6990)，重启读取语义一致。
4. 最后修改后typecheck、相关注册tests、owned Harness/diff、AOCI Maintain/Verify/Check/Guide，final Risk Gate及Parent review，单slice commit；foreign blockers单列。

## Acceptance and Stop

所有用户exit criteria及真实equivalence、durable roundtrip成立才 TARGET_PROOF_READY。M3 consumer仍只认旧proof，M3 BLOCKED、PRODUCT_DISABLED、guard unchanged、modelRequests=0。下一唯一slice为 M3 confirmed-target consumer contract，不在本轮实现。

## Self-Review

geometry计算复用冻结 kernel 而不是信任历史receipt；method-level evidence只来自固定版本contract；runtime证据与durable历史proof分开；store保持唯一 publication/争议 owner。完整confirmed集合不等于完整未知贴纸集合；历史RGB不伪装pixel truth。
