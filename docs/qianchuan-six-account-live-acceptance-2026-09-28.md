# Qianchuan Six-Account Live Acceptance — 2026-09-28

## Outcome

当前结果为 **PARTIAL：4/6 账号已到待确认状态**。蝴蝶贴、眼贴、肥皂、热敷贴各 10 条正式成片为 `WAITING_FOR_CONFIRMATION / READY`。氨糖膏 10 条已导出、零选文件；一条根 10 条已导出，1 条有永久 fence、结果未知，其余 9 条未选择。最终 ledger 为 60 条、40 READY、1 MAY_HAVE_UPLOADED、19 NOT_SELECTED，41 个永久 fence。不能宣称六账号验收或发行交付通过。修复版应用已实际验证自动跨组继续，分组按当时已完成导出数量形成，每组至多 9 条，不要求凑满 9 条。

本轮程序没有点击“确定”、发布、修改广告设置、清除 fence 或重传未知文件。应用验收实例已退出，浏览器任务页面保留；用户原来的简辑实例未由本轮重启或覆盖安装。

2026-09-29 复核已将氨糖膏阻碍定位到页面明确提示的抖音号全域投放权限，并补齐当前源码的 Linux packaged fixture 验证；真实结果仍为 4/6，required review 仍阻塞。详见文末 Linux Recovery Checkpoint。

## Authority And Target

用户依次授权“开始真实验收”“6个都验证,对了滴耳康的品换了”“换计划都确认”。本轮为六个指定现有项目各制作 10 条，保留项目中已有的手动展示文字，通过应用制作/追加入口、原导出队列及现有上传 owner 执行。每组至多 9 条，前组全部 ready 且持久保存后才继续，最终停在“确定”前。

一条根故障后，用户明确选择选项 `1`：用已通过离线测试的修复版本继续眼贴、肥皂、热敷贴，各 10 条。氨糖膏保持原计划；不重传一条根未知任务，不自动启动第四轮 implementation review。

本地 `/home/reggie/电商/千川账号配置.json` 仅将既有 `滴耳康` 账号槽的 `adId` 改为用户确认的一条根计划 `1877582409449488`，advertiser `1876131703522649` 不变。枚举及界面账号槽名仍为 `滴耳康`；实际项目/素材为一条根，不是滴耳康历史成片。配置更新前后 SHA256 分别为 `6bab3d47ed449a52d4160f3d3b22fb855d903b49512a6b9042934bdbeb31b577`、`01e00b80a148f655d91573aebd164a6f10c651f4ddce6ff3d91f6a1c02e10ff8`；保留私有原字节备份，更新与 readback 为 0600。配置 CLI 严格读取六账号成功，不代表浏览器身份已逐个验收。

用户另已确认重启肥皂自己的 Chrome profile，现有 profile/登录目录保留，loopback CDP `9226` 可连接。第一次启动因缺少 DISPLAY 未启动窗口；随后核实当前 GNOME 显示环境并成功启动。没有修改启动器或其他 Chrome profile。

## Runtime And Evidence Boundary

Linux 独立 Electron 实例运行实际应用主进程、preload、前端及 production adapter。前三账号运行当时 HEAD `92a5eae` 与实际未提交字节的冻结快照；编译输出、115 个主进程输入文件 hash 与前端输出均保留。后三账号使用包含 `7855891` 并发修复的第二份私有快照。没有注入 fixture selector、替换上传 service/store、增加上传队列或运行历史原生 CDP 上传脚本；旧 runtime 与证据保留。

原主进程 bundle SHA256 为 `70ae9a972cce6c867128701bb984359d62afc315d30a3b808b19c8ac63328e50`；修复版为 `53c131c572560d32f529cee3de306a5f4cf1a53f316cbaa19f3efffa244a3998`。115 个输入中仅 `douyin-upload-service.ts` 改变；preload `a6c78295ba06f0b060efd2532e72158cc222a9dbe0cc1e0f5e957db0dabcfa2b` 与前端字节保持原冻结值。独立 userData 保留本轮 JobStore、upload ledger、snapshots 与 fence；仅复制必要的用户上传贴纸，不复制模型凭据、Chrome 登录数据或旧上传 ledger。原六个项目仅复制后使用，对应回合结束后核对原项目字节。

