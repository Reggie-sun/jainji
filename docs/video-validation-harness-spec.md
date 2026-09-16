---
title: Lightweight Video Validation Harness
status: draft
execution: not executed
version: 0.1
date: 2026-09-17
baseline: 20c270f
---

# Summary

为简辑增加两个显式运行入口：代码修改后的核心回归验证，以及指定导出批次的实际成片验证。共用一份可执行 policy，每次运行保存独立 runs 证据。优先复用现有测试、共享 schema、FFmpeg 与 ffprobe，不新增生产任务生命周期。

本文件与[实施计划](video-validation-harness-plan.md)均为 `draft / not executed`。本轮仅编写文档；下文 MUST 是拟实施合同，不代表 harness 已实现、测试已运行或成片已验收。

# Evidence And Ownership

基线来自当前代码检查，而非历史方案的实现声明：

| Concern | Current owner and evidence | Proposed reuse |
| --- | --- | --- |
| 项目、批次、冻结模板与素材 | [domain.ts](../src/main/domain.ts) 的 ProjectSchema、ExportBatchSchema、QueueStateSchema | 读取和校验现有结构，不另建项目格式 |
| 输出尺寸 | [export-settings.ts](../src/shared/export-settings.ts) 的 outputDimensions | 计算预期尺寸，不复制分辨率映射 |
| 原文件身份 | [paths.ts](../src/main/paths.ts) 的 fingerprintFile | 复用流式 SHA-256 |
| 导出与文件验证 | [queue.ts](../src/main/queue.ts)、[artifact.ts](../src/main/artifact.ts) | 保留生产 owner；harness 只读检查，不改变 completed 状态 |
| 制作到成片 | [agent-pipeline.integration.test.ts](../tests/agent-pipeline.integration.test.ts) | 本地模拟服务、真实队列和 FFmpeg |
| 媒体规格与渲染 | [ffmpeg.integration.test.ts](../tests/ffmpeg.integration.test.ts)、[four-corner-render.integration.test.ts](../tests/four-corner-render.integration.test.ts) | 复用真实媒体验证 |
| 桌面交互 | [desktop-smoke.mjs](../scripts/desktop-smoke.mjs) | 继续作为按变更风险执行的独立检查，首版不包装所有 smoke |
| 半自动评估 | [assisted-cover-evaluate.mjs](../scripts/assisted-cover-evaluate.mjs) | 保留原评估职责，不复制其人工耗时与晋级判断 |

当前 ArtifactVerifier 检查文件非空、视频轨道及正时长，不比对源视频时长、冻结规格或音轨。已有集成测试能验证 fixture 行为，但不能代替某批用户成片的检查。本次发现尚无统一的 harness policy 和 runs 入口。

# Goals And Non-Goals

- G1：一条命令完成稳定的核心回归，并保留失败、跳过和执行范围。
- G2：依据明确选择的批次清单验证实际成片，不把目录中的旧文件或 partial 文件混入结果。
- G3：每个结果可追溯到代码、policy、输入、任务、冻结模板及实际文件。
- G4：报告区分技术通过、未验证和人工观看，避免把测试通过解释成视觉验收。

首版不包含：Web dashboard、数据库、插件/DAG 框架、自动修复/重试、按 Git 变更路径智能选测试、自动监听导出、接管生产 gate、模型视觉评分、OCR、付费请求、跨机器证据签名或自动发布。不上新依赖；不因开发 harness 启动用户应用或修改用户项目。

# Entry Points

拟提供以下 CLI，实际命名在实现时保持本文与 README 一致：

```text
npm run harness -- code
npm run harness -- media --project <project.json> --batch <id> [--batch <id> ...]
npm run harness -- media --queue <queue-state.json>
```

**REQ-01 — Explicit scope.** code 执行 policy 的固定核心集合；不宣称完整发布验收。media 仅接受一个项目文件加非空批次 ID 集合，或一个现有 QueueState 文件；两种输入互斥。未知 ID、重复 ID、零任务、格式不兼容必须明确失败。项目模式不得默认选择全部历史或“最近”批次。一次制作可能创建多个 ExportBatch，允许显式选择多个 ID，不假定一个 batch 等于整次制作。

**REQ-02 — Read only.** media 从文件读取一次后冻结所选批次，在 run 中保存必要快照。不使用会迁移或写回用户文件的 store load 路径；旧格式不兼容时报告错误。缺少 mediaSnapshots 时不得以当前 mediaItems 冒充冻结素材。不能入队、调用模型、修改模板、重新导出或改变原任务状态。

