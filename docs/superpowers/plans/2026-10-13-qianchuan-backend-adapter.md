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

## Real Acceptance And Budget Display Correction

2026-10-13 用户授权真实验收后，在当前 `make frontend` Electron 窗口通过“千川 → 计划与数据”实际操作，使用已保存的肥皂账号和原绑定 Chrome；未替换 preload、IPC、账号解析或后端请求。计划详情、素材查询、报表都经过真实 renderer → trusted IPC → 主进程账号冻结 → 独立 adapter → 登录浏览器接口链。

当前投放计划的素材总数为 204，三页分别为 100 / 100 / 4 行，204 个 ID 全部唯一，末页禁用下一页；旧配置计划的空素材结果也正常返回。商品自选控成本报表消耗 0.23 元、订单 0、成交金额 0.00 元、支付 ROI 0.00，与同时观察的千川页面一致。真实查询取消后等待 6 秒未出现结果，查询按钮恢复，原浏览器标签 ID 保持不变，没有残留 picker；后续真实查询成功。这次取消验证的是实际请求生命周期及清理，不单独证明特定 HTTP 响应阶段的流中断。

验收发现预算展示错误：adapter 保留接口原值 `100000000`，renderer 却未换算。REA 保存的前端源码明确将 `adDetailInfo.budget / 1e5` 后按两位小数展示；来源 script artifact SHA256 为 `fe67f683922f0a4b3845a329289bee32933cee7176fd111db5ced17003c0be0f`。renderer 现在显示“预算（元）”及 `1000.00`，保持共享返回类型和原值不变；浏览器 fixture 使用相同原值，回归断言先失败再通过。所有平台指标仍沿用原显示串，不重算报表。

本次范围为 Linux 当前登录账号的只读链路；不外推为六账号、Windows、长期接口稳定性或上传/修改预算的验收。真实截图、脱敏结果、runtime identity、REA 换算片段及 Kimi 验收条件映射保存在忽略的 `.agent/harness/runs/20261013-qianchuan-real-acceptance/`，不保存 Cookie/token。修正后相关验证、AOCI 与 Git 回执按同一 owner 记录。

## Closed Account Browser Query Repair

2026-10-13 用户截图中的氨糖膏账号 `1876036793517065` 报表失败。真实 renderer/preload 调用复现了主进程的“请先打开该账号的千川浏览器”拒绝；原绑定 Chrome 未运行，尚未发送报表请求。此前肥皂账号验收不能外推到这个账号。页面通用错误遮住了浏览器准备阶段的原因。

显式查询现在调用现有 `prepareCatalog(product, true)`，连接已有窗口，或由原 browser manager 打开已证明不存在的本地绑定窗口；保留原 profile、身份、出口核验及无效/不唯一连接拒绝，不重启运行窗口，不回退 VPS、不恢复历史查询、不增加重试、上传任务或平台写入。基类补齐该可选参数，默认仍为 false；其他调用行为保持不变。页面说明同步明确自动连接/打开与失效登录的人工处理。Self-review：这是既有前台准备能力在查询入口的复用，不建立第二生命周期；不扩大至逐类错误协议重构。

回归测试先复现闭窗拒绝，再证明前台准备、报表返回、配置冻结及上传队列为空；四个相关文件 83 项通过，typecheck 通过。真实 `make frontend` 主进程查询打开原绑定 Chrome 并返回成功；随后在“千川 → 计划与数据”选择该账号、当天商品控成本汇总并点击查询，界面显示消耗 `0.00`、订单 `0`、成交金额 `0.00`、支付 ROI `-`。账号配置字节保持不变、上传任务仍为零。支付 ROI 沿用平台显示串，不把 `-` 改成零。

