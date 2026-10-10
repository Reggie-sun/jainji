# Scheduled Automation Checkpoint

## Scope

已实现两类计划素材清理、固定模板制作、独立上传及清理→制作→上传的每日任务；界面显式保存并启用，关闭窗口后可留在托盘。实现与授权合同见 [Implementation Plan](superpowers/plans/2026-10-10-scheduled-automation.md)。本记录更新该 plan 文末旧阻断检查点的当前状态，不改写历史证据或授权。

## Verification

2026-10-11（Asia/Hong_Kong），当前代码候选的 Harness `20261010T153558Z-f9baae47` 为 16/16 PASS，包含 typecheck 和受影响回归；`npm run build` 通过。最终代码 completion verify `20261010T160149Z-fad60972` 及正式 AOCI 资产 verify `20261010T160132Z-2ae89e43` 均 PASS。业务范围为 `scope-alias-blocked.json` 中 35 个文件，另有两个正式索引资产。

隔离 Chrome 已验证创建、暂停、改时、删除以及 ACCEPTED 展示；独立 Electron 窗口验证隐藏和重新显示。真实 FFmpeg fixture 经原 Scheduler / Runtime / BatchProductionController / AgentController / ExportQueue 导出一条 1 秒成片，同日不重复执行。以上不代表真实千川操作或人工整片验收。

## Independent Review

