# Qianchuan Historical Closure Implementation Plan

## Goal And Scope

让用户明确结束当前项目的历史本地上传批次，以安全切换账号到主体 VPS；覆盖完整 intents、部分素材准入的旧批次。仅使用现有 store/service、可信 IPC 和确认组件，不恢复旧上传、不执行平台确认/删除/重传。

## Contract And Compatibility

依据 [Upload Contract](../../douyin-auto-upload-spec.md#historical-admission-closure-delta)。保留 production 边界和当前项目锚点，历史列表与活跃任务分离。完整 closure 的持久格式不变；部分 closure 显式写入 admittedCount，原 expectedCount 和 intents/tasks/fences 不变。旧程序遇到新字段失败关闭，不做有损降级。

## Milestone 1: Explicit Historical Closure

Owner 为唯一 bounded worker：`src/main/douyin-upload-service.ts`、`src/shared/douyin-upload.ts`、`src/renderer/DouyinUploadPanel.tsx`、`tests/douyin-upload-closure-service.test.ts`、`tests/douyin-upload-closure-ui.test.ts`。

历史批次在当前项目单独展示并经过原确认组件；只有 closeBatch 改为读取原存储锚点，requireTask 的生产边界不改。验证重启/新 production 后结束可用、历史不混入活跃任务、原结果和 fences 不变、继续仍拒绝、异项目候选不展示。IPC 原项目校验保持。

## Milestone 2: Complete Intents With Partial Admission

同一 worker 扩展 ownership 至 `src/main/douyin-upload-store.ts`、`src/renderer/QianchuanUploadHistory.tsx`、`tests/douyin-upload-closure-store.test.ts`。Schema、store 和 UI 按 delta 实现 admittedCount，并从真实 taskIds 推导展示数量。原 strict 归档绑定、同步和 control generation 不变；必须完整 intents 且每个 task 能匹配原 intent，未生成成员只撤销权限，不补造记录。

验证部分准入的关闭和重载、原 intents/tasks/fences 原样、迟到 saveTask/saveIntents 与选择拒绝、损坏/缺失 intents 和别名仍拒绝。覆盖完整旧记录兼容以及 admittedCount 与真实成员不符时失败关闭。

真实切换预检发现旧 DISCARDED 成员仍触发浏览器保护，与固定出口 guard 不一致。同一 worker 增加 `tests/douyin-upload-service.test.ts` ownership，以真实 store 处置用例验证正常关闭可达且原 UNKNOWN/fences 不变；service 仅排除已处置成员，其他原浏览器保护不变。

## Verification And Delivery

先运行 focused red/green：`npx vitest run tests/douyin-upload-closure-store.test.ts tests/douyin-upload-closure-service.test.ts tests/douyin-upload-closure-ui.test.ts`，再 typecheck 和 owned Harness。Parent 执行真实 Electron/Chrome UI 确认验证、最终差异审查、AOCI、Risk Gate 判定和提交推送核对。若触发独立 review，绑定最终 snapshot 和实际 Harness 证据。

真实操作只处理用户已授权的两个 advertiser 历史批次，并逐项留存关闭结果与原任务/fence digest 对比；有不完整授权或其他不可解释记录时保留并报告，不直接编辑账本。随后经原应用 API 关闭旧本地浏览器、保存 B 设置、打开并核验 VPS 浏览器，读取登录后平台身份和计划。传输/远端选文件验收使用隔离样本，不制造平台投放动作。

## Self-Review

Scope、持久字段、兼容与 UI 数量解释逐项对应 contract；旧 production 和永久字节屏障保持。两个 milestone 由同一 writer 串行实施，parent 只写文档/验证证据，不与 worker 改同一文件。没有新增账号权限、付费平台动作、后台自动重试或第二恢复 owner。
