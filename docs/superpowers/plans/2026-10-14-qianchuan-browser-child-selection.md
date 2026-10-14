# Qianchuan Browser Child Selection Plan

## Goal And Authority

用户纠正当前只有楚风账户成功，其余账户均需验证；网页默认主账户必须先读取并显式选择子账户，再读取匹配计划。用户本轮明确允许 CDP 或 REA，覆盖此前“子账户不用 CDP”的限制。旧批次保留原账户、计划及结果未知屏障；不自动替用户选择任意子账户。

本计划在既有授权范围内由 Parent 自审后执行；它修正前一轮扩展方案的连接前提，不扩大上传、删除、确认或凭据权限。

## Evidence

reggie 保存锚点为 `1876036793517065`，原 Chrome `Profile 11` 当前网页为子账户 `1876039035222536`。原进程与 loopback 监听端口经现有 OS metadata owner 核对，CDP 当前身份读取成功。旧菜单枚举在该页面失败；复用现有签名 GET、内容投影和目录算法，通过该页面的隔离执行上下文读到完整 20 项目录，包含主账户与多个子账户。知隅旧菜单能返回 20 项，说明菜单结构不应继续作为目录唯一依赖。扩展安装/worker 活跃状态也不能代表网页子账户已准备好。

## Single Owners And Boundaries

- `QianchuanAccountSettings` 继续独占保存锚点、当前网页账户和制作准入；当前浏览器端口公开不透明 session、真实账户及已验证 endpoint，不暴露扩展 snapshot 作为通用身份。
- 从 `qianchuan-extension-catalog.ts` 提取运输方式无关的目录完整性算法与固定 GET 签名；扩展适配器复用这一 owner。CDP 默认实现复用同一算法及固定响应投影，不建立菜单/API fallback 链。
- 新 CDP session 只连接已验证原 profile/PID/start/loopback 端口；CDP target ID 保持字符串，文档证明来自持续持有的隔离上下文及真实文档，不将 target 哈希或伪装成扩展 tab ID。Cookie/CSRF 留在浏览器。
- 目录会话优先核对可见千川页；当没有可见千川页且仅有一个合格千川页时，允许读取该后台页，不抢占其他标签页。多个后台页仍拒绝；原上传、清理及默认当前账户读取保持可见页约束。两轮 URL、DOM 名称/ID 与 target 校验同样用于后台页。
- 目录会话也接收带唯一 `aavid` 的根路径 `/`，兼容旧扩展留下的主账户入口；此准入不扩大原上传/清理页面集合，仍走原 DOM、target、文档与 context 证明。
- 元数据读取复用现有 process/socket owner；VPS 复用原 worker profile 证明、严格 SSH 与 `attachMetadata`，读取 metadata 不依赖 native messaging 安装。目录新建的自有转发使用动态 loopback 端口，不抢占已有应用占用的配置端口、不借用其他进程的转发。共享资料根目录的多 profile 仍失败关闭。
- 计划继续由 `readQianchuanPlans` 的自有查询页读取；上传、清理、确认、原队列、会员与 UNKNOWN 屏障不变。显式切换仅一次，未知结果不重放、不自动回切。
- 原任务受保护页面的排除集从 service 经当前账户 port 传到 CDP session；目录与计划重读均沿用排除，避免把旧上传页作为账户文档。
- 隔离回归证明 Playwright context 数量和 `Target.getBrowserContexts` 的 DevTools context 列表都不足以判定真实登录环境。每次 CDP 操作前后将原 target 的真实 `browserContextId` 与原始协议的 `defaultBrowserContextId` 核对；缺失证明或非默认环境拒绝。计划页创建后、导航前还须核对其真实 context 与原文档相同，避免 Chrome 最后使用的 profile 改变造成跨登录态读取。
- 只读 metadata 新请求可替换同主体已终止的 SSH channel，先确认关联转发全部终止后移除失效缓存；不重发先前请求，不恢复旧租约/冻结上传权。其他动作仍沿原显式恢复规则；主体变化或未终止资源不自动处理。

## Current And Target Behavior

当前生产默认必须有扩展 native 连接，导致浏览器已有可核对连接仍失败。目标默认从保存锚点的原浏览器建立 CDP 会话，独立读取完整目录；界面先选子账户，经实际页面 ID 与新文档核验后读该子账户计划。保存的浏览器锚点可以与当前 child 不同，本机与 VPS 走同一账户选择语义。保留扩展实现仅供明确注入的既有适配器，不按异常自动切换运输方式。

## Major Milestones

### 1. Common Catalog And Opaque Session

提取 `src/main/qianchuan-account-catalog.ts` 和 `src/main/qianchuan-current-account-port.ts`；现有扩展适配器与测试迁移到公共目录 owner，账号设置只消费公开账户/session。保持共享 UI/IPC schema 与冻结记录兼容，不改已有 mapping 或历史记录。

### 2. Verified CDP Browser Session

新增聚焦的 `qianchuan-cdp-account-session.ts` / `qianchuan-browser-accounts.ts`，复用原 process、CDP transport、固定请求投影和 plan catalog。原页面仅用于身份、固定 GET 与一次用户选择导航；自有计划页在取消/完成后清理。远端 profile metadata 与 native registration 分离，移除依赖 child 等于 anchor 的过期限制，以进程/profile/target/document 证明替代。

### 3. Integration And Actual Account Proof

`QianchuanAccountSettings` 默认使用已验证 CDP 端口；`DouyinUploadService` 对当前网页计划统一委托此 owner。页面初始化、目录失败、切换、计划失败与旧批次边界继续沿原 UI。逐项核对六个已配置账户；关闭、登录失效或共享 profile 歧义单独报告，不用代表账户或测试通过代替全账户连通。

## Verification And Completion

先以无扩展主账户→完整目录→显式 child→匹配计划建立回归，覆盖保存锚点不变、真实字符串 target/document、导航一次与未知不重放、无 Cookie 导出、CDP 端口不匹配、VPS 身份、取消和历史批次保护。运行 typecheck、受影响回归、当前 Harness 路由与 AOCI 必需维护；稳定候选按 Risk Gate 复核。真实读取/切换与 fixture 分开；保留当前源状态和其他任务改动，只提交 owned paths/hunks，push 后核对远端。

## Self Review

本轮不以“安装或手工刷新扩展”作为六账户交付结果；也不删除安全检查来迁就异常 profile。没有授权复制登录资料、删除多余 profile、改写保存锚点、盲目重发导航或恢复旧 UNKNOWN 任务。原浏览器不可验证时明确阻断，不能改连其他窗口。
