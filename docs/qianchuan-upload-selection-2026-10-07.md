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
- 首次修复阶段，真实账号仅新建自有空诊断 tab，唯一“点击上传”产生本页主 frame 的 multiple detached input，accept `video/mp4,video/quicktime,video/mp4,video/quicktime`，files=0，列表 0 行。setFiles=0、确认=0；关闭自有诊断 tab，前存 targets 全保留。该阶段尚未开展真实批量上传；后续结果见下方 Live Acceptance。
- 受管 Kimi explorer invocation `d8d0b3ce-70d8-4e6a-a8fc-b787fcb40cdb`，deep/max、实际 k3，由 qualified Docker route 完整读取旧 page/uploader/fixture/tests/spec；4 个请求、560.27 秒、exit 0、PARSED，source/artifact SHA 核验。报告证实拖拽送达与静态 fixture 的盲区，机理假设由 Parent 对照实际 source/DOM 裁决；不授平台成功或重传权限。

## Recovery Boundary

软件修复服务于后续新准入组。历史两批 UNKNOWN 不自动转 READY、不清 fence、不重新选择，也不点击确定。须在原上传页人工核查和处理该批；重新制作同目标同字节仍受防重传约束。原页成功行不代表已确认到计划、审核通过或开始投放。

## Checkpoint Record

本任务属于有 durable value 的软件修复和 live diagnosis；已评估 repository session capture routing，未发现专用 repository capture skill，使用本 incident record 保存事实与恢复边界。[Accepted delta](douyin-auto-upload-spec.md#native-file-chooser-repair-delta-2026-10-07) 和 [Implementation plan](superpowers/plans/2026-10-07-qianchuan-file-selection-repair.md) 约束范围；AOCI 只维护本轮 page owner 的 Entry/baseline，其他会话业务改动和共享索引结果保留。

## Live Acceptance

用户声明已在千川核对并处理原两批，并授权本地结束后使用新成片实传。2026-10-07 15:30 对两批调用受信任的 `douyinUpload.closeBatch`，主进程均拒绝：`本任务不属于本次制作，历史上传不再处理。` 因此两批未在软件内结束，ledger 没有变化。原历史只读约束和永久同目标字节屏障保留；新的原生 `beginProduction` 只准入新制作，不恢复旧任务。受管 Kimi explorer invocation `a296b921-03bb-4054-9bd2-a6c85d3ae7b5` 的 qualified Docker deep/max route、实际 k3 和源码/产物 SHA 已核验；其只读作用是核对该 scope 行为，不构成 implementation review 或平台验收。

首次新成片 run `ef730516-3ddc-4692-afa9-bc7246bee39f` 导出各 30 条，但大文件追加被软件传输层拒绝。原生异步准入排空后的实际账本如下；首次观察结束时一根金仅登记 26 条，不能把该中间数量当最终数量。

| Product | New pageBatchId | READY | UNKNOWN / MAY_HAVE_UPLOADED | NOT_SELECTED |
| --- | --- | --- | --- | --- |
| 肥皂 | `133a0326-4126-4bb0-a6d3-0ca25d98024a` | 1 | 5 | 24 |
| 一根金 | `169b915d-1549-475e-a2e8-cc5867672469` | 0 | 9 | 21 |

当前安装的 Playwright 1.63.0 默认把未声明 `isLocal` 的 CDP 浏览器视为不同主机；其本地文件递送在组总量达到 50 MiB 时抛出 `Cannot transfer files larger than 50Mb to a browser not co-located with the server`。小文件 fixture 没有覆盖该边界。这解释了本次实传的小首组成功、大追加组失败；不能倒推所有历史事故均由该机制造成。

[Uploader owner](../src/main/douyin-cdp-uploader.ts) 在原已校验的 loopback、同端口 WebSocket 和拒绝 redirect 的连接上声明 `isLocal: true`，让同主机 Chrome 使用本机冻结路径。该选项是 [Playwright 的公开同机 CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp-option-is-local)。唯一 chooser、最多 9 条、fence、原 modal、只读恢复及人工确定边界均保持；没有修改依赖、媒体编码、队列、账本或重传规则。

两个隔离 Chrome 回归分别在小首组后追加 51 MiB 单文件、9 个 6 MiB 文件。原 uploader 上两例均真实失败，加同机声明后两例均通过，核对同一 modal、精确各一次文件组及零 drop/confirm/settings。随后 typecheck exit 0、受影响四个 suites 99/99 PASS；本轮 owned-scope Harness 五项 required 全 PASS，27 个测试文件共 597 个用例，0 failure、0 skip。源码 scope 和当前回执由 `.agent/harness/runs/20261007-upload-acceptance/scope-code.json`、`.agent/harness/runs/20261007T080053Z-70fa5a8a/receipt.json` 持有；首次只读 completion 核验为 `20261007T080420Z-c0728d06`。Parent 在该稳定候选上裁决 `KIMI_REVIEW_NOT_REQUIRED`：没有凭据/authority/durable-state 变更或重大未覆盖语义缺口，实平台结果单独验证。

修复后的唯一复验使用原应用“开始批量制作”，run `bab195d3-05a0-462f-a457-a7082c6d0537`，香港时间 16:04:45 至 16:14:41。仅选两模板各 30 条，本地随机、关闭覆盖，原手填文案、账号和计划保持。60 条原队列成片全部 completed，失败 0；肥皂输出在 `10.7 16：05`，一条根输出在 `10.7 16：10`。肥皂同一原窗实际接收了约 218 MiB 的追加组；两账号最终结果如下。

| Product | Advertiser / Plan | pageBatchId | Original modal final count | Software result |
| --- | --- | --- | --- | --- |
| 肥皂 | `1876414814643802` / `1876591298030592` | `a57fed4c-fdcd-4890-8c33-ee0979b1c7ae` | `30/261`，精确 30 行全部成功 | 30 READY / WAITING_FOR_CONFIRMATION |
| 一根金 | `1876131703522649` / `1877582409449488` | `71aeabc1-ef92-4d04-a325-25b1b1fbcf43` | `30/268`，精确 30 行全部成功 | 30 READY / WAITING_FOR_CONFIRMATION |

原页只读终验重新核对两个 target/modal、账号/计划、30 个精确文件名、每行两个可见成功标记、无取消上传及唯一可用“确定”。60 个输出与私有冻结快照 SHA 全部相同，且不同于同目标全部历史字节；原两批与首次失败两批共 120 个历史任务及已有 fence 的字节全部保持。应用开始动作 1 次，平台确定 0 次、广告设置动作 0 次。本次复验没有新增 UNKNOWN、失败或重选。

原始时间序列、最终任务、逐文件 SHA/大小、target/modal 身份和截图由 `.agent/harness/runs/20261007-upload-acceptance/after-local-cdp/` 持有；`proof.json` 为 `PASS_UPLOAD_READY_60`。首次失败证据保留在上级目录，未以本次成功改写。READY 实传验收已通过，未确认到计划、未证明审核或投放，也未评估 Windows 或整片视觉效果。历史两批软件结束仍受上述只读限制。

本阶段 session capture 继续使用此 incident record。AOCI 官方完整候选批次只含 uploader，CAS Apply 后 Verify、Check、Guide 均 aligned；uploader 为 index，相关测试和计划为 observe。提交只包含本任务文件与 uploader 的共享 Entry/baseline owned hunks，保留其他会话的业务与索引改动。