**REQ-03 — Outcome.** 单项状态为 PASS、FAIL、NOT_EVALUATED；不可用工具、超时、跳过、无测试、无可读报告、证据缺失和中断都不能记为 PASS。必需检查出现 FAIL 则总体 FAIL；否则存在必需 NOT_EVALUATED 则总体 NOT_EVALUATED；其余总体 PASS。退出码分别为 0、1、2（NOT_EVALUATED 或输入/运行错误）；报告保留错误类别。总体状态仅表示本次选定范围的自动检查，始终单列 visualReview=NOT_EVALUATED。

# Policy Contract

**REQ-04 — Single owner.** 拟使用 `.agent/harness/policy.json`，只保存 schemaVersion、命名检查集合、必需性、命令参数数组、超时及媒体容差；不支持 shell 字符串或动态表达式。runner 校验 policy，未知版本、无检查、重复 ID、非法参数和非有限/负容差均拒绝。运行固定于仓库根目录，通过无 shell 的子进程执行；跨平台使用 Node 入口或明确兼容的启动方式。

产品不变量仍归 AGENTS.md、共享 schema 与生产模块所有。policy 只负责“执行什么检查、怎样汇总证据”，不再复制文字长度、贴纸几何、覆盖开关等业务规则。

**REQ-05 — Code checks.** 固定核心集合包含 typecheck 和下列相关测试组；组名与文件路径在 policy 中唯一维护：

| Group | Initial test files | Proof boundary |
| --- | --- | --- |
| text-and-plan | product-price、price-only、agent-provider | 手动文字准入、内容绑定和模型方案拒绝 |
| lifecycle | agent-controller、agent-runner、queue | 准入、取消、失败及冻结重试 |
| cover-contracts | automatic-cover、cover-track-provider、four-corner-coverage、cover-review-approval | 覆盖识别约束、角落补齐及人工批准边界 |
| real-media | agent-pipeline.integration、ffmpeg.integration、four-corner-render.integration | 模拟模型服务与真实 FFmpeg；非商业模型验证 |

上述名称对应 `tests/<name>.test.ts`。新增 harness 自身测试也必须进入核心集合。实现前核对测试副作用；若发现真实外部服务调用则隔离 fixture，不能借核心检查授权账号使用。解析 Vitest 结构化报告，确认每个指定文件被发现且必需测试未跳过；进程退出 0 不足以认定 PASS。保留通过/失败/跳过数量与实际执行时长。为降低 CPU/GPU 干扰，首版顺序执行检查组并限制媒体测试并行度。

# Media Contract

**REQ-06 — Membership and identity.** 清单来自所选批次的 tasks，预期数量就是冻结清单数量；这不证明用户原先期望的制作数量已满足。检查 task.batchId、mediaId 与快照映射，拒绝重复 task ID、重复实际输出路径和清单歧义。每个任务必须 completed，outputArtifact 必须关联同一 task 和 outputPath。解析实际路径并检查输出位于批次目录内、不与任何源文件相同、不为 partial；缺文件、零字节或不可读均失败。源文件 SHA-256 必须匹配冻结 fingerprint；输出另算 SHA-256。缺失旧快照为 NOT_EVALUATED，不猜测补齐。

**REQ-07 — Technical checks.** 逐任务执行下列检查，复用现有 schema 与工具发现逻辑：

| Check | Expected evidence |
| --- | --- |
| 文件及解码 | ffprobe 可读，视频流存在；FFmpeg 完整解码音视频至 null，错误退出或超时不能通过 |
| 输出规格 | 使用 outputDimensions 得到尺寸；视频 codec、容器与冻结 preset 一致，容器别名按 ffprobe 实际语义判断，不能只看扩展名 |
| 时长 | 源探测与冻结 durationMs、成片与源时长均比较；初始容差 max(100 ms, 2 个有效帧周期)，预期值、观测值、容差全部入报告 |
| 帧率 | 固定 30 模式核对 30 fps；源模式对 CFR 核对有效帧率，容差初定 0.1%；无法可靠判定的 VFR/时间戳情况明确 NOT_EVALUATED，不以平均帧率证明逐帧保留 |
| 音轨 | 有源音轨必须有输出音轨，无源音轨不能凭空增加；核对预期 AAC 及有效音频时长，初始容差 100 ms；不声称波形或听感完全一致 |
| 模板文字 | 调用现有模板文字校验；记录为冻结方案验证，不声称已通过 OCR 证明成片文字 |

