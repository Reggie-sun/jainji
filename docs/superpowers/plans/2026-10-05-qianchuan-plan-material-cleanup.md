# Qianchuan Plan Material Cleanup Implementation Plan

## Goal And Scope

用户选择 A：将计划内「审核不通过」「生态审核不通过」（没有该选项时跳过）和「审核通过可优化」的筛选删除补进简辑现有清理功能。本轮实现软件，不执行真实素材删除。手动清理提供独立入口；每日清空提供明确勾选和保存，旧设置不自动扩大范围。

## Owners And Contracts

复用 `DouyinUploadService.clearVideoLibraries` 的制作/导出互斥、账号编辑锁、generation、取消及排空；复用既有 trusted IPC/preload。共享清理请求增加两种明确确认：仅计划素材与视频库加计划素材。涉及计划时，每个账户必须携带 `expectedAdId` 并由 `QianchuanAccountSettings` 比较当前保存目标；连接继续由原浏览器绑定 owner 解析。

计划页面适配与删除审计各自放在 `src/main/qianchuan-plan-material-page.ts`、`src/main/qianchuan-plan-materials.ts`，共用现有 loopback CDP transport。只复用本功能自己的计划清理页，不导航、关闭或确认原上传页面。前端复用 `QianchuanVideoLibraryActions` 和 `QianchuanVideoLibrarySchedule`；不改已有其他会话的 `src/main/index.ts`。

## Invariants And Compatibility

- 只删除保存账号和保存计划的三类状态；普通审核通过、未审核及其他状态保留。可优化必须同时有通过和可优化证据，不能依名称模糊匹配。
- 一次打开更多筛选，一起勾选三类，只提交一次筛选，再按当前页批量删除；不逐类循环筛选。
- 原视频库清理 payload 和已保存定时设置保持兼容。新定时勾选必须绑定当前 `adId`；换计划后旧授权失败关闭，不自动跟随。
- 每次选择和删除前核对唯一账户、计划、主文档、筛选及逐行状态/素材 ID；确认限定本次唯一视频删除 modal，与上传确认分开。
- 每批确认前独占写入并同步持久意图；取消、页面漂移、未知结果或无进展停止，不自动重放确认。仅从新读取的明确当前列表执行新批，不清除上传 fence 或历史账本。
- 单账户最长30分钟、最多20000素材和1000批；各账号失败隔离。所有选中当前页素材必须匹配范围，不能跨页全选。

## Major Milestones

1. 核对真实页面筛选与删除弹窗，补充共享请求、预期计划检查及每日设置合同；保持旧默认范围。
2. 在原服务下实现计划页面和持久删除意图，并接入手动、每日清理；写可靠回归覆盖误删、身份漂移、取消和未知结果。
3. 运行 typecheck、上传域 tests 和 owned Harness，实际验证前端确认/取消及只读平台筛选；稳定后按 Risk Gate 做受管只读 Kimi review，维护本轮 AOCI 并提交 owned files。

## Verification And Acceptance

真实页面验证只做读取、筛选、选中和取消删除弹窗，零删除确认。浏览器 fixture 验证三类状态、缺生态选项、普通通过保留、DOM/响应和计划绑定、选择污染及未知停止；服务 fixture 证明仍由原互斥/排空 owner 调用。前端交互使用本地隔离 fixture，不消耗真实账号。工程通过不代表真实删除或 Windows 验收。

## Self-Review

本计划覆盖用户三类状态和可选项，不引入第二上传/定时 owner；新 destructive 范围必须明确确认，不修改旧任务。当前共有 dirty shape/文字文件及共享 AOCI 资产均保留，只有机器 AOCI 维护获授权；提交按本轮对象/hunks归属。代码验证后才启动 final reviewer。
