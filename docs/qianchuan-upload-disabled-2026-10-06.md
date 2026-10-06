# Evidence

2026-10-06 对当前批量上传进行有界现场检查。蝴蝶贴批次 `be62eb46-4598-4f6b-ba3e-d355bfdb11f4` 冻结账户 `1876024170199244`、计划 `1876036593854788`：30 条中 10 READY、9 MAY_HAVE_UPLOADED、11 NOT_SELECTED；9 条的记录为阶段超时。原 target `324841956D20F589CAC37BFFD6969536` 及 session marker 仍匹配，列表只有前 10 条，计数显示 `已选择 10/73：`。入口带 `oc-create-upload-select-wrapper-disabled`，悬停提示“已达可选素材上限”。现场没有重传、确认、删除或更改计划。

用户指出计划未达到上限后，Parent 重新检查原 target 实际加载的两个公开脚本。只读 `Debugger.getScriptSource` 字节与无凭据下载的公开 CDN 文件 SHA-256 完全一致；没有读取 cookie、storage、请求凭据或执行上传/确认。

- [当前视频弹窗模块](https://lf3-ad-platform.byteadverts.com/obj/ad-platform/ad/qc/uni-pmc/static/js/async/AdDetailTabs~1.dc46b3ae.js)：SHA-256 `9a65adced6b68c1ba0eeeafb1c37315f3d0e83726cc9cff93a2d238136f6d98f`。单次选择最大值初始化为 10，组件 max 取计划剩余数与 10 的较小值；底部计数的分母使用另外的计划总可选数。上层自身禁用条件仍是计划容量，传入的禁用提示固定为“已达可选素材上限”。
- [当前上传组件模块](https://lf3-ad-platform.byteadverts.com/obj/ad-platform/ad/qc_one_piece/js/1378.f245922a.js)：SHA-256 `bfa302e71a8b6b4ce95f465b56160180156f589f581bd78a0cd19e08e8a8e2a2`。组件复用了该 max，按累计 uploading/success 行数与 max **相等**时禁用入口；不是大于等于。单次文件选择的数量限制由另一路 max/selectMax 判断负责。组件提示又优先采用上层固定消息，所以提示不能证明计划已满。

同轮只读核对另一原 target `31478C52AF51CA86AC1AD0646901E7EA`、匹配 marker `71915609-c12f-420e-bb87-96af86dba078`：页面显示 `33/414`，33 行全部成功且入口可用。这直接否定“每个上传窗口只能累计 10 条”。不能据此要求每 10 条确认，也不能将当前组件版本的单次限制推广为所有入口的统一上限。

原 service 每个成片 committed 后立即选择当前 1–9 条，随后继续追加；因此先 1 条再 9 条会恰好进入组件的累计 10 条禁用边界。原批次的永久 fence 时间序列也表现为首条、随后九条。先前仅增加禁用入口 guard 的修复避免盲目投递，却没有解决分组时序；将泛化禁用归为 CAPACITY_INSUFFICIENT 也不准确。关于按 10 条人工/自动确认的临时问题已撤回，没有据此扩大执行权限。

# Prior Repair (Superseded)

按 [Implementation Plan](superpowers/plans/2026-10-06-qianchuan-upload-coalescing.md)，原 `DouyinUploadService` 对较大冻结批次先合并最多 9 个正式准入的不同字节文件，再开始连接和选择；处理中继续合批追加。最后不足 9 条须等全部预期 intents 登记完成，且各成员已准入，或由 canonical queue 明确失败/取消/打断，或被可信制作 owner 取消。completed 但尚未准入、缺身份或缺记录均不算收尾完成；准入进行中不释放尾组。只读终态判断由 `douyin-upload-group.ts` 辅助，原 queue/store/service 仍是唯一状态 owner。

合批沿用原 active.ids/controller，停止与取消可排空；首次等待按 processing 配置有界，后续等待不重置原连续窗口期限，并继续检查原页面异常。总数不超过 9 的批次保留原流式行为。正常较大批次按 9+9+尾组推进，避免中途累计 10；本批最终只有 10 个可上传文件时，仍可观察全表 READY，不要求入口继续可用。

`QianchuanPageSession` 保留文件准备前、投递前及拖拽中的入口 guard；泛化禁用改为 PAGE_CONTRACT_CHANGED，真正容量不足仍走原整批容量校验。没有修改平台 DOM 禁用状态、组件 props、文件入口、账号目标或恢复授权。fence 仍先于每次文件动作，已保存 READY 与未知屏障保留。

# Verification

新增最初 7 个 service 回归场景在旧实现全部失败，合批实现后通过，覆盖零散成片、三类失败终态及合批中的停止/取消/超时。另覆盖全部 queue chunks 登记、最后一个 artifact 准入尚未结束，以及合批期间原页面失败。原 service/page focused suites 曾有 137 项通过；最终字节以本轮 owned Harness 的完整上传相关组、typecheck 和 completion receipt 为准。

隔离 Chrome production-DOM 的 9+9+3 场景加入当前平台组件的“累计恰好 10 才禁用”谓词；检查实际 native CDP 投递、原页归属、处理中持续追加和零确认/设置动作。fixture 与真实千川批次验收分别报告。

受管 Kimi deep 只读诊断 invocation `3782fba6-3050-4404-a7da-9dd591508d1b` 的 canonical receipt 为 `reason=cancelled / OUTCOME_UNKNOWN`；Parent 获得加载脚本和现场反证后取消，不接纳 partial 输出，不作为完成或 implementation review。Native `test_analyzer` 提醒了 chunk/失败尾组/准入竞态，Parent 据当前源码实现并验证。先前诊断 invocation `53a9e31b-784e-4e02-82c5-3e3cf55e697c` 同样已取消；两次均不算可触发 runtime-failure fallback 的连续故障。

# Review Risk Gate

稳定候选绑定 service SHA-256 `7346a0bccc2a5acc4ceb6f87a0ca7c3c5b04897d4d5a2d854f979d5778619e4d`、group helper `cbae4669db1a0ec55452951c8d1ffb8c7f56f2ee5b17d80e020f152d80e7e02f`、page owner `27731ee66268601594eb2a63fdd5ff9bfa9023e1e66d8cb4eaeaf74b49472701`，并由最终 owned receipt 核验全部测试字节。Parent 在项目验证后核对 SUBAGENTS 的三个触发条件：用户未要求 Kimi review；本变更不授予凭据、跨项目权限或难恢复的 durable-state 修改；分组、尾组、停止、超时、恢复及页面异常有 native 可执行覆盖。真实平台吞吐量仍待验收，但静态 adversarial review 不能替代该现场证据。结论为 KIMI_REVIEW_NOT_REQUIRED。

# Remaining Boundary

此工程修复不证明当前 30 条已全部上传。历史 9 条 MAY_HAVE_UPLOADED 不清 fence、不重试；原 10 条 READY 仍是当时页面观察，不等于已加入计划。批量制作仍在原 lifecycle 下运行，开发版等空闲再加载变更；没有强制停止或重启。

已评估 session-record/capture：当前 repository/installed skills 未提供专用 skill。本记录保留可复现软件缺陷、现场证据及验证边界，不更新全局 memory。

# Current Batch Follow-up

用户随后截图显示“新眼贴模板 / 晚安油”本批 200 条，完成 22 条、待上传 6 条、处理中 0 条。只读核对当前 Electron 页面与账本，匹配 pageBatchId `a120eb34-1632-45cb-8118-8e59e209e2cb`：首组先合批等待，随后 9 条 OPENING_UPLOAD_PAGE / UPLOADING；2026-10-05T20:15Z 原归属上传窗口显示 `9/429` 且 9 行成功；20:17:41Z 应用显示已上传 18 条、下一组 9 条处理中，导出已完成 93 条，无失败或未知结果。这是同一正在运行的授权批次自然推进，Parent 未提交文件、确认、续传或重启。

用户明确指出“有多少传多少，直接一次传九个，不等上一条完成”，状态解释不能解决速度问题。此前补充等待数量提示的候选已撤销；上方合批方案的等待条件也被 [Throughput Delta](douyin-auto-upload-spec.md#throughput-acceptance-delta) 取代。当前修复目标是立即流式上传，并移除逐成员完整账本重写。

受管 Kimi deep 只读 source 调查 invocation `785bafa3-00c0-4519-938b-fce9e73a930e`，canonical receipt 为 PARSED / exited，4 次请求均由 endpoint 核验 k3 / max，未回退；完整读 service、page 和 group helper。其疑问“当前或恢复任务”“renderer 计数”“制作仍在进行”由 Parent 上述原页、应用及账本证据解决。此报告仅解释源码语义，不授真实上传验收。

18 条 READY 只是上述时点的原页观察。2026-10-05T20:39:42Z 后续只读账本核查确认本批 200 条全部 WAITING_FOR_CONFIRMATION，最近完成记录为 20:35:25Z；仍不能推定已加入计划，先前未知批次仍不重传。

# Throughput Repair

新 service regression 在旧候选复现两项真实失败：已有六条仍没有文件动作；21 条 9+9+3 在同一 processing 窗口调用完整 ledger commit **105 次**。当前账本约 14 MB，每次提交都全量 schema/binding/归档核验、原子保存与同步；单组逐条阶段写入放大延迟，并与正式 artifact admission 共用原串行 store。

修复沿原 owners：非空已准入组立即发出，最多九条；只有会恰好累计十条的组缩至九，单独第十条等下一条跨至十一或可信最终终态。`saveTasks` 共用单条与批量保存校验，阶段按组保存；`markSelecting` 全组预检后逐文件独占创建及 sync，目录 sync 后一次完整账本提交，成功才允许组投递。最终 READY 整窗口原子提交，保存失败无部分 READY；此前窗口已存 READY 保留，所有未确认成员 fence 不清。

两项 red-green 已运行：旧候选 2 FAIL，新候选 2 PASS；六条立即上传且 processing 中继续追加，21 条同场景 **13 次完整 ledger commit**。store 27 项定向测试通过，含第 1/5/9 个 fence 创建失败、逐文件及目录同步顺序、原始 ledger 字节保留和重启只读恢复。隔离 production DOM/native CDP 已验证 9+9+3 与 6+3+2+9+1，两者前组未完成时继续投递且零确认/设置动作。最终完整验证与 Review Risk Gate 将绑定稳定候选及独立 receipt。

此度量只证明软件调度/持久化性能契约，不将保存次数降幅当成真实平台上传耗时降幅。本批结束后开发生命周期自然重启；20:41:10Z 只读 app.state 与可见页面均显示新即时上传文案，Parent 未强制中断、重启或投递文件。已评估 session-record/capture：没有专用 repository skill，本 canonical incident record 保存本轮证据。

## Review Follow-up

稳定 S1 的 scoped Harness `20261005T203916Z-7aadd909` 与 completion `20261005T204621Z-26cadf45` 均 PASS，含 1357 项无 skip 测试及 460 项上传测试。受管 Kimi deep review invocation `4e84ff5b-5e81-45ff-96f7-2eefa4a576c7` 为 PARSED / exited，8 次 endpoint identity 核验 k3 / max，完整读取 service/store/group，无回退。此为 S1 证据，不自动授后续字节验收。

Parent 确认 F-01：从未选择的第十条等待超时会变成不可继续的 FAILED_TERMINAL。新增回归先复现该失败，修复仅把 PENDING 且无 fence 的等待 TIMEOUT 归为 NEEDS_HUMAN / NOT_SELECTED，沿原显式安全继续核查原页，不自动重传。已有 fence 的 TIMEOUT 仍为未知只读；首轮 READY 与永久屏障保留。另澄清跨十边界可携至少一条后续成片且最多九条，首次动作前等待与动作后连续窗口分别有原有界预算。S2 的最终验证与适用 re-review 另绑定当前 snapshot，不把 S1 PASS 当成 S2 验收。
