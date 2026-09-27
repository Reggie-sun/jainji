# M5-C — Trusted Request Assembler

## Scope and Dependency Order

用户要求保持 M5-B guard 锁定，按 `M5-C Request Assembler → M5-D Full-Source-Fact Admission → M5-E Real-Media Product Acceptance → Activation` 推进。C 定义唯一产品 request 准备边界，D 才负责全片源事实证明，E 才负责真实产品验收。该顺序是 release dependencies；C 的成功签发支路依赖 D，不能在 D 前凭空建立产品正例。

本轮先实施 C 的拒绝与 canonical source 收集切片。`ShapeCoverRequestAssembler` 只接受 strict 用户制作 intent，项目、素材、source identity、revision 与 mask 从主进程 owner 读取；缺 D 或可信 placement 时不产生 request。当前 API 的返回类型为 `Promise<never>`，没有 PASS、prepared handle、序列化 request 或临时补全结果。完整 C 尚未完成，产品继续 `PRODUCT_DISABLED`。

## Current Source Evidence

CodeGraph 与源码核对：`AgentController.startShapeMatched` 只有 M4 测试 fixture 调用，接受 detached raw `ShapeCoverCandidateRequest`；正常 IPC 调用 `start`，strict schema 和 M5-B guard 先于外部调用拒绝产品 shape intent。M4 接缝不迁移，不能将它解释为产品 assembler 已接线。

`ShapeCoverProduction.prepare` 的 completeness 仅表示请求 segments 与当前 revision 的已记录集合相等。canonical store 的 `source-mask-only-v1` proof 限定一个 target/segment、一个 reviewed range、30–100 帧、无 exclusions；没有全片目标穷尽证明。`reviewedRanges` 覆盖整个视频、range 外无目标、source-mask PASS、样片时钟完整，均不能单独签发全片 eligibility。

已有 `CoverPlacementSession` 是近似渲染决定，不是冻结 shape placement authority；源 mask bbox 也不是新贴纸摆放。assembler 不从这些框推导 placement。可信 placement owner 与完整 request 签发接线是 C 剩余依赖，不在本轮生成算法。

## Intent and Authority Contract

产品 intent 复用 `AgentStartSchema` 与 literal `shape-matched-static-v1`，不增加第二套 UI schema。assembler 的 dependencies 是主进程持有的 ApplicationService、SourceStickerKnowledgeStore 与 FfmpegAdapter；调用参数不能提供 source、target/segment、revision、candidate、placement、output matrix、mask、completeness 或 content-safety PASS。已有输出偏好属于 intent，由主进程用既有 DEFAULT_PRESET/ExportPresetSchema 规范化，不能成为 caller 自行拼装的 matrix。

本轮 canonical source 收集复用 `SupervisorEvidence.sourceIdentity`、store.verifySource/readHead 与 `readAdmittedShapeCoverTarget`，不另建 hash/修订/掩膜验证算法，不调用模型、不写知识或队列。缺项目素材、未 ready、源变化、unsupported rotation、缺 reviewed mask revision、损坏 mask、取消均为 UNSAFE。每个选中素材均核对 canonical 当前 head；收集不产生执行或发布许可。缺 D 时仍固定 UNSAFE，不能因为局部 mask 全部合法而返回 request。

未来 D 成立后，唯一 issuer 必须输出不可变且运行期不可伪造的 prepared-request reference；consumer 只能从该 owner 解析，结构相似 JSON、复制对象、旧进程 handle 均不能借用。该 reference 只允许尝试 M4，不能签发发布 authority。尚无合法签发路径时不添加测试 issuer、注入 `complete=true` 的 callback 或 caller-controlled enable dependency。

content safety 不属于 assembler 提前收集的 PASS：assembler 只能固定“必须独立复核”的要求及绑定输入；真实样片生成后继续由 M4 admission 独占 review/PASS/opaque publication handle。coverage、contour、选款、freeze、custody、publish-once、UNKNOWN→authority=none 不变。

## M5-D Completeness Interface

D 应在 canonical source-fact owner 内证明每个精确 SourceIdentity 的完整 `[0,durationMs)` horizon，绑定 revision/factsDigest、全部 knownStickerTargets 和每段 admitted mask 及明确无旧贴纸时段。`coveredIntervals + unverifiedIntervals` 必须构成整个 horizon 的无重叠分区，且前者需要独立的可信证据，不能只是 mask reviewedRanges 的并集。只有 unverifiedIntervals 为空、目标集合穷尽、全部目标时段均可信且没有争议，才能签发全片 eligibility。零目标素材也需要无贴纸的全片证明。

该 contract 是 D 的验收方向，不在 C 创建新的 knowledge persistence、默认 completeness、全片自动识别或假 proof。边界/切镜/未知目标/动画/运动/不确定缺口继续 UNSAFE。源、解释、revision、目标集合、输出绑定或 placement 变化必须失效；未来签发前后及消费时都要复核，不能以仅不可变 JSON 代替 freshness。

## M5-E and Activation

