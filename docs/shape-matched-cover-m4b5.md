# M4-B5 Artifact Custody and Publication Barrier

## Status and Scope

2026-09-27，用户在 `9876c72` recovery 检查点后确认继续。沿现有 [Spec](shape-matched-cover-spec.md)、[Plan](shape-matched-cover-plan.md) 及 [Recovery Contract](shape-matched-cover-m4b4-recovery.md)，落实完整数据托管与一次性发布屏障，仍属 bounded M4。新 owner 目前是显式进程内接缝，未接入 Controller、启动恢复、IPC 或 UI；不进入 M5，不创建 worktree，不调用真实产品 Agent、付费模型或 Kimi。

## Ownership and Source Evidence

| Owner | Responsibility |
| --- | --- |
| `shape-cover-artifacts.ts` / `ShapeCoverArtifactStore` | 固定项目及 run/media/version 键，归档完整请求、原模板、preset、媒体身份、候选、模板贴纸及真实批准样片；按永久 intent 与 completed receipt 约束重复发布。 |
| `shape-cover-artifact-io.ts` | 有界流式 SHA、规范目录、NOFOLLOW、独占文件创建、文件与目录同步。 |
| `shape-cover-candidates.ts` | 导出现有 request Schema，托管复用同一校验合同。 |
| `shape-cover-admission.ts` | 可选核对完整 request 与私有 handle 绑定；原五参数队列调用保持兼容。 |
| `queue.ts` / `store.ts` | 保持唯一任务 lifecycle、真实媒体验证、正式发布与持久 completed owner；本切片不修改它们。 |

CodeGraph 已实际索引并查询 `ShapeCoverArtifactStore.publishOnce` 的调用关系：capture → admission verification → 原 `ExportQueue.publishApprovedSample` → completed 核验。图的短成员 `.get` 仍可能错误归属到同名服务，私有 WeakMap 与 pending Map 的行为以源码为准。本 owner 在 `src` 内没有产品调用者；测试调用不代表产品入口激活。

## Persistence and Authority

manifest 固定 schemaVersion=1、authority=none。完整 request 保存源身份、修订、mask/segment/range 关联与全部 output settings；模板保存候选、最终 PNG 和输出绑定。实际复制全部候选文件、模板贴纸资源及真实样片，逐一核对 SHA。源视频、知识库、系统字体与凭据不进入归档；源和修订继续依赖 canonical owner，未来 fresh 准入仍须重新核实。

metadata 上限1MiB，资源最多1024个；单贴纸沿 `MAX_FROZEN_SHAPE_BYTES`，单样片1GiB，总量2GiB。读取 metadata 有界，资源用固定缓冲流式处理；未知版本、伪 authority、路径穿越、符号链接、丢失或变化字节拒绝。不忽略目录同步失败，包括不支持该能力的平台。

load 只返回核对后的数据与托管路径，不返回 handle。重定位模板不能配旧 handle；普通 shape batch/retry 与重启自动模型恢复保持拒绝。completed 只核对 JobStore 的项目、媒体、模板、preset、输出目录、task 身份及正式字节，不发布或调用模型。缓存清理后可以读取完整归档及已有完成结果；这不等于允许重启制作。

## Publication and Failure Windows

同 store 按键串行；独立实例通过 exclusive create 争用永久 intent。只有快照完整、当前 handle/request/源/资产绑定有效，且 intent 文件和目录同步成功后，才调用一次原队列直发同字节样片。队列 completed 与正式 SHA 核对后才写 receipt。重复相同请求返回原 batch/task/output；不同内容拒绝。

重复 `publish` 仍核对当前有效 handle 和原输入；缓存清理或重启后通过只读 `completed` 核对已有结果，不支持调用 `publish` 恢复 authority。

队列调用前失败、发布成功但返回丢失、receipt 保存失败或损坏、正式文件改变、JobStore 绑定不一致，均不能重新发布。intent 不清除；既有快照缺 intent 也直接拒绝，不能推定尚未发布。取消后已完整快照和永久 intent 保留；尚未提交 manifest 的本次独占目录可清理。没有自动认领、修复、旧副本恢复、清理或迁移入口。

托管根必须由主进程固定，父目录须已存在且规范。整个托管根被外部删除/回滚的灾难恢复不支持；空目录不能成为自动恢复旧请求的依据。并发测试使用两个独立 store 实例；exclusive 文件屏障提供跨进程互斥合同，但本次没有实际杀进程、掉电或多进程 crash 实验。

## Executable Evidence

在已有 canonical admitted-mask、真实 FFmpeg、原 Queue/JobStore 和明确标记的模拟独立 reviewer fixture 上新增26项：

- 完整字节托管、同键并发及跨 store 重复返回同一完成结果；运行期候选/PNG/样片缓存清理后重新打开只读，无额外 FFmpeg 或复核。
- 独立 store 并发最多一次队列调用，同键输出绑定变化拒绝。
- 模拟队列副作用前失败和真实发布后返回丢失，重试不产生第二个文件；模拟 intent 同步失败后也不进入队列。
- 请求与 handle 不一致、媒体键或生产 run/version 失配、取消与 root 符号链接，在正式发布前拒绝。
- durable intent 后取消保留屏障；资源、最终 PNG、样片、版本、authority、规范文件名、metadata 大小、intent/receipt、输出和 JobStore 的损坏/丢失继续拒绝，不重复发布。

