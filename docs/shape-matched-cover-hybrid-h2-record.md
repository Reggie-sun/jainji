# Hybrid H2 Development Record

## Verdict and Scope

2026-10-05，H2工程owner已实现，development verdict **BLOCKED**。真实fixed negative cases多次VISION_INVALID_OUTPUT，background construction被Luna错误CONFIRM；不能把fail-closed当作负例语义正确或HYBRID_H2_READY。real233s完整8候选中的底部7组件属于大于3的proposal关联cluster，COMPLEX_GROUPING；全部8候选保留unresolved，没有top3或singleton拆分。下一slice名义为H3 sampled motion/mask/shape/coverage，但H2实测blocker未关闭前不得自动继续。

无mask acceptance、geometry/confirmed-target proof v3、旧M3 strict consumer activation、Knowledge Store revision、motion实现、coverage、preview QA或export。PRODUCT_DISABLED，guard unchanged，未读取210 unseen。

## Model Audit and Authorization

应用独立CodexRpc/codexLaunch在2026-10-05T11:41:55.446Z执行account/read(refreshToken=false)及model/list，完整1页，已登录；没有登录/刷新token/额度查询或generation。catalog仅gpt-6-astra、gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna、gpt-5.5，均text/image。runtime工具名称或parent模型不作为应用catalog证据。

| Requested Model | Actual Model | Availability |
| --- | --- | --- |
| GPT-6 Luna / gpt-6-luna | gpt-5.6-luna | requested MODEL_IMAGE_CAPABILITY_UNAVAILABLE；actual AVAILABLE，经原授权使用 |
| GPT-6.1 Sol / gpt-6.1-sol | gpt-5.6-sol | requested MODEL_IMAGE_CAPABILITY_UNAVAILABLE；actual AVAILABLE，经原授权使用 |
| MiniMax | MiniMax-M3 | 已验证official Responses image route；H2仅comparison |

原H1真实会话 `01a10b87-61f2-7da2-ab53-4b51c798e728`，user message原rollout第1131行，对明确列出5.6 exact ID与GPT6缺席的选择问题回答：“使用当前可用的 gpt-5.6-luna / gpt-5.6-sol”。本轮实际读取该原始user reply并保存受控投影；因此不删除真实授权，补充可核查证据。新provider优先当前catalog里的requested exact ID，缺席时才使用该已授权Hybrid alternates；不增加其他型号。

## Candidate Count Audit

同一real233s sourceKey为 `3c1b0061d50dea8b46f7a6136eaeeee4a288abadaed574719a594c9ccd03042b`，source SHA为原a18f7e4e…，24观察点。H1原private diagnostic实际也记录8个candidate；脚本只选stablePixels最大的1个发送，record误写为M1只有1个。本轮纠正文字，历史3-route单候选结果不升级为完整集合确认。

| Source / Construction Case | CANDIDATE | UNKNOWN | Candidate Boxes (x,y,w,h) |
| --- | ---: | ---: | --- |
| real233s — DEVELOPMENT_OBSERVATION | 8 | 36 | (627,0,83,68); (135,1248,65,25); (256,1248,55,32); (281,1248,51,32); (320,1248,55,32); (363,1248,62,32); (417,1248,75,32); (481,1248,79,25) |
| overlay — CONTROLLED_TRUTH | 1 | 0 | (248,12,57,36) |
| box-print — CONTROLLED_TRUTH | 1 | 0 | (233,61,72,85) |
| bottle-print — CONTROLLED_TRUTH | 1 | 0 | (129,63,48,92) |
| subtitle — CONTROLLED_TRUTH | 1 | 0 | (74,206,180,28) |
| video-title — CONTROLLED_TRUTH | 1 | 0 | (74,95,175,28) |
| logo-and-print — CONTROLLED_TRUTH | 2 | 0 | overlay及box-print两个box |
| multi-component — CONTROLLED_TRUTH | 2 | 0 | (220,14,69,41); (271,59,17,17) |
| padding — CONTROLLED_TRUTH | 1 | 0 | (0,0,42,240) |
| background — CONTROLLED_TRUTH | 1 | 0 | (118,83,65,65) |
| moving / disappear — CONTROLLED_TRUTH | 各0 | 各0 | 空；不作absence声明 |
| four / twelve / thirteen overlays — CONTROLLED_TRUTH | 4 / 12 / 13 | 各0 | 25×21，规则网格压力construction |

