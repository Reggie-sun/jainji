# M4-B4 Recovery Contract Checkpoint

## Status and Scope

2026-09-27，用户在 `dc8cd81` 后授权继续。沿现有 [Spec](shape-matched-cover-spec.md)、[Plan](shape-matched-cover-plan.md) 与 [M4-B4](shape-matched-cover-m4b4.md) 的 Next One Thing，补齐当前持久化/重启拒绝合同和可执行证据。未更改产品源码、渲染、UI/IPC、队列生命周期或持久格式；不进入 M5，不创建 worktree，不调用真实产品 Agent、付费模型或 Kimi。

## Source Evidence

| Owner | Current behavior |
| --- | --- |
| `shape-cover-admission.ts` / `verifyShapeCoverAdmission` | module-private `issued` WeakMap 验证 handle，JSON、其他对象或新模块实例没有该私有绑定；缺绑定在栅格与文件校验前拒绝。 |
| `queue.ts` / `publishApprovedSample` | 准入后复制样片到 partial，同步、复核相同字节、核验 artifact，发布后持久保存 completed；输出文件已经存在不能恢复准入 handle。 |
| `queue.ts` / `recover`、`hydrate` | 加载历史状态，将 queued/执行中任务转为 interrupted；不自动 start 或调用 reviewer。completed 记录保持原样，不重新渲染或作 fresh 验收。 |
| `queue.ts` / `retry`、`execute` | completed 不重试；failed/interrupted 可进入原重试流程，但 shape 在 `assertShapeCoverExportReady` 被拒为 input_invalid，不运行 FFmpeg。 |
| `agent-preview-store.ts` | 运行期目录与预览映射只存在于内存，clear/prune 清理缓存；不能承诺持久恢复 PNG/样片。 |
| `index.ts` startup | `queue.recover` 后调用独立上传 reconciliation；没有重启 shape 分析、选款或复核调用。未改上传能力。 |

CodeGraph 查询核对 `ExportQueue.recover`、`ExportQueue.retry` 及 `verifyShapeCoverAdmission` 的结构关系。图对短成员 `.get/.set` 有同名错误归属，例如把 WeakMap.get 指向 ConnectionStore.get；本记录以当前源码中的 `issued.get` 与 Map.set 为准，不采用这些图边作为调用事实。未扩大仓库探索或修改图解析器。

## Persistence Decision

当前支持的是完成记录与已有 artifact 的读取，不是持久生产准入。模板和 preset 继续按原 owner 保存；JSON 中 shape 仍为 `NOT_EVALUATED`。序列化真实 PASS 结果、保留旧 handle 对象、完整输出文件或既有样片都不能在新进程中重建发布许可。

完成记录恢复不重新检查文件的当前完整性，也不能证明其后来未被外部改动；本次测试只证明在 fixture 文件保持原字节时恢复保留记录和文件。未完成任务即使正式路径已有文件，也不能猜为 completed。发布与 completed 保存之间存在未知结果时，保留文件及 interrupted 状态，不自动认领、不删除、不重新编码或发布。

因此当前普通 shape batch、追加、重放与重启重试继续 fail-closed。要支持显式重新准入，仍须实现并验证完整 request、原候选、冻结 PNG 和真实样片的主进程托管、版本/大小/路径限制、身份绑定，以及项目/版本授权、未知发布结果幂等核查和清理责任。仅增加 JSON 收据不足以合法支持；旧 PASS 不能迁移为 authority，重启不得自动调用模型。该能力没有在本轮实现或开启。

## Executable Evidence

在已有真实 FFmpeg、canonical admitted-mask 和模拟独立 reviewer fixture 上新增五项：

