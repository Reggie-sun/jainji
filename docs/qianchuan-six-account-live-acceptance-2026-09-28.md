# Qianchuan Six-Account Live Acceptance — 2026-09-28

## Outcome

当前结果为 **PARTIAL / STOPPED**。蝴蝶贴完成应用路径的 10 条正式成片上传，全部 `WAITING_FOR_CONFIRMATION / READY`；氨糖膏完成 10 条正式导出，但页面归属检查失败，零选文件。其余四个账号尚未开始真实制作或上传。不能宣称六账号验收通过，也没有实际证明自动 `9+1` 分组。

本轮程序没有点击“确定”、发布、修改广告设置、清除 fence 或重传未知文件。应用验收实例已退出，浏览器任务页面保留；用户原来的简辑实例未由本轮重启或覆盖安装。

## Authority And Target

用户依次授权“开始真实验收”“6个都验证,对了滴耳康的品换了”“换计划都确认”。本轮为六个指定现有项目各制作 10 条，保留项目中已有的手动展示文字，通过应用制作/追加入口、原导出队列及现有上传 owner 执行。每组至多 9 条，前组全部 ready 且持久保存后才继续，最终停在“确定”前。

本地 `/home/reggie/电商/千川账号配置.json` 仅将既有 `滴耳康` 账号槽的 `adId` 改为用户确认的一条根计划 `1877582409449488`，advertiser `1876131703522649` 不变。枚举及界面账号槽名仍为 `滴耳康`；实际项目/素材为一条根，不是滴耳康历史成片。配置更新前后 SHA256 分别为 `6bab3d47ed449a52d4160f3d3b22fb855d903b49512a6b9042934bdbeb31b577`、`01e00b80a148f655d91573aebd164a6f10c651f4ddce6ff3d91f6a1c02e10ff8`；保留私有原字节备份，更新与 readback 为 0600。配置 CLI 严格读取六账号成功，不代表浏览器身份已逐个验收。

用户另已确认重启肥皂自己的 Chrome profile，现有 profile/登录目录保留，loopback CDP `9226` 可连接。第一次启动因缺少 DISPLAY 未启动窗口；随后核实当前 GNOME 显示环境并成功启动。没有修改启动器或其他 Chrome profile。

## Runtime And Evidence Boundary

Linux 独立 Electron 实例运行实际应用主进程、preload、前端及 production adapter。工作树以当时 HEAD `92a5eae` 和实际未提交字节为准；编译输出、115 个主进程输入文件 hash 与前端输出冻结在私有 runtime snapshot。本轮没有改应用源码、注入 fixture selector、替换上传 service/store、增加上传队列或运行历史原生 CDP 上传脚本。

主进程 bundle SHA256 为 `70ae9a972cce6c867128701bb984359d62afc315d30a3b808b19c8ac63328e50`；preload 为 `a6c78295ba06f0b060efd2532e72158cc222a9dbe0cc1e0f5e957db0dabcfa2b`。独立 userData 保留本轮 JobStore、upload ledger、snapshots 与 fence；仅复制必要的用户上传贴纸，不复制模型凭据、Chrome 登录数据或旧上传 ledger。原六个项目仅复制后在应用中使用；已实际使用的两份原项目字节在完成后重新核对未变。

GUI 验收 driver 仅编排应用控件、已知文件对话框与只读观察；账号网页上的选文件和 ready 判定由应用 production adapter 执行。实际六项目表单预检通过，但预检没有开始制作或选文件，不计真实端到端通过。报告的文件对话框日志为空，不能作为完整对话框审计证据；使用明确的有限对话框允许列表，并拒绝未知对话框。

## Live Results

| Account slot / Actual product | New formal exports | Upload READY | Result |
| --- | ---: | ---: | --- |
| 蝴蝶贴 / 蝴蝶贴 | 10 | 10 | PASS：应用继续原任务后完成；待用户确认 |
| 氨糖膏 / 氨糖膏 | 10 | 0 | STOPPED：`PAGE_CONTRACT_CHANGED / NOT_SELECTED` |
| 滴耳康 / 一条根 | 0 | 0 | 表单预检完成；真实执行未开始 |
| 眼贴 / 眼贴 | 0 | 0 | 表单预检完成；真实执行未开始 |
| 肥皂 / 肥皂 | 0 | 0 | 表单预检完成；真实执行未开始 |
| 热敷贴 / 热敷贴 | 0 | 0 | 表单预检完成；真实执行未开始 |

### Butterfly Capacity And Safe Continuation

首次蝴蝶贴真实执行冻结 expectedCount=10，原任务页面 `F0AC2F803FC2D064BD85DDB0FBD47478` 显示“已选择 0/6”。应用以 `CAPACITY_INSUFFICIENT / NEEDS_HUMAN / NOT_SELECTED` 在 fence 与选文件之前停止，没有截断为 6、删除素材、自动确认腾位或新建计划。当时关闭验收实例后为 9 completed + 1 interrupted，零 fence/投递/确认。