完整audit逐source保存所有candidate/UNKNOWN的ID、grid/source boxes、boxArea、stableArea、relativePosition及M1 reasons；面积为w×h，relativePosition为x/sourceWidth、y/sourceHeight。压力cases不是自然素材candidate分布统计，不据此宣称统计accuracy。V1 max12建立在真实8候选、controlled1–2候选及4/12/13完整压力边界上。

## Batching and Result Contract

复用H1全部4个owners，新增`shape-cover-vision-semantic.ts`。每包3 candidates、3 full frames和逐candidate3 crops，最多12图片；Luna≤4、Sol≤2、MiniMax H2 runtime=0。源box y/x/ID排序；短边12%轴向box proximity只作proposal hint；空间cluster原子first-fit，不跨包切开。cluster>3、packing>4或candidates>12分别COMPLEX_GROUPING / SEMANTIC_BATCH_LIMIT_EXCEEDED / SEMANTIC_CANDIDATE_LIMIT_EXCEEDED，零model requests并完整unresolved。10个候选分成5个双组件cluster时同样拒绝，不扩大scheduler。

H2输入附全部M1候选box context，但响应只能引用本包ID；crossBatchGroupingSuspected=true阻断source并清confirmedGroups，防止视觉上相关而未共同判断的组件被静默当singleton。模型无新坐标或candidate authority。原packet builder额外拒绝M1 UNKNOWN及不齐的3时间点context/crop。

HybridSemanticTargetSet包含sourceKey、candidateSetDigest、batchPlanDigest、allCandidateIds、confirmedGroups/rejectedCandidates/unresolvedCandidates、unknownCandidateIds、undetected/cross-batch/temporal flags、packetDigests、receipts/digests、requestCounts、verifyFresh。三态SEMANTIC_CONFIRMED / SEMANTIC_UNRESOLVED / SEMANTIC_UNSAFE；每个M1 candidate严格三集合partition。group含groupId、candidateIds、classification、temporalAssessment、semanticSource、riskFlags、resolutionReason，不含model mask/polygon/new coordinates。对象深冻结且run-local，源变化/owned evidence关闭使verifyFresh拒绝，不恢复JSON为live handle。

Luna逐包完整分类，UNKNOWN、risk、非STABLE、false/UNCERTAIN或多component group交Sol原图片及Luna摘要；摘要不是truth。任何采用reviewer的undetected=true，source SEMANTIC_UNSAFE / UNDETECTED_OVERLAY_SUSPECTED，confirmedGroups为空，H3不得继续。Luna明确MOVED/DISAPPEARED/CHANGED使source temporal conflict，Sol不能抹掉。Luna CONFIRM / Sol REJECT或确认class分歧UNRESOLVED，无多数投票；risk升级的Luna REJECT / Sol CONFIRM可hard-case resolution，保留双方receipt及reason。false group明确partition成singleton，UNCERTAIN完整unresolved，风险未消除不确认。

## Frozen Development Evaluation

固定`hybrid-h2-fixtures/v1`，prompt `hybrid-overlay-semantic/v2`，预期construction labels、cases、源及相关源码摘要先写once marker，再请求。每case一次Luna，仅multi需要一次Sol；MiniMax仅box-print/multi两项DEVELOPMENT_COMPARISON。未改prompt、未重发、未换型号、未调整fixtures以求通过。

