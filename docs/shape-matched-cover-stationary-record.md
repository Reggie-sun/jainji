# Stationary Shape Cover Engineering Record

## M2-H Versioned Confirmed-Target Static Proof — 2026-10-04

### Source Audit and Geometry Ownership

起点 HEAD `f3a28b11a2aa04d83a5c1cbc06012ef7fb65f02a`；以实际源码确认旧 proof/schema/store/consumer 的限制，见 [M2-H plan](shape-matched-cover-m2h-plan.md)。原 M2-C 只有 Python diagnostic，没有 application-owned geometry evidence。新增 `source-mask-static-geometry.ts` 的 live WeakMap owner 与受控 worker，复用原 M2-C v2 kernel/config，未改变数学、阈值、mask/detector/dilation。caller 不传 geometry JSON；owner自行验证 exact target/evidence/candidate、source/range/clock/逐帧ROI SHA、engine/method/runtime freshness、取消与原300秒预算。ownership 内部对象冻结，durable append 前另有同步 generation fence。缺Linux/Python/指定NumPy/OpenCV/runtime/source files时fail closed，不承诺Windows或安装包能力。

在创建 proof schema 前，真实233s完整6990帧对旧 M2-C 作equivalence：容差1e-12，532681个数值比较全部差0，reference及每帧 offsets/correlations/peak-gap/loss/energy/local fits、issue frames/ranges与summary完全一致，geometry issues0。证据 R/geometry-equivalence.json；R=`~/.local/state/jianji-source-fact-qualification/m2h-20261004`。原算法脚本精确SHA固定；新worker/owner源码与Python executable generation/fingerprint绑定，不把status字符串当authority。

### Canonical Durable Contract

新增 mode `confirmed-target-static-v1`、verification `confirmed-target-static`，顶层KNOWLEDGE_SCHEMA_VERSION保持1，旧sampled/source-mask-only-v1的checkProof branch和receipt语义保留。新issuer先freeze显式confirmed集合C，results与facts的全部target/segment精确一一对应，reject omitted/extra/duplicate。confirmation v2的candidate IDs、component digests、sourceBoxes与digest完全保留，envelope只是ROI/geometry metadata；不新增membership推断。

proof绑定source/run/facts/C digest、逐target range/confirmation、mask bitset/SHA/config、owned geometry/config/reference/metrics/frame-binding/clock/PTS以及固定版本method support。旧M2-G engineering digest只作固定method support，不读取任意final-receipt JSON。四类bounded artifact与首尾original PNG由既有store保存字节/核digest；不保存6990张原图、RGBA spool或完整metrics。proof自身authority=none/eligible=false；只有valid KnowledgeRun和 `publishConfirmedStaticTargets` 的既有append/source/base/dispute owner可建立reviewed canonical source revision。reload严格验证archived bytes/schema/digests，JSON clone不恢复live publication ownership。

`FULL_RANGE_STATIC_CONTRADICTION`只在exact extractor v2/config、唯一reason、owned geometry supported时解释为历史RGB信号，原candidate INCOMPLETE及全部anomalies原样保存。明确switch拒绝TARGET_NOT_SEPARABLE、STABLE_COMPONENT_EXTENT_UNRESOLVED、CONSERVATIVE_MARGIN_EXTENT_UNRESOLVED、INSUFFICIENT_ORIGINAL_REPRESENTATIVES及所有unknown reasons；source/engine/range/config/method/clock错配、geometry issue仍hard fail。

### Real Evidence and Verification

