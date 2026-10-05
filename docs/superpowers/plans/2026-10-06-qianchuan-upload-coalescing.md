# Qianchuan Immediate Upload Implementation Plan

## Goal

按用户 2026-10-06 的速度要求修复批量上传：正式准入成片立即投递，每次最多 9 条，上一组 processing 时继续追加。accepted owner 为 [Continuous Delivery / Throughput Delta](../../douyin-auto-upload-spec.md#throughput-acceptance-delta)，验收见 [Harness](../../video-validation-harness-spec.md#qianchuan-upload-throughput-acceptance)。撤销此前“等满九条或全部制作结束”的推进条件。

## Scope And Contracts

`DouyinUploadService` 保持唯一调度 owner，`DouyinUploadStore` 保持唯一 ledger/fence owner，`QianchuanPageSession` 保持页面准入 owner。磁盘 schema、冻结授权与字节、原 tab/modal、整批容量、账号隔离、UNKNOWN 只读恢复和停在确定前均保持。只复用当前 working tree；不触碰其他会话 dirty 文件，不强制重启运行中的生产。

当前六条已准入成片被凑齐逻辑扣住，21 条 9+9+3 在一个 processing 窗口触发 105 次完整账本提交。目标是非空可选组立即发出，同组阶段和 fence 账本各一次提交，整个连续窗口 READY 一次原子提交；21 条相同场景为 13 次。

当前平台组件累计恰好 10 时禁用。只有会落在这个边界的组可缩至累计 9；单独第十条等待至少再一条一起跨至 11 或以上，或等待可信无后续成片的终态再作最终第十条。其余部分组不等。此未选等待超时保持 NOT_SELECTED / NEEDS_HUMAN，核查原页后显式安全继续；已有 fence 仍只读恢复。原 `douyin-upload-group.ts` 只读终态辅助只服务这一例外，不拥有新状态或资格。

## Implementation

1. service 回归先复现六条等待与 105 次提交。`src/main/douyin-upload-service.ts` 以原 active/controller/eligible 执行立即分组及最小十条边界避让。等待沿原有限 processing，不延长期限；同一窗口内等待持续只读观察原页，首次动作前等待结束后才连接并核验页面；取消/异常覆盖已选及持有成员。
2. `src/main/douyin-upload-store.ts` 的 `saveTasks` 为单条和整组更新共用 canonical 路径；`markSelecting` 同时接受单条或至多九条。完整组在写入前核验 frozen bindings、closed/discard/alias 和不可逆 fence；每个 fence 独占写入与 sync，全组目录 sync 后一次原子账本提交才返回选择权限。保持全量 schema/binding/归档验证。READY 采用整窗口原子保存，失败保留以前窗口 READY，当前有 fence 者保持未知。
3. service/store/native CDP 回归覆盖立即部分组、处理中追加、10 条边界、跨 chunks、在途准入、停止/超时、部分 fence 故障和重启只读恢复。Harness 复用既有 `douyin-upload` 必需检查及文件清单，policy route 绑定最新上传合同；不建立第二性能 runner 或生产队列。

## Acceptance And Verification

定向 red-green：`npx vitest run tests/douyin-upload-service.test.ts -t 'uploads six available|persists group phases' --no-file-parallelism --maxWorkers=1`。随后运行 typecheck、全部受影响上传测试及隔离 Chrome fixture，再按最终 owned scope 执行 Harness 和 completion verify。

项目验证完成后按 `SUBAGENTS.md` 在稳定 snapshot 判断一次 Implementation Review Risk Gate，不能将之前 source 调查当 review。最终维护本轮 AOCI indexed 对象并执行官方 Verify/Check/Guide，只 stage 本任务路径和共享索引 owned hunks，commit/push upstream 后核对远端 HEAD。

## Self-Review And Boundary

任务目标、single owners、必须移除的等待/逐条保存路径及保留的不变量已逐项对照当前源码和 CodeGraph。批量写减少重写次数，不削弱 durability；部分 fence 与原子 READY 故障必须有恢复证据。工程性能验证不证明真实平台网络或转码速度；历史 UNKNOWN 不重试，不扩展为自动确认/删除/换页。
