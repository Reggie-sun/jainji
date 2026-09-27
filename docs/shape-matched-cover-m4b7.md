# M4-B7 — Restart Read-Only Reconciliation Contract

## Scope

从 `0979813` 的 B6 检查点继续，保持 bounded M4。只增加 ArtifactStore 的显式重启后只读核对；不接启动、Controller/runner、IPC/UI，不改变 renderer，不进入 M5。

## Source Findings

- CodeGraph 与当前源码确认 B6 发布路径仍是 Controller → runner shape 分支 → ShapeCoverProduction → ArtifactStore → publish-once → ExportQueue.publishApprovedSample → canonical JobStore → 正式字节核验 → receipt。
- 原 JobStore.load/loadAll 会恢复 backup、迁移、隔离损坏或创建目录；ExportQueue.recover/hydrate 会改变任务状态。它们均不适合作为只读 reconciliation 的依赖。
- B5 intent 绑定完整 request/key/template/media/preset/outputDirectory/sample fingerprint 的 digest，但不保存 queue 随机生成的 batch/task ID。缺 receipt 的发现必须从 canonical primary 唯一关联原冻结模板和明确的 production selection；缺少 run/version selection 的旧快照不能猜。

## Read-Only API

`new ShapeCoverArtifactStore({ root, projectId, jobStore }).reconcile(key)` 返回：

| Observation | Meaning |
| --- | --- |
| NO_INTENT, authority=none | 规范目录中无 intent，或目录尚不存在；不授予许可，不创建目录 |
| UNKNOWN, authority=none | 无法严格证明 completed，包括损坏/不支持/歧义/未完成/绑定漂移 |
| COMPLETED_VERIFIED, authority=none, result | 返回原 canonical batchId/taskId/outputPath，仅是已完成结果的观察 |

INTENT_DURABLE 是核对前提而非“尚未发布”证明。UNKNOWN 永不转换为 publication authority；以后重复只读核对也不能清除 barrier 或解锁发布。

## Completion Proof

先核对规范 custody 目录、v1 manifest、完整 archived candidate/layer/sample 的大小和 SHA，以及 intent 的 bindingDigest。原 request 与源身份/修订/目标/候选/输出设置/冻结模板均由该 digest 固定；此处不重新运行几何或 reviewer，也不推导 fresh PASS。

有 receipt 时严格读取该 receipt，不绕过损坏、未知版本或错误绑定。缺 receipt 时要求所有 shape 层 selection 的 runId/round 等于原 key，枚举 canonical JobStore primary，按 project、media、完整模板、preset、素材快照与输出目录唯一匹配。零匹配、多匹配、无法解析的 primary 均 UNKNOWN。匹配不只依据输出 SHA，未完成的相同 batch 也不能当作“可再次发布”。

完成核验要求 canonical 文件名/batchId 与 task.batchId 一致；单一素材/任务；batch/task 均 completed；progress=1、有效 attempt、startedAt/finishedAt、无错误；artifact.taskId/path/大小一致；正式输出在原规范输出目录，容器扩展名相同，实际字节 SHA 等于托管的批准样片。核对前后重读 canonical metadata 与 custody；发现库存、记录或 receipt 改变即 UNKNOWN。

## Persistence And Authority

JobStore.readCanonical 与 canonicalBatchIds 仅访问 primary，不调用 load/loadAll，不使用 .bak，不恢复或隔离文件，不迁移，不创建目录。单份 metadata 限 4MiB；最多 4096 primary、16384 目录项，超限拒绝。文件须是普通文件、无符号链接，目录须真实且规范；读取核对大小/mtime/文件身份，使用 O_NONBLOCK 防止 FIFO open 阻塞。custody 原有字节预算继续适用。

reconcile 不写 receipt/intent/manifest/JobStore，不复制产物、不调用 queue、FFmpeg、模型、reviewer 或上传注册。缺 receipt 的观察成功不补 receipt；原 completed/publish 重入仍拒绝这种缺 receipt 结果。共享 completed 核验改用 primary-only 只读读取，避免原先隐含的 backup 修复副作用。load 仍 authority=none，handle 不构造、不序列化、不恢复。

只证明原 completed 的冻结历史绑定及当前正式字节，不为新源修订、候选或输出设置签发准入。原 candidate/preview cache 清理后可读完整 custody；custody 资源缺失仍 UNKNOWN。没有将观察结果注入队列运行状态或触发 completed 通知。

## Executable Evidence

真实 FFmpeg、真实源 mask 与模拟独立 reviewer 产生历史事实；新增测试覆盖：

- queue 已完成但返回丢失，重开 store 与独立 Node 进程返回原 completed identity；无 queue 二次调用，无 receipt 补写。
- receipt 存在/缺失时，删除原 candidate 与 preview cache 后仍可只读核对完整 custody。
- NO_INTENT 不创建目录；旧快照缺 run/version selection 时缺 receipt 保持 UNKNOWN。
- primary 损坏、backup-only、未完成、重复匹配、坏 receipt/intent、output/candidate 字节漂移、selection/metadata/文件身份失配及 symlink 均拒绝。
- request/key/source revision/settings/project/media/output 绑定漂移、未知版本、超限 metadata 与无 canonical 结果均拒绝；不调用会写入的 JobStore 方法。
- Linux FIFO metadata 明确拒绝，目录、文件字节与 mtime 在核对前后保持不变。

