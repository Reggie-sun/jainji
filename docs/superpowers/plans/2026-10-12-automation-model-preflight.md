# Automation Current Model Settings Implementation Plan

## Goal

修复改时间后仍受旧运行结果或保存时模型配置影响的定时任务。每次新执行读取“模型与 API”的当前有效角色配置，执行中不换连接；旧模型摘要不再要求重新保存任务。

## Scope And Owners

- `automation-model-binding.ts` 根据冻结制作输入计算实际创作、识别、复核或 Hybrid 角色，只读 canonical `ModelConnections` 的当前有效设置；私有摘要仅用于本次执行的漂移检查。
- `automation-runtime.ts` 保存素材、账号、计划与授权范围，保存/启用时检查当前模型就绪，执行开始时绑定本轮配置；删除保存时模型摘要比对及模型更新另存配方分支。
- `automation-scheduler.ts` 保留日期/时间修订、串行配置、原子持久化及未知结果停止；删除显式模型更新参数与配方指针改写。
- `automation-desktop.ts`、`index.ts`、`preload.ts`、共享 schema 与 renderer 接线原 owner；模型变化刷新当前就绪提示，编辑页删除模型更新勾选。

## Contracts And Compatibility

新配方不持久化模型摘要或角色；角色始终从冻结制作输入计算。旧配方的 `modelBinding`、`modelRoles` 和任务 `recipeId` 只供严格读取，仍参与配方内容摘要及身份核验，不再决定新执行的模型。旧文件和历史结果不改写，无自动迁移、重试、补跑或重新授权。

创建、启用与保存启用任务检查所需角色是否已配置；未使用的连接、改名和休眠 ChatGPT 状态不构成模型漂移。关闭自动覆盖的本地随机、人工覆盖以及独立上传已有成片不要求模型。缺所需角色在清理、制作、上传前阻断。

运行开始读取当前摘要，完整素材/账号检查前后及清理后、制作前核验同一摘要；运行中的连接变更仍由原 `assertProductionIdle` / `assertAutomationIdle` IPC 守门拒绝。canonical `assertConfigurationIdle` 保留在途配置保存保护；未使用 ChatGPT 的登录状态不单独阻断 API 任务，使用 ChatGPT 的角色仍校验模型就绪。角色或凭据缺失与运行中漂移失败关闭，不回退模型。凭据只在主进程参与摘要，不进入配方、renderer 或日志。

模型变化不重置日期领取与时间修订，也不改变素材、目录、账号、计划、文字或上传 claim。改时间仍按原 `scheduleRevision` 建立新安排。保存不会开始制作；原未知结果屏障保持。当前配置提示与历史 `lastRun` 分别展示；改时间后旧修订标为“上次安排的执行记录”，历史失败记录不作为当前故障。

## Major Milestones

1. 修改回归：新模型可以直接保存和执行；重启及旧配方指针仍可读取；旧字段篡改拒绝；缺模型在清理前拒绝；清理期间漂移阻断制作；独立上传不依赖来源任务模型。
2. 在原 owners 删除模型手动更新执行路径，统一新执行的当前角色准入；浏览器验证列表和已打开编辑页的实时就绪通知、恢复时清除过期错误且保留时间/启用草稿、无更新勾选、精确保存参数与历史保留。
3. 完成 typecheck、相关 tests、Chrome MCP 隔离交互、owned Harness、AOCI 维护与最终 diff；提交本轮接续文件并推送当前 upstream，核远端 HEAD。

## Verification And Self-Review

Focused command：`node node_modules/vitest/vitest.mjs run tests/automation-runtime.test.ts tests/automation-scheduler.test.ts tests/automation-desktop.test.ts tests/automation-ui.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1`。完整检查按 `.agent/harness/policy.json` 的实际 scope 路由；真实平台、模型额度和 Windows 实机不在开发验证范围。

Parent self-review：当前用户已明确授权本会话直接修改并在最终状态验证；新执行使用当前设置，兼容字段不保留旧执行分支；配方不重写避免损坏固定范围；旧上传 claim、历史结果和日期领取保持；没有新增队列、连接 owner 或 approval gate。原受管 Kimi 调查 `cfbc06cd-d984-47ad-9413-50fa7c360ec6` 提供模型绑定调查，Parent 依据原 controller 分支核对实际角色及 IPC 互斥，配置在途回归核验 canonical 守门。最终 implementation Risk Gate 在 project-native 验证通过后对稳定 snapshot 判断，调查不代替 required review。
