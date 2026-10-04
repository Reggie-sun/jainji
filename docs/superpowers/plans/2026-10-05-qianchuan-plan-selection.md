# Qianchuan Plan Selection Implementation Plan

## Goal And Scope

按用户选择，从所选 Chrome 账号读取有效计划，在单次制作、追加和跨模板制作中按名称与 ID 明确选择上传计划。2026-10-05 用户授权本 session 保留已有修改并接手 `douyin-upload-service.ts`、`index.ts`、`qianchuan-account-settings.ts` 的必要改动；不提交先前修改。

## Contract Surfaces

新增只读计划列表 IPC，请求只包含产品槽与期望 advertiserId；CDP endpoint 由既有账号 owner 取得，renderer 不提供路径、端口或 selector。计划列表每项包含 advertiserId、adId、name。

上传选择新增可选 `plan: { advertiserId, adId, name }`。新界面必须明确选择，换账号清空，异步旧响应失效。旧记录和旧调用的缺省计划解释兼容；已有冻结任务、结果、屏障不迁移。主进程对显式选择重新读取有效列表、核对广告主，冻结所选 adId，不修改全局默认计划。不同模板可共用账号但选择不同计划。

## Invariants And Compatibility

既有 `DouyinUploadService`、account settings / config reader、UploadAuthorization 和 upload store 继续独占授权与恢复。新计划发现模块只负责读取，单独标签页不改原上传弹窗、不选择文件、不确认、不改广告设置。使用现有 literal loopback discovery / guarded relay，保留原 Chrome。

目录完整性、分页界限、可见账号身份、重复或歧义 ID 无法确认时报告失败。名称用于展示；广告主和计划 ID 才是目标身份。预检和提交期间配置变化仍拒绝；旧任务缺少显式 plan 时保持原默认映射核查语义。未知上传结果、永久文件选择屏障和整批改传条件不放宽。

## Milestones

1. Browser reader：`src/main/qianchuan-plan-catalog.ts` 与独立测试由 bounded worker 独占；核对真实页面已观察的 plan cell 和 pagination selectors，以本地页面验证删除、分页、身份、歧义与取消。
2. Main admission：Parent 新增共享 plan schema / IPC，连接既有账号 owner 与上传 preflight/register/current-target。新增独立测试覆盖显式非默认计划、跨账号、删除、漂移与历史兼容；调整跨模板预检对显式计划的核查。
3. UI：Parent 新增共享计划选择组件，在普通/compact/跨模板入口复用。不会自动选择唯一计划；展示加载、空列表、失败和刷新，迟到响应不能写入另一个账号。真实隔离 Electron 验证选择、换账号、刷新、异常和每行独立目标。

## Verification And Completion

先执行聚焦测试与 `npm run typecheck`，再按 Harness policy 路由 owned scope；新路径需正规映射或明确 unmapped blocker。做非生产 fixture browser / Electron 交互，以及用户现有 Chrome 的只读列表核验；不把 fixture 或读取计划当成实际上传验收。维护本轮 AOCI Entry/baseline，官方 Verify / Check / Guide 后审查 owned diff，仅提交本轮文件或 hunks。稳定候选按 SUBAGENTS Risk Gate 判断独立 review。

## Self-Review

账号、计划、浏览器与批次分属既有 owner；没有新增队列或批准 owner。三入口使用同一选择合同；显式计划改变不写全局默认映射，避免多模板共用账号互相覆盖。所有恢复边界保留，当前正在导出的 200 条不受影响。以上 scope 已由当前用户授权，无额外设计批准步骤。
