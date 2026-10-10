# Scheduled Automation Implementation Plan

## Goal

按用户 C/C/A 选择，提供两类计划素材清理、制作、上传的独立每日定时与串联执行；关闭窗口后后台常驻。每项任务固定绑定用户保存的制作配置、素材、账号及计划。

## Authority And Scope

用户已授权在现有上传历史闭环修改基础上继续。Native Codex 为执行 owner；Kimi 只读核对调用链，最终依据 Risk Gate 决定审查。直接使用当前工作树，不创建 worktree。首次排查时既有修改保留，不将其冒充本轮实现。

原上传停在“确定”前的行为对普通手动制作保持不变；新的显式自动化任务可以授予同批次自动确认。该增量不允许改广告设置、确认历史 UNKNOWN、重传已选文件、清空账号视频库或推断平台接受。缺少可验证确认结果时须显示结果未知并停住。

## Contracts

- 新调度 owner 保存每日时间、启用状态、固定 payload 与运行记录；先持久占用 occurrence，再触发任何副作用。重启中断、时间回拨、同刻重复唤醒不重跑。迟到超过一分钟跳过；同一天改时间不重新触发。运行冲突显式跳过，不积压隐式重试。
- 清理仅复用 `DouyinUploadService.clearVideoLibraries`，固定 advertiser/plan 与审核/15 天零展示规则；历史 pending 与 UNKNOWN 继续由原 owner 保护。
- 制作复用 `BatchProductionController` / `AgentController` / `ExportQueue`。保存私有项目快照，固定源素材路径和指纹；素材缺失或改变阻断。不得读取执行时编辑器状态；assisted 人工批准路径不能无人值守绕过。
- 上传只允许原队列已验证成片，独立定时引用本调度的制作任务产物；不能扫描任意目录上传或恢复历史未知批次。串联清理出现 PARTIAL/BLOCKED 或制作不完整即停止后续阶段。
- 自动确认必须绑定全部 expectedCount、同一 pageBatchId、原 tab/modal 和 READY 文件。确认前写入永久 intent，取消/断线/崩溃后不自动重新确认。平台回执与人工视觉验收分开。
- 新任务默认关闭，由用户在产品界面保存启用；开发验证不创建真实清理/上传任务，不使用真实模型额度。
- 关闭窗口隐藏到后台，显式退出停止服务。电脑须开机并登录桌面；不承诺断电或退出所有进程后继续执行。

## Files And Owners

- `src/shared/automation.ts`：调度请求、状态和唯一公开 schema。
- `src/main/automation-scheduler.ts`：每日触发、持久运行 claim、串行执行及异常恢复。
- `src/main/automation-runtime.ts`：固定模板/账号准入及原清理、制作、上传的适配，不创建第二生产队列。
- `src/renderer/AutomationPanel.tsx`、`automation.css`：任务配置、暂停、删除、运行记录；批量制作和清理页面提供保存入口。
- `src/main/index.ts`、`preload.ts`：可信 IPC、后台常驻和启动/停止接线。
- 原 batch/upload/page owners：必要的冻结输入、延后准入与有界确认接口；保留默认原行为。
- `tests/automation-*.test.ts`、现有上传/制作测试、`.agent/harness/policy.json`：行为与路由验证。

## Major Milestones

1. 实现严格 schema、每日调度及持久 occurrence 测试：重启、回拨、迟到、同日改时、busy、保存失败均不重复操作。
2. 固定项目快照与 cleanup/production/upload 原 owner 接入：验证目标漂移拒绝、串联失败短路、独立上传只消费明确关联的新成片。
3. UI 保存与任务列表、后台关闭/重新显示/显式退出，Chrome MCP 验证实际交互；不激活真实账号任务。
4. 完成相关 typecheck/tests/Harness、Risk Gate 与必要审查、AOCI Verify/Check/Guide、最终 diff，按仓库要求 commit/push 并核对远端 HEAD。

## Verification And Acceptance

使用可控时间和 fake ports 验证自动执行、不重放与固定绑定；真实 FFmpeg fixture 证明导出入原队列；浏览器 fixture 验证同批确认与失败关闭。实际平台效果、Windows 实机和整片观看不能由这些证据代替；缺失项明确未评估。`npm run typecheck`、受影响 Vitest 和 owned-scope Harness 均必须匹配最终 bytes。

## Self-Review

