# Manual Cover Missing Targets Repair

## Superseded Decision

2026-10-14 用户再次明确“不加框默认不覆盖”，并选择 A 授权本轮接手相关未提交改动。下文缺框拒绝及三态界面仅记录先前调查，已被该澄清取代，不再作为当前产品准入规则。当前合同见 [Manual Region Input Delta](semi-automatic-cover-review-spec.md#manual-region-input-delta-2026-10-08)，恢复计划见 [Plan](superpowers/plans/2026-10-14-manual-cover-missing-targets.md)。本轮证据在下方 Default No-Cover Restoration 追加，历史请求、失败和媒体记录保持原样。

## Problem And Change

用户报告启用手动覆盖后仍只有普通四角装饰。本机氨糖膏最近冻结批次包含四条素材，其中 `(16)`、`(17)` 有框，`(22)`、`(23)` 没有保存目标；60 条输出中后两条对应的30条没有覆盖层。旧正常制作把缺框直接解释成 `no_cover`，所以整批覆盖开关不能证明每条实际覆盖。

修复新正常人工制作的准入：共享 owner 区分有效框、逐素材显式空数组（不覆盖）及待设置。待设置在创作者请求和队列入队前拒绝，列出具体素材。编辑器显示三态数量及当前状态，允许保存部分进度，并用“此素材不覆盖”留下明确决定。已有通用有效框继承、旧审阅解释、冻结模板和重试保持原语义。

本轮未复现保存/加载丢框，未修改项目存储或素材导入，不从不同视频或历史输出推测覆盖位置。规则增量由 [Assisted Contract](semi-automatic-cover-review-spec.md#manual-region-input-delta-2026-10-08) 独占；实施边界及自审见 [Plan](superpowers/plans/2026-10-14-manual-cover-missing-targets.md)。

## Verification

- 回归先在旧实现失败（缺目标仍返回制作意图），修改后通过。focused 单元及真实 FFmpeg 集成12项通过，涵盖缺框零请求零入队、显式不覆盖、有框真实输出、旧批准和冻结重试；typecheck通过。
- Chrome MCP 使用实际 `CoverStickerPanel`、共享Schema和本地真实视频，在隔离页面验证部分进度保存、待设置提示、明确不覆盖后保存逐素材空数组；不操作用户项目或平台页面。
- 使用原氨糖膏冻结项目副本及真实源视频，新正常制作四条素材时明确拒绝 `(22)`、`(23)`，模型请求数0、队列批次数0，未改变原冻结文件。
- 只选择其中有框的 `(16)` 后，真实 MiniMax-M3 / Responses 创作者初筛与方案两次请求均HTTP 200，无重试或模型替换，经 `AgentController → AgentRunner → ExportQueue → TemplateCompiler → ArtifactVerifier`、真实 `h264_nvenc` 导出并发布为 `completed`。
- 对成片与原片的0.5s、3s、5.5s、中段、结尾前0.5s共五对画面，左上角旧“推荐”位于手动目标内，并在所查成片帧被遮住。当前145个bundle输入前后不变，原冻结文件和原视频SHA-256不变。
- 媒体Harness回执 `.agent/harness/runs/20261014T092802Z-e0c09857/receipt.json` 为PASS。本机私有生产请求、响应、冻结项目、成片、逐帧对照和source hashes留在本机，不提交Git。

## Limits

修复的是缺目标被静默跳过；缺框素材仍需用户设定目标或明确不覆盖，本轮没有替它们生成或恢复未知的框。覆盖仅证明指定区域遮挡，五帧检查不代表逐帧、整片人工视听、Windows或平台验收。已有四角装饰继续遵守原规则，目标框外内容不会自动擦除。另一个会话的图案过大调查不属于本轮实现。

## Independent Investigation

受管Kimi只读调查 `bad007fb-de84-466b-9377-7783fd9d3ebe` 实读四个限定文件，sealed `deep / k3 / max`、两次请求、canonical receipt `PARSED`。Parent核对完整提交和schema保留区域，未采纳没有实证的“存储丢字段”假设；采纳冻结项目作为逐素材绑定事实的检查点。此调查不是final implementation review，也不授予视觉验收。

## Shared Checkout Revalidation

第一份code Harness回执 `.agent/harness/runs/20261014T093250Z-0121d8dc/receipt.json` 保留为FAIL：另一会话提交覆盖图案尺寸变更期间，新用例要求ProviderError但当时实现仍抛Error，且共享源码身份变化。本轮八个owned文件未漂移。对方变更稳定后相关14项复测通过；本轮不修改其文件。

为避免旧算法样片代表当前版本，另封存当前145个输入并对同一真实源视频发起一次独立有界重验，原两次模型请求和产物保留，不自动重试失败结果。正式交付以当前稳定候选的owned Harness及completion receipt为准；仅PASS的旧测试组、模型返回和采样图均不能替代这些回执。

## Default No-Cover Restoration

用户再次明确“不加框默认不覆盖”，并选择 A 授权 Parent 接手相关未提交增量。移除正常人工制作中的缺决定拒绝和三态 helper；`manualProductionIntent` 与 `manualReviewInput` 恢复既有有效区域解释。界面显示“默认不覆盖”和有框/无框数量，清空最后一个框即可正常制作；未配置项无需写入空数组。通用有效框继承、显式空数组取消继承、非法轨迹拒绝、旧审阅批准、冻结重试和其他会话的整体覆盖算法保持。

先将回归改为期望默认不覆盖，实际失败于旧“无框素材未设置覆盖框”拦截；移除 gate 后 7 项 unit 和 3 项真实 FFmpeg integration 全通过。原队列混合有框/无框素材导出为 completed，未配置项制作前后仍为 undefined，无框冻结模板没有覆盖层，音轨存在且重试保持原模板。

Chrome MCP 在隔离页面加载实际 `CoverStickerPanel`、共享 schema 和一秒 FFmpeg fixture：27 条素材中 18 条有框/9 条无框直接保存，意图为 18 cover/9 no_cover，未代填空数组。选择无框项显示默认不覆盖；添加框、删除最后一个框及保存后数量和意图一致；27 条全无框也可保存，仍无逐素材空数组及页面错误。此证据不修改用户项目，不代表用户原片或 Windows/人工视听验收。开发 bundle 中的正常制作入口也已无缺框拦截。

本轮 code scope 为 `.agent/harness/runs/20261014-manual-no-frame-default/final-scope.json`；稳定回执 `.agent/harness/runs/20261014T134612Z-2a8922ba/receipt.json` 的 task-pages、typecheck、cover-contracts、local-random、documents、owned-aoci 全部 PASS（14/10/5 项行为测试）。保留旧失败回执 `20261014T134318Z-9e2c8242`：共享 `index.ts` 当时有 TS2339，AOCI/source 同时漂移；本轮 owned 字节未变，不把该回执计为通过。此前包含两个已恢复到 Git HEAD 文件的宽 scope 已精确停止自身进程，其非终态证据不授完成。

受管 Kimi 只读核对 invocation `0a24f763-2e6d-49e9-97cd-834234e2ffb6` 已取得 canonical receipt；一次请求 HTTP 403，classification=CREDENTIAL_OR_ENTITLEMENT_REJECTED、observed_reads=[]，未产生可用结论，未重试或替换模型。Parent 依据当前源码和实际验证裁决。

最终 Review Risk Gate 为 REVIEW_NOT_REQUIRED：用户未要求该实现 snapshot 的独立 review；本轮仅恢复原准入解释和状态文案，不涉及凭据、权限或 durable-state 写入，也没有关键级不可恢复后果；默认空框、继承、取消继承、混合队列、非法轨迹和冻结重试已有可执行证据，未发现重大后果与实质验证缺口同时成立。用户随后明确撤销 Kimi standing authorization，后续工程委派与 triggered reviewer 均只使用 Codex 原生 profile；该约束优先于残留旧 SUBAGENTS/Skill，历史拒绝回执不作为当前 route 授权。稳定源码 SHA-256 为 `CoverStickerPanel.tsx=5d026fe672d13abd3aa056d5c9ba25f26df87626d91da769a3c4b31dab6a5b33`；适用合同/计划及全部实际输入由实际 receipt 绑定。

官方 AOCI 完整七项批次已原子维护，包含本轮三个对象及当时共享事实，未修改其他业务源码。后续千川候选因 code_candidate_plan_stale 零写入停止；其他 owner 收敛后全库 Verify 对齐，最新 owned Harness 为 PASS。共享正式资产已有其他会话暂存内容，由其 owner 收尾，本轮不混入该暂存提交。提交仅包含覆盖 UI、两个回归、无框合同 hunk、恢复计划和本记录；其他整体覆盖合同增量保持在工作区。

本仓库未声明独立 session capture Skill，本次沿已有 concern record 保存稳定修复与失败证据；MiniMax runner capture 不适用于本轮 Kimi 拒绝。所有证明限于本轮工程和 fixture，不授真实平台或用户整片视觉验收。

## Delivery Revalidation

前一 code PASS 的后续 completion `20261014T134843Z-47407822` 因另一会话新增 `scripts/dev-multi-instance-smoke.mjs` 返回 receipt_invalid；policy、owned 和 contract SHA 均未变化，该 completion FAIL 保留。对新增文件稳定后的同一 owned 候选重新执行六项检查，code receipt `.agent/harness/runs/20261014T135037Z-a82377f1/receipt.json` 为 PASS。当前 code/completion 实际终态分别以该回执和本机 delivery-completion 回执为准，不将先前的 PASS 用于漂移后的交付。本记录另按 record-scope 进行文档检查。

共享 policy/AOCI owner 完成最终稳定保存后，最终 code 为 `.agent/harness/runs/20261014T140153Z-85a167f5/receipt.json` PASS，正式 completion 为 `.agent/harness/runs/20261014T140330Z-1c4ae398/receipt.json` PASS；六项 required 检查齐全，14/10/5 项行为测试、typecheck、文档和 owned AOCI 对应当前源字节。此对回执取代前面用于调查的旧 code/completion 作为本轮交付证据。Parent 检查最终 owned diff，保留其他源码、共享资产及真实 staged 内容，仅提交本轮六个 files/hunks。
