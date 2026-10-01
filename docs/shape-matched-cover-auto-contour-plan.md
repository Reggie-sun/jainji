# Automatic Contour Shape Cover Implementation Plan

## Goal and Scope

基于 [Spec](shape-matched-cover-auto-contour-spec.md)，补齐静态及固定位置动画旧贴纸的自动轮廓来源与真实 AI 联调。复用已经实现的本地几何、选款图片、冻结、样片和导出 owner。普通用户不勾轮廓。

2026-10-01 本次为 **PLAN_ONLY**：用户要求编写 spec 和 plan，不执行新实现、服务请求、安装或产品启用。此前工程授权及历史证据保留，本计划不扩大生产授权。以下里程碑是剩余工作，不是新完成记录。

**Subsequent execution authorization — 2026-10-01:** 用户随后明确要求实现本计划，故上述 `PLAN_ONLY` 仅描述最初文档交付。本次按原依赖和停止合同推进工程；用户选择保留已有改动并授权接续必要共享文件，只提交本任务内容。当前真实状态与新证据仍写入 [Stationary record](shape-matched-cover-stationary-record.md)，M6的单独授权要求保持。

**Current / Target Behavior:** 当前可以消费给定候选 mask 生成局部真实覆盖样片；目标是在声明支持的原视频范围内自动取得可核查 mask，再通过原选款和独立成片核查。模型声明 bbox、完整遍历或渲染 coverage不能替代这项自动来源验证。

**Contract Surfaces:** canonical D1/D2/frame binding、独立 machine mask provenance、静态/固定动画状态、qualified image route、原 shortlist 图片交接、冻结图层与输出时钟、独立样片协议。源知识和生产 contract 由原 owners 独占。

**Invariants / Compatibility:** 不回退矩形、不复制其他时段 mask、不自动换模型或重试；保留原 human schema/session/receipt/digest 与拒绝行为、manual / assisted、本地随机和旧冻结任务解释。现阶段 `authority=none / eligible=false / PRODUCT_DISABLED`，全部原生产 BLOCKED 门保留。

**Out of Scope:** 移动贴纸覆盖、delogo、新贴纸/文字生成、改变原视频顺序/时长/音频、修改用户手动输入、原任务重识别、直接接产品入口或真实 source admission。M6是单独授权后的后续阶段，不能自动执行。

## Baseline and Record Ownership

| Baseline | Evidence / consequence |
| --- | --- |
| 轮廓渲染及真实局部导出已存在 | 复用 [Stationary record](shape-matched-cover-stationary-record.md)，无需重做相同预选星形诊断来声称推进。 |
| 自动 mask 与真实动画仍缺验收 | M2、M3、M4负责自动来源和真实媒体；并集模块不是 extractor。 |
| 选款及自然度已有工程实现 | M4联调现有 owner，不创建第二个选款 Agent 或 renderer。 |
| 实际 AI 路线和正式执行缺口 | M1承接 [M5-D2A plan](shape-matched-cover-m5d2a-plan.md)，M5补正式证据；旧资格失败不重置。 |
| 产品启用关闭 | M6只给进入条件，M0–M5均不能解除生产门。 |

总体路线仍由 [V1 plan](shape-matched-cover-plan.md) 维护；M5-D2A真实路线/资格收据写入 [AI record](shape-matched-cover-m5d2a.md)，本增量轮廓/静态/固定动画媒体结果写入 [Stationary record](shape-matched-cover-stationary-record.md)。不创建第二套 phase ledger 或覆盖旧失败记录。

## File Responsibilities

以下为未来实施的 owned surfaces；实现开始时必须重新核对代码、dirty与精确 ownership，列在计划中不表示本轮获准写入其他任务文件。

