# Cross-template Batch Production

## Goal

左侧增加“批量制作”，选择多个已保存商品项目（例如蝴蝶贴、氨糖膏），逐项制作。每项全部导出并完成文件校验后才开始下一项；失败记录原因后继续下一项，取消则停止整批。

## Scope

- 每行选择模板、期望条数、用户手动展示文字、覆盖开关、价格显示时段（全程 / 前 5 秒）与保存位置。其余包装、覆盖位置、分辨率、帧率与格式沿用已保存项目。
- 条数按现有 `calculateProductionQuantity` 向上取整，单项沿用 `MAX_AGENT_OUTPUTS`。
- 用户再次确认保留完整轮次：33 条素材可以填写目标 100 条，实际制作 132 条。每项明确显示“想制作的视频条数”，目标与实际数量分别展示。
- `RecentProjects` 提供项目身份；`ProjectStore` 读取和校验项目；每项使用私有项目副本和现有 `ApplicationService` / `AgentController`。不自动切换或覆盖当前编辑项目，不把批量选择写回商品模板。
- 所有实际成片继续由唯一 `ExportQueue` / `JobStore` / `ArtifactVerifier` 执行和验证。新协调器只管理跨项目顺序和关联的原队列 task IDs，不另建渲染、导出、重试或文件验证生命周期。
- 批量结果页面直接展示各项进度、失败原因及成片操作；原模板文件保留，已生成的导出仍由原队列持久化。

## Contracts And Invariants

- 输入只接受注册的 saved-project ID；展示文字必须通过共享手动文字 schema。模型不能生成或改写价格。
- 开始时冻结各项项目副本和选项。手动覆盖沿用模板中已配置的位置和素材；缺少配置时该项明确失败。`assisted` 开启覆盖仍需要人工批准，不通过批量入口绕过该流程。
- 项目间严格串行，同一项目内继续使用现有队列并发能力。`AgentRun.finished` 不代表导出完成，需等待本项关联任务的 terminal 状态。
- 使用已保存的 Agent 模式时复用当前模型连接；本地模式继续零模型调用。批量期间禁止其他制作、模型切换、贴纸库修改和会抢占生产连接的操作。
- 输出使用原自动目录推导或本次系统对话框批准的手动目录，不从模板默认为未获批准路径授权。
- 取消 / 退出停止当前制作与其导出，并阻止后续项启动。应用重启只恢复报告并标记中断，不自动发起模型请求或重跑商品。
- 部分失败保留已验证产物；不会为了达到期望条数自动重试或补作。

## Milestones

1. 共享输入 / 报告合同、只读项目快照、主进程串行协调器及有界恢复。
2. 接入现有 IPC、队列通知、连接和退出边界，保持原单项目制作行为。
3. 左侧入口、逐模板设置表和批量结果，并提供真实界面交互与合成素材导出验证。

## Acceptance And Verification

- 两个不同模板可以一次选中，各项实际条数与向上取整展示一致，各自保留素材、价格、覆盖和输出设置。
- 第二项不能在第一项仍 `queued` / `running` / `verifying` / `cancelling` 时启动；首项失败会完成清理再继续。
- 参数编辑不改变已冻结任务；当前项目与原 saved-project 文件的创作配置不被批量入口改写。
- 模型 / 覆盖 / 输出目录准入继续由主进程和原 owners 拒绝非法组合；取消、重复启动和重启不会产生额外制作。
- `npm run typecheck`、相关 tests、构建、隔离 Chrome / Electron 界面检查及真实 FFmpeg 合成素材导出。模拟模型与合成素材不等于商业账号、Windows 实机或用户成片质量验收。

## Out Of Scope

自动发布、跨项目混合素材、生成价格、自动重试、半自动覆盖的自动批准、改变原素材、修改当前模板默认值。

## Verification Evidence

- 2026-09-28：`npm run build`（含 `npm run typecheck`）通过；相关 11 个测试文件共 188 项通过，其中批量协调器 14 项覆盖串行、失败继续、取消、准入、恢复、只读快照和持久化失败。
- `node scripts/production-interaction-smoke.mjs` 通过：制作 / 导出期间可编辑下一轮，已开始请求保持不变，重复开始被阻止。
- `scripts/batch-production-smoke.mjs` 在独立 Electron userData、Xvfb 和禁止网络的环境通过：两个商品各 2 条真实 FFmpeg 导出；覆盖开关、全程 / 前 5 秒分别冻结；第二商品的开始时间不早于首商品全部完成时间；原模板创作设置和当前编辑项目保持；保留时长与音频；首项缺失素材后继续下一项；停止整批；切换页面保留下一批参数；33 条素材输入目标 100 时明确显示实际 132。最新报告：`/tmp/jianji-batch-smoke-nF4Ure/report.json`。
- 使用应用已安装的 `tools/ffmpeg/bin/ffmpeg` 与 `ffprobe`。系统 PATH 的旧 FFmpeg 不支持原编译器所需的 `-fps_mode`，该引擎的失败未作为通过证据。
- Chrome MCP 的现有 profile 被占用，未终止用户浏览器；交互使用独立 Playwright Chrome / Electron。未调用商业模型、未测试 Windows 实机，合成素材验证不代表用户成片画面已验收。

## Review Decision

- 最终候选以当前工作区源码及验证报告绑定；机器可核验快照记录在 `/tmp/jianji-batch-review-decision.json`。Native Codex 保留实现与裁决职责。
- `KIMI_REVIEW_NOT_REQUIRED`：用户未指定本轮 Kimi 终审；新增调度没有凭据、发布或源文件破坏路径，项目身份 / 目录授权 / 价格准入继续由原 owners 校验；取消、中断、任务归属丢失和已入队后失败已有可执行覆盖。没有已知重大后果且仍未覆盖的语义缺口触发额外终审。
- 受管 Kimi `deep` 生命周期调查已调用，receipt 为 `ad5fc571-2e2b-491b-8fd4-d4f991d52dc7`，终态 `UPSTREAM_GENERATION_LIMIT`；未采纳不完整输出，父线程依据当前源码完成调查。
- `aoci.code.txt` 与 `.aoci/baseline.json` 存在其他任务的未提交改动。用户明确选择本轮保留索引、只提交批量功能；不覆盖这些索引字节。
- 无 repository 专用 session-capture skill；普通功能工作不触发 `agent-memory-capture`，不写入 bug memory 或全局记忆。
