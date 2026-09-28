# M5-D2A Implementation Plan

## Goal and Authorization

2026-09-29 用户在收到 [AI spec](shape-matched-cover-m5d2a-spec.md) 后明确要求“开始”，并要求本窗口直接执行。授权进入 implementation planning、工程实现、否定测试、有限 capability preparation 与条件满足后的受控资格；旧 DESIGN_ONLY 为历史设计状态，不是当前阻断。Native Codex 负责串行执行，使用当前 working tree，不创建 worktree。

验证 `dual-ai-full-canvas/v1` 的 truth-vs-review 完整性；工程候选、受控资格、生产资格分别报告。原 human D2Q plan 和记录不变，human qualification 仍 INCOMPLETE。

## Scope and Owners

复用 `source-fact-census.ts` / `source-fact-census-clock.ts`、`SourceIdentitySchema` / `identifySource`、owned `source-fact-review-evidence.ts`。新增独立 `source-fact-ai-contract.ts`（machine declarations、固定 criteria、AI package）、`source-fact-ai-compare.ts`（A/B/joint 逐帧指标与对应）、`source-fact-ai-input.ts`（原 RGBA→无损 PNG、inputPlan）、`source-fact-ai-run.ts`（工程 transport、单调停止与不可编辑 receipts）。独立 scripts 准备新的作者侧数据与检查 route readiness；不复用 human session、confirmation、acknowledge 或原 receipt。

`docs/shape-matched-cover-m5d2a.md` 为本阶段 evidence/session record owner；本 plan 保存实施顺序，既有总体 plan 只链接当前切片。代码/tests 是实现事实；图谱只作定位，已核对 evidence→canonical census 关系，通用名字的图谱误连不作证据。

## Invariants and Compatibility

全过程 `authority=none / eligible=false / PRODUCT_DISABLED`。M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance BLOCKED。无 source admission、FullSourceAdmissionHandle、knowledge 写入、placement/candidate/coverage/renderer/产品IPC/UI接线。原 D1、human schema/session/tool/HTML/digest 与拒绝行为逐字节保留；不修改交接列出的 dirty files。

AI 声明只能 TARGETS（非空无重复 UUID、描述、category、原像素整数 bbox）、显式 EMPTY 或带原因 UNKNOWN；拒绝工具、未知字段、partial/truncated/重复/绑定错输入。相同像素的 ordinal 均独立保留，PNG SHA 与 RGBA SHA 分开。原声明一经接受不可编辑，不修复成 EMPTY，不重试或换模型。

## Major Milestones

### 1. Independent Contract and Deterministic Comparison

新 AI package 复用既有严格 manifest/truth/frame shapes 及其绑定验证思想，但 criteria/method/schema独立，不修改 human literals。criteria 冻结全部18类及 spec minimum；增加 categoryMismatchTargetFrames。A/B/joint 分别比较 truth correspondence，未评估字段 null，显式保存分母。false EMPTY 或其他已证明硬错误优先于 coverage不足；5%以整数交叉乘法比较且至少100 clear frames。纯离线匹配只能 diagnostic comparison，正式 qualification 仍 INCOMPLETE，无可伪造 qualified 开关或成功恢复入口。

**Verification:** `tests/source-fact-ai.test.ts` 覆盖 actor 双漏仍一致、另一方正确/joint UNKNOWN不抵消、身份merge/split、边界/再现/单帧/并发/category/歧义/误报、5%与99 clear、不完整correspondence/criteria/旧包/借帧；原qualification tests回归。

### 2. Owned Lossless Input and Monotonic Engineering Run

`source-fact-ai-input.ts` 从活跃 evidence 读取全部帧，使用现有FFmpeg PNG能力，有界命令、取消等待close、无resize，decode回RGBA逐字节核对。固定最多8连续ordinal/packet，保存匿名fixture、source/census/原clock/PNG与RGBA绑定，输出完整inputPlan digest。

`source-fact-ai-run.ts` 的 injectable transport 只用于工程验证，收据标为 ENGINEERING_ONLY；不能通过caller route/probe JSON进入正式 run。每个packet一次请求，generation/payload/request/wall/idle有限。接受完整packet后逐ordinal追加；作者侧立即检测false EMPTY并撤销剩余请求，迟到输出隔离。保持完整raw response摘要、sent input与原声明，fresh核对后freeze；mapping必须在两份全部原receipt之后，不许改原结果；双射/category/活动ordinals失败为joint UNKNOWN。

**Verification:** 真CPU D1/D2/PNG往返、首中末/重复像素、伪造evidence/输入、atomic拒绝partial、取消与迟到、budget/truncation/tool注入、不继续请求和冻结后编辑拒绝。

### 3. New Author-Side Holdout and Preparation

新recipe不导入旧 `d2q-controlled-3x18x8/v1` 或诊断答案。至少三个结构不同背景/来源构造组，覆盖18类和全部minimum，随机匿名fixture，完整canonical decode绑定truth与独立构造版本。作者侧私有目录exclusive发布，不给actor recipe、truth或场景标签。明确SYNTHETIC_CONTROLLED；REAL_MEDIA_HUMAN_TRUTH未提供时报告NOT_EVALUATED。