| Surface | Responsibility and boundary |
| --- | --- |
| 新增 `src/main/source-mask-auto-extraction.ts`、`tests/source-mask-auto-extraction.test.ts` | extractor 与候选帧合同、原像素映射、provenance及取消；只产出候选，不持久化知识或发行 authority。 |
| 新增 `src/main/source-mask-auto-qualification.ts`、`tests/source-mask-auto-qualification.test.ts` | 独立冻结 pixel/motion truth 与候选的确定性比较和非权威结果；不复制 source identity 或 M5-D2A 目标 comparator。 |
| 新增 `scripts/shape-cover-auto-contour-diagnostic.ts` | 全自动诊断编排和私有媒体证据，使用 canonical 工具及既有算法；不成为产品生命周期或正式 qualification owner。 |
| 原 `source-fact-ai-*` 与 router `image_*` owners | 真实视觉、原片诊断/正式执行用途及可信语义 qualification；具体改动沿其原 implementation plan。 |
| `shape-cover-stationary-envelope.ts` / `shape-cover-pixel-gate.ts` / `shape-cover-alpha.ts` | 逐帧并集、投影、不透明覆盖和PNG；只在真实接缝需要时作兼容扩展，不建第二套几何实现。 |
| `shape-cover-selection.ts` / `shape-cover-production.ts` / `shape-cover-admission.ts` 与原 Controller/Provider | 后续复用实际选款和独立复核；现有 source admission 前提不得靠测试回调放宽。 |
| canonical knowledge/schema/store / assembler / activation / compiler / queue | 仅M6生产合同获授权后扩展；本计划工程阶段不修改其产品准入语义。 |

## Dependencies

`M0 → M1 → M2 → M3 → M4 → M5`。M1外部路线阻断时，可以继续M2的本地 development 和M3的作者侧材料准备，但这些只能形成开发候选；真实自动链依赖M1，正式run同时依赖独立冻结、实际能力与可信执行 owner。M6另行授权后才进入，不以M5结果自动激活。

## Major Milestones

### M0 — Preserve the Existing Foundation

**Status:** 已有工程基础，本计划不重标为本轮新实现。

**Files / owners:** 原stationary module、pixel/alpha/selection/admission及两个record；本轮只创建本Spec/Plan并在V1总plan添加指针。

**Contract / acceptance:** 将现有候选消费和渲染与缺少的自动 mask 来源分开；核对最新快照、原真实样片范围及模型请求计数。已有180帧与受控动画不升级为自动链或新holdout。

**Verification:** 文档引用、源码与既有证据绑定检查；执行代码发生变化时才重跑对应typecheck/tests，不为本次纯文档运行媒体或商业调用。

### M1 — Restore Actual Visual and Execution Routes

**Status:** 剩余工作；对应REQ-01–02、AC-02。

**Files / owners:** [AI plan](shape-matched-cover-m5d2a-plan.md) 的路线/正式资格阶段；外部router现有 `src/agent_subagent_router/image_run.py`、`image_contract.py`、`image_qualification.py`、`codex_image_wire.py`、`minimax_image_wire.py` 及相邻unit/conformance tests。源码和安装只由该repo的合同管理，本轮不修改它。

**Contract:** MiniMax-M3与应用独立Codex订阅 `gpt-6.1-sol` 分别证明真实图像输入、身份、无工具隔离、完整响应与取消收敛。调查MiniMax位置错误是否源于输入/编码/坐标表达或能力，不能先假定是某个原因；依据已证明原因修复，保留旧NOT_QUALIFIED。精确GPT模型条件缺失时记录实际账号/目录证据，不静默换别名、模型或全局登录。

在原router execution owner内分别定义受管原片开发诊断与正式blinded用途，原probe保持once/no-replay。正式 execution 与可信qualification来源沿原AI合同完成；删除费用门不代替该owner。任何scope内安全合同修订先Self-Review，保持原Docker、seals、credential/receipt规则。

**Acceptance:** 两路新冻结capability均有真实可用receipt，原片诊断能消费允许的PNG且不泄露路径/凭据；正式通道不接受caller填入qualified/authority或开发receipt。未满足则该单元INCOMPLETE、正式请求0。

