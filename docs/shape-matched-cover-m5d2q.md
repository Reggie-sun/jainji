# M5-D2Q Human Full-Canvas Review Method Qualification

## Status

2026-09-28 engineering candidate。正式结果为 `INCOMPLETE`，真实 human run 为 `NOT_STARTED`。没有生成 HumanReviewMethodQualificationRecord、qualified reviewer record 或生产 semantic PASS。当前只完成源码核对、受控数据/criteria 冻结、比较与 orchestration 设计及工程测试。

保持 `PRODUCT_DISABLED`、M5-B activation disabled、M5-C issuer BLOCKED、M5-D3 BLOCKED、M5-D4 BLOCKED、verified-no-sticker production issuance BLOCKED。即使后续 D2Q 全部门槛满足，下一步也仅是 D2 Production Qualified Review；本数据不能充当用户源视频的 semantic proof。

本记录不包含逐 fixture 的场景标签、真值数量、位置或预期答案。拟担任 reviewer 的人不得读取作者侧 package、freeze-summary、fixture recipe 或 correspondence/score。

## Source-Grounded Call Path

已读取 AGENTS、V1 spec/plan、M5-D/D1/D2 checkpoint、D1/D2 source/tool/test，以及 identity、knowledge、mask admission、request assembler 和 activation owner。实际调用关系为：

`collectFullSourceCensus → prepareFullCanvasReviewEvidence → createFullCanvasReviewSession → begin → browser raw RGBA Canvas readback → acknowledge → record(TARGETS / EMPTY / UNKNOWN) → finish`。

D1 校验完整解码时钟、源/引擎 bytes 和所有 RGBA 帧。D2 evidence 再解码并核对同一 censusDigest 与逐帧 SHA；session 的 presentation token 绑定 evidence/ordinal/PTS/endPTS/pixelSha256/byteLength，record 必须已 acknowledge。finish 要求每个 ordinal 完整且再次 fresh 校验证据，冻结原收据摘要。现有 knowledge 的 sampled reviewedRanges 和静态 source-mask-only 不证明全源语义完整性，assembler/activation 仍拒绝成功签发。

原 D1、D2 evidence/session、HTML、原 D2 tests、renderer、C assembler 和 B activation 字节不变。仅本地 D2 `.mjs` 增加 parent-only session/accepted-command/frozen-receipt IPC：正常独立启动时无 IPC；外层运行时每个 export 等待对应 parent ACK，期间拒绝下一次 POST，避免失败门尚未判定就继续采集。没有第二套 semantic declaration schema。

原 D2 receipt 固定 `authority=none / eligible=false / semanticReview=RECORDED_NOT_QUALIFIED / methodQualification=NOT_EVALUATED`，unverifiedIntervals 仍覆盖全 horizon。Canvas readback、点击和 reviewerId 都不能证明真实人的注意力、完整性或身份。

## Frozen Protocol

`src/main/source-fact-qualification-contract.ts` 为 criteria/schema/digest owner；`source-fact-qualification-compare.ts` 为只读比较和错误计算 owner。criteriaVersion 为 `human-full-canvas-qualification/v1`；methodId 为 `explicit-human-full-canvas/v1`；presentationVersion 为 `d2-original-size-canvas/v1`，指上述保持字节不变的页面呈现；reviewSchemaVersion=1。

criteriaDigest：`1e6ac0108220d6743fc596e99507395fa4015ba11462320b1b4a656047a16189`。冻结标准没有依据测试分数调整；没有正式 human run。变更 criteria 或 method/presentation 需新版本及完整重跑，旧 run 不继承。

