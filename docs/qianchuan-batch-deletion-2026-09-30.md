# Qianchuan Batch Deletion Checkpoint

## Problem And Result

截图中的蝴蝶贴批次为 60 条：1 条有永久 selection fence、结果未知；1 条从未选文件但原页无法核查；58 条 PENDING。当前 DOM 中原 modalSessionId 缺失不能证明之前未上传；UNKNOWN 防重传暂停有合同依据。用户明确「删了就好」「都可以删除」，本轮提供整批删除，保留未知结果和屏障，不恢复这 58 条。

唯一 store owner 将完整准入、无 READY/运行任务的整批转为不可逆 DISCARDED。删除先独占归档原 intent/task、同步文件目录，再原子提交账本；输入授权、结果、失败诊断和 fence 保留。界面和待处理计数移除；旧恢复、改传、选择权限拒绝，同目标 hash 去重继续有效。删除本身不连接浏览器、不删除本地视频、不启动其他批次。trusted IPC 绑定 sender、当前 project 和任务身份；用户界面明确提示整批不可恢复，确认后调用 owner。

## Verification

- strict red：新增 store 回归在旧实现上因 discardBatch 缺失失败；green：6 项新 store/service 回归通过，覆盖 60 条删除、重启、部分准入拒绝、READY/运行拒绝、控制 veto、同步失败与防重传。
- `npx vitest run tests/douyin-*.test.ts tests/qianchuan-*.test.ts`：19 files / 250 tests PASS；测试源码的类型收窄修正后重新运行 6 项新测试 PASS。
- `npm run build`：typecheck、贴纸库验证、renderer/main/preload 构建 PASS。
- `npm run harness -- code`：PASS，回执 `.agent/harness/runs/20260930T065407Z-6368dd04`。
- `xvfb-run -a node scripts/qianchuan-discard-smoke.mjs`：PASS，报告 `/tmp/jianji-discard-smoke-g82Zwl/report.json`；真实 Electron IPC、跨项目拒绝、先保留后确认删除 60 条、重启及原 fence 字节不变。Chrome MCP 因既有 profile 被占用不可用，采用独立 Playwright/Electron profile，不关闭其他浏览器。
- AOCI：7 个受管理对象维护完成，Verify/Check/Guide exit 0，Guide complete=true / next_action=none。AOCI 不替代上述行为证据。

## Implementation Review Risk Gate

stable candidate 绑定本轮 7 个源码对象的 AOCI source_sha256（存于正式 Baseline），diff 只新增整批删除 terminal 状态及其原 owner/UI。`KIMI_REVIEW_NOT_REQUIRED`：用户未要求本 snapshot 独立 review；没有新凭据路径或跨项目授权，IPC 当前项目 gate 经隔离 Electron 拒绝测试；账本保持所有原 task/intent/fence，删除与同步失败均有可执行证据并可由私有审计核查，没有关键级持久数据损坏路径。删除零浏览器动作，运行态间隙由并发 stop/continue/retarget 及真实 IPC/restart 覆盖，剩余真实平台 DOM 不确定性不影响本地删除合同。既有 Kimi mapping 的 canonical receipt 为 `d1c7d638-e14d-4d31-a947-59d35f587692`，仅提供禁止清除 UNKNOWN fence 的调查证据，不作为 implementation review 或产品验收。

## Delivery Boundary

实际账本清理需先确认旧 app 无制作、上传、导出活动并退出写入者；备份 state 与 fence，经 canonical store 仅操作截图批次，再核对其他批次不变并使用新 schema 的构建重新启动。隔离 smoke 不等于真实账号上传验收；本轮不向真实账号再次选择文件或确认。