首轮private roundtrip R/real-proof-v1及v2通过；最终store初始化修复后另建R/real-proof-v3，所有旧证据保留。真实单logical target/单candidate，完整[0,6990)，mask3395px/bbox628/1/81/59/SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`；旧133 RGB anomalies不删除。full-range geometry支持结果与原M2-C逐项复核；issued proof、candidate、revision、close/reopen readHead及artifact bytes均在新的private knowledge root中，不写用户正式production目录。

本轮新controlled测试覆盖single/group/multiple confirmed targets、exact set/segment completeness、全部binding篡改、clone/ownership、RGB signal有/无owned geometry、hard/unknown reason、geometry issue、cancel-before-manifest、base conflict、dispute与reload/corruption。最初受控texture fixture受边界背景干扰确实被拒绝，保留失败；改为有中性边框的静态随机纹理构造，没有改算法/阈值。取消期间evidence已写后，旧store的pending transaction仍阻断读取/重启复用，不清marker或盲重试。旧sampled/source-mask-only-v1及activation相关回归一并运行。最终typecheck、registered tests、owned Harness、AOCI Maintain/Verify/Check/Guide与exact snapshot结果保存在R；foreign改动/全局阻断分开，不修foreign文件或增timeout。

首次完整相关调用224 assertions通过，但两个旧auto-contour suites在collection阶段因新store顶层proof import引出的freezeAI cycle失败，不能把该调用报成PASS。store改为只在新variant分支动态加载owner，26项旧auto-contour regression随后通过，再按最终scope运行完整必需检查。AOCI官方完整3项批次更新owned geometry/proof/store（schema当前Entry已表达新variant并与源码对齐），remaining0；官方Verify/Check治理aligned、Guide complete=true/next_action=none。混合foreign索引/基线不随业务commit提交；最终若其他session再次产生drift，单列真实末检结果。本次Overview输出遭host截断，停止认知链，不宣称当前完整系统认知可靠。

### Scope and Stop Barrier

CodeGraph确认新publisher复用原publishRevision，issuer调用原mask/evidence与owned geometry owner；同名set/at的跨模块假边由实际Map/array receiver排除。Native Codex唯一writer，explicit modelRequests=0优先，未调用模型/子代理；Parent审查权限、freshness、历史schema、发布/取消/争议与最终diff。无repository dedicated session-capture skill，本节主动记录stable checkpoint，不更新外部memory。

M2-H仅建立内部confirmed-target durable contract；不声明未知目标不存在、REAL_PIXEL_ZERO_MISS、PRODUCTION_SAFE或SAFE/NATURAL。M3 consumer源码保持只认旧source-mask-only-v1，新增实际测试确认新revision被它拒绝。M3仍BLOCKED、PRODUCT_DISABLED、guard unchanged；不进入matching/placement/replacement/output coverage/production，modelRequests=0。下一唯一slice：M3 confirmed-target consumer contract。

## M2-G Explicit Multi-Component Confirmation — 2026-10-04

依据 [M2-G plan](shape-matched-cover-m2g-plan.md) 与本轮用户约束，先复现再修改。开始 HEAD `6c7cfafd35c248f4b77b8502f7d9efde19aa1d63`，指定基线 `6ec48437` 之后两项提交仅为千川。保留其 dirty/staged 工作、共享AOCI及未跟踪文件；不创建worktree、不修改 forbidden product owners。explicit modelRequests=0 优先于通常委派路线，没有 Kimi/native/视觉模型请求。Native Codex 唯一 writer；CodeGraph核对 confirmation 的 discovery/evidence 调用，错误的同名 `set` 关系仍由实际 WeakMap receiver 裁决。

### Actual M1 Component Table

在改产品代码之前，对旧 controlled-v1/disconnected-components/source.mp4 重新运行原 M1，4代表帧 ordinal0/10/19/29，grid128×96，未缩放。完整结果保存 R/discovery.json，R=`~/.local/state/jianji-source-fact-qualification/m2g-20261004`。

| component ID | state | sourceBox x/y/w/h | gridBox x/y/w/h | stablePixels | edgePixels | std / persistence / original stability | construction relationship |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `22ac9e43270f8211cee29f4f9dbd3b853509e8db369e97096e9c76b1e4ef7b46` | CANDIDATE | 51/29/29/29 | 53/31/25/25 | 313 | 210 | 0 / 1 / support313, std0, fraction1 | 主 diamond，完整包含其logical component；不交detached4×4 |
| `657afc01600a193b50e7080856918291568c4941540e5a17a59e287831e61888` | CANDIDATE | 81/39/8/8 | 83/41/4/4 | 16 | 13 | 0 / 1 / support16, std0, fraction1 | detached x83..86/y41..44，共16px |

这就是全部 component，没有被隐去的 UNKNOWN。两者 reasons 均为 `STATIONARY_SIGNALS_DO_NOT_ESTABLISH_STICKER_IDENTITY`、`UNSAMPLED_TIME_NOT_VERIFIED`、`BACKGROUND_SUBTITLE_OR_PRODUCT_PRINT_POSSIBLE`；各自原像素4张ROI SHA/PTS完整保留。4×4已超过minimumComponentPixels12与minimumEdgePixels4，未触发 size/edge/persistence/grid rejection。**根因=confirmation-model**：旧corpus只选最大候选，单sourceBox membership依法排除第二个已发现component；不是M1漏检，不是需要扩大dilation的extractor问题。

### New Logical Target Contract

`confirmed-static-target-development/v2` 表达一个logical target绑定非空、唯一、确定排序的 `confirmedCandidateIds[]`、同序 `confirmedComponentDigests[]` / `confirmedSourceBoxes[]`。全部来自同一owned discovery 的 CANDIDATE；另绑定sourceKey/discoveryDigest/resultDigest/targetId/range/confirmation source/confirmationDigest。旧candidateId仅用于fresh selection API适配，内部无第二行为分叉；旧v1 JSON receipt不授新ownership，WeakMap与authority=none/eligible=false保持。

`targetEnvelopeBox` 只用于12px padded ROI、预算或展示。v2 extractor仍以原std20、component8、edge18、dilation3、RGB24执行；membership仅 intersectsAny(confirmedSourceBoxes)，不填envelope、不选最大、不按距离补齐。extent/margin unresolved继续INCOMPLETE。没有UI或自动grouping。

Controlled logical identities在discovery前独占写入logical-identity.json；M1后按预声明component anchor匹配候选并冻结confirmation，再extract，最后才比较construction alpha。alpha/truth原字节与旧19例/570帧全部一致，由R/parent-equivalence-audit.json逐项证明；产品owners没有corpus/construction依赖，不接caller mask/box。不以comparison失败反馈修改IDs。

### Fresh Controlled and Real Evidence

完整controlled-v2实际跑19例、570帧，19/19 complete。requiredPixels **183693**、missedRequiredPixels **0**、missingRequiredFrames **0**，excessPixels192387；disconnected从old480（16×30）到new0，candidate742px。intentional1px仍required313 / missed1 / missingFrames1 / maxMiss1、CONTROLLED_EXACT_NOT_QUALIFIED。corpus digest `574668d9facb190eea7d33a9e679f278188dbbf42af800e871a4088f2bf5f5f0`。truth没有删除detached或扩大容差。

实际canonical FFmpeg测试构造两个选中目标component，另在envelope中间加stable feature、附近加subtitle-like feature；两target全包含，中间16px与字幕48px逐像素全部排除。只确认主component时不自动补第二component，comparator仍暴露480漏失。重复/空/未知/跨source IDs、caller box/mask、v1/clone、源/范围失效与component/margin extent拒绝覆盖于原注册test seam。组排序不同产生相同receipt，single API和singleton group得到相同mask。

真实233s源只重新确认原candidate `0d325a85ab3eb9ef2f1b6588fd594084e4904ab44deb61660986e22536f45f86`。旧/新均 **3395px / bbox628/1/81/59 / SHA fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893**，bitmap整对象、packed bytes完全相同。新方法完整重新decode6990帧，全部ROI SHA/clock/representatives/anomalies与旧证据相同；旧133 RGB anomalies及REJECTED appearance criterion保留，mask candidate自身仍INCOMPLETE/FULL_RANGE_STATIC_CONTRADICTION，不伪改其历史语义。

M2-C旧receipt的自身脚本/config/engine/artifact freeze当前仍fresh；新candidate逐帧ROI/clock、targetId/source/range/mask完全一致，R/real-review-v3/method-rebind.json显式绑定当前v2 confirmation与旧geometry receipt，不编辑旧receipt。状态 **DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED**、issues0，原有限灵敏度不变。

重建70帧包并重新计算全部risk metrics。review-set JSON字节、digest `bd812f36716ed9a58aeddc3001777516b9be46f30f7c75c195590ca8b5842414` 与全部280 asset SHA/字节均与原real-review-v5完全相同，question/scope不变。review-set保存原presentation identity，当前confirmation在新engineering receipt中独立绑定，避免改写原human包或伪造新消息。实际用户原话“过关我看了可以.”、ACTUAL_USER_MESSAGE、原actual-user-boundary-observation.json完整复用；标记 **REUSED_OBSERVATION_ON_BYTE_IDENTICAL_REVIEW_PACKAGE**。任一review字节变化时不接受旧回答，保留UNKNOWN/HUMAN_REVIEW_REFRESH_REQUIRED。

新 `StaticMaskEngineeringEvidence/v2` receipt：R/real-review-v3/final-receipt.json，digest **e52752c3220c5952e22e1a602e229287542338c21ed1ff8ff12c5fbafab0a4df**，**ENGINEERING_ACCEPTED**，全部freshness成立，authority=none/eligible=false。仅三条claims：CONTROLLED_EXACT_ZERO_MISS、REAL_DEVELOPMENT_NO_VISIBLE_RESIDUAL_ON_FROZEN_RISK_SET、FULL_RANGE_GEOMETRY_SUPPORTED_WITHIN_V2_LIMITS。旧M2-F拒绝及本轮较早包/receipt全部保留；不签REAL_PIXEL_ZERO_MISS、SOURCE_QUALIFIED、MASK_ADMITTED或PRODUCTION_READY。

### Performance, Verification and Completion

controlled runtime87.586s、parent peakRSS277463040bytes；真实重新提取41.272s、parent peakRSS279539712bytes、child25ms sampled VmHWM68784128bytes（lower bound），工作集3066240bytes，ROI scratch0，discovery scratch353894400bytes。新review build11.924s、peakRSS227250176bytes。disconnected ROI53×53→62×53，工作集公式额外76320bytes；真实单component ROI/工作集没有增加。artifact总量：controlled8253376、real-regression2153937、最终review5029644bytes，计数时点见Parent audit，不含全部旧包/运行日志。未优化或改预算。

相关tests先red（旧schema拒绝candidateIds）再green；最后源码修改后的typecheck、target/extraction/qualification、M2-F controls、M2-B anomaly、M2-C geometry与activation实际结果保留R/focused-final.log及final verification logs。Harness使用10个owned对象的精确before/after SHA，按current policy执行required scope并保存code/只读verify receipts；实际结果见R/harness-result.json，不预写PASS，不以focused tests覆盖Harness失败。foreign源码变化/timeout/旧链接问题单独记录，不调参数或接管foreign文件。diff最终检查同理区分owned与foreign。

AOCI官方Maintain/Verify/Check/Guide与逐对象role/source绑定保留R/aoci-*。共享索引已有其他session更新，当前owned target/extraction Entry确实表达显式组与envelope边界，Parent逐项核对，不重复写已对齐对象、不stage混合索引、不接管其他machine batch；全库状态与owned proof分别报告。Whole-Index完整传输4块，但Attestation schema未完成，禁止无保留的系统认知可靠声明，继续source-bound工程。未发现repository dedicated capture skill；本节与R主动保存stable checkpoint，不写外部memory。

Final implementation Risk Gate在project-native验证后绑定exact owned snapshot于R/risk-gate.json：无用户指定Kimi final review，无凭据/产品准入/业务持久化变更，离线无authority证据不能造成重大production consequence；未满足重大后果加残留验证缺口的组合，不叠加reviewer。explicit modelRequests0保持。Parent裁决所有结果并检查最终diff，提交仅本轮10文件。

**唯一下一slice：versioned confirmed-target proof。M2 product proof仍NOT_ISSUED，M3仍BLOCKED，PRODUCT_DISABLED，guard unchanged，modelRequests=0。** 本轮止于M2-G/M2-F工程证据，不查看210 unseen、不进入M3、不实现matching/替换/输出coverage/safety/assembler/activation。

## M2-F Static Mask Boundary Engineering Acceptance — 2026-10-03

本轮依据最新 [Course Correction](shape-matched-cover-v1-simplification-audit.md#m2-qualification-boundary-course-correction--2026-10-02)、[Delta Spec](shape-matched-cover-v1-simplification-spec.md#default-m2-static-engineering-acceptance)、[主Plan](shape-matched-cover-v1-simplification-plan.md) 与 [M2-F plan](shape-matched-cover-m2f-plan.md)，建立有限 offline `StaticMaskEngineeringEvidence/v1`。当前结果 **ENGINEERING_REJECTED / CONTROLLED_EXACT_NOT_QUALIFIED**：分离组件构造 case 漏失480个pixel-frame occurrences。用户实际查看冻结包后答复“过关我看了可以.”，真实边界整体观察记录为 **NO_VISIBLE_RESIDUAL_OBSERVED**，不能覆盖controlled失败。未调用视觉模型补观察，未签M2 product proof，M3 BLOCKED，PRODUCT_DISABLED，guard unchanged，modelRequests=0。

### Current HEAD Audit and Historical Freeze

开始HEAD `12462718b52d8bee2eb6e4541e872a8fc2eaa0f6`。保留 foreign dirty 千川/上传源码、tests、policy、AOCI及未跟踪文件；本轮不创建worktree，不修改foreign文件。读取现行AGENTS/合同、M2-A→E records、原target/extraction/qualification、M2-B/C diagnostic、M2-D comparator、stationary-envelope、source identity及canonical clock owners；CodeGraph核对extractor关系，通用 `set` 被错连ChatGPTSession的关系按实际WeakMap receiver裁决，不构成模型调用。

真实3395px mask先对原96代表帧计算每像素最大RGB channel std≤20，筛选与确认sourceBox相交、至少8px且存在≥18对比边缘的8-connected stable components。support2082px；半径3的7×7方形（Chebyshev）扩张增加1313px，得到3395px。扩张只围绕已选support，不提供alpha、目标身份或未知边界完整性证明，不任意纳入未相交component。全范围RGB min/max±24为appearance criterion；133异常保留，不能补签为编码噪声或false positive。

M2-B保留133 anomalies、61 strict clusters、506 violations、97.23% support第一层边界、cause NOT_QUALIFIED。M2-C独立持久梯度landmarks全6990帧证明冻结灵敏度内无新geometry issues，不能证明mask完整或exact motion truth。M2-D/E comparator与blind/two-human tooling不删除、不放宽，仍为OPTIONAL / HIGH-ASSURANCE，其历史INCOMPLETE/HOLDOUT_INSUFFICIENT/Harness FAIL全部原文保留于本节之后。

原3395px / bbox628/1/81/59 / range[0,6990) / SHA **fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893** 未改；未dilate/erode/patch/redraw/re-extract真实mask。源 `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf` 始终 **DEVELOPMENT SOURCE**，未读取210 unseen素材，不新holdout triage，不进入M3。

### Controlled Exact Alpha Corpus

owner `scripts/shape-cover-static-engineering-corpus.ts` 只编排现有application discovery/confirmation/extractor。`static-exact-alpha-corpus/v1`：19个正例×30帧，128×96，H264 qp0 yuv444p；专门reencode case另执行CRF18 yuv420p。每例在任何decode/discovery/extraction之前先由固定recipe构造alpha与required mask，alpha>0含alpha1；原alpha bytes、每帧digest与construction-truth保留。candidate从原extractor生成，不从candidate构造truth，也未修改M2-A方法。

Cases：opaque irregular、anti-aliased contour、alpha=1、1px tip、2px stroke、holes、disconnected components、light-on-light、dark-on-dark、chroma-heavy edge、corner target、edge target、changing background、high-motion background、scene cut、H264 reencode、first frame、last frame、adverse one-frame edge state；另有exactly-one-required-pixel negative。

独立full-canvas controlled decode逐帧核对extractor原ROI SHA，然后复用M2-D comparator在完整128×96分母比较，不能裁truth到candidate bbox或ROI。聚合只供报告；任一帧1px miss即失败，不平均。

| Metric | Actual result |
| --- | --- |
| executed positive cases / frames | 19 / 570，全部完成，无skip |
| requiredPixels | **183693** pixel-frame occurrences |
| missedRequiredPixels | **480** |
| missingRequiredFrames | **30** |
| excessPixels | 190077，不是qualification分数 |
| worst case / maxMissPerFrame / worstFrame | disconnected-components / 16 / ordinal0（30帧各漏16px） |
| other18 cases | 每例missedRequiredPixels=0、missingRequiredFrames=0；不外推真实源 |
| corpus digest | `308e9b7db747d66826e657548e17aa80663f3c915f76db7f9f7c708836f4dc6d` |
| intentional1px negative | required313，missed1，missingFrames1，maxMiss1，worstFrame0；CONTROLLED_EXACT_NOT_QUALIFIED，正确拒绝 |

分离component为construction recipe中x83..86/y41..44的4×4 opaque区域；位于ROI39/17/53/53内，但不与确认sourceBox51/29/29/29相交，当前extractor排除该component。candidate仍649px，没有覆盖这16px。sourceBox由原owner固定12px padding及未裁截ROI解释核对；不凭一次RGB外观反推alpha。失败说明当前方法不能对该构造的整个已声明目标签零漏；不删除case、缩truth、平均或调算法到通过。单源边界观察即使随后无明显残留，也不能覆盖此controlled失败。

### Frozen Real Development Review Set

复用既有M2-B anomalies、M2-C全部frames及M2-E已曝光development risk sidecar。新owner `scripts/shape-cover-static-engineering.py` 是窄离线组合接缝，复用M2-B strict decoder、M2-D comparator及existing original ROI risk function；不建立production qualification framework、第二source owner或真人pixel-truth链。

重新实际解码全部6990帧，ordinal/PTS/endPTS/原ROI RGBA SHA与历史candidate/geometry逐项一致；七项original RGB/edge/background risk scalar逐帧重算一致，source/engine/method/历史artifact前后SHA核对。M2-C receipt仍valid：**DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED**，geometry issues0，旧133 RGB anomaly对应geometry issues0。receipt digest **a58259f86945ad19c93fac4fef5bb138c116549e151b45280d418118c29e28a0**，frameMetrics digest `cfb8a722078a7dde62f8400dd93623052287950d93ef6b24ade41fe3dda88e53`，config `33ef2267b762a7cef277413d35b95ada15baba184fd8456d632892bebd92b598`；未重解释为exact motion truth。

review set共 **70帧**，digest **bd812f36716ed9a58aeddc3001777516b9be46f30f7c75c195590ca8b5842414**。预声明signature是2×2 spatial sector、support depth1/2/3/interior及超24的RGB channel bitset之exact set，共39种；每种取worstDifference最大、继而changedSupportPixels最大、最早tie。仅signature代表就需39帧，故超过偏好32；全部保留，不事后合并或截掉难帧。这不是独立因果或像素truth分类。总预算128，超限INCOMPLETE；没有重建192帧双人truth流程。

| Frozen risk reason | Ordinals |
| --- | --- |
| first / last / required historical anchors | 0、6989、233、710、715、3764 |
| representative normal（非133 anomaly列表的1/4、1/2、3/4分位） | 1791、3551、5275 |
| all39 anomaly-signature representatives | 234、235、237、468、469、576、578、580、588、652、709、710、715、728、864、867、1193、1228、1247、1250、1284、1288、1464、1469、1486、1497、1522、2037、2047、2096、2101、2267、2271、2542、2634、2985、2986、2990、3756 |
| strongest count / difference | 710 / 715 |
| local-offset signed min/max（9 cells×2 axes，earliest tie） | 0、15、42、241、586 |
| edge/chroma/RGB/background/difference及geometry scalar min/max | 0、15、42、275、285、286、308、452、578、899、945、2090、2429、2511、3008、3554、3562 |
| scene contexts（原66 cut inventory首/中/末事件±1） | 41、42、43、1497、1498、1499、4188、4189、4190 |

以上取并集即70。`review-set.json`保存逐帧完整binding、每条exact reason与assets digest；不宣称覆盖所有66 scene cuts或所有6990帧像素边界。

### Boundary Package, Actual Observation and Receipt

Evidence根R=`~/.local/state/jianji-source-fact-qualification/m2f-engineering-20261003`。`controlled-v1/`保存原construction/alpha/media/candidate，`real-review-v5/`为最终稳定源码package：每帧original ROI105×76、original+内部mask边界overlay、inside/outside清晰色图、6倍nearest-neighbor原图/边界配对；source ordinal/PTS及机器risk reason可见。没有expected PASS/FAIL、confidence或“应该没漏”提示，candidate可见是本工程检查的明确模式，不伪装为blind truth authoring。用户所看v3、UI验证v4和最终v5的review-set/asset digest完全相同；版本更新只绑定最终receipt处理源码，未改变mask、风险选择或图像。

只有一个具名真人engineering reviewer需要回答“当前mask外，是否能看到明显属于旧贴纸的视觉贡献？”。每帧默认UNKNOWN；实际观察缺失、AA/透明/归属歧义或dispute直接UNKNOWN，可升级second review，但不默认双人。用户对明确绑定70帧package的问题实际答复“过关我看了可以.”；reviewerId记录为`user-of-current-Codex-session`，provenance=ACTUAL_USER_MESSAGE，scope=FROZEN_REVIEW_SET，整体观察NO_VISIBLE_RESIDUAL_OBSERVED。R/actual-user-boundary-observation.json保留原话、问题、set digest及ordinals；没有伪造70条独立逐帧答案，也不推测未看范围或逐像素truth。此为用户对冻结包的整体观察解释，不是独立blind资格。Browser synthetic input只验证页面interaction，明确SYNTHETIC_UI_TEST_NOT_ACTUAL_REVIEW，不写入实际观察文件或真实receipt。

最终统一receipt为R/`real-review-v5/final-receipt.json`，digest **a07c601510c4002695915b57604c5250f76a7fe627fd2b6930a9952cfdbd78db**，绑定source/target/range、detector/extractor/source/config digest、candidate bitmap、controlled corpus digest/metrics、M2-C receipt、review-set/asset digests、实际观察、旧M2-A/B refs与limitations。状态**ENGINEERING_REJECTED**，真实观察**NO_VISIBLE_RESIDUAL_OBSERVED**，authority=none / eligible=false / claims=[]；不能用真实包的有限肯定观察覆盖known controlled失败。原initial UNKNOWN receipts和build failures保留，不称真实pixel零漏，不生成SOURCE_QUALIFIED/MASK_ADMITTED/PRODUCTION_READY。

旧 `FULL_RANGE_STATIC_CONTRADICTION` 明确作为 `historicalAppearanceCriterion=REJECTED` 引用：它测量RGB sample-envelope，是历史appearance判断，不是新geometry owner；**not used as sole static decision criterion**。133异常/61 clusters/506 violations和cause未知均绑定，未删除、重命名为PASS或false positive。

### Performance, Verification and Completion Boundary

controlled corpus实际459285.952ms；真实package build16.423s，package写完前统计3721515bytes，parent peakRSS223670272bytes。artifactBytes是当时已写文件计数，另有最终package/receipt及engineering日志，不伪称全目录总量。只记录，不优化算法。

fresh `npm run typecheck` 与corpus脚本单独strict tsc均exit0。首次focused **3 suites / 44 Vitest checks PASS，无skip**：M2-A extraction10、activation28和Python bridge6；bridge内79项Python controls（新M2-F13、旧holdout30/truth7/comparator10/geometry13/anomaly6）全部PASS。用户实际观察到达后增加保留aggregate原话而不制造逐帧答案的control，新M2-F为14项；最后代码修改后的fresh typecheck/同三suite最终结果存R/engineering/*final*，不借旧结果补签。controlled19例真实执行及其480px failure是工程验收失败，不混称unit失败，也不被tests PASS覆盖。Chrome MCP独立context验证70 sections、280 PNG全部载入、original105×76、6倍edge1260×456、默认UNKNOWN、空reviewer拒绝与逐帧JSON导出；浏览器自动操作没有给真实human verdict。首次并发image.decode出现EncodingError，随后DOM核对全部已载入；原失败不冒充观察。

owned Harness按current foreign policy与6项before/after SHA执行，最终actual code/verify receipt及每项结果见R/engineering/harness-*.log、harness-result.json和其引用的`.agent/harness/runs/`。首个run在用户实际观察到达、需要刷新最终receipt与record时显式终止，保留NOT_EVALUATED/cancelled回执并使用最终scope重新运行，不掩盖旧结果。此处不预写Harness PASS；其失败/过期/foreign/global blocker不被focused tests或AOCI覆盖。全库`git diff --check`发现foreign `aoci.code.txt` EOF blank-line，未修；本轮owned diff另行核对。没有调foreign timeout、GPU export、upload、千川或历史M5D2A链接。

逐项官方scope核对本轮6对象均observe，不扩indexed范围；Maintain为aligned/0 candidates，Verify/Check/Guide按最终稳定状态执行，actual收据存R/engineering/aoci-*。shared indexed/baseline字节属于foreign session，不stage。首次Whole-Index传输被host截断，认知链停止，当前只作source-bound工程，不声称完整系统认知可靠；治理aligned不修复此认知声明或任何Harness失败。无repository dedicated capture skill，本节和R保存稳定checkpoint；不修改外部memory。显式modelRequests0优先于通常委派路线，不运行Kimi/native视觉或adversarial模型补验收；Parent负责最终diff和工程拒绝裁决。

**Next boundary：** 当前controlled分离组件失败不允许进入target-proof接线。唯一下一候选slice是针对已保留disconnected-components反例，在新方法版本中修复/明确拒绝确认目标内分离组件的完整性，再重新执行本M2-F corpus及冻结真实边界工程检查；本轮不实施该算法修复，不调当前mask到通过。M2 product proof未签发，M3仍BLOCKED，PRODUCT_DISABLED，guard unchanged，modelRequests=0。

## M2 Qualification Boundary Course Correction — 2026-10-02

本轮为 `SOURCE_AUDITED / CONTRACT_CORRECTION / DOCUMENTATION_ONLY / PRODUCT_DISABLED`。依据 [追加audit](shape-matched-cover-v1-simplification-audit.md#m2-qualification-boundary-course-correction--2026-10-02)、[Delta Spec §6](shape-matched-cover-v1-simplification-spec.md#default-m2-static-engineering-acceptance) 和 [更新Plan](shape-matched-cover-v1-simplification-plan.md#current-bounded-follow-up--m2-engineering-boundary)，不运行新holdout triage、不进入M3、不修改算法/mask/guard，不删除M2-E工具或历史失败。下方M1-A至M2-E全部原文保持；其中当时的Need/Stop是历史模式条件，当前适用关系由本节及Spec解释。

### Preserved Evidence

| Slice | Unchanged fact |
| --- | --- |
| M1-A | real CPU automatic discovery已成立；候选无authority，不签absence。 |
| M2-A | development mask3395px，bbox628/1/81/59，SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`；旧REJECTED/FULL_RANGE_STATIC_CONTRADICTION保留。 |
| M2-B | 133 RGB anomalies；不能直接解释为运动，也不能全部补签编码噪声。 |
| M2-C | full[0,6990)，DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED，geometry issues0；不证明mask完整。 |
| M2-D | independent pixel comparator工程实现有效；当前真实233s源无真正pixel ground truth，真实miss/excess仍null。 |
| M2-E | inventory/registry/truth tooling已实现；255真实video files、218unique SHA、210candidate-unseen SHA、76suspected candidate groups、confirmed independent unseen static sources0、valid reviewers0、HOLDOUT_INSUFFICIENT；历史Harness FAIL不变。 |

### Corrected Acceptance and Current Stop

产品仍需非空确认集合、保守mask与完整目标时域、逐输出opaque覆盖100%、SAFE/NATURAL、冻结/custody/原queue。默认offline M2采用独立已知truth受控反例、真实全范围geometry/边界工程检查、明确方法和支持/拒绝包络；精确pixel指标无分母不填0。多来源下限仍为M5每支持类别≥3可核查独立真实来源，但不强制都是never-exposed。

M2-E的双人blind逐像素truth与严格unseen资格保留为可选high-assurance路线，其工具拒绝/强声明不放宽。HOLDOUT_INSUFFICIENT/reviewers0继续描述该路线，不再自动成为默认M2的唯一blocker。工程观察不签SOURCE_QUALIFIED或真实全6990帧pixel零漏。

当前M2仍INCOMPLETE：按新合同的真实保守边界评估尚未完成；M2-A/C结果的可消费proof与canonical knowledge/admission接线也未完成。当前M3仍BLOCKED，且本轮明确不进入；未重新qualification、未新媒体decode/export或truth标注，shape媒体modelRequests0。唯一后续候选为已有development材料的static mask边界/异常工程收敛，本轮未执行。

### Source Audit and Delivery Evidence

核对用户指定`2e4274b`的10文件diff、实际开始HEAD `582f8f6`及后续foreign规则/千川变化；Shape实现从指定基线到本轮字节不变。读取本轮6份指定文档、M1-A→M2-E owners，CodeGraph关系结合imports/callers裁决。受管Kimi只读调查invocation `d7f6f116-f79f-4634-a0a5-2d788caa7064`、seal `84f65c846ae0b509c91b6c59941f2d26d12926b41e229281240487dd1a8fcd90`、deep/max，4wire requests、199.786s、PARSED；4artifact/7完整Read由Parent核对。Parent裁决见audit，不用模型意见补真值或签验收。

Evidence根R=`~/.local/state/jianji-source-fact-qualification/m2-boundary-correction-20261002`：before快照、原文、24项实现SHA、canonical receipt及Parent裁决；本轮仅5份owned文档，旧record suffix逐字节核对。按current verification-before-completion运行owned scope与当前policy选定的checks及verify，结果以R和对应`.agent/harness/runs/`原receipt为准，不预写PASS、不覆盖旧M2-E FAIL。AOCI逐项核对role并执行官方Verify/Check/Guide；本轮对象与foreign全库drift分列，不抢共享索引或截断机器批次。

