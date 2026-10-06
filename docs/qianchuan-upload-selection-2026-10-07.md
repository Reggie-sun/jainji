# Qianchuan Partial Batch Selection Incident

## Observed State

2026-10-07 用户报告一根金、同批肥皂上传部分停止。首次排查只读取原 Chrome target 的有限 DOM 身份、行名、成功标记、入口布局和本地 ledger/fence；没有重选、确认、删除、结束批次或改写历史账本。

| Product | pageBatchId | Exported | Fenced / UNKNOWN | Original modal success rows | Never selected |
| --- | --- | --- | --- | --- | --- |
| 一根金 | `939e5d5a-b603-4749-a920-399020046e2e` | 30 | 18 | 9 | 12 |
| 肥皂 | `e065ffe2-c2d1-42ee-a383-ac5f5428aa2c` | 30 | 27 | 18 | 3 |

两页仍匹配原 target、冻结账号/计划和 modal session；已有成功行精确对应先前组。后一整组缺失；fence 不证明平台接收字节，缺行也不证明未上传。一根金外层 fileInput 超时；肥皂报 `PAGE_CONTRACT_CHANGED`，排查时其上传区域在可见范围上方。

后续于本地时间 02:02:59 再次只读核查，一根金同原 target/modal 的列表已变为 0 行，肥皂仍有 18 条成功行；账本仍分别为 18/27 UNKNOWN 和 12/3 NOT_SELECTED。未保留这段页面变化的动作或平台事件，不能推断缺行文件未上传、已确认或变化原因。该观察不授重传或清除屏障。

## Reproduction And Repair

原 production adapter 依次发送 CDP dragEnter/dragOver/drop，每次滚动区域后取完整区域中心并 hit test。旧 fixture 静态区域无条件接收，未模拟 loading 门控。简单 smooth scroll probe 未复现，因此不以滚动本身断言根因；新的有界滚动容器、超出可见区域的入口追加测试在旧 `drop()` hit test 处真实失败。

当前平台公开上传组件以 `disabled || loading` 忽略 click/drop；入口忙碌也可能静默不建行。公开资源 `1378.f245922a.js` SHA-256 为 `bfa302e71a8b6b4ce95f465b56160180156f589f581bd78a0cd19e08e8a8e2a2`，仅作调查依据，不复制实现。缺少事故瞬间事件，不能把某个机制宣称为两批全部历史未知结果的唯一已证根因。

[Page owner](../src/main/qianchuan-page-contract.ts) 改为原 modal 唯一“点击上传”的一次 native file chooser，采用控件的可见点击与自动滚动；loading 在固定预算内等就绪，持续忙碌在新增 fence 前停止。文件 action 前重查原页、已选行和 chooser 的唯一性、所属主 frame、detached/empty/multiple/type/accept；每组仍先同步全部永久 fence，再一次 setFiles。无重放或另一投递路径。全窗口 READY 与既有只读恢复保持。

## Verification Evidence

- 旧实现的 30 条追加回归在 hit test 失败；新路径同一 modal 连续 9+9+9+3，前组 processing 期间可追加，精确文件名各一次，零 drop/confirm/settings。
- 模拟仅前 9 或前 18 条成行、下一整组静默缺失：18 或 27 个 fence 保留 UNKNOWN，余下 12 或 3 条 NOT_SELECTED；恢复零新文件动作，重开 store 保留同字节 fence。已持久 READY 的旧窗口仍保留。
- 2026-10-07 `npm run typecheck` exit 0；三个受影响 Chrome suites 共 89/89 PASS，包含 busy、缺失/类型失配 chooser、计划漂移、取消、原 modal 稳定性及只读恢复。扩展回归发现计划状态 suite 的四个旧 drop 计数断言；适配为实际 files 事件后，该 suite 的 8/8 用例通过，原计划删除/只读边界保留。首次 Harness 继承其他项目缺少 cv2 的 Python，已记录中断；指定本机已验证的 Python 3.13/NumPy 2.2.6/OpenCV 4.12.0 后，原失败覆盖 suite 的 38/38 用例通过。最终 scoped Harness 和 Review Risk Gate 的机器证据由 `.agent/harness/runs/20261007-upload-unknown/` 持有，不把旧运行或 PARSED 当验收。
- 真实账号仅新建自有空诊断 tab，唯一“点击上传”产生本页主 frame 的 multiple detached input，accept `video/mp4,video/quicktime,video/mp4,video/quicktime`，files=0，列表 0 行。setFiles=0、确认=0；关闭自有诊断 tab，前存 targets 全保留。没有真实批量上传验收。
- 受管 Kimi explorer invocation `d8d0b3ce-70d8-4e6a-a8fc-b787fcb40cdb`，deep/max、实际 k3，由 qualified Docker route 完整读取旧 page/uploader/fixture/tests/spec；4 个请求、560.27 秒、exit 0、PARSED，source/artifact SHA 核验。报告证实拖拽送达与静态 fixture 的盲区，机理假设由 Parent 对照实际 source/DOM 裁决；不授平台成功或重传权限。

## Recovery Boundary

软件修复服务于后续新准入组。历史两批 UNKNOWN 不自动转 READY、不清 fence、不重新选择，也不点击确定。须在原上传页人工核查和处理该批；重新制作同目标同字节仍受防重传约束。原页成功行不代表已确认到计划、审核通过或开始投放。

## Checkpoint Record

本任务属于有 durable value 的软件修复和 live diagnosis；已评估 repository session capture routing，未发现专用 repository capture skill，使用本 incident record 保存事实与恢复边界。[Accepted delta](douyin-auto-upload-spec.md#native-file-chooser-repair-delta-2026-10-07) 和 [Implementation plan](superpowers/plans/2026-10-07-qianchuan-file-selection-repair.md) 约束范围；AOCI 只维护本轮 page owner 的 Entry/baseline，其他会话业务改动和共享索引结果保留。