本轮恢复 `rea` 的缺失本地依赖和编译产物后，以 `inspect-web-page` 只读观察该原账号页面；工具源码没有修改。CLI 的 origin array 初次传参失败，修正后产生 Evidence `inspect_web_page`。Kimi 封存只读失败边界调查 `2b7d7f73-4e6d-4c25-b9f6-f1ed0e93fe9d` 为 PARSED、实际读取六个指定文件；其建议的完整失败协议重构未纳入本次已定位修复。无 DISPLAY 的独立 shell 准备探针未能启动 Chrome，不能作为产品启动失败或验收；验收以实际 Electron 正常桌面环境和真实 UI 为准。脱敏截图、RED/GREEN、REA、Kimi 与最终验证保存在忽略的 `.agent/harness/runs/20261013-qianchuan-query-failure/`。


## VPS Closed Browser Query Repair

### Goal And Ownership

用户明确要求修复 VPS 查询路径。截图账号 `1876024170199244` 使用既有 `remote-browser` route；实际查询在 `prepareCatalog` 的 existing-only 远端请求阶段失败。只读 SSH 检查证明 worker 与原账号目录存在、VPS 无 Chrome 进程，尚未发送数据查询。查询准备语义由 `QianchuanBackendQueries.run` 独占，目标源码只修改 `src/main/qianchuan-backend-queries.ts`，回归归入既有 `tests/qianchuan-backend-queries.test.ts`；本节维护现有 plan。

### Target Behavior And Invariants

显式查询先以 `preflight` 核对保存的 advertiser identity。远端账号使用已存在的 `accounts.prepare(product)` 打开或连接该账号原 VPS 浏览器；本地继续使用 `prepareCatalog(product, true)`。准备后核对 advertiser、配置 digest 与出口，再调用原 adapter。固定主体、SSH alias、出口和原 profile 仍由原 browser manager / remote runtime / worker 验证；不新增绑定、替代目录、登录状态存储或 SSH owner。失败不回退本机、不盲重试或自动重连；旧任务与旧批次不变。取消仍等待准备结束并阻断随后的 backend read，不关闭账号原窗口，查询后原冻结检查保持。

### Acceptance And Verification

回归需先复现远端关闭 Chrome 时 existing-only 拒绝；修复后明确走已有准备入口，本地不走远端准备；stale advertiser 在 browser action 前拒绝，准备期间 digest/出口变化拒绝；远端准备失败不 fallback/retry；取消不发出后端读取且正确释放 busy。执行 typecheck、backend/账号/remote 受影响测试及 scoped Harness。真实验收使用现有 `make frontend` 查询截图中的 VPS 账号，核对固定出口、原 profile、返回 advertiser 和报表指标及 picker 清理；不上传或修改平台数据。真实登录或远端条件仍阻断时保留失败证据，不用 fixture PASS 声称实际恢复。

### Self Review

该修订只把用户显式查询接入既有正常浏览器准备入口。它不修改远端 protocol、恢复门、扩展目录或生产 owner；窗口内仅在 `/tmp` 准备候选，不影响并行任务的共享稳定源码。源、测试和当前运行证据分别验证，最终统一维护 AOCI 并仅提交 owned paths。


### Implementation And Real Evidence

2026-10-13：旧 query owner 加六项回归后为 6 FAIL / 7 PASS；应用 route 修复后，backend-queries、account-settings、browser-manager、remote 四文件 101 项全部通过，typecheck 通过。受管 Kimi immutable mapping invocation `aa898cfb-17e7-4271-8acc-21e92958b9e0` 的 canonical receipt 为 PARSED，18 个引用 span 的源 hash 均由 Parent 核对；它不是 implementation acceptance。

运行中的 `make frontend` 空闲重启后，通过正常“千川 → 计划与数据”查询蝴蝶贴 `1876024170199244` 的当天商品控成本汇总，真实 renderer → IPC → 账号准备/冻结 → adapter 链返回消耗 `0.22`、订单 `0`、成交金额 `0.00`、支付 ROI `0.00`。账号 mapping hash 前后相同，上传任务保持 0；没有上传、修改计划或预算。该证据只支持 Linux 这个 VPS 账号的本次只读查询，不外推全部账号、Windows 或长期稳定性。Harness、REA、原 profile 与清理证明以及 Git 身份回执保存在本任务忽略/私有证据目录。