验收期间其他任务修改了工作树的 `index.ts`、`preload.ts`、`batch-production-controller.ts`、`shared/batch-production.ts`；冻结 bundle 未被覆盖。本文真实证据绑定上述私有运行字节，不扩展为这些更新后源码的最新应用验收。

GUI 验收 driver 仅编排应用控件、已知文件对话框与只读观察；账号网页上的选文件和 ready 判定由应用 production adapter 执行。六项目表单预检不计真实端到端通过。早期报告对话框日志为空；后三账号报告分别保留 3、5 项对话框事件。仅允许已知打开项目、配置与输出目录对话框，拒绝未知对话框。

## Live Results

| Account slot / Actual product | New formal exports | Upload READY | Result |
| --- | ---: | ---: | --- |
| 蝴蝶贴 / 蝴蝶贴 | 10 | 10 | PASS：应用继续原任务后完成；待用户确认 |
| 氨糖膏 / 氨糖膏 | 10 | 0 | STOPPED：`PAGE_CONTRACT_CHANGED / NOT_SELECTED` |
| 滴耳康 / 一条根 | 10 | 0 | STOPPED：1 条 `MAY_HAVE_UPLOADED`，9 条 `NOT_SELECTED` |
| 眼贴 / 眼贴 | 10 | 10 | READY 及只读复核 PASS；初次素材 tab 点击追踪缺失 |
| 肥皂 / 肥皂 | 10 | 10 | PASS：修复版应用，分组 `1+3+4+2` |
| 热敷贴 / 热敷贴 | 10 | 10 | PASS：修复版应用，分组 `1+9` |

### Butterfly Capacity And Safe Continuation

首次蝴蝶贴真实执行冻结 expectedCount=10，原任务页面 `F0AC2F803FC2D064BD85DDB0FBD47478` 显示“已选择 0/6”。应用以 `CAPACITY_INSUFFICIENT / NEEDS_HUMAN / NOT_SELECTED` 在 fence 与选文件之前停止，没有截断为 6、删除素材、自动确认腾位或新建计划。当时关闭验收实例后为 9 completed + 1 interrupted，零 fence/投递/确认。

用户随后明确答复“我已经处理了蝴蝶贴”。只读核对同一原页面显示“已选择 0/96”后，沿应用 GUI 打开保存的项目副本，重试唯一中断导出，显式继续原十个上传任务；没有重新制作整批，也没有删除启动 marker、清除 ledger 或更换 task identity。由于原任务均未选择文件，继续时应用建立新的上传页面；首次 fence 后十条始终共用该页面和弹窗。

最终页面 target `FAB69B93E42E01530928367DA121BB95`，pageBatch `099851b6-8430-4ba2-b3c5-ccd61fffc3a2`，modal session `c504bc11-5d90-4d9e-ad6c-f67aaf6d3380`。Advertiser `1876024170199244`、plan `1876036593854788`。实际投递组为 **1×10**，每次投递前已有行均 ready；这是应用显式继续路径的实际结果，不能当作自动 `9+1` 的实证。

结束后独立只读核对：十个完成产物 SHA256、十个不可覆盖 fence、同批原页面归属、十个持久 READY 记录均匹配；网页显示“已选择 10/96”，十行均具成功标记，唯一“确定”按钮可用而未点击。成片人工观看和人工确认投放结果不在此 PASS 内。

### Antang Page Ownership Failure

应用沿新制作批次自动上传入口打开 advertiser `1876036793517065`、冻结 plan `1876052012647452`。观察到应用在新任务 target `87005056374D86119D3467535E0952ED` 点击“素材”，随后在打开上传界面阶段停止；该账号没有文件投递，没有 fence。

失败后只读检查该 target：advertiser 仍匹配，但 URL `adId` 已变为空，计划详情 drawer 和上传 modal 均不存在，页面回到“商品自选”列表。此事实不能单独证明计划被删除、更换或具体操作来源；未放宽身份/归属 guard，也没有为争取成功自动重试。上传 owner 保留 1 `NEEDS_HUMAN` + 9 `PENDING`，全部 `NOT_SELECTED`。

