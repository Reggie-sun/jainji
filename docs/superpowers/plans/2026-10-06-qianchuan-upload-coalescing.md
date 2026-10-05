# Qianchuan Upload Coalescing Implementation Plan

## Goal

修复计划仍有容量时，零散成片连续上传恰好累计到 10 条后入口禁用、后续停止的问题。当前页面证据见 [Incident Record](../../qianchuan-upload-disabled-2026-10-06.md)；遵守 [Continuous Delivery](../../douyin-auto-upload-spec.md#61-continuous-file-delivery-delta)。

## Scope And Contracts

`DouyinUploadService` 继续独占上传调度，`QianchuanPageSession` 独占页面准入。冻结成员、原队列正式成片、永久 fence、原 tab/modal、整批容量及 UNKNOWN 只读恢复保持不变，不确认、不删除列表项或修改页面禁用状态。磁盘格式和 public API 不变。

较大批次先收集最多 9 个不同字节的已准入成员；不足一组时，必须等全部预期 intents 已登记，且每个成员已正式准入或由原队列明确失败、取消、打断，或被可信制作 owner 取消。completed 但尚未准入不算收尾完成；准入仍在进行时不释放尾组。总数不超过 9 的批次保留原流式行为。

首次合批在连接和文件动作前完成，使用既有 processing 配置作为有限等待预算；后续合批消费原连续窗口的剩余 processing 预算，不延长窗口。停止/取消使用原 active controller。等待后续组时继续只读观察原页面；异常保留既有 fence，新持有文件保持 NOT_SELECTED。

## Implementation

1. 在 `src/main/douyin-upload-service.ts` 的原 execute 流程合批；持有成员进入原 active.ids 并移出 eligible，取消和失败处理覆盖同一集合。排除本组同目标字节，沿用原 duplicate 路径。
2. 新增 `src/main/douyin-upload-group.ts`，只读核对冻结 intents、已准入任务、明确取消和原 queue task 终态。该模块不保存状态、不建立第二 queue，不把一个 queue chunk 的完成当成整批齐全。
3. `src/main/qianchuan-page-contract.ts` 保留禁用入口拒绝，将泛化禁用诊断归为 PAGE_CONTRACT_CHANGED；真正的整批容量不足仍由现有容量校验处理。

## Acceptance And Verification

`tests/douyin-upload-service.test.ts` 覆盖 1 条后追加 9 条的时序，以 9+9+3 连续投递 21 条；未全表完成前零 READY。覆盖失败、取消、打断尾组、跨 chunks 登记、迟到准入、合批中的停止/超时，以及等待时原页面异常。旧恢复、去重、账号隔离和连接重试测试保持。

`tests/douyin-cdp-uploader.test.ts` 的隔离 Chrome production-DOM 场景复现当前组件的累计数等于 10 才禁用条件，验证 9+9+3 在处理期间继续，无确认或设置动作。该 fixture 不代表真实千川吞吐量验收。

使用本轮 owned Harness scope 运行 typecheck、完整上传相关测试及路由必需检查，再执行 completion verify；维护 changed indexed objects，并核对官方 AOCI Verify/Check/Guide。仅提交本任务文件及 AOCI owned hunks，push upstream 并核对远端 HEAD。

## Self-Review And Boundary

已核对 CodeGraph 与当前 service/page/queue 路径。原单 runner 及串行账号调度不变；首次合批可能等待后续导出，有限预算和停止均有可执行覆盖。当前历史 UNKNOWN 不重新选择；本轮不以 fixture PASS 声称旧 30 条已全部上传，也不强制重启正在制作的开发实例。