**Verification:** router相关否定/隔离conformance、适用Risk Gate、官方clean安装及installed绑定；真正修复后的独立能力材料按新冻结条件检查。fake、模型目录和文本HTTP200分别记录，不替代真实视觉结果。

### M2 — Implement Automatic Contour Candidates

**Status:** 剩余工作；对应REQ-03–05、AC-01/03。

**Files:** 新增`source-mask-auto-extraction.ts`与对应test；消费原D2 evidence，复用stationary envelope，不改human admission。

**Contract:** 输入完整目标声明和活跃原帧，输出每帧保守mask、原身份/时钟/像素绑定、extractor版本、参数与可解释拒绝原因。只提供candidate provenance，固定authority=none/eligible=false；不得允许用户上传精细mask作为自动来源或默认使用历史星形mask。

在development数据上实现并比较时域候选与逐帧分割候选，按保守像素遗漏零容忍、支持类别、独立可核查性、依赖和实际耗时选择唯一方法；选择结论和被拒方法记录在原record。没有合格方法时停止该单元，保留失败，不能用实现存在代替能力成立。新分割依赖若确需引入，先明确版本/license/本地运行和安装检查；不提前指定未经验证的模型为qualified。

动画每个原ordinal提取后交原并集owner；保留原始变化和闪烁，独立核查anchor/motion，不能由bbox中心或固定输出层推出不移动。静态候选遵守原一致性约束，变化/unknown不能伪装静态。

**Acceptance:** 支持development输入无需用户勾边能产出可重算候选；细尖、半透明边、闪烁、最后一帧扩大、多目标、错帧/坏摘要、漏首中末、moving、源变化、超限、取消与迟到均有明确行为；失败不回退矩形、不遗留可消费成功候选。

**Verification:** 对关键行为先可靠red再green；`tests/source-mask-auto-extraction.test.ts`与`tests/shape-cover-stationary-envelope.test.ts`、`tests/shape-cover-pixel-gate.test.ts`、`tests/source-fact-review.test.ts`回归，必要时真实D1/D2/FFmpeg。M1未就绪时测试声明明确为fixture，不称真实AI。

### M3 — Freeze Independent Contour and Motion Evaluation

**Status:** 剩余工作；对应REQ-06/09、AC-03/05。

**Files:** 新增`source-mask-auto-qualification.ts`与对应test；作者侧媒体与truth保存在新的独占私有目录，冻结过程复用canonical decode，不改旧M5-D2A包。

**Contract:** 开发材料与never-exposed评估分开；提前冻结方法、pixel/motion truth、参数、输入范围与支持包络。真实静态和固定动画分别至少3个独立来源、各集合≥100个明确可判定原帧身份，逐目标核查完整有效范围。动画必须是真实变化；移动、切镜、遮挡、细边、贴边与主体邻近按Spec登记。真实truth缺失时该层NOT_EVALUATED，不把历史未审核mask当truth。

比较逐帧可见贡献遗漏/时段/身份/motion错误，明确像素及帧分母；任一可验证硬错误失败，未知或缺correspondence为INCOMPLETE。保守区域不能仅靠低漏失得分通过，还须M4几何及内容安全。离线独立truth制作不成为普通用户工作步骤。

**Acceptance / verification:** 测试漏一个尖角/透明边、漏一帧、动画尾帧扩大、moving被误接纳、truth/源/配置晚改、重复帧扩分母与未评估填零均被拒；支持方法在独立固定标准下有真实结果。新的mask结果不签发知识或生产handle，M5-D2A语义指标继续由原owner计算。

### M4 — Run the Real Automatic Chain

**Status:** 剩余工作，依赖M1–M3；对应REQ-07–09、AC-04/05。

