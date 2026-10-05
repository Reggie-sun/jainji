# Shape-Matched Cover Hybrid V1 Delta

## Authority and Goal

2026-10-05 accepted user architecture adjustment. Hybrid V1 supports detected and visually confirmed static overlay targets. Classical CV proposes candidate regions and creates conservative source masks. Visual models classify/group candidates and inspect rendered previews. Deterministic code enforces final mask coverage. Obvious motion, uncertainty, disagreement, or unsafe preview fails closed.

模型判断后期overlay语义、component grouping及预览自然度；算法独占mask、时间边界、100% fully opaque coverage及renderer。只处理detected + confirmed集合；absence不是无目标证明，额外疑似overlay返回UNDETECTED_OVERLAY_SUSPECTED。商品原字、字幕、人物、背景稳定feature都允许作为CV proposal，不能仅因角落固定而确认。

## Superseded Critical Path

本Delta优先于旧simplification中的strict geometry/proof前置：confirmed-target-static v1/v2、geometry v1/v2、HC2/HC3/HC4/HC5及support/geometry/proof v3属于HIGH_ASSURANCE_RESEARCH / NOT_HYBRID_V1_CRITICAL_PATH。保留历史代码、fixtures和失败，不升级旧JSON或解除源争议。Hybrid不要求4×4可观察geometry proof，不以detector footprint当segmentation。

## Pipeline and Acceptance

CV Proposal → VLM Semantic Confirmation/Grouping → deterministic conservative mask → sampled motion/persistence → shape matching + deterministic 100% coverage → VLM paired Preview QA → original export owners。V1 static only；明显移动/消失拒绝，无白矩形fallback，无训练，无全源absence proof。有限安全margin优先不露旧贴纸，其次不过盖/自然。

自动继续必须CONFIRM + OVERLAY_STICKER/OVERLAY_LOGO、group resolved、sampled motion supported或Sol明确stable、mask available、oldMask ⊆ fully opaque projected alpha、preview PASS。Sol/MiniMax高风险冲突UNSAFE/NEEDS_REVIEW；不majority vote。模型不得创建candidate、坐标mask/polygon或renderer authority。

## H1 Infrastructure Contract

仅development packet/schema/router/receipt，不接store、M3 strict consumer、activation、UI、queue。复用DiscoveryEvidence及PNG codec、ConnectionStore/ChatGPT image catalog、AgentProvider/transport/scheduler。Luna fast batch triage；Sol处理UNKNOWN、复杂grouping、商品/人物风险、采样不一致和algorithm conflict；MiniMax独立preview或high-risk second opinion。route image能力必须来自当前catalog/官方provider证据，缺席UNAVAILABLE，不自动换GPT型号。2026-10-05用户依据当前catalog明确改用gpt-5.6-luna / gpt-5.6-sol；MiniMax exact ID来自已选配置，当前为MiniMax-M3。此授权仅适用于Hybrid开发路径，不改旧strict consumers。

H1历史每source共享Luna1/Sol2/MiniMax1请求上限；H2扩展为Luna4/Sol2/MiniMax1（H2 runtime不调用MiniMax）。取消、timeout、失败或未知结果消耗已发请求且不重放。provider错误不semantic retry或fallback；MiniMax preview FAIL/UNKNOWN可Sol一次二审，高风险相反结论仍UNSAFE。confidence仅diagnostic。所有严格JSON响应绑定packetDigest、已提供candidate IDs和有序图片SHA；非结构/未知字段/伪造ID/错packet拒绝。

packet最多3个components、12张PNG、8MiB/image、32MiB总量；full context和每candidate crop均必须对应start/middle/end三个时间点。观察输入复用16–32点DiscoveryEvidence（短片取全部），不发送整片。图片绑定sourceKey、ordinal、PTS、原pixel SHA、PNG SHA、crop mapping和candidate IDs；发送体只含匿名ID、几何/时序和图片，无本机path/filename/account/key。generation前后复核源/图片及连接绑定，迟到输出拒绝。超限显式失败，不偷偷删confirmed component。

preview schema只回答旧overlay残留、误遮挡、明显不自然和temporal mismatch；H1不渲染或签发preview acceptance。receipt保留route/provider/exact model、packet/input hashes、prompt/version、structured output或安全failure code、timestamp；现有transport未暴露provider request ID时为null，不猜。无publication proof链。

