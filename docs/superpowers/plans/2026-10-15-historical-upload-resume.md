# Historical Upload Resume Implementation Plan

**Goal:** 用户可明确恢复完整且全部未选文件的历史上传批次，无需重新制作。

**Scope:** 批量上传详情、可信恢复请求、原服务整批准入与浏览器绑定。

**Contract Surfaces:** `BatchUploadResumeSchema` 增加可选 `historicalPageBatchId`；详情增加可恢复批次摘要。不变更 store schema，普通继续请求兼容。原浏览器重启仅端口改变时，沿既有原 profile 证明和原 store 原子归档路径建立新授权；旧授权保留，账号、计划、配置 digest、出口及字节不变。

**Invariants:** 保留冻结账号、计划、连接、出口、快照及永久 fence。已结束、删除、终止、别名、部分登记、已选或未知批次不授新权限。其他历史任务不恢复，有当前待执行工作时拒绝抢占。查询、启动和刷新不授恢复权。

**Current / Target Behavior:** 历史详情从无操作入口变为显式“恢复本批上传”，显示原账号/计划；主进程验证全部成员和快照、原配置及网页账号后，沿原队列执行与整批确认。

**Out of Scope:** 手工修改真实账本、自动恢复历史、切换账号/计划/出口、绕过网络核验、启动替代 profile。用户后续明确要求“改完真实上传”，纳入原 30 条批次的真实平台验收；未知结果停止，不能重传。

## Major Milestones

### Milestone 1: Guarded Admission

新增 `src/main/douyin-upload-recovery.ts`，负责整批资格及历史浏览器绑定核验；`douyin-upload-service.ts` 编排原控制链、generation、快照验证及运行内授权。复用原 selected-account-targets、store 和队列，不建第二生命周期。扩展 `tests/douyin-upload-service.test.ts`，先复现历史拒绝，再验证完整恢复、其他批次隔离、配置/账号漂移、已有 fence、取消与快照损坏拒绝。

### Milestone 2: Explicit UI Request

修改共享请求、batch controller/runtime 和 `BatchUploadDetails.tsx`；请求必须绑定 run/job 既有 task 的精确历史 pageBatchId，不接收替代目标或路径。仅可恢复批次显示按钮，错误留在页面。扩展现有 controller/renderer 测试，用隔离 fixture 做 Chrome 交互验证。

### Milestone 3: Verification And Delivery

运行 typecheck、受影响测试与 owned Harness；源码稳定后维护必要 AOCI。按 `SUBAGENTS.md` Risk Gate 评估 implementation review，检查最终 owned diff，保留其他会话变更，提交推送并核对远端 SHA。

## Self-Review

用户选择 C 授权补入口。仅明确请求的完整未选批次恢复；generation 变化和验证失败不授权限。未知结果与历史只读查询保持原边界，配置变化不能迁移原任务。

## Live Recovery Delta

真实诊断证明旧 IP 查询服务不可达，但原 SSH、千川及既有浏览器使用的 AWS IP 查询正常，且固定 IP 一致；隧道查询与浏览器查询统一到 AWS，保留 SOCKS、TLS、有限超时、精确 IP 和失败屏障。原浏览器通过软件明确重启后端口变化；只允许完整无 fence 的 current-browser 历史批次在原 profile/账号/计划/配置/出口验证后通过 store 归档旧授权并换用新 pageBatchId 和端口。非 current-browser 分支仍验证原 digest，端口变化拒绝。当前尚在制作的已授权 intents 也阻断历史抢占。Parent Self-Review：沿原 owner 执行、保留所有历史计数与 bytes；不从 READY/UNKNOWN 获得新权限。

连接更新的最终外部复核先于归档写入；复核拒绝保留原账本且不留下随机未提交提案，下一次显式请求可重新核验。归档仍先于原子账本迁移，写入或同步结果未知继续停用 store。迁移期间取消由 service 的 generation 复核阻断执行；原计划改传顺序保持原合同。

## Upload Document Identity Delta

真实首次恢复在文件 fence 前失败：原 uploader 创建并激活同账户的计划上传页，随后 `currentTarget` 使用 CDP 目录 controller 的概览身份方法；该方法拒绝非空 `adId` 和上传 drawer。修复 owner 为原 `content.js` 的只读身份投影及 `QianchuanCdpAccountSession.readBoundSnapshot`，不移除选文件前的账户核验。新增只读身份入口允许 `/uni-prom` 的唯一合法计划 ID 及现存弹窗，仍校验当前文档、唯一可见账户及 URL ID；目录 GET、切换、native 命令沿原严格准入。隔离 world 升至 v2，避免热重启复用旧 controller。用户选择 A 接手已有未提交的 CDP 文件及测试，仅提交本轮 owned hunks。

验证先用隔离 Chrome 复现同错误，再验证计划 drawer 的只读身份、错账户拒绝及目录请求仍零发出；typecheck、受影响 Harness、AOCI 与必要独立审查后沿原 30 条恢复。只读投影不授文件或确认权限，原 page contract 双 ID、modal 和 fence 保持。Parent Self-Review：修复校验职责混用，不改保存锚点、上传授权或结果解释。

## Current Account Transport Timeout Delta

氨糖膏新批次在选文件前的 raw CDP 读取中，因 `CdpConnection.detach` 的 150ms 确认期限失败；该明确运输超时被当成账户身份未知而要求人工。用户再次选择 A 接手 `qianchuan-current-account.ts`，保留已有 context 过滤改动。将 detach 等待调整为 1 秒，保留整体 4 秒读取期限与有界 socket 清理；detach 及整体期限仅以 `ETIMEDOUT` 标记已知运输超时，沿原服务至多 3 次未选文件重连。身份错配、页面歧义和已有 fence 的行为不变。

验证使用延迟 200ms 的真实本地 WebSocket 协议复现旧失败；新行为须成功读取、无应答有界失败且关闭自有 socket、整体超时可识别，原服务只投递一次文件；再执行 typecheck、路由 Harness、必要 AOCI、最终 Risk Gate 与提交推送。待当前制作安全结束并载入新代码后，沿原账号、计划、冻结文件及原批次继续实传，不强制终止正在导出任务。Parent Self-Review：改变有限运输预算及错误分类，不更改身份准入或未知结果恢复。
