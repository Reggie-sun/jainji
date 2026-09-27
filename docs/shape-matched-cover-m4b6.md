# M4-B6 Production Seam Wiring

## Status and Scope

2026-09-27，承接 `eff644a` 的 B5 owner，将其接入现有进程内 shape-cover 制作入口。沿用 [Spec](shape-matched-cover-spec.md)、[Plan](shape-matched-cover-plan.md)、[M4 Gap](shape-matched-cover-m4-gap.md)、[M4-A](shape-matched-cover-m4a.md)、[Recovery Contract](shape-matched-cover-m4b4-recovery.md) 与 [M4-B5](shape-matched-cover-m4b5.md)，只完成 bounded M4-B6，不宣称 V1 全部完成。

未修改 B5 artifact/IO、admission、candidate、store 或 renderer 的实现。没有 UI/IPC 激活、M5、重启重试或 authority recovery、全片自动 mask、moving sticker、delogo、真实产品 Agent、付费模型、Kimi、掉电或 Windows 验收，也没有创建 worktree。

## Production Call Path

源码核对后的路径为 `AgentController.startShapeMatched → startInternal → AgentRunner shape branch → ShapeCoverProduction.admit → ShapeCoverProduction.publish → ShapeCoverArtifactStore.publish → private publishOnce → ExportQueue.publishApprovedSample → canonical JobStore completed → output SHA verification → publication receipt → existing result`。

原路径在 fresh admit 后使用 Controller 的通用 `publishApproved`，直接进入 queue，B5 没有 production caller。现在 shape 分支退出该通用回调，带实际 `run.id / media.id / item.version` 调用 production seam。Controller 只注入当前 project、固定输出目录、原独立 reviewer 与 task-created 回调。production seam 只转交私有完整 request、当前模板、preset、样片和 opaque handle；没有复制 SHA、intent、重复判断、completed、receipt 或 publication retry 状态。

queue 的 factory 使用自身 canonical JobStore，在其目录下固定 `shape-cover-artifacts` root，先由 B5 constructor 验证 project，再创建共享根目录，避免不同素材并发首次初始化根目录的竞争。factory 不接收外部 ledger 或 root，不发布，不恢复 authority。JobStore 的 `loadAll` 只读取根目录 JSON 文件，不将托管子目录视作任务。新增异步初始化后检查 preparing signal，取消不能继续启动新 runner。

CodeGraph 已重新索引，并查询 `AgentController.startInternal`、`ShapeCoverProduction.publish`、`ExportQueue.createShapeCoverArtifactStore` 和 `ShapeCoverArtifactStore.publishOnce`。图确认 private publishOnce 到原 queue、capture、completed 和验证路径；匿名 callback 的部分边缺失，短名 `.publish` 被误归到 index 的同名函数。实际 receiver、factory 和 callback 关系以完整源码及集成测试为准，没有修改图工具。

## Authority and Reentry

全部 admitted masks、共同候选集合、冻结选款、每版本最终像素/PTS coverage 和四类独立内容安全仍先于发布。source-mask-only 只证明源事实；旧矩形、manual、assisted、普通 batch 及历史冻结/重试保留原路径，普通 shape enqueue/replay/retry 仍拒绝。

相同 live 输入回调重入由 B5 返回经过 JobStore 与输出字节验证的原结果，不再调用 queue 或 task-created 注册；变化的 run/version、handle 或其他绑定继续拒绝。新的 Controller start 会生成新 run，不是旧请求的 publication retry，也没有新增 retry API。

intent 写入后取消，或 queue 已完成但 caller 未收到正常返回，都保留永久屏障。缺 receipt 的 unknown 即使存在 canonical completed，也不能由本 seam 自动认领；`completed` 只读核验在该窗口仍拒绝，`load` 只返回 authority=none 的数据。独立素材键可继续正常完成，不宣称整轮事务回滚。没有删除 intent、重新 capture/编码或 catch 后第二次发布的恢复路径。缓存清理后的只读 completed 合同、整个托管根被外部删除/回滚的不支持边界沿用 B5。

## Executable Evidence

使用 canonical admitted-mask、模拟创作/独立 reviewer 和真实 FFmpeg/原 Queue/JobStore。既有四版本正例新增 custody 调用、完整 request/key manifest、queue 消费托管样片、receipt 与正式文件同字节断言；接线前同一正例 FAIL（期望 custody 4 次，实际 0），接线后 PASS。

新增四项生产入口集成测试：

1. 同键回调重入返回原 batch/task/output，不增加 queue、reviewer 或 task-created 调用；非法 project 在目录写入前拒绝，变化 version 和伪 handle 拒绝。
2. 原 queue 真实发布后注入返回丢失；再次进入同一 production callback 拒绝，正式目录无新增文件、无第二次注册或复核，JSON load 无 authority。
3. custody factory 返回期间取消；Controller 不启动 runner，不创作、不复核、不发布。
4. intent 实际落盘后取消；没有 queue 发布/注册或正式输出，intent 保留。

既有缺 mask、空共同集合、设置/时段/资产/源漂移、选款错误、内容 UNKNOWN、取消以及 B5 损坏/未知/并发测试继续通过。模拟 reviewer 只用于接线证明，不代表真实语义验收或人工全片观看。

