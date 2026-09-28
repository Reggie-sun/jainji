---
title: Shape-Matched Static Cover V1 Implementation Plan
status: draft-not-executed
version: 0.1
date: 2026-09-24
spec: shape-matched-cover-spec.md
---

# Goal And Authority

按 [V1 Spec](shape-matched-cover-spec.md)替换**合格自动覆盖**的白色矩形路径：可信源像素 mask → 同轮安全候选 → 小幅不透明轮廓 → 最终输出像素 coverage → 独立内容安全 → 原队列导出。当前只编写 plan，未实施代码或更改产品规则。用户已排除 `delogo` 和移动旧贴纸；本计划不增加这两项。

# Baseline And Dependencies

- [Source knowledge](../src/shared/source-sticker-knowledge.ts)和其 [store](../src/main/source-sticker-knowledge-store.ts)是源身份、事实修订及证据的 owner；现有事实只有轨迹/矩形，没有像素 mask。[近似覆盖方案](../src/main/cover-placement-session.ts)只属于渲染决定，不能直接升级成源事实。
- [AgentRunner](../src/main/agent-runner.ts)当前在第一条合格素材上选同轮统一贴纸；[AgentController](../src/main/agent-controller.ts)传入完整本地候选目录。新门槛必须在轮次选择前收集全部目标的可信 mask，并仅给选款流程共同安全候选。
- [cover-sticker.ts](../src/main/cover-sticker.ts)负责覆盖图层，[compiler.ts](../src/main/compiler.ts)负责当前白底 FFmpeg 图形，[cover-motion.ts](../src/main/cover-motion.ts)负责输出偶数像素栅格。新轮廓要沿现有模板、预览、队列和冻结重试路径，避免独立第二 renderer。
- 本计划与现行白色矩形产品规则存在预期差异；只有新实现和验证稳定后才同步修改 [AGENTS.md](../AGENTS.md)及相应用户提示，不提前宣称规则已切换。历史任务及手动/`assisted` 合同保留。

# Milestones

依赖顺序为 `M1 → M2 → M3 → M4 → M5`。每一阶段先满足收敛条件再进入下一阶段；不以 schema 存在或测试通过替代真实媒体证据。

## M1 — Prove The Mask Evidence Seam

**Work:** 在已有真实静态旧贴纸素材上设计并验证源像素 mask 的建立、保守边缘核查及多时点时段证据。可复用现有抽帧、局部放大与源知识证据，不自动导入保存框或实验脚本掩膜。分别记录人工核查、可自动建立和无法可信建立的样本。冻结 mask 坐标/压缩/版本/负载界限及最小时间证据要求；小幅扩张的面积、宽高、半径上限通过开发样本定标，留出样本只验收不调参。

**Convergence:** 可解释地取得至少一类真实静态 mask，细尖/描边/半透明边缘保守纳入；无贴纸、形变、时段不明和证据矛盾可重复地拒绝。若真实素材不能可靠建 mask，暂停后续生产渲染切换并报告缺口。

## M2 — Source Fact And Persistence

**Work:** 扩展 `SourceFactsSchema` 及单一知识 store 的版本化记录，绑定现有 `SourceIdentity`、segment、整数 bbox、无损 mask、摘要、创建/核查元数据和原帧证据。明确旧修订的兼容读取：无 mask 的历史知识继续用于原占位职责，但不能通过新自动覆盖门槛。证据变更/争议按现有不可变修订与传播规则失效，不建立第二知识库。

**Convergence:** schema 与 store 测试覆盖有效读取、跨版本、改源、坏摘要、坏尺寸、恶意大记录、证据缺失和争议；错误不导致 bbox fallback 或覆盖源文件。记录能在重启后按精确源身份复用，不能把旧近似框当作 mask。

## M3 — Shape And Final-Pixel Gate

**Work:** 在聚焦模块实现候选 alpha 栅格、形状预筛、有限轮廓扩张、源 mask 到输出像素的保守变换，以及逐帧逻辑 coverage。按当前真实 FFmpeg 缩放/补边和像素舍入处理；相同栅格状态可缓存，时序必须逐输出帧证明。冻结所需的算法版本、参数、贴纸资产指纹、输出设置及 coverage 结果。无新依赖或 GPU 要求，优先 CPU bitmask 与已有 FFmpeg 能力。

**Convergence:** 像素测试覆盖 AC-03；真实星形素材在不同输出设置中得到可重算的通过/拒绝结果。叶子、竖向及边缘不足的候选不能因 bbox 相交或 alpha>0 而通过。对实际 FFmpeg 图层/导出帧进行配对核对，发现计算与渲染不一致即停止。

## M4 — Selection, Preview And Fail-Closed Integration

**Work:** 调整轮次准备顺序，让本轮全部自动覆盖目标先取得 mask 和共同安全候选，再进行现有选材/创作；Agent 只接收合格目录，选择后重新验证实际模板。把新轮廓作为显式版本化渲染策略接入原编译器/预览/队列；手动、`assisted` 和旧冻结任务不改变解释。沿现有真实样片复核检查人物、手、商品和字幕侵入，并给 `UNSAFE` 保留准确原因。对源事实修订、素材变更、取消和重试重新核对冻结绑定。

**Convergence:** 一轮多素材混合形状无共同候选时停止，不能由首素材的选款放行；无 mask、坏 mask、超限扩张、coverage 失败、内容安全失败均不入队或退回白底。合法样片仍由原队列验证后发布；历史冻结输出像素保持原样。

## M5 — Real-Media Acceptance And Rule Switch

**Work:** 使用冻结留出集做真实导出、逐时段原片/成片查看、边界场景复核和长片多素材耗时/内存记录；覆盖实验中已见的星形、叶子、竖向、字幕邻近、人脸/手、商品、高纹理、切镜、无贴纸样本。先运行类型检查、受影响单元/集成测试及实际 FFmpeg 输出验证，再做适用的独立审查。稳定后同步更新现行白底规则、提示、文档和回归测试；只对新自动覆盖任务启用新策略。

**Convergence:** Spec AC-01–07 均有可追溯结果；真实成片无已知旧贴纸露出及受保护内容侵入；成本有长片证据。人工未看全片、Windows 实机或更广素材泛化若未做，明确标为未验收。若门槛不满足，保留现行生产行为并报告 `UNSAFE`，不以试验性轮廓替换它。

# Verification And Handoff

未来实施需运行 `npm run typecheck`、受影响测试、跨制作/导出集成测试，并用真实 FFmpeg 导出与配对截图核对输出；在声称通过、commit 或 PR 前执行 `verification-before-completion`。测试文件与命令以实际实现确定，不把尚未创建的测试列作已运行证据。文档本次只检查链接、合同与当前源码的一致性。