## VPS Slow Loading Readiness Repair

### Goal And Ownership

用户在计划详情查询中看到 VPS 页面仍加载却已报错并关闭。原 query owner 等待 `domcontentloaded` 后仅等账号容器可见 10 秒，随后立即创建带严格账号 ID guard 的 adapter；账号容器先出现、ID 后渲染会过早失败。原 cleanup 只关闭本次 picker，不应改变原账号窗口。修改 owner 为 `src/main/qianchuan-backend-query.ts`，验证归入现有 `tests/qianchuan-backend-session.test.ts`，本节为本次 implementation plan；不修改其他会话的远端、扩展、选择组件或上传文件。

### Target Behavior And Invariants

导航在响应提交后进入 readiness 等待，不以完整页面或网络空闲作为准入。最多等 60 秒出现唯一、可见且与 URL 同一 advertiser 的账号 ID，再创建原 adapter 并只发一次只读查询；容器空壳仍视为加载。错误账号、歧义身份、登录或验证码出现时阻断；adapter 的同 Document、账号、请求及返回 guard 保留。整体 90 秒期限、用户取消、出口租约、前后冻结及失败后 picker 清理沿用原 owner，不增加重试、重连、本机回退、账号绑定或平台写入。整个请求已取消时不发后端请求。

### Acceptance And Verification

先用 ID 延迟 12 秒渲染的测试复现旧行为，然后覆盖 readiness 前零请求、正确身份单次查询、空壳/隐藏/错号/重复身份/登录或验证码/URL 错号拒绝，以及 readiness 后取消不读取并释放 handle。执行 session/queries 相关测试、typecheck、当前 policy required scoped Harness 及 completion；源码/AOCI 保持对应稳定字节。真实验收在原上传与其他任务稳定窗口释放后，通过正常 UI 查询截图账号的计划详情；不操作用户正在上传的原 profile，不以此前报表成功代替本次计划查询。外部登录、计划目标或慢网络仍阻断时保留实际失败并报告。

### Self Review

只改 page readiness 准入；未放宽账号/出口/Document guard 或失败恢复规则。等待参数是有限的，外层取消与期限仍能结束查询。私有副本完成 RED/GREEN 后再落入三项已确认无并发 owner 的文件；真实环境未验收前不声称截图已修复。

### Implementation And Real Evidence

2026-10-14：旧源码的延迟账号 ID 回归先 FAIL；修复后的 session/queries 27 项与 typecheck 通过，其中独立 Chrome 将 ID 延迟 12 秒渲染，随后原 adapter 只发送一次计划详情请求。受管 Kimi 只读 mapping `d65445b3-cf74-4ec9-9767-845883fa0710` 的 11 个 source span 已由 Parent 核对，不作为验收或 final review。

正常 `make frontend` 自动空闲重启后，经真实 UI 查询截图中的 VPS 账号 `1876024170199244`、原计划 `1876036593854788`，约 27.8 秒返回计划详情、预算 `300.00` 元和 ROI 目标 `2`。账号 mapping hash 前后相同，当前项目上传任务保持 0、素材保持 25；未重启主进程、操作其他上传账号或修改平台计划。原账号页面保留，本次查询页清理。该证据仅支持本次 Linux/VPS 只读计划查询，不推断其他批次上传结果或长期稳定性。RED/GREEN、真实 UI、REA、完整 Harness 与 Git 身份证据保存在私有 `/tmp/jianji-qianchuan-vps-loading-20261014/`；首次完整检查发现其他会话的选择器 SSR 回归，保留 FAIL 并由其 owner 修复后重新验证。
