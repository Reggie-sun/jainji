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
