# M4-B3 — Output Coverage And Independent Content Safety Admission

## Status And Authority

2026-09-27，用户选择方案 A：先收敛全仓 AOCI 治理债，再进入 M4-B3。AOCI reconciliation 已在 `f95b0bb` 提交，证据和 historical Volume mismatch 的精确 preimage 恢复过程见 [M4-B2 record](shape-matched-cover-m4b2.md)。本切片沿用 [V1 Spec](shape-matched-cover-spec.md) 与 [Active Slice — M4-B3](shape-matched-cover-plan.md#active-slice--m4-b3)。

M4-B3 bounded functional acceptance：PASS。该结论证明以下本地接缝及其真实 FFmpeg fixture，不代表生产 Agent/UI 已启用、真实 reviewer 服务或人工全片验收。没有调用产品 Agent、付费模型或 Kimi review，没有创建 worktree。用户已有两个项目文件的删除改动继续保留且不提交。

## Implementation And Ownership

- [shape-cover-admission.ts](../src/main/shape-cover-admission.ts) 负责完整 candidate × target × output setting 矩阵复查、最终栅格/实际输出 PTS 核查、严格独立内容安全协议及进程内准入 handle。复用既有 admitted-mask、真实 alpha 和 M3 像素 owner，不建立第二 renderer 或源知识库。
- [queue.ts](../src/main/queue.ts) 为实际成功返回的形状预览保存私有样片绑定；只有该队列渲染、模板/媒体/preset/字节都匹配的样片可进入准入。正式直发复用 `publishApprovedSample` 原生命周期和无覆盖发布；形状层必须持有本模块签发的 handle。复制并 sync 后、artifact 校验后各再次核验同字节和当前源/资产/冻结绑定。
- `SupervisorEvidence` 提供当前源/成片实际解码配对图及不可伪造的实例内 image handles；`superviseRenderedTemplate` 继续拥有最多五轮检查的有界循环。本切片允许补帧或停止，拒绝通用 bbox 修订；改变形状必须重新计算候选、冻结、准入。

当前媒体/preset 对应的全部 intended targets 必须逐一匹配冻结层，不能遗漏、重复或增加 shape 层。完整矩阵重新投影 admitted source mask 并验证 `oldMaskFinal ⊆ opaqueContour`，随后从当前候选 RGBA 重算有限轮廓，逐通道核对实际冻结 PNG 与 RGBA/alpha 摘要。PNG 和实际输出 PTS 共同证明最终像素及时域 coverage；不是从有损编码后的 RGB 相似度推断 alpha。

读取样片全部 decoded PTS，核对尺寸、时长、单调性与有效范围。30fps 输出逐帧匹配该时钟，source-mode 逐帧匹配真实源 PTS；逐目标验证半开启停区间，没有完整时钟证据就返回 `UNSAFE`。每个目标至少提供两个实际落在覆盖区间的配对样片时点，并保留现有主管抽样和补帧能力。

独立 reviewer 使用 `ShapeCoverReviewInput` 接收真实配对图、placement、range 和冻结 PNG SHA。`pass` 必须明确给出 `face`、`hands`、`product`、`subtitles` 四项 `SAFE`，引用当前全部交付证据 ID；冲突、UNKNOWN、缺项、裸 pass、陈旧/删选证据均拒绝。测试 reviewer 是模拟协议实现，角色/身份字段不是外部服务认证；真实独立连接的选择、提示和调用接线仍未启用。

handle 由 module-private WeakMap 保存脱离调用方的 request、模板、媒体、preset、样片 SHA 及证据摘要，不能由 JSON PASS 或复制对象重建。取消使其失效，源 revision/mask、候选和冻结文件漂移均拒绝发布。PASS 样片保持供直发使用，准入失败清理本次已核验的队列样片；不会删除伪造路径或修改源事实。

## Fresh Verification

以下结果来自上述稳定源码快照，均为 exit 0，不能引用 M4-B2 的 1095 PASS 代替：

| Verification | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| shape candidates/pixel gate、source-mask admission、compiler、domain、queue、supervised preview、supervisor evidence，`--maxWorkers=4 --minWorkers=4` | 8 files，111 PASS |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 127 files PASS / 1 file skipped；1105 PASS / 3 skipped；34.35s |
| `git diff --check` | PASS |

相关测试使用真实 FFmpeg 和原 queue 完成 admitted masks → freeze → 90 帧样片 → 配对证据 → 模拟独立安全 → 同字节发布。24fps 源转换至 30fps 的实际 90 帧输出通过；将真实渲染截短至一秒时，在 reviewer 调用前拒绝。

负例覆盖四类明确冲突、UNKNOWN、裸 pass、陈旧证据、伪造或复制 handle、缺目标、非本队列样片、源 revision/字节、preset、候选/冻结 PNG/样片漂移及取消。安全负例断言 reviewer 已实际调用，防止早期几何失败冒充内容安全拒绝。普通 shape 批次/恢复的既有禁止准入测试继续通过。

发布回归经历真实 RED → GREEN：测试在 `ArtifactVerifier.verify` 返回后将 partial 替换为有效但未覆盖的源视频；只在复制后核验时，该测试确实失败并发布错误字节。增加 artifact 校验后的再核验后，发布明确拒绝，失败 partial 清理，已有批准产物保留。没有增加等待时间或放宽无泄漏要求。全套中的 harness timeout 测试本次通过，不宣称历史 timeout 波动已经归因。

稳定源码 SHA-256：

```text
src/main/queue.ts                 a271941c18554f695f5b4e5b240e717910b2b2c0103064e54be3622924fd3355
src/main/shape-cover-admission.ts 93d1a487c1da5f338648c0a2573b49083d55a2cf60aebb18708b0ca5431eef3b
tests/shape-cover-candidates.test.ts 685279614b4f24beebaba6e0844fae452af510575cd1cc0bfdbcdb9768516c59
```

## AOCI Incremental Maintenance

稳定源码的 fresh Verify / Check / Guide 只报告 `queue.ts` stale、`shape-cover-admission.ts` missing/unbaselined；无 Volume mismatch、scope block、pending recovery 或历史 finding。官方无参数 Maintain 签发完整两项候选：

```text
code_batch_id: e97f0b638dc8783e8c131474dc890e5cfac07e1afdf83cae8ffefa3548b127a4
```

读取正式 Meta，并结合当前源代码及 CodeGraph 核对关系后，使用 `aoci_update_entry` 一次提交完整两项 FRAS。返回 `applied=2, remaining=0, finding_count=0, aligned=true`。没有手改 baseline；正式 apply 只更新这两个 source binding 与 Code Volume binding，其他 baseline 条目保持不变，Root/Meta/scope/curation 没有修改。CodeGraph 的误报关系以实际 imports/calls 裁决，没有把同名 `set` 推断成 ChatGPT 调用。

按工具终态指令依次 fresh Verify、Aggregate Check、Guide，三项 exit 0；151 sources / 151 entries，stale/missing/unbaselined/orphan/Volume mismatch 全部 0，pending transactions 0、recovery false、scope aligned、budget healthy；Guide `stage=aligned, complete=true, next_action=none`。未在 aligned 后重复 Maintain。

```text
Code Volume SHA: 7523b1a6da6f8b4b2b51adeec22d25aebe1cf57c7a3a0a0955ca33cfe47af5b4
Composite identity: 5b52a1ee29e23cd822dc00660ff3b67a4fa59d6275ccbbd24ab3b3c499c3efec
```

## Review Risk Gate And Completion Boundary

Parent 在上述稳定源码 SHA 与 project-native verification 后进行 final diff/合同核查。没有用户要求 Kimi review；当前未接入生产制作入口，没有凭据或跨项目权限变更，没有关键级不可恢复持久状态损坏路径。主要风险是样片准入/发布错误，已由真实 FFmpeg、篡改拒绝、取消及 post-artifact RED → GREEN 覆盖；真实 reviewer 内容判断和素材泛化缺口需要真实服务/人工媒体验收，不能靠代码 reviewer 消除。结果 `KIMI_REVIEW_NOT_REQUIRED`，遵守当前禁止付费模型/Kimi review 的约束。

准入探测有保守上限：单次 ffprobe 20 秒、8MiB stdout、最多 36000 帧；证据沿既有每次 8、总计 40 个请求上限。每队列最多保留 32 个形状样片来源绑定，超限淘汰后不能准入旧样片。至少两个覆盖区间时点、精确 source/30fps 时钟、完整 PTS 和所有目标证据均为硬门槛；短区间、复杂 VFR、量化时钟或长片达不到门槛时拒绝，未承诺广泛素材支持或长片性能。正式准入需要当前候选文件；M4-B2 单纯冻结预览允许原目录项删除，不代表可绕过本阶段重新核验。

仅允许同字节已审核样片直发。没有普通重新编码批次准入、序列化/重启恢复 PASS，也没有 AgentRunner/Controller、UI 或真实独立连接接线。旧矩形、manual、assisted 的原路径保持原合同。`source-mask-only` 仍只证明源事实，不能借作候选、任意输出规格 coverage 或内容安全证明。Windows 实机、用户素材人工全片检查、真实模型判定均未验收。

## Next Milestone

下一窄切片 M4-B4：将共同安全候选选款、逐版本独立样片准入和原制作入口接线，并明确冻结准入的持久化/重启重试合同。之后仍须 M5 留出集真实媒体与人工检查，不直接启用全片自动覆盖。本次停在 M4-B3 本地接缝稳定检查点。
