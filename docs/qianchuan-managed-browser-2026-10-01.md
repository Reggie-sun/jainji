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
- 首个 checkpoint 中点击“打开账号浏览器 / 登录”成功打开蝴蝶贴专用窗口；`/json/version` 可访问，CDP 连接无需 Chrome 临时许可。当时尚未登录；随后真实上传结果见下文 First Login Recovery。
- 本轮未更新安装包；开发软件已加载候选实现。Windows 未资格边界保留。

本地证据目录：`.agent/harness/runs/20261001-browser-discovery/`，包含 `managed-tests.log`、`build.log`、两个 smoke 日志及 AOCI 回执；Harness 完整回执位于对应 run 目录。运行资产不提交。

## Review Risk Gate

候选以本地 `final-candidate.json` 的 source byte hashes、HEAD、Spec/Plan hashes 绑定；本记录随同一提交保存。

判定 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求对该 snapshot 进行 Kimi review；检查的变更没有新增凭据读取、任意启动参数、非 loopback 连接、历史任务改写或绕过原账户/计划/fence 校验的具体关键级失效路径。连接失败后果为本次制作准入拒绝，平台文件动作仍由原 owner 校验并先写永久 fence。实际剩余缺口是用户尚未在新 profile 登录，代码审查不能替代该外部验收；原生测试、真实隔离 Chrome 及桌面 smoke 已覆盖启动、重复连接和上传联动。因此未满足“重大后果、实质验证缺口、额外审查增益”同时成立的条件。

本任务先前已执行受管 Kimi 只读 mapping，invocation `2cb37dcd-e444-464c-8204-8d3244e96df4`；它不作为 final reviewer 或平台验收。Parent 检查最终 diff 并保留其他任务的修改。

## Governance And Remaining Work

首个 checkpoint 的 12 个 managed 对象完成 AOCI 更新；Verify、Check、Guide 均通过，Guide 为 aligned。共享索引及 baseline 仅提交本轮条目，其他任务改动保留在工作区。当时压缩刷新曾遇到模型认知回执字段校验失败，未将它作为完整系统认知或行为验收证明。

## First Login Recovery

用户完成蝴蝶贴专用窗口登录后，通过真实软件“开始批量制作”生成本地随机三条，run `4b25b36d-3c8d-450f-93b7-b53ff0043a9b`。三条正式输出完成，但首条上传 `NOT_SELECTED` 超时，其他两条尚未尝试。实际新 profile 默认打开推直播间，未出现商品计划 drawer；另复现登录 `/home` 不被 discovery 接受、窗口宽 1234 时账号信息被响应式布局隐藏。失败第一批保留，未重传或删除。

修复共享计划路由 `#umg=1`、严格登录主页发现及新生产 tab 的窗口最大化，保留原可见账号与计划核验。四项 regression 在修改前均失败，修改后 105 个定向测试通过。广泛上传 Harness 首次发现 page-contract URL 断言仍期待旧入口，修正该断言后 `20261001T143315Z-b3be3235` 的 typecheck 和 243 个上传测试全部通过，无 skip；`npm run build` 通过。

再次从软件真实界面新建 run `92b740f6-392c-4ac5-bd94-2657f506bf62`，job `ff625ef8-6bf2-4d3d-a06d-4058cefe6bd9`，本地随机、手动覆盖、`usesModel=false`。开始前故意缩窄原账号窗口；软件自行新建正确推商品 tab 并最大化，三条正式输出全部完成，三条上传结果均 `READY` / `WAITING_FOR_CONFIRMATION`，每条 attempt=1、retry=0。输出目录：`/home/reggie/电商/蝴蝶贴/视频/10.1 22:28`。

最终双侧只读核对：软件作品页完成 3/3、上传 3/3、待上传/处理中/未知/需处理均为 0，标题“千川上传 · 蝴蝶贴”；原 Chrome target `6FF0FB239AC928D7D20699443A556C6A` 的上传列表恰有三条本轮文件，`已选择 3/107：`，可见账户 `1876024170199244`，计划 `1876036593854788`。页面被动审计记录只点击“添加视频”，拖放为 1+2，共三条；`confirmClicks=0`，无广告设置点击。原弹窗保留在确定前。READY 只证明上传列表完成，未确认、提交或投放，最终视频画面仍需播放确认。

用户所写 `.codex/config.toml` 的六个原账号 MCP 分别完成只读 `list_pages` 连接验证，配置未修改或提交。该 MCP inventory 不替代应用专用 profile 的登录和验收。本次 managed 真实上传只验证蝴蝶贴；其他专用账号和 Windows 尚未完成真实验收，安装包未更新，开发软件已加载修复。

## Follow-up Review And Governance

stable candidate 绑定于 `.agent/harness/runs/20261001-mcp-accounts/final-candidate.json` 的 HEAD、11 个源码/测试/Spec/Plan byte hashes，并附本次 Harness 和真实页面证据。Parent 在原生验证通过后判定 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求该 snapshot 的 Kimi review；无新增凭据读取、越权、durable-state 改写或关键级损坏路径；路由及窗口失败在原文件 fence 前停止，原可见双 ID guard 没有放宽。首次登录及响应式布局的具体运行缺口已由新 profile 实测及窄窗口 regression 覆盖，不存在额外 adversarial review 能补足的重大未决缺口。

本轮受管 Kimi 只读 QA mapping 调用 `17e5528c-2684-4b6b-bf00-afc44341a448`，canonical receipt 为 `OUTCOME_UNKNOWN`，第三次请求在响应体阶段未完成；未采用不完整结果，不作为实现审查或真实验收。Parent 独立复现、修复并裁决结果。

四个 managed 源码条目完成当前完整 AOCI 批次，Verify、Check、Guide 均通过，Guide `complete=true / next_action=none`；五个测试及本轮文档按原 observe scope 核对。只提交本轮源码和对应 cognition/baseline，保留其他任务改动。证据、页面截图、被动点击审计及原始失败记录位于 `.agent/harness/runs/20261001-mcp-accounts/`，运行资产不提交。未发现 repository 专用 session-record Skill，复用本记录保存真实复现及验收边界。
