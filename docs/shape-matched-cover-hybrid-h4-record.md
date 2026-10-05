# Hybrid Corner H4 Rendered Preview QA Record

## Outcome

2026-10-06（HKT）。从固定 H3 commit `000f3e6251cd4e4b13d531e2cbd32dfb208b4069` 创建 `feat/hybrid-corner-h4`，工作树 `/home/reggie/vscode_folder/jianji-hybrid-h4`。共享 main 的业务工作未覆盖、回滚或提交。

real233s 完整真实 preview 的技术验证 PASS；正式视觉结论 **UNSAFE / HYBRID_CORNER_H4_NOT_READY**。MiniMax 首答 schema validation 失败，精确 `gpt-6.1-sol` 二审 gate 不可用。没有有效独立视觉 verdict，不宣称残留、误遮挡、自然度或全程视觉 PASS。PRODUCT_DISABLED、authority=none、contentSafety=NOT_EVALUATED 保持；未开始 Activation、UI、正式 export 或 proof v3。

范围与 owner 见 [Hybrid Delta](shape-matched-cover-hybrid-v1-spec.md)、[H4 Plan](superpowers/plans/2026-10-06-hybrid-corner-h4-preview.md) 和 [H3 Record](shape-matched-cover-hybrid-h3-record.md)。H3 record 的历史 completion checkpoint 保留，不用本轮工程结果改写过去。

## Frozen H3 Identity

本轮只消费归档 TOP_RIGHT frozen overlay，未运行选款、placement、扩边或 mask/motion 算法。