| Metric | Frozen acceptance / counting |
| --- | --- |
| falseEmptyCount | 0；KNOWN T(f) 非空却声明 EMPTY，首帧发生即锁定 NOT_QUALIFIED，停止后续资格采集 |
| missedTargetFrames / targetFrameRecall | 0 / 1.0；按每个 truth target × ordinal 计数，明确目标帧的 UNKNOWN 也不能满足 exhaustive recall |
| multiTargetMissCount | 0；每个并发帧有任何真目标未完整列出则计该帧 |
| boundaryErrorFrames | 0；逐 target 的 truth/declared active ordinal 集合对称差，不能按近似时间匹配 |
| singleFrameAppearanceMisses | 0；连续活动 segment 只有一帧且未列出该目标 |
| bridgedAbsenceIntervals | 0；同一 truth identity 两段间的缺席被连续声明覆盖 |
| missedUnknown | 0；TRUTH_AMBIGUOUS 被强行声明 EMPTY/TARGETS，不需 correspondence 才能证明该错误 |
| unnecessaryUnknownRate | ≤5%；unnecessaryUnknownCount / 明确可判定 frames；至少100个 clear frames，样本不足 INCOMPLETE |
| falsePositiveTargetFrames | 0；声明无真目标、错误持续目标或同帧重复对应；rate 分母为所有 declared target-frame pairs |
| identityMergeErrors | 0；同一 reviewer UUID 对应不同明确 truth identities，计额外 identities |
| identitySplitErrors | 0；同一明确 truth identity 对应多个 reviewer UUID，计额外 UUID |

UNKNOWN 合法且不会被转成 EMPTY。明确 target 帧选择 UNKNOWN 会产生 recall/boundary miss；真实语义/identity 歧义应 UNKNOWN。usable clear sample 不足时不据5%比率判断失败，但已经证明的 hard semantic error 仍不能抵消。首个 false EMPTY 的返回是部分诊断，metricsComplete=false，未评估指标不得被默认零值误读为通过。

coverage 要求至少3个独立 fixture groups、100帧、10 truth EMPTY、20 target-present、5并发帧、3单帧 appearance、3切镜、3 moving/animated、3明确 ambiguity cases，且覆盖用户18类。额外固定 clear-frame usability 样本下限100；这是受控观察门槛，不是总体错误率或真实媒体泛化的统计证明。

## Dataset and Truth

最终冻结 datasetVersion=`d2q-controlled-3x18x8/v1`，三种独立构造的 scene recipes、54个匿名 media clips、432帧。全部明确标记 `SYNTHETIC_CONTROLLED`。未创建或声称验收真实用户媒体 truth fixtures。合成背景包括字幕、商品文字、UI、人物及商品图案；recipe 包含独立静态/移动/动画及附属元素、闪现、首末帧、切镜、并发、小目标、边缘、低对比、半透明细边、再现与真实可观察歧义。identity ambiguity 有真实切镜、相同外观目标及失去跨镜关联的画面，而非只给 case 一个歧义标签。

authorId=`controlled-fixture-author-codex-20260928`，creationVersion=`controlled-rgba-recipe/v1`，truthReviewVersion=`recipe-and-canonical-decode-audit/v1`。这是独立 construction/bytes audit，不是人工 qualification 或真实媒体审核。每帧继承冻结 truth root 的 author/version，明确记录 KNOWN T(f) 或 TRUTH_AMBIGUOUS，并绑定 fixture/source/census/ordinal/原 PTS/endPTS/SHA/length；目标保存 truth identity/category/state 及作者侧 correspondence bbox。bbox 不成为 source mask、placement 或 coverage proof。

媒体使用当前 D1 支持的 H.264/yuv444p、CPU 编码、无 B frames、原尺寸 square progressive SDR；没有扩展 D1 profile。fixture 初次 RGB 编码的 gbrp 被原 D1 拒绝，改用已支持格式。真值绑定实际 canonical 解码 RGBA，逐帧 D1 SHA 完全一致；另核对 nominal recipe 与 RGB↔YUV 解码每通道偏差≤3，不把绘制 buffer 冒充 decoded bytes。cut/ambiguous anchors 按独立实际边界统计，单帧活动由 truth ordinals 推导。

最终作者侧冻结包：`/home/reggie/.local/state/jianji-source-fact-qualification/d2q-controlled-v1-20260928-r2/qualification-package.json`。采用 exclusive write，不覆盖既有包；旧中间包不用于当前 run。