容差是初始待验证值，不是随失败自动放宽的开关。旋转素材使用与导入/编译一致的显示尺寸语义。不能可靠确定测量值时报告 NOT_EVALUATED，不能用 NaN、缺字段或零值绕过比较。源文件与输出在检查前后核对身份；检测到期间改变则本次证据无效，要求新 run。同一 run 内可复用同一未变化源文件的 hash/probe 以减少重复读取，不引入跨 run 缓存。

**REQ-08 — Visual evidence.** 为每条成片保存首部、中部、尾部对应的源片和成片缩略帧，记录实际采样时间与文件 hash。提供按 task ID 关联的 Markdown 索引，链接完整成片，提示检查文字、主体遮挡、原贴纸覆盖、时段变化及音画。抽帧失败单独报告，不将空证据当成功；抽帧仅用于人工定位，不能证明全时段无漏检或无裁剪。首版不实现人工批准写入接口，不把半自动预览的批准记录改称最终成片已观看。

# Runs Contract

**REQ-09 — Minimal artifacts.** 每次调用创建 `.agent/harness/runs/<UTC-time>-<random-id>/`，禁止复用覆盖。建议最小结构：

```text
receipt.json       # 状态、范围、身份、命令、观测值、证据引用
policy.json        # 本次实际使用的 policy 快照
inputs.json        # media 所选批次必要冻结数据；code 无此文件
summary.md         # 人可读结果与视觉复核索引
logs/              # 各检查 stdout/stderr 和测试结构化报告
frames/            # media 抽帧；code 无此目录
```

receipt 至少包含 schemaVersion、runId、mode、起止时间、最终状态、平台/Node/相关工具版本、Git HEAD、dirty 状态、受版本控制文件差异摘要 hash，以及影响本次执行的未跟踪源码文件 hash 清单。code 不因无关用户项目脏文件拒绝运行；执行前后源码身份变化则标记证据无效。工作区摘要是追溯信息，不宣称可重建全部环境。

media 另记录输入文件 hash、批次/task/attempt、冻结 template/preset 摘要、源/成片 SHA-256、各项预期与实际值、容差及证据路径。harness Git HEAD 仅表示验证器版本，不能冒充历史成片的生成代码版本。记录 hash 格式和序列化方式；绑定实际使用的字节或确定性对象序列化。

**REQ-10 — Failure and interruption.** 创建 run 后先写 RUNNING 回执，正常结束通过临时文件原子更新最终回执；正常捕获失败、中断、超时需保留已完成证据并停止本次子进程。无法捕获的崩溃遗留 RUNNING 永不视为通过。建目录/写报告失败必须非零退出并说明目标路径；不能打印虚假的已保存回执。运行目录是本地隐私产物，忽略入 Git；日志不记录凭据，输入快照不复制完整项目或连接配置。默认不上传、不自动清理、不另复制完整视频。

# Acceptance Criteria

| ID | Acceptance | Verification |
| --- | --- | --- |
| AC-01 | 两个入口共享 policy、独立生成 run | CLI fixture，重复调用不覆盖 |
| AC-02 | 跳过、空发现、异常报告或超时不能绿色通过 | runner 失败注入测试及退出码断言 |
| AC-03 | 核心回归实际跑完并留痕 | typecheck、policy 核心集合、结构化 receipt |
| AC-04 | media 精确绑定所选任务和冻结数据 | 多批次项目/queue fixture、未知 ID 与重复路径拒绝 |
| AC-05 | 能识别损坏、音轨丢失、规格错误、时长偏差、源变化 | 临时目录生成真实小视频，正例及破坏后反例 |
| AC-06 | 旋转/CFR 正确，VFR 和缺失快照不误报通过 | 定向 fixture，断言测量值和 NOT_EVALUATED |
| AC-07 | 证据可定位，视觉状态不冒充验收 | 缩略帧/索引与文件 hash 核对 |
| AC-08 | 不改变生产状态及用户文件 | 输入 hash 前后相同、无模型/网络调用、无入队；检查任务 diff |

# Delivery Boundary

实现完成报告必须区分 harness 自测、核心回归、合成视频验证和用户真实成片验证，列出实际 runs 路径与未执行项。Linux 通过不能代表 Windows 实机通过。首版不以性能承诺作为验收门槛，记录耗时后再决定是否有必要优化。

当前没有选择任何用户真实批次；后续实现可先用隔离 fixture 完成验证。实际成片验收须使用明确输入，不能自行扫描用户项目并据此宣布验收。