driver 停止后允许已有 FFmpeg 导出结束再关闭实例。fresh JobStore 显示本批十条均 completed，避免再次因退出中断尾部导出。后续需核实计划是否改变或页面如何丢失归属；失败后不自动切账号，其他账号需用户明确继续，依据 [Upload Spec](douyin-auto-upload-spec.md) 的 §6、§8。

### OneRoot Continuation And Resume Race

用户随后明确说明“氨糖膏不换计划,其它的也开始”。氨糖膏映射与十条任务不变；本轮以现有独立 userData 开始剩余四个账号，不重跑前两个项目、不清空 ledger 或 fence。首个一条根新任务出现后，沿应用“安全继续”入口落实跨账号继续授权，原先十个蝴蝶贴 READY 与十个氨糖膏停止/pending 记录在结束后逐项核对未改变。

真实执行暴露 `DouyinUploadService.resume()` 与 `committed() -> runPending()` 的并发缺口：resume 只设置 `active`，没有创建 `runner`；后续正式成片完成能在显式继续尚未结束时启动自动 runner，共用一个 browser port 同时操作弹窗。日志出现两个任务同时 `OPENING_UPLOAD_PAGE`，同一 target 两次“素材”点击；自动任务最终 `PAGE_CONTRACT_CHANGED / NOT_SELECTED`，先前 resume 任务在 fence 后成为 `UPLOAD_OUTCOME_UNKNOWN / MAY_HAVE_UPLOADED`。没有成功 ready 证据，也未观察到 native drop；不得据此断言平台未收文件。

一条根原任务 target `AD5197C7B3B6E75FFADC8D826D070E93` 在 23:01:55 的只读核对仍为 advertiser `1876131703522649`、plan `1877582409449488`，一处 owned modal 显示“已选择 0/372”，零列表行。永久 fence 仍保留，未执行恢复重传、换 hash、另建 batch 或清除记录。十条 FFmpeg 正式导出全部完成，SHA256 与上传准入记录逐项匹配。后三账号直到用户选择选项 `1` 后才开始。

### Authorized Remaining Three Acceptance

修复版在新私有目录构建，继续使用同一独立 userData。首次缺 DISPLAY 的 launch 在应用界面前失败，30 条记录与 11 个 fence 逐项未变；随后使用 README 已声明的 Xvfb 启动。store 正常启动将一条根未知任务的 `failure.message`、`failure.next_action` 归一化为标准恢复提示。Parent 对照现有 `douyin-upload-store.ts` 的恢复分支确认仅这两个字段改变，目标、身份、hash、NEEDS_HUMAN/MAY_HAVE_UPLOADED、时间戳与 fence 均保持；保留原授权及失败报告，绑定归一化后的精确基线继续，没有手改 ledger 或重置 fence。

眼贴 GUI 报告因缺少最早“素材”点击的正向追踪而 STOPPED，当时十条已经持久 READY。Parent 只读复核确认原 target/modal、十行成功、精确数量、可用确认按钮、十个正式产物 hash 和 fence 均匹配。三个 native drop 完整记录 `1+5+4`，每次 drop 的 prior rows 均 ready；“添加视频”“上传视频”点击与之后的 drop/确认控件观察有效，确认点击计数为零。初次素材 tab 点击仍记为 `NOT_OBSERVED`，不虚称完整动作追踪。原 STOPPED 报告保留；只读 audit 的 PASS 指上传终点核验。未重做或重传眼贴，按已有选项 `1` 的授权继续肥皂、热敷贴。

肥皂曾等待其他简辑进程占用的六个 GPU 编码会话；本轮没有停止这些进程、改变编码器或绕过跨进程准入。会话释放后原队列自动开始导出。两产品 GUI 报告均 PASS，23:53:14 的独立只读 audit 复核二十个正式产物 hash、二十个 fence、同批页面/弹窗、全部成功行及未点击确认按钮；初次素材 tab 点击均有观察记录。

| Product | Actual groups | Owned target | Visible selected count |
| --- | --- | --- | --- |
| 眼贴 | `1+5+4` | `6A3744D4FB15D76F932045EC01708C78` | `10/298` |
| 肥皂 | `1+3+4+2` | `927FCFB09102C8A414A829FFC77E22E5` | `10/190` |
| 热敷贴 | `1+9` | `086B135D7E5C0077DF9E1B265E81498A` | `10/270` |