- datasetDigest：`f157427439e5ca8d85e1dde13207b28308c1162ec7b52a0a4449d3a5196cc1e4`
- truthDigest：`5291ff9d5ca5ce1aa2f7528a633c0e2ad9b7b27000fbced373a575347607d5ac`
- frozenAt：`2026-09-28T13:08:06.638Z`，早于任何拟执行的正式 human session。

作者侧 freeze-summary 核对全部 minimum coverage；实际逐项 truth counts 留在私有作者资料，不能在 reviewer 页面或运行终端展示。load 会复查 package digest、method/tool source snapshot、真实媒体 hash/length/realpath。任何 snapshot 漂移需冻结新包。

## Correspondence and Independence

reviewer 通过现有 D2 自行建立 UUID；truth author 的 ID 不显示给 reviewer。禁止直接比较 UUID 字面相等、按 label 模糊匹配或复制真值答案。`independent-post-receipt-frame-correspondence/v1` 事先固定：收据冻结后，由不同于 reviewer 的 truth author 逐 fixture/ordinal/reviewer UUID adjudicate 对应 truth identity，或显式 null（无匹配）；无法唯一对应保留 unresolved，INCOMPLETE。sidecar 绑定 dataset/truth/review receipt bundle 摘要；不能修改原 receipt。逐帧映射允许表达 reviewer 错误 merge/split，随后 comparator 对全部活动 ordinals 及全序列 UUID 一致性作 deterministic 比较。

本地工具能隔离 reviewer 的 HTTP surface，不能阻止同一 OS 用户自行阅读作者侧文件，也不能认证人的身份或注意力。自报不同 reviewerId 和 JSON SHA 都不证明 independence/blinding。正式 run 前须由 Parent 记录真实 reviewer 身份、未参与 truth authoring/接触真值、只用原 D2 controls 的人类操作条件；run 后须核对相应 provenance 及 correspondence。没有这些独立事实时 INCOMPLETE，禁止 caller qualified=true 或其他自报 boolean 升级。

## Result and Authority Boundary

离线 comparator 的 `comparisonStatus=QUALIFIED` 只表示输入诊断的指标匹配；其正式 `qualificationStatus` 仍固定 INCOMPLETE、qualificationRecord=null、authority=none、evidenceClass=OFFLINE_COMPARISON_NOT_HUMAN_QUALIFICATION。已证明语义 hard error 返回 NOT_QUALIFIED；缺绑定/receipt/mapping/coverage/provenance 返回 INCOMPLETE。

HumanReviewMethodQualificationRecord 的严格 schema 包含用户要求的版本、全部 digests/metrics/identities、timestamp/source snapshot，并补充 humanEvidenceDigest/correspondenceDigest。当前没有正式 qualified record issuer 或可信 record restore/consumer。schema validation 不是 owner issuance；serialized record 不恢复 capability。这个边界是本轮设计/测试的停止 gate，不能把未来 owner 的条件写成已实现的 formal human acceptance。

`collect` 是原 D2 记录采集 runner，并非 qualification 快速模式。它使用匿名源文件、随机 fixture 顺序，只向 reviewer 输出正常 D2 URL/metadata；每次 accepted declaration 在 parent 决策前不能继续。首个 bound false EMPTY 写独占负结果、杀掉该 session、停止剩余 fixtures，collection intent 阻止同 run 重跑。无完整 receipt 时仍保留 accepted bound failure evidence；环境中断为 INCOMPLETE。收集全片也只留下 INCOMPLETE，不能自动签发 qualified 记录。

## Verification Evidence

`verification-before-completion` 已读取并执行。自动化选择只出现在明确标记的测试中，未用于 human qualification。