独立 Node 进程证明进程私有 handle 不参与核对；这不是 kill/掉电 durability、Windows 或真实 reviewer/人工全片验收。

## Historical Verification

本轮读取并执行 `verification-before-completion`；所有下列结果来自本轮实际执行，不能替代后续源码稳定后的 fresh completion gate。

| Check | Observed result |
| --- | --- |
| Red reproduction | 新 restart/lost-return 测试因 reconcile 尚不存在而失败；实现后通过 |
| Relevant integration | 7 files / 166 PASS，包括 shape 98、mask 8、pixel 6、queue 12、store 2、migration 15、supervised-preview 25 |
| Full suite, four workers | 1273 PASS / 4 skipped；运行期间另一任务修改了 douyin-upload-store，不能作为当前整树的 fresh 完成证明 |
| Typecheck | B7 稳定源码初次检查 PASS；最终共享工作树检查 FAIL，错误来自另一任务进行中的上传迁移，非 B7 owner |
| Final B7 diff | Parent 检查三个 owner、相关测试及 plan；git diff --check PASS；未 stage/commit |
| AOCI apply | 原完整四项批次 CAS stopped，applied=0、formal_writes_started=false；另一任务的 douyin-upload 源绑定已变化 |
| AOCI Verify / Check | exit 1，163 sources / 162 entries；missing/unbaselined 为新增 douyin-upload-legacy，stale 为本轮三个 owner 加另一任务 douyin-upload-store/douyin-upload |
| AOCI Guide | authoring_required / complete=false；不能声称 aligned，不执行 blind baseline |

验证中其他任务先后提交 `49c394c`、`c4da2de`，并继续修改上传 store/shared、新增 legacy 文件。最初 typecheck 报 legacy 的 FinalArtifactInput/UploadIdentity 缺失，随后迁移引入 cdpEndpoint/publish_outcome 等跨上传模块不匹配。保留它们及所有无关 dirty/两个用户删除，不将其源码归入本任务提交。

用户选 A 授权 Parent 串行维护原完整四项 AOCI 批次；由于期间批次又增加另一任务的进行中源码，不采用过期绑定或擅自接管。当前 completion checkpoint 为 BLOCKED_NOT_COMMITTED，待另一任务源码稳定、明确当前完整官方批次后，重跑 fresh gate 并只提交 B7 文件及授权的正式 AOCI 增量。

相关/full JSON 与源码快照本机暂存于 `/tmp/jianji-m4b7-{related,full}.json`、`/tmp/jianji-m4b7-verification-snapshot.json`，不作为仓库发布资产。

## Resume Verification

用户明确要求重新核查当前 HEAD/working tree、四个 candidate SHA、ownership、fresh typecheck/related/full、diff check、官方当前批次及限定提交。本次 HEAD 仍为 `c4da2de`。四个 B7 文件与 Candidate Identity 表完全一致，plan 仍为记录 SHA；Parent 再读 source/diff，未发现 B7 hunks 被其他任务改写，git diff --check PASS。

- Fresh related：7 files / 166 PASS，约 128s。期间其他任务改变 controller/shared 等依赖，不能仅凭这个结果声称当前完整制作树已验收。
- Fresh full：四路，1249 PASS / 32 FAIL / 3 skipped，约 116s。失败来自 douyin-cdp-uploader 12 项、douyin-upload-integration 3 项、douyin-upload-service 17 项；本轮不接管这些源码和测试。
- Fresh typecheck：初次与末次均 exit 2。末次明确包含 legacy 中 FinalArtifactInput/UploadIdentity 缺失，以及 index.ts 的 Window/BaseWindow 参数失配；这些路径不属 B7。
- 核验期间其他任务继续改变 controller、index、preload、共享 agent 与多个 renderer 文件，并新增 qianchuan-page-contract；四个 B7 SHA 未变。
- 从当前源码重新领取官方 Maintain，完整批次为 18 项，batch_id `21c74a9d5d3a8cf4a3fb7c81d3e79b2534bafa3560d7fb077d39915e8cb33005`。这是本次观察的机器绑定，后续源码变化后必须重新领取，不作为未来可复用授权。
- 本次不对持续变化且尚未通过 gate 的跨任务源码执行 Apply；正式 AOCI 文件无本轮写入。Verify / Aggregate Check exit 1，Guide authoring_required / complete=false：164 sources / 162 entries，missing=2、orphan=0、stale=16、unbaselined=2，仍未 aligned。
- Parent 再次审查 B7：reconcile/JobStore 只读方法无发布、模型或修复调用；旧 missing-receipt 发布拒绝保留，实际字节及 canonical 绑定继续验证。没有改变候选源码，不将全局失败裁定为 B7 独立成功。

