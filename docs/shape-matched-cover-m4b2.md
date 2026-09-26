---
title: Shape-Matched Cover M4-B2 Frozen Pixels And Queue Preview
status: frozen-geometry-preview-implemented-production-admission-blocked
date: 2026-09-27
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope And Ownership

用户在 `5b95024` 的 [M4-B1](shape-matched-cover-m4b1.md) 检查点后授权继续。本轮从 clean checkout 使用原工作树，执行现有 plan 的 [M4-B2 slice](shape-matched-cover-plan.md#active-slice--m4-b2)：共同候选 → 实际 RGBA/有限轮廓 → 无损冻结 PNG → 原 compiler/queue preview。没有接 AgentRunner/Controller、UI 或生产选款，没有调用产品 Agent、付费模型或 Kimi review。

| Concern | Owner |
| --- | --- |
| 显式冻结策略与有界绑定 | [shape-cover.ts](../src/shared/shape-cover.ts) |
| 重新检查整轮、生成/验证/发布图层字节 | [shape-cover-freeze.ts](../src/main/shape-cover-freeze.ts) |
| 源修订复核、PNG 快照读取、正式输出阻断 | [shape-cover-render.ts](../src/main/shape-cover-render.ts) |
| 原模板 schema / 渲染 / 队列消费 | [domain.ts](../src/main/domain.ts)、[compiler.ts](../src/main/compiler.ts)、[queue.ts](../src/main/queue.ts) |

M3 像素算法、阈值和源知识 store 保留单一 owner；`readAdmittedShapeCoverTarget` 只是将 M4-B1 已有准入 seam 暴露给冻结和预览复核。真实 alpha 与 RGBA 共用媒体栅格路径，M4-B1 alpha-only 计算不会因此额外分配全画布 RGBA。

# Freeze And Consumption Contract

`freezeShapeCoverCandidate` 接收完整 M4-B1 request 和 selected candidate ID，重新计算完整矩阵，不接受调用者传入的旧 PASS 或伪造 verdict。只有共同集合中的一款能冻结。实际原资产字节和 alpha 必须匹配该矩阵；按 M3 已通过的半径生成不透明白色小幅轮廓，原图案按实际 alpha 合成其上，轮廓外保留真实透明/半透明像素。不是白底矩形、crop 或 bbox fallback。

每个 target/output 单元独立生成最终输出尺寸的 RGBA，编码无损 PNG，再真实解码，要求逐字节与原 RGBA 相等，且投影后的每个 oldMaskFinal 像素都被 alpha=255 覆盖。绑定包含 source identity/revision/facts/mask、candidate ID/原指纹、output settings/scale-pad/placement/range、像素合同/alpha 版本/半径，以及 PNG/RGBA/final-alpha/binding 摘要。绑定摘要检测元数据漂移，不冒充签名、内容安全批准或输出时序收据。

全部计算有效后，在本次独占 UUID 子目录以临时文件 + sync + 不替换已有文件的 hard link 发布 PNG；同一操作内相同内容可复用。发布前后重新核对全部源绑定和所选资产。变化或取消返回 `UNSAFE`，只清理本次实际创建的目录，保留其他 owner 文件；没有覆盖源视频、已有输出或其他操作目录。文件系统不支持所需发布操作时失败，不回退到替换文件。

冻结层使用全输出画布 PNG 和显式 `shape-matched-frozen-rgba-v1` 标记。schema 拒绝重新摆放、隐藏、改普通轨迹时段、白底开关、改贴纸 ID/图层指纹，以及将近似 placement/历史 sampled knowledge 混成源 mask 事实。compiler 核对源、设置、绑定摘要、PNG 摘要和尺寸，读取独立 Buffer 快照，交给原 queue 的任务 `binaryFiles`；FFmpeg 使用任务副本，不再打开可变原资产。该分支直接 `overlay=0:0`，不再 scale/crop/pad、重新舍入或联合价格渐隐。原候选文件删除后，已冻结图层仍可预览；冻结 PNG 损坏则明确失败。

原 `renderPreview` 须显式提供同一个 canonical `sourceKnowledgeStore`，在渲染前后复核 source head、mask 和 facts。缺 store、revision 变化、争议或证据失效均不返回有效样片；渲染中变化会删除该样片。现有 app 创建 queue 的路径尚未接该 dependency，因此不会意外启用新策略。非 shape 模板不需要新增依赖。

任务字节文件与原文字/graph 文件一起写入和清理；先等待全部写入结果再处理失败，避免尚未完成的写入跨过清理。成功、渲染失败、写入失败和取消的副本清理均有测试。正式导出代码沿同一 compiler/resource 路径准备消费这些字节，但本轮未运行成功的 shape 正式导出：`createBatch`（包括批准重放）、`publishApprovedSample` 和恢复重试的 `execute` 都在新策略上返回 `UNSAFE`。不存在可由调用者填写的 content-safety PASS 字段。

# Output Clock Regression Evidence

真实 128×128、24fps、3 秒 fixture 经 canonical source-mask admission，目标 required range 为 `[517,2034)`。原先只在输出参数使用 `-r 30`，overlay 仍按源 24fps 时钟先启停：720p/30fps 第 61 帧、PTS 约 2033.333ms 本应覆盖，却使用已停止覆盖的画面。最终输出 ROI 测试得到 red=173（要求覆盖区 red>180），单项测试 exit 1。这里的颜色断言是合成 fixture 的可执行检查，不能替代通用像素/内容安全判据。

新策略在 overlay **之前**用 `fps=30` 建立输出帧时钟；同一 source/placement/range fixture 单项转为 PASS。随后在 source 输出的 72 帧和 padded 720p/30fps 的 90 帧上，逐帧读取真实 PTS 与 RGB ROI，核对半开区间内全部保守 mask 区域被覆盖、区间外恢复原黑色贴纸。另一 fixture 验证 2px 非零半径、半透明边缘、PNG round-trip、透明画布外部和 `[0,2000)` 启停。历史渲染分支未改，不宣称其任意端点的帧率转换问题已被修复。

临时 RED/GREEN 日志为 `/tmp/jianji-m4b2-pts-{red,green}.log`；持久可重放机制在 [shape-cover-candidates.test.ts](../tests/shape-cover-candidates.test.ts)。测试中 contact sheet/人工 receipt 为合成准入 fixture，只验证机制；没有重造用户真实素材的人工 PASS。

# Fresh Verification

已读取并执行 `superpowers:verification-before-completion`。候选是上述 HEAD 加本轮限定 diff，核心快照如下；最终验证后没有语义代码变更。

| File | SHA-256 |
| --- | --- |
| `src/shared/shape-cover.ts` | `8e9c6ca92189a84dc76ee11d96566e0ac5151caf5cc410e91da29f1de71a7796` |
| `src/main/shape-cover-freeze.ts` | `83de760eaba0d2d1a207d564f6e47bd2c86c47d4487833238a99a314816713d4` |
| `src/main/shape-cover-render.ts` | `82d03b7ae19670e7bf15f499a8198a324fd4853215e635ec172988e698b7efc7` |
| `src/main/shape-cover-alpha.ts` | `b9f67869131d561ad3165482d56130feabceb643b6e008789a529a11c4db3bc8` |
| `src/main/shape-cover-candidates.ts` | `fc7afd40b1e72d1d643d3a0dfb8d224914c2d00060ea05d52ae718970719145c` |
| `src/main/domain.ts` | `d10178200bc3d75ca0dab7d3c9599430aec10b440a2e1c9d8a3946f9538d55e7` |
| `src/main/compiler.ts` | `59822a64be093ba5086da9df0bd842b2b8d7f89e3bcfc56e0680593c4b32492b` |
| `src/main/queue.ts` | `9d902b5ef6274fff610ab91c1ec60f7816ef287d3576428152056d11bf91a895` |
| `tests/shape-cover-candidates.test.ts` | `4784f1088c65cca49981edd4c6a31d9dc58c4ad189c3891100a7630ca57bca5d` |

| Command | Fresh result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/shape-cover-candidates.test.ts tests/shape-cover-pixel-gate.test.ts tests/source-mask-admission.test.ts tests/source-sticker-knowledge-store.test.ts tests/source-sticker-knowledge.test.ts tests/compiler.test.ts tests/queue.test.ts tests/cover-review-preview.integration.test.ts` | 8 实际测试文件、125 PASS，exit 0；执行日志另含未匹配的 `tests/schema.test.ts` filter，不计作运行证据 |
| `npm test -- tests/domain.test.ts` | 4 PASS，exit 0 |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 127 文件 PASS、1 文件 skipped；1095 PASS、3 skipped，exit 0，33.98 秒 |
| `git diff --check` | exit 0 |

shape 专用测试共 23 项（M4-B1 13 项，本轮 10 项），在 full run 中均未跳过。除真实像素/PTS 外，还验证 binding/源/preset/PNG 篡改、原候选删除、compiler snapshot 后文件变化、伪 content-safety PASS、入队/样片直发/批准重放/恢复执行阻断、渲染前后源 head 变化、冻结途中及发布后的取消和其他文件保留。3 项既有 skipped 分别为两项 Windows FFmpeg/font 测试和未启用的 live asset library 测试；本轮没有 Windows 实机、Electron UI 或真实 Provider 证据。像素/预览使用 app FFmpeg `n8.1.2-52-g5a03dfa0f6-20260912`，源准入 fixture 沿用 PATH 工具；未修改工具配置。

# Review And Maintenance

Native `code_mapper` 只读核查原 queue 的创建、样片直发、恢复/重试与资源路径；没有写文件或运行测试，parent 调查并裁决实现。初次读取误用不存在的 `code_mapper.toml` 而 exit 1，随后找到实际 `code-mapper.toml` 并读取；该命令失败不是代码或测试失败。

最终 stable snapshot 的 Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`，绑定上述源码摘要、Spec/Active Slice 和 fresh tests。用户未要求本 snapshot 的 Kimi review，且本轮明确保留不调用付费模型的边界；没有凭据/越权执行或 critical durable-state 损坏路径；新增策略未接生产 caller，正式发布/入队/恢复均被阻断。像素、输出时钟和字节生命周期的具体缺口已经 targeted executable verification 收敛；未验证的用户素材、独立内容安全、长片成本明确不授予生产资格。没有以 mapper、tests PASS 或 review verdict 代替最终验收。

当前 AOCI Guide 与一次 `aoci_maintain` 仍返回 `blocked/stopped`、没有机器签发的可写候选：5 个新 owner（含 M4-B1 两个）缺 entry，`domain.ts` 等 managed source 有 drift，且既有正式 `aoci.code.txt` 与 baseline 不一致 (`code_volume_unbaselined`)。没有绕过 governed Scope Change、手写正式索引或扩大到其他模块修复。本轮不修改 AOCI 托管字节；不能声称索引对齐，后续维护仍有阻塞。

# Remaining Boundary And Next One Thing

`geometry-only` 和 `contentSafety: NOT_EVALUATED` 继续明确保留。没有成功 shape 正式入队/导出，不证明独立内容安全、全片或未知时段的 coverage、用户星形素材验收、Windows 或大批量性能；source-mask-only 只证明源事实。冻结 PNG 的全画布几何不能直接当作四角占位区域，后续选款整合须使用实际 placement/轮廓绑定。

下一步 M4-B3：建立冻结模板/样片/输出 PTS/源修订绑定的输出 coverage 准入与独立内容安全准入，沿现有样片复核 owner 接入；在这些证据有效前继续阻断正式输出。选款整合、四角占位和真实媒体验收仍须后续明确处理，本轮停在可重放的冻结/预览检查点。