| Verification | Evidence |
| --- | --- |
| Full project typecheck | `npm run typecheck` exit0；`/tmp/jianji-d2q-typecheck-delivery.log` |
| Qualification arithmetic / binding / transport | 2 files /43 tests，0 failed/0 skipped；`/tmp/jianji-d2q-tests-delivery.log`；覆盖所有硬门、首中末 false EMPTY、漏并发/小/边/低对比/moving/animated、absence bridge、merge/split、真歧义、5%边界和小 clear sample、冻结/损坏/token/映射/伪造参数 |
| Existing D1/D2/D/knowledge/mask/C/B related regression | 8 files /244 tests PASS，0 failed/0 skipped；同一次相关运行含当时34个新测试，共10 files /278；`/tmp/jianji-d2q-related-final.log`。随后新 comparator/test 的变化由上述43 tests重验，旧8组依赖字节未变 |
| Required shape regression | 1 file /101 tests PASS，0 failed/0 skipped，158.58s；`/tmp/jianji-d2q-shape-regression.log`；外层300s有界，不放宽原单项 timeout |
| Real controlled dataset freeze | canonical D1 + independent raw decode checks exit0，覆盖门槛满足；`/tmp/jianji-d2q-frozen-stable.log` |
| Live immediate false EMPTY stop | `tests/helpers/source-fact-qualification-stop.mjs` exit0；`/tmp/jianji-d2q-live-stop.log`；AUTOMATED_NEGATIVE_TEST_NOT_HUMAN，不启动后续 session；测试私有 run 已清理，不成为正式 human run |
| D1/D2 core / HTML / renderer / C / B guard hashes | 与 D2 checkpoint 完全一致，见下表 |
| AOCI | 官方完整2项 batch Apply、remaining=0/finding_count=0；Verify/Check/Guide exit0，governance_aligned=true、complete=true/next_action=none；Code 176 entries；`/tmp/jianji-d2q-aoci-{verify,check,guide}-final.json` |

最初 baseline D2 三项出现原5000ms timeout；没有改原 tests 或提高 timeout，后续同原合同完整运行28项 PASS。新增 endpoint false EMPTY 测试先因测试真值对同一 identity 的描述冲突而失败，修正测试作者侧不一致后通过。历史失败保留日志，不改称首次全绿。没有 full suite、Windows 实机、真实用户媒体、人类完整盲审、M5-E 泛化或生产 semantic admission 证据。

| Frozen file | SHA256 |
| --- | --- |
| source-fact-census.ts | 4c590e47ca0697e3aabffc8a9770f91985d60c0a904a8f1fd217fb571c694609 |
| source-fact-census-clock.ts | edac94e80e4fde83202e8af9f85d6deec76a4c503125bdb6c5f70a294f77cfca |
| source-fact-review-evidence.ts | 2ec3ab9f4cb1ce7ad5694d0ce91b873ad43c25c3dc79d4bd3ad8287cf08751fa |
| source-fact-review-session.ts | f201e87ba1abc5b6f6a9a80dd006a6e3482144fb0b97673db2ef55bc97106dfd |
| source-fact-review.html | ea6558225763049ded2791bdb2e4e07e31ed9105c17e14439b3d8c95675b20e4 |
| source-fact-review.test.ts | 35c6db04935cd233670e96ef5a33a088099ee34eb3b7267a9b892e272a7e0309 |
| shape-cover-render.ts | 15e307dedb8698900a22d4b0db4ecfb7383a413bd4a7a08d074f4fdc35838da7 |
| shape-cover-activation.ts | c9376550656efc78da113de420d8e76530c703fc40d15ef950777d87fe094cb6 |
| shape-cover-request-assembler.ts | 9d0f0f1ce7384e90d572d98a58b413cfd65e9ed33468f4e58d790a8517b881bd |

## Parent Review and Session Record

受管 Kimi worker 做 read-only D2 mapping；invocation=`de6baf01-0ecb-424f-825b-bc0083f883ac`、qualified route=`27ba7e0c-32b1-41a9-8210-4f49474e0a30`，canonical receipt `/tmp/jianji-d2q-kimi-receipt.json`；已核对 sealed scope、完整 Reads/SHA 和实际 api.kimi.ai/k3-256k/high route。它没有审阅最终新增实现，也没有执行人类资格。Parent 采用独立 correspondence 与身份/收据来源限界；不采纳无法由原 receipt 支持的自动几何匹配建议。