需求覆盖独立/串联、后台、固定绑定；不把定时上传解释成自动恢复旧 UNKNOWN。素材目录以保存模板的具体素材及路径冻结，不隐式发现后续新增文件。调度不复制生产生命周期。默认时间可由用户编辑，启用动作明确显示清理和自动确认范围。

## Platform Acceptance Delta

用户已授权本会话接管共享上传 schema/store/UI 并保留既有修改。仅新的已授权定时批次可执行原上传页的两层确认；第二层标题必须明确匹配当前完整素材数、原页面及账号计划。每层只点击一次。原普通上传仍停在确认前。

平台当前发布的前端模块 `821544`、`505664` 和视频添加组件证明：第二层确认发起 `bind-video-to-owner` 的文件名与 videoId 绑定，再发起 `add-uni-prom-materials`，请求包含 `aggregateAID` 与完整 videoMaterial；添加响应 numeric `status_code=0` 才显示添加成功。被动观察必须绑定同一 frame、账号 query、计划、唯一完整文件名/videoId 集合和单次请求；只保存安全身份和请求响应摘要，不保存 headers、cookie 或原始 payload。缺失、错误、额外提交、取消或保存未知均保留 UNKNOWN。

唯一原账本新增 ACCEPTED 及严格接收证据；不代表审核通过、开始消耗或人工画面验收。只有在同进程内由完整 READY 集合创建、不可序列化恢复的 capability 才可提交接收结果；普通保存不能把历史 UNKNOWN 升级。永久 fence 和确认 intent 不移除，重启不重新确认，已接收结果及其 alias 禁止重传。旧 reader 对未知结果必须失败关闭。

用户报告已经手动点击热敷贴 `1876956000684231` / 计划 `1877477842671690` 的最终确定。这是人工操作事实，非程序回执；`5144529d-7f38-4fe1-aed1-3b8d504cd480` 保留历史 UNKNOWN 原字节及防重屏障。为继续本增量，已停止旧候选 Harness，结果 NOT_EVALUATED；最终源字节须重新验证。

## Historical Checkpoint

本节及后续旧检查点按发生顺序保留；当前候选状态见文末 Accepted Candidate，旧的“尚未实现”描述不是当前实现基线。

已写入调度 schema、私有持久化、每日 occurrence 防重、固定项目/账号/素材执行适配，以及原制作 controller 的可信快照入口。新增三个测试文件共 13 项通过；既有制作测试 65 项通过。前端提供保存与任务列表入口，缺少主进程 bridge 时明确显示服务未加载并禁止保存。

主进程 IPC、启动/停止、关闭窗口后台常驻、原上传服务适配与同批自动确认尚未实现。全自动流程当前不可用，不能以独立模块测试代替产品交付。

初次接管授权后，其他会话继续修改 `src/main/douyin-upload-service.ts`，受管 Kimi 的封存映射返回 `SOURCE_CHANGED`；会员功能同时修改 `src/main/index.ts` 与 `src/main/preload.ts`。这三个文件构成新的实际同文件冲突，已请求用户确定所有权，等待期间未写入这些文件。Kimi 无有效映射结论，未完成最终实现审查。

`typecheck` 尚未通过：前端需要的五个 automation bridge 方法未接入；同时存在其他会话会员功能的类型错误。Chrome 集成交互、自动上传确认、后台常驻、Harness completion、最终 AOCI 维护与 Verify/Check/Guide 均未完成。AOCI 刷新期间共享索引变动，不能声明治理对齐。当前只是保留未完成工作，未 commit/push；恢复后须先确认同文件所有权，完成接线及全部相关验证再交付。

前端三个 focused 测试文件曾有 94/94 通过，但最后一轮为 79/94 通过、15 项浏览器测试超时，退出码 1。最终前端状态不能标记通过；超时原因尚未调查，恢复后需定位并重新验证。

## Resumed Implementation

用户再次回复 A，授权本会话接管上述共享文件并继续。已完成可信 automation IPC、启动停止、后台托盘、固定模板执行接线和手动操作互斥；保留会员及历史上传闭环改动。首次界面挂载的 TDZ 问题已修复，固定范围变化会清除旧授权，无效清理范围不能静默缩小。

当前调度/主进程/固定制作/runtime 测试 16/16；制作、上传准入与新 UI 回归 87/87。Chrome MCP 在隔离页面验证新任务保存、暂停、改时和删除，截图位于本机 `/tmp/jianji-automation-20261010/automation-ui.png`；该页面没有真实账号操作。旧模板缺少覆盖配置时漏绑默认自动覆盖模型的问题，新增失败复现后修正为复用 DEFAULT_COVER_STICKER 的解释。

