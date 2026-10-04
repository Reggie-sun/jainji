# Qianchuan Continuous Upload Implementation Plan

## Goal And Scope

同批每组最多 9 条文件进入原上传列表后继续下一组，平台处理不阻塞后来准入的成片。按 [Upload Spec](../../douyin-auto-upload-spec.md#61-continuous-file-delivery-delta) 实施；Native Codex 为 primary，不建立新 queue、ledger 或每账号并行调度。

## Contracts And Ownership

`DouyinUploadService` 独占投递/完成/停止生命周期，`QianchuanPageSession` 独占原页列表接收与完成观察，`DouyinCdpUploader` 只适配 CDP。文件动作前逐件快照校验、永久 fence、原页身份与整批容量不变。新行迟到允许至 fileInput 期限，旧已接收行必须存在。READY 仍要求全列表成功及可用确认按钮，绝不点击确认。processing 采用首组接收及等待状态保存后的固定总期限，新成片不续期。异常保留所有 fence，不重传，恢复只读。

service 及其主测试已获用户 A 接手授权；原视频库相关未提交改动保留，不 stage 本任务之外的 hunks。其他目标当前干净。持久 schema、账号绑定、导出并发和真实上传授权不变；fixture 不证明真实平台吞吐量。

## Major Milestones

### 1. Page Acceptance And Observation

修改 `src/main/qianchuan-page-contract.ts`、`src/main/douyin-cdp-uploader.ts` 和 `tests/douyin-cdp-uploader.test.ts`。文件动作等待精确行出现，允许旧 processing 行；新增只读非阻塞 `pollReady`，保留最终全列表 READY 判据。真实 CDP production-DOM fixture 证明旧组未完成即可投递下一组，缺行、错身份、容量、重排与确认边界保持拒绝。

### 2. Single Runner Continuous Delivery

修改 `src/main/douyin-upload-service.ts` 和受影响 service/integration/recovery 测试的 port fixtures。execute 窗口追踪全部选中成员，在只读观察之间获取同批 eligible 文件，其他批次不混入，重复字节沿用原去重路径。停止、取消、超时、fence/保存失败覆盖整窗口。

### 3. Verification And Delivery

先运行上传 focused suites 和 typecheck，再按 owned scope 执行原 Harness/completion verify；维护 changed indexed owners 的 AOCI Entry/baseline，observe 对象按 scope 处置，并执行正式 Verify/Check/Guide。Parent 在稳定候选上判断 SUBAGENTS Risk Gate。只提交本任务文件/owned hunks。

## Acceptance And Verification

- 21 条已准入文件按 9+9+3 投递；首组 processing 未完成时已有三次文件动作，后来完成的文件能加入原窗口。
- 最终全列表完成前零 READY，完成后每项证据匹配累计 fence 数及同一原页。
- 永久缺行、modal loss、失败、身份/容量异常停止，无重放、无确认。
- 停止/取消、fence 或持久保存失败不遗失前组记录；重启零选择，恢复只读，跨账号暂停不变。
- `npx vitest run tests/douyin-upload-service.test.ts tests/douyin-cdp-uploader.test.ts tests/douyin-upload-integration.test.ts tests/douyin-upload-recovery.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1`；最终按 Harness policy 扩展上传相关组并执行 typecheck。

## Self-Review

已核对 service/page/store 和 CodeGraph owner，覆盖推进、完成、异常、取消与恢复。列表接收不替代 READY；保留 SHA、防重传及人工确认。不设计迁移、发布或真实账号测试步骤。
