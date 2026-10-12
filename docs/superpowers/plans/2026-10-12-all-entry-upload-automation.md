# All Entry Upload Automation Plan

## Goal And Authority

用户明确要求所有制作入口均自动上传、确认并完成账号轮转，无需逐批在 Chrome 点击确定。本任务修订 [Upload Spec](../../douyin-auto-upload-spec.md) 的普通上传停止边界；Native Codex 在当前工作树实现，不接管或重试历史待确认/UNKNOWN。

## Scope And Contracts

单项目、跨模板批量、追加与定时入口继续使用 `DouyinUploadService` 的预检、登记、正式产物通知与原队列；开启上传是本轮自动确认授权。独立上传仍沿原定时来源合同。关闭上传、assisted 的制作批准及清理授权不因本修订变化。

原服务独占任务、fence、READY 与 ACCEPTED。抽取既有一次性确认收尾为共享接缝，普通制作只在本运行登记完整的 `expectedCount`、全部同页面 READY 后调用；先持久化 UNKNOWN 和确认 intent，再点击两层确定，只有绑定回执才能 ACCEPTED。停止、配置或 generation 变化、文件变化、回执不符及 UNKNOWN 均不继续或重试。

VPS 浏览器使用原 `AutomationBrowserAccounts` 协调。普通预检逐账号打开核验后释放；正式上传串行持有当前账号，未完成整批不切换。完整 ACCEPTED 后关闭自有上传页与账号浏览器，再处理下一账号。当前制作中从未选择的后续任务可延迟浏览器准备；历史及已选择记录、未知结果仍阻断关闭。关闭失败保留 ACCEPTED 与原窗口并阻断后续账号。

## Owners And Milestones

1. 在 `tests/automation-upload.test.ts` 增加普通登记路径回归：完整批次自动确认、部分完成不确认、多账号串行、UNKNOWN 不切下一账号及停止不接纳迟到回执。
2. `src/main/douyin-upload-service.ts` 接入共同收尾；确认执行从 oversized service 抽到 `src/main/qianchuan-upload-completion.ts`，依赖仍由原 service/store 提供，不新增账本或队列。普通浏览器调度仅增加原 runner 的账号约束。
3. 更新普通上传 UI 与 README 的确认说明，运行 typecheck、受影响测试、隔离 Chrome fixture 与 owned Harness；稳定后按 Risk Gate 复核，逐项维护 AOCI，验证后只提交本任务文件并 push upstream。

## Acceptance And Verification

普通 `registerBatch → committed/runPending` 在完整新批次自动得到 ACCEPTED，不调用 `uploadAutomation`。9 条分组和连续准入保留；账号 A 未结束时账号 B 不选择文件；接收证据落盘早于页面和账号关闭。历史记录及只读恢复不获得自动确认权限。UI 各入口都说明自动确认。

使用 `npx vitest run tests/automation-upload.test.ts` 验证 red/green；`npm run typecheck` 与 policy 路由的相关测试核对集成。Chrome 只用隔离本地 fixture；未进行真实平台、真实账号、Windows 或人工播放验收。缺失/失败导出不能凑成完整上传批次或伪造接受。

## Self-Review

用户授权作用于新的制作上传流程，不能重解释历史 UNKNOWN 或点击已有未绑定页面。确认、持久屏障与关闭继续由既有 owners 负责；资源协调不建立第二生命周期。默认上传开关、账号计划选择与制作准入保持原合同。共享工作树中既有自动化模型配置等修改不属于本任务。