真实平台只读核查未能资格化本地视频最终提交回执。候选 add-uni-prom-materials 的已发现调用者属于 AI 成片采纳，不能充当本地上传成功证据。上传适配仍在实现和验证；目前不能宣称全自动上传闭环已完成。已询问用户选择具体测试账号、计划和成片以取证，或暂不启用真实上传。

最终 typecheck、完整相关 Harness、风险审查与提交推送尚待完成。AOCI 新刷新事件 automation-resume-20261010-compaction2 在第 2 块遇到 cognition_snapshot_unavailable：正式索引被并发修改，未采用混合快照；待稳定后按官方流程继续维护和验证。

## Bounded Live Verification

用户选择允许一次真实上传确认，并明确授权从 `/home/reggie/电商/千川账号配置.json` 自行选择账号、计划与成片。最终选择肥皂 advertiser `1876414814643802` / plan `1876591298030592`，原已验证导出 batch `f347c39e-8437-4ee5-822a-014878b1c1b2`、task `45a9d029-a536-4859-bc79-05d99fe1a9e6`，SHA-256 `bb426a12b44591bbb3199ec3c895205a0e0776032f3fc12a22c7ede93b98784d`，24,972,962 bytes。原 task、intent、选择屏障及内容 hash 均无重复。

为避免两个进程写同一上传账本，先通过 scripts/dev-stop.sh 正常退出 dev app。第一次调用在 uploadAutomation 入口 busy 准入处拒绝：restoreConfig 自带的目录预载尚未结束。候选新增 intent/task 均为零，未选文件、未点击确认；保留 `/tmp/jianji-automation-20261010/live` 的 attempt/results，不重写记录。允许修复准入时序后第二次有限验证；真实选文件和确认预算仍至多一次，不对任何 UNKNOWN 重试。

确认屏障已改为先向原账本持久保存 NEEDS_HUMAN/MAY_HAVE_UPLOADED，再保存独立确认 intent，最后才点击。恢复路径同时检查原账本标记和 intent，禁止重新解释为 READY。该版本新增及原上传服务/页面回归 118 项通过、typecheck 通过。父线程额外复现并修复旧模板默认覆盖模型漏绑与固定输出目录符号链接漂移；相关调度/runtime/主进程测试现在为 20/20。

第二次有限验证修复了预载 busy 冲突，但仍在登记前因冻结连接比较拒绝：`QianchuanAccountSettings.preflight` 会返回 `preparedBrowsers` 的已发现端口，预载使两次读取间发生合法 runtime endpoint 解析。原账本确认候选 intent/task 仍均为零，未选文件、未确认；保留 `live-2` 原证据。调查并修复配置身份与运行连接的混淆后，允许第三次有界准入验证；累计真实文件选择和平台确认上限仍各一次，任何已选择或未知结果立即停止，不复用未知记录。当前七个 automation 测试文件 31/31 通过，尚未完成平台成功回执资格化。

配置冻结新增 `QianchuanAccountSettings.configuredAccount` 只读入口，保留私有配置 availability 与 digest 校验；固定配方不再混入临时发现端口。本次原上传 `prepare/freeze/registerBatches` 仍核实际连接，原文件选择屏障不变。后台模块已在独立 Electron 窗口实测：显示→隐藏→重新显示均符合预期，使用独立临时 userData，无真实调度任务；日志 `/tmp/jianji-automation-20261010/background-probe-2.log`。该证明不替代 Windows 实机或托盘菜单人工交互验收。

第三次肥皂尝试在计划列表初始化超时处停止，原账本候选 intent/task 仍为零。页面只读核查显示商品自选控成本与放量均无计划。依据用户“你自己找一个”的授权，只读核查热敷贴目录成功，选择 advertiser `1876956000684231` / plan `1877477842671690`。唯一真实候选更换为 project `995593c6-b23d-46b3-b29b-7e9569e85680` / batch `2425c5a9-2d73-47d8-ae0c-84acf2ccf184` / task `3e08a352-4056-4883-b90e-0c0758d0112e`，7,072,999 bytes，SHA-256 `c8b32ddd1fd110f4b5c6c430294b03bf370461113d1b36df42c47b56ffff4e38`；原账本及选择屏障无候选或内容重复。`live-4` 为最后一次有界真实准入尝试，任一文件选择/确认后停止，不重试 UNKNOWN；历史三次零副作用证据保留。