实施时保留现有未提交文件；修改前重新核对 `git status` 和目标文件 ownership。代码变更的提交、审查及运行证据按当时有效仓库规则执行。本 plan 的 `draft-not-executed` 状态不得解释为实施授权或通过验收。

# Active Slice — M4-B1

2026-09-27 用户授权直接实现本子步骤；沿用上方路线，不重做 M1–M5。通过 `superpowers:writing-plans` 将窄执行合同补入现有 plan，完成后回到 Native Codex execution。

**Goal / Scope:** 对明确列出的全部 intended target/segment/range，先从既有 `SourceStickerKnowledgeStore` 取得匹配当前源身份和指定 head revision 的 admitted mask；全部准入后枚举本地候选，使用真实 FFmpeg alpha 对 `candidate × target × output setting` 执行 M3 final-pixel gate，求整组共同几何合格集合。

**Files / Owners:** 新建 `src/main/shape-cover-candidates.ts` 负责整轮源准入、矩阵与求交；新建 `src/main/shape-cover-alpha.ts` 负责有界真实媒体栅格读取与测量；新建 `tests/shape-cover-candidates.test.ts`，用真实媒体和 canonical admission/store 验证；记录到 `docs/shape-matched-cover-m4b1.md`。不复制 knowledge owner、像素算法、模型选择器或队列。

**Input Contract:** intended targets 独立于查到的 mask 列表，包含精确 source identity/path、expected revision、target/segment ID 和半开 required range；统一 output settings 为现有 `ExportSettings`，每个 target 必须为每种设置提供一个静态最终像素 placement。不自动找框或搜索无限摆放。候选为已有本地 sticker ID、asset path/fingerprint；首版只证明单帧静态图案，动画明确拒绝。输出的 source scale/pad 用当前 FFmpeg 测量，不能由调用者伪造。

**Invariants / Compatibility:** 任何缺 mask、审核、有效时段、源字节/修订绑定、output placement 或知识完整性即整轮 `UNSAFE`，在读取候选 alpha 前停止。实际 alpha 必须匹配资产指纹，像素上限与轮廓阈值沿用 M3；全透明或仅半透明不等于不透明覆盖。候选必须通过全部矩阵单元才进入共同集合；没有共同候选为 `UNSAFE`。返回 source revision、mask/asset/alpha 摘要、设置、测量、placement、算法版本及各单元结果；不能跨 segment 或 output setting 借 PASS。

**Acceptance / Verification:** 缺任一 intended target、第二目标排除首目标候选、空交集、各设置独立拒绝、真实透明 alpha、源/证据/资产篡改、修订变化、取消与非法几何均可执行验证。运行相关 M3/M4-A 测试、`npm run typecheck` 和全套测试；在 commit 前执行 `verification-before-completion`，检查最终 diff。需要真实 FFmpeg 的测试不得用合成 alpha 冒充媒体读取。

**Out of Scope:** 不接 AgentRunner/Controller、UI、选款调用、compiler/renderer、图层冻结或正式导出；不证明内容安全或全片 PTS/成片验收。结果标记 `geometry-only` 与 `contentSafety: NOT_EVALUATED`，不会成为生产 PASS。下一阶段仍须冻结实际图层、逐帧时序复核、原队列样片与独立内容安全检查。

# Active Slice — M4-B2

2026-09-27 用户在 M4-B1 检查点后授权继续。沿用原 plan，以 `superpowers:writing-plans` 固定本切片合同，再由 Native Codex 串行实现；不创建 worktree，不调用产品 Agent、付费模型或 Kimi review。

**Goal / Owners:** `shape-cover-freeze.ts` 从重新核对的 whole-round common candidate 生成带有限不透明轮廓的最终像素 PNG；`shared/shape-cover.ts` 定义显式冻结策略和绑定；`shape-cover-render.ts` 验证模板/源/设置绑定并读取 PNG 快照。`shape-cover-alpha.ts` 复用真实 RGBA 媒体路径，`shape-cover-candidates.ts` 只暴露已存在的 admitted target seam。`domain.ts` 只扩展可选覆盖策略，`compiler.ts` 消费其原尺寸字节，`queue.ts` 沿现有任务文件路径写入/清理该快照，并阻止未准入正式输出；不增加第二 renderer 或队列。

**Freeze Contract:** 调用者给出完整 M4-B1 request 与共同集合内 selected candidate ID。创建前重新计算矩阵；实际贴纸字节/alpha 必须匹配该矩阵，再生成最终 RGBA、无损 PNG，重新解码并核对像素与 100% coverage。每个 target/output 单元独立绑定 source identity/revision/facts/mask、候选原资产指纹、输出设置与 scale/pad、placement、required range、轮廓版本/半径及实际 PNG/RGBA/alpha 摘要。全部有效后以不替换已有文件方式发布；缺 mask、变化、取消、字节/coverage 不符均返回 `UNSAFE`，不产生可消费层。

**Consumption / Compatibility:** 新策略为全输出画布的透明 PNG，compiler 直接 overlay=0:0，按半开 range 启停；不再缩放、crop、补白底、按归一化坐标重新舍入或联合价格渐隐。模板层的普通几何/轨迹字段须与策略一致，源或 preset 不匹配拒绝。compiler 将核对后的图层字节作为任务 binary file 交给原 queue；临时文件在成功、失败、取消时清理。无该策略的手动、assisted、历史冻结任务继续原分支。

新策略的 30fps 转换在 overlay 前建立输出帧时钟，避免输出重采样使已停止覆盖的源帧落到仍需覆盖的输出 PTS。queue preview 须获得 canonical knowledge store，并在渲染前后复核冻结源 revision/mask/facts；缺 store、争议或变化均拒绝返回有效样片。发布使用本次独占的 UUID 子目录，失败只清理本次目录，保留其他 owner 的文件。

**Safety Boundary:** 本切片仍是 `geometry-only / NOT_EVALUATED`，允许原 `renderPreview` 渲染样片，不允许 `createBatch`、`publishApprovedSample` 或恢复/重试执行新策略。不得添加可由调用者填入的假内容安全 PASS。逐输出 PTS、编码后边缘与真实源/成片对照在 fixture 上验证，不外推为用户素材/全片的生产准入；独立内容安全和选款整合留在后续切片。

**Acceptance / Verification:** 用真实 admitted mask、实际 alpha 与带非零半径/透明边缘的 fixture 验证 round→freeze→原 queue preview；核对 PNG round-trip、输出帧时序及配对像素；测试模板/源/设置/资产篡改、冻结期间取消、计算后原候选删除仍可用、快照后冻结文件变化不能改已编译字节、未准入入队/发布/恢复均拒绝。运行 typecheck、M3/M4-A/M4-B1/模板/compiler/queue 相关测试及全套测试；按 `verification-before-completion` gate 在稳定候选检查 final diff、只提交本任务文件，记录到 `docs/shape-matched-cover-m4b2.md`。

