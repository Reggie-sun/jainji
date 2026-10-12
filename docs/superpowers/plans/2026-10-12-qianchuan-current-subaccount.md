# Qianchuan Current Subaccount Implementation Plan

## Goal

用户在已绑定 Chrome 的千川网页中切换子账户后，简辑上传计划选择器读取网页当前子账户的计划，并将明确选中的计划作为本轮上传目标。

2026-10-13 修正范围：上传账号下拉框同时显示该网页子账户的名称和完整 ID，不能只更新计划。同一次目录读取返回经前后核验的账户快照，空目录也返回账户；刷新或失败时取消旧账户展示。浏览器资料名称与保存 ID 仍仅作为连接锚点。

## Current Evidence

2026-10-12 只读观察确认，氨糖膏保存映射为 `1876036793517065`，绑定 Chrome 中的计划页和可见账户标题为 `1876039035222536`。原 `prepareExisting` 要求 URL 包含保存账户 ID，所以网页切换后拒绝连接。仅改为 `existingConnection` 可以取得已绑定浏览器，但目录仍使用保存 ID，无法满足读取新子账户的目标；实际旧账户目录读取也出现初始化超时，不能作为修复验收。

## Scope

覆盖普通单项目及跨模板制作入口的上传计划读取、选择、制作预检、intent 登记和首次选择文件前的账户校验。浏览器绑定、私有映射、计划目录、原上传生命周期继续由现有 owner 管理。

## Contract Surfaces

- 为 `QianchuanPlanListRequestSchema` 增加可选 `accountSource: "current-browser"`。省略时保持保存账户语义；上传选择器明确请求当前网页账户，清理选择器及定时清理继续使用保存账户。
- 返回的 `QianchuanPlanOption` 同样带可选 `accountSource: "current-browser"`，让原入口原样传递计划时保留读取语义。该字段只是模式声明，不授予 authority；主进程必须重新校验网页账户、目录和本轮证明。旧计划省略字段保持原解释，定时上传始终核对其保存绑定，不跟随网页切换。
- `expectedAdvertiserId` 始终校验保存映射的浏览器锚点，不能解释为任意可连接账户，也不能跳过配置漂移检查。新子账户的 ID 从受校验的浏览器页面取得。
- 新增 `qianchuan-current-account.ts`，只读取已绑定连接内千川页面的 URL、可见状态和账户标题 ID。URL 必须是官方 origin，`aavid` 唯一且有效，DOM ID 与 URL 相同。程序自有目录页及活动上传页不能作为用户当前账户来源；无明确当前页面、多个可见账户不同、页面读取失败或身份漂移均拒绝，并给出可操作提示。
- 通过有界轻量 CDP 读取必要页面，不启用全浏览器自动附加，不导航、激活、关闭用户页面，不读取 cookie、登录文件或网页存储。连接取消必须清理本次 transport。
- 上传计划目录继续在自有隔离页面读取并校验同一子账户，目录前后重新核对当前账户；缓存绑定实际子账户、endpoint 和配置 digest。每次当前网页请求先识别账户，再决定是否复用缓存。
- 当前网页的商品自选计划在“控成本投放”视图内；新建目录页默认进入“放量投放”时，身份核验后仅在自有页选择一次“控成本投放”再绑定目录。用户页保持原视图；未知、重复控制或账户冲突拒绝，不点击投放设置或平台确认。不扩展为放量计划上传能力。
- 为新子账户的普通制作保留主进程内的明确目标证明：保存映射锚点、实际连接、配置 digest、实际子账户和选中计划与 `pageBatchId` 绑定。采用独立的 `qianchuan-selected-account-targets.ts` 承担证明校验，服务只接线；不改写持久映射或建立第二套任务生命周期。
- `preflight` 必须重新取得当前账户、核对用户选中计划所属账户，并通过新鲜目录确认计划存在后才签发原 `UploadAuthorization`。`registerBatches` 核对主进程证明、保存映射与显式计划；首次选文件前再次核对锚点及当前子账户。证明失效时停止，不能替换成保存账户或另一个子账户。
- 跨模板准入分别核对保存关联的浏览器锚点和授权的明确计划目标。明确计划存在时，授权账户必须等于该计划账户，保存关联仍不得漂移。

## Invariants And Compatibility

保存映射、模板关联和浏览器绑定文件保持原语义。旧冻结任务不迁移、不重定向；`UNKNOWN`、fence 和 read-only recovery 规则保持。无明确计划的旧上传选择维持保存目标语义。新能力不从持久 JSON 恢复主进程证明；应用重启不恢复制作或上传权限。固定出口核验不能因子账户切换被跳过。