`live-4` 已真实选择一条文件并达到 READY，原上传面板点击一次确定后出现额外“确认添加并开始投放 1 个素材吗？”弹窗。pageBatch `5144529d-7f38-4fe1-aed1-3b8d504cd480`、原 target `814A3E672D1393CDD4AFA21848966ADF` 保持未知屏障，平台接受回执为零。用户另行授权只对该现有弹窗最终确认一次；执行前检查发现原弹窗及上传面板已隐藏，按钮无可见矩形，拒绝点击。未创建最终点击 once 文件，未重新选择或重建上传页面，未知账本不改写。关闭原因未确定，已询问用户是否手动操作；页面缺席不能证明提交成功或失败。

已恢复 `make frontend`，主进程和 Vite 已启动。`npm run build` 已通过；新增配置身份修复和原上传/settings 回归 159/159，通过 typecheck 与 diff 检查。仍缺平台最终回执、完整双层确认的产品实现与验收；本轮不能声明全自动上传闭环完成。最终 Harness、AOCI、本任务与未提交会员/历史闭环依赖的提交边界、风险审查、commit/push 尚待完成，不以当前本地测试代替交付。

## Accepted Candidate

双层确认及严格平台回执已接入原 page/service/store，新增 ACCEPTED 的持久及界面投影；最终整批观察修正多条文件先后 READY 的 selectedCount 差异。当前 8 文件定向回归 82/82，构建通过；文案调整后两个上传 UI 文件 15/15。被动回执只消费源页面两条精确请求，不直接调用平台接口；缺 Content-Length 或平台协议不符保持未知。历史手动确认不转写为自动接收。

真实平台 ACCEPTED 尚未验证，原一条真实文件预算已经消耗。最终完整 Harness 和适用审查仍待完成，产品不预设真实定时任务。该候选的自动接收路径仅有隔离 Chrome 与本地请求 fixture 证据，不能冒称平台验收。

## Acceptance Review Correction

首个完整候选的 Harness 16/16 与 completion verify 通过；受管 Kimi 审查 invocation `d36b4f65-6862-4567-9bc1-ae2a94b0c7bc` 返回 EVIDENCE_INCOMPLETE，因为报告引用了没有实际 Read 的 account-settings 源码。原报告隔离保留，不作为有效审查；已消耗一轮，下一轮仍须完整审查并只引用实际读取证据。

父线程独立复现同目标、同字节的两个制作项目：未知屏障保存已清除 alias 的 READY，因此“存储损坏”推断不成立；实际缺陷是成功接收后 alias 未同步，导致整轮误报未知。原 store 现在共用同一 alias 同步函数，在 live acceptance 的原子提交内投影已接收证据；全批均为已接收 alias 时上传编排直接完成，不再选文件或确认。历史 UNKNOWN 原记录不恢复，封存与丢弃记录不修改。回归覆盖同轮重复、重启和后续新制作同内容去重。

独立上传继续消费来源任务最近一次尚未消费的成功制作，不增设“必须同一天”的限制；防重 claim 与实际成片校验保持原合同。新的源码候选须重新验证及审查；平台最终接收仍需额外一次明确授权的真实测试。

## Verification Blocker

alias 修正后的上传回归 8 文件、188 项通过，包含原历史结束与恢复测试；typecheck 与 build 通过。初次 typecheck 被会员会话的 `manual-payments.ts` 类型错误阻断，该会话随后修复，本会话没有修改会员业务代码；用户选择 A，会员文件继续由原会话负责。

本会话按官方完整机器批次维护 12 个共享索引对象（自动上传两个 owner 与会员变更十个对象），Verify/Check/Guide 曾证明对齐。随后会员会话继续修改 `billing-page.ts`，正式资产检查 `.agent/harness/runs/20261009T222816Z-3028e51e` 因该对象 stale 失败。全量 Harness `.agent/harness/runs/20261009T222718Z-a859cac2` 在源码已变化后由本会话中止，保留 NOT_EVALUATED 回执；此前候选的 16/16 PASS 不代替当前候选验收。

当前自然停止点是共享验证快照不能稳定：自动化业务改动保留，未提交或推送；第二轮有效独立审查尚未启动，未耗用额外真实上传预算。待共享源码稳定，先重新核对 owned scope 和 AOCI，再完成 Harness、有效审查及本任务提交推送；共享索引中的会员部分不得当作自动化业务归属。没有专用 session-record Skill，故在本 plan 记录此次恢复与阻断，不写长期 Memory。