后三账号各十件实际上传，全组成功后自动继续，最大组为九件。三个账号各保留一个原任务 tab/modal。后续二账号开始与结束逐项核对前四十条记录及二十一个 fence；最终确认配置 hash 与授权值相同，一条根未知结果及氨糖膏原计划保持。实例结束后只 detach，原上传页面保留；私有截图保存三个成功列表。

## Offline Correction Candidate

Parent 在既有 service owner 增加 `runPending()` 的 `active` 检查，不新增队列或控制 owner。显式继续从连接、页面、投递、平台 ready 到 READY 持久保存的整个执行期间，自动循环不得再次执行；显式继续结束后沿原 `runPending()` 消费本轮新增 eligible 任务。旧 pending、永久 fence、同目标去重与未知零重传逻辑未放宽。

新增回归测试冻结首次 resume 的 ready 和 READY save，期间模拟两个正式产物完成通知。旧代码 RED：期望只打开一次，实际三次；新代码 GREEN：两个等待阶段均只有一次页面准备/一个 fence，保存完成后执行余下两件，实际组为 `1+2`，连续索引与最终 READY 均核对。fresh typecheck exit 0，五个相关文件 **89/89 PASS**，23:04:26 开始，无跳过。

Service 源码 hash 从 `88f62391ce94ef671b8da981002d030aa552a02b412fdad4bfaa9afbc17015ef` 变为 `005d57b49a33e3db7e3cadd49e351226f386421773f9a45973020ad6cf113a40`。该修复候选已用于后三账号真实验收；旧 required review 的三轮预算不重置，最新代码需要适用的 re-review，当前仍 `REVIEW_ESCALATION_REQUIRED`，不自动启动第四轮。真实成功仍不能宣称发行交付已完成。

## Verification And Review

本轮准备阶段 fresh `npm run typecheck` exit 0；五个相关上传测试文件 **88/88 PASS**，22:08:21 开始。测试/fixture 证明与真实网页证据分别报告。本轮真实结果只证明 Linux 当前冻结应用路径；不证明 Windows 实机、发行包安装、真实模型调用、人工成片质量或六账号完成。

受管 Kimi operational QA invocation `fd908cdb-a1dc-4519-a612-13c61716dcb7` 核查预检边界；`6a589b2a-d52e-4a58-a52a-ae73530a7ae0` 核查 GUI driver 和授权/冻结快照，均有 authenticated worker route、实际 Read 与 canonical receipt。Parent 核验并处理配置 digest、对话框允许列表、正向动作观察等 findings。后续 driver 修订与恢复编排由 Parent 检查、语法验证并执行；不声称 Kimi 审过这些新字节。

剩余四账号的独立 operational QA invocation `3494d6a1-2b6c-40f0-bf5d-0ed92f11a83b` 绑定授权后的 driver、既有 service、有限 QA context 与 Spec。四项真实 Read 完整且 hash 与封存字节匹配；第一请求 authenticated `k3-256k / high`，第二请求在 RESPONSE_BODY 连接错误，wall 180 秒后 `OUTCOME_UNKNOWN`，没有终结 report，不采纳 partial findings，也不自动重试。Parent 直接复现并处理上述真实 race；这不是一个成功的独立 QA 结论。

上述均为操作验收 QA，不是新增 implementation reviewer，也不重置三轮预算。[Nine-File Groups Record](qianchuan-nine-file-groups-2026-09-28.md) 的 required implementation review 仍为 **REVIEW_ESCALATION_REQUIRED**；本轮真实成功不能替代 required review，不自动启动第四轮。

首次文档 checkpoint 的 AOCI Verify、Check exit 0，Guide 为 `aligned / complete:true / next_action:none`。并发修复后，机器签发完整批次仅包含 service 一项；Parent 根据源码与回归证据更新该 Entry 和对应基线，保留其他对象、Root/Meta 与现有 Managed Scope。后续 Verify、Check exit 0，Guide complete/none，missing/stale/orphan/unbaselined 清零，无 Recovery 或第三方冲突。此对齐证明不代替行为验收，也不声明完整系统认知通过。