| Item | Unchanged value |
| --- | --- |
| Source fingerprint | `sha256:a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf` |
| Mask | 3395px；bbox `628,1,81,59`；SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893` |
| Motion | STATIC_SUPPORTED；沿用原24张 samples |
| Sticker and placement | `local-limited-seckill-go`；`x626,y0,w94,h61`；原 radius=6 |
| Frozen PNG | 720×1280；16802 bytes；SHA `5cf525c17c5121980caba8d34674ea0978a5b964975e3f72efd150e7d1b93896` |
| Frozen RGBA | SHA `bf1fe9e7e9986b10eeb273a05c02800729593c6264e92ce646ec4f3304e70bf3` |
| Binding | `d02dfac0c2bc4b63c3f93a69476cbbe6dfd783b95543a75a3bbbbfab8f43e82d` |
| Deterministic coverage | 原 projected mask 3681px；重新解码同 PNG/RGBA/alpha，uncoveredPixels=0，coverageFraction=1 |

原 PNG 字节复用，不重新生成 deterministic PNG；H3 历史 determinism 证据仍保留。archive binding 校验及 H4 私有 WeakMap 只建立 diagnostic handle，不恢复 H3 live owner 或生产准入。mask、motion、shape search、coverage、placement、freeze、alpha、compiler 和原 export guard 的源码均未改动。

## Rendering and Technical Evidence

使用既有 TemplateCompiler 的空模板，保留原 settings、scale/pad 与编码 owner；将同字节全画布 RGBA PNG 在 `0:0` 叠加，以冻结 range 启用，PNG 循环输入和 `shortest=1` 对齐源结束。原视频 30fps、timebase `1/15360` 保持；音频 `copy`，不重编码。应用原 bounded runner 与无覆盖发布 owner，临时 preview 验证后发布到私有 development 目录，不进原 queue。

私有证据根：`/home/reggie/.local/state/jianji-source-fact-qualification/hybrid-h4-20261006`。

真实可播放产物：`real233s/852084ca-c0f4-468b-9c54-88abd914def5/preview.mp4`，相对上述证据根；SHA `6cfe8331cab4a378fa4c9f14b336f1503c90b949e0a38e1c569fd749bf8136e7`。

- 720×1280；6990 frames；233000ms；逐帧实际 PTS/endPTS 与源匹配，clock=PASS。
- 完整 video/audio 解码 PASS；源与 preview 的编码音频 packet hash 均为 `962d74dedf61670520e9946bf2b1a6e9909295a0b629ad017179eed982e1e199`。
- `technical.json`、同字节 `frozen.png` 和12张实际帧 PNG 在同一 operation 目录；源、原 frozen PNG 和 preview 在模型调用前后重新核验。
- 原图/成片对应 ordinal `[0,1215,1823,3494,4558,6989]`，时刻约 `0 / 40.5 / 60.767 / 116.467 / 151.933 / 232.967` 秒。包含首中尾和原 H3 stationaryMatch 最低的三个不同位置；不是原133条 legacy RGB anomalies 的完整审查。

## MiniMax and Sol Receipts

复用现有 ModelConnections、vision provider、packet、router 与严格 preview resolver，不复制凭据或 provider 生命周期；只传12张 full-frame 图片及 manifest，不发送视频、本地路径或凭据。

MiniMax-M3 一次真实 color capability probe：AVAILABLE。随后一次真实 paired preview QA：receipt status=FAILED，failureCode=VISION_INVALID_OUTPUT，parseFailureCategory=SCHEMA_VALIDATION，output=null。返回文本679 bytes，SHA `10552b8b9624db0df914b5c77a35fa63de04d36c29469cbe3350c94b0bce14cc`。原 router 只保存 hash/字节数/parse 分类，不保存 raw 文本，因此不推测具体哪一字段失败，也不将其称为语义 FAIL 或有效 PASS。

二审 gate 使用原同一 packet digest `19b4e707eae8714d325e4074f43cf36e9058f4a258c2d7b7de66b50513964ee2`，重核12张帧、源、preview 和 frozen PNG，并绑定无效首答 hash。应用 ChatGPT catalog 不含精确 `gpt-6.1-sol`；Sol receipt status=UNAVAILABLE，failureCode=MODEL_IMAGE_CAPABILITY_UNAVAILABLE，output=null。该 gate 未发出实际 Sol generation；不使用历史 alternate 或 parent 看图冒充 Sol 二审。

总实际 model requests：MiniMax capability=1、MiniMax QA=1、Sol=0、Luna=0。没有重试、换型号、重新选图层或投票。真实回执在 `real233s/capability.json`、`real233s/result.json`、`real233s/sol-second-review.json`；失败与 UNKNOWN 保留，最终 UNSAFE。

## Snapshot Boundary

真实一次执行绑定 `real233s/run-once.json` 和封存 diagnostic bundle。随后只调整 QA metadata：PREVIEW frozen candidate 只包含真实 candidateId/sourceBox，去掉 archive 中不存在的 detector signals 占位；reviewScope 进入 digest；无效 MiniMax 首答可有界尝试精确 Sol gate。渲染函数和 H3 输入/PNG 未变。

原始 real run/packet/receipts 不覆写。Sol gate 是原无效首答的补充 gate，不重放 MiniMax；最终代码的新增路径由 fresh fixture/tests 验证。没有声称 final metadata snapshot 已获真实视觉 PASS；若以后解除二审或 schema blocker，须对当时 exact packet/source snapshot 取得 fresh 有效 QA 证据。

`render-function-comparison.json` 对比封存真实执行 bundle 与最终 diagnostic build：归档读取、owner、overlay args、audio hash、render 和 ordinal 选择六个函数的规范化 JavaScript 文本全部相同；其中 render function SHA `794678d9bdeaac709e9dc51d7904debcf5e3e6dd308296e41ce36f34669d0c76`。新 QA metadata 不改变已生成 preview 的渲染行为。

## Visual Observations and Limits

Parent 实际查看六张 COVERED full frames，并对照原图 ordinal 0 和4558：右上角原标识变为冻结的“限时秒杀”图形；这些采样未见明显露边、人物/商品/重要字幕误遮挡、明显不自然大小/位置或图层漂移/重复。此处是有限抽样观察，不是有效 MiniMax/Sol verdict，也没有进行整片人工播放验收；未采样时刻的误遮挡、突变和时序观感仍 NOT_EVALUATED。

左上与下方角落的原图形仍保留。H3 原 TOP_LEFT NO_CANDIDATE、BOTTOM_LEFT/BOTTOM_RIGHT UNRESOLVED 不升级；本轮仅评价已确认 TOP_RIGHT frozen replacement，不能宣称所有旧贴纸已清除。采样 QA 不能替代 deterministic coverage；uncoveredPixels=0 也不能证明 mask 独立真值、未确认角落或内容安全。

## Delegation and Parent Decision

受管 read-only Kimi deep mapping invocation `6bdc199c-fb2a-4887-a3f2-05d834c222b5`，sealed contract `b2b38097-c73b-4ffa-973b-69be13c98815`，seal `a17e90c1b804942e45152542b482e36f60a0f2fa0d6649ac3286b4c85e57d0b5`；Docker containment、canonical receipt、PARSED。未写源码或执行业务/视觉 Provider QA。

Parent 采纳 archive 不恢复 H3 authority、独立 development renderer、原 full-frame packet budget、缺失 CV signals 不编造、最低持久化 motion samples 仅为有限异常采样等建议，并用源码与实际运行核对。Kimi mapping 不替代最终 review 或真实视觉验收。

## Verification and Completion

- 最终 `npm run typecheck` PASS；diagnostic script 的独立 strict TypeScript 检查 PASS。
- frozen owned scope：`.agent/harness/runs/hybrid-h4-20261006/owned-scope-core.json`，九个 implementation/spec/plan/policy/AOCI owned paths；ownedSha256 `sha256:ee4e7a614d5321f99387947f5c3083998c0071b849b5925e6f792172a0a6e938`。本次 Harness 的 participating source/owned/document/policy identity 前后相同，没有共享 main 的 foreign source_changed。
- `.agent/harness/runs/20261005T174438Z-ee7cf469/receipt.json`：2415 tests PASS，0FAIL/0skip，H3专项9、H4真实FFmpeg fixture专项1、Hybrid vision116；typecheck、15个 test groups、documents 均 PASS。包括冻结旧基线下 batch/Qianchuan 相关 tests，本轮无 foreign 业务测试 failure。
- 整体 Harness **FAIL**，唯一失败 `owned-aoci`：官方 scope 将 `aoci.code.txt` 分类为 index，但官方 business-source manifest 不列正式索引资产；现有 Harness 报 `owned_source_missing_from_manifest`。其他八个 owned dispositions PASS，repository AOCI PASS。没有省略本轮正式索引、将其冒充 foreign、改 receipt、required=false 或放宽 gate；未扩展修改 Harness/AOCI 业务控制实现。
- completion verify `.agent/harness/runs/20261005T180531Z-41d0e25c/receipt.json` **FAIL**：其前置要求 finished PASS scoped receipt，不能将17项 PASS 的 FAIL receipt 当作 completion PASS。
- 按仓库 AOCI 规则，仅在此独立工作树执行完整机器批次，维护本轮 indexed 对象与基线继承的 missing/stale 索引债务；业务源码不变。正式改动仅 `aoci.code.txt`、`.aoci/baseline.json`，其他索引/config 未改。官方 Verify exit0、structure_valid/governance_aligned=true；Check exit0/ok=true；Guide exit0/complete=true/next_action=none/findings=[]，证据为私有根 `aoci-record-verify.json`、`aoci-record-check.json`、`aoci-record-guide-final.json`。此官方治理 PASS 与 Harness owned-assets disposition failure 分开保留。
- final Implementation Review Risk Gate 为 **PENDING_NATIVE_VERIFICATION**：完整 owned Harness/completion 未通过，按 SUBAGENTS.md 先报告真实 blocker，不提前调用 final Kimi reviewer或声明 review acceptance。read-only mapping 不冒充最终独立 review。

本次提交是有明确 blocker 的 stable checkpoint，不是 H4 completion。record 本身另走 docs-only owned Harness/completion；其比例适当验证不授全任务 PASS。正式索引资产的 owned Harness blocker 以及真实视觉 blocker 都须关闭后才能宣称 HYBRID_CORNER_H4_READY。

## Session Record and Next Boundary

仓库未发现 dedicated session-capture Skill；本轮 substantial implementation/真实 preview/真实 Provider failure 由本 canonical record 留存，私有原始证据不提交。无 hook 或 capture_request_id 不作为跳过记录理由。

当前不是“只剩 Activation”：还需解除 H4 有效视觉 QA 的 schema/精确 Sol capability blocker，并按 exact snapshot 取得有效 verdict；同时完成正式索引资产的 owned Harness/completion 核验。PRODUCT_DISABLED 保持，本轮没有开始 Activation slice。

## QA Closure — 2026-10-06

用户固定基线 `f4158d136cbed6816190ad8367367df70b7b6a0f`，继续已有 `feat/hybrid-corner-h4` 工作区。上述历史失败与回执原样保留。本轮最终真实视觉 verdict **UNSAFE / HYBRID_CORNER_H4_NOT_READY**；已有有效视觉审查，但 MiniMax 高风险 flags 与 Sol PASS 的冲突仍被原规则关闭。PRODUCT_DISABLED、authority=none，不开始 Activation。

### Diagnosis and Software Changes

历史 MiniMax 首答只保存679 bytes/hash/SCHEMA_VALIDATION，原文与字段级 issues 未保存；transport 使用 store=false，没有可恢复的旧 response。因此无法确认历史具体坏字段，更不能将其臆测为视觉 FAIL。可确认的输出契约缺陷：发给模型的 preview JSON schema 未声明 parser 已要求的 shortReason 1–400字符、riskFlags最多7项。本轮补齐这些边界和单字符串说明，strict parser、视觉枚举与安全 resolver 不放宽；receipt 增加无模型值/未知键的安全字段路径与错误 code，私有 diagnostic 保留新 MiniMax 原文。本轮没有再次 schema invalid，不能把新成功倒推为历史根因证明。

H4 移除单独的6.1-only gate，复用原 Hybrid canonical route 优先 gpt-6.1-sol、不可用时仅 gpt-5.6-sol。无有效 schema/JSON 首审时保留 FAILED receipt，让一次独立 Sol 的有效结果进入 result/verdict；不伪造 MiniMax output。有效首审的高风险矛盾仍由原 resolvePreviewReviews 拒绝；错packet、stale、取消、timeout、provider failure 不走无效schema例外。零模型重试循环。

`--qa-only` 校验旧 packet digest、source/H3、preview fingerprint、原12张PNG SHA与候选身份，只去除假 detector signals 并明确 confirmed TOP_RIGHT partial-processing scope；其他未确认角落不因保留旧图形自动失败。没有重新渲染、mask、选款或placement；图层造成的任意人物/商品/重要文字误遮挡仍必须判断。

### Actual Visual Evidence

私有证据根 `/home/reggie/.local/state/jianji-source-fact-qualification/hybrid-h4-closure-20261006`，真实结果 `real233s-qa/result.json`；packet `c7d0fb196056952f924bb986768b12c40eacc07959f882f509ab8dc5b831c14d`。新的 reviewScope/metadata 形成新digest，但图片SHA全部与历史执行相同。

- MiniMax-M3：一次 color capability AVAILABLE、一次 QA；PARSED，四项 PASS，riskFlags=`PRODUCT_PRINT_RISK`、`PERSON_OCCLUSION_RISK`；raw622 bytes，SHA `8958a2dc8356bb70ea5679246ec8a52de8f9e9a11735c90c81f82332406851ba`。理由称没有重叠/残留/漂移，同时对洗发画面靠近人物表示concern；不能删除其结构化高风险flag。
- gpt-5.6-sol：canonical Hybrid route 实际一次二审，PARSED，四项 PASS、riskFlags=[]；raw466 bytes，SHA `231870d9bca788665cecc897145b1d73d1a9a129c8c9f8d10300ea2b9f483ad3`。未调用gpt-6.1-sol或其他fallback模型。
- 总计 MiniMax capability1、QA1、Sol1、Luna0；原person-risk conflict规则最终UNSAFE。模型reason与flags不一致不是schema invalid，也不授权将flag抹掉或以Sol投票覆盖。

首次本地入口误指定不存在的 `/usr/bin/ffmpeg`，在archive PNG decode阶段即停止，Provider requests=0；失败目录`real233s`保留。修正为应用已下载工具链后用独立目录执行一次真实QA，不恢复或重放任何已发请求。

`h3-unchanged.json`证明原preview SHA `6cfe8331cab4a378fa4c9f14b336f1503c90b949e0a38e1c569fd749bf8136e7`、12张图片SHA、完整technical回执全部相同；compiler、H3、motion、shape、pixel gate、render、alpha、selection八个源码文件与基线逐字节相同。原PNG/placement/binding、uncoveredPixels=0和233s/6990帧保持；没有新的整片观看验收声明。

### Harness Ownership and Delegation

根因：scope explain 将aoci.code.txt分类为index，business-source-manifest不包含正式索引资产；官方Verify却将其声明为code volume。Harness现在从一致Verify/Check/Guide的root/meta/code/database声明核对正式path/asset_state/SHA及磁盘字节，不要求索引为自身建立Entry。正式资产必须存在、启用、全库对齐、无recovery/conflict；普通source仍要求manifest/baseline，required不变。负向回归覆盖hash/缺文件/漂移/跨快照/删除/无官方声明，未改业务算法。

受管Kimi deep只读diagnosis invocation `38e63bd2-6c1d-497e-9f55-6446ab692050`，seal `e547bd7b93b4498befda3d4609d1b35f1f75f7d94b12a039677f8f07dc8d20e5`；Docker、k3[1m]/max、canonical receipt PARSED，3 wire requests。它只读冻结的历史Harness/官方Verify，并未审最终实现或宣布验收。Parent用实际scope/manifest/当前Verify确认其ownership诊断，采用per-object正式资产binding、独立跨快照hash比较及contract clarification；对其“必须required字段/支持disabled volume deletion”的建议不扩大本轮：缺声明仍不能放行owned正式文件，当前只修present volume modify。

仓库没有dedicated session-capture Skill；本canonical record承担本轮软件修复与真实模型证据的durable closure。原私有证据、历史FAIL、unknown状态均不覆写。

### Verification and Blocked Completion

最终 implementation snapshot：基线 `f4158d136cbed6816190ad8367367df70b7b6a0f`，12个 core owned paths 的逐字节hash封存在私有 `final-implementation-snapshot.json`；scope文件SHA `aadb5d0c2523ef7657e8ce4b7494939f2d599a46df86253623f45cc7c2d06550`。真实QA所绑定的adapter/router/diagnostic源码未在请求后改变。本record独立归入docs-only owned scope，不用record验证冒充core完成。

- `npm run typecheck`、diagnostic独立strict TypeScript检查、8个相关test files的195项测试均PASS，无失败/skip。无效首审/Sol PASS与正式资产ownership先复现失败，再修复通过；不靠降低schema或required。
- 完整core Harness `.agent/harness/runs/20261005T181848Z-2ce8eb61/receipt.json` **FAIL**：已形成报告的1443项PASS、1项FAIL、0skip；typecheck、H4 fixture、Hybrid vision128、文档17项和owned-aoci十二个dispositions均PASS。H3 fixture在既有120秒上限超时（8PASS/1FAIL）；extended-regressions达到既有1800000ms上限，为required **NOT_EVALUATED**，没有完整report，不能计入通过数。
- 不改任何H3源码或测试时限，对相同H3组做一次限定CPU范围的有界诊断，仍为8PASS/1个120秒timeout，证据`h3-timeout-investigation.report.json`。观察到宿主load约35–38，但这不是已证明的唯一根因；不以负载解释替代PASS。停止重复测试尝试，不终止或调整其他用户进程。
- core completion `.agent/harness/runs/20261005T190717Z-f556fc75/receipt.json` **FAIL**；失败的core receipt不能获得completion PASS。原`owned_source_missing_from_manifest`已消除，正式code volume按当前官方path/hash核验实际PASS；剩余验证阻断为上述timeout，不是治理声明不一致。
- AOCI逐项角色：三个修改源码为index且完整官方批次维护；aoci.code.txt为正式index资产，无self Entry；baseline为exclude；其余spec/plan/tests/diagnostic为observe。最终官方Verify/Check/Guide均exit0、governance_aligned=true，Check ok=true，Guide complete=true/next_action=none/findings=[]；证据`aoci-delivery-verify.json`、`aoci-delivery-check.json`、`aoci-delivery-guide.json`。未修改root/meta/config或全库无关业务对象。

Implementation Review Risk Gate 状态 **PENDING_NATIVE_VERIFICATION**：绑定上述exact snapshot、accepted spec/plan及失败回执。用户没有要求该snapshot的Kimi final review；本开发QA不授生产authority，治理核验不写业务或durable生产状态，未发现关键级凭据/越权/不可恢复损坏路径。第三条件须在project-native verification完成后判定；当前required verification未通过，按SUBAGENTS.md先报告真实blocker，不提前消耗final reviewer请求或声称review acceptance。Kimi只读ownership diagnosis不冒充最终实现review。

本次是有明确阻断的stable checkpoint：真实TOP_RIGHT QA有效但高风险冲突导致UNSAFE，完整Harness/completion也未PASS。因此不授予HYBRID_CORNER_H4_READY，不是只剩Activation；PRODUCT_DISABLED保持，未执行Activation。