提前保存criteria、输入packet与有限预算草案；source/tool/engine/dataset/truth freeze使用实际SHA。正式methodConfig与applicability envelope必须在真实capability gate后冻结，草案不能冒充正式配置。作者实例不得担任actor，本聊天不得充当盲审上下文。

### 4. Route Capability and Formal Qualification Gate

先验证当前两条路线的无损image输入、真实身份、fresh隔离上下文、无文件/搜索/工具/nested delegation、有限预算、请求payload/response证据。独立probe不使用holdout。Kimi只能sealed contract、qualified route、Docker、canonical receipt，不能host claude -p。Codex需要新的隔离视觉执行路线，当前聊天不具备actor资格。2026-09-29 用户追加“修复blocker”，并明确选择包含 `/home/reggie/vscode_folder/agent-subagent-router` 扩展和安装；该外部仓库的安全合同修改另受其 accepted Spec V3 管理。

任一路线不支持图片传递、隔离或route证明时记录实际阻断INCOMPLETE，停止正式请求；初始范围不修外部router，追加授权后允许按外部仓库合同修复，不静默更换provider。条件真实成立后冻结config/inputPlan/envelope/budgets，正式run一次，post-freeze B映射一次，再独立truth correspondence与deterministic三方比较。正式record需可信controlled execution owner来源核验；当前工程seam不提供成功issuer。

### 5. Verification, Governance and Checkpoint

读取 `verification-before-completion`；fresh typecheck、新AI tests与D1/D2/qualification/knowledge/mask/C/B回归、必要shape regression、diff --check、原文件SHA。stable snapshot判断 `/home/reggie/.codex/SUBAGENTS.md` Risk Gate；站立Kimi分工只核对复用边界，不充当盲审actor或final reviewer。AOCI官方Maintain完整batch与Verify/Check/Guide；仅commit本任务路径及官方索引baseline，保留无关changes。

## Acceptance and Stop Contract

全部真实退出证据满足才声明M5-D2A PASS。工程机制通过不代表视觉语义qualification。缺route/probe/独立性/正式freeze/原receipts/mapping/correspondence/可信issuer时INCOMPLETE；任何已证明硬错误NOT_QUALIFIED，历史失败永久保留。遇到真实能力阻断时保存可验证工程checkpoint、阻断证据与remaining work，无需用户再次回复“继续”。下一阶段D2 Production Qualified Review超出授权。

## Execution Checkpoint

Milestones1–2已有工程candidate和58项fresh tests PASS、typecheck PASS。Milestone3已冻结新synthetic54 clips/648帧、18场景及完整inputPlan，独立verify及PNG篡改否定检查完成；真实媒体层NOT_EVALUATED。

Milestone4因受管接口缺少可验证无文件工具视觉actor及隔离阻断，probe/formal requests=0，正式配置、成本批准、可信execution/receipts/issuer未成立，qualification INCOMPLETE。Milestone5原human回归11项5000ms超时，Risk Gate为BLOCKED_NATIVE_VERIFICATION；四个AI AOCI entries已维护，其他会话继续维护后，最终Verify/Check/Guide均exit0且governance_aligned=true；正式资产混合归属仍dirty，不纳入本任务commit。保存未验收candidate checkpoint，不宣称implementation或M5-D2A完成。详细证据和剩余工作由 [record](shape-matched-cover-m5d2a.md) 独占，全部生产guards保持BLOCKED。

上述是019e345历史checkpoint。追加blocker修复后，human media suite仅调整测试timeout，全部345项相关回归、107项shape regression及fresh typecheck已通过；engineering Risk Gate更新为KIMI_REVIEW_NOT_REQUIRED，正式qualification仍INCOMPLETE。外部router扩展范围已获授权，新的image contract exact SHA尚待其V3 approval，不将准备好的合同当作已实施路线；formal/probe请求仍0。共享AOCI新增其他任务11项治理findings，test/docs为observe且AI managed source未变，实际owner维护前不声明全仓对齐。当前证据、状态和remaining work以record新增Blocker Repair章节为准，历史失败不删除。

## Self-Review

已将spec的method/config、独立真值/18类coverage、whole-frame PNG与packet、独立A/B→mapping→joint、truth对应、全部指标/null、单调停止/预算、可信来源、human兼容及产品禁项映射到上述milestones。不存在把旧human plan、双模型一致或transport成功当作AI资格的步骤。

## Image Route Implementation Checkpoint

用户随后明确“那继续实现啊”，批准已展示且未修改的 router image supplement exact SHA；上一段批准待定为历史状态。外部router已建立durable implementation plan并继续实际实施，独立image-task/seal、Kimi native图片projection/wire guard、source inspect-images和Codex Docker/native诊断输入已有代码与离线证据。

