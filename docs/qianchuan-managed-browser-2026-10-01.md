# Qianchuan Managed Browser Verification

## Outcome And Scope

本轮针对“普通用户不会点击 Chrome 远程调试允许”调整新制作入口：简辑按 advertiser 建立私有专用 Chrome profile，显式打开或新制作时启动本机动态 CDP，后续复用账号窗口。首次登录仍由用户完成。个人 Chrome、登录凭据及历史冻结上传任务不迁移；上传仍停在确定前。

实现依据 [Spec amendment](douyin-auto-upload-spec.md) 与 [Plan](superpowers/plans/2026-10-01-qianchuan-managed-browser.md)。账号设置独占映射及生产准备，browser manager 只拥有启动和连接发现，不拥有文件选择、恢复或发布权限。新 IPC 仅接受原 strict 账号设置形状。

## Verification

- `npm run build` 通过；Harness `20261001T132813Z-f146b02a` 的 typecheck 与 241 个上传测试全部通过，无 skip。
- 浏览器、发现、账号设置及开发启动器定向测试共 58 个通过。隔离真实 Chrome 多次连接与跨 manager 实例复用通过，无许可提示；非法路径、歧义、超时、账号隔离、配置竞争及改名均有覆盖。
- `scripts/batch-qianchuan-upload-smoke.mjs` 通过：真实 Electron、FFmpeg、独立 Chrome profile 和本地拦截的千川页面，17 条正式输出、14 条 READY；正常账号分组为 1+9 与 2，故障账号 UNKNOWN 不阻塞另一个账号，重启不重新选文件，确认和广告设置变更均为 0。
- `scripts/douyin-upload-smoke.mjs` 通过：当前制作范围、持久标记、严格 IPC、项目切换、重启不重选及真实拖放边界均通过，确认点击为 0。
- 两个 smoke 使用应用安装的 FFmpeg/FFprobe；本机系统 FFmpeg 不支持脚本所需 `fps_mode`，其早期失败不计作通过。
- 实际开发软件中点击“打开账号浏览器 / 登录”成功打开蝴蝶贴专用窗口；`/json/version` 可访问，CDP 连接不需要 Chrome 临时许可。最终只读检查仍停在千川登录页，因此**新 managed 路径的真实账号上传验收尚未完成**。此前个人 Chrome 的 READY 不代替此路径验收。
- 本轮未更新安装包；开发软件已加载候选实现。Windows 未资格边界保留。

本地证据目录：`.agent/harness/runs/20261001-browser-discovery/`，包含 `managed-tests.log`、`build.log`、两个 smoke 日志及 AOCI 回执；Harness 完整回执位于对应 run 目录。运行资产不提交。

## Review Risk Gate

候选以本地 `final-candidate.json` 的 source byte hashes、HEAD、Spec/Plan hashes 绑定；本记录随同一提交保存。

判定 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求对该 snapshot 进行 Kimi review；检查的变更没有新增凭据读取、任意启动参数、非 loopback 连接、历史任务改写或绕过原账户/计划/fence 校验的具体关键级失效路径。连接失败后果为本次制作准入拒绝，平台文件动作仍由原 owner 校验并先写永久 fence。实际剩余缺口是用户尚未在新 profile 登录，代码审查不能替代该外部验收；原生测试、真实隔离 Chrome 及桌面 smoke 已覆盖启动、重复连接和上传联动。因此未满足“重大后果、实质验证缺口、额外审查增益”同时成立的条件。

本任务先前已执行受管 Kimi 只读 mapping，invocation `2cb37dcd-e444-464c-8204-8d3244e96df4`；它不作为 final reviewer 或平台验收。Parent 检查最终 diff 并保留其他任务的修改。

## Governance And Remaining Work

本轮 12 个 managed 对象完成 AOCI 更新；Verify、Check、Guide 均通过，Guide 为 aligned。共享索引及 baseline 仅提交本轮条目，其他任务改动保留在工作区。最后压缩后的完整索引已读完，但模型认知回执字段校验未通过，不将它作为完整系统认知或行为验收证明。

专用窗口首次登录完成后，继续从软件启动新批量制作，核对正确账号与计划、全部 READY 及零确认点击；旧 UNKNOWN 不重传。真实平台验收和安装包交付仍未完成。
