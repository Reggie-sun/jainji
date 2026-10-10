# Membership

## Scope

首轮目标是代码和本地隔离验证；用户随后授权 VPS 部署及下方 Manual Payment 增量。业务价格：月费 **¥100**、年费 **¥666**。2026-10-11 用户选择 Google 登录，每个 Google 身份仅可领取一次 **3 天（72 小时）**试用，替换旧的注册即赠一个自然月。管理员可为指定账号赠送一段使用期限、撤销赠送或封禁账号。同一账号新登录使旧会话失效；这里限制的是登录会话，不能证明操作者是同一自然人。

## Open-Source Selection

复用 **Casdoor v4.18.0（Apache-2.0）** 的账号、管理后台、支付宝/微信支付、订单及 Subscription；桌面使用 **openid-client 6.8.8** 处理标准 OAuth/OIDC。简辑只维护会员判定适配层，不维护第二份密码库、订单库或订阅账本。

| Candidate | Evidence | Decision |
| --- | --- | --- |
| Casdoor | [License/source](https://github.com/casdoor/casdoor)、[v4.18.0](https://github.com/casdoor/casdoor/releases/tag/v4.18.0)、[Subscription](https://casdoor.ai/docs/pricing/subscription/) | 复用已有管理与国内支付能力 |
| Better Auth | [Electron integration](https://better-auth.com/docs/integrations/electron)、[Admin plugin](https://better-auth.com/docs/plugins/admin) | 可行，但还需自建国内支付与订阅管理 |
| Logto | [OSS](https://docs.logto.io/logto-oss) | 身份服务候选，本轮未确认业务国内收费组件 |

Casdoor 支持管理员手工创建订阅。其默认只有 `paid-user` 参与登录期订阅强制检查，因此本应用自行在线核验权益，不能把登录成功当作会员有效。国内支付复用 [Alipay](https://casdoor.ai/docs/provider/payment/Alipay/) 和 [WeChat Pay](https://casdoor.ai/docs/provider/payment/WeChatPay/)；首版是到期手动续费，不承诺自动扣款。OAuth 使用 [PKCE](https://casdoor.ai/docs/how-to-connect/oauth/)；不照搬在桌面配置 `clientSecret` 的旧 Electron 示例。上述能力的文档核验不等于本地/线上 Casdoor 或真实支付验收。

## Ownership

- `src/shared/membership.ts`：公开 schema、价格和心跳间隔。
- `src/membership-server/`：Casdoor 在线 introspection、当前用户/订阅/套餐核验、只读会员 HTTP 接口及人工付款申请门户。
- `src/main/membership-*`：系统浏览器登录、loopback 回调、加密凭据、当前会话、主进程 IPC 准入。队列只调用该 owner，不自己解释会员期限。
- `src/renderer/MembershipGate.tsx`：账号状态、套餐及后台入口。renderer 不得到任何 token 或 client secret。
- Casdoor：注册、密码、管理员、支付通知验签、订单、订阅与管理操作权限。会员适配服务不接受前端传来的价格、赠送或付款成功字段。
- `src/membership-server/google-trial.ts`：Google 身份试用领取与防重复记录，不保存 Google 密码、令牌或付费订阅。

## Local Configuration

桌面公开配置放在忽略的 `resources/membership.json`；开发时也可以用 `JIANJI_MEMBERSHIP_CONFIG` 指向另一份文件。打包后读取 Electron `process.resourcesPath/membership.json`。本轮不改安装包、不自动分发配置。

```json
{
  "serviceUrl": "http://127.0.0.1:8789",
  "issuer": "http://127.0.0.1:8000",
  "clientId": "YOUR_CASDOOR_APPLICATION_CLIENT_ID",
  "organization": "jianji",
  "application": "jianji-desktop",
  "pricingName": "jianji",
  "callbackPort": 43829
}
```

`serviceUrl` 是本项目会员服务，`issuer` 是 Casdoor，不能混淆。非 loopback 地址必须使用 HTTPS origin，不允许 URL 凭据、路径、query 或 hash。`make frontend` 的未打包源码运行在没有指定 `JIANJI_MEMBERSHIP_CONFIG`、且默认配置文件不存在时，保留原本的本地使用方式；主进程返回 `local-development`，不伪造会员账号或付费权益。配置存在时立即启用登录校验；显式指定路径但文件缺失、配置无效或不可读取，以及正式安装版缺配置，均失败关闭。该选择只在主进程启动时作出，renderer 无权切换。

会员服务私有 JSON 放在仓库外且只允许运行服务的 OS 用户读取；包含上面的字段，另加：

```json
{
  "clientSecret": "YOUR_PRIVATE_CASDOOR_CLIENT_SECRET",
  "monthlyPlan": "jianji-monthly",
  "yearlyPlan": "jianji-yearly",
  "grantPlan": "jianji-grant"
}
```

两段合并成一个完整 JSON；第二段不能独立运行。不要把真实 secret 写入示例、桌面、renderer、Git 或命令行参数。`JIANJI_MEMBERSHIP_SERVER_CONFIG` 只填写该私有文件的路径。

Casdoor 与会员服务部署在同一台机器时，可在服务端私有配置加 `"casdoorUrl": "http://127.0.0.1:8000"`。仅允许 loopback HTTP origin；REST、门户 discovery / token / JWKS 使用此内部地址，避免每次在线核验绕行公网。省略时仍使用 `issuer`。公开 issuer、token issuer 校验和浏览器授权跳转保持原 HTTPS 域名；公开桌面配置拒绝该私有字段。改变此运输地址不使已记住的门户会话失效。

桌面明确使用 Casdoor 稳定的 authorize、token、JWKS 路径，通过 openid-client 保留 PKCE、state、nonce 和 ID token 验证；点击登录前无需 discovery 网络请求。实际请求沿 Electron `net.fetch` 使用应用网络设置，登录恢复、权限和续费票据共用该运输接缝。没有权限缓存或本地离线放行。详细验证见 [Login Latency Plan](superpowers/plans/2026-10-11-membership-login-latency.md)。

```bash
npm run build:membership
JIANJI_MEMBERSHIP_SERVER_CONFIG=/absolute/private/membership-server.json npm run start:membership
JIANJI_MEMBERSHIP_CONFIG=/absolute/public/membership.json make frontend
```

会员服务默认只监听 `127.0.0.1:8789`；这些命令是操作说明，本轮不会据此部署 Casdoor 或接入收款商户。

## Casdoor Configuration

使用独立组织 `jianji` 和 application `jianji-desktop`，应用对象 ID 为 `admin/jianji-desktop`，其 organization 为 `jianji`。启用 Authorization Code 和 PKCE；注册回调 `http://127.0.0.1:43829/jianji-login`。不将 client secret 交给桌面；禁用不必要 grant，`refreshExpireInHours` 设为 0。

默认记住登录 30 天：`expireInHours=720`、`cookieExpireInHours=720`，登录表单的 AutoSignin 默认保持开启。`enableAutoSignin` 是自动提交登录的另一个功能，不为记住登录而启用。桌面公共客户端不使用要求 client secret 的 refresh grant；已签发的旧 24 小时 token 不因配置变化自动延长，更新后需首次登录取得新 token。桌面与门户授权请求不再强制 `prompt=login`，可复用仍有效的 Casdoor 浏览器会话。

必须启用 `enableExclusiveSignin=true` 和 `maxSessions=1`。适配服务每次核查当前应用配置及 token introspection；配置不匹配不放行。v4.18.0 的 `controllers/auth.go` 在替换登录时调用 `ExpireTokenByUserAndApplication`，但仍需真实实例验证双设备登录，不能仅凭 JWT 签名或字段名判断会话有效。

注册用户可用普通 user 类型；应用权益由本服务判断，避免 `paid-user` 在试用/赠送之前强制跳入购买页。根据实际注册策略配置邮件验证、找回密码和管理员安全措施，不在桌面自行实现密码接口。

创建 Pricing `jianji/jianji`，绑定应用 `jianji-desktop`，启用并只列入以下两个可购买 Plan：

| Plan | Currency | Price | Period | Purpose |
| --- | --- | --- | --- | --- |
| `jianji-monthly` | CNY | 100 | Monthly | 月度会员 |
| `jianji-yearly` | CNY | 666 | Yearly | 年度会员 |
| `jianji-grant` | CNY | 0 | Monthly | 管理员手工赠送；不加入公开 Pricing |

每个付费 Plan 关联其真实 Product，Product 的 owner、name、币种与价格必须匹配；不是把 application 名称当作 Product。Casdoor 自动支付入口为 `/select-plan/:owner/:pricingName`，当前桌面续费入口改用下方人工核款门户。支付 Provider 和证书只配置在 Casdoor 服务端。没有商户配置时不启用自动支付，不会用 Dummy 回调冒充收款。

## Manual Payment

用户已批准静态微信/支付宝收款码加人工核款，实施边界见 [Manual Payment Plan](superpowers/plans/2026-10-10-manual-membership-payment.md)。会员服务配置环境变量 `JIANJI_MEMBERSHIP_BILLING_ASSETS` 指向仓库外目录，放入原图 `wechat.jpg`、`alipay.jpg`（各不超过 3 MiB）。不配置该目录时门户不开启。收款人图片不提交 Git。Casdoor 应用必须追加精确回调 `${serviceUrl}/billing/callback`，保留原桌面 loopback 回调。

部署门户时 `serviceUrl` 必须与 Casdoor `issuer` 使用不同 origin。Casdoor 4.18 的前端将同源回调视为自己的登录，不返回门户所需授权码；不能用同域路径分流替代独立 origin。当前服务域名为 `billing.reggie-sun.ccwu.cc`，登录域名为 `auth.reggie-sun.ccwu.cc`。

用户打开 `${serviceUrl}/billing`，登录后选套餐，扫码输入 100 或 666 元，从付款账单复制完整付款订单号并提交。仅生成 `Pending` Casdoor Subscription，不能凭“已付款”声明放行。提交者只能查看自己的申请；管理员可查看本组织人工付款申请。独立网页登录遵守单会话；桌面续费使用 60 秒单次票据沿用 main token。浏览器只保存 30 天的随机 HttpOnly / SameSite=Lax cookie，HTTPS 时附加 Secure；上游 token 与 CSRF 保存在私有 `billing-state/sessions` 文件，使用 AES-256-GCM 加密，并绑定 cookie ID、公开配置及服务端密钥，页面不持有 access token。服务需单实例运行，会话最多 1000 条；新登录清理到期记录，读到期、配置/密钥变化或损坏的记录不恢复登录。

管理员在同页核对真实收款账单的单号、金额、付款人，填写实际到账金额、审核说明并勾选已核对，点击“确认到账并开通”；或填写拒绝原因并拒绝。申请只在原 Subscription 上变更，不创建第二份权益。相同渠道和完整单号只能形成一个申请；同账号审核由单进程串行，重复批准不重复加时。服务必须单实例运行，不以多个审核 writer 并发操作；Casdoor 管理员仍是可信管理者，不要在两个后台同时修改同一申请。

人工批准写入 `payment=manual:<subscription-name>` 及 description 审计。这是人工核款引用，不是自动网关收据或真实 Casdoor Payment 对象。期限从当前时间与原有效权益最晚结束时间取较晚者，按自然月/年延长；免费试用未结束时保留试用，后续订阅为 Upcoming。退款资金仍由管理员在微信/支付宝处理，撤权在 Casdoor 将相应订阅设为 Suspended。

同时必须配置 `JIANJI_MEMBERSHIP_BILLING_STATE` 为服务用户可写的私有持久化目录。写入前独占保存并 fsync `write-intent.json`，包含目标和期望快照，仅用作故障恢复，绝不授予权限。写入失败只读取确认结果，不自动重发；无法确认时保留标记，连同重启后的新写入一起阻止，仍可读取申请。管理员需停止会员服务、确认上游请求已结束，逐项核对 Casdoor 的账号 UUID、单号、审核决定和固定期限后保存恢复记录，才可移走该标记并恢复服务；不能用重启或直接删标记假装核对完成。保护目录也必须纳入私有备份。

浏览器关闭及会员服务重启保留仍有效的会话；退出删除持久会话并清 cookie。申请和审核仍保留在 Casdoor 数据库；会话目录与既有私有状态一起备份。每次读写仍在线核验 Casdoor，封禁、token 到期或其他登录撤销后，旧 cookie 不赋予权限。用户报告的 1 元试款只作为人工到账报告，不用于开通套餐，也不证明自动回调已接通。

管理员从简辑“管理用户”打开 Casdoor 控制台：

1. 免费安排使用：为指定用户创建 `jianji-grant` Subscription，设置明确的 `startTime/endTime`、`state=Active`，`payment` 留空。延长时修改截止日期；在描述中写清赠送原因。
2. 撤销赠送：将该 Subscription 设为 `Suspended`。如果用户另有未过期的试用或付费权益，仍可使用。
3. 禁止使用：在用户上设置 `IsForbidden`；它优先于试用、赠送和付费。解禁后重新登录并核查原权益，不自动延长。
4. 退款或支付争议：在支付系统处理资金，并确认关联订阅已暂停；本轮没有另建自动退款能力，不假设退款页面操作已自动撤权。

## Admission And Session Semantics

有效会话 + 当前组织账号未封禁/删除 +（有效付费 Subscription / 管理员赠送 / Google 三天试用）才允许新制作。试用以 Casdoor 服务端当前用户的 `google` provider ID 为身份，在首次通过会员服务领取时按服务器时间固定 72 小时；不使用邮箱、账号创建时间或客户端上报身份。独立 SQLite 记录同时唯一约束组织内 Google 身份和简辑用户 UUID；到期、注销、解绑、重启不重置。删号重建无法再次领取；若新的 UUID 不匹配原领取账号，则不转移剩余试用。普通密码账号无自动试用，仍可付费或由管理员赠送。

付费/赠送期限读取 Casdoor Subscription，必须 `Active` 且 `startTime <= now < endTime`；忽略其他组织、其他用户、其他 Plan 及 group 订阅。付费与赠送判定优先于试用，既有明确订阅期限不缩短。人工核款只保留已领取且仍有效的试用期限，不再凭账号注册日期多赠一个月。Casdoor 管理员是可信授权方；Active 付费订阅关联的 payment 字段不是本服务独立验签的付款收据。

## Google Login And Trial Operations

实施计划：[Google Membership](superpowers/plans/2026-10-11-google-membership.md)。按 [Casdoor Google Provider](https://casdoor.ai/docs/provider/oauth/google/) 创建 Web application OAuth client，回调必须精确为 `https://auth.reggie-sun.ccwu.cc/callback`，不能使用桌面 loopback 或 billing callback。Provider 只请求 `openid email profile`，允许 Google 注册；绑定规则不要按邮箱自动关联已有管理员。保留管理员和已有用户的密码登录恢复路径，普通密码注册不授试用。Google Cloud OAuth 凭据只写服务端；测试模式、发布状态及真实回调分别验收，不能把配置保存当作 Google 登录成功。

服务器及用户浏览器均须能访问 Google；服务器换取令牌和读取 Google 用户资料的网络失败不能靠前端按钮修复。主进程仍通过 Casdoor PKCE 登录，既有单会话配置保持。

公开说明页为 `/billing/about`，隐私说明为 `/billing/privacy`；两页无需登录，只允许 GET / HEAD，不建立会话或授予会员权限。Google OAuth 品牌主页和隐私链接使用 billing 的 HTTPS origin。页内联系方式保持静态可用，不依赖被 CSP 禁止的 Cloudflare 邮箱还原脚本。

2026-10-11 公网 Google Provider 已接入，OAuth 发布状态为正式版；指定所有者 Google 身份经过真实回调核验后单独设为管理员，未启用按邮箱自动合并。软件使用 Google 登录后可见“管理用户”，付款申请在续费门户的“付款申请审核”区处理。旧管理员密码账号保留恢复路径；已有密码账号此前获得的一个月试用以显式赠送保留原截止时间，新密码注册不自动获试用。

运行环境为支持 `node:sqlite` 的 Node 22（本机验证 22.21.0）。在服务器私有持久目录中显式初始化一次：

```bash
JIANJI_MEMBERSHIP_TRIAL_DATABASE=/absolute/private/trials.sqlite node dist-membership/server.mjs --initialize-trials
```

运行会员服务时设置相同 `JIANJI_MEMBERSHIP_TRIAL_DATABASE`；数据库文件须为普通文件、权限 `0600`，父目录须私有，使用绝对真实路径。初始化采用独占创建，不能覆盖已有记录。启动或运行中数据库缺失/损坏时不新建空账本、不自动发放试用。无数据库配置时 Google 试用失败关闭；明确付费/赠送的判定仍独立。

备份同时保存 Casdoor 数据、原人工核款状态及试用数据库；SQLite 使用默认 rollback journal 与 FULL synchronous，备份须停会员服务或使用 SQLite backup API，不能在写入时单独复制数据库。恢复/迁移必须保留所有领取记录；回滚到旧代码会重新开启一月试用，不作为安全回滚路径。Google 多账号属于不同身份，本功能不承诺一自然人只领一次。

存在有效管理员赠送时优先展示该赠送的截止时间，未汇总为所有权益的最晚截止；赠送到期后仍可命中有效付费权益。到期管理员仍可打开管理后台，实际管理权限由 Casdoor 核验，不要求先购买制作会员。

每次新收费 IPC 和队列执行在线核验。30 秒心跳发现封禁、挤下线、到期或网络故障后触发原取消链；单次客户端核验最多等待 10 秒，所以不是声称远端封禁在零毫秒内终止既有 FFmpeg/平台操作。原项目保存、取消和已生成文件访问保留；未知上传证据不清空、不重试。

桌面 access token 仅由 main process 持有，安全密钥存储可用时经 Electron safeStorage 加密保存在 `userData/membership/session.enc`；Linux `basic_text` 或无加密能力时只在内存保存。配置变化使旧缓存失效。没有离线会员宽限或本地时间授权，不能靠本地缓存重新放行；应用重启会在线检查已保存 token，不产生第二次登录。

Linux 在 Electron 初始化前核查当前用户的私有运行目录与 D-Bus socket；仅对缺失或 `disabled:` 的 session bus 恢复该用户原生地址。保留显式 `password-store` 和已识别桌面的后端；桌面环境未标明时选择 `gnome-libsecret`，仍禁止 `basic_text` 落盘。启动显示“正在恢复上次登录”，在线核验成功后进入工作区。默认保存的是可撤销的登录凭据，不保存账号密码，也不以共享公网 IP 或可伪造的 device/UA 字段授权。登录 30 天不延长任何试用、会员或管理员赠送期限。

桌面退出先同步保存私有 `membership/logout-pending` 标记，再删除加密凭据；只要标记存在，重启不恢复旧凭据，只有显式新登录成功保存才移除标记。磁盘连标记也无法保存时退出报错，不能声称退出完成。软件退出不执行全账号上游登出，沿同 token 打开的门户有自己的退出入口。门户即使删除记录失败也清当前浏览器 cookie，同时报告失败；并非撤销所有已复制凭据。Cookie 使用专用 host-only 域名，尚未采用 `__Host-` 前缀；同系不可信子域 cookie tossing 风险保留，不把该配置描述成完整跨子域隔离。

## Verification Limits

测试必须分别说明：协议/HTTP fixture、Electron IPC、UI 交互、真实 Casdoor、真实微信/支付宝。真实商户回调、续费叠加、退款与双设备会话传播在部署前另做验证。本地可修改程序的设备管理员不受“不可破解”的承诺；当前代码提供正常客户端的在线准入。

受管 Kimi 接入调查：`2a1b641d-4326-4b2e-9de7-33c0eaf2f69d`（deep/k3，4 次 wire request，PARSED），只证明源代码调查完成，不是最终安全审查或功能验收。