定时上传的保存账户合同、批次切换与浏览器关闭机制不随普通选择器变化自动放宽。若当前账户读取与某运行路径不兼容，该路径明确拒绝新子账户目标，不静默回退。

## Ownership

本会话已有未提交的窄修复仅涉及 `src/main/qianchuan-account-settings.ts` 和 `tests/qianchuan-account-settings.test.ts`。`src/main/douyin-upload-service.ts`、`tests/douyin-upload-service.test.ts` 有本会话开始前的改动；用户已经选择 A，由本会话接管并保留现有改动。提交只包含本任务新增 hunks，不把旧改动当作本任务创作。

后续服务测试优先落在当前干净的 `tests/qianchuan-plan-selection.test.ts`，避免修改已有脏测试。其余计划修改路径：`src/shared/qianchuan-plan-selection.ts`、`src/renderer/qianchuan-plan-requests.ts`、`src/renderer/QianchuanPlanSelect.tsx`、`src/main/batch-production-controller.ts`、`src/main/qianchuan-plan-catalog.ts` 和对应干净测试。新增 reader 与目标证明模块测试，并将测试登记到现有 Harness 路由。写入前重新检查每个路径的当前状态。

## Acceptance Criteria

1. 绑定账户 A 的 Chrome 切换到 B 时，普通上传选择器读取并显示 B 的计划与账户 ID；明确选择 B 的计划后，主进程授权、intent 和实际上传页面目标均为 B。
2. 网页再切到 C、计划消失、URL 与 DOM 不同、保存映射变化、连接变化或同浏览器多个可见账户不同，均不授予错误账户上传权限。相同 plan ID 在不同账户中不混淆。
3. 读取或刷新不修改保存映射、模板绑定、浏览器绑定和历史任务；清理及定时请求不因普通上传模式而改变目标。
4. 选择器进入时读取当前账户，回到简辑时重新核对；旧明确选择仅在账户和计划仍匹配时保留。紧凑布局明确展示实际账户 ID，失败清除失效选择。
5. 真实账号验证只读取目录和界面，不选文件、不提交、不删除。实际上传路由通过隔离 fixture 验证，不能将目录成功表述为真实上传验收。
6. 普通、追加和批量的账号下拉框均显示本次读取的网页名称与 ID；批量普通制作按已核对网页账户检验所选计划，继续保留保存关联及主进程证明。空计划目录不丢失账户身份，错误或刷新不继续展示旧 ID。

## Major Milestones

### Milestone 1: Bound Browser Current Account

在 reader、settings 和共享请求边界落实当前账户来源。用真实 Chrome fixture 覆盖 A→B、隐藏旧账户、多窗口歧义、DOM/URL 冲突、用户页面保留、取消与超时；运行账户 settings 和浏览器相关回归。

### Milestone 2: Explicit Target Admission

在独立目标证明 owner 中完成当前目录与本轮授权绑定，服务沿原 preflight/register/currentTarget 接线。跨模板准入接受通过主进程校验的明确 B 计划，并继续拒绝关联或计划漂移。使用假 browser port 验证 B 从授权到文件选择均不回到 A；验证无主进程证明的伪造目标、B→C 漂移和历史 `UNKNOWN` 均不产生新上传动作。

### Milestone 3: Picker And Completion Evidence

选择器请求 current-browser，按账户加 plan ID 核对选择，实际显示账户并处理刷新/返回焦点；清理用途保持旧请求。执行浏览器 UI 测试并尝试 Chrome MCP 集成交互；MCP 不可用时记录阻断并用实际 Chrome CDP 交互验证。真实绑定 Chrome 只读验证新子账户目录。完成 typecheck、受影响测试、owned Harness、AOCI 官方 Verify/Check/Guide，再按具体跨账户 authority 风险执行 required managed read-only Kimi review。复核本任务 diff，按 owned 路径或 hunks 提交、推送当前 upstream 并核对远端 SHA。

## Self Review

目标覆盖读取和上传准入，未将 Chrome 显示名当作广告账户身份；保存锚点和明确子账户目标分别校验但仍复用原 owner。不自动改写旧映射。检查顺序先建立网页身份再读目录、签发授权、登记 intent，最后首次文件选择前复验。原 VPS 自动浏览器切换合同绑定保存账户；网页切到其他子账户时该路径明确阻断并提示保存绑定，不让普通网页识别改写 VPS 资源生命周期。用户本次原 Chrome 本地绑定不受此限制。
