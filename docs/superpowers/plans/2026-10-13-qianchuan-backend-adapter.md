# Qianchuan Backend Query Adapter Implementation Plan

## Goal And Scope

在现有千川账号浏览器会话内直接调用已通过 REA 观察的后端读取接口，形成可独立测试的 adapter，接入 JIANJI 的计划详情、计划素材指标和账号报表查询。用户追加要求：CDP 已成熟的部分继续使用 CDP，不为逆向而重写。

## Owners And Invariants

- `QianchuanBackendAdapter` 独占已验证的只读请求 recipes、业务响应与数据投影。HTTP POST 的报表请求仍属于只读；不能暴露任意 URL、method、headers 或脚本给 renderer。
- 复用计划读取当前的 guarded loopback CDP、owned picker target 和关闭规则。账号来源仍由 `DouyinUploadService` 与账号配置 owner 冻结和核验。
- 保留上传文件选择、批次并发、确认回执、计划目录和清理流程的现有 CDP 行为；不改变上传队列、永久屏障、冻结任务和 unknown-outcome 规则。
- Cookie/token/signature 留在广告主浏览器。请求使用同源 `fetch`，不导出凭据、不直接访问其他 origin、不复制捕获的签名或 fingerprint。
- 请求前后绑定同 document、广告主 URL 和可见账号身份；取消与有限 timeout 停止请求；结构变更和账号切换不返回成功。错误不包含平台原文或完整请求 URL。
- 输入限定合法日期、已准入指标、offset/limit 与可验证的 plan ID。数字 ID 保持字符串；指标保留平台显示值并输出字符串，不在客户端重新计算金额。平台 JSON 中原本为 number 的值仍受 JavaScript 数值精度限制，不承诺任意精度。

## Current And Target Behavior

当前 CDP 上传与确认 owner 已有完整任务语义，计划目录也是有界读取。缺少独立可调用的计划详情、素材指标与商品自选控成本汇总报表查询边界。目标是只增加该缺口，正常浏览器负责登录和会话，后端接口负责取数，不通过报表页面 DOM 抓指标。

REA live 证据：计划详情、素材列表与 `statQuery`；本轮又直接 `fetch` 验证计划详情 HTTP 200 / `status_code: 0`，不附加捕获的签名参数。素材上传 SDK 及 auth-key 存在，不据此声明 direct upload 链已验收。

## Milestones

### 1. Backend Query Contract And Adapter

新增 `src/shared/qianchuan-backend.ts`、`src/main/qianchuan-backend-adapter.ts` 与 focused tests。实现计划详情、当前商品自选计划素材指标、账号汇总报表；限定接口与参数、响应大小、业务状态、身份、日期口径和分页。保留金额/计数的原始字符串，响应投影不包含 URL、token 或原始业务 JSON。

### 2. Existing CDP Session Reuse And JIANJI Entry

将 `qianchuan-plan-catalog.ts` 的 owned picker connection/cleanup 提取为 `qianchuan-query-page.ts`，原计划目录通过相同 helper 执行；backend query 使用该 helper，不新建第二浏览器绑定或 credential store。`DouyinUploadService` 只负责账号解析、冻结、cancel、返回 typed result。

用户选择 A，授权串行接手 `index.ts` / `preload.ts` 并保留已有改动。只增加本任务的 trusted IPC 和 typed preload 方法，提交时排除其他会话的 automation 改动。

千川新增“计划与数据”页，查询账号来自已保存的账号配置，计划 ID 默认显示该配置值并可编辑。三类查询均需用户点击；素材每页 100 条、按平台返回 total 翻页。输入变化清除旧结果，页面离开、账号绑定变化和取消均撤销请求；迟到结果不得重现。报表明确商品自选控成本口径与北京时间。只读查询保持 membership 准入，取消保留 trusted sender 与 request ownership 检查并允许恢复。

### 3. Verification And Delivery

执行 typecheck、focused adapter/browser-fixture tests、受影响计划目录 tests 和 policy-routed Harness。新测试登记入现有 registry，scope 仅包含本任务 owned files。使用 Chrome MCP 做查询入口交互验证或记录 ownership/runtime 阻断；平台取数验证只读，不上传文件或修改计划。稳定后执行 applicable AOCI、Risk Gate、仅本任务文件 commit/push，核对 upstream HEAD。

## Acceptance And Limits

通过测试证明：固定三类读取接口、跨账号/重复参数/document drift 拒绝、业务失败与超限拒绝、无 secret 回显、取消终止、素材分页精确。原 CDP 上传与目录行为保持原合同。真实只读取数与 fixture evidence 分开报告。

本轮不逆向并猜测创建计划、改预算或新 upload handshake；现有绑定和添加素材继续由已成熟的 CDP 确认流程执行。账号报表时间范围采用千川页面口径，报告中明确请求的开始/结束时刻与指标名，不代表审计或投放效果保证。

## Self Review

该边界覆盖当前已验证协议并遵守用户追加的 CDP 保留要求。未把 bundle presence 当作写入 acceptance，未替换原生命周期或建立第二队列。跨会话文件冲突只阻断对应入口写入；不阻断独立模块和验证。

## Implementation Evidence

2026-10-13：独立 adapter、owned query page 与主进程 `DouyinUploadService.queryBackend` / `cancelBackendQuery` 已实现。查询纳入既有 busy gate，取消按 sender/requestId 隔离，stop 等待清理；不缓存或恢复旧请求。

真实登录会话的三条固定 recipe 均读取成功：计划含 1 个商品；素材第一页返回 100 行、总数 204；报表返回固定四项指标。仅验证读取协议，standalone probe 的 product 槽位与 digest 是测试参数，不作为主进程账号冻结证明。主进程账号冻结、取消和 stop 由独立 fixture 覆盖。初次 probe 使用无效 product，Schema 拒绝；修正合法测试参数后成功，保留原失败日志。

focused verification 为 typecheck 与四文件 162 项测试通过；最终 Harness 回执保存在忽略的 `.agent/harness/runs/20261013-qianchuan-backend/`。REA 与真实读取的脱敏证据和受管 Kimi 调查 receipt 保留；Cookie/token/原始请求不进入 Git。

首次 required Harness 为 FAIL：千川组 39 文件、779 项通过、1 项失败；保留原回执。失败是已有测试对 `display: contents` 容器取空矩形，且错误要求当前横向布局为纵向。修正断言为实际 select 控件的水平间距、同一行对齐与无溢出；没有改动已成熟的 CDP 控件。对应 24 项测试随后全部通过。

用户 A 后已接通入口。独立 UI browser fixture 覆盖三类查询、分页、输入作废、取消、页面离开、账号变化、迟到响应与窄屏；完整 App fixture 覆盖千川导航与 saved account 输入；session fixture 覆盖连接/导航错误脱敏和取消。Chrome MCP 的新隔离页验证查询交互，不操作真实平台写入。最终 policy-routed Harness、AOCI、Risk Gate 与提交回执由本任务忽略目录保存，不能以局部 PASS 替代其 completion gate。