stable code snapshot：contract `a162d98d6d40a8e9f33b2f6079d2b242a7fa4e803659e3c2b7598ad02d3e7315`，comparator `c4c9347cdc522d9f92495aff08b7943e05d4afc08d5db1f545ea7c44a23688bd`，tool/source 13项完整 SHA 已绑定冻结 manifest。适用 global SUBAGENTS Implementation Review Risk Gate：用户未要求本 snapshot 独立 Kimi review；无凭据处理、production consumer、正式资格 issuer 或 durable product 状态写入，错误离线指标没有 authority 升级路径；真实人和泛化缺口被 explicit INCOMPLETE gate 保留。project-native negatives、真实 bytes/transport/立即停止及既有 regressions 已覆盖当前实现。三种 trigger 均不成立，`KIMI_REVIEW_NOT_REQUIRED`，Parent 保留最终裁决。

本 milestone 是项目历史 evidence owner。已主动评估 session capture：当前没有 repository dedicated capture hook/ledger 接口；通用 experience-capture 仅适用于对应 Stop request，不创建外部 memory 或重复 phase ledger。AOCI完整传输已确认，strict cognition attestation未通过；不据此声称完整系统框架掌握，工程结论来自已核对源码/tests，治理对齐来自 Verify/Check/Guide。

## Human Stop Gate and Next Steps

**现在停止在 INCOMPLETE，不启动正式 qualification。** 下一步先登记一位真实 reviewer 的稳定 reviewerId，并由其说明：未参与制作真值，未读取作者侧文件或场景/预期答案，愿意逐帧手工操作。若 reviewer 已经看过 recipe/truth/分数，该人不能用当前包做正式 blinded qualification，须换独立 reviewer 或新包。Parent 尚须核对该独立性与盲审/provenance安排；单报 ID 不自动成立。

以下命令供条件核对完成后的独立 reviewer 使用，`reviewer-id` 必须替换为其稳定身份；run 目录必须尚不存在。不要启动自动化填写，也不要打开作者侧 qualification-package/freeze-summary/recipe/correspondence/result。

```bash
cd /home/reggie/vscode_folder/jianji
export JIANJI_FFMPEG_PATH=/home/reggie/.config/jianji/tools/ffmpeg/bin/ffmpeg
export JIANJI_FFPROBE_PATH=/home/reggie/.config/jianji/tools/ffmpeg/bin/ffprobe
node scripts/source-fact-qualification.mjs prepare \
  /home/reggie/.local/state/jianji-source-fact-qualification/d2q-controlled-v1-20260928-r2 \
  reviewer-id /home/reggie/.local/state/jianji-source-fact-qualification/d2q-human-run-v1
node scripts/source-fact-qualification.mjs collect \
  /home/reggie/.local/state/jianji-source-fact-qualification/d2q-controlled-v1-20260928-r2 \
  /home/reggie/.local/state/jianji-source-fact-qualification/d2q-human-run-v1
```

终端每次输出一个 `http://127.0.0.1:<port>/<token>/`，在正常浏览器打开。原尺寸完整 Canvas 呈现并 acknowledge 后，逐 ordinal 看完整画布：有旧贴纸时手工填完整 TARGETS 列表；同目标沿用该片此前 UUID，多个目标全部列出；确无旧贴纸时点 EMPTY 并显式确认；语义或身份不能可靠判断时 UNKNOWN 并填原因。每帧提交，完成该片点冻结收据，再打开下一 URL；不得跳帧。工具正常 controls 不显示 truth/场景/评分/资格结果。若 session 停止，不用另一 run 继续稀释；由 Parent 读取作者侧终态。

全部真实人工记录完成后，Parent 接收原 receipts、独立 correspondence 和身份/盲审/真实人操作证据，核对原 bytes/criteria 提前冻结及所有用户退出条件。当前工具本身不会把这一步自动认定为 QUALIFIED；正式 owner issuance 仍需 accepted human-evidence contract。任何零容忍失败 NOT_QUALIFIED；缺少独立事实 INCOMPLETE；只有全部24项真实满足才能宣布 M5-D2Q PASS。即使之后 QUALIFIED，D3/D4/C/B 保持 BLOCKED/PRODUCT_DISABLED。