# Active Slice — M4-B3

**Goal / Scope:** 在 AOCI 全仓 reconciliation 后，建立逐输出真实样片 coverage 与独立内容安全准入。新增 `src/main/shape-cover-admission.ts` 负责证据计算和不可伪造的进程内准入 handle；复用原 `ExportQueue.renderPreview`、`SupervisorEvidence` 及 `superviseRenderedTemplate`。`queue.ts` 只允许已准入的同字节样片经过原直发路径发布；不允许把样片 PASS 转给重新编码的普通批次、历史恢复或其他输出规格。记录 owner 为 `docs/shape-matched-cover-m4b3.md`，测试复用 `tests/shape-cover-candidates.test.ts` 的真实 admitted-mask fixture。

**Coverage Contract:** 重新核对完整 candidate×target×setting 矩阵及当前选款。当前媒体/输出规格的所有 intended targets 必须逐一对应冻结层，无遗漏、重复或额外 shape 层。重新从当前候选真实 RGBA 与版本化轮廓计算像素，核对冻结 PNG、RGBA/alpha 和绑定；再把 admitted source mask 投影至最终空间，要求每个像素 alpha=255。真实队列样片读取全部 decoded output PTS，拒绝无效或不完整帧流；逐目标检查启停时域。该证明是最终不透明栅格及真实输出时钟的组合，不用编码颜色相似度冒充 alpha；编码后侵入和边缘由实际配对样片检查。

**Independent Safety Contract:** 沿已有最多五轮主管检查/补帧预算，独立 reviewer 明确检查 face、hands、product、subtitles 四类侵入，均须 SAFE，并引用当前真实配对证据 ID；裸 pass、缺项、UNKNOWN、UNSAFE、陈旧证据及无法判断均不签发准入。固定图层修订必须重新走选款/冻结/准入；此切片不让通用 bbox 修订改写冻结 shape。用户未授权真实服务调用，测试使用明确标记的模拟 reviewer，不把它报告成真实模型或人工验收。

**Binding / Lifecycle:** handle 由 module-private WeakMap 绑定完整 request、模板、媒体、输出 preset、样片 SHA 和检查证据；调用者不能通过 JSON 填 PASS。发布前重查当前 source/asset/frozen bindings，复制后核对 partial 与已批准样片相同 SHA，取消或任一漂移为 UNSAFE。handle 不写入源知识或序列化为持久生产 PASS；重启后须重新准入。旧矩形、manual、assisted 路径不变。整轮 Agent 选款接线、持久可重放准入、全片自动覆盖与生产 UI 激活仍在后续切片，本次不调用产品 Agent、付费模型或 Kimi review。

**Acceptance / Verification:** 真实 FFmpeg/原 queue 的 coverage→paired evidence→模拟独立安全→同字节直发正例；几何 PASS 但脸/手/商品/字幕侵入或未知、伪造 handle、源/设置/模板/样片/候选漂移、遗漏目标、冻结像素篡改和取消拒绝；普通入队/恢复仍不能用样片准入放行。运行 typecheck、相关 shape/compiler/domain/queue/supervisor tests 及有限并发全套；完成后官方 AOCI incremental maintenance、Verify / Check / Guide，检查 final diff 并提交限定文件。

# Active Slice — M4-B4

**Goal / Entry:** 在原 `AgentController` / `AgentRunner` 增加进程内显式 `startShapeMatched` 接缝；默认 `start`、IPC、UI 和旧矩形路径保持不变，不进入 M5。入口消费显式 intended targets / placements / output settings，候选必须来自本次已有合法本地目录，源/素材集合和当前输出设置必须一致。缺任一素材或源事实 segment、范围不全、重复目标、目录外资产均拒绝；不从 bbox 或旧轨迹生成 mask。

**Owners / Sequence:** 新 `shape-cover-production.ts` 只编排现有 M4-B1/B2/B3 owner：先为全部素材验证完整源事实集合并计算 candidate×target×setting 共同几何候选；再允许原选款回调收到共同集合内的轮换子集。按版本共享同一选款与整轮冻结，逐素材版本独立创作、样片准入；`agent-template-preparation.ts` 将冻结 shape 图层加入同一模板，并按实际 placement/range 调用现有补角 owner。`AgentRunner` 在全部 masks/共同集合通过前不抽模型帧、不调用创作/选款；安全 UNKNOWN/UNSAFE、coverage/绑定漂移或取消不发布该版本。原 `publishApproved` 回调传递 opaque handle，复用 queue 同字节直发，不新增 renderer/queue。

**Reviewer / Compatibility:** 独立 `reviewerProvider` 使用专用 shape 内容安全协议，明确 face/hands/product/subtitles 和当前真实配对 evidence IDs，只允许 inspect/stop/pass；不调用视觉识别生成近似框，不回退旧矩形。缺独立复核连接在模型调用前拒绝。manual、assisted、关闭覆盖和历史冻结任务继续原解释。新接缝没有 IPC/产品 UI 接线，不启用全片自动覆盖。

**Persistence / Restart:** 冻结模板与最终 artifact 可沿原 JobStore 保存，仅是可追溯数据；PASS authority 仍仅为 M4-B3 module-private handle。同进程只发布该 handle 绑定的原样片；普通 createBatch、append/retry、重放和重启恢复继续 fail-closed。重启不自动调用任何模型，不恢复 handle，不将 JSON PASS 或重新编码产物借作准入。缓存 PNG/预览为 run-local 文件，不承诺持久重放；对应持久化能力不在本切片实现。

**Verification / Record:** `tests/shape-cover-candidates.test.ts` 增加 Controller→Runner→共同集合→整轮冻结→逐版模拟独立 reviewer→真实 FFmpeg→原队列同字节发布的集成证据；覆盖缺目标/mask、空共同集合、越界选款、未知内容安全、源漂移、取消和跨版本不复用 PASS。补角检查真实 placement/range；相关 controller/runner/provider/template/queue 与 shape 测试、typecheck、有限并发全套及官方 AOCI Verify/Check/Guide。记录到 `docs/shape-matched-cover-m4b4.md`，仅提交本切片文件及官方签发增量维护。用户两个项目文件删除保留。不调用真实产品 Agent、付费模型或 Kimi review；Parent 直接负责合同核查和最终 diff，模拟 reviewer 不等于真实语义/人工/Windows 验收。

# Active Slice — M4-B4 Recovery Contract