1. 对真实 PASS 结果做 JSON round-trip，缺失私有绑定时拒绝。重新加载 admission 模块后，把原始 handle 交给新模块也拒绝；没有附加 FFmpeg/复核调用。
2. 通过原队列发布真实批准样片，保存 completed，删除冻结 PNG 和样片缓存，再用新的 Queue/JobStore 恢复。completed 和正式文件原字节保留；请求 retry 不增加 attempt、不渲染或复核。
3. 分别把持久 JobStore 状态投影为 validating、running、verifying，同时保留已经发布的正式文件。recover 转为 interrupted；显式 retry 失败为 input_invalid，attempt 由 1 到 2；原正式文件不被替换，目录无新增输出，FFmpeg 与复核没有额外调用。

第三类是持久状态投影测试；第一类新模块实例是丢失私有内存绑定的测试。两者都不声称实际杀进程、OS 崩溃、fsync/掉电或 Windows 实机已验证，也不声称支持重启重试。

## Fresh Verification

读取并执行 `superpowers:verification-before-completion`，证据均来自本轮最后一次测试变更后的当前 working tree：

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS，exit 0 |
| `npm test -- tests/shape-cover-candidates.test.ts --maxWorkers=4 --minWorkers=4` | 50 PASS，exit 0，34.31s |
| `npm test -- tests/queue.test.ts tests/store.test.ts tests/state-migrations.test.ts tests/agent-preview-store.test.ts tests/append-production-queue.test.ts --maxWorkers=4 --minWorkers=4` | 38 PASS，exit 0，0.932s |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 135 files PASS / 1 skipped；1189 PASS / 3 skipped，exit 0，40.04s |
| `git diff --check` | PASS |

相关与全套均包含既有 manual、assisted、矩形与历史任务兼容测试；未改这些模式。测试来源仍包含前一检查点保留的本地随机模式未提交工作，不宣称独立 checkout 的测试结果。

官方只读 Verify、Aggregate Check、Guide 均 exit 0：158 sources / 158 entries，受管 missing/orphan/stale/unbaselined/line-ending-only 及 Volume mismatch 为 0，Guide `aligned / complete=true / next_action=none`，无 Recovery 或第三方正式字节冲突。受管源码、正式 cognition 与 baseline 未改变，不调用 Maintain，不盲目 baseline。AOCI 对齐仍属于包含其他保留改动的当前 working tree。

## Self-Review and Ownership

沿用 `superpowers:writing-plans` 对现有 plan 补充合同，并由 Parent Self-Review：源事实与准入 authority 分离；Spec REQ-05 的冻结重试要求不意味着任何 shape JSON 可执行；REQ-08/09/10 的最终像素、独立安全和 fail-closed 继续成立。没有改写 approved Spec 或放宽既有门槛。

稳定基点 `dc8cd81`，新增测试源码 SHA-256：`7fbb800c9705667e5435edd939e4547c1df34332068cf3140301e9e05430d9ea`。产品 owner 未改变：queue `d5526472e691f8b905579b32c3bf76eb989b69f073aceeeed4c1cfd997c8ec17`，admission `93d1a487c1da5f338648c0a2573b49083d55a2cf60aebb18708b0ca5431eef3b`。

Parent Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：本轮仅合同与测试补强，没有新增权限/凭据或持久副作用，也未出现关键级损坏路径；不需要外部 reviewer 代替当前源码和执行证据。用户禁止真实/付费模型及 Kimi 的边界保持有效。专门 session-record skill 在本仓未声明，本 milestone 记录承载本轮证据。

检查 live agents 只有 Parent；本轮三个目标文件无其他 writer 或预先存在的同文件改动。其他任务的所有 dirty 文件和 controller/runner 的 `usesModel` hunks 保持未提交；两个 `氨糖膏` 项目文件删除保持未暂存。只提交本 plan、测试和本记录。

## Remaining Boundary

当前恢复拒绝合同与测试无已知 blocker；持久重启重试功能仍未支持，原因是完整可追溯产物和发布幂等合同未实现。下一能力切片应先落实完整产物托管与显式 fresh 准入的合同，再实现对应行为；不得通过本记录直接放行 retry 或进入 M5。真实 reviewer、人工全片、用户素材泛化、掉电和 Windows 仍未验收。