没有repository专用session-capture Skill，本节保存durable checkpoint，不更新外部memory。Spec/Plan由Parent Self-Review，本轮没有implementation diff，不触发额外implementation reviewer；工具/source/admission guard原字节不变。共享索引、规则、renderer及其他会话改动保留，只stage/commit本轮文档。

## M2-E Real Static Holdout & Independent Truth Acquisition — 2026-10-02

依据 [M2-E plan](shape-matched-cover-m2e-plan.md)、[Delta Spec](shape-matched-cover-v1-simplification-spec.md) 与 [主计划](shape-matched-cover-v1-simplification-plan.md)，本轮建立只读素材审计、offline metadata registry、冻结风险truth plan、candidate-blind original ROI raster editor、two-pass human QA与既有M2-D comparator接缝。**停止状态：HOLDOUT_INSUFFICIENT / INDEPENDENT_REAL_STATIC_SOURCE_INSUFFICIENT / REAL_STATIC_QUALIFICATION_BLOCKED_BY_HOLDOUT。** 工具不能补签缺少的真人或材料。

### Current Media Inventory and Exposure

私有证据根R=`~/.local/state/jianji-source-fact-qualification/m2e-holdout-20261002`。只读扫描11个`/home/reggie/电商/*/素材`、repository媒体（排除依赖/构建/运行目录）、qualification private evidence；没有移动/改写素材或自动登记holdout。R/inventory.json、exposure.json、historical-session-audit.json与private-truth-audit.json保存paths、SHA、范围及分类证据。

| Inventory | Current evidence |
| --- | --- |
| Physical video files | 574：用户源视频255、private controlled/derived/evidence媒体319；repository指定扫描范围未发现其他来源。private媒体不能补来源数。 |
| Unique user SHA | 218；37份exact-byte重复文件。overall unique SHA442，不等于真实独立来源。 |
| Suspected source groups | 83；8个sparse原帧dHash/亮度样本发现725条可能复用pair。组是保守疑似，不能证明同拍摄或相互独立。 |
| Confirmed development exposure | 7个真实SHA：当前233s原片反复用于M1/M2参数开发；另6个曾在historical source inventory的author-side contact sheets显示原像素，不冒充never-exposed。 |
| Conservatively excluded | 7个已曝光SHA加1个疑似关联派生SHA；相似度组内传播曝光风险，不声称额外1个已证明被看过。 |
| Candidate unseen | 210个SHA / 76个疑似组；没有证据证明static target、无复用或完整来源履历。 |
| Confirmed static target | 1：原233s DEVELOPMENT SOURCE；不属于最终holdout。其他217个独特用户SHA未确认static target。 |
| Confirmed independent unseen static sources | 0。218个用户SHA的raw recording/download/overlap详细provenance当前UNKNOWN；NO_STRONG_MATCH不自动转ACCEPTED。 |
| Existing valid human truth/reviewer evidence | 0。当前478份有界private JSON审计的8处truth/reviewer命中均非此static holdout有效接受；精确回查5个historical sessions，没有把旧controlled/D2Q/算法candidate挪成真值。 |

不能用different SHA推导independence。疑似组33/11/11/10/8/7等较大簇仅提示可能素材复用，后续需要raw/download身份、派生/帧重叠说明及证据digest。稀疏审计可能误报和漏报，不是版权识别或全视频相等证明。

### Accepted Static Qualification Boundary

原合同每支持类别至少3个独立真实来源，Spec未明确要求逐帧human pixel truth。依本轮授权先在现有Spec/Plan显式写入M2-E Delta：多独立holdout、预冻结风险truth set全部required pixels零漏、full-range geometry consistency、无不支持morphology证据、保守方法/config/source/runtime冻结；只授`ZERO_MISS_ON_FROZEN_TRUTH_SET`。没有从121帧推导`ZERO_MISS_FULL_6990`，不增加full-canvas absence、D2Q、T(f)、EMPTY或dual-AI review。真实output visual acceptance仍在M4/M5，不制作输出也不进入M3。

数量保留≥3，1px miss即SOURCE_NOT_QUALIFIED；UNKNOWN、漏帧、source/target/PTS/方法变化、未完成geometry、无实际independence与human身份核实均SOURCE_INCOMPLETE，exact指标null。旧M2-D原片missedRequiredPixels / missingRequiredFrames / excessPixels仍null，旧133 RGB anomalies、M2-C6990/6990与0geometry issues不被改写。

### Frozen Truth Frame Plan and Reviewer Workflow

策略`static-risk-truth-plan/v2`：首尾、16 temporal anchors、16 fingerprint+版本seed随机reserved、original edge/chroma/RGB/difference/background及geometry scalar extrema（earliest/latest tie）和±1；完整scene event inventory先冻结，再最多12个事件分位点±1；全部geometry visibility ambiguity上下文。实际N由源数据确定，硬上限192，超预算SOURCE_INCOMPLETE；不能删难帧直到通过。该工程风险采样不提供统计全范围pixel proof。半透明/AA语义歧义由真人标UNKNOWN，不凭geometry代替边缘truth。

首版对development原片将66个scene cuts全部±1纳入而超192预算，失败日志永久保留。没有human开始或unseen holdout冻结；v2只将切镜人工观察改为明确的预冻结事件分层，保留全部ambiguity，不改detector/mask/geometry门限。对未来新来源仅复用strategy，不复用旧ordinal答案。

原片DEVELOPMENT_TOOLING_ONLY package：**121帧**，first0/last6989，original ROI615/0/105/76、原像素1:1/整数zoom；plan SHA `ab68308ebc014334bd75dbbac529d3c100d30346970599d2a9747e29b6b78f2a`。R/development-review-v2（原版本）与development-review-v4（最终editor）只含original PNG、blind manifest和editor；method/risk/geometry/selection sidecars在另一个private目录，不交reviewer。没有candidate mask、support、component、landmarks、miss/excess或expected pixel hints，没有生成真人truth。

顺序：source/method freeze → 风险观察与frame plan freeze → Pass A truth → Pass B独立QA → truth/declarations freeze → 冻结版本candidate comparison。required包含visible fill/outline/AA/thin tips/text/可辨low-alpha贡献，未标默认UNKNOWN。两位不同真人均需reviewerId和四项independence声明；QA只看original+human truth overlay，可APPROVE/REQUEST_CORRECTION/UNKNOWN，不能答candidate是否pass。负责人实际核实来源历史与两位真人身份后才可授离线接受；JSON声明/模型意见不能恢复进程内freeze handle或任何产品authority。

真正holdout冻结后禁止调detector/mask/geometry/dilation。失败保持失败；下一方法版本需保留旧结果并换新的unseen holdout。本轮registry未自动纳入候选用户素材，正式holdout packages=0、已开始真人标注=0、合格reviewers=0；不能伪装自己为independent human reviewer。

### Candidate Freeze, Controls and Performance

R/candidate-method-freeze.json绑定现有detector `cpu-stationary-components/v1`、extractor `cpu-static-conservative-mask-development/v1`、geometry `cpu-static-geometry-development/v2`的exact configs、8个源码/FFmpeg SHA、Python/NumPy/OpenCV/Pillow/Node/FFmpeg/TypeScript/Vitest版本。所有既有算法与guard保持原字节；3395px、bbox628/1/81/59、mask SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893` 不变。method freeze不是想法的证明，源码/runtime变化不能复用旧接受。

| Offline measurement | Evidence |
| --- | --- |
| Media inventory | 17.200s；JSON1,712,934 bytes |
| Sparse similarity audit | 604.214s；CPU-only、每unique源8帧缩略样本 |
| Development risk/source decode and package process | 56.046s；6990帧原ROI full-range clock/hash核验；未创建全片RGBAspool |
| Selected original reviewer package | v2：121帧，3,602,358 bytes、package-only0.169s；最终v4复用相同冻结plan/原PNG、121帧、3,602,523 bytes、0.160s |
| Real truth comparator | NOT_EVALUATED：没有真实合法truth；controlled比较记录per-run comparatorSeconds，不挪成真实时长 |

37项新增Python controls（30 registry/workflow + 7 truth/similarity）实际PASS，覆盖用户22类并增加共享raw ID伪分组、late development exposure、同人QA、real metadata伪接受、持久CLI comparator与no-overwrite、bounded risk和candidate-blind package。既有comparator/geometry/anomaly回归通过Vitest bridge原命令执行；M2 extraction、M1 discovery、activation由本轮focused与policy专项回归执行。fresh typecheck、Harness code/verify及官方AOCI Verify/Check/Guide的最终实际结果以R/engineering日志和`.agent/harness/runs/20261002-shape-static-holdout/`scope关联的receipt为准，未成功/过期/skip不能写PASS。

Chrome MCP在独立context验证offline editor：controlled8×8点击/paint、整数zoom、帧切换、QA只读、unchecked声明、canonical truth digest；实际121帧package只读查看确认source SHA、original105×76和所有像素默认UNKNOWN，candidate字段为空、身份空。Parent另发现canvas border计入绘笔坐标可能导致边缘点击错1px，已修正；在controlled8×8页面4倍zoom最后一列像素正确、邻列仍UNKNOWN，QA不可画、1:1 content尺寸正确。真实原像素/plan不变，没有human开始。递归拒绝source/ROI/range/binding中的额外candidate字段，保留原SourceIdentity rotation/clock interpretation字段；rapid frame navigation以generation核对避免旧图异步覆盖新ordinal，controlled不同颜色帧实测最新原RGBA SHA正确。首次比较同时绑定candidate/geometry和truth digest，private pin跨CLI重启保留；1px失败后改candidate再试的反例已拒绝。修正及foreign source失效时显式取消旧owned Harness run并保留非PASS回执，最终scope和检查重新冻结运行。未操作千川tabs，没有真人truth或model生成标注。

受管Kimi只作text/code接缝mapping，invocation `eef6d2fe-e81b-48aa-a6de-e9e4c9484486`，seal `f4acd8476ee74fa7ebbc3e272a3afd51582828d74de447dee38b3ae63cb2fb9a`，qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，deep/max、2 wire requests、238.291s、PARSED、无orchestration retry；4个artifact SHA和3个完整observed reads由Parent核对。仅复用既有pure comparator，不把工程意见当truth/验收。stable implementation Risk Gate为KIMI_REVIEW_NOT_REQUIRED：offline新owner无生产/凭据/源知识authority，fail-closed real acceptance还有真实材料与human gate，parent负责最终diff与project-native检查。媒体modelRequests=0。

### Governance, Owned Scope and Stop

用户明确允许在foreign dirty `.agent/harness/policy.json`上仅追加M2-E check/route，其他staged/dirty Harness与千川业务改动保留。新增scripts/tests/docs按当前AOCI role为observe；policy为indexed，逐项核实当前source binding；官方Maintain返回aligned、0 candidates，fresh Verify/Check/Guide exit0。没有领取/截取foreign active创作批次。own transient sealed task/receipt归档R/engineering后，经官方orphan治理移除本轮3个已归档runtime Entry；未删除业务源码。context-compaction全量读取发生host截断，停止认知链，继续source-bound工作，不声称完整系统认知可靠。官方fresh治理结果和本轮对象/foreign drift分别保存在R。无专用session-capture Skill，本节保存checkpoint，不改external memory。

### Final Verification Blocker

最终code receipt `.agent/harness/runs/20261002T133633Z-4adb7d60/receipt.json` 为 **FAIL**，不是completion PASS。typecheck、M2-E bridge（30+7新Python controls以及10 comparator/13 geometry/6 anomaly，共66）、shape187项及owned AOCI11个对象均PASS且无skip；extended940 PASS / 11 timeout FAIL。超时分布：原M2-A static extraction7项、旧auto-contour diagnostic2项、GPU export1项、upload retarget1项，分别原30s/5s预算；没有修改测试上限、算法或关闭必需检查。此前focused4 suites/60 tests PASS保留，但不能覆盖这个最终失败。

Source identity实际变化为另一会话新增`src/renderer/SourceMediaList.tsx`和`scripts/material-preview-smoke.mjs`，修改`src/renderer/App.tsx`、`src/renderer/styles.css`及`tests/material-collection.test.ts`；不属于本轮，未抢归属或修改。documents10处失败全部来自未修改的历史`docs/shape-matched-cover-m5d2a.md`跨repo引用（repository_escape）；本轮四份Shape文档未有broken link。不能为了PASS删必需route或静默改旧research record。当前shared Harness registration已由owner在`7ced285`提交，本轮仅提交独立业务文件。

因此工具实现及controlled validation ready，**正式Harness completion BLOCKED**；SOURCE/material qualification仍独立为HOLDOUT_INSUFFICIENT。需其他会话稳定实际参与源码，并由适用owner处理历史document route/reference及11项超时后重新完整code+verify。当前verify实际非PASS、fresh typecheck/目标回归/AOCI和owned diff结果在R/engineering保存；不会以Python tests、AOCI aligned或commit替代Harness。全树diff check还报告foreign `aoci.code.txt` EOF空行，本轮owned业务diff无该问题。

最终focused四组实际为51 PASS / 9 FAIL，359.91s：M2-E bridge5（66 Python controls）、M1 discovery17与activation28全PASS；M2-A extraction1 PASS / 9个30s timeout，不能报告该回归通过。正式verify receipt `20261002T141649Z-785141fd` FAIL，拒绝原code FAIL receipt。交付前官方AOCI Verify/Check报告10个foreign batch/account/index对象stale，Guide为authoring_required；本轮11个owned对象此前实际PASS，当前全库治理不声称aligned，未接管其他会话机器批次。压缩后Whole-Index续读因overview_snapshot_changed中止，保持source-bound调查，不声称完整系统认知可靠。

随后final checkpoint官方Verify/Check均exit0、governance_aligned=true、stale=[]，Guide complete/aligned/next_action=none；该治理状态已由共享owner收敛，不是本轮接管批次。之前stale及认知续读中止作为历史失败保留，治理PASS不恢复完整认知声明，也不覆盖Harness FAIL。fresh typecheck exit0、本轮10业务文件staged diff check PASS；原mask和guard字节未改。最终实际日志使用R/engineering/*final-checkpoint*，最终scope刷新后仍对保留的FAIL code receipt执行verify，不伪造新的PASS。

**Need:** 3个可接受的、未用于开发的独立真实static sticker来源；也可对现有210候选补充target/provenance证据后由负责人逐项接受，无需为了SHA数量重新编码。提供原下载/拍摄身份、派生/重叠/先前使用说明及可核查证据。另需2位符合四项声明的不同真人author+QA；每source实际N≤192，先冻结计划/package再开始。若出现unknown/预算/失败则不能继续qualification，不要求6990帧逐帧人工mask。普通产品用户不负责truth/reviewer/3source/holdout研发工作。

**Status:** TRUTH_ACQUISITION_PIPELINE_READY（工具实现及controlled验证；正式Harness completion BLOCKED，不代表整体工程完成、真人或真实资格） / HOLDOUT_INSUFFICIENT。M2仍INCOMPLETE，M3仍BLOCKED，PRODUCT_DISABLED，guard unchanged，modelRequests=0。

## M2-D Independent Required-Pixel Truth — 2026-10-02

依据 [M2-D plan](shape-matched-cover-m2d-plan.md) 和当前course-correction，新增离线逐像素comparator及独立构造反例；**真实目标资格仍 `INCOMPLETE / INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING / PRODUCT_DISABLED`**。本轮没有建立该原片真正独立的required-pixel truth，因此不能回答3395px mask是否包含全部required pixels，也不能把三个指标填零。这是M2-D的真实证据blocker，不是M3入口。

M1无预填ROI/mask/stickerId的发现结果，M2-A3395px、bbox628/1/81/59、SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`、`[0,6990)`、133异常及 `FULL_RANGE_STATIC_CONTRADICTION`，M2-B61 clusters/97.23% boundary/cause未知，M2-C6990帧/0 geometry issues/全局0/0/有界局部亚像素拟合及 `DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED`，均保持旧结论和旧字节。原源码、mask、阈值、收据及下方历史章节未改。

### Prior Session and Artifact Investigation

用户要求“在之前的session找下”，Parent实际回查M1-A/M2-A/M2-B/M2-C/course-correction session、M4-A memory指向的原session记录和当前留存artifact，不只使用memory结论。搜索当前qualification evidence树的479份JSON（明确排除route runs、snapshot、inputs及engineering目录，0 oversized跳过），匹配truth/requiredPixels/reviewer声明并核对来源；精确paths/SHA/命中和排除范围保存R/engineering/prior-artifact-audit.json与prior-session-audit.json。结论仅针对已检查范围，不宣称全机不存在truth。