后三账号收尾跨入 2026-09-29。同期其他任务曾使六个批量制作对象需要维护；其 owner 随后更新正式索引和基线，本轮没有写入或提交这些共享资产。该更新使压缩后的全量 Overview 第三块返回 `overview_snapshot_changed`，本轮停止该认知链，不重试或声明完整系统认知。随后 fresh Verify、Check 均 exit 0，Guide 为 `aligned / complete:true / next_action:none`，178 个受管理代码对象已对齐。本次验收文档为 observed 对象，无需制造 Entry；对齐只作为收尾时刻的治理事实，不扩展为其他任务行为已验收。

## Evidence And Remaining Work

私有、Git 忽略的 `.agent/harness/runs/20260928-qianchuan-six-live/` 保存各次授权、配置原字节备份、两个 runtime snapshots、GUI reports、只读 audits、driver、项目副本、正式 MP4、JobStore 与逐文件 fence。后三账号的主要证据为 `runtime-resume-serial-snapshot.json`、`remaining-three-validated-report.json`、`eye-post-observer-stop-audit.json`、`remaining-two-report.json`、`remaining-two-final-audit.json` 和三个原页面截图；DISPLAY/启动提示归一化的失败回执也保留。原执行/各次继续启动 marker 均不可覆盖保留。后续不得盲目重跑新制作脚本，最终事实以 fresh 持久 JobStore/ledger 和只读 audit 为准。

截至本节原 checkpoint，剩余为氨糖膏原计划恢复、一条根未知结果、required re-review 和后续版本的应用交付验证。2026-09-29 的核查及用户排除 Windows 的新范围见下节。Repository 没有专用 session-record/capture Skill；本文件保存实质真实验收和 genuine blocker，不写全局 memory，不改 roadmap 或产品规则。

## Linux Recovery Checkpoint — 2026-09-29

### Authority And Result

用户要求修复四项剩余问题、排除 Windows，并明确选择“保留审查阻塞，先修其它项”。没有追加 implementation reviewer，也没有重置三轮预算。用户随后授权“允许仅重启氨糖膏 Chrome”；本轮只优雅退出该 profile 的主进程，再以现有登录目录、原计划 URL 和 loopback CDP `9223` 启动。没有修改启动器、登录数据或其他 Chrome profile。

真实结果仍为 **PARTIAL：4/6 READY**。氨糖膏已恢复 CDP，并通过最新冻结字节的 Linux packaged 应用“安全继续”入口尝试原十条任务，未重新制作、换计划或选文件。页面“添加视频”按钮禁用；只读 hover 显示“当前账户无该抖音号的全域投放权限，不支持添加素材”。这是本次直接观察到的权限阻碍，不能将其解释为容量不足，也不能用应用放宽校验、强制点击或更换计划来消除。需有权限的人先处理该抖音号授权。应用记录仍为 `PAGE_CONTRACT_CHANGED`，本轮没有修改错误分类或账户权限。

一条根原 target `AD5197C7B3B6E75FFADC8D826D070E93` 的 fresh 只读观察为原 advertiser、空 `adId`、零上传 modal；原页面证据已经不足以建立 READY 或未投递结论。其永久 fence 保留，1 条仍 `MAY_HAVE_UPLOADED`，其余 9 条未选文件。本轮不启动恢复投递、不清除屏障、不创建替代 batch。

恢复后独立审计：60 条记录、40 READY、1 MAY_HAVE_UPLOADED、19 NOT_SELECTED，仍为 41 个永久 fence；氨糖膏十条均未选择、零 fence。其他五十条记录逐项相同，既有四十一个 fence 字节相同，账号配置 SHA256 保持授权值。只恢复了一条氨糖膏旧任务的尝试；首次前置检查因 symlink 不满足 private directory 合同而阻断，零浏览器投递，随后使用 packaged Electron 的 `--user-data-dir` 指向原私有验收目录。没有移动、复制改写或手修 ledger。两次启动均只关闭本轮实例，用户日常简辑实例继续运行。

### Current Linux Candidate And Verification

在独立构建目录冻结 HEAD `9f4dd46f6a7b223c5722a5a6b39e2dd9245e4281` 及当前未提交源码；这是构建输入快照，不是 worktree。3,689 个输入 hash 在验证结束后与工作树全部相同。其他任务的未提交代码明确包含在候选中，本轮未编辑、stage 或 commit 这些代码。没有覆盖仓库构建输出或日常安装目录。