**Goal / Scope:** `dc8cd81` 后用户授权继续；本切片补齐持久化/重启合同及可执行恢复拒绝证据，仍属 M4。只修改本 plan、`tests/shape-cover-candidates.test.ts` 与 milestone 记录；不新增可恢复 PASS、持久准入格式、模型调用入口或 queue lifecycle。运行期缓存缺少持久绑定与托管能力，当前不能合法支持 shape 重启重试，明确保持 fail-closed。

**Data / Authority:** JobStore 保存的冻结模板、preset、素材快照和完成 artifact 是可追溯数据；shape JSON 保持 `NOT_EVALUATED`，不能签发、恢复或迁移 opaque handle。序列化 handle、旧进程对象、字段齐全的 JSON PASS、已存在样片或输出文件均不构成新发布许可。准入 module 重新加载后必须拒绝旧 handle，不能只靠恢复 queue 实例验证进程边界。

**Recovery / Crash:** 原 `ExportQueue.recover/hydrate` 只加载状态，将未完成的 queued/执行中任务记为 interrupted，不自动 start、复核或模型调用。已持久 completed 的 shape artifact 可以保留读取，即使运行期 PNG/样片已清理，也不重新渲染。未持久 completed 的任务即使正式路径存在文件也保持 interrupted，不凭文件名或内容猜完成；显式原 retry 继续拒绝 shape，不能重新编码、重选或借旧样片 PASS。已有正式文件不得被删除或覆盖；本切片不自动认领发布与 completed 保存之间的未知结果。

**Future Support Boundary:** 若将来支持显式重试，必须先有受主进程托管、版本化且有大小/路径边界的完整 request、原候选/最终 PNG/真实样片字节及来源/输出绑定；只有源知识或模板 JSON 不够。还必须明确定义精确项目/版本授权、已发布与未知结果的幂等核查、原队列发布原子性、取消、丢失/损坏和清理责任。旧 PASS 仍不恢复 authority；重启后只接受用户明确动作启动 fresh 独立样片准入，不能自动调用模型；新样片只能获得自己字节的 fresh PASS。该能力未在本切片实现或开启，不改变历史矩形重试合同。

**Acceptance / Verification:** 增加真实 FFmpeg 准入结果的 JSON replay 和 fresh-module 拒绝；完成文件经 JobStore 恢复、清理运行期缓存后保留读取，retry 不执行；分别投影 validating/running/verifying 三个持久状态后恢复为 interrupted，显式 retry 失败且旧正式文件保留、无新增输出/FFmpeg/复核调用。持久状态投影不是实际 kill/fsync 或 Windows 掉电测试。执行 typecheck、shape/queue/store/migration/preview 相关测试、有限并发全套及官方只读 Verify/Check/Guide；无受管源码变化不调用 Maintain。记录到 `docs/shape-matched-cover-m4b4-recovery.md`，检查 final diff 并仅提交本切片路径。

# Active Slice — M4-B5 Artifact Custody and Publication Barrier

**Goal / Entry:** 用户在 recovery 检查点后确认继续。建立显式进程内产物托管及一次性发布屏障，仍属 M4；不激活 Controller/IPC/UI，不支持自动恢复模型或普通 shape retry。新 `shape-cover-artifacts.ts` 独占只读快照/屏障，`shape-cover-artifact-io.ts` 提供有界私有文件操作；原 queue 仍唯一拥有任务状态、渲染与正式发布。将 `shape-cover-candidates.ts` 现有 request Schema 导出供快照复用；`shape-cover-admission.ts` 增加可选完整 request 绑定核对，保持原队列调用合同，不复制 mask/几何/准入合同。

**Snapshot Contract:** store 由主进程固定 root/projectId，键为 runId/mediaId/version。保存完整 request、原模板/preset/素材身份、输出目录及全部候选、模板贴纸、批准样片的原字节；源视频和知识库继续由原身份/修订 owner 管理，不复制源视频或凭据。保存前后必须核验当前 M4-B3 handle，逐文件核对 fingerprint。manifest 版本固定1，`authority=none`；最多1MiB metadata、1024个资源、单资产沿现行形状冻结字节上限、单样片1GiB、总量2GiB。有界流式复制与SHA、取消、NOFOLLOW/真实目录检查，无覆盖独占写入、文件和目录sync；不忽略持久化失败，不自动从旧副本恢复或修复损坏快照。加载只读取托管的规范文件名，核对全部字节，返回重定位的模板/request和样片路径，但绝不返回 handle 或可执行 PASS。

**Publication / Idempotence:** 原始模板绑定及样片字节由 snapshot digest 固定；同键不同内容拒绝。同 store 调用按键串行，跨实例/进程由exclusive永久 intent屏障避免再次副作用。首次发布前必须有效 handle、当前源/候选/冻结绑定及所有快照字节；intent文件和目录sync成功后仅调用一次原 `publishApprovedSample`，不重新编码。返回结果只在JobStore已completed且project/media/template/preset/output及正式文件SHA均匹配后保存exclusive receipt；重复同键返回原队列身份和文件，不重复任务/上传通知。屏障存在但receipt丢失、写入失败或正式结果未知时保持UNSAFE，不自动认领、删除文件或重新调用队列；此选择宁可阻断，也不建立第二套任务恢复状态机。

`publish` 重复调用仍须有效进程内 handle 与原始输入绑定；缓存清理或重启后的结果核对仅调用只读 `completed`，不会转为恢复发布许可。

**Compatibility / Boundaries:** 新 owner 不接入启动恢复、不恢复旧 PASS、不新增模型选择器/队列。正常旧矩形/manual/assisted 路径不变。快照的重定位模板只可供后续显式 fresh 准入，不能配旧 handle；本切片仍不实现该后续入口或 Windows 持久发布验收。未完成 intent 不自动清理；普通失败且尚未开始发布的本次独占快照可以清理。存在正式 manifest 的快照不被取消删除；再次请求时既有快照缺 intent 一律拒绝，不能判断为尚未发布后重新生成屏障。托管目录没有自动清理或迁移入口；整个项目托管根被外部删除/回滚的灾难恢复不在本切片支持范围，不能据空目录自动恢复旧请求。

**Verification / Record:** 真实 admitted-mask/FFmpeg/模拟独立reviewer验证托管字节、缓存清理后重开只读、JSON无authority、同键并发只发布一次、跨store重复已完成结果；篡改/丢失资源、路径穿越/符号链接、未知版本/伪PASS、不同键绑定、取消、队列失败和receipt丢失/损坏必须拒绝且不重复发布。执行typecheck、相关shape/queue/store测试、有限并发全套与官方AOCI完整增量维护及Verify/Check/Guide；记录 `docs/shape-matched-cover-m4b5.md`，仅提交本切片owners、测试和官方维护文件，保留其他dirty工作。

