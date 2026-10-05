# Hybrid H2C Corner Development Record

## Scope and Verdict

2026-10-05，基于 `c52ba8ea7f3b4eea05528180c62bbc70588885c5`，用户正式收缩默认产品目标为四角静态后期贴纸。本轮实现 H2C，止于新鲜、绑定完整的 H3 semantic projection；没有实现 H3 或激活产品。

**Development verdict: BLOCKED。** real233s 右上及 clear overlay positive 成立；product-print / subtitle controlled negative 的实际请求失败，没有视觉决定；controlled multi-component 被 Luna 分为两个独立组，未达到同贴纸分组验收。工程测试通过不替代这些 development acceptance 条件。没有重复请求到正确、修改参数或本地 repair。

## Product Default and Preserved Capabilities

默认设计路线：全图 M1 → Corner Scope Filter → 每角 Luna / 有条件 Sol → H3 Corner Motion + Conservative Mask + Shape Matching + 100% Coverage → H4 Rendered Preview QA（MiniMax → Sol，独立 session）→ export。H3/H4/export 均未进入本轮。

M1 stationary / multi-component discovery、source identity、exact reader、conservative mask、geometry v1/v2、confirmed-target proof v1/v2、HC2/HC3 research、H1 packet/router/schema/provider、旧 full-frame H2 owner/tests/records 全部保留。full-frame H2、strict geometry/proof、HC research 移为 GENERALIZED / HIGH-ASSURANCE / DIAGNOSTIC，不再是 Corner V1 的 prerequisite。旧 receipt 和旧 global `undetectedOverlaySuspected` 保持原义。

旧 random-changing-background + fixed screen-space rectangle fixture 另分类为 `AMBIGUOUS_SCREEN_SPACE_GRAPHIC` diagnostic；没有修改历史 fixture、record 或历史 BLOCKED 解释。

## Frozen Policy and Runtime Contract

`CornerScopePolicy/v1`：outer width fraction = 0.30，outer height fraction = 0.30，minimumAreaInside = 0.60。bbox center 严格属于唯一 corner，且 intersection/bbox area ≥ 0.60；不以碰到 corner 收入。候选不会重复分配；未来歧义为 `CORNER_SCOPE_AMBIGUOUS`。

非角候选为 `OUT_OF_CORNER_SCOPE`，不是视觉 reject / absence。M1 UNKNOWN 为 `UNKNOWN_NOT_PROPOSED`，不送模型、不升级成 target；absence 不证明无 overlay。每角最多 3 candidates、1 logical target；超限仅该角 `CORNER_COMPLEX_UNRESOLVED`，多个独立组仅该角 `CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED`。

新 `HybridCornerSemanticSet/v1` 独占角落状态与 partial aggregation；新 prompt `hybrid-corner-overlay-semantic/v1` 和 schema 使用 `undetectedCornerOverlaySuspected`。每个 CONFIRM 必须恰好一次分组；REJECT / UNKNOWN 不入组；singleton 必须返回 group；不 repair 非法 JSON。VLM 不产生 mask / polygon / 坐标 / coverage / renderer 指令。

每非空可处理角 Luna 一次，只有 UNKNOWN、风险、temporal uncertainty 或 uncertain grouping 升 Sol 一次；明确 motion 不被 Sol 抹掉，明确多个独立 overlay 不自动选一个。源级 stale / infrastructure / binding 错误清空全部 target；局部 semantic / invalid syntax 跳过该角。`getConfirmedCornerTargets()` 只接受本运行 owned result，核对 source/packet freshness，不接受 JSON clone 的 authority。

每 source Luna ≤4、Sol ≤4、MiniMax=0；每角 Luna1/Sol1。旧 GLOBAL session 的 4/2/1 预算与语义保持，CORNER 不能调用 preview。VLM STABLE 只是观察，不替代未来 sampled motion algorithm。

## Real233s Assignment and Results

重新运行 canonical M1 得到 8 CANDIDATE、36 UNKNOWN；source box 单位为像素，candidate ID 以下使用唯一前缀。源为 720×1280，corner 内边界 x=216/504，y=384/896。

| Candidate prefix | Bbox x,y,w,h | Assignment | Area inside ratio |
|---|---|---|---:|
| 7fce5152cca5 | 627,0,83,68 | TOP_RIGHT | 1.000000 |
| d4d73eaae74a | 135,1248,65,25 | BOTTOM_LEFT | 1.000000 |
| 351316994cd0 | 256,1248,55,32 | OUT_OF_CORNER_SCOPE | 0 |
| b21318f01ac5 | 281,1248,51,32 | OUT_OF_CORNER_SCOPE | 0 |
| b2242de0f574 | 320,1248,55,32 | OUT_OF_CORNER_SCOPE | 0 |
| 452c1c218676 | 363,1248,62,32 | OUT_OF_CORNER_SCOPE | 0 |
| 302db7e24ca7 | 417,1248,75,32 | OUT_OF_CORNER_SCOPE | 0 |
| 277754a760de | 481,1248,79,25 | BOTTOM_RIGHT | 0.708861 |

TOP_LEFT = NO_CANDIDATE。TOP_RIGHT = CONFIRMED / OVERLAY_LOGO / STABLE，右上“国货之光”保留一个 H3 projection。BOTTOM_LEFT / BOTTOM_RIGHT 的模型决定均为 REJECT SUBTITLE，同时 `undetectedCornerOverlaySuspected=true`，最终均 UNRESOLVED；此时拒绝决定保存在原始 semantic receipt，不把 unresolved 描述成 NO_OVERLAY。源 aggregate 为 CORNER_SEMANTIC_PARTIAL，无 sourceErrors，其他角 skip 不清除右上 target。