| Found evidence | Actual identity and scope | M2-D judgment |
| --- | --- | --- |
| `real-cover-visual-20260930/segment-90-93/result.json`及bitset | 同原片SHA；2700–2789；3371px，bbox628/1/81/60，SHA `415c72e6…bc7ba53`；方法 `temporal-max-channel-std-lt20-largest-8-connected-component-dilate-3-v1` | 旧算法candidate，不是独立required-pixel truth。M4-A人工审核绑定此候选且仅90帧，不产生全6990帧独立分母；原`/tmp` probe/store此时已不存在，未重造旧receipt。 |
| 同目录14–17秒candidate | 420–509，3259px，SHA `7bfde65d…253838`；同temporal方法 | 同样不能移作truth。 |
| `auto-contour-implementation-20261001-*/development-run/method-0/1-truth-freeze.json` | `CONTROLLED_CONSTRUCTION`，范围0–5，sourceKey `8bda080b…f2f48` | 其他受控源，不能挪用给原片目标。 |
| `auto-contour-catalog-followthrough-20261001/development-freeze.json` | 原片SHA正确；`AUTHOR_SIDE_UNQUALIFIED_ROI_NOT_TRUTH`，`truth=null` | 仅ROI线索；其原recent-session audit也明确未找到真实pixel/motion truth。 |
| 旧D2Q/D2A/independent-holdout packages | 合成媒体/目标声明、构造truth；未绑定此原片required pixels | 不启动研究资格链、不将其当当前static truth。 |
| M2-A/M2-C session final messages | 原资格INCOMPLETE、真实独立truth缺失 | 未发现被遗忘的真实通过结果。 |

没有找到原始贴纸alpha、同帧无贴纸参考或本目标完整范围的独立像素标注和实际独立审核。仅由压缩RGB不能唯一界定抗锯齿、半透明和编码边缘贡献；另一种分割算法、landmarks、旧support或较大的候选mask不能补签独立truth。Parent没有代填人类作者/审核身份、生成虚假审核或改写旧qualification。

### Comparator and Fresh Real Diagnostic

`scripts/shape-cover-required-pixel-truth.py`只读冻结mask，复用M2-B的`decode`，不执行`reconstruct`/detector/geometry。truth packet绑定完整source/target/confirmation/ROI/range及每帧ordinal/PTS/endPTS/RGBA SHA；在完整核查ROI比较，不能裁到candidate bbox。标签0明确非required、1required、2UNKNOWN。来源与不同author/reviewer仅记录声明，JSON不恢复private owner或证明实际独立审核；REAL_MEDIA声明即使数值零漏仍 `INCOMPLETE / REAL_MEDIA_INDEPENDENCE_AND_REVIEW_NOT_VERIFIED`，不开放原qualification owner。

逐帧记录差集及源坐标；`missedRequiredPixels`与`excessPixels`为pixel-frame occurrences，`missingRequiredFrames`是存在至少一个required漏像素的帧数，另列unique坐标。UNKNOWN、未界定ROI边界、空target或非static时exact指标null，known差集只作observed下界。任何单像素/尾帧漏失不被平均抵消。truth缺失时无observed分母，更无假零；额外像素不能抵消漏失。

真实诊断根 `~/.local/state/jianji-source-fact-qualification/m2d-truth-20261002-missing`（R）。使用原source SHA `a18f7e4e…fc0bf`、应用FFmpeg SHA `f8e3453a…816a2d`，完整CPU双pipe核验原ROI615/0/105/76及6990/6990帧RGBA SHA、PTS/endPTS、首尾，timeBase1/15360；源/engine/所有输入/脚本前后SHA相同。原mask位集/像素数/bbox/range核查相同，没有新extractor或mask修订。

| Measurement | Fresh result |
| --- | --- |
| Original frames bound | 6990/6990；truth frames compared=0 |
| `missedRequiredPixels` | null — independent truth missing |
| `missingRequiredFrames` | null — independent truth missing |
| `excessPixels` | null — independent truth missing |
| Time / parent RSS / child RSS | 12.671s / 60,551,168 / 70,119,424 bytes；Linux独立高水位，非同时进程总峰值 |
| RGBA scratch | 0；无全片spool |

### Verification, Delegation and Stop

按current `verification-before-completion`，10项新Python controls PASS：先定义明确alpha（含alpha1细尖和孔洞）再独立构造candidate，覆盖完全包含、bbox外漏失、孔洞额外像素、单尾帧、UNKNOWN、缺truth、REAL_MEDIA伪审核声明、错源/时钟/SHA/漏帧/循环来源、未界定边界/运动及分配前预算拒绝。6项复用M2-B tests（含真实FFmpeg错SHA/PTS拒绝）PASS。static/activation **2 suites / 38 tests PASS**；typecheck exit0。初次Vitest只指定maxWorkers1导致min/max冲突、0 tests，保留失败；显式min/max均1后完整运行137.81s通过，不改测试断言。

受管Kimi只读调查原qualification与M2-C/spec的truth边界，invocation `5e5ece99-fa2f-45fb-8dbc-53ea269e5c18`，seal `952721e7bed8b845c6afbbcc1adaadf655049916833d8061b26663818fe854f9`，qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`；deep/max、3 wire requests、246.500s、PARSED、无retry。Parent逐项核对artifact摘要和3项完整observed Reads，接受“metadata不证明独立审核/REAL_MEDIA当前关闭”。其把missingRequiredFrames解释为缺truth记录被Parent纠正：本轮按用户要求定义为**有required漏像素的帧数**，缺帧本身直接拒绝。其逐帧人工描边建议不升级为普通用户流程，不通过模型意见产生truth。不是最终implementation review或真实图像审核。

Final candidate Risk Gate：`KIMI_REVIEW_NOT_REQUIRED`；无用户指定final review，无凭据、产品请求、source知识或持久业务写入，离线记录错误不产生重大production/authority后果。comparison语义由明确构造反例与原完整解码绑定核验；真实truth缺口固定INCOMPLETE，review不能补齐。source/test/plan及旧owner摘要、fresh logs和final diff绑定R/engineering。

四个owned业务对象均按AOCI现行scope为observe，不新增正式Entry/baseline；Verify/Check/Guide及精确foreign drift结果随R保存，本轮对象与全库状态分开核对，不越权领取包含foreign active对象的创作批次。封存runs归档时曾出现4项orphan，后续官方校验已无这些条目；本轮对象未出现missing/stale/unbaselined，全库仍有其他窗口的未对齐对象。首次AOCI全4块交付已确认，strict attestation未通过；context-compaction刷新在第2块返回overview_snapshot_changed，停止该认知链，继续源码绑定工作，不宣称当前完整系统认知可靠。没有专用session-capture Skill，本节与R承接stable checkpoint，不修改外部memory。

当前AGENTS增加scoped Harness gate后，本轮以script/test/plan/record四项精确before/after SHA建立 `harness-task-scope/v1`，执行policy路由的code检查及只读verify；scope与实际receipt/log在R/engineering归档。receipt若有FAIL、NOT_EVALUATED或快照变化就不能声明Harness PASS，不能借既有Python/typecheck结果覆盖它，也不修改其他窗口正在维护的policy/owner。仅限定本轮四文件提交，保留其他窗口改动；真实truth仍是独立的qualification blocker。

**Stop:** comparator工程已验证，真实M2-D尚未完成。仍需要本原片目标独立像素依据及实际独立审核，随后才可计算真实三项指标；当前不能给mask完整性PASS。无mask优化、M3、输出coverage、画面安全或product activation。

## M2-C Static Geometry Verification v2 — 2026-10-02

依据 [M2-C plan](shape-matched-cover-m2c-plan.md) 和当前 course-correction，本轮只建立 **cpu-static-geometry-development/v2**，只核查已确认右上“国货之光”的完整 `[0,6990)`。新 receipt 状态 **DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED / REAL_MEDIA_QUALIFICATION_INCOMPLETE / PRODUCT_DISABLED**。其意思是：在下述 development 方法和灵敏度内，全范围未检出超过冻结门限的位置漂移、landmark 消失或明显局部结构变化；不是任意精度的静态证明，更不是 mask 完整性或 source/production authority。

**RGB appearance stability != screen-coordinate geometric stationarity。** 旧 M2-A `FULL_RANGE_STATIC_CONTRADICTION` 永久保留，没有改为 PASS；旧 mask 3395px、bbox628/1/81/59、SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`、完整范围和133异常均不变。M2-B的61 strict clusters、78 distinct pixels、506 violations、492 boundary-layer-1、除内部小例外外距离≤3、6990帧±2px integer search全0/0、cause unqualified、tolerance24、parameter revisions0也原样保留于下文及原 evidence。本轮没有独立 required-pixel truth，也未进入M3。

### Method and Ownership

新增离线 `scripts/shape-cover-static-geometry.py`，使用本机已有 NumPy/OpenCV/Pillow，纯CPU，不增加产品依赖。复用 M2-B `decode` 的应用FFmpeg单进程、原ROI615/0/105/76、rawvideo与独立framehash双pipe、每个ordinal/PTS/endPTS/RGBA SHA核验。JSON只读取历史绑定，不恢复原private evidence owner或许可；新结果固定authority=none、eligible=false。

几何参考只来自原96代表帧在确认粗ROI内的**持久有向灰度梯度 landmarks**：Gaussian sigma0.6，Sobel/8，梯度幅度≥8，方向cosine≥0.9且至少90%样本达共识，sample gradient strength ratio0.5–2；3×3分块，各块最多48点、至少8点，至少6块及双轴跨度至少粗框50%。不使用旧mask、2082px support或RGB min/max作几何参考/required pixels。旧mask仅核对固定摘要，完全不修改。

固定参考逐帧对齐，避免滚动参考累计漂移。全局搜索±4px，局部±2px，整数粗搜后0.25px双线性细搜；全局超过0.5px、局部超过0.75px则拒绝。归一化有向梯度correlation须全局≥0.9/局部≥0.8；相距至少1.5px的竞争峰gap≥0.02，搜索触边或歧义明确unresolved；gradient energy ratio0.45–2.25，低于参考35%的landmark比例不得超过15%。这些是受控development门限，先于真实运行冻结，不是普适motion资格。没有跨帧平滑，不忽略单帧或尾帧。

所有逐帧metrics、各分块偏移/相关/歧义、landmark原坐标/向量、配置/源码/依赖版本、参考和frameMetrics digest、严格连续issue ranges及旧133帧交叉表可重算。source与全部历史inputs/原方法源码/引擎前后SHA核对；取消、绑定失配、范围缺项、预算或freshness失败不写成功result。

### Full-Range Development Evidence

最终证据根 `~/.local/state/jianji-source-fact-qualification/m2c-geometry-20261002-accounted-final`（R）。此前v1、final与cancelled独占目录都保留，同级 `m2c-geometry-20261002-*`；sealed任务、运行和verification日志在repo `runs/shape-cover-m2c-20261002`，并归档R/engineering。不读取holdout，不调用产品模型，不修改M1/M2-A/M2-B实现、配置、mask或旧receipt。

| Measurement | Fresh result | Limit |
| --- | --- | --- |
| 原源 | SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，54,577,917 bytes，720×1280 | 原字节未变。 |
| 完整时域 | 6990/6990帧，含0与6989；PTS `[0,3578880)`，timeBase1/15360 | 不缩承诺范围，不丢异常帧。 |
| 参考 | 286 landmarks，9个分块 | 这些是几何观察点，不是目标全部required pixels。 |
| 全局offset | 每帧均0/0；最低correlation0.9789520481，最低distinct-peak gap0.6432205750 | 有限搜索和阈值内支持位置稳定；非无穷精度证明。 |
| 存在性/强度 | 最大lost fraction0.0174825175；energy ratio0.9957012834–1.0328719723 | 未检出明显landmark丢失，不签语义/alpha资格。 |
| 局部结构 | 最低correlation0.9782030429；最大offset分量0.75px | **182帧在cell8出现(-0.75,-0.25)**，其余也存在亚像素拟合偏移；不能写成所有局部位置严格0/0。这些仍在预冻结0.75px上限内，不独立判定为物理位移或编码因果。 |
| 新geometry issues | 0帧、0 issue ranges；旧133 RGB异常对应geometry issues0 | 旧RGB REJECTED不因此撤销。 |
| 新结果 | `DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED` | qualification仍INCOMPLETE；maskCompleteness/coverage NOT_EVALUATED；required/missed pixels为null。 |

配置digest `33ef2267b762a7cef277413d35b95ada15baba184fd8456d632892bebd92b598`；参考digest `50e57704e606bd11189e8c6e6c794748e70fc1d3d269df991e1e3805f39d88c3`；全6990帧metrics digest `cfb8a722078a7dde62f8400dd93623052287950d93ef6b24ade41fe3dda88e53`；新receipt digest `a58259f86945ad19c93fac4fef5bb138c116549e151b45280d418118c29e28a0`。v1和final两次完整运行的result逐字段相同；随后修正内存计数，再用最终源码完整重跑，以上digest和全逐帧metrics仍完全相同。**几何CONFIG在真实观察后修订0次**。

Parent实际查看10个首/中/尾及历史异常原ROI的landmark联系图，并完整统计全部local metrics；`parent-extreme-audit.json`保留182帧及分块证据。人工spot-check只辅助理解，不能代替6990帧机器核查或独立truth。

### Controls, Performance and Failures

13项新增Python tests验证静态重算、noise/通道偏置/超24的亮度变化、四向整数位移、0.75px位移、声明的0.5px灵敏度边界、整体/局部消失、局部形变、单帧与尾帧、无纹理、时域不稳定、周期歧义、搜索边界、错extent/type/box及工作集预算。初始缺模块red、语法错误和颜色对照实际只差13的test失败日志保留；修正test输入后通过，均先于真实参数冻结。

另针对真实目标ordinal0及冻结286 landmarks，显式构造11项development干预：原样/亮度+35保持0/0；四向1px、0.75px、消失、局部2px warp、1.1倍缩放、5度旋转均明确拒绝或unresolved。记录在 `target-intervention-checks.json`；可重算脚本随engineering归档。**这些只是同一已知开发ROI的受控变换，不是新的真实运动样本、独立来源或required-pixel truth。** 最终method SHA与原帧binding均绑定报告。

| CPU / memory | Final actual measurement |
| --- | --- |
| Host | 同Linux开发主机；未测Windows/低端CPU。 |
| Overall / representative decode / model | 40,733.020 / 8,408.208 / 70.335ms。 |
| Full-range decode + geometry / geometry kernel | 31,520.258 / 31,200.981ms；流水重叠，不把差值当精确独立decode耗时。 |
| Parent / child peak RSS | 155,336,704 / 110,985,216 bytes；Linux getrusage分别高水位，非同时进程总峰值。 |
| Model accounting / receipt reserve | 73,543,680 / 268,435,456 bytes，合计小于512MiB；估算/预留不是实际RSS。 |
| Scratch / artifacts | RGBA scratch0，不spool全片；结果、逐帧metrics和附加审计约25.34MB，不含engineering归档。 |

首次memory字段按40bytes/sample-pixel误称upper bound，没有充分包含NumPy临时数组与receipt工作集。Parent在最终审查中纠正为保守96bytes/sample-pixel估算及256MiB receipt预留，超工作集在分配gradient stack前拒绝，并增加大ROI预算负例；几何数学、CONFIG和结果未变，旧计数记录保留。最终accounted运行重新完整核验当前源码，不将旧快照冒充最终。

实际SIGTERM取消于完整验证运行阶段，11,158.481ms返回exit1，仅method-freeze/landmark-reference/failure，无result，无成功receipt；失败保留在cancelled目录。source/math与取消路径未变，随后只加强内存计数和提前预算拒绝。没有重试外部unknown请求。

### Verification, Delegation and Governance

按current `verification-before-completion`，13项新geometry tests及6项复用诊断/真实FFmpeg错SHA/PTS tests均PASS；原static/activation **2 suites / 38 tests PASS**，不新制作独立pixel truth。首次全仓typecheck遇到另一窗口尚未创建的harness/governance.ts，exit2；原日志保留。其owner完成该文件后fresh `npm run typecheck` exit0；没有修改foreign文件修测试。最终diff/文档引用/历史前缀外原字节和method-source-freeze逐项核查，specific-files commit。

