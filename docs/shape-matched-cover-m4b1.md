---
title: Shape-Matched Cover M4-B1 Common Candidate Geometry
status: local-geometry-seam-implemented
date: 2026-09-27
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope And Owners

本轮从 clean `1f2c69f` checkout 在原工作树实现用户授权的 M4-B1。沿用 [V1 Spec](shape-matched-cover-spec.md)和 [Active Slice](shape-matched-cover-plan.md#active-slice--m4-b1)，只实现全部 intended targets 的 admitted masks 准入、真实 alpha、`candidate × target × output setting` final-pixel gate 及共同候选集合。

[shape-cover-candidates.ts](../src/main/shape-cover-candidates.ts)拥有只读整轮计算；[shape-cover-alpha.ts](../src/main/shape-cover-alpha.ts)拥有有界本地媒体读取和 FFmpeg 测量。源身份、审核、证据完整性仍由既有 `SourceStickerKnowledgeStore` 独占；投影与轮廓阈值复用 M3 `shape-cover-pixel-gate.ts`。不接生产选款、compiler、renderer、模板冻结、UI 或导出队列。

# Executable Contract

入口 `computeCommonShapeCoverCandidates(request, store, tools)` 接收独立列出的 intended target/segment/range、expected revision、精确源身份/路径、统一 `ExportSettings` 列表，以及现有本地候选目录中的 sticker ID/path/fingerprint。每个目标须为每种设置提供一个整数最终像素 placement；该 seam 不自动找框、不推断未列出的目标，也不自行扩大或补充调用者的候选目录。

先解析并复制输入，核对唯一 ID 和完整 placement 矩阵，再对**全部**目标验证当前源字节和 canonical head。要求 head 为 reviewed、`source-mask-only-v1`、指定 revision，且目标/segment 的有效时段完整包含 required range；mask 必须通过既有无损解码和摘要校验。无 mask、缺证据、争议、过期修订或身份不符时，读取任何候选资产前即整轮 `UNSAFE`。首版沿用 M4-A 的 rotation=0 边界。

随后枚举请求内全部候选，以冻结并核对 SHA-256 的原文件字节送入 FFprobe/FFmpeg。首版支持单帧 PNG/JPEG，动画、旋转元数据、损坏媒体、缺工具或指纹不符均拒绝。真实 RGBA 按 contain/bicubic 缩放并以透明色补边，保留 alpha；不制造白底或 bbox。只有 alpha=255 的像素能作为不透明覆盖，再由 M3 在既有版本化半径、面积和宽高上限内计算轮廓。资产限 10 MiB、输入图尺寸限 4096×4096、源/输出限 16,777,216 像素；每次媒体命令限 20 秒及有界输出，不新增依赖。

每个 target/output 单元的 scale/pad 来自当前 FFmpeg 实际舍入测量；source 分辨率使用已核对的原尺寸。M3 将源 mask 保守投影到最终像素，并独立计算每个候选的 coverage。不中途省略失败单元；候选必须在**全部**单元 PASS 才进入共同集合，空交集为 `UNSAFE`。结果绑定源身份/revision/facts digest、target/segment/range、mask/asset/alpha 摘要、设置、测量、placement、alpha 栅格版本、像素合同及轮廓半径/coverage 结果。

返回前再次核对源字节/head/facts digest 和通过候选的资产指纹；变化或取消清空共同集合并返回 `UNSAFE`。这是一次只读快照计算，不是跨全部源的原子准入事务；后续消费仍须重新核对冻结绑定。迟发失败可保留诊断矩阵，但不保留可选候选。

返回明确标记 `verification: geometry-only`、`contentSafety: NOT_EVALUATED`。其中 PASS 只表示给定静态摆放在该矩阵下有共同几何候选；不证明实际图层已生成、输出 PTS/时序覆盖、内容安全或任何生产任务可入队。`source-mask-only` 修订继续只证明源事实。

# Evidence And Verification

[shape-cover-candidates.test.ts](../tests/shape-cover-candidates.test.ts)创建真实 FFmpeg 视频和 alpha PNG，经正式 `admitReviewedSourceMask → publish → SourceStickerKnowledgeStore` 建立测试知识。测试 receipt/contact sheet 为合成机制 fixture，不能作为人工视觉审核。两个目标分别由左/右不透明候选通过，彼此拒绝；只提供这两款时空交集失败，全不透明候选才进入共同集合。全透明和 alpha=128 候选均拒绝。测试另覆盖第二目标缺失/错 segment/错 range/错 revision/错 identity、缺 placement、源和证据篡改、计算途中 head/源/资产改变、取消、重复 ID、非法几何、动画和工具失败。

128×128 源在 source 输出通过、同 placement 的 720p 输出因 `no-shape-match` 拒绝；按真实 720p scale/pad 使用对应 placement 后，两个目标 × 两种设置全部通过且 uncoveredPixels=0。未把 source 的 PASS 借给其他设置，也未用超过 M3 scale 上限的输入冒充 coverage 拒绝。

已读取并执行 `superpowers:verification-before-completion`。验证候选为上述 HEAD 加本轮限定文件，核心快照 SHA-256：

| File | SHA-256 |
| --- | --- |
| `src/main/shape-cover-alpha.ts` | `c0918f2f702f980f26285fea9abe8c91e24c3140823746315d9d98d21331f84b` |
| `src/main/shape-cover-candidates.ts` | `9eb78c338a68d648586e3d4831e9fd1c73e73b85a514f7a70220bdb838396c96` |
| `tests/shape-cover-candidates.test.ts` | `cd1dd17a3caec62646bb92f6c245c0de374a38fc2f7063e905a85c7e5a51efb4` |

本机 FFmpeg/FFprobe version 为 `9c33b2f`。fresh verification 记录在下面的 final checkpoint；历史 M4-A 或 harness 测试不作为本轮证据。

| Command | Fresh result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/shape-cover-candidates.test.ts tests/shape-cover-pixel-gate.test.ts tests/source-mask-admission.test.ts tests/source-sticker-knowledge-store.test.ts tests/source-sticker-knowledge.test.ts` | 5 文件、82 PASS，exit 0 |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 127 文件 PASS、1 文件 skipped；1085 PASS、3 skipped，exit 0 |
| `git diff --check` | exit 0 |

全套验证耗时 32.00 秒，相关测试耗时 3.97 秒，证据匹配上面的源/测试 SHA-256；没有将历史 1055 PASS 当作当前结果。3 项 skipped 为既有套件跳过，本轮真实媒体矩阵 13 项未跳过。本机临时日志 `/tmp/jianji-m4b1-{typecheck,related,full}-final.log` 不提交、不作为持久验收产物。

# Maintenance And Review Boundary

受管 Kimi deep 只读 mapping 调用 `bbe9366b-6437-4343-b78a-6c4e5b97a7d5` 按 sealed contract/Docker qualified route 执行，receipt 分类 `PROCESS_OUTPUT_LIMIT`，输出截断，无可用报告；未自动重试，也未依赖它作实现或验收结论。它不是 independent review。Parent 直接核查 canonical store、M3 gate 和真实媒体证据，保留最终裁决。

最终 candidate 的 implementation Review Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`，绑定上述 HEAD、源/测试摘要、accepted Spec/Active Slice 与 fresh verification。三项触发条件分别核对：用户未要求该 snapshot 的 Kimi review；新增 seam 无凭据处理、越权执行或 durable-state 写入；尚无生产 caller，只由测试消费，现存运行缺口是明确排除的生产集成/成片验收，没有本轮重大失败后果且 verification 后仍未解决的语义缺口。Parent 检查全部 intended masks 前置、完整矩阵求交、真实 alpha 与变化 fencing；不叠加 reviewer，也不将 mapping receipt 或 tests PASS 单独视作产品验收。

AOCI 当前 Guide 和 `aoci_maintain` 返回 `blocked/stopped`：新增两 owner 缺条目，但当前 HEAD 已有 13 个 managed entries stale，且正式 `aoci.code.txt` 字节不匹配 baseline (`code_volume_unbaselined`)；机器未签发可写候选。没有绕过 governed Scope Change 或直接手写正式索引/baseline。本轮未修改 AOCI 文件，新增 owner 的索引维护仍受此既有治理阻塞影响；不能宣称 whole-index aligned。源码和可执行验证仍是本任务事实来源。

# Remaining Boundary And Next Step

9 月 24 日记录的真实 M4-A isolated store/probe 目录当前已不存在，未重造其人工 PASS。本轮证明真实 FFmpeg fixture 的机制，未重放用户星形素材、Windows 实机或完整视频人工验收；大批目标/候选的耗时和内存也未测量。

下一步 M4-B2：沿原模板/队列冻结实际图层和轮廓版本，证明预览/样片/导出消费相同字节，并检查输出逐帧时序及独立内容安全，再接现有选款流程。该步骤需要后续授权；本轮在 M4-B1 独立 seam 的检查点停止，不宣称整个 M4 或生产形状匹配完成。
