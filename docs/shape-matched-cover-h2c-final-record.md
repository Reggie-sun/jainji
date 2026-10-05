# H2C Final Acceptance Closure Record

## Scope and Authority

2026-10-05 用户H2C-Final授权，基线3c9e058380312c2bc777a9edfa4d0a6448e92b1d。仅关闭corner grouping escalation与固定provider validation；采用[Hybrid Delta](shape-matched-cover-hybrid-v1-spec.md#h2c-final-acceptance)及[Plan](superpowers/plans/2026-10-05-shape-cover-h2c-final.md)。[旧H2C记录](shape-matched-cover-hybrid-h2c-record.md)及其失败、run-once和continuation永久保留原解释。

## Root Cause and Correction

needsSol仅识别UNKNOWN、非STABLE、risk和group UNCERTAIN，Luna两个clean singleton CONFIRM不升级。同时highRiskDisagreement将Luna多组/Sol合组当冲突。新增同角CONFIRM数>1且groups>1的一次Sol升级，拆出semanticUnresolved作为最终风险门，防止Sol最终多组误走升级条件。纯grouping差异允许Sol独立resolve；明确class/decision冲突保留CORNER_MODEL_DISAGREEMENT，任一模型explicit motion仍UNRESOLVED_FOR_STATIC_V1。无第三模型、重试或无条件合并。

## Frozen Provider Validation

独立H2C-final-provider-validation，固定原product-print、subtitle、multi-component、two-overlays四case。请求前冻结MP4/input/construction hashes、prompt hybrid-corner-overlay-semantic/v1、CornerDecisionSchema/v1及schema源SHA、exact模型ID、runtime源SHA和construction语义。每case一次正常M1→Corner→Luna→conditional Sol runtime。当前catalog无gpt-6-luna/gpt-6.1-sol；沿用accepted Hybrid授权的gpt-5.6-luna/gpt-5.6-sol，freeze后不切换。未调用MiniMax。

| Case | Luna | Sol | Final | Requests L/S/M |
| --- | --- | --- | --- | --- |
| product-print | REJECT PRODUCT_PRINT/STABLE，PRODUCT_PRINT_RISK | REJECT PRODUCT_PRINT/STABLE，保留risk | UNRESOLVED / CORNER_SEMANTIC_UNRESOLVED，无target | 1/1/0 |
| subtitle | REJECT SUBTITLE/STABLE，无risk | 未调用 | NO_OVERLAY，无target | 1/0/0 |
| multi-component | 两个CONFIRM OVERLAY_STICKER/STABLE，无risk；两singleton groups | 同样两singleton groups | UNRESOLVED / CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED | 1/1/0 |
| two-overlays | 两个CONFIRM OVERLAY_STICKER/STABLE，无risk；两singleton groups | 同样两singleton groups | UNRESOLVED / CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED | 1/1/0 |

总实际请求Luna=4、Sol=3、MiniMax=0，四case均有PARSED模型结果，provider transport failure=0。product-print负例安全，但risk未被Sol清除导致自动率降低。controlled multi-component此次真实模型未合并，不能声称真实2-component target acceptance；hard grouping dispatch已实测，合并成功路径由runtime单测证明。按用户简化READY标准第4项验收的是hard grouping路径；该case安全UNRESOLVED记录为能力限制，不伪造CONFIRMED，不继续benchmark。

初始显式FFmpeg路径/usr/bin/ffmpeg不存在，在prepareDiscoveryEvidence阶段终止，尚未进入semantic runtime且模型请求为0。保留该seal/reservation和zero-request-preparation-failure.json；核对实际应用FFmpeg后独立封存provider-validation子目录。无未知provider结果、无付费重发。所有私有输入/响应/回执保留于`/home/reggie/.local/state/jianji-source-fact-qualification/H2C-final-provider-validation-20261005/`，不提交。

## Real233s Replay

重新读取canonical 24帧M1/H1图片包，在当前runtime重放原真实模型receipt；packetDigest、candidate IDs、contextDigest严格匹配，未改写历史response。TOP_RIGHT logicalTargetId/candidateIds/classification/semanticSource/temporalObservation与旧结果逐项相等，getConfirmedCornerTargets仍只投影TOP_RIGHT。TOP_LEFT NO_CANDIDATE；底部REJECT SUBTITLE及原corner-only风险不变；中央5个OUT_OF_CORNER_SCOPE、36个UNKNOWN_NOT_PROPOSED；source CORNER_SEMANTIC_PARTIAL。真实API新增0；replay counts为3/0/0，不能冒充新provider evidence。

## Verification and Governance

red日志复现新增6项失败，修复后corner单测最终62项通过。覆盖split→Sol merge/source SOL/2 IDs、Sol separate/UNCERTAIN、risk/UNKNOWN/temporal/motion拒绝、双向class/decision冲突、partial、provider清全部target、每角1/1/source4/4/0；原H1/H2 regression与canonical FFmpeg packet integration保持。typecheck实际执行；最终owned Harness与completion receipt以私有root及`.agent/harness/runs/`中的terminal证据为准，声明scope本身不证明PASS。无UI、mask或输出视觉验收。

AOCI role逐项核对：semantic owner为index，经官方完整单对象批次/CAS更新Entry及baseline；tests/scripts/docs为observe，不扩索引。官方Verify、Check、Guide用于本轮对齐证明；共享AOCI只提交本任务semantic对象的owned hunks，保留原dirty工作。

受管Kimi deep只读pre-fix mapping：invocation d1e80976-236a-468c-8490-19ac6be90211，sealed private snapshot，Docker/qualified route，2 wire requests，PARSED报告及实际Read证据。它确认原升级/分组冲突root cause；其按旧行为建议保持split无升级或grouping冲突，因与当前用户授权相反不采用。UNCERTAIN→clean Sol resolution已有合同允许；不新增不确定性冲突门。该报告不是final implementation review或验收。

Parent final Risk Gate：稳定semantic SHA214201f7a4c6d4d637777ba5ca648ebc8fc86a356cadef5a5131f22cfadeb090；用户未要求final Kimi review，无凭据/authority/持久state变更，PRODUCT_DISABLED且无生产owner接线；关键失败路径由定向测试与固定runtime结果覆盖。模型grouping能力限制是已观察事实，adversarial代码review不能替代视觉能力证据，故KIMI_REVIEW_NOT_REQUIRED。以最终project-native Harness通过为completion gate。

## Verdict and Stop Boundary

按用户八项简化标准，H2C工程可在最终tests/owned Harness通过后记HYBRID_CORNER_H2_READY：clear overlay real replay保留；print/subtitle真实负例无误CONFIRM；provider失败测试fail closed；hard grouping实测到Sol；独立overlay仍unresolved；partial成立。该标签不声称controlled multi-component真实合并成功。

next = H3 Corner Motion + Conservative Mask + Shape Matching + 100% Coverage。本轮在H2C停止。PRODUCT_DISABLED；no mask yet；no proof v3；old strict/full-frame paths preserved；Corner policy 0.30/0.30/0.60/3及prompt/schema不变。

## Session Capture Evaluation

本concern无repository专用session-capture Skill；本记录承担substantial implementation/live evidence的durable记录。未更新global memory。