## Fresh Verification

已读取并执行 `superpowers:verification-before-completion`，以下来自最后一次源码与测试变更后的相同 working tree；四个接线 owner 与测试 SHA 在全套后复查不变。

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS，exit 0 |
| `npm test -- tests/shape-cover-candidates.test.ts tests/source-mask-admission.test.ts tests/shape-cover-pixel-gate.test.ts --maxWorkers=4 --minWorkers=4` | 3 files，94 PASS，exit 0，84.12s |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 135 files PASS / 1 skipped；1219 PASS / 3 skipped，exit 0，84.72s |
| `git diff --check` | PASS |

官方普通 Maintain 完整四项 code batch `57830b32cb5d300ad2937d69ff4dad18ec79f8d14759fad680af1a283e4caa50` 原子 apply 4/4、remaining=0、无 findings；随后依次 Verify / Check / Guide 证明 aligned。另通过官方 `intent=cognition_optimization` 对唯一指定的 artifact 条目更正“尚未接入Controller”的过时语义，完整单项 batch `225e8f81593788f58e7e06411fa09f56c6d928375fc88ebd019a758efcc75ebc` apply 1/1；没有为此改 B5 源码或盲目 baseline。

最后一次官方 Verify / Aggregate Check / Guide 均 exit 0：160 sources / 160 entries，所有受管 missing/orphan/stale/unbaselined/line-ending-only 为 0；structure valid，findings 为空，无 Volume mismatch、Recovery、pending transaction 或第三方冲突；Guide aligned / complete=true / next_action=none。正式维护文件仅 `aoci.code.txt` 与 `.aoci/baseline.json`。

上下文压缩后 Whole-Index 三块完整交付，Host 确认、Challenge 10/10，索引覆盖率 100%，框架掌握度自评约 90%；当时四个 owner 尚 stale，不能据此声称当前完整系统认知可靠。维护后的治理对齐是独立机器事实；没有为了刷新认知重复普通 Maintain/Overview。全部工程结论以当前源码与执行证据为准。

## Snapshot and Parent Review

稳定实现快照的父 HEAD 为 `9d5a08c`（`eff644a` 的后继，其他任务 Qianchuan 文档提交保留）。以下 SHA 绑定测试时完整 working-tree bytes，包含获准保留但排除本次提交的 usesModel hunks；不宣称 clean checkout 验证。

| Path | SHA-256 |
| --- | --- |
| `src/main/agent-controller.ts` | `f371884efc6bbc2cea061dde9bce88e4a5d88cd2c925efe1f48d030711c55d9a` |
| `src/main/agent-runner.ts` | `aa00c5c6cc54ff6f6c10beebb1dd97a183522c76b0df0be0900e7bb45ba07b30` |
| `src/main/queue.ts` | `9bb8550c0f8390c78ef17b3798705a60a6d9c25df2d1c9318b10945768410187` |
| `src/main/shape-cover-production.ts` | `6daf6fabdfae8e30e01ad3536802e8c04c2a2822432cdaa0ba27a46a9235cec5` |
| `tests/shape-cover-candidates.test.ts` | `5d4ba94b9f3cea35943096925eedf1c2aca3e2252993c83764398468bb5c8dc3` |

Spec SHA `b2bf7538f4ee54a5ab68b8cbd156c3026385f90b47cdbe7302448a35a08a26e2`，Plan SHA `d582710f6f2cf67f2b1ba0e6ae8174f3071a9ddaa143ab24ff412e6c6828db58`。B5 artifact/IO SHA 保持 `99a272184d1912a0f0585e53cfdfa373f61bfae16845e5236a8eabfce83cab53` / `2135a48b2a99729812d71c0a984679129000a1ff8eb932eb03794b881d53149e`。

Parent 完成 plan Self-Review 与最终 source/diff review。project-native verification 后，Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求 review 且明确禁止 Kimi；本切片没有新增凭据、跨项目授权或恢复/覆盖既有 durable 状态的路径，project 来自当前项目并经 B5 验证；没有关键级损坏的具体路径。unknown 永久关闭、重复去重、实际正式字节和初始化/intent 后取消已通过原队列可执行验证，未留下重大后果与实质验证缺口及独立 review 增益同时成立的触发证据。未调用或声称任何独立 reviewer 语义验收。

live agents 只有 Parent。用户明确选 A 授权串行接线；原 controller/runner 的三处 usesModel hunks 保留并排除提交，其他 dirty 文件和两个 `氨糖膏` 项目删除不 stage/commit。仅提交四个接线 owner、相关测试、plan、本记录和官方两项维护文件。已评估 session-record trigger，本仓没有声明专门 capture skill，由本 milestone 保存合同、snapshot、验证与边界。

## Remaining Boundary

M4-B6 接线无已知 blocker，停在本稳定检查点。进程内生产回调已经过 B5 custody/barrier；持久重启重试、显式重定位快照的 fresh 准入和授权/取消/unknown reconciliation 仍需另行明确合同，不由本次接线放行。UI/IPC、M5、真实服务、人工全片、掉电与 Windows 保持未启用或未验收。
