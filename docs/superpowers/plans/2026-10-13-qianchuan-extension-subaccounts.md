# Qianchuan Extension Subaccounts Implementation Plan

## Goal

通过 Chrome 扩展复用千川网页登录，读取子账户并同步用户明确选择；本机、VPS 和未来新绑定账户使用同一协议，子账户流程不使用 CDP。

## Authority And Evidence

用户选择扩展复用当前登录，要求覆盖 VPS 及新增账户，并允许保留 `douyin-upload-service.ts` 中其他任务改动，只由本任务增加扩展接线。原 60 条冻结任务保留目标，选择仅用于新制作。REA 离线解析两个历史 navigator bundle（132115 bytes，0 parse failures），定位 `GET /ad/api/v1/account/user-list`、`GET /ad/api/v1/account/user/info`，切换项使用 `location.replace('/?aavid=...')`。请求封装含 Cookie、CSRF、`aavid`、`gfversion` 和 qc 签名；匿名 HTTP 三个 GET 均 403，不作为已登录平台验收。

## Ownership

扩展只拥有固定网页查询和精确账户导航；主进程拥有请求编排、绑定和结果校验。账号设置、上传服务、冻结目标和原队列仍是原 owner。扩展资源与新 transport 模块由本任务创建；其他后端查询任务继续拥有其 adapter，现有改动不得覆盖或提交。

## Contract Surfaces

- 固定版本协议仅允许 identity、已确认的只读目录请求、计划目录及一次显式导航。禁止任意 URL、脚本、文件、上传、删除及确认。
- Cookie、平台 token 和 CSRF 值仅在 Chrome 内使用，不回传简辑。回传内容投影为账户/计划身份及分页；loopback 连接能力只保存于私有应用目录的 native host 配置，不进扩展 storage、项目、renderer 或日志。
- 每个连接绑定原浏览器广告主锚点；同一锚点多个连接拒绝。每次操作绑定 tab、document、URL 与账户姓名/ID；跨页或账号漂移拒绝。
- 本机使用受保护 loopback 通道；VPS 通过严格主机校验、非交互 SSH 提供远端 loopback 通道，不开放公网端口或回退本机。注册及绑定按当前配置动态处理，不硬编码示例账户。
- native host 在实际原 Chrome user-data-dir 的 `NativeMessagingHosts` 注册；未来账户首次读取时登记。代理新启动保留 SOCKS、DNS、QUIC 与 WebRTC 限制，允许扩展；旧冻结窗口仍可核验，不自动重启。
- 完整分页校验总数、页码、重复 ID 与当前账户。ID 超过安全整数范围时必须保留字符串，不能通过 Number 恢复精度。
- 显式切换之前持续执行原任务/fence guard；导航至多一次，之后只观察，不重发或自动回切。计划选择清空后由用户明确选择，权限及会员准入保持。
- 上传界面按保存账号、子账户、计划排列。目录独立读取，不依赖计划成功；当前目录身份核对后才读计划，并核对返回计划仍属于该子账户。目录失败阻止计划读取，计划失败允许刷新目录和显式切换。
- Chrome 官方安装方式单独验证；Chrome 149 不支持 `--load-extension`。扩展未安装或通道未就绪时给出明确错误，不转回 CDP。

## Major Milestones

### 1. Extension And Transport

创建域名和动作受限的 MV3 扩展，以及主进程 loopback 传输和只读目录编排。复用已确认的 qc 签名格式，主进程签名不需要取得 Cookie。覆盖错误来源、未配对、重复连接、迟到响应、取消和导航漂移。

### 2. Canonical Integration

从原账号设置接入当前账户、子账户目录及显式切换；上传服务的当前网页计划读取使用相同扩展连接。保存锚点和旧任务保持原样。VPS 的保存浏览器身份与所选子账户必须分别证明，不能仅删除旧保护。

### 3. All Account Provisioning

提供可审阅的统一扩展安装/绑定工件，覆盖当前本机、VPS 和以后新增绑定。先验证官方 Chrome 安装能力和原 SSH 执行边界，系统安装或真实网页切换必须对应用户授权及当前保护状态。

## Verification And Completion

运行相关纯协议、HTTP 分页、账户漂移、取消、一次导航和旧冻结保护测试与 typecheck；用无 CDP 的隔离 Chrome 扩展 fixture 验证端到端传输及网页请求。按照 Harness 路由完成 owned 验证；稳定候选按 `SUBAGENTS.md` 判断并执行必要的 Kimi adversarial review，AOCI 按完整官方批次收尾，最后只提交 owned 内容并 push/核对 upstream。实际账户、VPS、安装与真实平台响应的证据分别报告；本地 fixture 不代表真实上传、会员恢复或平台验收。

浏览器交互回归验证子账户在计划前、目录完成前无计划请求、目录失败可显式恢复、计划失败仍能切换且只读取新子账户计划，并保留旧批次和清理入口的既有边界。

## Self Review

本计划由 Parent 根据当前代码和用户目标自审；跨账户绑定与未知导航结果是验收重点。没有授权更换浏览器、复制登录资料、降低 Chrome 安全策略、自动恢复旧任务或绕过会员门禁。安装能力不确定时先调查并明确剩余条件，不以命令行 flag 或未运行 fixture 宣称完成。