E 独立验证真实批量视频的全程旧贴纸遮盖、人物/手/商品/字幕侵入、切镜、不同输出规格、批量耗时与内存；包含 Windows、CPU-only/无 NVIDIA 和明确失败场景。记录真实模型、技术像素验证与人工观看各自证据，不能由 unit tests、合成短片或 NVENC gate 代替。

C 的完整 issuer、D 的全片准入和 E 的产品验收全部成立后，才另行修改 M5-B 默认关闭策略。当前无 activation、UI 开关、IPC 接线、历史迁移或 renderer 变更。

## Verification and Remaining Work

本轮 test seam 验证 strict intent、防请求字段注入、canonical 媒体/源/head/mask 读取、部分与看似全时域的旧 proof 仍不能签发、取消，以及 M5-B/旧路径回归。测试不得伪造 D PASS；正例只属于既有 M4 接缝，不是完整产品 issuer。

受影响 verification 为 typecheck、assembler/activation/source-mask/shape candidates/controller；最终证据另行记录。C 剩余的 issuer/consumer、防 handle 伪造、可信 placement 与 D 接线尚未实现，不将默认拒绝测试报告为完整 assembler 验收。

## Verified Boundary Checkpoint

2026-09-28，新增 owner SHA=`9d0f0f1ce7384e90d572d98a58b413cfd65e9ed33468f4e58d790a8517b881bd`。`npm run typecheck` exit 0；相关5 files /164 tests PASS，0 failed /0 skipped；最后的 assembler/activation/controller 3 files /55 tests 在 TypeScript narrowing 修正后 fresh 重跑 PASS，其中新 assembler 20 tests。最初新增 suite 因缺模块而失败，不将该失败称为运行时 bug 复现。日志：`/tmp/jianji-m5c-typecheck.log`、`/tmp/jianji-m5c-related.log`、`/tmp/jianji-m5c-final-entry.log`。

综合回归期间唯一源码差异是 `unsafe` 从箭头声明改为等价函数声明，使 TypeScript 能收窄 input/store/head；该差异按原 SHA 重建核对，最终入口 tests 已重跑。其余 snapshot 源码/测试未变。真实 FFmpeg source-mask fixture 的 review receipt 为测试构造，M4 reviewer 为模拟服务；不是新的真实用户 mask 核查、独立模型验收或人工观看。

M5-A renderer SHA=`15e307dedb8698900a22d4b0db4ecfb7383a413bd4a7a08d074f4fdc35838da7`、原 shape fixture SHA=`997def30786e2c49a6568b198a2fc8ceb960dec58d65bd841ded4a88a07732f7`、M5-B guard SHA=`c9376550656efc78da113de420d8e76530c703fc40d15ef950777d87fe094cb6` 均未变。未修改产品 Controller/IPC、runner、M4 admission/production 或历史兼容。

Implementation Review Risk Gate：本稳定 SHA 为 `KIMI_REVIEW_NOT_REQUIRED`。没有用户要求该 snapshot 的独立 review，没有执行/发布 handle 或 durable write，当前函数不存在成功支路且未接产品入口，无法形成关键级越权或持久损坏路径。strict 参数、canonical 源读取和始终拒绝有直接测试证据，无需 adversarial reviewer 缩小的剩余签发缺口；真正 issuer 的未实现部分明确 blocked，不以拒绝测试代替其验收。

本轮按 global standing route 使用 [external-subagent](/home/reggie/.agents/skills/external-subagent/SKILL.md) 的 read-only deep explorer，范围为 store/candidates/admission 三个 clean owner；不委托实现或 Spec approval。Doctor containment PASS；qualification=`9c489879-bf37-4f39-9437-367f10b8ec68`，seal=`75acf9d4e970b63bfeae160a83d10ae71a06efc9b07be57ce21b7cae93735564`，invocation=`bd579381-6660-4bea-9c02-383670aa7517`。180s wall /120s idle /3 requests /4096 generation tokens /8MiB 预算，实际2次 wire requests、131s，receipt=`UPSTREAM_GENERATION_LIMIT`；三个 owner 的 native Read 均 complete，缺有效终态报告，不采用 partial output、不自动重试、不作为 required review PASS。

AOCI 官方完整批次 `bf1850b49a457302b6e4fae86a9b2b539050fc89bbdf49a34dceb5a18a5a3659` applied=1 /remaining=0；依次 Verify、Aggregate Check、Guide exit 0，structure_valid/governance_aligned=true，Check findings=[]，Guide complete=true /next_action=none，166 Code entries。不声称完整系统认知已验证。原任务已 staged 的索引版本尚未提交；本轮与 M5-B 的官方索引增量留在 unstaged，不能把原任务增量混入 scoped commit。

Self-Review 与 session-record 评估使用本 milestone owner：本轮状态为 `PREPARATION_BOUNDARY_VERIFIED / REQUEST_ISSUANCE_BLOCKED / PRODUCT_DISABLED`。C 的 request issuer/consumer、D 的 full-source admission、E 的真实媒体验收均没有被默认拒绝切片替代。下一步先稳定 D 与可信 placement 的 authority contract，再完成 C 的签发/消费验证；保持 guard 锁定。
