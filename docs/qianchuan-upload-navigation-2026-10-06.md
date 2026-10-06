# Qianchuan Initial Navigation Incident

## Incident And Cause

用户新测蝴蝶贴 30 条批次在选文件前停住：首任务 `PAGE_CONTRACT_CHANGED`，其余已登记成员仍 PENDING；现场登记的四个任务均 NOT_SELECTED，没有 selection fence。冻结计划仍在对应账户列表且显示投放中，不能据此推定删除、容量不足或上传失败。

旧 `DouyinCdpUploader.open` 只打开带冻结 `adId` 的 deep link，随后立即执行完整详情 guard。平台清空该参数并停在列表时，即使目标计划仍存在也无法进入详情。真实浏览器进一步复现账号区/列表晚于 DOMContentLoaded 加载，首次列表导航须保留有界可见加载等待。

## Change And Boundaries

按 [Accepted Contract](douyin-auto-upload-spec.md#6-browser-and-batch-contract) 与 [Implementation Plan](superpowers/plans/2026-10-06-qianchuan-plan-navigation.md)，仅新建未选 tab 可从列表按唯一精确冻结 ID 打开唯一“素材”入口一次，随后仍通过原完整 guard。恢复路径、逐文件 fence、最多九条连续投递、整批容量和停在确定前的边界保持原 owner。

## Evidence

- RED：原实现对平台清空 deep link 的 fixture 报相同错误，`red.log` 记录 3 failed / 7 passed；不是实际视频平台验收。
- 修复后 isolated Chrome production-DOM [Navigation Regression](../tests/qianchuan-upload-navigation.test.ts) 13/13：成功深链及列表进入、延迟加载、错误账户/计划、重复目标/入口、缺失目标、错误详情、超时、取消、已有 modal 均覆盖。测试监测 file/drop/confirm/settings，拒绝场景零文件或确认操作。
- 真实对应 Chrome 的自建只读 tab：从无 `adId` 的计划列表，经当前 `openInitialPlan` 打开冻结计划 `1876036593854788`，最终广告主 `1876024170199244`、唯一详情 drawer、零上传 modal；从未调用 prepare/upload/confirm，结束只关闭本次自建诊断 tab。原用户页面保持。成功深链也通过完整 guard。
- 本轮工程产物位于 `.agent/harness/runs/20261006-upload-navigation/`：RED/GREEN、typecheck、focused tests、只读 live probe，以及 owned scope/Harness/completion 回执；最终工程结论以匹配源码字节的回执为准。
- 当前源码 typecheck 通过；相关五个测试文件的 104 个场景已获得通过证据：首次 focused run 在旧提示测试超时、临时 Chrome 目录清理 ENOTEMPTY；源码未变，单独复查 page-contract/diagnostics 两文件 26/26 通过，其余三文件原运行通过。保留失败日志，未放宽 timeout 或安全断言，后续必需 Harness 仍独立执行。

## Delegation And Completion Limits

受管 `external-subagent` Kimi deep 只读 fixture/test seam 调查：invocation `a1d073f7-6c9a-43f5-b6e6-d55dd873057e`，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，wire model `k3`、max。Parent 核验两份实际 Read 的完整范围和 SHA；报告关于 fixture 缺初始列表、取消 controller 和重复行 seam 的建议已由独立临时 fixture bootstrap 与测试补足。账户身份拒绝仍为 PAGE_CONTRACT_CHANGED；报告援用权限错误码仅作候选建议，未改变原分类。该调查不是 final implementation review 或 acceptance。

仓库无 dedicated session-record/capture skill，本文件记录本轮 substantial 修复与只读 live proof。当前测试批次没有被自动继续；历史用户已确认的 98 条 UNKNOWN 缺原列表证据，本轮不补写 READY、不清 fence、不重传。真实视频连续上传速度与后续平台处理仍须用户实际测试，详情导航成功不证明视频上传成功。

`make frontend` 的开发构建已重建 main，运行进程仍在等制作/导出/上传空闲后自动重启；不强行终止当前任务。用户后续产品测试必须使用自动重启后的进程，当前进程不视为已加载本轮修复。
