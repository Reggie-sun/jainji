# Automatic Contour Shape Cover Specification

## Goal and Authorization

2026-10-01，用户要求将当前五个环节写成 spec 和 plan。本次交付为 **DOCUMENTATION_ONLY**，定义从已有轮廓渲染工程到完整自动流程的剩余合同；不代表新实现、模型能力、正式资格或生产启用已经完成。既有工程执行授权保留，生产阶段仍不在当前授权内。

目标：用户提供原视频与有效本地贴纸后，软件自动找出静态旧贴纸及位置固定的动画旧贴纸，自动生成保守像素轮廓、选择适配款式并核查真实成片。**普通用户无需描边、逐帧勾轮廓、填写 mask 或准备轮廓文件。**

本合同补充 [V1 Spec](shape-matched-cover-spec.md) 和 [Stationary contract](shape-matched-cover-stationary-spec.md)。[M5-D2A Spec](shape-matched-cover-m5d2a-spec.md) 独占逐帧语义资格标准；其当前 provider / spending 修订由 [AI plan](shape-matched-cover-m5d2a-plan.md#current-priority-and-provider-selection) 承接。本文件不建立第二套资格标准、源知识或生产准入 owner。

## Current Baseline

下表为本次规划起点，运行证据仍由 [Stationary record](shape-matched-cover-stationary-record.md#original-user-source-diagnostic--2026-10-01) 和 [M5-D2A record](shape-matched-cover-m5d2a.md) 独占；后续执行在那里记录真实变化，不以修改本表代替验收。

| 环节 | 当前进度 |
| --- | --- |
| 根据轮廓计算遮盖、生成图层、导出 | 已实现，做过真实片段验证 |
| 自动从真实视频得到可靠轮廓 | 尚未验收 |
| AI 自动识别 → 选款 → 成片复核 | 尚未完整跑通，本轮模型调用为 0 |
| 固定位置的动画贴纸 | 做过受控测试，真实动画未验收 |
| 新路线生产启用 | 尚未进入 |

“本轮”指上述原片诊断：两段共180帧，轮廓来自历史未审核算法候选，替换星形预先指定；没有 AI 识别、选款或复核调用。固定动画的已有证据来自受控合成。不能把6990帧完整解码、条件 coverage 或用户认可样例解释为全片语义审阅、自动选款或真实动画验收。

源码事实：`AIDeclarationSchema` 返回目标、类别与 bbox，不含像素 mask；`buildStationaryShapeEnvelope` 消费 caller 的逐帧 mask 并求并集，不提取轮廓、不证明目标不移动。`ShapeCoverProduction.selectionPreviews` 和自然度复核已有工程实现，后续应复用并联调。现有 `ShapeCoverRequestAssembler.assemble` 和产品 activation 仍拒绝签发成功请求。

## Scope and User Flow

纳入静态旧贴纸、锚点固定但轮廓/透明度/可见性变化的动画旧贴纸，替换素材为已校验的本地静态贴纸。移动、锚点无法确定、无法保守分离的边缘及输入包络外素材明确拒绝；不通过固定大框掩盖不支持的目标。

预期自动流程：`原视频 → 全画布目标识别 → 自动逐帧轮廓候选 → 时域与轮廓核查 → 全轮共同安全候选 → Agent 看真实摆放图选款 → 冻结图层 → 独立成片复核`。只有后续生产合同成立，才能从这条链进入正式队列发布。

用户确认的是实际画面效果。其认可不能替代自动轮廓来源或 qualification。可选粗框属于 [Manual region candidate](shape-matched-cover-manual-region-candidate.md) 的独立候选，不是本自动路径必需输入，本次不改 manual / assisted 的交互或渲染。

## Canonical Ownership

| Responsibility | Existing owner / extension seam |
| --- | --- |
| 源身份、完整原帧与原时钟 | [census](../src/main/source-fact-census.ts)、[clock](../src/main/source-fact-census-clock.ts)、[owned evidence](../src/main/source-fact-review-evidence.ts)；禁止另签 census。 |
| AI 逐帧语义声明与 truth 比较 | [AI contract](../src/main/source-fact-ai-contract.ts)、[AI compare](../src/main/source-fact-ai-compare.ts)、[AI input](../src/main/source-fact-ai-input.ts)、[AI engineering run](../src/main/source-fact-ai-run.ts)；正式执行/issuer 缺口沿原 AI plan 补齐。 |
| 自动像素轮廓候选 | 新增聚焦 extractor 与非权威 machine contract；只生成候选和 provenance，不拥有知识、source admission 或产品生命周期。 |
| 固定动画轮廓并集 | [stationary envelope](../src/main/shape-cover-stationary-envelope.ts)；原 private ownership、逐帧绑定与拒绝行为保留。 |
| 本地几何、整轮筛选、冻结 | [pixel gate](../src/main/shape-cover-pixel-gate.ts)、[candidates](../src/main/shape-cover-candidates.ts)、[alpha](../src/main/shape-cover-alpha.ts)、[freeze](../src/main/shape-cover-freeze.ts)。 |
| 选款、真实摆放图与独立样片核查 | 原 `shortlist(..., "cover")`、[selection](../src/main/shape-cover-selection.ts)、[production orchestration](../src/main/shape-cover-production.ts)、[admission](../src/main/shape-cover-admission.ts)。 |
| 源知识、准入和持久格式 | [knowledge schema](../src/shared/source-sticker-knowledge.ts)、[store](../src/main/source-sticker-knowledge-store.ts)、[human static admission](../src/main/source-mask-admission.ts)；不伪造真人 PASS，不把 animation 填入静态证明。 |
| 生产准备、启用和导出生命周期 | [assembler](../src/main/shape-cover-request-assembler.ts)、[activation](../src/main/shape-cover-activation.ts)、[compiler](../src/main/compiler.ts)、[queue](../src/main/queue.ts)、[artifacts](../src/main/shape-cover-artifacts.ts)；本阶段保持关闭。 |

CodeGraph 只辅助定位。通用 `.get` / `.set` 的误连不能用作源码调用依据；候选生成、知识准入和生产启用必须保持不同 authority。

## Route and Execution Contract

**REQ-01 — Actual visual routes.** 当前组合为 MiniMax-M3 与 Codex 订阅 `gpt-6.1-sol`；`gpt-6-luna` 仅作用户可独立选择的配置，无自动 fallback。禁止 Kimi。复用应用已保存连接和应用独立 ChatGPT 登录，不要求 OpenAI Key、不读取全局 Codex auth。两条路线的真实视觉输入、实际身份、隔离与 receipt 必须分别验证；原生工程 subagent 和本聊天不能充当正式 blinded actor。

最近收据中的 GPT 精确模型未匹配、MiniMax 八图位置7/8错误及 `IMAGE_FORMAL_EXECUTION_UNAVAILABLE` 是分别需要解决的依赖，不能由文本连接正常或 HTTP200抵消。不宣称模型永久不可用；未来执行先核对最新真实证据，有具体修复理由才创建新版本 probe。旧失败不可重写，不重复同一 probe 到通过。

**REQ-02 — Managed execution.** 受管视觉路线继续使用 sealed contract、qualified route、Docker containment 和 canonical receipt。必须区分 capability probe、原片开发诊断、正式 blinded qualification 三种输入用途；不得把随机 probe 入口挪用为原片通道。正式执行 owner 按原 AI spec 收集完整 raw/input/A/B/mapping/joint/correspondence 证据，不以 injectable engineering transport 伪装真实路线。

沿 [unrestricted spending amendment](../../agent-subagent-router/docs/superpowers/specs/2026-09-30-image-unrestricted-spending.md)：不新增余额、费用证明、OpenAI Key、金额/token/任务累计调用上限或 budget receipt 前置门。保留单次 wall/idle、bytes/内存、取消、no-replay、凭据保护与未知结果隔离；无上限不授权盲目重试、换模型或无限追加讨论。

## Automatic Contour Contract

**REQ-03 — Machine input and provenance.** extractor 消费活跃 owned D2 原帧及原 AI target 声明；每项绑定现有 source identity、censusDigest、target identity、ordinal、PTS/endPTS、RGBA SHA、算法/参数/模型版本和输入摘要。bbox 只约束搜索区域，不能直接作为旧贴纸 mask；ROI 裁切如用于本地算法，必须保留到原画布的可逆坐标映射。

新增候选格式为 `auto-source-contour-candidate/v1`，逐帧含 `targetId`、原 frame binding、`extractorVersion` / configDigest、输入声明摘要和状态。`VISIBLE` 必须有源空间整数半开 bbox、原1:1网格的 `bitpack-lsb-row-major-v1` bitmap、像素数量及SHA；`NOT_VISIBLE` 必须显式且mask=null，仅表达该目标本帧未出现；`UNKNOWN` 必须有原因且不可进入可用并集。状态不能由空数组、缺项或失败推导，target级NOT_VISIBLE不等于全画布EMPTY。原始候选和并集receipt分别保存，任何编码转换必须可验证且不改变原帧身份。

**REQ-04 — Automatic conservative boundary.** 每帧输出源空间保守二值轮廓及明确状态，包含细尖、描边、半透明和抗锯齿可见贡献。无法可靠分离背景、被遮挡贡献或不确定边界时返回 UNKNOWN 并停止可用结果；不能通过裁掉边缘、填满矩形或让用户补描边取得 PASS。历史 temporal mask 只作开发基线。

算法选择是可执行的开发收敛任务：在独立于正式 holdout 的 development 集上比较现有时域候选与逐帧分割候选，优先选择依赖更少、来源可审计且满足保守边缘条件的一种方法。正式评估前冻结唯一 extractor、参数、支持包络和错误规则。若没有方法满足条件，记录提取能力不足，不交付假自动路径；需要新模型/依赖的方案须先记录实际兼容性与安装合同，不能假称已有。

**REQ-05 — Temporal coverage and motion.** 对待支持的完整原帧范围逐 ordinal 提取和核查，保留出现、消失、闪烁、单帧扩大、切镜与多个并发目标；不以首中末采样或同像素去重证明穷尽性。局部片段只支持局部诊断，整片主张必须覆盖整片。目标定位/身份不确定仍 UNKNOWN，不从缺返回推导 EMPTY。

固定动画逐帧候选通过原 `stationary-union/v1` 合并。相同 anchor 的 caller 声明及 bbox 中心稳定不能证明不移动；需独立原帧 motion 核查。静态候选按原一致性条件读取；不能丢弃变化帧或把动画改名 static 来适配旧 schema。保持原512×512栅格、64MiB receipt及 D1 wall 技术门，超限拒绝、不截断。

**REQ-06 — Separate contour qualification.** M5-D2A 验证的是目标枚举，不证明像素轮廓正确。本增量需要独立的 mask/motion truth 对照，分别报告可见贡献遗漏、时段遗漏、identity 错误、moving 误接纳及过度遮挡。对明确 truth，任何应纳入的可见像素漏失、有效 ordinal 漏失或移动目标误放行均失败；不确定 truth 单列，不能计为零错误。

mask/motion 方法评估结果必须标明自己的方法/criteria/config/dataset范围，不改写M5-D2A的结果，也不签发production source admission。

独立 controlled pixel truth 可来自明确构造；真实媒体 truth 需要独立核查。专业离线 truth 制作是验收证据，不成为普通用户每次使用的勾轮廓步骤。保守 mask 过大不能靠缩减边缘救通过，仍需最终几何上限及真实主体/自然度检查。criteria、truth、方法配置、支持范围必须提前冻结，开发材料不作新正式 holdout。

## Selection and Render Contract

**REQ-07 — Reuse geometry and selection.** 本地先验证全部目标/时段/输出设置，再从有效内置及上传目录求共同安全候选。Agent 只在共同集合内看原图、实际摆放全图与局部图选款；不能把预选星形或裸贴纸图片称为自动多候选选择。没有共同候选明确 UNSAFE，不为轮换放宽几何门。冻结后再次按实际 alpha255、输出投影与时域验证100% coverage。

未获生产 source admission 的自动 mask 只能在隔离诊断中复用 pixel/alpha 算法，不能直接塞入 `computeCommonShapeCoverCandidates` 的 admitted-source 接缝、构造知识 head 或伪造真人 review。生产消费留给 REQ-10 的后续合同。

**REQ-08 — Real sample evidence.** 使用原 queue/compiler/evidence 的实际消费契约核对同一冻结 PNG；隔离诊断不注册正式导出任务。主管独立检查配对原图与成片，四类内容安全全部 SAFE 且 `naturalness.verdict=NATURAL` 才可形成相应样片结果。白边厚度、比例、贴边截断和主体/手/商品/字幕侵入须有具体观察，不能以 coverage 或用户认可代填。

未准入自动mask的真实样例沿已有FFmpeg adapter隔离导出，按原输出设置和像素规则核查，并与合法fixture的canonical queue结果做差分；不宣称这些自动样例已经获得生产queue准入。选款图片和样片响应解析沿原selection/admission owners增加明确的diagnostic用途，复用原shortlist/reviewer；该用途只返回数据/观察，不构造生产FrozenShapeCover、真人review或可发布handle，原生产用途仍核对admitted source。

**REQ-09 — Real stationary animation.** 至少建立3个独立真实静态来源和3个独立真实固定动画来源的预先登记留出评估；同片不同片段或重编码不算独立来源。各类集合合计至少100个明确可判定的不同原帧身份，完整核查所选目标有效范围。动画必须实际包含形状/透明度/闪烁变化；只有合成动画或真实静态标不满足该层。细边/贴边/切镜/遮挡/主体邻近及移动拒绝负例均需记录，不适用或未评估项保留 null/NOT_EVALUATED。

真实端到端样例不预填 target、mask、贴纸 ID 或主管 verdict；实际经过识别、自动提取、选款及独立复核。所有新请求保存真实输入、原响应、映射、冻结字节、源/成片、逐帧时间证据、音频检查和实际播放观察。记录处理耗时、峰值内存、模型请求和可观察 usage；不可观察费用保留 null。

## Qualification and Product Boundary

**REQ-10 — Controlled qualification and later production.** M5-D2A 的18类场景、coverage minimum、全部指标、A/B/joint 分别计算、false EMPTY立即停止、≥100 clear frames 与 unnecessaryUnknownRate≤5% 原样适用。缩小产品支持范围不删除资格集中的 moving/animated 或未知负例；synthetic 与 real-media 分层，不由局部真实样片、模型一致或单元测试推导资格。

当前及本增量工程/受控资格始终为 `authority=none / eligible=false / PRODUCT_DISABLED`；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance 均 BLOCKED。不签发 `FullSourceAdmissionHandle`、production semantic PASS 或成功产品请求，不接产品 IPC/UI，不改变 manual / assisted 或旧冻结重试。

未来生产阶段需另行定义并获授权的 D2 Production Qualified Review、可信 AI mask/motion source admission 和动画持久/冻结格式，沿 canonical knowledge/store/assembler/activation/queue 扩展。现有 human `source-mask-only` 和 `static-binary-v1` 不接受 machine 或 animation 冒名；controlled QUALIFIED 本身不能打开生产门。

## Acceptance Matrix

| ID | Exit evidence |
| --- | --- |
| AC-01 | 不要求用户描边；真实样例的 mask 来源为实际自动 extractor，普通用户无需准备中间数据。 |
| AC-02 | 两条实际视觉路线分别通过冻结 capability，真实原片/正式执行入口具有正确用途、隔离和 provenance，旧失败保留。 |
| AC-03 | 自动 mask/motion 的独立 truth 对照及全部原 ordinal/像素绑定成立；未知和硬错误明确拒绝，没有人工 PASS 冒充。 |
| AC-04 | 复用全轮共同几何门、实际图片选款、同一冻结字节、100%最终 coverage和独立 SAFE/NATURAL样片结果。 |
| AC-05 | REQ-09 的真实静态/固定动画数量、范围和边界案例完整评估；移动不放行，合成与真实证据分层。 |
| AC-06 | M5-D2A 的真实独立资格证据、全部冻结门和可信 owner 来源成立；缺证据 INCOMPLETE，已证明硬错误 NOT_QUALIFIED。 |
| AC-07 | 产品阶段单独获授权并具备上述生产合同后才能实施；此前所有生产与兼容屏障保持。 |

## Self-Review

五个环节分别对应已有渲染复用、REQ-03–06、REQ-01–02/07–08、REQ-05/09和REQ-10；没有把“识别bbox”或“输入完整”当作 mask 质量。既有静态真人准入与固定动画非权威候选不互相替代。新增数量只约束本增量真实媒体评估，不覆盖原 M5-D2A criteria。算法可靠性必须由 development 收敛与独立留出验证，当前不预宣称能够成功。执行顺序见 [Implementation plan](shape-matched-cover-auto-contour-plan.md)。
