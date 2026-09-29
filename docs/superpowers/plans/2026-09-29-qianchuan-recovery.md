# Qianchuan Pause Recovery Implementation Plan

## Goal And Authority

修复真实验收暴露的暂停后整批恢复缺口，诊断第十一条缺行、页面丢失和禁用按钮。依据 [Spec](../../douyin-auto-upload-spec.md) §6–9、[原计划](2026-09-27-douyin-auto-upload.md) 和 [真实验收](../../qianchuan-blocker-repair-2026-09-29.md#real-account-acceptance)。当前用户已授权任务内恢复合同修订；下列边界是该合同的窄补充，由 Parent Self-Review，不增加用户审批步骤。

## Ownership

用户选择 A：原有脏文件仍归其他任务。Parent 只写 `src/main/douyin-upload-service.ts`、`src/main/qianchuan-page-contract.ts`，新增 `tests/douyin-upload-recovery.test.ts`、`tests/qianchuan-upload-diagnostics.test.ts` 与本计划、修复记录。不得修改 service/store/UI 现有测试、spec、账号设置、renderer、AOCI 正式索引和基线。当前 working tree 串行实施，不创建 worktree。页面诊断代理为 read-only，无文件 ownership。

## Recovery Contract Addendum

- `resume` 对 NOT_SELECTED 条目的“安全继续”授权同一个 `pageBatchId`、同一项目和冻结目标的待传任务，恢复 PENDING、同批未选文件的可恢复失败；不复活其他取消项、终止失败或 duplicate。使用原 runner，每组最多九条，整组 READY 证据持久保存后才推进。
- 显式继续后自动执行范围限该批；其他账号、其他批次及重启恢复的旧任务不得被此动作唤醒。该批后续正式完成通知可继续入账并执行。新的失败仍暂停，不能自动切账号。
- 同账号其他批次未解决任务，以及同批任何 UNKNOWN fence，阻止未选文件继续。用户要求保留的四个历史账号保持阻塞。fence 不可删除、改写或据“缺行”推断失败。
- 对 fenced 条目的“只读核查页面”仅核查原 target/tab/modal，不产生新文件选择。只有原页面确实关联、全组 READY 且保存成功，才能更新当时证据。后续文件选择仍需对 NOT_SELECTED 条目显式安全继续。
- 同批已有 READY 文件时，安全继续须先只读验证原页面并恢复 session；不能创建替代页面来假装原批恢复。页面丢失记录准确原因，保留已选文件 fence 和未选文件事实。
- 页面禁用按钮与文件缺行只产生有限、可操作的诊断。页面观察不收集完整 DOM、截图、HAR、网络数据或登录信息；业务原因没有可见证据时明确未知，不修改计划绕过。
- 文件选择后，列表行出现使用冻结的 `timeouts.fileInput` 作为独立观察窗口（默认 30 秒），已出现的行继续使用原 `timeouts.processing`。缺行到期保留 UNKNOWN 与 fence，不假定提交失败；较短的既有 processing 窗口仍保持原超时语义，不新增配置或自动重选。

## Major Milestones

### 1. Restore Only The Authorized Batch

Owner 为现有 `DouyinUploadService`；替换 `resume` 单条直执行的 unfenced 分支，复用 `runPending`、store 和既有页面 session。用独立失败用例验证暂停期间入账、九条分组、READY 保存边界、同账号其他批次及其他账号隔离、UNKNOWN 零重传、只读核查、取消和重启。

Verification：`npx vitest run tests/douyin-upload-recovery.test.ts tests/douyin-upload-service.test.ts tests/douyin-upload-store.test.ts tests/douyin-upload-integration.test.ts`、`npm run typecheck`。保持现有测试归属，只执行不修改。

### 2. Diagnose Page Blockers Safely

Owner 为 `QianchuanPageSession`；对 disabled 添加视频、原 modal 丢失和已选文件未出现给出具体 reason/next_action。service 保留 typed page 诊断，同时 fenced outcome 始终为 UNKNOWN。用现有隔离 Chrome fixture 与新测试验证零重选、零确认；真实原页仅只读取证。

Verification：新诊断测试及现有 CDP/page-contract 测试。真实第十一条绝不重选，氨糖膏不改计划。不可见的业务原因保留阻塞。

### 3. Verify And Deliver A Traceable Package

完成 typecheck、受影响 tests、build、普通/批量 Electron smoke 和适用 Harness。最终 stable snapshot 后判断 Risk Gate，required review 保存 predecessor、历史三次 Kimi receipt 与 native fallback 消费，禁止以新名字重置。当前旧 guard 的 native 第 2/3 轮只覆盖旧 bytes，新候选必须独立审查。

安装包只包含本窗口已验证、已审的语义，保留旧 release 回滚。源码完整 checkout 构建若依赖其他任务未提交代码，明确记录；不得把其他任务代码加入发布包。重启前检查真实制作/上传活动。桌面验证绑定 executable/app.asar hash；fixture 与真实平台验收分开，Windows 按用户要求不验证。

AOCI 仅运行只读 Verify/Check/Guide，因用户保留其他任务索引和 baseline ownership，不写它们；真实冲突仍存在时记录本轮未维护对象和精确 remaining work。仓库无专用 session-record skill，新增修复记录保存 checkpoint，不修改全局 memory。

## Self-Review

对照原合同和用户完成条件：保持单一 service/store/queue、可信 IPC、正式文件准入、九条分组、永久 fence、停在确定前；恢复授权只扩大到明确选定的同批待传项，未将只读操作变成上传许可。逐项取消不由批次恢复覆盖。每项分别有 executable seam；无法证明的原页面或平台原因保持阻塞，工程 PASS 不代替真实平台或人工观看验收。
