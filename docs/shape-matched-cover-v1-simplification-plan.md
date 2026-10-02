# Shape-Matched Cover V1 Simplification Implementation Plan

## Status and Goal

2026-10-02，`M2_BOUNDARY_COURSE_CORRECTION / DOCUMENTATION_ONLY / PRODUCT_DISABLED`。基于 [Delta Spec](shape-matched-cover-v1-simplification-spec.md) §6 与 [追加source audit](shape-matched-cover-v1-simplification-audit.md#m2-qualification-boundary-course-correction--2026-10-02) 的Parent Self-Review，使用`superpowers:writing-plans`更新原durable plan，Native Codex仍是primary。本轮只修订验收边界；不做新holdout triage、不执行后续slice、不进入M3。首次计划的M1-A已实现，M2-A/B/C/D及M2-E tooling事实见 [Stationary record](shape-matched-cover-stationary-record.md)。

目标：普通CPU上自动找到静态/固定位置旧贴纸候选，可靠覆盖非空确认目标集合，使用较自然的替换轮廓、实际预览与原FFmpeg队列导出。成功不声明未检出target不存在。新M0–M6替代旧D2Q→D3→D4→C发行主线，不改写旧records。

## Scope, Contracts and Invariants

Current：M1-A真实CPU自动发现成立；M2-A有3395px开发mask，M2-B重放133 RGB异常，M2-C完整范围geometry支持，M2-D独立pixel comparator和M2-E tooling存在。真实mask工程边界尚未验收，assembler/guard仍拒绝。已有canonical局部mask消费、共同候选像素门、actual placement previews、freeze、样片admission、custody和fixture生产接缝保留。

Target：自动候选发现与身份确认分离；原知识owner记录目标范围明确的mask proof；原assembler准备可信目标/placement请求，原production完整消费确认集合。每输出coverage100%、SAFE/NATURAL、冻结与批准样片发行仍各自成立。

Contract surfaces：SourceIdentity/revision、exact lossless帧/PTS evidence、candidate/provenance、static/union范围、confirmed集合、mask/admission/schema、candidate×target×preset矩阵、frozen RGBA/binding、视觉决定、private prepared request/admission、原Queue/ArtifactStore。

Invariants：不丢弃已确认失败目标；mask被覆盖不等于mask完整；coverage不等于visual safety；candidate/JSON/研究receipt无authority；源争议/freshness与publish-once未知不重试；renderer只消费冻结字节。

Compatibility：原音频/顺序/时长/补边/用户文字、manual/assisted/random、关闭覆盖和旧矩形/透明任务、冻结重试保持。新proof版本不迁移成旧成功，不沿用他段mask或其他输出PASS。

Out of Scope：moving target、delogo默认路径、AI inpainting、新素材/文字生成、全视频T(f)/EMPTY证明、D2Q或正式dual-AI资格、FullSourceAdmissionHandle；不重写Git history，不清理研究代码，不新建队列/lifecycle/issuer框架。

## Dependencies and Acceptance Boundaries

`M0 → M1 → M2 → M3 → M4 → M5 → M6`。M1/M2纯CPU不依赖真实语义模型或其账号目录恢复。允许M1先只产生可复算候选，不将它升级为mask proof。

固定动画作为独立支持单元：可以先只交付static，动画保持UNSAFE；不能用controlled动画fixture解锁真实动画。Agent选款/视觉复核沿现有允许连接，实际不可用时仅可使用已实现的本地选择/人类预览路线或拒绝，不mock成功、不扩模型。人类预览路线尚待实现，并非当前fallback。

Activation必须等前置真实验收且在后续明确实施范围内进入；本轮文档授权不自动授权M6。现有guard直到M6保持关闭。

## File Responsibilities

| Owner | Future bounded responsibility |
| --- | --- |
| `source-fact-census-clock.ts` / `source-fact-review-evidence.ts` / FFmpeg adapter | 增加原像素有界代表帧/ROI证据模式，严格source/PTS/ordinal/hash/取消；保留旧FullCanvas接口和语义，不复制全片spool。 |
| 已有 `shape-cover-stationary-discovery.ts` / `source-fact-discovery-evidence.ts` / 对应test | M1-A独立CPU发现及有界精确原帧已实现；继续保留无authority与身份歧义，不重做detector。 |
| `source-mask-static-target.ts` / `source-mask-static-extraction.ts` / 原qualification exports | 确认目标及全范围ROI、保守开发mask、受控truth比较已实现；后续在原owner收敛geometry与RGB异常职责及可消费proof，不静默撤销旧REJECTED。 |
| `shape-cover-stationary-envelope.ts` | 精确目标范围union；运动事实来自独立验证，不由caller anchor自行证明。 |
| 原 shared knowledge / mask admission / knowledge store | M2版本化目标范围proof、确认集合与争议/freshness；保留旧source-mask-only。 |
| 原 candidates / pixel-gate / alpha / freeze | M3复用实际alpha、共同集合、最小轮廓、每输出零漏与冻结。 |
| 原 placement proposal / request assembler / production | 可信目标摆放与准备，集合完整消费；M6才接产品入口，不开放raw fixture seam。 |
| 原 selection / admission / supervised preview | M4实际配对图片/动态样片、SAFE/NATURAL，人类quick-review可选适配与严格byte绑定；不建第二admission。 |
| 原 compiler / queue / artifacts | 冻结字节消费、批准样片发布和永久fence保持；只修真实跨平台缺口。 |
| 原 diagnostic script / Stationary record | 保存detector实际development、holdout、运行和失败证据；研究资格状态留在原AI/D2Q records，不维护第二份资格ledger。 |

未来实施前重新核对HEAD、dirty和精确writer ownership；只因同文件冲突才询问，不创建worktree。新detector职责建立模块边界，不继续扩张现有production/Controller。工具库不是第二source/admission owner。

## Milestones

### M0 — Freeze the Stable Renderer and Custody Foundation

已有实现的维护检查点，**不重新开发**。冻结source/mask→matrix→PNG→compiler/queue→admission/custody接口和golden fixtures，区分legacy与shape。source-only proof、final-pixel coverage、private sample admission职责不合并。

Acceptance：列出当前可复用owner和真实缺口；新detector不能改变原冻结/发布语义。必要后续代码变更运行相关shape/queue/compiler tests；本次docs只检查来源/引用，不重做全套渲染来制造进展。

### M1 — Real Stationary-Target Automatic Detector

优先CPU temporal persistence/variance、edge persistence、connected components、multi-frame consensus和静态屏幕坐标；不能只换uniform-exterior名称。已有Python probe只作开发先例，产品优先复用既有FFmpeg和streaming统计；引入OpenCV前明确许可、最小版本和两平台打包，不依赖用户全局Python安装。

bounded lossless discovery evidence包含精确源/帧时钟、最多96代表帧及方法版本。可低分辨率发现，但返回原像素映射并回原像素建立候选。至少处理全部候选component与多个target，不只“最大component”或先验四角；背景/字幕/商品印字/闪烁/运动/切镜为开发负例。identity不确定允许一次候选/粗ROI确认。

Acceptance：真实源无需用户描边能产生可复算候选和解释性拒绝；没找到只报告未确认，不能EMPTY。candidate固定无authority。记录分项时间、父/子RSS、scratch，保留错源/错帧/取消/超限拒绝。发现可能遗漏未确认对象不要求证明其不存在。

Verification：source/frame绑定、统计/组件/多目标/负例可执行tests，真实素材diagnostic与source hash；至少复现233s源已有temporal候选并说明ROI先验差异，不能以预填mask当自动成功。性能开发定标先于独立holdout，阈值选择不看holdout。

### M2 — Conservative Mask Qualification

候选确认后，原extractor与stationary-envelope建立保守oldStickerMask；对完整承诺目标时域流式原像素ROI核验，含首尾/闪烁/细尖/抗锯齿/透明边、切镜、遮挡和运动。static容忍编码噪声；fixed-animation独立核实anchor及union外扩，moving拒绝。

默认验收依 [Delta Spec §6](shape-matched-cover-v1-simplification-spec.md#default-m2-static-engineering-acceptance)：独立已知truth受控反例、真实完整目标范围geometry/可见性核查、原像素与candidate边界配对检查、冻结支持/拒绝包络。缺关键边界依据仍INCOMPLETE，不以geometry替代mask完整性；真实精确pixel指标没有truth时保持null。普通用户只确认target，不填T(f)或ROI逐像素labels。≥3独立真实来源的多样性下限在M5批量验收；never-exposed、双人blind truth为可选M2-E强声明条件，不是默认M2唯一门。

在原knowledge/schema/admission/store新增目标范围proof，涵盖身份确认来源、mask provenance、方法与temporal验证、revision/freshness。保留原single-segment proof解释与争议规则；`REAL_MEDIA`评估不能只删除现有拒绝分支。确认集合独立冻结，集合内失败阻断。

Acceptance：已知truth零漏反例及拒绝成立，真实保守边界与完整范围核查有可复核工程依据，支持包络与盲点明确；不签无truth的真实pixel零漏或全画布absence。新可消费proof需原knowledge/admission工程验证，不迁移旧receipt为PASS。固定动画失败可以只支持static。Verification运行受影响extractor/qualification/stationary/knowledge/admission tests及具名development验证；单尖角/尾帧扩大/移动误接受为必要负例。当前M2尚未完成这些验收，本轮不执行。

### M2-E — Optional High-Assurance Truth Acquisition

inventory/registry/blind editor/comparator工具保留。主动执行 [M2-E plan](shape-matched-cover-m2e-plan.md) 时维持其独立unseen来源、双人blind标注及QA、预冻结风险truth set、full-range geometry、no-adaptive-tuning和1px miss拒绝；只签ZERO_MISS_ON_FROZEN_TRUTH_SET，不推导6990帧pixel零漏。历史HOLDOUT_INSUFFICIENT与reviewers=0不改写，但不再是默认M2唯一blocker。详见 [Delta Spec的模式边界](shape-matched-cover-v1-simplification-spec.md#optional-m2-e-high-assurance-truth-qualification)。M2真实边界/proof仍未完成，所以当前M3仍BLOCKED；本轮还明确禁止进入M3。

### M3 — Shape Matching and Minimal Contour

复用原matrix、actual alpha与最小轮廓；为已确认目标在允许geometry内准备可信placement，原assembler绑定源/target/preset，不允许caller填安全PASS。先共同筛再选款；逐版复核实际冻结RGBA。

Acceptance：每确认target/segment×每output coverage100%，零漏像素；半径/面积/跨度限额经development冻结，留出不调参；无共同候选/超限UNSAFE，不矩形fallback。实际candidate bytes与所选ID绑定、每输出独立证明，旧1080p漏14px负例仍拒绝。

Verification：原pixel/alpha/candidates/freeze tests及真实720p、不同长宽比/帧率/用户输出设置；核对PNG往返、透明层、时域端点、变源变资产取消。仅扩大geometry才能通过的丑陋结果留M4拒绝。

### M4 — Real Placement Preview and Visual Safety

复用actual placement full/detail、原队列动态样片和原admission。样片覆盖全部确认目标的承诺范围，原图/成片配对；检查SAFE四类保护与NATURAL白边/比例/截断。人类快速决定如需实现必须绑定样片/层/设置/源摘要，过期/改稿失效，并在原admission内形成有效许可；不可把人工JSON verdict直接当capability。

自动review仅消费允许的实际可用连接；不要求A/B/joint完整语义资格。最多两次本地候选替换，重新freeze/render/check；服务错误不重试、不切连接，仍UNKNOWN即UNSAFE。快速观看不是保守mask核验。

Acceptance：真实样片SAFE和NATURAL，批准与最终同frozen layer、同sample bytes；脸/商品/重要字幕侵入、边缘截断、白色扩张丑陋、错样片/伪handle均拒绝。Verification为真实播放与绑定/失效/私有authority测试，模型、人工和fixture证据分列。

### M5 — Real-Media Batch Acceptance

每声明支持类别至少3个可核查独立真实电商来源、完整目标时域、多target、多输出与失败案例；静态背景/字幕/moving/遮挡/贴边/动画扩张不能藏在正例外。开发/回归来源与可选never-exposed holdout分列，同源/派生不计数，provenance未知不能硬凑三份。人工快速preview不替代§6的保守边界与全范围核查，也不补签pixeltruth。静态/固定动画各自标注可用或拒绝。

CPU-only Windows与Linux实测，无CUDA；记录discovery/decode/mask/matching/preview/export分项耗时、峰值父子RSS与scratch，同机软件encode基线。开发冻结预算后测试holdout，mask工作集初始目标512MiB；超限停止不能悄悄提升预算。编码需仍是主要耗时之一，否则报告瓶颈并修，不能仅给总耗时。

Acceptance：已知truth反例零漏，真实目标的保守mask工程依据与完整范围核查成立，各输出100%、实际视觉SAFE/NATURAL、原音频/时长、原queue并发、取消/unknown fence、重启只读与legacy不回归；Windows的文件/目录sync及发布操作实际成立。至少支持类别三个独立真实来源，不把文件/SHA数量当合格批次；不把缺真实truth的miss/excess填0。性能数值/硬件与未验收类别公开，不把Linux测试升级Windows验收。

Verification：真实批量FFmpeg、实机/安装包和播放检查；受影响integration/typecheck，相关范围fresh证据与适用implementation Review Risk Gate。失效目标/源变更/坏mask/共同池耗尽/视觉UNKNOWN/发布返回丢失均保持失败。

### M6 — Product Activation

后续单独进入。原assembler返回可信prepared request，原Controller正常intent路径消费它；UI提供候选确认/范围与未处理声明，零目标返回未确认，不给全片EMPTY。保留原private admission/ArtifactStore/Queue，shape不混入raw request IPC、自动上传/random组合或旧task重识别。

只有M1–M5的声明支持范围、真实CPU/Windows/visual/custody/legacy全部满足才改guard。未满足static-only或部分平台条件按声明拒绝。actual integrated interaction、安装和fresh行为验证后才称产品可用；此前PRODUCT_DISABLED。

不实现FullSourceAdmissionHandle、不等D2Q→D3→D4、不删除研究代码。新prepared request绑定明确确认集合即可，仍防伪造、漂移、漏消费和重启恢复假authority。

## Original Next Implementation Slice — M1-A (Historical)

**Goal：** bounded CPU discovery从真实原视频产生可检查的stationary候选；已由M1-A实现，原验收边界保留供追溯，不再作为当前next slice。

**Allowed surfaces：** 新detector/test；原evidence/clock/FFmpeg owner中独立bounded lossless discovery模式及其tests；原diagnostic脚本的开发编排；Stationary record与对应AOCI。具体文件在实施前以当前调用关系确定，不提前授权同文件foreign写入。

**Inputs / outputs：** canonical source identity与最多96精确代表帧；多候选原像素ROI、temporal/edge/component/coordinate信号、方法参数与证据摘要、confidence/UNKNOWN原因。输入不是逐帧语义声明或人画mask，输出不是knowledge revision/完整时域maskproof/安全发行handle。

**Boundaries：** 不改production、assembler、activation、Controller、compiler/queue或旧fullcanvas session合同；不跑真实LLM；不提前fixed-animation验收，不调holdout。取消/失配不得返回可消费成功候选。无target不是absence。

**Finite budgets：** 每源代表帧≤96、同时解码进程1、单次development运行≤5min、mask工作集目标≤512MiB；开发最多两次参数修订，每次保留失败后再冻结方法。超预算明确INCOMPLETE。已有真实例/已知负例属于development，holdout在M2独立准备。限额是未来实现约束，不是当前性能实测。

**Definition of done：** candidate从真实取帧统计生成、无预填mask/贴纸ID；多个component不静默丢失、稳定背景歧义明确；证据可重算且source/PTS/像素映射/取消拒绝有tests；真实来源、用时/RSS/scratch与失败公开，source原字节/所有产品guards不变；fresh typecheck/受影响tests、AOCI与最终diff完成。该checkpoint只能称detector development可用，不能称V1完成。

## Current Bounded Follow-up — M2 Engineering Boundary

**Goal / Scope：** 后续仅用已有development材料完成§6默认static mask工程验收；重用现有bound source/ROI/clock、M2-B异常及M2-C全范围geometry、M2-D受控truth反例和M2-E风险元数据。不新triage holdout，不描整ROI真人truth，不改3395px mask或阈值取得通过，不进入M3。普通边界复核可查看原像素和candidate配对证据，与可选blind truth协议分开。

**Owner / Contracts：** 原static extraction/target、geometry/qualification及knowledge/admission owners；本轮无代码修改。发现需要semantic算法/proof变更时先明确版本、旧拒绝兼容、支持包络和负例，再按后续任务授权实施，不能把本文当现行issuer。

**Acceptance / Verification：** 逐项说明真实边缘可辨贡献、有限余量、mask之外风险及旧133异常如何影响承诺；用受控truth说明检测灵敏度及不能处理类别；完整[0,6990)不缩短。按实际changed paths运行原tests/typecheck/Harness，真实pixel指标无分母仍null；工程评估有问题或关键证据不足仍INCOMPLETE。完成边界报告不等于source admission、输出或activation。

**Stop：** 本轮只落实审计/Spec/Plan适用关系，后续slice未执行；M2INCOMPLETE，M3BLOCKED，PRODUCT_DISABLED。

## Verification, History and Stop Contract

implementation遵循原AGENTS/SUBAGENTS：Native Codex控制，按规则受管delegation；project-native verification后在stable candidate判断风险review，不增加语义qualification链。每次behavior change提供可信可执行证据、fresh typecheck与affected tests，必要真实FFmpeg/实际UI，AOCI按本轮managed对象维护并区分foreign drift。

一个milestone/逻辑owner/verified checkpoint提交，specific git add，用户项目删除与host/CDP配置独立；不rewrite历史。研究records永不改成产品成功。阶段实证继续落原Stationary record，本次架构决策由audit保存。

本轮自然停止在可评审五份文档与限定commit；后续实现按授权推进至该slice完成或真实blocker。没有detector/mask/visual/实机证据就不启用guard，不以文档/test/commit代替产品交付。

## Self-Review

M0保留已完成基础；M1直接解决真实自动发现；M2保持确认目标的mask与完整时域责任；M3/M4分别保证输出像素与画面；M5检验真实产品成本与平台；M6最后接线。消除exhaustive语义主线而没有消除实际安全责任。唯一下一slice有限、CPU、无产品authority；其余milestones不作为本轮待执行清单。