fresh `npm run typecheck` exit 0；上传相关五文件 89/89、补充 schema/account/UI 三文件 50/50 PASS。完整 code harness `20260928T162206Z-93f24044` 为 PASS：七个 required checks、399 个测试全部通过、零跳过，含十项 real-media 检查；前后 source identity 均为 `sha256:ae43534ada79a8534ec98357e3d676ca80ef1c1c8dc0e06bf7dc382d49d67e25`。人工成片观看仍 `NOT_EVALUATED`，没有真实模型调用。

`npm run build` 与 Linux AppImage/deb 构建 exit 0。开发桌面 fixture smoke PASS；未修改 production bundle 的 packaged fixture smoke PASS，实际组为 `1+9+2`，验证十二条正式 FFmpeg 输出和逐文件 fence，以及独立追加制作、preload、有限原生对话框、严格 IPC 拒绝、默认关闭、切换项目/提交后重置、重启不自动选文件。打包内 `playwright-core` 实际 attach 成功；确认点击为零，真实账号未用于 fixture。首次 packaged smoke 在追加制作检查超时，原失败报告保留；临时 driver 只将默认观察预算从 120 秒延长为 600 秒并增加只读等待日志，随后通过。日志记录了等待 GPU 编码会话释放，没有修改应用、强制编码或停止用户导出。另一次 driver 调用遗漏 `--packaged`，在 runtime 类型断言前置失败，不计应用通过证据。

氨糖膏真实恢复运行实际 `app.isPackaged=true` 的应用主进程、preload、前端与 production adapter；因上述账号权限而停止。此证据证明最新 packaged 入口与旧任务读取/准入/停止路径，**不能证明该账号上传成功或六账号端到端通过**。

AppImage 与 deb 内部 `app.asar` 均与测试用 linux-unpacked payload 完全相同，SHA256 为 `5053379d928f58060f2dac96b731b72155e5cb4d35cae28f6ee7100c8c6af11e`。main/preload bundle 分别为 `e99909b848a86050e00d571da774d3534cbe3b0006c79ad2d7ca7a12c79d3821`、`7fe22eecf48fb1b721130120425652dcd668593213a3acf71c56afcd88588a21`。候选包保存在 `/home/reggie/Applications/jianji-candidates/20260929-qianchuan-9f4dd46/`，附 `candidate.json`、输入快照及验证报告；没有覆盖日常应用或更改启动器。其 manifest 明确为 `VALIDATED_LINUX_CANDIDATE_REVIEW_BLOCKED`，不宣称正式发行交付。

| Candidate file | SHA256 |
| --- | --- |
| `jianji-0.1.6.AppImage` | `408af3c225c806505c179c4b30bdf5709df7bfa653945be976a12f84bbf1e7d6` |
| `jianji-0.1.6.deb` | `9ad6f1a5dde1fe701dc000e044e6e440790de5ef86fec9b00fd53b1dd281836f` |

### Operational Delegation And Remaining Gates

受管 Kimi invocation `91d84e1c-64a8-41d0-97b2-512e933a601f` 是 bounded、read-only operational mapping，worker route `27ba7e0c-32b1-41a9-8210-4f49474e0a30`，canonical receipt 为 `PARSED`。三项实际 Read 与封存 hash 一致。Parent 核对其结论：重启不会将旧 pending 自动恢复为 eligible，应通过明确“安全继续”；丢失原 owned modal 不能消除 UNKNOWN；Ng 页面实际原因必须用真实观察验证。该结果没有审查最终 implementation，也不构成第四轮 review、验收批准或原审查的替代。

私有 `.agent/harness/runs/20260929-qianchuan-repair/` 保存重启回执、Kimi receipt/report、两次 Ng GUI 启动报告、禁用控件及权限 tooltip 观察、最终五十条/四十一个 fence 审计、构建快照、smoke 原始成功/失败记录和日志。原六账号验收目录与未知 fence 保持。Windows 按用户要求为 out of scope。

实际剩余 gate：氨糖膏原账号的抖音号全域投放权限；一条根原页面证据丢失导致的未知结果；用户明确保留的 `REVIEW_ESCALATION_REQUIRED`。Linux 构建及 packaged fixture 验证已补齐，但日常安装切换与正式发行没有完成，当前仍只能交付受阻候选。