受管Kimi只读核查原stream seam与新几何方法的盲点/controls，不读取本轮新实现、不当最终review：invocation `c464bd6a-1318-445f-a01d-97620ac0edfb`，seal `aad28d59767f34ab918360663b6e5e9c6e7eca4e11dc5dba9ba5f8a9164e5d6b`，qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`；deep/max、3 wire requests、151.097s、PARSED、无retry。Parent核对canonical receipt、5个完整observed Reads及4个artifact摘要，采用其源绑定/盲点建议。其“只能沿用旧candidate status/16MiB预算”是原M2-A接缝约束，不能覆盖当前用户授权的新版本development receipt与本M2-C独立64MiB artifact预算；离线route/不共享旧extractor消费由Parent决定。Kimi没有真实图像或最终implementation验收authority。

Final candidate Risk Gate：**KIMI_REVIEW_NOT_REQUIRED**。用户未要求本snapshot的final Kimi review；新代码只在自有独占诊断目录写无authority的development记录，无凭据、产品连接、业务持久化/准入或不可恢复生产后果。project-native验证后不存在“重大后果 + 实质残留运行缺口 + reviewer可独立补齐”的组合；独立truth缺口保留，不能用reviewer verdict补签。exact源码/test/plan/record与相关旧owner/accepted refs摘要保存R/engineering/source-snapshot.json。

四个本轮业务对象逐项AOCI按当前scope均为observe，未出现在missing/stale/unbaselined中，无本轮managed对象待维护；不扩大索引范围、不重复写正式索引。Verify/Check/Guide完整执行，全库仍有其他窗口Harness/Qianchuan/布局业务及runs的missing/stale/unbaselined，故不是governance aligned；精确列表与本轮scope裁决随R保存。完整机器批次含未授权且正在变动的foreign对象，不调用/截断Maintain、不越权维护。初始Overview响应在host输出被截断，未补答Challenge或声称完整系统认知可靠；继续source-bound的本slice。既有dirty共享索引和所有foreign changes保留，不stage/commit。

Repository无专用session-capture Skill；本节与R承接稳定checkpoint，不修改外部memory。停止在M2-C：新的几何development evidence成立于声明灵敏度；真实mask资格仍 **INCOMPLETE / INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING**。未抽样/未参与landmarks的边缘、半透明贡献、低纹理或容限内形变仍有盲点；后续独立truth qualification另行处理。本轮没有M3、required-pixel truth、mask变更、输出覆盖或activation。

## M2-B Static Range / Anomaly Classification — 2026-10-02

依据 [M2-B plan](shape-matched-cover-m2b-plan.md)，本轮只回答M2-A的133个异常意味着什么。状态 **ANOMALIES_REPRODUCED / STATIC_GEOMETRY_OBSERVED_WITH_APPEARANCE_ANOMALIES / CAUSE_NOT_QUALIFIED / PRODUCT_DISABLED**。完整承诺仍为 `[0,6990)`；M1/M2-A源码、config、原receipt和3395px mask全部保持原字节。容差仍24，参数修订0，不缩范围、不做M3或mask qualification。

### Measurement and Exact Replay

新离线 `scripts/shape-cover-static-anomalies.py` 在本机工程环境使用NumPy/OpenCV/Pillow，不进入产品、不发行mask或authority。从原96代表帧按冻结算法重建 **2082px undilated support**、min/max与3px dilation；后者生成mask的bbox628/1/81/59、3395px及bitpack SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`逐字节一致。算法重放是诊断接缝，不是独立边缘truth或新extractor。

同应用FFmpeg（SHA `f8e3453ae7b5681ad659d880a9b58b1afe87c0952e94c5db4023cdb2a8816a2d`）CPU-only解码原ROI615/0/105/76。96建模帧与完整6990帧分别双pipe核对RGBA SHA、framehash、ordinal、PTS/endPTS与timeBase1/15360；源SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`前后不变。全部133个异常的ordinal、changedSupportPixels与worstDifference与M2-A完全相同。

异常条件为每个support像素RGB超出**代表样本**逐通道min/max后，最大通道越界量>24。它不是目标位移、遮挡或mask漏失检测器；3px dilation ring及未进入support的像素不参与该判据。下述“边界/内部”均指support的棋盘距离，不能等同独立target alpha边界。

### Temporal and Spatial Classification

| Observation | Fresh result | Meaning |
| --- | --- | --- |
| 全范围 | 6990帧；133异常 / 6857无异常 | 无异常只表示没有违反冻结RGB判据，不签static范围PASS。 |
| 严格连续异常段 | 61段；41单帧、9双帧、3三帧、2四帧、2六帧、其余9/10/11/15帧各一段 | 最长15帧即0.5s；不把分散异常合成目标失效区间。 |
| 不同异常support像素 | 78px，共506次像素越界 | 不是133个目标移动/遮挡事件，也不是506个漏覆盖像素。 |
| support边界第一层 | 72不同像素、492/506次（97.23%） | 变化主要集中在被算法纳入support的边缘位置。 |
| 边界第二/三层 | 3/2不同像素，3/2次 | 共124帧全部异常像素距support边界≤3。 |
| support第四层 | 同一个像素652/39，9帧 | `[3756,3765)` RGB恒为247/105/102；样本max222/117/96，R越界25、B越界6，只R超过24。 |
| 局部整数位移观察 | 全6990帧、401px support core；25种±2px offset均以0/0最佳 | 有限平移假设下未见整数位移反证；不能证明无subpixel位移、形变、alpha变化或完整motion qualification。 |
| 原始首尾异常 | ordinal233 / 3764 | PTS为119296 / 1927168，起点约7.7667s / 125.4667s。 |
| 最后无异常观察段 | `[3765,6990)`，3225帧 | 107.5s观察段，不自动缩原233s承诺。 |

`anomalies.json`逐帧保存全部超阈值源坐标、RGB、样本min/max、通道越界量与support距离；`ranges.json`保存全部61异常段及无异常补集，带精确PTS；每项causalClassification仍UNKNOWN。`support-traces.npz`保留2082px完整原RGB轨迹与sourceXY，`pixel-observations.json`保留78px完整min/max；这些都不作为required pixels。

ordinal710：23px全部位于support边界第一层，worst57；ordinal715：17px也全部位于第一层，worst89。715最强点656/56实际RGB224/153/83、样本min173/170/172，B越界89；另一个强点631/31的B越界85。这些点在原图白色外轮廓/底缘附近呈现暖背景相关的偏色，未伴随联系图中贴纸位置或文字图案整体改变。**这是颜色与背景同时变化的观察，不能据此独立分解压缩串色、抗锯齿、半透明或背景贡献。**

### Visual Inspection and Parent Judgment

Parent实际检查全部16张original/overlay联系图，覆盖133异常及前后1帧、首中尾，共251原ROI观察；保留原PNG，并用nearest-neighbor放大帮助定位，不拿放大图当原像素truth。各异常段的文字、轮廓和位置保持近似相同，背景颜色/画面经常改变；未观察到目标被前景遮住、闪烁消失、持续位移或持续轮廓扩张。第二次final运行的全部16联系图与已检查v1逐字节一致。

**结论：133帧直接证明冻结的稀疏RGB样本包络在完整范围内被违反；主要是固定图案边缘的局部颜色越界，加一个持续9帧的内部单像素轻微越界。当前证据不支持把它们直接分类成133帧目标移动/遮挡，也不足以全部认定为编码噪声。** 原static product定义允许编码外观变化，而这个development判据混合观察颜色与几何，不能独自决定target类别。STATIC_GEOMETRY_OBSERVED是限定观察，不是完整static资格。

不批准缩短范围：原confirmation保留完整 `[0,6990)`。61异常段和无异常补集不恢复可用mask，不自动分segment，不删除失败帧。M2-A `REJECTED / FULL_RANGE_STATIC_CONTRADICTION`和REAL_MEDIA `INCOMPLETE / INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING`保持；独立required/missed指标仍null。未观察到明显运动不证明required边缘完整，亦不解锁M3。

如果后续继续，问题应限定为独立区分几何/边缘贡献与RGB外观变化的观测合同；任何判据修订都属于后续显式development版本，保留本轮失败，不能调24→40→80使本片过关。本轮到这里停止，不实施后续版本或资格。

### Evidence, Verification and Boundaries

本机Evidence根 `~/.local/state/jianji-source-fact-qualification/m2b-anomalies-20261002-final`（R），v1保留在同级 `m2b-anomalies-20261002-v1`。final诊断18.232s，parent peak RSS144,941,056 bytes（138.23MiB）、child peak100,687,872 bytes（96.02MiB，Linux wait4高水位），support轨迹内存43,659,540 bytes，无全片RGBA持久spool；诊断artifact约17.45MB。未测Windows、低端CPU或产品运行；不调用产品模型、不读取holdout、不做真实导出。

受管Kimi deep只读核查冻结metric的语义、盲点与诊断边界；invocation `8c1cb97c-99cd-40ce-ab98-9ebb104c5005`，seal `def4d8fb903d29644da936995b050366928e3ee1446e829e18c831b7b2319c7a`、qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，PARSED、3 wire requests、277.178s、无retry。Parent核对三项observed Reads及report artifact SHA；接受“sample envelope不等于运动/遮挡”的源码结论。报告所称“diagnostic未存在”只发生在封存的3文件最小包，不能当host不存在；“static core”措辞按源码修正为undilated support（含边缘），未让其升级真实媒体因果判断。未追加最终review。

按current verification-before-completion，fresh typecheck exit0，原static/activation **2 suites / 38 tests PASS**；新增Python诊断 **6 tests PASS**，含严格24/25边界、非矩形support、半开range不跨正常帧、构造整数位移、真实FFmpeg错SHA/PTS拒绝。Linux开发媒体完整绑定及上述两轮真实诊断成立；不得提升为mask资格或产品验收。

Implementation Risk Gate **KIMI_REVIEW_NOT_REQUIRED**：无用户指定final review，无凭据/商业请求/production/durable业务写入；诊断错误受mask字节、全帧绑定和原异常逐项重放约束，不具有重大生产后果。剩余真实pixel/alpha因果缺口明确UNKNOWN，review不能替代truth；exact稳定脚本/test/doc hash随R保存。

开始已有 `.aoci/baseline.json` / `aoci.code.txt` dirty及另一task的runs，期间另一窗口增加并提交Harness plan/spec，均保留。四个本轮业务对象逐项按现有AOCI scope为observe，不需正式Entry；本轮自有runs仅加本机Git ignore并在R保留，封存仍在repo runs，不增加runtime catalog。完整Verify/Check各exit1、Guide（`--agent codex`）complete=false，唯一blocking对象为foreign `runs/20261002-agents-harness-audit/task.json` missing/unbaselined；完整机器批次包含非本轮授权对象，故不越权创作或截断该批次，不把全库治理称aligned。原共享索引字节保留，不stage/commit。

Repository无专用session-capture Skill；本节及R承接本轮stable checkpoint，不更新外部memory。交付只完成M2-B诊断；qualification和product依旧关闭。

## M2-A Static Target Mask Development — 2026-10-02

按 [course-correction](shape-matched-cover-v1-simplification-spec.md) 和本轮 [M2-A plan](shape-matched-cover-m2a-plan.md)，状态为 **ENGINEERING_DEVELOPMENT / REAL_STATIC_QUALIFICATION_INCOMPLETE / PRODUCT_DISABLED**。用户本轮明确确认 233 秒原片右上“国货之光”、完整0–233秒；确认只确定身份与承诺范围，不确认mask或运动。本轮没有M1阈值修订、D2Q、动画、shape matching、placement、输出coverage、visual safety或activation。

### Ownership and Evidence

M1 discovery owner原样重算候选，resultDigest仍 `c1ff778bab42c834459b5b515e1f5ef6dcfff577e139745406e6cd426ea865f4`，7 candidates / 41 components。原ROI627/3/83/61仅作候选搜索线索；用户确认冻结targetId `a766722b-d663-48a3-bd86-3d242d327a87`、精确sourceKey、discovery/result digest、确认来源和ordinals[0,6990)。不接caller mask，不把ROI填满作为mask。

新 `source-mask-static-target.ts` 复用原identity/sourceKey、严格packet/frame clock和CPU FFmpeg双pipe；在source整数网格先format=rgba再crop，目标ROI只扩大搜索12px，不是覆盖几何。每个原ordinal绑定PTS/endPTS/字节数/ROI SHA，独立framehash pipe复核真实解码PTS/duration/SHA，首尾不能遗漏。源与引擎前后freshness、单decode、取消、五分钟和512MiB预算拒绝保持；目标路径不持久spool全片RGBA，M1原96代表帧scratch仍保留其真实成本。确认和evidence只认活跃私有对象，JSON不恢复ownership。

新 `source-mask-static-extraction.ts` 采用原像素RGB temporal std≤20、连通组件≥8px及差18边缘，全部合适component进入支持，不采用旧Python最大组件mask。3px保守候选外扩是明确development假设，不能证明任意未知透明边缘；支持碰搜索边界或外扩截断拒绝。之后流式检查完整范围，每个支持像素须处在代表样本min/max加24容差内；完整验证失败不缩范围，不删除失败帧。该检查仅为static像素包络一致性观察，不是独立mask/motion资格。

新 `source-mask-static-qualification.ts` 在提取开始前冻结独立required pixels、原ROI/时钟/SHA和method digest，绑定私有chronology；逐帧独立重解码并比较真实required pixels与候选mask。construction truth来自媒体构造几何，不能从算法mask导出；零漏只为DEVELOPMENT_MATCH。REAL_MEDIA未经独立审核、缺truth均INCOMPLETE，required/missed/excess/compared指标null。原extractor/qualification仅增加exports，旧D2/fullcanvas/均匀背景方法和拒绝不改；不写knowledge/schema/admission/store，不签产品proof或source authority。

Parent用CodeGraph核对原clock/stream/extractor关系，再按imports/receiver裁决通用短成员误配。受管Kimi只做上述stream边界只读核查：deep/max，invocation `dda9597f-2817-430f-a95a-cd15b647d3ac`、seal `6507c2f17de073bdbbee80ae83d9af68b58a4cc0b82864ff2cb4c4d27e904403`；canonical receipt第三个wire请求RESPONSE_BODY CONNECTION_ERROR，OUTCOME_UNKNOWN，3 wire requests、366.884s、observed_reads为空。前两次上游身份核验不构成可用报告，部分输出未采用；不自动重试，不将其称独立像素审阅或最终review。Parent直接核验实现及媒体。

### Real Full-Range Development

Evidence根 `~/.local/state/jianji-source-fact-qualification/m2a-static-20261002-app-engine`（R）；exact method-source-freeze和执行日志在repo仅本轮忽略的 `runs/shape-cover-m2a-20261002`，交付时另存R。原视频SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，54,577,917 bytes、720×1280、6990帧；最终原字节hash不变。确认范围完整[0,6990)、PTS[0,3578880)，timeBase1/15360，全部clock binding复核一致。method源码6项及参数冻结后均未变，真实参数修订0次，没有读取holdout。

实际产生mask **3395px / bbox628/1/81/59**，SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`；不是历史Python3260px mask，bbox相同不能等同证据。完整6990帧检查有 **133帧STATIC_SUPPORT_CHANGED_OR_OCCLUDED**，状态INCOMPLETE / FULL_RANGE_STATIC_CONTRADICTION。最早ordinal233，一像素差26；ordinal710有23个支持像素超容差，worst57；ordinal715 worst89（17px）；最后异常3764。不得把此结论改写成目标确实移动、动画或遮挡，也不能无独立证据认定只是编码噪声。

Parent查看首中尾原ROI和mask，并对233/234/710/715/1247/3764六帧另行独立重解码，原ROI SHA逐项匹配完整range receipt，PNG/绑定存R/anomaly-inspection.json。抽看的原图目标外观相近、背景变化；这不是required-pixel truth，不能证明全部6990帧边缘保守。最终independent qualification为INCOMPLETE / INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING，指标null，非零漏结论、非真实qualified oldStickerMask。

| CPU measurement | Actual result |
| --- | --- |
| Host | Linux / Intel Core Ultra 7 265K；未测低端CPU或Windows |
| Overall diagnostic | 45,110.406ms，包含原M196帧发现及目标准备 |
| Discovery identity / clock / sampled decode | 434.230 / 9,238.224 / 9,239.870ms |
| Target prepare / mask / full range verification | 10,450.490 / 1,012.060 / 11,261.649ms |
| Parent peak RSS | 294,158,336 bytes（280.531MiB） |
| Observed child peak | 70,377,472 bytes（67.117MiB）；25ms /proc VmHWM采样下界，不是精确全进程峰值 |
| Accounted target working set / target scratch | 3,066,240 bytes / 0；不是全流程RSS或整个M1scratch为零 |
| M1 representative scratch | 353,894,400 bytes（337.5MiB），close清理；无全片24GiB spool |
| Models / remaining product stages | modelRequests0；matching/outputCoverage/visualSafety NOT_EVALUATED，PRODUCT_DISABLED |

前两次本地CLI失败也保留：误传不存在/usr/bin引擎（4.086ms），随后误用旧conda引擎（10,213.450ms）被原discovery拒绝；都未产生确认、成功candidate或mask。最终使用应用现有引擎，SHA与M1相同；未改算法或准入以绕过旧引擎拒绝。R/../m2a-static-20261002-development和-engine-corrected保存failure JSON。

### Verification, AOCI and Stop

读取并执行current verification-before-completion。fresh typecheck、scripts单独strict tsc和esbuild均exit0；最终6 suites **87 tests PASS**：新static10、原discovery17、extraction17、qualification9、activation28、pixel6。覆盖不规则mask/细尖、已知低alpha构造边缘、独立分母、尾帧外扩遗漏、未采样闪烁与移动、全范围首尾、错源/错绑定、克隆/迟到truth、取消/源漂移/预算及旧拒绝。首次9个fixture因未声明方像素被严格clock拒绝；只补setsar=1后通过，失败日志保留，M1实现未改。