| Case | Ground Construction Label | Luna | Sol If Escalated | Final Semantic Status | Grouping |
| --- | --- | --- | --- | --- | --- |
| overlay | CONTROLLED_TRUTH / overlay logo | CONFIRM OVERLAY_STICKER, STABLE | — | SEMANTIC_CONFIRMED | 1 singleton |
| box-print | CONTROLLED_TRUTH / PRODUCT_PRINT | VISION_INVALID_OUTPUT | — | SEMANTIC_UNRESOLVED | 0 |
| bottle-print | CONTROLLED_TRUTH / PRODUCT_PRINT | VISION_INVALID_OUTPUT | — | SEMANTIC_UNRESOLVED | 0 |
| subtitle | CONTROLLED_TRUTH / SUBTITLE | VISION_INVALID_OUTPUT | — | SEMANTIC_UNRESOLVED | 0 |
| video-title | CONTROLLED_TRUTH / SUBTITLE | VISION_INVALID_OUTPUT | — | SEMANTIC_UNRESOLVED | 0 |
| logo-and-print | CONTROLLED_TRUTH / overlay + PRODUCT_PRINT | VISION_INVALID_OUTPUT | — | SEMANTIC_UNRESOLVED | 0 |
| multi-component | CONTROLLED_TRUTH / one sticker with detached dot | 两candidate CONFIRM；sameLogicalOverlay=true | 两candidate CONFIRM；sameLogicalOverlay=true | SEMANTIC_CONFIRMED | 1 group / 2 members |
| padding | CONTROLLED_TRUTH / background padding | VISION_INVALID_OUTPUT | — | SEMANTIC_UNRESOLVED | 0 |
| background | CONTROLLED_TRUTH / BACKGROUND_GRAPHIC | CONFIRM OVERLAY_STICKER（与construction不符） | — | SEMANTIC_CONFIRMED（本case失败） | 1 singleton |
| real233s | DEVELOPMENT_OBSERVATION，仅已知目标/context | 未请求：COMPLEX_GROUPING | — | SEMANTIC_UNRESOLVED | 0 / 全8 unresolved |

MiniMax box-print同样VISION_INVALID_OUTPUT；multi两组件CONFIRM、true group。comparison不进入最终target，也不抵消Luna负例失败。当前strict parser未保存invalid response原文，回执保留失败code、输入图片/packet绑定和请求计数；不能推断失败原文中实际上REJECT还是CONFIRM，也不能据此报告负例模型分类正确。background的construction模拟语义与模型的视觉判断矛盾保留，不用单case统计泛化。

实际semantic requests Luna9 + Sol1；comparison MiniMax2；总12。catalog1页/0 generation；Kimi mapping另外2个engineering wire requests，不混算产品视觉调用。没有mask extraction或preview请求。

## Evidence and Verification

私有artifact root：`~/.local/state/jianji-source-fact-qualification/hybrid-h2-20261005/`。model-catalog-audit.json、model-authorization-evidence.json、fixtures/candidate-count-audit.json、semantic-run-once.json、semantic-evaluation.json是本轮新证据；source paths与完整素材只在私有开发inputs，不进入vision receipts或模型payload。每batch receipt包含role、provider、exact model、sourceKey、packetDigest、candidate IDs、image SHA、prompt version、structured output或failure、timestamp、requestId=null。

受管Kimi deep只读preimplementation mapping invocation `d2bf8147-0ba5-44d6-94e8-568be36b40a4`，PARSED、2 wire requests，实际Read证据与Docker route receipt核验；parent采用完整集合、现有schema/freshness、跨包与分歧缺口建议，未委托final acceptance。Spec/Plan self-review由parent完成。

最终可执行证据与owned Harness/AOCI回执见该private root；不沿用H1测试或把foreign Qianchuan/UI改动计入本slice。工程测试覆盖完整1/3/4/12/>12、determinism、atomic overflow/split、所有负例class、multi、disagreement、undetected、invented/missing IDs、duplicate groups、UNKNOWN、unavailable/cancel/timeout/stale及budget。真实FFmpeg integration覆盖4候选两包及两组件Luna/Sol、UNKNOWN不能升级、图片映射和源变化。自动测试只证明软件合同，不能替代上表失败的真实VLM语义验收。

## Parent Completion Decision

Implementation Review Risk Gate：KIMI_REVIEW_NOT_REQUIRED。scope是development/run-local且产品持续关闭，无credential实现变更、持久源知识写入或生产authority；native executable evidence覆盖机械fail-closed与分区边界，真实模型/fixture语义失败已有直接receipt，额外工程review不能替代规定Provider evidence。该决定不是H2 acceptance：semantic development失败仍BLOCKED。

Repository没有dedicated session-record/capture skill owner；本record按现有Hybrid slice记录位置保存scope、真实失败、工程证据与next boundary，不写global memory或伪装bug-memory。下一步需要有依据的invalid-response诊断及负例验证；当前未授权自动续跑到正确，H3不能把此BLOCKED checkpoint当READY。
