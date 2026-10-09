# Membership Implementation Plan

## Goal

为简辑接入账号登录、月费 ¥100、年费 ¥666、新账号一个自然月试用，管理员可赠送免费使用期限、撤销赠送和封禁账号。同账号只允许一个登录会话，新登录使旧会话失效。本轮仅代码与隔离本地验证，不部署、不真实收款。

## Architecture And Ownership

复用 Apache-2.0 Casdoor 的身份、用户管理、支付回调、订单、Plan/Pricing/Subscription 和管理控制台，不新建密码库或支付账本。桌面使用 `openid-client` 的 public-client Authorization Code + PKCE S256，由系统浏览器登录、loopback 回调；不内置 client secret。新增 `src/membership-server/` 是在线权益判定适配层，服务端私有配置保存 Casdoor client secret；`src/shared/membership.ts` 独占公开合同；`src/main/membership-*` 独占桌面会话及 IPC 准入；`src/renderer/MembershipGate.tsx` 提供登录、权益和续费入口。

管理员免费授权复用专用免费 Plan 的人工 Subscription，必须有真实起止时间；撤销使用 Suspended。后台用户 IsForbidden/IsDeleted 优先于全部权益。试用起点为当前服务端用户 createdTime，重复登录不重置；月末截止取下月最后一天相同时刻，使用 UTC 计算。付费期限读取支付系统的真实 Subscription 起止时间，不以本机时间或支付跳转授予权益。首版手动续费，不自动代扣。

## Contracts

- 服务端每次状态查询/制作准入在线 introspect access token，校验 active、client_id、issuer、audience、exp、sub，并读取当前用户、账号状态、专用 Plan 订阅。未知、断网、格式异常、别的组织/应用/用户/Plan、不在有效期内均不得放行。
- 服务端核实 Casdoor 应用 `enableExclusiveSignin=true,maxSessions=1`；不把有效 JWT 签名当作会话未被挤下线。禁用 refresh token，重新登录获取新会话；桌面重启仅恢复仍有效的 access token。
- 主进程保管 token，使用 Electron safeStorage 加密持久化；无安全密钥存储时只保留内存，不落明文。renderer、项目、日志、错误及 URL 不含 token/client secret。
- 主进程收费 IPC 在线检查；队列执行再次检查；30 秒心跳发现权限失效则停止当前制作/队列。保留退出登录、取消及本地数据保存/读取等恢复入口。已在外部平台发出的操作不重试、不改写 unknown evidence。
- 根据用户“先写代码、暂不部署”的范围，未打包源码且未指定配置、默认配置不存在时保持本地可用；配置存在则启用会员。显式配置缺失/损坏、安装版缺配置均失败关闭。不提供运行时 renderer 绕过开关，不修改既有用户媒体/历史任务。
- 续费打开固定 Casdoor Pricing 地址，由 Casdoor 承担验签/幂等订单逻辑；客户端仅刷新服务端权益，不接受“支付完成”参数。管理员入口打开 Casdoor 控制台，实际管理权限仍由 Casdoor 后端执行。

## Milestones

1. **Service contract**：新增共享 schema、服务端 Casdoor adapter/权益策略/HTTP 入口，测试注册试用边界、付费和赠送、封禁优先、错误身份和单会话配置。服务端端口默认只监听 loopback，私有配置不打包。
2. **Desktop session**：新增 PKCE callback、凭据存储、会话 owner、IPC admission；接入现有 bootstrap/preload/queue，复用原制作和取消 lifecycle。用本地 OIDC/权益 fixture 测试 state、nonce、取消、恢复、挤下线和离线拒绝。
3. **User surface**：新增独立会员 gate/样式并包裹现有 App，展示 100/月、666/年、试用/会员/赠送截止、登录、刷新、续费、退出及管理员入口。实际 Chrome MCP/隔离页面交互验证。
4. **Verification and handoff**：相关 tests、typecheck、build、owned Harness、最终风险审查；维护本轮 AOCI 对象。只提交本轮 owned files 并 push/核对 upstream。真 Casdoor/国内支付平台未执行的验证单独报告，不将模拟测试视为上线证据。

## Boundaries And Self-Review

现有千川改动归其他工作所有，不写其 dirty files；不新建 worktree。本轮新增系统不改变模型凭据、冻结模板、原导出队列所有权、unknown upload ledger 或媒体规则。密码/账号、支付/订阅各只使用 Casdoor 一个 owner。桌面本地代码可被设备管理员修改，单会话规则约束正常客户端的在线准入，不声称本地软件无法破解或能证明操作者是同一自然人。

该方案覆盖用户现有目标；套餐价格已确定，线上配置/密钥不属于本轮。任务内合同由 parent self-review，不增加用户批准 gate。安全后果涉及会话越权，最终 stable implementation 必须在 project verification 后做受管只读对抗审查。

## Verification Checkpoint

代码候选 tree `35804fa3c89a89989bd244490f1d2bf17c177264` 由 `9a9fb76` 加本任务 owned files/hunks 组成，未混入另一窗口的自动化改动。完整 `npm run build`、会员服务构建及 Harness `20261009T211036Z-6fb7f08e` 的 16 组检查通过，共 1,698 项测试执行通过；其中会员检查 31 项。上传测试组实际约 305 秒，原 300 秒上限导致首轮 NOT_EVALUATED，因此仅将该组有限上限改为 600 秒，未删除测试。当前共享工作区 typecheck 也通过。

用户报告未部署服务时被登录页锁在门外，已修订开发激活边界并执行验证：未打包、未显式指定配置、默认配置不存在才进入 `local-development`；错误配置和安装版仍拒绝。真实 `make frontend` 的 Electron 窗口返回本地模式、工作区可见、登录页不存在；Chrome 隔离页面验证相同显示行为，配置/服务端状态不能开启主进程本地准入的回归通过。

受管只读 Kimi 最终审查 invocation `5f4678fa-1365-4dce-95af-1118c26012c6`，deep/k3/max，11 次经身份验证的请求，PARSED；必读源码的路径、哈希和 Read 回执已核验。Parent 裁决没有未解决阻断：普通渲染中途撤权遵循已接受的 30 秒心跳加 10 秒查询窗口；到期管理员仍可进入受 Casdoor 权限保护的后台；重启 reconcile 只恢复本地记录，不授上传资格，现有恢复测试证明必须明确继续。赠送优先显示其当前截止时间，慢上游可能触发十秒失败关闭，属于已记录限制。审查后未修改产品语义。

本轮源码 AOCI 已完成官方完整批次维护，独立候选与共享工作区的 Verify、Check、Guide 均证明 aligned；本轮对象维护不等于全库认知或线上验收。知识库启动 mock 已补齐新入口使用的 Electron API，原恢复和释放断言保留。

## Remaining Deployment Verification

本轮不部署、不真实收款。Casdoor v4.18.0 的接口及撤销路径已有 tag 源码核验；真实 Casdoor 双设备挤下线、国内支付回调、续费叠加、退款与 Windows 安全存储仍未评估，部署前另行验证。另一窗口的业务文件及共享文件中非本任务 hunks 保留，不作为本任务提交内容。
