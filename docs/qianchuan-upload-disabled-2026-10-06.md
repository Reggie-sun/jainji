# Evidence

2026-10-06 对当前批量上传进行有界现场检查。蝴蝶贴批次 `be62eb46-4598-4f6b-ba3e-d355bfdb11f4` 冻结账户 `1876024170199244`、计划 `1876036593854788`：30 条中 10 READY、9 MAY_HAVE_UPLOADED、11 NOT_SELECTED；9 条的记录为阶段超时。原 target `324841956D20F589CAC37BFFD6969536` 及 session marker 仍匹配，列表只有前 10 条，计数显示 `已选择 10/73：`。入口带 `oc-create-upload-select-wrapper-disabled`，悬停提示“已达可选素材上限”。现场没有重传、确认、删除或更改计划。

用户指出计划未达到上限后，Parent 重新检查原 target 实际加载的两个公开脚本。只读 `Debugger.getScriptSource` 字节与无凭据下载的公开 CDN 文件 SHA-256 完全一致；没有读取 cookie、storage、请求凭据或执行上传/确认。

- [当前视频弹窗模块](https://lf3-ad-platform.byteadverts.com/obj/ad-platform/ad/qc/uni-pmc/static/js/async/AdDetailTabs~1.dc46b3ae.js)：SHA-256 `9a65adced6b68c1ba0eeeafb1c37315f3d0e83726cc9cff93a2d238136f6d98f`。单次选择最大值初始化为 10，组件 max 取计划剩余数与 10 的较小值；底部计数的分母使用另外的计划总可选数。上层自身禁用条件仍是计划容量，传入的禁用提示固定为“已达可选素材上限”。
- [当前上传组件模块](https://lf3-ad-platform.byteadverts.com/obj/ad-platform/ad/qc_one_piece/js/1378.f245922a.js)：SHA-256 `bfa302e71a8b6b4ce95f465b56160180156f589f581bd78a0cd19e08e8a8e2a2`。组件复用了该 max，按累计 uploading/success 行数与 max **相等**时禁用入口；不是大于等于。单次文件选择的数量限制由另一路 max/selectMax 判断负责。组件提示又优先采用上层固定消息，所以提示不能证明计划已满。

同轮只读核对另一原 target `31478C52AF51CA86AC1AD0646901E7EA`、匹配 marker `71915609-c12f-420e-bb87-96af86dba078`：页面显示 `33/414`，33 行全部成功且入口可用。这直接否定“每个上传窗口只能累计 10 条”。不能据此要求每 10 条确认，也不能将当前组件版本的单次限制推广为所有入口的统一上限。

原 service 每个成片 committed 后立即选择当前 1–9 条，随后继续追加；因此先 1 条再 9 条会恰好进入组件的累计 10 条禁用边界。原批次的永久 fence 时间序列也表现为首条、随后九条。先前仅增加禁用入口 guard 的修复避免盲目投递，却没有解决分组时序；将泛化禁用归为 CAPACITY_INSUFFICIENT 也不准确。关于按 10 条人工/自动确认的临时问题已撤回，没有据此扩大执行权限。

# Repair

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
