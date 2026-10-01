# Real Batch Generation Acceptance

## Scope

用户要求直接使用软件真实批量生成，不再以离线测试代替实际运行。通过当前开发 Electron 窗口的 UI 操作，使用已有蝴蝶贴、热敷贴、一条根模板与真实用户素材，保持本地随机、覆盖开启、模板原有手填文字及前 5 秒显示设置。没有修改源码、重启软件、改写原素材或更改已保存模板输入。

本轮两批均明确选择“不上传”，没有选择真实账号、恢复旧上传任务、登录、确认或发布操作；`confirmClicks=0`。因此本记录只验收批量制作与文件生成，不验收真实千川上传。MCP 的独立浏览器为空白页，实际桌面使用 Playwright 连接正在运行的 Electron CDP，不启动隔离假页面或替换服务。

## Actual Runs

| Batch | 模板与条数 | 结果 | 耗时 |
| --- | --- | --- | --- |
| `f31b9579-afc3-4083-a52c-55f50fc7a217` | 蝴蝶贴、热敷贴、一条根各 3 条 | 9/9 completed，0 failed | 约 57 秒 |
| `47e5311a-3872-45d2-a8c8-8ddc5df6eb2f` | 蝴蝶贴、热敷贴、一条根各 30 条 | 90/90 completed，0 failed | 343 秒，约 5 分 43 秒 |

90 条批次从 `2026-10-01T12:26:24.850Z` 运行至 `2026-10-01T12:32:07.658Z`。第二与第三模板都实际进入制作与导出，非仅登记排队。成片分别位于 `/home/reggie/电商/蝴蝶贴/视频/10.1 20:26/`、`/home/reggie/电商/热敷贴/视频/10.1 20:27/`、`/home/reggie/电商/一条根/视频/10.1 20:29/`，保留先前成片。

当前运行选择 `h264_nvenc`，界面容量上限为 6 路；观察点实际运行导出为 2 路。贴纸变换与叠加仍消耗 CPU，不能由容量标记推断持续 6 路或纯 GPU 渲染。三个私有项目的 `latestProduction.usesModel=false`，本地随机计划路径不调用创作模型且手动覆盖不抽取模型帧；没有安装运行时请求计数器，不能把此声明写成实测模型调用次数。

## File And UI Evidence

- 首轮 9 个文件全部完整 FFmpeg 解码成功，没有解码错误。
- 第二轮 90 个文件逐条核对 FFprobe、文件大小及 SHA-256；全部 completed，音轨数量与原素材一致，原素材 fingerprint 全部未变。最大时长差约 0.055 秒，未声称逐帧、音频字节一致。
- 54 条成片带覆盖层，冻结数量与本素材实际手动框配置全部匹配；其余素材没有配置框，没有借“覆盖开启”臆造位置。
- 90 条冻结模板中的贴纸 fingerprint 各自互不重复。
- 第二轮每个商品选一条带覆盖的成片，3 条完整解码成功；核对原片与成片的 2 秒、6 秒抽帧。所见框内贴纸保留、主体可见，展示文字在 6 秒消失，普通贴纸继续显示。抽帧不替代全片人工观看。
- UI 逐项点击“查看作品”，三个详情标题均显示对应商品，没有串成旧眼贴项目；检查后返回批量列表，保留最新 90 条结果。

证据目录：`.agent/harness/runs/20261001-live-batch-acceptance/`。包含 `before.json`、`after.json`、`start-90.json`、`after-90.json`、进度、选中/完成截图、`media-proof.json`、`media-proof-90.json`、`media-summary-90.json`、`sample-decode-90.json`、`ui-details.json`、原片/成片联系图及 `runtime-proof.json`。90 条全部完成文件检查，未声称逐条完整解码或人工观看。

## Earlier Cancellation Diagnosis

检查时已有批次 `a21ac573-a34e-4f90-b78d-4ff5212948ac` 显示：热敷贴 10/10 completed，蝴蝶贴 7/30 completed、23 cancelled，一条根 0 条且 cancelled。同一时段开发日志存在 `main process rebuilt; requesting normal Electron exit`，随后 agent/queue shutdown。

源码确认当前 `scripts/dev.mjs` 对 main/preload 成功重编译发送 dev quit；`installDevelopmentQuit` 在启动完成后无 busy gate 直接退出；`src/main/index.ts:shutdownServices` 明确执行 `batchRuntime.controller.cancel()`。因此该开发重启路径确实能取消运行批次。日志与取消时段一致，但不能据此排除用户同时进行取消操作，也不能把所有历史失败都归于此路径。

该生命周期缺陷本轮未修改。真实制作期间没有写入主进程源码，避免主动触发重启；不能把本轮 90 条成功描述为开发热重启问题已修复。制作进行时改主进程仍有中断风险。

受管 Kimi 对封存的 dev/batch 源码进行了只读调查：invocation `66ae17d8-93fa-40ce-a501-c2e3344095db`，seal `0aa2d409eced7c82d66dbca4429add480330f2bd75ead379ca76c2d632f1d521`，receipt `PARSED`，2 个请求均 `IDENTITY_VERIFIED`。报告提出 busy guard；父线程另外直接读取 index 的退出流程，确认调用取消。调查不是独立实现 review，也不构成运行验收。

## Completion Boundary

本轮真实批量制作 9 条及 90 条通过上述工程检查；真实千川上传未执行，画面最终质量仍需用户全片播放。此前截图中的 CDP 失败在当前软件已显示三次连接尝试，但检查时没有对应账号的 Chrome 进程，不能用重试成功替代浏览器启动与登录。

本轮只有本记录新增，无实现候选，Implementation Review Risk Gate 不适用；没有修订模型、账号、上传屏障或应用退出策略。记录按 observe scope 处理，不新增 AOCI Entry。Verify/Check 对齐，Guide 为 `complete=true`、`stage=aligned`、`next_action=none`；不重写其他任务的共享认知资产。
