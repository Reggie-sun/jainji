# Qianchuan Current Subaccount Delivery Record

## Account Display Correction 2026-10-13

用户指出上一轮只识别计划，上传账号下拉框仍显示保存的旧 Chrome 名称和 ID。根因包括账号控件只消费保存摘要，以及批量 renderer 把新子账户计划与保存锚点 ID 比较。当前 owner 增加同一次目录读取的网页账户快照（名称及 ID），空目录仍返回账户；普通、追加及批量控件消费该快照，读取失败/刷新清除旧展示。名称从账户信息框读取，排除头像首字；保存映射和主进程目标证明保持。用户选择 A，授权只调整已有脏 `preload.ts` 的千川读取类型，其他自动化改动保留。

reader 名称测试先失败；批量 UI 回归先复现“新子账户计划已返回，账号仍为旧 ID”。修复后相关 5 个文件共 139 个测试通过，包含空目录、名称漂移、账户与计划不一致、旧 runtime 数组兼容、刷新失败、批量明确 B 计划提交及原保存关联。正式 Electron IPC 返回 `reggie呵护商贸-1 · 1876039035222536` 和属于该账户的计划 `1878843675747371`；实际批量页面的账号 dropdown 显示相同名称/完整 ID，plan 下拉框亦属于同一 ID，任务数保持零。Chrome MCP 只读核对网页账户信息框；Electron UI 使用实际 CDP 交互和截图，均没有选择文件、确认或删除。

受管 Kimi deep 只读 mapping `e7d046c8-8106-4d0f-934a-455dd18ab390` 的 canonical receipt 为 PARSED，4 次请求均 `IDENTITY_VERIFIED`，required source Reads 完整；parent 采纳账号显示与普通批量 renderer 校验两处证据。报告将保存绑定漂移与网页子账户切换混为部分建议，parent 根据当前 source 区分两者，不采纳修改保存绑定 resolver 或定时语义的建议。该 mapping 不代表最终 implementation review。最终候选 Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求额外审查；本增量只传递已核对账户展示及 renderer 普通制作校验，不修改主进程签发/证明/fence/确认准入，已有防伪与漂移用例和真实只读 UI 证明覆盖相应边界，无新 critical authority failure path 或重大未验证缺口。上一轮的两次审查仍保留原记录，不把 mapping 作为第三轮 review。

本增量 owned scope、Harness、官方 AOCI 和仅 owned 提交字节验证保存在 `.agent/harness/runs/20261013-account-display/`。项目没有可调用的独立 session-record skill，本节作为 stable checkpoint 记录；证据不授予真实上传、Windows 或平台投放验收。

## Goal And Candidate

用户确认：子账户在千川网页内切换，上传计划读取当前新子账户。用户选择 A，授权本会话接管已有脏 service 文件并保留先前改动；只提交本任务新增 hunks。[实施计划](superpowers/plans/2026-10-12-qianchuan-current-subaccount.md) 已自审，本轮没有保留额外用户批准步骤。

当前实现将保存账户作为浏览器锚点，从该浏览器的可见千川页面读取实际子账户，再在隔离目录页核对并列出计划。普通上传选择器显示实际账户 ID，返回焦点时刷新；新账户或错误使旧选择失效。主进程重新检查目录，并用仅本进程持有的目标证明约束授权、登记和首次选择文件。跨模板准入核对明确计划账户，继续校验保存关联。

目录页默认“放量投放”导致控成本计划初始化超时：身份确认后仅在自有页选择一次“控成本投放”，再沿原同 Document 稳定分页和双 ID 校验读取。产品范围是既有商品自选控成本目录；不声明放量计划支持。保存映射、浏览器绑定、模板关联和旧冻结任务不迁移；清理和定时的保存账户身份合同保持。VPS remote-browser 切到与保存绑定不同的子账户时明确拒绝并提示保存绑定，避免改变其自动浏览器生命周期。

## Runtime Evidence