Implementation Risk Gate为 **KIMI_REVIEW_NOT_REQUIRED**：用户未指定最终Kimi review；所有新增结果无authority，无凭据/商业API/production/durable-state写路径，具体失败被限制在development拒绝与自有只读媒体证据；项目验证后未发现重大后果与残留验证缺口的组合。真实资格缺口明确保留，不靠adversarial verdict补齐。exact final source/test/script和accepted docs SHA存R/source-snapshot.json；Parent拥有最终diff及claim裁决。

开始时有千川foreign dirty；其session先后提交e491e43/d225393，本轮保留。e491e43新增本session直接AOCI维护授权，故取消此前依旧规则提出的索引归属问题并自行维护；未改其他任务业务源码。当前完整机器批次9/9应用，含本轮5个managed对象、M1遗留3项及已提交千川binding的索引漂移。完整批次/CAS按当前合同执行，没有截断；scope里的docs/script/tests为observe，不扩scope。最终Verify/Check/Guide均exit0，governance_aligned=true、findings=[]、missing/stale/unbaselined/orphan=[]，Guide complete=true/next_action=none。Apply有两项E规模档位warning（旧binding应T、discovery应S），不伪称warning为0；按成功批次不得重复写入的工具合同停止正式写入。

用户随后对先前问题明确选择 **A：由另一窗口统一维护全部索引，本轮提交M2代码与维护交接**。该回复到达时完整批次已应用；保留已维护共享字节，不回滚或再写，也不stage/commit `aoci.code.txt` 和 `.aoci/baseline.json`，由另一窗口统一承接提交。本轮五个managed对象已逐项维护，不将提交交接混称维护未执行。source SHA及批次/校验收据随R保存。

Repository无专用session-capture skill；本节与原私有证据承接稳定checkpoint，不更新外部memory。停止在真实M2资格blocker：冻结static方法全范围不一致，且真实required-pixel边缘truth未独立审核。未调M1、未扩大模型/动画或D2Q、未改guard，未把测试、commit、抽样图片或3395px候选当作M2真实资格完成。

## M1-A Bounded CPU Stationary Discovery — 2026-10-02

依据已提交 [course-correction audit](shape-matched-cover-v1-simplification-audit.md)、[Delta Spec](shape-matched-cover-v1-simplification-spec.md)、[Plan](shape-matched-cover-v1-simplification-plan.md) 和本轮 [implementation plan](shape-matched-cover-m1a-plan.md)，实现 **CPU_DETECTOR_DEVELOPMENT / NO_TARGET_CONFIRMED / PRODUCT_DISABLED**。不继续 D2Q→D3→D4，不建 FullSourceAdmissionHandle，不执行mask qualification、source admission、视觉审阅或activation；以下历史记录保持原状态。

### Ownership and Method

从 `91ecc55` 干净工作树开始；期间另一任务提交 `6549217`（make frontend沟通规则与对应索引），本轮保留其提交。Parent实际读取clock、D2 evidence、extractor/comparator、envelope、pixel/alpha以及FFmpeg和source identity owner，使用CodeGraph核对；CodeGraph将普通 `set` / `now` 错连到其他模块时按实际receiver/import裁决，不将错误关联当模型调用。旧extractor需要caller声明/ROI，envelope需要caller mask，两者均没有自动发现职责。

新 `source-fact-discovery-evidence.ts` 复用 `source-fact-census.ts` 抽出的原严格metadata/packet clock与子进程；`parseFullDecodeClock`、`identifySource`、`sourceKey`、`fingerprintFile`不变。最多96个uniform-PTS代表ordinal，包含首尾；FFmpeg CPU-only、单解码进程，将选定原RGBA与独立framehash pipe逐一绑定PTS、duration、字节数和SHA。仅代表帧进入私有临时文件；闭合清理，不调用full census/D2全片spool，不写知识或语义session。源/引擎前后核验、读取摘要、所有权、取消与总5min期限保持拒绝。输入包络继续采用既有H.264/MP4、SDR、无旋转、精确一对一packet/clock等严格条件，不承诺任意视频格式。

新 `shape-cover-stationary-discovery.ts` 全画布最长边360格，RGB max-channel std≤20、相邻差≤30的consensus≥0.8、持久边缘差≥18；全部8连通稳定component分别处理，最小12格/4个持久边缘，过大稳定区域标背景歧义。component上限4096、候选上限128，超限整体INCOMPLETE而非截断成功。映射为整数cell origin与向外取整ROI；从每个稳定cell内部最多3×3原像素重算支持稳定率并逐帧hash原ROI。ROI、confidence与固定坐标相邻一致性都是候选信号，不是target identity、完整运动证明或保守mask。模型/预填mask/用户ROI/贴纸ID均不参与发现。

每个component保留统计、映射、拒绝及背景/字幕/商品印字歧义；候选固定 `authority=none / eligible=false`，confirmation、mask、motion、source admission、coverage、visual safety全部NOT_EVALUATED。不足3帧/1秒为INCOMPLETE；没有可用候选为NO_CONFIRMED_TARGET并保留NO_ABSENCE_CLAIM。没有返回EMPTY或confirmed集合，没有隐式传入原提取/union/生产链。

### Real Source Development

独立入口 `scripts/shape-cover-discovery-diagnostic.ts` 参数为source path、原identity JSON、新独占输出目录与应用FFmpeg/FFprobe路径；不接受ROI/mask。Evidence根：`/home/reggie/.local/state/jianji-source-fact-qualification/m1a-discovery-20261002-final`（R），前两次保存在同级 `m1a-discovery-20261002-v1`、`-v2`；repo内封存task与执行日志位于仅本轮runtime忽略目录 `runs/shape-cover-m1a-20261002`，最终日志和receipt另存R。未读取holdout，真实运行前冻结方法参数，真实运行后参数修订0次。