**Files:** 新增`shape-cover-auto-contour-diagnostic.ts`；复用pixel/alpha/stationary、原选款图片与SupervisorEvidence，必要的工程接缝保持不授予production authority。相关tests优先复用`tests/shape-cover-candidates.test.ts`、`tests/agent-provider.test.ts`及新增diagnostic集成验证。

**Contract:** 使用真实输入从识别开始运行，不预填mask、贴纸ID或复核verdict；本地筛完整共同候选后才给原shortlist实际摆放图片，选后重核冻结字节并真实导出，独立连接检查配对样片、四类SAFE与NATURAL。准入未成立的自动候选使用隔离诊断，不能通过fake知识head进入production orchestrator；生产seam只在canonical admitted前提成立时复用。

实现原selection owner的diagnostic图片交接及原admission owner的无authority响应解析用途，保持原生产交接/handle创建的准入前提。隔离导出复用已有FFmpeg adapter、输出设置和像素算法，并与合法fixture的原queue结果差分核对；不把候选强塞进FrozenShapeCover或另建队列/选款Agent。这一接缝须测试diagnostic图片/响应不能进入生产消费者、JSON不能恢复ownership且原生产fixtures行为不变。

保存全部原响应/来源、选款目录、实际冻结PNG、输出帧/PTS及coverage、音频和播放观察。对每个登记支持目标核对完整时域；只测试片段就只声明片段结果。样片须检查白边、比例、贴边截断及主体侵入，并报告耗时、峰值内存和模型usage；移动与未支持输入拒绝。

**Acceptance:** 真实静态及固定动画各自达到REQ-09，实际识别/选款/复核请求与receipt可追溯；所有目标有效帧无truth可验证漏边，输出coverage100%，样片有独立SAFE/NATURAL及实际播放证据。不能从某一个预选星形结果推导整个目录或全片通过。

**Verification:** 新diagnostic真实执行、全部登记时域的原图/成片与帧/音频检查；执行完再检查来源/资产freshness。新代码需fresh typecheck和相关tests。无图片能力、原片材料或truth则标记对应层INCOMPLETE，保留局部证据。

### M5 — Complete Controlled Semantic Qualification

**Status:** 剩余工作；对应REQ-10、AC-06，原M5-D2A计划独占实施细节。

**Files / owners:** 原`source-fact-ai-contract.ts` / `source-fact-ai-input.ts` / `source-fact-ai-compare.ts`及按原plan实施的可信正式execution/qualification owner；原AI测试、human review/qualification兼容回归。此里程碑不通过diagnostic脚本自行签发资格。

**Contract:** 全部准备实际满足后，一次正式blinded run；独立truth与18类/数量、提前冻结config/criteria/inputPlan、隔离A/B、原raw/映射/joint及独立truth对应全部按原Spec。任何actor false EMPTY立即NOT_QUALIFIED，停止后续正式请求并隔离在途迟到结果；其它原硬门和≥100clear/≤5%UNKNOWN也分别验算，不由双方一致或另一方正确抵消。

**Acceptance / verification:** deterministic比较和可信owner来源核验产生有依据的QUALIFIED / NOT_QUALIFIED / INCOMPLETE；synthetic与real-media分别报告。缺项用null/NOT_EVALUATED。fresh typecheck、AI/human/qualification与必要shape回归、diffcheck、AOCI Verify/Check/Guide及适用Implementation Review Risk Gate。结果始终authority=none/eligible=false，不打开任何生产入口。

### M6 — Define and Qualify Production Admission Separately

**Status:** BLOCKED / OUTSIDE_CURRENT_AUTHORIZATION；对应AC-07。

**Entry conditions:** 取得单独生产阶段授权；D2 Production Qualified Review与可信source/mask/motion issuer合同成立；自动静态mask和固定动画各有版本化的知识/持久/冻结消费合同，并验证现有human与历史任务兼容。受控QUALIFIED与用户认可都不单独满足进入条件。