- 保存锚点为 `1876036793517065`，绑定 Chrome 当前页的 URL、可见标题 ID 均为 `1876039035222536`，标题为 `reggie呵护商贸-1`。原 `prepareExisting` 要求旧账户页面，产生截图中的“未找到该账户的可连接浏览器”。
- 当前正式 Electron IPC 请求 `listQianchuanPlans({ product: "氨糖膏", expectedAdvertiserId: "1876036793517065", accountSource: "current-browser", refresh: true })` 成功返回新子账户 `1876039035222536` 的计划 `1878843675747371`，名称 `2026-10-12_商品全域投放_19:28:43`，同时返回商品名及 current-browser 模式。
- 证据保留于 `/tmp/jianji-subaccount-20261012/live-current-account-fixed.json`。目录操作结束只清理自有 picker；原网页、账号映射和浏览器绑定保持。应用测试前任务数为零，本次没有选择真实文件、点击平台确认或删除素材。
- Chrome MCP 已尝试集成交互，但其原 endpoint 返回 `ECONNREFUSED`；未修改全局 MCP 配置或其他浏览器。实际 Chrome CDP fixture 与正式 IPC 作为此次浏览器证据，不声称 MCP 验证通过。

## Executable Verification

新 reader 回归覆盖可见 B/隐藏 A、URL/DOM 冲突、可见账户歧义、两次读取漂移、排除程序页及上传页、取消和有界超时。服务回归覆盖 B 的授权/intent/文件选择目标、未持有证明的伪造请求、登记及首次文件选择前 B→C 漂移、保存映射漂移和历史 UNKNOWN。UI 浏览器回归覆盖当前账户模式、账户加计划 ID 的选择校验、返回焦点刷新、清理用途兼容和紧凑布局。

目录修复的 matching fixture 先复现初始化超时；实现后完整目录 25 个测试通过，错误账户 fixture 保持零点击并拒绝。最新 typecheck 通过；目录、选择及 reader 合计 58 个测试通过。较早当前行为 checkpoint 为 settings/selection/UI/service 共 201 个测试通过。最终 owned Harness 和安全审查结果以下方最终证据为准，旧 checkpoint 不替代新候选验证。

## Delegation And Review

按 `external-subagent` Skill 执行的旧 read-only Kimi investigation `54c606f5-838a-4903-86c3-6132fb81afd8` 在直接根因证据取得、范围改变后主动退休，canonical receipt 为 cancelled / OUTCOME_UNKNOWN。未采用 partial 输出，未把它当作完成的独立审查。native bounded reader worker 已交付，父会话检查源码和独立运行测试；没有同文件并行 writer。

最终候选的 Review Risk Gate 在 project-native verification 后判定：跨账户目标校验失效可将成片上传到用户未选择的广告账户，生产确认后不能安全撤回，因此按 critical consequence 触发一个受管 read-only Kimi deep adversarial review。审查必须绑定最终 snapshot、计划、Harness 证据；父会话独立裁决 findings。

首轮 managed review `9dde253f-bf07-4ba4-a2cf-40a399053e61` 为 PARSED，五次上游请求均完成认证身份核验；没有 blocking_candidate。父会话确认 F1：初次 preflight 与实际目录准备间保存锚点变化时，列表仍可能返回。新增回归先复现错误返回，再在目录读取前核对本次实际准备的锚点，27 个选择测试通过；前后完整快照相等校验继续约束读取期间的变化。该修正只涉及目录读取边界，新候选须经原生验证及 targeted re-review。F2 建议首次文件选择前再读一次目录，现有 preflight 已新鲜验证计划，首次选择由原页面双 ID、文件身份及当前账户证明约束；本轮不增加重复目录读取。F3 建议更早清理证明，现有证明绑定完整授权和 pageBatchId、关闭批次不能恢复资格且新制作清空，保留既有有界生命周期。

## Completion Boundary

最终证据保存在本轮 `.agent/harness/runs/20261012-current-subaccount/` 的 owned scope、官方 AOCI Verify/Check/Guide、Harness 及 managed review receipts 中，Git 提交与 upstream HEAD 提供交付身份。第一次完整回归暴露旧 UI 返回行为断言，更新为返回时重新核对、相同目标保留选择后，batch-upload 与 batch-production 的 82 个用例通过；最终 Harness 必须在稳定候选上重新执行，不能用第一次失败回执完成。

目录读取成功不代表真实文件上传、平台接收、审核或投放验收；本次未执行这些动作。历史 UNKNOWN 不修改、不重试、不重新分类。共享 service 的其他会话改动保留在工作树；暂存候选只应用本任务差量，并额外验证仅这些提交字节在 HEAD 上的可编译性与相关行为。共享正式索引与 baseline 同样按 owned 对象投影提交，保留其他对象未提交状态。