## Frozen Controlled Provider Run

模型调用前冻结六个简单 case、policy、prompt、schema、代码和输入身份。preflight 将尚未调用模型的噪声负例改为有透视、物理上下文的 scene，preflight 字节私下保留；没有按模型结果改 fixture。

| Case | Actual result | Requests Luna/Sol/MiniMax |
|---|---|---|
| overlay | TOP_RIGHT CONFIRMED / OVERLAY_STICKER / STABLE | 1/0/0 |
| product-print | VISION_PROVIDER_ERROR；无模型文本/语义结果，NOT_EVALUATED | 1/0/0 |
| subtitle | VISION_PROVIDER_ERROR；无模型文本/语义结果，NOT_EVALUATED | 1/0/0 |
| physical-background | BOTTOM_RIGHT NO_OVERLAY / REJECT BACKGROUND_GRAPHIC | 1/0/0 |
| multi-component | 两个 singleton groups；UNRESOLVED / CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED | 1/0/0 |
| two-overlays | 两个独立 groups；UNRESOLVED / CORNER_MULTIPLE_OVERLAYS_UNSUPPORTED | 1/0/0 |
| real233s | TOP_RIGHT confirmed、下角 unresolved；PARTIAL | 3/0/0 |

总计 Luna=9、Sol=0、MiniMax=0。实际目录没有 requested GPT-6 Luna / GPT-6.1 Sol，沿用用户本轮授权的 gpt-5.6-luna / gpt-5.6-sol，Sol 本次无 dispatch。

首次 batch 在 product-print source provider error 后停止，保留 run-once seal 和 terminal evidence。调查原 transport 后不能追溯具体 RPC failure；不推断错误是 JSON 或模型误判。仅新增 explicit `--continue-unrequested`：冻结前轮结果及 consumed cases，不重发 overlay/product-print；独占 source reservation，crash/unknown reservation 不自动恢复，按原冻结 semantic inputs 完成尚未请求的独立 cases。continuation runner 自身变更单独封存。provider failure 不具有原始响应，不能伪造 raw hash 或 parse category。

## Observability and Evidence

返回模型文本后，receipt 记录 `rawResponseSha256`、UTF-8 `rawResponseByteLength`；解析失败记录 `parseFailureCategory`（JSON_PARSE / SCHEMA_VALIDATION / PACKET_MISMATCH / GROUP_MISMATCH / MISSING_REQUIRED_FIELD / OTHER）与安全 error code。普通日志不含 raw response；开发 runner 只在私有 evidence root 保存 bounded sanitized text。transport 没返回文本时这些 raw/parse 属性不可获得。

私有 evidence root：`/home/reggie/.local/state/jianji-source-fact-qualification/hybrid-h2c-20261005/`。`frozen-corner-eval/corner-count-audit.json`、`semantic-evaluation.json`、`semantic-run-once.json`、`continuation-evaluation.json`、`continue-unrequested-once.json`、`source-reservations/` 保留冻结身份、全部候选、实际请求和结果；这些私有运行资产不提交。

## Verification and Completion Boundary

新 corner unit 51 tests、新 canonical FFmpeg M1 / H1 packet integration 1 test；focused final 8 files / 140 tests，实际结果以 final log / Harness receipt 为准。覆盖四角、center/area边界、UNKNOWN、0~4 candidates、grouping、Luna→Sol、motion、disagreement、partial、预算及 stale/invalid bindings，旧 H1/H2 回归保持。unit fake-provider grouping 成立不代表 controlled real-model grouping 已通过。

最终 parent diff review 补齐 groups 中编造 candidate ID 的 source-level binding failure，red test 真实失败后修复，并验证已确认的其他角被清空。仅在 parser 添加这一条 ID guard；prompt / provider output schema / policy / runtime routing 不变。final-schema-replay 对全部已保存 PARSED receipt 的严格重解析保持决定不变，零新增 provider requests；没有将历史 live receipt 改绑新代码，也不由离线重解析恢复 packet freshness。首次 Harness 为此主动取消并保留 NOT_EVALUATED；最终 stable snapshot 单独运行 Harness。

最终 owned Harness scope / receipt 与 completion verification 保存在上述私有 evidence root；交付以实际 terminal receipt 为准，不从本记录或声明 scope 推断 PASS。AOCI indexed 五对象（policy、router、corner policy/schema/semantic）已用完整官方批次维护；docs/tests/scripts 按 observe，不扩大索引。最终 Verify / Check / Guide 证明本轮维护，shared index/baseline 只提交 owned 对象。上下文恢复时 Overview 传输发生 host 截断，停止该链，不能声称完整认知校验通过；需要更小的合法 `overview_delivery.chunk_tokens` 才能重新完整交付，与官方治理维护分开解释。

完成稳定 implementation 后评估 Review Risk Gate；受管 Kimi 只读 reuse mapping 的 receipt 不替代 implementation review，也不授产品 acceptance。仓库未提供本 concern 专用 session-capture skill，本记录作为有 durable value 的本轮 evidence owner，不写 global memory。

## Next Slice and Hard Boundaries

路线仍固定 H2C → H3 Corner Motion + Mask + Shape + Coverage → H4 Preview QA → Activation；当前 H2C development acceptance gaps 未关闭，不进入 H3。无需 HC6/HC7 或 proof v3。

old H2 global path preserved；old strict proof preserved；no mask acceptance yet；no proof v3；PRODUCT_DISABLED；guard unchanged。未来覆盖标准仍是 oldMask ⊆ fully opaque newStickerAlpha 和 100% coverage，corner scope 不降低像素门。