# Active Slice — M4-B6 Production Seam Wiring

**Goal / Owners:** 从 `eff644a` 将现有进程内 `startShapeMatched` 的发布接到 B5 owner。`ShapeCoverProduction.publish` 只将私有完整 request、当前模板/样片/handle、实际 run/media/version 交给 ArtifactStore；runner 的 shape 分支调用该方法，退出通用 publishApproved 回调。Controller 组装固定项目、输出目录及原 onTaskCreated 回调；queue 只提供基于其 canonical JobStore 目录的 store factory，不复制任何准入、SHA、intent、幂等或 completed 逻辑。B5 owner、renderer、store 格式不重新设计。

**Authority / Reentry:** 逐版本仍先 fresh admission；同进程相同输入重入由 B5 判断 completed/unknown/首次发布。未知结果不 catch 后重发、不删 intent、不重新准入以恢复同键许可。缓存清理后只读 completed；重启不恢复 handle 或自动调用模型。新的 Controller.start 生成新 run，不能将它当作同键重试。project 来自当前主进程项目，run/version 来自 runner，原选款、源和输出绑定仍由现有 admission/ArtifactStore 核查。

**Compatibility / Verification:** 非 shape 的 publishApproved、manual/assisted/旧冻结与历史 retry 保持原路径。上传 task-created 回调只在 owner 首次调用原 queue 时转发，重复与 unknown 不再注册。以真实 FFmpeg 和模拟独立服务验证 Controller→runner→custody→queue→completed receipt，逐版本 manifest/字节、同键重入、unknown 窗口、绑定漂移和取消；保留既有拒绝/兼容测试。运行 typecheck、相关集成及有限四路全套，官方完整增量维护与 Verify/Check/Guide；记录 `docs/shape-matched-cover-m4b6.md`，只提交本任务 hunks。

**Boundaries / Ownership:** 用户明确选 A 授权 Parent 串行修改 controller/runner；预先存在的 usesModel hunks 保留且排除提交。其余 dirty 文件和两个用户删除不接管。无 UI/IPC、M5、重启重试/authority recovery、moving mask、delogo、真实产品 Agent、付费模型、Kimi、掉电或 Windows 验收。

# Active Slice — M4-B7 Restart Read-Only Reconciliation

**Goal / Owners:** 在 ArtifactStore 增加显式 `reconcile(key)`，仅观察 durable intent、完整托管快照、canonical JobStore primary 与正式输出字节。JobStore 提供有界 primary-only 只读读取/枚举；不得调用会迁移、恢复备份、隔离损坏或创建目录的 load/loadAll/recover/hydrate。Controller/runner、启动、IPC/UI 不接线，不改变 B5/B6 发布状态机。

**Proof / States:** 无 intent 返回 NO_INTENT，但不授予新许可。有效 intent 进入只读核对；receipt 存在时须有效且绑定一致，不能绕过损坏 receipt。缺 receipt 时仅从 canonical primary 唯一匹配的原 batch/task 核对：project、run/media/version、完整冻结模板（含源修订/候选/输出绑定）、preset、素材快照、输出目录、完成 metadata 和正式 SHA/大小。此发现路径要求 shape 层明确携带原 run/version selection；历史快照缺该绑定保持 UNKNOWN。零匹配、多匹配、损坏/未知版本、未完成、失配、丢失或路径别名均 UNKNOWN；不凭存在正式文件推断完成。COMPLETED_VERIFIED 只返回原 canonical identity/path，始终 authority=none。INTENT_DURABLE 是核对前提，不代表“尚未发布”。

**Read-Only / Compatibility:** 不写 receipt/intent/manifest/JobStore，不删除或修复任何文件，不构造 handle，不调用 publish、FFmpeg、reviewer 或模型。缺 receipt 的只读 completed observation 不改变旧 publish/completed 的拒绝合同；即使观察成功，同键发布仍被永久 barrier 阻断。只证明既有 completed 的历史绑定与当前正式字节，不签发当前源/候选的 fresh admission；原缓存清理不影响完整 custody 的核对。所有非 shape、历史 retry 和 renderer 语义保留。

**Verification / Record:** 真实 FFmpeg + 模拟独立 reviewer 产生既有发布事实，测试重开与独立 Node 进程的只读核对、返回丢失窗口、缺/坏 receipt、未完成及重复 canonical 匹配、绑定/字节漂移、backup-only/损坏 primary、NO_INTENT 和只读文件不变；验证无再次 queue/模型调用。运行 typecheck、相关 shape/store/queue 集成、有限四路全套、官方 AOCI Guide 增量维护及 Verify/Check/Guide；记录 `docs/shape-matched-cover-m4b7.md` 并仅提交本任务路径。保留无关 dirty 与用户删除，不进入 M5，不支持 restart authority/retry、真实 reviewer/人工全片/Windows/掉电验收。

# Active Slice — M5-A Frozen Layer Renderer Switch

**Goal / Source Correction:** 从已提交 B7 检查点继续。源码已有 `shape-matched-frozen-rgba-v1` 分支：compiler 校验最终 PNG 后复制任务输入并直接全画布 overlay；白色矩形只在非 shape 分支。批准样片由同一个 compiler/queue 生成，B5 托管 PNG 和样片后直接发布原样片。保留该顺序和同字节合同，不新增“准入后再次编码”的正式 renderer 或渲染前 B5 authority。

**Owners / Contract:** `shape-cover-render.ts` 复用 B5 `inspectArtifactFile`，只验证绑定、普通非 symlink 文件、有界读取、读取稳定性、PNG SHA 与尺寸，返回冻结字节；不读取候选 alpha、不重算 contour/coverage。现有 strategy、bindingSha256、template snapshot 和 artifact key/request digest 是唯一身份链，不增加 renderer identity 或迁移格式。缺失、损坏、未知版本、源/输出/模板失配拒绝，无白底或 regenerate fallback。

**Acceptance / Evidence:** `tests/shape-cover-candidates.test.ts` 使用已有真实 admitted-mask fixture、真实 FFmpeg 和明确模拟的独立 reviewer，将 FFmpeg 启动时实际输入文件 SHA、compiler Buffer SHA、冻结 pngSha256、B5 archived layer SHA、reviewed shape identity、canonical template 与最终样片 SHA 连成一项端到端证据；配对像素证明 contour 外透明区保留背景。补 symlink、文件变化、缺失及设置/绑定失配负例。旧 manual/assisted/历史矩形、普通队列、UNKNOWN→authority=none 和 never republish 不变。