用户随后明确答复“我已经处理了蝴蝶贴”。只读核对同一原页面显示“已选择 0/96”后，沿应用 GUI 打开保存的项目副本，重试唯一中断导出，显式继续原十个上传任务；没有重新制作整批，也没有删除启动 marker、清除 ledger 或更换 task identity。由于原任务均未选择文件，继续时应用建立新的上传页面；首次 fence 后十条始终共用该页面和弹窗。

最终页面 target `FAB69B93E42E01530928367DA121BB95`，pageBatch `099851b6-8430-4ba2-b3c5-ccd61fffc3a2`，modal session `c504bc11-5d90-4d9e-ad6c-f67aaf6d3380`。Advertiser `1876024170199244`、plan `1876036593854788`。实际投递组为 **1×10**，每次投递前已有行均 ready；这是应用显式继续路径的实际结果，不能当作自动 `9+1` 的实证。

结束后独立只读核对：十个完成产物 SHA256、十个不可覆盖 fence、同批原页面归属、十个持久 READY 记录均匹配；网页显示“已选择 10/96”，十行均具成功标记，唯一“确定”按钮可用而未点击。成片人工观看和人工确认投放结果不在此 PASS 内。

### Antang Page Ownership Failure

应用沿新制作批次自动上传入口打开 advertiser `1876036793517065`、冻结 plan `1876052012647452`。观察到应用在新任务 target `87005056374D86119D3467535E0952ED` 点击“素材”，随后在打开上传界面阶段停止；该账号没有文件投递，没有 fence。

失败后只读检查该 target：advertiser 仍匹配，但 URL `adId` 已变为空，计划详情 drawer 和上传 modal 均不存在，页面回到“商品自选”列表。此事实不能单独证明计划被删除、更换或具体操作来源；未放宽身份/归属 guard，也没有为争取成功自动重试。上传 owner 保留 1 `NEEDS_HUMAN` + 9 `PENDING`，全部 `NOT_SELECTED`。

driver 停止后允许已有 FFmpeg 导出结束再关闭实例。fresh JobStore 显示本批十条均 completed，避免再次因退出中断尾部导出。后续需核实计划是否改变或页面如何丢失归属；失败后不自动切账号，其他账号需用户明确继续，依据 [Upload Spec](douyin-auto-upload-spec.md) 的 §6、§8。

## Verification And Review

本轮准备阶段 fresh `npm run typecheck` exit 0；五个相关上传测试文件 **88/88 PASS**，22:08:21 开始。测试/fixture 证明与真实网页证据分别报告。本轮真实结果只证明 Linux 当前冻结应用路径；不证明 Windows 实机、发行包安装、真实模型调用、人工成片质量或六账号完成。

受管 Kimi operational QA invocation `fd908cdb-a1dc-4519-a612-13c61716dcb7` 核查预检边界；`6a589b2a-d52e-4a58-a52a-ae73530a7ae0` 核查 GUI driver 和授权/冻结快照，均有 authenticated worker route、实际 Read 与 canonical receipt。Parent 核验并处理配置 digest、对话框允许列表、正向动作观察等 findings。后续 driver 修订与恢复编排由 Parent 检查、语法验证并执行；不声称 Kimi 审过这些新字节。

上述是操作验收 QA，不是新增 implementation reviewer，也不重置三轮预算。[Nine-File Groups Record](qianchuan-nine-file-groups-2026-09-28.md) 的 required implementation review 仍为 **REVIEW_ESCALATION_REQUIRED**；本轮真实成功不能替代 required review，不自动启动第四轮。

文档 checkpoint 的 AOCI Verify、Check exit 0，当前 Guide 为 `aligned / complete:true / next_action:none`，managed missing/stale/orphan/unbaselined 均为空，无 Recovery 或第三方冲突。本记录属于 observed documentation，不扩大 Managed Scope、不制造 Entry；正式索引与 baseline 无需本任务写入。此对齐证明不代替行为验收，也不声明完整系统认知通过。

## Evidence And Remaining Work

私有、Git 忽略的 `.agent/harness/runs/20260928-qianchuan-six-live/` 保存 `authorization.json`、配置原字节备份、`runtime-snapshot.json`、原 `report.json`、容量检查与中断 checkpoint、`continue-report.json`、`audit-live.json`、`angtang-page-readonly.json`、driver、项目副本、正式 MP4、JobStore 与逐文件 fence。原执行/继续启动 marker 均不可覆盖保留；后续不得盲目重跑新制作脚本。两个 run reports 分别保留当时状态，最终事实以 fresh 持久 JobStore/ledger 和只读 audit 为准。

剩余：处理氨糖膏页面归属失效、完成其上传及其余四账号真实验收，并提供自动跨组继续的真实证据；required review 和 Windows 仍分别待处理。Repository 没有专用 session-record/capture Skill；本文件保存实质真实验收和 genuine blocker，不写全局 memory，不改 roadmap 或产品规则。
