# Qianchuan Batch Deletion Checkpoint

## Problem And Result

截图中的蝴蝶贴批次为 60 条：1 条有永久 selection fence、结果未知；1 条从未选文件但原页无法核查；58 条 PENDING。当前 DOM 中原 modalSessionId 缺失不能证明之前未上传；UNKNOWN 防重传暂停有合同依据。用户明确「删了就好」「都可以删除」，本轮提供整批删除，保留未知结果和屏障，不恢复这 58 条。

唯一 store owner 将完整准入、无 READY/运行任务的整批转为不可逆 DISCARDED。删除先独占归档原 intent/task、同步文件目录，再原子提交账本；输入授权、结果、失败诊断和 fence 保留。界面和待处理计数移除；旧恢复、改传、选择权限拒绝，同目标 hash 去重继续有效。删除本身不连接浏览器、不删除本地视频、不启动其他批次。trusted IPC 绑定 sender、当前 project 和任务身份；用户界面明确提示整批不可恢复，确认后调用 owner。

## Verification

- strict red：新增 store 回归在旧实现上因 discardBatch 缺失失败；green：7 项新 store/service 回归通过，覆盖 60 条删除、重启、部分准入拒绝、READY/运行拒绝、控制 veto、同步失败与防重传。额外诊断回归在旧 store 上失败，修复后通过：重启不覆盖已有未知结果诊断。
- `npx vitest run tests/douyin-*.test.ts tests/qianchuan-*.test.ts`：稳定源码 checkpoint 为 19 files / 251 tests PASS；安装包使用冻结的既有发布源码上下文，仅叠加本轮 7 个源码文件，在该上下文中另跑 18 files / 245 tests PASS。
- `npm run build`：typecheck、贴纸库验证、renderer/main/preload 构建 PASS。
- `npm run harness -- code`：PASS，最终回执 `.agent/harness/runs/20260930T071112Z-69a4f037`。
- 源码和实际安装包的隔离 Electron smoke 均 PASS，安装包报告 `/tmp/jianji-discard-smoke-8sje9D/report.json`；真实 Electron IPC、跨项目拒绝、先保留后确认删除 60 条、重启及原 fence 字节不变。Chrome MCP 因既有 profile 被占用不可用，采用独立 Playwright/Electron profile，不关闭其他浏览器。
- AOCI：本轮 7 个受管理对象维护完成，稳定 checkpoint 的 Verify/Check/Guide exit 0，Guide complete=true / next_action=none。安装后另一窗口继续修改 `src/main/qianchuan-page-contract.ts`，最终全库 Verify/Check 报该文件 stale、Guide 要求维护；本轮未改写该窗口的源码或索引对象。上述 7 个源码文件仍与安装包构建源逐字节相同。压缩后的完整 Overview 已重新传输 3 块，Attestation 请求因身份字段 schema 错误未获接纳，未继续重试，也不声明完整系统认知可靠。AOCI 不替代行为证据。

## Implementation Review Risk Gate

stable candidate 绑定本轮 7 个源码对象的 AOCI source_sha256（存于正式 Baseline），diff 只新增整批删除 terminal 状态及其原 owner/UI。`KIMI_REVIEW_NOT_REQUIRED`：用户未要求本 snapshot 独立 review；没有新凭据路径或跨项目授权，IPC 当前项目 gate 经隔离 Electron 拒绝测试；账本保持所有原 task/intent/fence，删除与同步失败均有可执行证据并可由私有审计核查，没有关键级持久数据损坏路径。删除零浏览器动作，运行态间隙由并发 stop/continue/retarget 及真实 IPC/restart 覆盖，剩余真实平台 DOM 不确定性不影响本地删除合同。既有 Kimi mapping 的 canonical receipt 为 `d1c7d638-e14d-4d31-a947-59d35f587692`，仅提供禁止清除 UNKNOWN fence 的调查证据，不作为 implementation review 或产品验收。

## Delivery Boundary

代码提交为 `ca2b93b` 与 `5588a70`。安装到 `/home/reggie/Applications/jianji/releases/qianchuan-batch-deletion-20260930-9f62a6c3`，launcher 已切换并启动该版本。`app.asar` SHA-256 为 `9f62a6c39c72a578fb4075c0fb024b03a666b0e3f0a5b8324a2eacd6872e9757`。基于已安装的 plan-target 版本冻结源码构建，未将共享工作区的无关改动打包；2150 个未变 packed 文件字节及文件元数据保持一致。

实际截图批次 `e7b0353b-12ca-42fb-a3ea-aa1060c292d7` 的 60 条已由 canonical store 转为 DISCARDED，并在重启后保持。原始 state、launcher、fence 及效果核对保存在应用私有备份 `/home/reggie/Applications/jianji/.backups/qianchuan-batch-deletion-20260930-9f62a6c3-recovery`；删除审计位于原上传目录 `discard-history`。150 份永久 fence 字节不变，502 份成片快照的大小、mtime、inode 和设备身份不变，未删除本地视频。

预检无活动之后、退出旧 app 之前，另有 9 条任务开始选文件，因而首次操作在提交前被核对断言拒绝。只读核查发现原眼贴账号 `1876294500004864` 的弹窗仍保留这 9 条，但目标计划显示已删除，不能证明上传完成。本轮没有选文件、点击确认或发布；canonical load 将这 9 条被中断的 UPLOADING 任务恢复为 NEEDS_HUMAN / MAY_HAVE_UPLOADED，并保留诊断和 fence。最终核对明确区分 60 条删除、9 条标准恢复与 433 条其他任务不变，不将全部账本变化归为删除，也不宣称所有账号已解除暂停。

效果报告 `/tmp/jianji-discard-live-effect-proof.json` 和安装后报告 `/tmp/jianji-discard-installed-proof.json` 均 PASS。安装后桥接方法存在、当前已保存项目恢复、活动上传数为 0，账本 SHA-256 在安装前后均为 `6d69ccd9a244751f2b8961381dc05722fde0d2480e45ad59082800f042dd257f`。隔离 smoke 和本地删除不等于真实账号上传验收；未知结果继续禁止重传。