**Verification / Boundaries:** red→green targeted tests，typecheck、相关 compiler/shape/legacy/queue/store tests、四路全套及 final diff。按官方 AOCI Guide 维护本轮受管 owner；若完整批次涉及其他进行中源码，报告并保持 ownership gate。记录到 `docs/shape-matched-cover-m5a.md`。不接 IPC/UI，不启用默认自动覆盖，不做 contour redesign、全片 mask、产品模型调用、重启 retry、真实内容安全/人工全片/Windows/掉电验收。只提交本轮文件，保留已有 dirty 工作。

# Proposed Slice — M5-B Product Activation Boundary

2026-09-28 用户要求继续查看 M5-B；原 Plan 尚无该子阶段定义。本次完成源码调查并具体化 [M5-B boundary](shape-matched-cover-m5b.md)，使用 `superpowers:writing-plans` 补入既有 owner。当前为 `BOUNDARY_PROPOSED / PRODUCT_DISABLED`，不把下列目标当作已实现；M5-A candidate `746bb51` 与 NVENC 收口 `a44524b` 保持冻结。

**Goal / Current Behavior:** 正常 `agent.start` 仍调用 `AgentController.start` 的旧路径；`startShapeMatched` 只有显式主进程 M4 接缝。界定新的产品请求何时可以尝试 shape，拒绝越界 intent，正式发布继续依赖全部 M4 admission，不改变 renderer。没有 shape intent 的请求继续原行为；明确 shape intent 的失败为 BLOCKED/UNSAFE，不回退矩形。

**Contract / Owners:** `shared/agent.ts` owner 增加可选版本 intent `coverStrategy: "shape-matched-static-v1"`，缺字段历史请求继续旧解释，未知版本 strict reject。新 `shape-cover-activation.ts` 只负责 attempt routing/rejection；主进程 availability 默认关闭，caller/项目 JSON/模型不能开启或填 PASS。`AgentController.start` 在外部请求前调用该 gate。可信完整 request 的准备属于主进程，仍消费当前项目、canonical source revision、合法本地候选、preset 和有 owner 的显式 placement；缺 assembler/完整源 horizon 证明就阻断，不能接收 IPC 提供的 mask/asset path/authority。source、共同候选、freeze、样片、独立安全、custody、publish-once 继续现有 M4 owners。

**Eligibility / Compatibility:** 只允许新的显式自动覆盖尝试，当前限定 rotation=0、MP4；覆盖关闭/manual/assisted/refresh/不支持的格式与版本拒绝 shape intent。千川上传及 local-random 自动覆盖组合不在首个受控激活范围。无 intent 时这些现有模式保持原合同。旧 frozen template、retry、append 与重启不可根据 availability 迁移或恢复 shape authority；B7 read-only/UNKNOWN/never republish 不变。保存 intent 只是 fresh request 的选择，不是可恢复许可。

**Release Boundary:** M4 prepare 只核对当前 revision 已记录的全部 segments，source-mask-only 只证明核查 range，不证明全片目标穷尽。真实整片制作须由 canonical 源事实覆盖整个 horizon，包括明确无贴纸的时段；本切片不改 source admission、自动生成 mask/placement 或扩张 contour 来填补缺口。Plan M5 的真实留出集、独立语义检查、配对查看和长片成本证据仍未验收，产品 availability 保持关闭。入口 guard 的单元/集成 PASS 不允许宣布 default-on 或 V1 上线。

**Acceptance / Verification:** 新 `tests/shape-cover-activation.test.ts` 覆盖 legacy 路由、主进程关闭/caller 伪造开启、未知版本、非法模式/格式/组合、缺可信 request、部分 horizon、绑定变化及取消。controller 拒绝须证明模型/上传/发布调用为 0；受控 M4 fixture 仍走原安全准入和同字节发布，不能伪造全片产品正例。保留历史矩形兼容及 shape restart 无 authority。实施后 typecheck、相关 activation/agent/controller/shape/queue/store 与实际接线集成；纯文档本次只验证链接、合同、source identity 和 diff，不制造媒体验收。

**Ownership / Stop Condition:** 本次只写 Plan 与 M5-B milestone，Self-Review 已区分入口尝试和发布 authority、缺 intent 的 legacy 与明确 intent 的 UNSAFE、局部与全片证明。controller/shared 等当前有无关 dirty 工作，按 Working-Tree Safety 在同文件写入前请求用户明确 ownership/执行顺序；未决定前不实施源码接线。所有后续变更保留 M5-A renderer，既有 M4 publish-once 与旧任务规则。

## Active Implementation — Default-Closed Entry Guard

用户选择 A，批准上述边界并授权 Parent 串行修改 `src/main/agent-controller.ts` 与 `src/shared/agent.ts`，保留且排除提交原 usesModel 改动。使用 `superpowers:writing-plans` 将本次可完成实现固定为默认关闭的入口 guard；其余激活条件仍是后续工作的约束，不在本次添加可用产品正例。

**Single Owner / Files:** 新 `src/main/shape-cover-activation.ts` 只处理产品 intent 的模式/版本/格式/组合拒绝与关闭状态。`shared/agent.ts` 新增 optional literal intent；`AgentController.startInternal` 在 schema parse 后、任何 upload preflight/模型/素材准备前调用 guard。新 `tests/shape-cover-activation.test.ts` 验证实际 controller 拒绝及零外部调用。M4 无 intent 的显式接缝保持原解释，renderer/runner/queue/admission 不改。

**Concrete Closed State:** 当前没有可信产品 request assembler 和全片源事实证明，guard 最后无条件报告产品未启用及该缺口。暂不添加可置 true 的启动依赖、env/config 开关或 readiness boolean；这是目标 availability 的当前固定关闭实现，避免先提供可绕过真实缺口的 enable surface。新 intent 在全部 controller 入口都被 guard 约束；无 intent 返回原流程。未知版本 strict reject，调用者不能传 enabled/PASS/paths 绕过。未来添加启用依赖仍须按 M5-B/M5 的完整条件另行接线验收。

**Verification / Evidence:** 新 schema 和真实 controller 入口测试先 red 后 green；覆盖默认关闭、非法组合、未知字段、缺价格、assisted/显式接缝防绕过、无 intent 的旧准入及拒绝后 idle/cancel。运行 `npm run typecheck`、activation/agent/controller/provider/price 与现有 shape/compiler/queue/store 集成。稳定候选按 Risk Gate 判断，保留 M5-A 文件 SHA。AOCI 官方维护须先解决其两个已 dirty 索引文件的 ownership；只提交本轮 hunks，不接管其他工作。完整产品 activation 正例、全片/真实语义/Windows 验收不在本次完成声明内。

