# Incident

用户正在制作 200 条成片，千川上传在原页面 8 条 READY 后停止。只读核对当前 `make frontend` 的 Electron、上传账本及冻结账号原 tab：第 9 条于 2026-10-16 04:02:43（Asia/Hong_Kong）发生 browser TIMEOUT，仍为 NOT_SELECTED 且没有 selection fence，却被记为 FAILED_TERMINAL。原页面保留 8/435；后续正式成片继续准入 PENDING。这里的制作完成数不代表平台已接收数。

现有重连只适用于整批尚无文件屏障的连接准备。已有 READY 后不自动重连是保护原页面的边界；缺陷是未选文件的准备超时失去了明确恢复入口。原始日志没有定位到更细的浏览器子步骤，不能据此声称已消除网络或页面延迟。

现场继续请求又被“仍在运行”拒绝。新增确定性回归复现第二个缺陷：恢复在等待成片准入期间尚未占住调度入口，`committed()` 抢先启动的空 runner 令本次恢复自我冲突。该拒绝发生在选文件之前，不表示原页面已经丢失。

# Repair

沿原 `DouyinUploadService`、store、page adapter 和恢复 owner 修复：

- 当前 CONNECTING_BROWSER / OPENING_UPLOAD_PAGE 阶段、无 fence 的 NOT_SELECTED browser TIMEOUT 保存为可明确继续的失败。
- 旧版本已经保存的终止超时，仅在已尝试、无 fence、无别名、非人工门且结果仍为 NOT_SELECTED 时投影为可恢复；查询不写回账本，也不自动恢复。
- 明确继续原任务或同批 PENDING 成员时识别该旧超时。仍先只读核对原 page ownership 和已选文件，再沿冻结授权选择剩余文件。
- 恢复请求在等待准入前保留恢复入口，直至控制操作完成；只有该控制操作可通过原 runner 排空其已授权任务，成片完成通知不能抢占。失败及取消也必须释放入口。
- 原页面丢失、未知结果、已有 fence、输入冲突、平台拒绝及其他终止失败继续保持原保护；不清理屏障、不改传目标、不新建替代页面。

用户选择 A，将上传 service 及对应测试交给本会话，原有清理与缓存改动保留。新增资格判断复用 `douyin-upload-recovery.ts`，不创建第二队列或恢复生命周期。

# Verification

新增回归先在旧实现观察到 3 个预期失败：第 9 条仍是 FAILED_TERMINAL；并另行复现准入与恢复的空 runner 竞态。修复后定向场景覆盖当前超时、旧终止记录、从同批其他待传任务继续、原页丢失、不可恢复终止错误及成片登记竞态。校验原 8 个 fence 不变、12 个文件各选一次，查询不修改账本，竞态下仍由一个 runner 接续。

运行目录：`.agent/harness/runs/20261016-upload-preparation-recovery/`。typecheck、受影响上传测试及最终 scoped Harness 的实际回执分别保存，不将 fixture、静态投影或索引对齐解释为真实平台接收。

# Runtime Boundary

`make frontend` 在生产任务仍运行时延后主进程自动重启。不能以源码重建代替当前运行实例已经加载修复的证明，也不能为加载修复而中断正在制作的批次。原 8 条仍以同页核查和最终平台回执为准。

# Review And Capture

本修复的验证与 completion 由原 Harness 和 Parent 决定。只读取原页面的恢复检查和永久 selection fence 保持不变；未选准备超时兼容不授予未知结果重传权限。仓库没有适用的专用 session-record Skill，本记录保存本次 incident、恢复边界及实际验证入口，不写全局 memory。