## Verification and Limits

strict schemas、invented/swapped IDs/group、UNKNOWN、不可用route、Luna→Sol/MiniMax role、disagreement、图数/bytes、无path、取消/timeout/stale和existing provider regressions；实际可用route最多一次同packet diagnostic。233s及已授权controlled开发素材，不读210 holdout。classification/grouping/motion/mask/coverage/preview及false-cover的端到端统计留H2–H4，不将H1当产品完成。PRODUCT_DISABLED。

## H2 Semantic Confirmation Contract

完整M1 CANDIDATE集最多12个；UNKNOWN仅保留diagnostic，builder拒绝升级。稳定sourceBox y/x/ID排序，轴向box gap≤短边12%作空间proposal关联，cluster原子first-fit装入每包≤3、source≤4包；cluster>3返回COMPLEX_GROUPING，atomic packing>4包返回SEMANTIC_BATCH_LIMIT_EXCEEDED，候选>12返回SEMANTIC_CANDIDATE_LIMIT_EXCEEDED。所有failure仍对全部candidate产生UNRESOLVED，不存在截断或topN。H1完整候选数错误及count envelope由[H2 record](shape-matched-cover-hybrid-h2-record.md)保留。

每包有全M1集合box context，但decision/group仅引用本包ID。空间hint不证明semantic truth；模型怀疑不同包候选属于同一overlay时，crossBatchGroupingSuspected=true使全source SEMANTIC_UNRESOLVED，不静默singleton，不graph merge。模型怀疑whole M1集合外还有overlay时，任何采用reviewer的undetectedOverlaySuspected=true使全source SEMANTIC_UNSAFE、原因UNDETECTED_OVERLAY_SUSPECTED，confirmedGroups清空，H3不得自动继续。

Luna逐包完整分类；UNKNOWN、riskFlags、非STABLE、group=false/UNCERTAIN、多component group交Sol原图片与Luna结构化摘要（不是truth），最多2包；其余hard cases完整保留unresolved，不续budget。Luna explicit MOVED/DISAPPEARED/CHANGED不能被Sol改写为通过，全source记录semanticTemporalConflict，H3 fail closed。Luna CONFIRM/Sol REJECT或确认class分歧是SEMANTIC_MODEL_DISAGREEMENT；Luna REJECT/Sol CONFIRM可作为hard-case resolution，保留两份receipt与resolutionReason。剩余risk/UNKNOWN/group uncertain不确认。false group明确partition为singleton而不丢candidate；resolved confirmedGroups形成confirmed集合严格partition。

`confirmHybridSemanticTargets`返回不可变run-local HybridSemanticTargetSet：sourceKey、candidateSetDigest、batchPlanDigest、allCandidateIds、confirmedGroups、rejectedCandidates、unresolvedCandidates、unknownCandidateIds、undetected/cross-batch/temporal flags、packetDigests、receipts/digests、requestCounts及verifyFresh。status仅SEMANTIC_CONFIRMED/SEMANTIC_UNRESOLVED/SEMANTIC_UNSAFE；零candidate没有absence claim。group只包含candidateIds、OVERLAY_STICKER/OVERLAY_LOGO、STABLE/UNCERTAIN observation、LUNA/SOL及risk/reason，无model坐标/mask。source或owned evidence失效时verifyFresh拒绝；JSON不恢复live freshness。H3只消费fresh SEMANTIC_CONFIRMED并另做自己的motion/mask/coverage；H2无SourceStickerKnowledge publication。

H2 prompt v2先冻结固定construction cases与labels，然后各source一次development执行；wrong/UNKNOWN结果保留，不改prompt重试到正确。MiniMax-M3只固定两项DEVELOPMENT_COMPARISON，不参与semantic runtime，也不投票。H2不调用extractStaticConservativeMask，不授mask acceptance、proof v3、旧M3或activation。

## Self Review

本scope不调整生产准入。新语义owner只组装vision任务，provider基础设施仍唯一；strict历史与Hybrid发展路径分离，100% coverage是独立硬门。capability unavailable保持显式；无live证据不能声称三模型routing实测成立。
