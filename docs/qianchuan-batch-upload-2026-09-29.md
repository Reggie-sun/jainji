# Qianchuan Batch Upload Checkpoint

## Scope And Behavior

用户要求“批量的也接上”。跨模板批量制作现在可为每个模板显式选择千川产品账号，默认“不上传”；成功提交后清空选择。主进程在首次制作前预检全部选择，以精确条数和独立 pageBatchId 冻结目标，授权仅在内存中保留。每项复用原 AgentController、ExportQueue 和 DouyinUploadService，不建立第二套上传队列。

只有原队列验证并提交的本次正式 MP4 可上传。上传组最多 9 条，整组 READY 持久化后继续；永久逐文件 fence、同批原页面归属、同目标字节去重和未知零重传保持。批量详情按 projectId 和该项 taskIds 展示上传状态，不切换编辑项目或提供跨项目确认、继续、重试入口。取消本项撤销自动上传资格并处理迟到准入，已 READY 和 fence 不删除。制作和导出结果不因上传错误回滚，原上传 service 的全局暂停保留。

## Verification Evidence

- 当前工作树的 typecheck、build 通过。相关 batch/details/service/UI 四文件 86 项测试通过，含无选择不上传、整批先预检、独立授权、失败项零制作、任务归属、取消迟到准入及 READY/fence 保留。
- 安装候选仅在前一安装版本冻结源码上叠加本任务文件构建，排除其他任务未提交代码；冻结构建通过。打包只替换 renderer 与 main，preload 和其余 2157 个文件保持原字节，7 个 unpacked 文件策略保持。
- `scripts/batch-qianchuan-upload-smoke.mjs --packaged` 在 `/tmp/jianji-batch-upload-smoke-s8kX0z` PASS：实际 Electron UI、production preload、FFmpeg 正式输出及原生产页面 adapter；两个隔离 Chrome 的生产 origin 请求全部本地拦截，未用真实账号。13 条成功导出，其中 12 条到 READY，另 1 条显式只导出；甲的 10 条分为 1＋9，乙为 2 条。追加故障验证 4 条仍导出完成，选文件后页面错误产生未知并暂停后一账号；重启零重复选择；确认和广告设置事件均为 0。
- UI 截图为同目录 `batch-settings.png`、`batch-ready.png`。测试保留原模板参数；活动编辑项目可由原队列自动保存本项目导出历史，这不属于上传授权或批量参数写回。
- 首次全量 Harness 各组通过，但其他任务提交文档导致 source identity 变化，回执 `.agent/harness/runs/20260928T221010Z-397d28ab/receipt.json` 为 NOT_EVALUATED，不计作整体 PASS。稳定状态复跑 `.agent/harness/runs/20260928T221611Z-cc796ebd/receipt.json` 为 PASS：typecheck、6 个测试组共 411 项、workspace identity 均通过；后续只补充本记录的结果文字，业务源码保持同一哈希。
- AOCI 本轮完整批次 10 项已应用，188 项受管理索引；Verify、Check、Guide 对齐，Guide complete=true、next_action=none。压缩后 Overview 交付已确认，但严格认知回执字段校验未完成；治理对齐不等于完整认知或行为验收。

## Candidate And Review Boundaries

源快照记录 `.agent/harness/runs/20260929-batch-qianchuan/source-snapshot.json`，identity `3a2f976f19f440dd2deccd9dcf2af4abdfffe86a981e6681b3516e27330d2b48`；绑定本轮源码及适用 spec/plan 哈希。安装候选 `/home/reggie/Applications/jianji/releases/qianchuan-20260929-batch-upload/resources/app.asar`，SHA256 `1718093c0d7f7ffa2e58d5c4b99b0b29c0a175916411b81a2a81761b444e77ea`；main `db58655ca39a1f81e809a4dce5a59a5fd606e8b2e7b7877c7328f0085e639b02`，preload `725104e0cfb869db6ac6f1705dfc4f7e876e64e0f5ffbe31ede03dd48976a3ef`。前一安装版本保留供回退，不关闭真实 Chrome 或改用户数据。

受管 Kimi 只读调查 invocation `b6fcc9c4-d456-4db5-914d-9a6d7f96e81b`、qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，canonical receipt 为 OUTCOME_UNKNOWN（第二请求 TLS_ERROR），无有效终结报告；未采用部分输出、未自动重试，也不算 implementation review。

本轮接缝的 Risk Gate 为 KIMI_REVIEW_NOT_REQUIRED：用户未要求对本快照 review；当前源码未发现可导致关键级凭据泄露、跨项目 authority 失效或持久状态损坏的具体 failure path。显式 selection、冻结产品/条数、原 digest guard、正式产物准入和双重详情过滤均由 unit 及隔离安装包运行证据覆盖，未新增凭据、IPC mutation authority、目标解析或页面文件动作；没有同时满足重大后果与实质验证缺口的新条件。真实平台/Windows 未验证不据此清除原 adapter 审查阻塞。

原生产 adapter 的 required Kimi review 仍为 REVIEW_ESCALATION_REQUIRED；三轮预算未重置，未发起第四轮。该阻塞意味着完整生产接入仍不能宣布最终验收。本轮只交付已验证的批量接缝及本地候选，不声称真实批量平台验收，也不新增真实视频上传。

## Live Read-only Diagnosis

用户截图中的蝴蝶贴 60 条任务已只读核对本地账本：首条为 NEEDS_HUMAN / NOT_SELECTED，失败码 CAPACITY_INSUFFICIENT，当前冻结计划剩余容量无法容纳整批 60 条。九条分组限制单次文件选择，不绕过整批容量校验。该诊断未连接真实上传页面、重新选文件、清除 fence、确认或修改广告设置；需要用户在平台处理容量，当前冻结批次不自动换计划。

## Record Evaluation

本次实现、隔离桌面和打包证据有持续价值，保存本 checkpoint；当前未提供 repository dedicated session-capture skill，不制造 capture_request 或替代验收。临时回执、浏览器 profile 与运行日志不提交 Git。