Milestone4仍 INCOMPLETE：Codex原始八图传递、fresh输入和actual tools=[]已在Docker fake验证；即使配置model_max_output_tokens=2048，实际请求仍缺生成token上限，IMAGE_GENERATION_BOUND_UNPROVEN阻断live调用。完整authenticated Codex channel、image execution/typed receipt/qualification owner及新安装尚未完成；不以诊断helper捕获请求当成功turn或视觉能力。正式probe/formal requests=0，不降低预算标准、不切换provider。原holdout与全部生产guards保持。详细代码/测试/冻结证据及剩余工作见 [current phase record](shape-matched-cover-m5d2a.md) 的Image Input Implementation章节和外部router canonical record。

## Generation Budget Repair Boundary

用户要求先修复blocker再安装后，已继续 actual request/schema/versioned source 调查；现有 Codex subscription 路线没有可验证的硬生成上限。Router已准备 API amendment SHA `14e10cad0f3afc44f0f3796c2ae86c45e161c8a17ab2d54801c8c261a81df272`，改变 endpoint、API credential 和 billing，base V3 exact-SHA approval pending。该新边界不能由原 router 范围批准推定通过；此前已批准 image-input implementation 保持。批准后自动更新 router existing plan并继续 implementation/required review/official installation，不另要求“继续”。当前M4及正式资格仍INCOMPLETE，installed route未替换，所有production guards保持；最新证据由 [phase record](shape-matched-cover-m5d2a.md) 与 router canonical record独占。

## Approved API Implementation Progress

用户随后“批准”明确接受上段API amendment exact SHA；pending是历史状态。按writing-plans更新外部router计划后，已继续实际实现fixed OpenAI api-bounded channel、原native body到sealed generation cap的唯一映射、private credential边界、source=None新Docker入口、完整native终态/原始证据/typed capability owners与CLI。新Kimi/Codex实际八图native/fake及OS检查已通过，全套offline524 PASS/27 skip，全套显式native/fake+containment548 PASS/3 skip；均是工程证据。Required managed Kimi deep只读审查已封存并启动，安装待该门真实满足，不以tests或用户认可代替review/视觉资格。

Milestone4仍INCOMPLETE：当前没有独立OpenAI API credential reference、当前额度和冻结成本accounting证据，故新视觉Provider请求0；原subscription接口缺hard cap的事实未改写。本聊天不充当blind actor。Capability授权仍两backend各最多1次、OpenAI USD1、每次generation2048/wall180/idle90；formalCostAuthorizationUSD=0，formal请求0。Scope内下一步继续required review、官方clean安装及installed核验；条件缺失保存可信INCOMPLETE，原独立holdout/criteria/inputPlan与全部生产BLOCKED保持。

## Required Review and Installation Blocker

Router required review第一轮invocation `5d46f112-ba0e-48ae-afa0-10b2b1640d9a` 已真实执行，canonical OUTCOME_UNKNOWN：第一次HTTP200仅为工具探索，第二次TLS_ERROR/CONNECT，缺完整审查report/verdict。Parent核验封存源码与receipts，未采用部分结果、未自动retry/fallback；失败保留并计入round1。按approved API Spec，缺有效review不得安装新可运行路线，故外部candidate未安装。当前自然停止于真实review transport blocker及独立API账户证据缺口，Milestone4/正式资格仍INCOMPLETE；保存未验收engineering checkpoint，不把commit当作PASS。

本轮Jianji只修改两个plan/record owner。Fresh typecheck PASS；六个实际AI/human/qualification tests共129 PASS。首个测试命令遗漏AI文件和首轮typecheck期间foreign renderer修改均已记录，随后补跑并核对379路径SHA一致。AOCI尚有其他owner的11项findings，docs属observe，自己AI managed源码未改；不覆盖foreign索引或声明全仓对齐。最终证据与remaining work由 [phase record](shape-matched-cover-m5d2a.md) 和外部router canonical record独占。

## Installation Continuation

用户随后“安装”，已继续执行前置门而非免除安全合同。Router current clean ec1567f源码与548 PASS时SHA一致；Parent调查round1失败、取得当前TLS-only及doctor成功证据后，显式进行一次有限第二轮required review。Canonical invocation `dbd52980-2e47-4b06-9ff3-f6609a89a90f`仍OUTCOME_UNKNOWN：第二次请求HTTP200后RESPONSE_BODY连接中断，无完整report。两轮已消耗，未自动开启第三轮、换provider或采用partial输出。外部Spec禁止缺有效review安装，official installer本次未运行；既有223da83安装核验未变。Milestone4仍INCOMPLETE，visual/formal请求0，所有production BLOCKED保持；更底层transport原因、有效review、官方安装及live准备仍为remaining work。

本轮fresh AOCI Verify/Check/Guide均exit0、findings=0、governance_aligned/ok/complete均true；此前foreign findings是历史状态。本任务没有修改正式索引/baseline或source，不把其他owner的维护归为自身结果。未新增typecheck/Vitest，实际new receipt/source/installed-entry checks及文档diff核验由phase record保存。治理通过不替代required review或M5-D2A资格。