**Future owners / acceptance:** 只扩展原knowledge/store/admission、assembler/activation、compiler/queue/artifacts与既有产品入口，不新增生命周期。真实整片和批量、重启/取消/未知结果、安装包与适用平台实测成立后才讨论启用；无可支持自动mask就仍明确拒绝。此处不执行成功issuer、FullSourceAdmissionHandle、IPC/UI activation或规则切换。

## Verification and Ownership

执行时先重新读AGENTS与适用contracts，核对git status及所有writer的精确路径。当前controller/provider/runner/domain/shared agent与共享AOCI资产有其他任务dirty；该事实只阻止同文件未经分配的写入，不阻止独立新文件工作。使用当前working tree，不自动创建worktree，不reset/stash或提交foreign内容。

Native Codex为primary；已有“不要Kimi”选择保留，有益的工程分工使用named native profile，正式actors仍须受管视觉路线。本次只读code_mapper核查候选/准入/activation接缝，没有充当actor或reviewer。Spec/Plan由Parent Self-Review；后续implementation在project-native验证后的stable snapshot按SUBAGENTS Risk Gate判断，不能把工程mapper当required review。

每次真正代码变更运行`npm run typecheck`及其上列相关tests，真实FFmpeg/模型/播放与离线fixture分开记录；提交或完成前读`verification-before-completion`、核对最终diff及fresh证据。AOCI逐项维护本轮managed对象；docs按现行observe策略，不写混合共享索引。检查全库Verify/Check/Guide时foreign漂移单列，不截断未授权完整维护batch。

## Self-Review and Stop Contract

M0承接现有渲染，M1覆盖REQ-01–02，M2覆盖REQ-03–05，M3覆盖REQ-06及真实truth准备，M4覆盖REQ-07–09，M5覆盖REQ-10的受控资格，M6覆盖后续生产边界。所有AC均有对应milestone，没有将新proposal写作现状或把AI目标bbox当pixel mask。

自然停止点：本轮Spec/Plan可审阅交付；后续已授权执行推进到真实工程/语义退出证据、用户暂停、真实外部阻断或超出授权边界。即使文档、测试、commit或局部渲染完成，也不能把剩余自动链写为完成；M6不能因为前序成功自动进入。

## Documentation Delivery — 2026-10-01

本次只新增Spec/Plan及总plan指针，Parent核对目标枚举、像素候选和source/production authority边界；named native `code_mapper` 仅只读核对源码和相邻tests，未运行模型、测试或担任qualification actor。Spec/Plan依Parent Self-Review收尾，不制造implementation review或产品批准。没有适用的repository专用session capture skill，文档范围及交付说明由本计划承接，不写外部memory。

三份文档按现行AOCI均为observed_new，没有本轮未维护managed对象，不写共享索引/baseline。文档引用/占位符/合同覆盖与`git diff --check`检查，实际Verify/Check/Guide及源码快照核对保存在私有 `auto-contour-docs-20261001-a8lohkgl` 目录；最终机器状态以该次检查为准，不由文档声称取代。纯文档未重跑typecheck、Vitest、媒体导出或商业服务，不能新增任何运行验收结论。

## Development Execution Checkpoint — 2026-10-01

按后续实现授权新增M2本地development extractor、M3提前冻结的独立像素/运动比较器，以及同名diagnostic脚本的**作者侧开发用途**；该脚本尚不是M4真实自动链。完整来源、方法对比、实际CLI/FFmpeg、fresh verification及剩余条件保存于 [Stationary record](shape-matched-cover-stationary-record.md#automatic-contour-development-checkpoint--2026-10-01)。

M1仍被当前真实视觉receipt及正式execution owner缺口阻断。本地逐帧和时域稳定方法仅验证均匀背景受控包络，没有选择qualified extractor；M2能力收敛和M3真实独立留出材料仍未完成。M4/M5保持INCOMPLETE，M6保持OUTSIDE_CURRENT_AUTHORIZATION。工程测试、开发CLI及AOCI对齐不满足AC-01–06，不改变PRODUCT_DISABLED。