受管 Kimi deep 审查 `ed934a9c-298a-4deb-8c5a-48b410c0fd33` 在精确源码快照上完成，canonical classification 为 PARSED；14 个请求身份均已验证，40 条实际读取证据，进程正常退出且未截断。qualification 为 `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，seal 为 `8daf05739fef0f3d0b7fdc4722104c66062de8aab2bee50102cefb55264e62b7`。父线程核对源码、产物摘要及 findings；没有未决阻断项。PARSED 本身不授验收。

- AUTO-R2-01：确认上传前失败也可能占用来源 run 的一次性 claim。保留当前保守行为：claim 表示已启动上传尝试，不代表平台接受；失败不自动恢复同一来源，不删除 claim 或重试未知。忙碌任务在 scheduler 准入处 SKIPPED；进入执行后遇到配置停用或竞争则 BLOCKED。可暂停该任务并检查原因，新制作具有新的来源 run。审查列为 non_blocking，此处不增加自动恢复合同。
- AUTO-R2-02：确认审查附件 risk-gate.json 的 ownedSourceHashes 混有前轮摘要。原封存附件保持原字节作为历史；`review-r2/final-adjudication.json` 提供从当前 scope 逐项重验的 35 文件清单，取代旧清单作为本轮 snapshot 引用。源码、实际 Read、read-map、Harness 和 canonical seal 均绑定当前字节；只补证据说明，不更改被审代码。
- 上传 stop 保留为用户中止入口；未知屏障不会因此解除。混合“已接收别名+新内容”的同一上传批次仍会停止，不自动缩小已授权批次；全批已接收别名可直接去重完成。独立上传仍要求冻结源素材保留。Windows 持久化未资格化，不能宣称 Windows 定时功能通过。

## Earlier Live Acceptance Boundary

没有创建或启用真实每日任务，没有新增真实清理或模型请求。新双层确认及 ACCEPTED 平台回执仍待真实验收，严格响应协议（包括 Content-Length）可能在平台变化时阻断。

此前唯一真实上传由用户手动完成最终确认，历史 pageBatch `5144529d-7f38-4fe1-aed1-3b8d504cd480` 继续 UNKNOWN，不重传、不补写成功。额外真实测试需新的明确一次授权；提交后只读检查已观察到会员状态 allowed / trial，执行前仍须复核。没有专用 session-record Skill，本记录承担本轮稳定检查点记录，不写长期 Memory。

## Authorized Live Probe Follow-up

用户随后明确授权热敷贴账号 `1876956000684231`、计划 `1877477842671690` 的一条新测试，包含两层确认；成片任务为 `82dd4af1-4788-468c-8cbb-75351455f061`，批次为 `da4098e6-6d5e-4188-8691-87ed011df492`。本授权不包含历史 UNKNOWN 重传。

2026-10-11 01:14（Asia/Hong_Kong）原应用会员状态已为 allowed / trial。此前主进程内验收等待登录超时，`live-5/result.json` 为 `started: false`，没有上传尝试。随后保留同一已登录进程，使用原会员校验、JobStore 和上传服务重新执行有界准入检查；`live-6/result.json` 在 01:16 返回 `Authorized canonical export binding changed`，仍为 `started: false`，没有选择文件或确认平台弹窗。

当前 primary 队列中该任务是 `verifying` 且没有 `outputArtifact`；带 completed / artifact 的旧记录在 `.json.corrupt-1791647222780` 隔离文件中。该隔离文件通过当前 QueueStateSchema 只读解析，但不能因此恢复 primary 完成状态或授上传资格；隔离原因尚未确认。本次不修改原队列或历史上传记录，不启用真实每日任务。真实双层确认与 ACCEPTED 验收仍为 NOT_EVALUATED，剩余阻断是该成片缺少当前 canonical 完成证据，不能用登录成功替代。

01:17:46 后续会员心跳又返回 denied / session-expired；未把先前 allowed 当成持续授权。临时主进程调试连接已关闭，生成 bundle 中的一次性验收 footer 已移除；原应用窗口保留，没有为本次复查再次重启、清除登录或修改会员实现。

## Live Platform Acceptance

2026-10-11 02:26–02:28（Asia/Hong_Kong），在当前会员 allowed / grant 的原主进程中，使用旧任务冻结的素材、模板、文字和导出设置，经原 ExportQueue 新建一次独立制作。新批次 `cbfa4f58-cdd2-4087-b26b-fafea908a040`、任务 `4babc946-24d0-48f2-8c9a-df5feaf69ffe` 在 primary JobStore 中为 completed，ArtifactVerifier 记录 9,159,956 字节、19,567 ms。新输出仅增加 `_1` 文件名后缀，SHA-256 为 `975d31e0bef258277a9d65e30610c051384d58bdafcdacbdbebf4cae17d0267b`，与用户已授权测试视频完全相同；没有恢复或改写旧异常完成记录。

沿用用户对同一视频内容、账号 `1876956000684231` 和计划 `1877477842671690` 的一次真实上传及双层确认授权，原 DouyinUploadService 完成新批次的唯一尝试。结果为 ACCEPTED / ACCEPTED、attempt_count 1、retry_count 0；平台视频 ID 为 `v03c8eg10000db587gfog65p242rrnjg`，回执时间 `2026-10-10T18:28:06.211Z`。acceptedEvidence 绑定同一账号、计划、文件、SHA、targetId、pageBatchId、modalSessionId、选中数量 1 和 attempt 1；请求摘要 `94448d910e17d5e95c21e2b15b72b07640f1bd91bc92d517b3bfe51ef3577a5f`，响应摘要 `621cd24be3c3c9c25c6a426c9c3c8753609c4afaed188af8b1cd5b833fa0fab1`。两层确认由程序执行，成功来自原被动观察器对绑定和添加计划素材的响应校验，未用弹窗消失或人工声明替代。

本机证据为 `/tmp/jianji-automation-20261010/fresh-production/result.json` 和 `live-7/result.json`；后者 historicalUnchanged 为 true。早先一次性等待及准入失败均没有选文件；本轮总计新增一条平台上传。没有启用真实每日任务，没有真实清理、模型调用或预算修改。该结果证明这条视频已被平台接受，不证明平台审核通过、开始投放、投放效果或人工整片观看。

## Read Failure Regression Investigation

修复前源码可复现：有效 primary 的读取出现 EACCES 时，readJson 将错误统归 corrupt，readValidatedJson 随后读取旧备份并替换 primary。隔离测试已在修复前观察到返回 backup，且期望 unavailable 的断言失败。这证实了同类最新记录被旧状态覆盖的缺陷，但历史 `.corrupt-1791647222780` 的首次隔离原因仍未知；不把该复现宣称为历史事件的已证实原因。

持久修复在原 store.ts 中区分读取失败和 JSON 解析失败：ENOENT 保留既有缺失记录恢复语义，其他读取错误返回 unavailable 并停止备份替换；真正 JSON 损坏仍可沿原恢复路径处理。测试用实际 EACCES 证明最新 primary 和旧 backup 的字节均保留且不产生隔离文件，并覆盖缺失 primary 的兼容恢复。修复后的 store、state-migrations 和 queue 定向测试为 34/34 PASS，typecheck 通过；权限测试仅在本次 Linux 环境执行，不证明 Windows 权限行为。

受管 Kimi deep 调查 `502be9ed-d5c9-4306-8433-9c9c234f253d` 在 seal `276e62cde290899cf0a6931972ce57356f35d1bec9cf30a9da371a9a98875470` 上完成，canonical classification PARSED，三个请求均 IDENTITY_VERIFIED，八条实际读取与产物摘要经父线程核验，进程正常退出且无截断。父线程确认备份替换及启动恢复能产生当前 interrupted 记录，但不接受其作为首次失败原因的证明。没有采纳“读取失败后再试一次仍可替换”的建议，因为重复 I/O 失败也不能证明主记录损坏；直接分类为 unavailable 可以保留未知状态。没有增加新的恢复入口或日志合同。重新制作已沿原队列完成，没有将隔离 completed 元数据写回 primary。

首次收尾 Harness `20261010T183400Z-b880173e` 的 typecheck、104 项 Harness 自测、15 项输出发布测试，以及 107 个扩展测试文件的 981 项测试均通过；整张回执为 NOT_EVALUATED，因为期间会员会话更新了共享索引，最后两项控制检查的旧 scope 后像不再匹配。该回执不作为完成证明。

补齐存储检查路由：store.ts / state-migrations.ts 及各自测试共用 domain-state-store，要求原 lifecycle 和明确的 store、state-migrations、project-sync、project-workspace 回归；原输出发布检查继续适用。其他扩展域贡献完整集合时仍执行全部扩展测试，新增 routing 回归验证这一合并规则。路由回归已观察到修复前失败和修复后 21/21 PASS；最终完成以当前 scope 的新 Harness / verify 回执为准，不复用失效的全库状态。