原用户233s素材SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`、54,577,917 bytes、720×1280、6990帧、timeBase1/15360、PTS0..3578880；最后重新hash原字节不变。96个原ordinal的PTS/endPTS/byteLength/RGBA SHA逐项与历史canonical D1 census相同（96/96）；历史D1这里只是独立pixel binding对照，不是本轮运行依赖，更不是语义审阅。

三次全画布运行均产生 **41 components / 7 CANDIDATE**，deterministic resultDigest均为 `c1ff778bab42c834459b5b515e1f5ef6dcfff577e139745406e6cd426ea865f4`。Parent查看原第一帧和candidate-0原像素裁图：右上“国货之光”自动ROI为x627/y3/w83/h61，130个稳定grid pixels，原支持稳定率0.8692；全片发现没有注入历史框或mask。底部持久文字形成其余6个候选，均保留字幕/印字歧义；左上贴纸所在区域原支持稳定率0.7031，明确UNKNOWN / ORIGINAL_PIXEL_STABILITY_CONTRADICTION。**有候选不表示全部旧贴纸检出或贴纸身份已确认。**

历史Python需要ROI615/0/100/90、指定14–20s或3秒段，并只取最大component/dilate后得到约81×59 mask。本轮从整233s全画布自动发现返回83×61粗ROI，不输出mask；y3不能替代历史y1边缘数据。mask边缘、漏像素、alpha、透明度/闪烁、完整目标时域及运动资格全部留M2，不能将此ROI填进mask proof。对照控制媒体的负例属于development，不是独立真实holdout。

| Final CPU measurement | Actual evidence |
| --- | --- |
| Host | Linux，Intel Core Ultra 7 265K；未测低端CPU或Windows |
| Overall diagnostic | 19,332.956ms；前两次21,243.897 / 20,567.593ms |
| Identity / clock metadata / representative decode | 301.202 / 8,685.085 / 8,337.482ms；clock包含原FFprobe frame解码，未计入detector纯计算 |
| Temporal statistics / components / original pixels | 529.835 / 12.697 / 283.497ms |
| Parent peak RSS | 249,368,576 bytes，237.816MiB，Node resourceUsage实际进程峰值 |
| Decoder/probe child observed peak | 69,148,672 bytes，65.945MiB；Linux /proc VmHWM每25ms采样，是所观测峰值/真实峰值下界，不伪称精确child峰值；其他平台null |
| Algorithm accounted working buffers / scratch | 13,444,128 / 353,894,400 bytes（337.5MiB scratch）；buffer accounting非全进程RSS；仅96原帧，无全片约24GiB spool，close清理 |
| Models / qualification / matching / preview / export | detector modelRequests0；其他阶段NOT_EVALUATED；不声称编码主要耗时或整产品性能验收 |

### Verification and Decision

读并执行current `verification-before-completion`；fresh `npm run typecheck`、diagnostic单独strict tsc与esbuild、真实FFmpeg CLI均exit0。最终8 suites **189 tests PASS**：新discovery17、原census64、D2 review28、extractor17、comparator9、stationary envelope20、pixel6、activation28；完整命令/输出保留R及repo runtime日志，101.85秒。新tests覆盖全画布较小非角落多目标、确定性复算、原像素ROI、旧full census绑定、錯source/PTS/duration/hash/timeBase/tail、无authority、fake/closed evidence、pre/live cancellation、wall/scratch/frame/候选/component限额、stable background/blank/moving/blinking/cut、字幕/印字歧义。

保留开发失败日志：首轮test仅用了PATH名称导致realpath失败，改为原discoverBinary；随后错误import修正到ffmpeg owner。原像素对照最初扩到component外邻居，错误拒绝小目标；改为cell内部支持采样，保留此前3个行为失败，不降低0.8准入。这些修复均先于真实方法冻结或仅修test/metadata绑定，非holdout调参。diagnostic不在完整freshness与取消检查前写成功result。

额外真实CLI取消对照保存同级 `m1a-discovery-20261002-cancelled`：SIGTERM在运行中取消，962.172ms返回exit2，只有input/failure JSON，没有成功result或候选产物。未重试unknown外部请求；取消只停止本地只读解码。

stable snapshot见R/source-snapshot.json（各source/test/script与accepted refs完整SHA）。Implementation Risk Gate为 **KIMI_REVIEW_NOT_REQUIRED**：仅无authority候选与自有临时证据，无凭据/产品/durable-state写路径；共享census抽取的风险由64+28及依赖回归覆盖，没有具体重大后果且残留验证缺口的触发证据。Kimi只做原源码职责核查，invocation `d0032e89-e3d2-4ce3-b2fb-3faebd21b3e8`、seal `f374218aad13697e6a44c15d6402dfb6bfb6f3fe26fd17f0797c2e88411bbc34`、deep/max、真实上游身份与Read/receipt可核验；PARSED不是implementation acceptance。Parent拒绝其泛化到输出CONFIRMED集合的建议，本轮只产candidate。

### AOCI and Remaining Boundaries

初始Overview因另一任务更新正式索引返回overview_snapshot_changed，未补答或声称完整系统认知可靠，继续source-bound工作。用户本轮明确选择 **B：本轮只提交业务代码，共享索引交对方统一维护**；故不调用Maintain/Apply、不写或提交aoci.code.txt/.aoci/baseline.json。只读核对scope与Verify/Check/当前 `index agent guide`；结构valid但governance未aligned。需要对方维护本轮三个managed对象：`src/main/source-fact-census.ts`（stale），`src/main/source-fact-discovery-evidence.ts`与`src/main/shape-cover-stationary-discovery.ts`（missing/unbaselined）；docs、scripts、tests按现有observe scope，无索引扩scope。精确source SHA和语义交接见R/source-snapshot.json及本文ownership段。旧一次错误的root guide命令日志保留，最终使用当前CLI正确入口；不把命令运行等同治理通过。

无repository专用capture skill，本节承接稳定checkpoint与真实外部媒体证据，不更新外部memory。此次仅称CPU detector development已实现；mask完整性、固定动画、motion qualification、目标确认交互、独立真实holdout、低端CPU/Windows、视觉安全与production activation仍未完成。原product guards、fullcanvas研究合同、renderer/custody、manual/assisted、queue与历史解释均未改；待维护AOCI按用户指定交接，不宣称V1已完成。

## Real Contour Method Comparison and Source Inventory — 2026-10-01

按用户要求连续执行auto-contour计划，M1先以既有收据只读追踪；固定两型号已通过native conformance，但认证目录exact0，详见 [AI record](shape-matched-cover-m5d2a.md#fixed-model-catalog-followthrough--2026-10-01)。本节记录M1阻断时独立推进的M2真实development与M3材料准备，**REAL_AUTOMATIC_CHAIN_INCOMPLETE / PRODUCT_DISABLED**。证据根 `/home/reggie/.local/state/jianji-source-fact-qualification/auto-contour-catalog-followthrough-20261001`（F），不重做预选星形导出、不伪造truth或生产准入。

复用原用户233秒原片SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，使用原canonical D1/owned D2重新完整解码6990帧；census仍 `cc01bcbc9c4c700e4fef68ab8d6faf7e6e9a5052ff20ea1d9f4a0fdaf806029e`。作者侧development范围为原ordinals420–599（14–20秒）共180帧，逐帧RGBA/PTS/endPTS绑定成立。ROI615/0/100/90仅为明确标记UNQUALIFIED_ENGINEERING_DECLARATIONS的搜索范围，不是AI识别、mask或truth。运行前冻结真实源、方法源码SHA、参数/范围；后核对8项源码SHA无漂移，owned spool按原close清理。

| Method | Actual real development result | Qualification consequence |
| --- | --- | --- |
| per-frame exterior difference | 180/180 UNKNOWN / EXTERIOR_NOT_UNIFORM，mask0、envelope0 | 均匀背景支持包络不能处理本真实原片 |
| temporal stable exterior difference | 180/180 UNKNOWN / EXTERIOR_NOT_UNIFORM，mask0、envelope0 | 此TypeScript方法仍复用均匀边界提取，不是历史temporal算法 |
| 原 `shape-cover-mask-probe.py` temporal std/component方法 | 同范围180/180逐帧采样和core检查；3260像素、81×59候选，worst core差8.224 | CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW，未审核；OpenCV probe不提供canonical逐帧RGBA provenance |

前两方法实际CLI耗时182342.65ms，进程maxRSS284456KiB；比较metrics仍null、mask/motion truth NOT_EVALUATED、selectedMethod/qualifiedExtractor=null。第三方法单独提前冻结script SHA、参数和输入，没有改阈值或用候选作truth。Parent查看其六帧edge sheet，只能观察轮廓位置，不能证明180帧无漏边、独立motion或最终SAFE/NATURAL。没有将它导入human admission或真实选款链。以上都是开发比较，不是新的正式holdout或qualified extractor。

M3作者侧实际清点 `/home/reggie/电商/肥皂/素材`：26个MP4、18个不同文件SHA，保存每项源字节摘要/长度/FFprobe元数据。不同SHA不证明独立来源；六份候选的first/mid/tail联系图中存在相同人物、场景及复用片段，source independence/静态或固定动画类别均保持NOT_EVALUATED。抽样图只为作者清点，不冒充D1原ordinal或完整motion证明，没有凑成“3静态+3真实动画”。未登记新的正式holdout，独立pixel/motion truth未补齐。

用户随后要求查看最近session；本轮按只读、有界路径核查已存在真实材料/审核，而非要求普通用户描边。Named code_mapper核对近期相关sessions `01a0f75b-45bf-70e3-b5eb-d033fcda3c9b`、`01a0f6c9-6987-7de1-87c7-16a46bbdb0e9`、`01a0f7d1-3973-7d80-9de1-caebca9899f1`、`01a0f7d4-17e4-7da3-a479-5c9263b2b4fc` 及其材料路径，Parent再次读取并核对原JSON SHA/size与关键字段，保存F/recent-session-artifact-audit.json。原real-stationary的两段共180帧仍同源，reviewedSourceFrames=0、mask/motion/semantic review均NOT_EVALUATED；已找到的两个truth-freeze均为6帧CONTROLLED_CONSTRUCTION，不是真实留出。此次有界检索未找到满足M3的独立真实pixel/motion truth或固定动画审核收据，不据此声称全盘材料绝对不存在。

没有把历史mask、controlled动画或口述认可改名为独立真实truth。M4识别→共同候选筛选→看实际摆放图选款→冻结/真实输出→独立SAFE/NATURAL/播放以及M5正式blinded A/B/raw/mapped/joint/18类truth比较仍未执行。本地工程/资料准备不满足完整任务验收；当前停止原因是固定型号目录/image与正式owner缺口，加上没有合格真实extractor和独立truth，M6保持OUTSIDE_CURRENT_AUTHORIZATION。

### Delivery Verification

本轮没有修改executable source、配置、测试或模型连接，只更新本任务原spec/plan/records；实际执行已保存的M2开发入口，没有新增renderer、选款Agent或验收框架。fresh `npm run typecheck` exit0。三个最近suite首次29 PASS/1 timeout：qualification9和extraction17通过，diagnostic一项在30000ms技术门超时；原失败日志保留于F/related-tests.log。未改源码、测试或timeout后单次复跑diagnostic完整suite，4/4 PASS（48.48s），见F/diagnostic-recheck.log。该复跑不改变真实方法UNKNOWN、目录阻断或正式资格。代码快照按冻结SHA复核；文档引用和最终diff另外检查。

本次五份owned docs逐项核对AOCI scope为observe对象，无需改managed cognition或共享baseline。最终Verify/Check/Guide均exit0，governance_aligned=true、findings=[]、missing/stale/unbaselined/orphan=[]，Guide complete=true/next_action=none；初期四项foreign stale观察另保留，未以它阻断本任务observe维护，也未修改或提交其他任务索引。结果保存于F/final-verify.json、final-check.json、final-guide.json。86项文档引用及两库owned diffcheck通过；真实原片及8项开发源码SHA无漂移。父Agent Self-Review确认修改只收窄当前型号、澄清历史及记录实际开发/缺口；没有implementation扩权，未触发新增implementation adversarial review。工程mapper不是独立truth审核或正式actor。Repository没有专用session-capture skill，以上canonical records与私有原收据作为本轮capture；未写外部memory。

## Full Execution Continuation and Review Observation Seam — 2026-10-01

用户要求完整完成自动轮廓计划，并允许选择应用账号实际 image-enabled GPT；授权和实际路线诊断由 [AI record](shape-matched-cover-m5d2a.md#account-model-selection-and-native-projection-diagnosis--2026-10-01) 承接。本节仅记录 M4 所需无 authority 复核观察接缝，不声称真实自动链完成。Evidence owner 为私有 `auto-contour-full-20261001-51kctk6d`。

原 `shape-cover-admission.ts` 提供共享严格 `parseShapeCoverReviewObservation`：四项内容安全、自然度、原因及证据 IDs 保持原 schema；inspect/stop 沿原协议，裸 pass、缺 facet、bbox revise、extra authority 等拒绝。输出深冻结并固定 authority=none/eligible=false。原真实 admission 使用同一解析器后仍核验 SAFE/NATURAL、当前成对证据、coverage/source/output/sample bytes，私有 WeakMap handle issuer 未改变。诊断观察或 JSON 副本均不能恢复正式 handle，不引入第二 reviewer/renderer/queue。

新增 11 个观察及 authority 负例；初始不存在 parser 的可靠 RED 后 GREEN。Parent 首次 fresh typecheck exit0，原 candidates 105 与新观察 11 共116 PASS（141.20s），包含真实原队列/FFmpeg回归；这些是工程证据，没有实际模型复核或真实素材自然度验收。后续 working tree 出现与本任务无关的 development-lifecycle 修改后，交付前重新验证；最终结果随本节追加。AOCI 本轮 admission 官方完整批次1/1已应用，source SHA c976dc0e13c6ff437d18687c49a79b875fcd64f646596d014d96a0e26076e227，随后 Verify/Check/Guide exit0、Guide complete=true。共享索引保留，未 stage 其他任务内容；后续全库漂移须与本轮已维护对象分开报告。

本接缝未接 AI transport、源事实 issuer 或正式发布；M1真实路线、M2真实自动分割、M3独立真实truth、M4实际选款及样片、M5正式资格均继续缺对应证据。Native worker 仅实现接缝与测试，Parent 审查完整 diff 并运行验证，不把 worker verdict 或 tests PASS 当成 acceptance。计划禁止 Kimi 保持，M6仍 OUTSIDE_CURRENT_AUTHORIZATION/PRODUCT_DISABLED。

最终 continuation verification：在已观察到的 development-lifecycle 无关改动保留状态下，再次 `npm run typecheck` exit0；上述两个 suite **116/116 PASS**，139.70s，未再修改接缝源码。fresh AOCI Verify/Check exit0、missing/stale/unbaselined/orphan=[]，Guide 加 `--agent codex` 后 exit0、complete=true/next_action=none；第一次漏 agent 的 Guide 拒绝保留而非算作通过。共享 AOCI 后续索引由其他任务更新，仍未 stage 混合文件。Parent stable Risk Gate 为 KIMI_REVIEW_NOT_REQUIRED：接缝只产生严格 schema 的不可变观察，原 issuer、private handle、内容门和持久发布屏障均未扩权；authority/JSON replay 负例及原真实队列回归覆盖具体风险，未发现 critical consequence 或重大后果加未解决验证缺口的组合。真实成片及模型缺口保持单独阻断。

本接缝及当时三份task docs已提交 `8f8fdec`。随后Astra runtime no-tools调查中，配置修正真实移除协作工具，但exec/wait/request_user_input_async仍暴露，canonical native IMAGE_NATIVE_EXECUTION_INCOMPLETE；该路线当时新HTTP目录/图片、识别、选款、样片模型及formal请求均0。历史原因、exact receipts和配置诊断见 [AI record](shape-matched-cover-m5d2a.md#current-native-no-tools-blocker)。最新固定两型号的native已通过、目录exact0，以上方Fixed Model Catalog Followthrough为准；不将1076项router offline测试或116项本地工程回归当成完整M1–M5验收。

完整计划的剩余工作仍为：固定两型号实际image及正式执行路线、真正支持目标类别的自动mask方法、真实静态/固定动画各3个独立来源及各≥100明确原帧和独立提前冻结truth、实际识别/选材/成片SAFE与NATURAL/播放，以及正式blinded A/B/joint比较。M6在当前授权之外。Astra运行时准入阻断只保留历史；当前固定型号目录及M2/M3真实缺口见本record首节，**REAL_AUTOMATIC_CHAIN_INCOMPLETE / PRODUCT_DISABLED**；不把阶段代码提交称为完整任务完成。

## Automatic Contour Development Checkpoint — 2026-10-01

用户明确要求实现 [Automatic contour plan](shape-matched-cover-auto-contour-plan.md)。本次完成该计划允许在M1阻断时推进的M2本地工程与M3比较器；结论为 **AUTO_CONTOUR_DEVELOPMENT_ONLY / REAL_AUTOMATIC_CHAIN_INCOMPLETE / PRODUCT_DISABLED**。没有将计划全部标为完成，也没有重做既有预选星形180帧样例。

Evidence owner：`/home/reggie/.local/state/jianji-source-fact-qualification/auto-contour-implementation-20261001-m6o0x_tm`（R）。本轮模型/账号请求0，不读取或更新凭据、源知识、真人collector或产品准入。用户选择保留已有改动，并授权接续必要的provider及共享AOCI文件；实际没有修改provider，其字节与本轮初始副本相同。其他制作、上传、renderer、项目删除和未跟踪工作保留，不进入本任务commit。

### Implementation and Support Envelope

`source-mask-auto-extraction.ts` 从canonical owned D2读取每个原ordinal，核对source/census、ordinal、PTS/endPTS、RGBA字节数及SHA，并消费完整绑定的原AI declaration schema。声明明确标为UNQUALIFIED_ENGINEERING_DECLARATIONS，不是实际AI结果；调用者不能传mask。搜索ROI保持原1:1整数坐标，bbox不直接成为mask。源码生成最小半开bbox和LSB bitmap，原声明、逐帧候选、配置、输入及receipt摘要分别保留。漏首中末、错绑定、moving声明、身份或搜索原点变化、UNKNOWN、静态变化、源变化、取消和技术预算耗尽明确拒绝或INCOMPLETE；活跃原对象以WeakMap绑定，JSON不恢复ownership。完整候选复用原stationary-envelope owner，不复制并集算法或source admission。

方法只支持 `controlled-uniform-exterior-development/v1`：ROI边界必须精确同色，内部与边界不同的解码RGBA贡献全部计入，阈值0保留低对比细尖。非均匀边界、无法分离目标返回UNKNOWN。**这不是一般视频背景分割、遮挡/半透明边界或真实motion资格**；与背景同色的贡献无法由该方法识别，固定搜索原点也不能证明不移动。真实自动mask能力仍不足，不能把receipt CANDIDATE称为合格方法。

第二方法 `temporal-stable-exterior-difference/v1` 使用同一逐帧提取，至少3帧且轮廓/可见性完全稳定才保留候选；变化时全部置UNKNOWN。这是新的零变化开发对照，未复现或认证历史Python temporal算法，也不是对历史方法优劣的正式结论。尚未冻结唯一qualified extractor，没有新增分割依赖。

`source-mask-auto-qualification.ts` 在提取开始前冻结truth、criteria、方法配置及范围，独立truth只能进入比较器。私有时间顺序、owned evidence、exact source/census/config/frame binding均核查；结果绑定truth、freeze、candidate及criteria摘要。控制构造中的已知像素/有效帧/identity遗漏、moving误接纳和category错误为NOT_QUALIFIED；过度覆盖单独统计，不能签SAFE/NATURAL。未知像素truth或候选使像素指标null，未知motion保留INCOMPLETE；未经独立审核的REAL_MEDIA truth全部NOT_EVALUATED，不产生硬语义结论。两个作者字符串仅是开发包元数据，不能证明正式actor隔离或独立审阅资格。

`scripts/shape-cover-auto-contour-diagnostic.ts` 严格接收作者侧manifest，在新独占0700目录以0600/wx保存输入、原census、两方法预冻结truth、候选、比较、并集及最终报告。独立truth在两方法提取前冻结；无truth则比较未评估。硬比较失败后不生成envelope。无贴纸ID、预填mask、qualified/verdict、mock知识head、Provider callback或production handle接缝；不做选材、渲染替换层或发布，故它只是M2/M3开发工具，尚未实现M4真实链。失败保存INCOMPLETE，取消不签成功结果，owned临时spool由原evidence.close清理。

### Controlled Execution Evidence

实际执行本地CLI，使用提前编写的32×32/6fps、6帧lossless H264受控源，两个独立目标，共11个可见target/frame贡献、33个所需像素贡献。动画目标含低对比细尖、frame2闪烁缺席及最后frame5新增两个像素；静态目标在全部6帧可见。truth由构造recipe生成，不读取候选mask；这些开发材料已经暴露，不能进入never-exposed正式holdout，不满足真实来源数量要求。

| Development method | Candidate / comparison | Known omitted pixels / frames | Unknown candidate frames | Usable envelopes |
| --- | --- | --- | ---: | ---: |
| per-frame exterior difference | CANDIDATE / DEVELOPMENT_MATCH | 0 / 0 | 0 | 2 |
| temporal stable exterior difference | INCOMPLETE / INCOMPLETE | null / null | 6 | 0 |

逐帧动画并集7像素，静态并集1像素；保留所有原PTS/endPTS及RGBA SHA，不渲染真实替换成片。实际diagnostic wall7942.565ms，Node进程maxRSS107044KiB（进程峰值，非分离阶段内存）；modelRequests0、selectedMethod=null、qualifiedExtractor=null。全部AI识别、选款、独立样片、真实mask及真实固定动画为NOT_EVALUATED；formalQualification=INCOMPLETE。CLI首次从私有目录执行因外部zod依赖解析失败、尚未产生fixture；保留cli-0.log，给私有bundle使用现有仓库node_modules链接后独立执行成功，无新依赖安装，见cli-corrected-*及development-run/result.json。

### Verification and Ownership

已读取current `verification-before-completion`，最终源码摘要在final-source-snapshot.json，fresh `npm run typecheck` exit0；六个suite共**84 tests PASS**：新extractor17、comparator9、diagnostic4；原envelope20、pixel6、full-canvas review28。文件串行执行只为避免测试进程争资源，未更改产品并发；final-related-tests.log保留完整命令结果，90.80秒。新增extractor先因模块缺失可靠RED；本轮移动负例实际证明比较NOT_QUALIFIED后仍发两份envelope，修复脚本后进入最终完整GREEN，未放宽moving断言。独立CLI使用相同稳定源码，完成真实canonical FFmpeg解码而不是模拟像素输入；该证据不等于替换视频导出、商业模型或人工播放。

Native `code_mapper` `/root/visual_route_dependencies` 仅只读定位路线；`bounded_worker` `/root/contour_pixel_motion_comparator` 只写comparator及其test，Parent接收后独立检查完整实现、修正无用变量和诊断硬失败出口，运行上述fresh验证。两者均不是blind actor或正式reviewer；遵守本计划禁止Kimi。Parent在稳定验证后判断KIMI_REVIEW_NOT_REQUIRED：该变更没有生产消费者、持久源知识、credential或可发布authority路径，结果误差被固定非权威字段与原产品拒绝隔离，未出现重大后果加未解决工程验证缺口的组合。最终diff及commit scope仍由Parent负责，不以worker verdict作为验收。

AOCI逐项核对两个新managed模块，extraction当前基线已对齐；本轮官方机器批次仅comparator1项，完整Apply1/1、remaining0，source SHA `ea42ee47df856e1dbeb7844f8449c75fbbc8aa1adc5352dac884ca852697e19a`。源码、tests/helper、script和两份文档分别按managed/observe策略处理，不扩scope；随后Verify、Check均exit0、missing/stale/unbaselined=[]，Guide complete=true/next_action=none。已有混合dirty aoci.code.txt及baseline保留在working tree，不stage其他任务索引内容。本轮维护已完成，不把旧全库失败当当前blocker。AOCI上下文刷新完整交付193条/4块，严格Challenge10/10；治理结论仍以维护后的fresh JSON为准。没有repository专用session capture skill，本节承接稳定checkpoint，不写外部memory。

### Actual Blockers and Remaining Milestones

Parent核查现存canonical MiniMax probe receipt `response-optimization-20261001/unset-live-result.json`：probe `5dcf462d-7485-4911-b512-b865423fef2d`、invocation `44871911-cab4-4d5a-a349-2f732c81ad31`、MiniMax-M3、NOT_QUALIFIED / VISUAL_PROBE_MISMATCH，旧失败保持。当前GPT目录receipt `ea337c8c-084b-4c90-9cf0-cfed66948c09`仍精确gpt-6.1-sol匹配0，未发新catalog/probe请求，不能说永久无视觉。Parent结合router当前`require_live_admission`核对正式原片入口仍IMAGE_FORMAL_EXECUTION_UNAVAILABLE；随机probe不是原片执行owner。router由其repo合同独占且本计划不修改它，本轮没有证据足以归因MiniMax错误并授权一次有依据的修复probe，不盲重试或换模型。

因此M1未就绪；M2只有受控本地工程，没有合格真实分割方法；M3真实静态/固定动画各3个独立来源、各≥100明确原帧及独立审核truth缺失。M4实际识别→共同筛选→看摆放图选款→冻结→独立SAFE/NATURAL样片尚未执行，M5正式actor delivery/requests0，A/B/joint和真实层指标null/NOT_EVALUATED。不能用84个工程测试或一个受控源补齐AC-01–06。M6仍OUTSIDE_CURRENT_AUTHORIZATION；所有既有生产BLOCKED门、authority=none/eligible=false、PRODUCT_DISABLED、human及manual/assisted合同保持。

## Original User Source Diagnostic — 2026-10-01

用户继续要求“真实测试”，执行 [Spec extension](shape-matched-cover-stationary-spec.md#real-source-diagnostic-extension--2026-10-01) / [M4 plan](shape-matched-cover-stationary-plan.md#m4-original-user-source-diagnostic--2026-10-01)，结论为 **REAL_MEDIA_GEOMETRY_DIAGNOSTIC / AI_LIVE_ACCEPTANCE_INCOMPLETE / PRODUCT_DISABLED**。本节直接检查真实原片右上“国货之光”静态旧标；下方原controlled composite记录保留，真实固定动画尚未核实。

Evidence owner：`/home/reggie/.local/state/jianji-source-fact-qualification/real-stationary-20261001`（R），入口 `scripts/shape-cover-real-stationary-diagnostic.ts`。原片SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，54,577,917 bytes、720×1280/30fps、视频233秒；没有注入或移动旧目标。替换仍为现有有效上传星形 `uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e`，保留自带文字，摆放601/0、119×78。只导出两个3秒原时段节选，未导出或验收完整233秒覆盖片。

canonical D1完整解码原片**6990帧**，census `cc01bcbc9c4c700e4fef68ab8d6faf7e6e9a5052ff20ea1d9f4a0fdaf806029e`、clock0..3578880、timeBase1/15360；owned D2按原ordinal读取 [420,510)、[2700,2790)。新envelope保存全部180条原PTS/endPTS/RGBA SHA。Parent逐条与完整census核对来源/摘要一致，9个source/script/contract快照前后相同；约24GiB临时spool由原evidence.close清理，没有操作其他spool/collector。

**Semantic limitation:** 各片段复用历史 temporal raw候选mask，原状态仍CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW；provider明确为historical-temporal-candidate-unreviewed-not-ai。逐帧复用只证明完整消费和几何声明，不证明AI逐帧提取或合格静态/边缘审核。envelope authority=none、eligible=false、semantic/mask/motion review=NOT_EVALUATED；reviewedSourceFrames=0，6990帧census不等于6990帧语义审阅。

| Segment | Original ordinals | Raw / projected pixels | Actual output | Conditional gaps |
| --- | --- | --- | --- | ---: |
| 14–17秒 | 420–509 | 3259 / 3555 | 720×1280、30fps、90帧、3秒 | 0 |
| 90–93秒 | 2700–2789 | 3371 / 3672 | 同上 | 0 |

两段消费同一PNG、共同半径7输出像素，PNG往返RGBA一致，SHA `9cc30e49af02ed63f50b2d2497e769cc147415e3d65c855924776a4e2666664d`。全部输出PTS与原相对PTS一致；FFmpeg完整解码无错误；候选投影像素全部alpha255。覆盖版与同原时段、同编码对照版的解码PCM相同（AAC重新编码），未听音验收。coverage依赖未审核mask，不能证明mask外无漏目标。

成片SHA：14–17秒 `682d12709abc4c0c1888d520bdcae3477e966527ee3ede0bd163fd4369a2af83`；90–93秒 `17357784d84f24f7dbc45df7abc18b93fe698c358a31cd4b4d28c49efc6088da`。每段保存original.mp4、covered.mp4、comparison.mp4（左原片/右覆盖）、comparison.png、original/covered-all-frames.png、envelope.json、verification.json；root保存完整census、inputs、commands、源码快照及Parent完整性证据。

Parent实际查看两段原/成片全部90格边缘联系表及配对全画面：所查右上旧标未见外露，图层固定、无矩形白底；白边仍偏厚，顶部/右侧贴边。两幅全画面中主要操作区域及中央字幕仍可见。这是局部真实观察，不是独立自然度或内容安全资格，不涉及其他角落原图案。

Chrome MCP因共享profile占用拒绝启动，未停止其浏览器；改用独立临时headless Chrome。首次六片顺序播放记录5次正常结束（含两个covered.mp4），均90帧、playbackRate1、dropped/corrupted0；最后90–93秒comparison guard失败且未记录该次quality，保留playback.log/first-playback-observation.json，不算通过、不猜原因。仅对该对比片在独立单video页做一次定向诊断，实际3304.7ms播放至3秒结束、90帧、dropped/corrupted0，见comparison-playback.json/截图；不覆盖首次失败。全部播放muted、listeningReview=NOT_EVALUATED。

### Fresh Route Observation

只读named native code_mapper `/root/unmetered_route_mapping` 定位当前入口，非blind actor，遵守用户禁止Kimi。Parent复用external-subagent的sealed image contract、官方program SHA `3998a1676c9f8ff378e628713696cc80c49aba1115e94b28a86584de17342317`、Docker/native conformance、canonical receipt；没有修改router源码或安装。

初次prepare遗漏显式image sandbox配置，IMAGE_RUNTIME_CONFIG_REQUIRED、零provider requests；保留preflight/state，核对官方当前codex.json后更正配置。新owned probe `db114c11-d328-4d79-92dd-2aa6a1ec116d`、conformance `5d97b72b-a996-45b8-8b81-c1e79d6fb7e5` 为ENGINEERING_CONFORMANCE_COMPLETE、商业generation0。随后仅一次observe-image-subscription --verify-model：应用独立认证reference、固定catalog GET，不登录/refresh token/读global Codex auth/查quota。

真实canonical receipt `ea337c8c-084b-4c90-9cf0-cfed66948c09`：2026-09-30T23:11:56.365765Z，authenticated=true、catalog_model_count7、精确gpt-6.1-sol matched_model_count0、input_modalities=[]、image_input_supported=false、INCOMPLETE；account_queries1、provider_requests0、actual_cost_usd=null。仅说明当前账号/时间/目录条件，不宣称模型永久无视觉能力；未换别名或模型。MiniMax旧八图probe NOT_QUALIFIED（位置7/8错误）保留，未追加商业请求。

Parent按当前image_run.py::require_live_admission及CLI核对：unrestricted正式原片请求无admitted execution owner，IMAGE_FORMAL_EXECUTION_UNAVAILABLE；随机probe不能挪用发原片。实际AI识别、AI选款、独立样片复核请求均0，选款/自然度/安全NOT_EVALUATED。停止AI单元是当前GPT图像条件、MiniMax已证明probe错误和formal owner gate；不是额度、Key或用户未回复继续。

### Verification and Decision

执行current verification-before-completion：fresh typecheck exit0；envelope/pixel/full-canvas review共3 suites、54 tests PASS（230.57秒）；真实原片/PNG/时钟/音频/播放证据如上。新CLI由实际本地执行验证，未新增重复实现细节的单测；其他任务并行dirty变化保留。

Parent在stable candidate判断Risk Gate：没有当前用户要求Kimi review；独立diagnostic无production consumer、源知识写入或credential实现变更，失败后果为隔离诊断错误，不能造成重大authority/credential或不可恢复state损坏；完整来源/几何/真实渲染已验证，语义缺口固定NOT_EVALUATED且原生产门隔离。因此KIMI_REVIEW_NOT_REQUIRED，不新增重复reviewer。各新增/修改script/docs按当前AOCI observe范围核对，没有managed源码增量，不写/提交共享索引；最后fresh typecheck/diff及Verify/Check/Guide在Delivery Verification保存。

当前没有专用session capture skill，本节与原phase/plan保存checkpoint，不写外部memory。正式M5-D2A仍INCOMPLETE，formal requests0，A/B/joint null/NOT_EVALUATED；真实固定动画、合格mask/motion、双路线选款/复核及生产资格仍缺。PRODUCT_DISABLED；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance全部BLOCKED，authority=none/eligible=false。原人工认可效果与现行manual/assisted不变。

### Delivery Verification

恢复中断后先核对当前HEAD `50ed06b27c48adf30c0753e76ddd06539920cd1c`、现有dirty/owned paths、真实MP4摘要、6990帧census和已完成目录/播放收据，未重发已执行请求或导出。再次fresh typecheck exit0（resumed-typecheck-result.json），git diff --check通过，本轮5份文档的本地引用存在；脚本SHA `2f2ae33121cab370cf1a24b0aed3c19cafac4a1ad84715553eb36631348bc526` 与实际运行快照一致，原相关owner源码未变。

AOCI逐项核实本轮6个对象全部为observed_new，没有本轮未维护的managed对象，不扩大scope或改写共享索引。初始Guide complete=true；末检Verify/Check exit1、Guide complete=false，structure_valid=true但全库治理未对齐，5个foreign stale为src/main/batch-production-runtime.ts、src/main/douyin-upload-service.ts、src/renderer/BatchProductionDetails.tsx、src/renderer/DouyinUploadPanel.tsx、src/shared/batch-production.ts。本轮对象不在missing/stale/unbaselined中。保留所属任务的进行中改动，不调用或截断包含foreign对象的完整Maintain batch；这是全库治理的真实剩余工作，本checkpoint不宣称其完成。末检原JSON与实际命令状态保留在R，scope仅本slice的script/spec/plan/record/phase/总plan；其他dirty/staged/删除/未跟踪工作不stage/commit。

**Post-commit refresh:** 其他owner随后自行完成并提交 `f212a76`；本slice工程checkpoint `c1ee3ef7bb2cbfebaac998dbbc0e8c9465ae515e` 精确只含上述6个owned文件，没有共享索引或业务文件。Parent核对9个实际执行源码/合同摘要均未变、foreign文件字节无变化。再次Verify/Check/Guide全部exit0、governance_aligned=true、stale=[]、Guide complete=true/next_action=none，保留postcommit-*.json；此前5项漂移失败仍保留为历史，不继续当作当前blocker。剩余阻碍是上方真实AI/动画条件与正式资格，生产状态不因AOCI恢复而提升。

## Scope and Result

2026-10-01 用户要求执行“静态贴纸 + 不移动的动画贴纸”，moving 暂不支持。依据 [Spec](shape-matched-cover-stationary-spec.md) 和 [Plan](shape-matched-cover-stationary-plan.md)，实现完整帧绑定的 `stationary-union/v1` geometry candidate 与真实本地 FFmpeg 验证。结果无 source/semantic/production authority；未接产品入口、未安装启用新功能，既有 manual/assisted 与已认可效果不变。

## Implementation

`shape-cover-stationary-envelope.ts` 只消费原 owned D2 evidence，读取请求连续范围的每个 D1 ordinal，核对 target/PTS/endPTS/RGBA SHA/固定 anchor 与 mask 字节。静态声明的可见 mask 变化、moving/unresolved、UNKNOWN、漏项、错帧、越界、取消或伪造 evidence 均 UNSAFE。动画轮廓逐帧 OR，原候选、来源、source/census 和完整 digest 保留；NOT_VISIBLE 仅是该目标声明，不是全画布 EMPTY。静态格式及知识审核 owner 不变，没有 human session 操作或虚构 review 字段。private raster 只返回副本，克隆 receipt 不恢复 ownership；64MiB receipt、D1 wall 和512×512 bitmap技术边界不限制账号费用或 token。

## Render Evidence

最终渲染证据目录：`/home/reggie/.local/state/jianji-source-fact-qualification/stationary-cover-20261001-v4`；verification、red/green和AOCI日志保留在 `stationary-cover-20261001-v3` 及同一state树的stationary-final-tests-20261001.log。CLI为 `scripts/shape-cover-stationary-diagnostic.ts`，esbuild bundle保存于同一私有state树；参数为真实背景源、现有上传目录/候选ID、新独占输出目录和应用 FFmpeg/FFprobe。v4另外保存原owner完整census.json，包含引擎指纹、解码解释和完整帧绑定，不另签census。

背景为既有真实720×1280视频的[14,17)秒，原SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`。仅为 controlled composite 构造360×640/12fps fixture，不把该降采样称为对原视频全时域识别。替换贴纸来自原 `UploadedStickers.load` 有效目录，`uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e`，自带“惊爆价”内容原样使用；摆放x282/y12/w75/h54，不生成或改写文字。

