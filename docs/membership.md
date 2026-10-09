# Membership

## Scope

本轮目标是代码和本地隔离验证，不部署、不启用真实收款。业务价格：月费 **¥100**、年费 **¥666**，新账号从注册时刻起试用一个自然月。管理员可为指定账号赠送一段使用期限、撤销赠送或封禁账号。同一账号新登录使旧会话失效；这里限制的是登录会话，不能证明操作者是同一自然人。

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
- `src/membership-server/`：Casdoor 在线 introspection、当前用户/订阅/套餐核验，以及只读会员 HTTP 接口。
- `src/main/membership-*`：系统浏览器登录、loopback 回调、加密凭据、当前会话、主进程 IPC 准入。队列只调用该 owner，不自己解释会员期限。
- `src/renderer/MembershipGate.tsx`：账号状态、套餐及后台入口。renderer 不得到任何 token 或 client secret。
- Casdoor：注册、密码、管理员、支付通知验签、订单、订阅与管理操作权限。会员适配服务不接受前端传来的价格、赠送或付款成功字段。

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

```bash
npm run build:membership
JIANJI_MEMBERSHIP_SERVER_CONFIG=/absolute/private/membership-server.json npm run start:membership
JIANJI_MEMBERSHIP_CONFIG=/absolute/public/membership.json make frontend
```

会员服务默认只监听 `127.0.0.1:8789`；这些命令是操作说明，本轮不会据此部署 Casdoor 或接入收款商户。

## Casdoor Configuration

使用独立组织 `jianji` 和 application `jianji-desktop`，应用对象 ID 为 `admin/jianji-desktop`，其 organization 为 `jianji`。启用 Authorization Code 和 PKCE；注册回调 `http://127.0.0.1:43829/jianji-login`。不将 client secret 交给桌面；禁用不必要 grant，`refreshExpireInHours` 设为 0。

必须启用 `enableExclusiveSignin=true` 和 `maxSessions=1`。适配服务每次核查当前应用配置及 token introspection；配置不匹配不放行。v4.18.0 的 `controllers/auth.go` 在替换登录时调用 `ExpireTokenByUserAndApplication`，但仍需真实实例验证双设备登录，不能仅凭 JWT 签名或字段名判断会话有效。

注册用户可用普通 user 类型；应用权益由本服务判断，避免 `paid-user` 在试用/赠送之前强制跳入购买页。根据实际注册策略配置邮件验证、找回密码和管理员安全措施，不在桌面自行实现密码接口。

创建 Pricing `jianji/jianji`，绑定应用 `jianji-desktop`，启用并只列入以下两个可购买 Plan：

| Plan | Currency | Price | Period | Purpose |
| --- | --- | --- | --- | --- |
| `jianji-monthly` | CNY | 100 | Monthly | 月度会员 |
| `jianji-yearly` | CNY | 666 | Yearly | 年度会员 |
| `jianji-grant` | CNY | 0 | Monthly | 管理员手工赠送；不加入公开 Pricing |

每个付费 Plan 关联其真实 Product，Product 的 owner、name、币种与价格必须匹配；不是把 application 名称当作 Product。公开购买入口为 `/select-plan/:owner/:pricingName`。支付 Provider 和证书只配置在 Casdoor 服务端。没有商户配置时，不启用真实支付；本轮不会用 Dummy 回调冒充收款。

管理员从简辑“管理用户”打开 Casdoor 控制台：

1. 免费安排使用：为指定用户创建 `jianji-grant` Subscription，设置明确的 `startTime/endTime`、`state=Active`，`payment` 留空。延长时修改截止日期；在描述中写清赠送原因。
2. 撤销赠送：将该 Subscription 设为 `Suspended`。如果用户另有未过期的试用或付费权益，仍可使用。
3. 禁止使用：在用户上设置 `IsForbidden`；它优先于试用、赠送和付费。解禁后重新登录并核查原权益，不自动延长。
4. 退款或支付争议：在支付系统处理资金，并确认关联订阅已暂停；本轮没有另建自动退款能力，不假设退款页面操作已自动撤权。

## Admission And Session Semantics

有效会话 + 当前组织账号未封禁/删除 +（有效付费 Subscription / 管理员赠送 / 首月试用）才允许新制作。试用从服务端不可由普通用户选择的 `createdTime` 起算，UTC 自然月末按目标月最后一天截断。付费/赠送期限读取 Casdoor Subscription，必须 `Active` 且 `startTime <= now < endTime`；忽略其他组织、其他用户、其他 Plan 及 group 订阅。Casdoor 管理员是可信授权方；Active 付费订阅关联的 payment 字段不是本服务独立验签的付款收据。

存在有效管理员赠送时优先展示该赠送的截止时间，未汇总为所有权益的最晚截止；赠送到期后仍可命中有效付费权益。到期管理员仍可打开管理后台，实际管理权限由 Casdoor 核验，不要求先购买制作会员。

每次新收费 IPC 和队列执行在线核验。30 秒心跳发现封禁、挤下线、到期或网络故障后触发原取消链；单次客户端核验最多等待 10 秒，所以不是声称远端封禁在零毫秒内终止既有 FFmpeg/平台操作。原项目保存、取消和已生成文件访问保留；未知上传证据不清空、不重试。

桌面 access token 仅由 main process 持有，安全密钥存储可用时经 Electron safeStorage 加密保存在 `userData/membership/session.enc`；Linux `basic_text` 或无加密能力时只在内存保存。配置变化使旧缓存失效。没有离线会员宽限或本地时间授权，不能靠本地缓存重新放行；应用重启会在线检查已保存 token，不产生第二次登录。

## Verification Limits

测试必须分别说明：协议/HTTP fixture、Electron IPC、UI 交互、真实 Casdoor、真实微信/支付宝。真实商户回调、续费叠加、退款与双设备会话传播在部署前另做验证。本地可修改程序的设备管理员不受“不可破解”的承诺；当前代码提供正常客户端的在线准入。

受管 Kimi 接入调查：`2a1b641d-4326-4b2e-9de7-33c0eaf2f69d`（deep/k3，4 次 wire request，PARSED），只证明源代码调查完成，不是最终安全审查或功能验收。