**Verified Checkpoint:** 默认关闭 guard 已实施；typecheck PASS，相关14 files /334 tests PASS（含新增28 tests），M5-A frozen SHA 未变。用户确认原 AOCI owner 完成后已串行维护本轮3项完整批次，Verify/Check/Guide aligned。状态 `ENTRY_GUARD_VERIFIED / PRODUCT_DISABLED`；这是入口拒绝切片，M5-B 真正产品激活仍需可信 assembler、全片 source horizon 与 M5 真实媒体验收。证据及 review risk 裁决见 [M5-B record](shape-matched-cover-m5b.md#default-closed-guard-evidence)。

# Active Slice — M5-C Trusted Request Assembler Boundary

**Goal / Sequence:** 按用户要求固定 `C → D → E → Activation`，M5-B guard 保持锁定。本轮实施 [M5-C contract](shape-matched-cover-m5c.md) 的 canonical source 收集及默认拒绝切片；不是完整 request issuer 的上线验收。完整 C 的签发支路依赖 D 与可信 placement，当前不得制造正例。

**Owner / Files:** 新 `src/main/shape-cover-request-assembler.ts` 独占产品准备边界，参数只接 strict AgentStart intent，dependencies 使用主进程 ApplicationService/knowledge store/FFmpeg。复用已有 sourceIdentity、readHead、readAdmittedShapeCoverTarget，输出设置用现有 preset owner 规范化。新 `tests/shape-cover-request-assembler.test.ts` 覆盖拒绝和实际 canonical source fixture。本轮不修改已有 dirty controller/runner/shared，不接产品 entry、不改 M4 fixture seam。

**Contract / No Issuance:** 所有选中素材须属于当前项目且 probe ready，逐个验证精确源、当前 reviewed mask revision 和全部已记录 segments；检查本身不证明全片 completeness。assembler 缺 D 直接 UNSAFE，返回 Promise<never>，不泄露 partial request，不添加 fake issuer、complete callback 或 bbox placement。M4 继续独占共同候选、coverage/freeze、样片独立 content-safety 和发布 handle；assembler 不提前填 PASS。

**Remaining C/D/E:** 完整 C 需 trusted placement、D 的全片源事实 authority 与不可伪造、不可变、重新核验绑定的 prepared request consumer。D 在已有 source-fact owner 证明完整 horizon 分区/穷尽目标/全部 admitted masks/无 unverifiedIntervals，不能升级短 segment 或 sampled ABSENT。E 验证真实批量遮盖、语义、切镜、规格、性能、Windows 与 CPU-only。各门分别验收；三者未满足不改 M5-B。

**Verification / Stop:** red→green assembler negatives，npm run typecheck、assembler/activation/source-mask/shape/controller 回归、Parent diff/Risk Gate、官方 AOCI 完整增量维护；仅提交当前任务文件，保留其他 staged/dirty。本轮可收口的是 fail-closed preparation boundary；真实 immutable production request 签发与产品激活仍 blocked。使用 milestone 记录维护 session evidence，不另建生命周期 owner。

**Boundary Checkpoint:** 本轮新增 assembler 20 tests、相关5 files /164 tests 与 typecheck PASS，最后入口55 tests fresh重跑；AOCI 1项完整批次与 Verify/Check/Guide aligned。状态 `PREPARATION_BOUNDARY_VERIFIED / REQUEST_ISSUANCE_BLOCKED / PRODUCT_DISABLED`，完整 C 尚未完成。证据、冻结 SHA、Risk Gate、Kimi 无有效终态与索引提交依赖见 [M5-C record](shape-matched-cover-m5c.md#verified-boundary-checkpoint)。

# Active Slice — M5-D Full-Source-Fact Proof Definition

**Goal / Scope:** 定义并验证 verified-no-sticker interval 与 exhaustive target set 的证明义务。区分全量解码帧清单、集合/时间分区一致性、可信语义审阅和最终 admission；结构完整不能签发语义 PASS。本切片只写 [M5-D contract](shape-matched-cover-m5d.md)、test-only 合同原型与真实 FFmpeg 合成反例，不创建 production proof issuer 或新的知识持久化 owner。

**Files / Owners:** `docs/shape-matched-cover-m5d.md` 保存 D 合同和本轮证据；`tests/helpers/full-source-fact-contract.ts` 仅检查测试候选与独立帧清单的一致性；`tests/source-fact-completeness.test.ts` 验证首尾/中间缺口、PTS/源/修订/原图绑定、同时与重现目标、伪造空集合及一帧闪现。原型所有结果固定 `authority=none / eligible=false / semanticReview=NOT_EVALUATED`，不被 src import，不替代 source-fact owner。

**Proof Contract:** 完整解码 horizon 使用连续 ordinal 和原 PTS/duration 的半开帧区间，拒绝缺失/丢弃帧、时钟缺口和未知尾帧；逐帧完整目标集合与全局目录/segment 必须精确相等。无贴纸时段要求全部原画布帧的可信完整空集合审阅，不能升级抽样 ABSENT、缩略图、局部 ROI、mask range 或 manual no-cover。未审阅帧由 owner 计算 complement，caller 不可填写空 unverifiedIntervals。语义信任、mask admission、freshness/dispute 与持久化 proof 仍须由原知识 owner 建立，raw JSON 不获得 D authority。

**Acceptance / Verification:** 用明确真值的 CPU lossless 合成短片证明端点抽样会漏掉中部单帧及同时目标；全解码只证明帧枚举，不能自动知道旧贴纸语义。运行 prototype tests、既有 source knowledge/store 与 C/B 入口回归、typecheck；核对 M5-A renderer、M5-C assembler、M5-B guard 未变，检查引用及最终 diff。保持所有无关 dirty/staged，测试/文档不触发受管理 src 索引维护。本轮状态最多为 `CONTRACT_VALIDATED / SEMANTIC_AUTHORITY_BLOCKED / PRODUCT_DISABLED`；C 成功 issuer、D 完整 admission、E 和 Activation 另行验收。

**Definition Checkpoint:** 原型与反例41 tests、相关6 files /151 tests 及 typecheck PASS。full decode + 两侧集合同时漏目标的反例证明语义 authority 不能由 schema/hash 签发；所有 prototype 结果仍 eligible=false。冻结 C/B/A/M4 SHA 未变，证据和受限环境能力见 [M5-D record](shape-matched-cover-m5d.md#verified-definition-checkpoint)。下一步须先建立已有 source-fact owner 的合格 full-canvas review 与版本化全目标 mask proof，不给 C 增加成功 issuer，也不打开 B。

## Next Stages — Git Checkpoint Before Production D1

用户明确要求留在 D，先独立提交本轮四个 contract/prototype 路径，再实施 production D1，禁止混成一个 commit。只读 mount 核查已确认 `.git` 独立挂载 ro、repository 和底层 ext4 rw、无 index.lock；当前执行环境的授权写能力未恢复，Git gate 为 blocked，不尝试删除 lock、chmod、remount 或旁路。诊断见 [Git mount record](shape-matched-cover-m5d.md#git-mount-diagnosis-and-next-gate)。

| Stage | Contract and owner boundary | Acceptance and stop condition |
| --- | --- | --- |
| D1 Production Full-Decode Census | 已有 source-fact domain 内独占 census；复用 SourceIdentity 校验。从原视频完整解码所有 full-canvas bytes，保留每帧 ordinal/原 PTS/可信 endPTS/SHA，形成绑定 interpretation 的完整 digest。源身份前后重核；不抽样、缩放、丢坏记录、猜 FPS/尾帧或推断语义。 | 可执行 full decode 正例和坏帧/缺口/重叠/未知尾帧/VFR/源漂移/取消拒绝；所有 census 输出仍 authority=none，不提前创建 FullSourceAdmissionHandle。先过 Git checkpoint 才实施。 |
| D2 Semantic Review Session + Acceptance | source-fact owner 绑定 census、原画布证据和合格审阅 session；逐帧完整 T(f) 或 UNKNOWN，不能只检查某目标或角落。 | 漏审阅/不完整集合/不确定事实保持 unverified；仅连续明确空集合形成可信 no-sticker interval；session/method 未 qualification 时不能接受语义完整性。 |
| D3 Multi-target / Multi-segment Mask Proof | 现有 knowledge/mask owners 接受同源、统一修订的全部目标/时域/mask 证据组合；不新建 parallel store，不升级旧 sampled/source-mask-only 为全片 PASS。 | 每个活动 segment 均有可信 mask；moving/animated/无法静态 mask/身份不确定目标不能从目录删除，其存在使 V1 eligibility UNSAFE。 |
| D4 Opaque FullSourceAdmissionHandle | 仅已有 source-fact owner 在 census、合格语义、全目标 mask、当前 source/revision/disputes 均通过后私有签发并消费 capability。 | caller JSON、复制对象、旧进程和 serialized PASS 不获 authority；消费时再验 freshness，恢复只读。全部门成立前保持 blocked。 |

D1→D2→D3→D4 后才回到 C 完成 request issuer；可信 placement、M5-E 和 Activation 不在当前切片。C 成功支路、M5-B guard 和 M5-A renderer 保持冻结。本阶段细化仅固定后续边界，不声称任何 production D 子阶段已经实现。

## Active Implementation — D1 Production Full-Decode Census

**Entry / Scope:** 用户要求 commit 后开始，原四路径已独立提交 `ab28ea2`（151 tests/typecheck fresh PASS），以实际成功的 Git operation 为写能力证据，不再用只读 findmnt 视图推断所有 Git operation 必然失败。D1 新建 canonical census owner，不进入 D2–D4、C、placement 或产品接线。

**Files / Single Owner:** 新 `src/main/source-fact-census-clock.ts` 严格核对全 probe 的每条记录、显示时钟和解释；新 `src/main/source-fact-census.ts` 复用 identifySource/sourceKey，进行前后 hash/stat 核验、CPU FFmpeg full-canvas RGBA 流式 SHA、exact ordinal binding 及 census digest。既有 `paths.ts` fingerprintFile 与 `source-sticker-knowledge-store.ts` identifySource 仅增加 optional AbortSignal/byte budget，保持原 SHA 与默认调用方式，避免另建 hash owner。`tests/source-fact-census.test.ts` 负责实际引擎与坏输入验证；`docs/shape-matched-cover-m5d1.md` 保存 evidence。test-only helper 不进入 production；旧 SupervisorEvidence 抽样路径保持原用途，不改写它为 census。

**Contract / Bounds:** 主进程 API 接受严格 SourceIdentity、可信 engine 路径、sourcePath 与 AbortSignal；没有 caller completeness/nominal FPS/mask/PASS 输入。首个 profile 限定 FFmpeg MOV-family demuxer 的 H.264、interpretationVersion=1、rotation=0、square pixels、progressive 8-bit SDR、原 dimensions 固定、无 decode crop 和非支持的 side data。使用 nofillin，要求每帧原 pts 与 best_effort_timestamp 相等，并与唯一原 packet 的 PTS、明确 duration、position/size 对应；B-frame 按 packet identity 绑定，不以 packet 枚举顺序代替显示顺序。stream start/duration 与全部半开帧区间精确相接，尾帧有显式 duration；任何缺字段/缺口/重叠/源漂移/失败/超额/取消均 UNSAFE。不采样、不 scale/select、不补帧；raw output 为 passthrough，每个 RGBA 字节都参与对应 ordinal SHA，帧数/字节数与 probe 一致。固定 quotas 保证 metadata、源文件、总解码 bytes、frame count 和 command wall 有界，超额不返回 partial census。

**Output / Compatibility:** 只返回 deeply frozen source/engine/clock/profile/frames 和完整 census digest，固定 authority=none /semanticReview=NOT_EVALUATED /eligible=false。不持久化知识、不返回 FullSourceAdmissionHandle、不签发无贴纸区间；D2 仍需要原画布可信语义审阅，D3 全目标 mask，D4 私有签发。既有 source hash、store proof、M4 renderer/admission/queue 与历史任务不改。

**Verification / Completion:** Clock negatives 先 red→green；真实 CPU lossless CFR/VFR/raw SHA 一致性、源前后验证/漂移/恢复同字节但 generation 改变、取消/坏引擎/缺失及字节短长拒绝；typecheck、D contract/C/B/knowledge/mask 相关 tests，Parent final diff/Risk Gate。CodeGraph/AOCI MCP 当前 requires approval（policy never），受管 Kimi doctor BLOCKED_CAPABILITY，不绕过；索引官方维护能力未恢复时明确列作剩余治理 blocker，源码 checkpoint 不混入其他任务索引。只提交 D1 owned paths，与 `ab28ea2` 分开。

**Candidate Checkpoint:** D1 新增64 tests，相关12 files /261 tests fresh PASS，scoped source/tests tsc PASS，source/engine/clock/bytes frozen census 已实施；固定 authority=none、eligible=false。最终全项目 typecheck 因其他任务 batch-production-runtime.ts 的类型错误 exit2；旧 shape fixture 的独立同步 raw→PNG 命令阻塞，shape 整体回归未通过；AOCI 官方维护仍被 runtime 拒绝。只保存 D1 独立候选，不宣称完整 gate 收口，不进入 D2/C 或 activation。细节、exact SHA、Risk Gate 和 session record 见 [D1 evidence](shape-matched-cover-m5d1.md#verification-and-governance)。