| Controlled case | Frames | Union pixels | Uncovered pixels | Target-free reference diff | Audio |
| --- | ---: | ---: | ---: | ---: | --- |
| static | 36 | 922 | 0 | 0 | PCM identical |
| stationary-animation | 36 | 1162 | 0 | 0 | PCM identical |

动画三个已知轮廓为513/922/1162像素，frame5/17/29闪烁不出现，最大轮廓仅在frame35出现；相对首相位新增649像素。所有原始帧通过 canonical D1、owned evidence；两例共72帧，输出帧数与全部PTS相等，PNG往返RGBA完全一致，所需投影像素全部opaque。参考片使用相同颜色转换和overlay链，仅明确移除受控旧目标；两个成片的全部解码RGBA逐帧与参考一致。冻结PNG SHA `15d9a69c015c691dac14b7b5148634456004118a0894e4c1692453febf4e16c9`，两个covered.mp4 SHA均 `f148bd4a1f5563078e5f18d57c6c2a8848ce064dcb2f8bcdfd80c4800d4480ad`。覆盖层始终固定，不生成白底矩形。

static source SHA `0d4cfb26df5f513892c03541af03488546dbd316b9230b5d6e2cb554ee903760`，census `7dce8e305396deb6038bbbc0727bd142d314d18c9bb022e36c869584b232902c`，receipt `03ff59daa2409da3c405d6df607b13bd459e6d93923e0162112345d7a34abe27`。animation source SHA `119f0e84dd9ec29135e5ea02254ccbde5c9cb50e9a70420863bf27f328b24802`，census `10dd9bbc4a14c4df8ef4d1f086f4a3104dfe9d021a1178449efde7521b655084`，receipt `b5666e51adaeac6bbff0d046ce44efa1c4b2a6fc35e6bd4edb457b7f6e2f78f3`。完整原候选/时钟/掩码/配对图/PCM摘要见各case的envelope.json和pixel-check.json。

首轮目录 `stationary-cover-20261001` 保留：phase1/2实际轮廓相同，且参考链少一次颜色转换，出现263个不同像素，不能作为完整验收。纠正fixture与参考后v2通过；final code增加静态变化拒绝与receipt资源边界后再次真实执行v3，加入完整census留存后v4再次执行，上述摘要与结果均复现。旧结果未重写。Parent实际查看frame35原图/成片配对：受控cyan目标消失，上传星形无白矩形且人物仍可见；这是局部spot-check，**不是完整人工观看、独立自然度或原背景全部贴纸都已覆盖**。背景原有图案仍作为背景保留，fixture仅验证注入目标。

## Verification and Governance

新增测试先因缺模块失败；另静态变化负例在修复前实际resolve导致失败，修复后纳入全回归。初轮6 suite有204PASS/1既有FFmpeg时序测试5秒timeout，保留失败。串行文件/30秒技术wall重跑后时序用例通过，6 suites/207 tests中206PASS，另1个丢失发布返回用例失败；新增20项及其余5 suites全部通过。该用例错误把production首调用对应queue首调用，在双素材并发下可能选到成功素材。用可控Promise强制两阶段顺序相反，原断言仍实际失败（publication-order-red.log），随后只改测试关联为实际丢失返回的queue mediaId，重跑该用例及5个邻近production回归，6PASS/99因name filter未运行（publication-order-green.log）；99项不被本次过滤调用重新计PASS。实际错误素材仍无receipt、reentry拒绝、无新输出/queue调用，其他已成功素材仍保留幂等完成。没有修改production owner或放宽断言。最后fresh typecheck exit0，日志分别保存于私有证据树。

AOCI官方完整批次仅新增本模块：source SHA `90eb6df69f20304299fec38c4f601a93b4dde995f0a1993669ce5a1603acd2c6`；Apply1/1、remaining0，Verify/Check结构及治理aligned，Guide complete=true/next_action=none。此前191条索引内容和全部已有business source baseline条目逐项保持；机器仅新增本模块、更新aoci.code.txt自身绑定和updated_at。共享索引增量写入经用户本次明确授权，**不提交**这两个混合dirty文件。其余本轮docs/tests/script按observe范围核对，不扩大索引scope。AOCI Overview交付确认成功；Challenge字段schema未成功提交，严格完整认知未成立，仅依源码绑定执行，不宣称完整系统认知可靠。

交付末检期间另一个任务新增batch实现改动：Verify/Check exit1，Guide complete=false，四个stale对象为 `src/main/batch-production-controller.ts`、`src/main/batch-production-runtime.ts`、`src/renderer/BatchProductionPanel.tsx`、`src/shared/batch-production.ts`。本轮新模块不在missing/stale/unbaselined中，源码与已Apply基线仍一致，逐项维护已完成；全库治理此刻未对齐。保留其active工作，不领取并截断包含foreign对象的新机器批次、不越权维护它们。本轮稳定checkpoint不是全库治理完成，末检原JSON保存为delivery-verify/check/guide.json；待所属owner稳定并完成维护后才可声明全库aligned。

## Risk Gate and Ownership

Parent在上述project-native verification结束后对stable candidate判断一次：`KIMI_REVIEW_NOT_REQUIRED`。没有用户要求本snapshot的Kimi review（当前明确禁止）；新增实现没有production consumer或持久state写入路径、private诊断拒绝覆盖旧输出，故不具备重大凭据/authority/不可恢复state损坏后果。mask/motion语义未验证由固定NOT_EVALUATED和原production拒绝隔离；回归发现的测试竞态已用强制倒序red/green及相邻路径证据裁决，无重大后果加剩余工程验证缺口的组合，不再叠加native reviewer。Parent检查最终diff、来源/schema/兼容边界及实际导出证据。只读mapper为 `/root/stationary_animation_mapping`、named `code_mapper`（工程用途，非blind actor），遵守当前禁止Kimi及禁止嵌套/写入边界；actual provider/model execution identity不推断。无新provider请求，费用/token0。

稳定source SHA `90eb6df6…cd2c6`；新test `4ee0d33b…b4d6a`；既有publication-test修正 `6cc26704…be3f`；diagnostic `153e6485…fad5`；Spec `d23bbe44…6acb`；Plan `ca058057…f01a`。完整SHA、当前Git HEAD/changed paths、命令与final diff绑定在私有snapshot-manifest.json；record自身不递归声明自己的hash。只读进程核对当前human collector数量0，未启动、重启或自动填写任何human语义。

Current tree 开始于ec20c30；另一任务期间提交了Qianchuan/capacity工作，未合并或改写其历史。所有既有dirty业务路径、项目删除和未跟踪脚本均保留。只提交本slice代码/test/script/spec/plan/record及原phase/总plan的pointer；不stage共享索引或其他工作。无 dedicated worktree、reset/stash/覆盖源文件。

## Remaining Boundary

该candidate已能在**完整且正确的逐帧输入mask条件下**生成静态遮盖；没有实现合格模型从真实用户动画素材提取这些mask，也没有证明actor能判断固定位置。受控目标的mask来自已知fixture recipe，不是AI输出或新的独立holdout，不外推真实动画媒体。现有MiniMax-M3实际视觉probe NOT_QUALIFIED（位置7/8错误），GPT精确gpt-6.1-sol应用账号image条件仍缺；本轮不盲目重试、不改标准/模型、不要求OpenAI Key或额外预算材料。

M5-D2A仍INCOMPLETE，formal requests0，A/B/joint指标null/NOT_EVALUATED，authority=none/eligible=false。PRODUCT_DISABLED；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance BLOCKED。下一实际工作是有依据地修复视觉输入/能力并通过原资格门，随后合格mask/motion语义来源及另行授权的生产阶段；当前本地工程结果不授权这些阶段。