该次检查点为 BLOCKED_NOT_COMMITTED，没有 stage。日志、JSON 与核验快照分别在 `/tmp/jianji-m4b7-resume-{typecheck,typecheck-final,related,full}.log`、相关/full JSON 及 resume-snapshot.json。下面的 Stable Completion Verification 取代这些历史结果作为当前完成依据。

## Stable Completion Verification

用户确认当前源码已稳定后，从 HEAD `101070c` 重新执行完整 gate。四个 B7 candidate、spec 和 plan 均与 Candidate Identity 的 SHA 一致；Parent 核对当前 diff，没有其他任务交叉修改 B7 hunks。live agents 仅 Parent。未创建 worktree，未接管其他业务源码或两个用户删除。

| Check | Fresh result |
| --- | --- |
| Typecheck | `npm run typecheck` exit 0 / PASS |
| Related integration | 7 files / 166 PASS，134.40s |
| Full suite | 最多四个 worker，137 files PASS / 1 skipped；1284 PASS / 3 skipped，134.61s |
| Source stability | 317 个 src/tests/config 文件的 SHA 快照在 related/full 前后一致；HEAD 未变 |
| Diff check | `git diff --check` PASS |
| Official Maintain / Apply | 当前完整 19 项批次 `3c05223cd487aff242248bde9a087df71aa839a91e6c16a65fedef28af912c6a`；Apply 19/19，remaining=0，findings=0 |
| AOCI Verify | exit 0，164 sources / 164 entries |
| AOCI Aggregate Check | exit 0，ok=true，next_action=none |
| AOCI Guide | exit 0，stage=aligned，complete=true，next_action=none |
| Governance | missing/orphan/stale/unbaselined 均 0；pending transactions=0，无 recovery 或第三方冲突 |

按用户授权串行维护完整官方批次，包含已提交千川迁移及其当前稳定依赖的 cognition；完整读取这些受影响源码及 Meta，基于真实实现作者化，不改它们的业务源码，不使用盲目 baseline。正式写入仅 `aoci.code.txt` 和 `.aoci/baseline.json`，机器运行缓存/日志不提交。

Parent final source/diff review 确认：reconcile 只调用只读 custody/JobStore 方法；唯一发布 owner 与永久 intent barrier 保留；缺 receipt 的 completed observation 不写 receipt，也不解锁 publish；坏记录不能借 backup、另一任务或仅相同 SHA 通过。旧 manual/assisted/非 shape 队列路径未改。限定提交包含三个 B7 owner、相关测试、plan、本记录及授权的两个正式 AOCI 文件。

本轮 fresh gate 已关闭此前共享树漂移与全局失败 blocker，停在 bounded M4-B7 稳定检查点。`/tmp/jianji-m4b7-stable-{typecheck,related,full}.log`、相关/full JSON、snapshot.json 和 Verify/Check/Guide JSON 为本机核验材料，不作为发布资产。

## Candidate Identity

稳定 B7 源码 SHA-256：

| Path | SHA-256 |
| --- | --- |
| src/main/shape-cover-artifacts.ts | 520b23cb1e6abef88c13b0e76d2c7fff7d75fdcb5a219a15b88c40aaeb564860 |
| src/main/shape-cover-artifact-io.ts | 5619eb327ee579db94efed37cea045323bae91660a0564fbe1c7a13e67ad08a5 |
| src/main/store.ts | 3180fac9a594ec76e0fef501cbb43a7cc48cc0cb877f3d7e57e2f49036e5d56e |
| tests/shape-cover-candidates.test.ts | 2a7b19ebda275f38c824a27c5b42ee8b43d53c991f274d1610e766b26865ac90 |

适用 spec SHA：b2bf7538f4ee54a5ab68b8cbd156c3026385f90b47cdbe7302448a35a08a26e2；补入 B7 合同的 plan SHA：c9472a5e7147509c760239e571047adf2f238e9f5b4a353af79c9e769709e35b。

## Review And Boundaries

Parent 保留耦合的 custody/JobStore 证明合同、实现与最终裁决；沿用用户禁止 Kimi/付费模型的边界。fresh project-native gate 通过后，在 `101070c` 加 Candidate Identity 的稳定 diff 上按 `/home/reggie/.codex/SUBAGENTS.md` 判断一次，结果 `KIMI_REVIEW_NOT_REQUIRED`：用户没有要求该 snapshot 的 Kimi review；新只读 API 不执行凭据访问、跨项目授权或 durable-state 修复/发布，未发现关键级破坏路径；结果误判的风险由完整绑定、真实输出 SHA、独立进程重开及只读负例覆盖，未留下可由额外 adversarial review 解决的实质验收缺口。Parent 完成最终源码与 diff 审查，不派重复 native reviewer，不以模拟 reviewer 作为真实语义验收。

Repository 未声明独立 session-record/capture Skill；本 milestone record 作为本轮合同、可执行证据及真实 blocker 的 durable owner，不另造通用 session ledger。

不恢复 publication authority，不实现 restart retry、自动恢复模型、reconciliation UI、全片自动 mask 或 M5。只读发现不会重新发布、重编码、覆盖/删除正式输出或认领未知副作用。