同步失败是注入的错误，真实调用链执行文件和目录 sync；测试不证明硬件掉电持久性。模拟内容安全通过不证明真实 reviewer 语义、用户素材泛化或人工全片质量。Windows 未验收。

## Fresh Verification

已读取并执行 `superpowers:verification-before-completion`。以下均基于最后一次源码/测试变更后的当前 working tree：

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS，exit 0 |
| `npm test -- tests/shape-cover-candidates.test.ts tests/queue.test.ts tests/store.test.ts tests/state-migrations.test.ts tests/append-production-queue.test.ts --maxWorkers=4 --minWorkers=4` | 5 files，111 PASS，exit 0，78.41s |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 135 files PASS / 1 skipped；1215 PASS / 3 skipped，exit 0，81.47s |
| `git diff --check` | PASS |

官方 Maintain 签发的完整四项 code batch `e053146f6bf60ee3003e9aa1c2b23d1894c6c6021561d21291924854569f3ee3` 已原子 apply：4/4，remaining=0，无 findings；正式文件仅 `aoci.code.txt` 和 `.aoci/baseline.json` 更新。依次 Verify、Aggregate Check、Guide 均 exit 0：160 sources / 160 entries，missing/orphan/stale/unbaselined/line-ending-only 为0，Guide aligned/complete=true/next_action=none，无 Recovery、第三方冲突或 Volume mismatch。没有盲目 baseline。

上下文压缩后的 Overview 输出发生宿主截断，认知交付失败，未据此声明完整系统认知可靠，也未旁路补答或自动重试。上述治理对齐是官方机器事实，语义维护与工程结论仍绑定当前源码和执行证据。

## Self-Review and Snapshot

现有 plan 的本切片合同由 Parent Self-Review：source-mask-only、共同集合、最终像素和独立内容安全的原门槛不变；归档不会签发 authority。新 owner 没有第二套队列状态或模型连接选择，不修改旧矩形/manual/assisted、renderer、UI、上传或历史重试行为。

源码稳定身份：

| Path | SHA-256 |
| --- | --- |
| `src/main/shape-cover-admission.ts` | `1dd1f5e71708c59e8b09356be91e196243f8470c17f71c6f7af72f622801af2f` |
| `src/main/shape-cover-candidates.ts` | `2ffd9d91bbb876e0a9b757e35e5514aec8467e975a81c825b6ddb3fb32980666` |
| `src/main/shape-cover-artifact-io.ts` | `2135a48b2a99729812d71c0a984679129000a1ff8eb932eb03794b881d53149e` |
| `src/main/shape-cover-artifacts.ts` | `99a272184d1912a0f0585e53cfdfa373f61bfae16845e5236a8eabfce83cab53` |
| `tests/shape-cover-candidates.test.ts` | `3ec5085f7aad95a1179b7f1156c8dea567deb18b22c535985c6c8fa08b0816cc` |

适用 Spec SHA `b2bf7538f4ee54a5ab68b8cbd156c3026385f90b47cdbe7302448a35a08a26e2`，Plan SHA `437618614134fc6f65fdb779a652ea4b30aed7c8dc85bf4617ba8f21ee12d33b`。测试包含保留的其他本地随机未提交工作，不宣称 clean checkout 结果；本轮期间另有不相交 Qianchuan 文档/脚本提交，未修改或提交这些文件。AOCI 对齐同样属于当前保留 dirty 工作的源码快照。

project-native verification 后，Parent 对上述 stable candidate 判断 Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：用户没有要求 review，且明确禁止 Kimi；没有凭据、新的跨项目执行授权、旧状态迁移或覆盖已有文件的路径。新文件托管失败与未知发布均关闭新接缝，canonical completed/artifact 保留；没有关键级 durable-state 损坏的具体路径。并发、损坏和未知结果已有 executable evidence；未做掉电/真实语义/Windows 验证的边界明确未启用或未验收，不满足重大后果与实质验证缺口及独立 review 增益同时成立的触发条件。未调用或虚称独立 reviewer 验收，Parent 负责最终裁决。

已评估 session-record trigger：本仓没有声明专门 capture skill，本 milestone 保存合同、snapshot、实际 verification 与限制。最后检查 live agents 只有 Parent；本轮只提交四个源码 owner、测试、plan、本记录和官方维护两文件。原 controller/runner 的 `usesModel` hunks、其他本地随机改动与两个 `氨糖膏` 项目文件删除保持未暂存。

## Remaining Boundary

本切片无已知 blocker；不支持显式重启重试或 Controller 中的托管接线。下一项仍在 M4：将已验证 owner 接入现有进程内 shape 制作发布回调，保留逐版本 fresh 准入和原队列；后续重定位快照的显式 fresh 准入仍须先定义项目/版本授权与取消合同。UI 激活、全片自动覆盖、真实服务、人工质量、掉电及 Windows 不在当前验收范围。
