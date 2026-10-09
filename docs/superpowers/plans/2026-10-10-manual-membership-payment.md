# Manual Membership Payment

## Goal And Authorization

用户已批准微信/支付宝静态收款码、人工核款开通。月费 100 元、年费 666 元保持不变。用户报告 1 元测试到账，仅为人工报告，不是 API 验签或正式会员购买。用户已授权现有 VPS 部署。

## Contract Delta

延续 `docs/membership.md` 的 Casdoor 身份与订阅唯一 owner；新增申请/核款操作，不创建第二套订单或订阅数据库。申请存为 Casdoor `Subscription`，`Pending`、`payment` 为空时绝不赋权。description 保存版本化申请、账号 UUID、渠道、付款单号、金额和审核轨迹。用户只可创建/查看自己的申请，服务端固定价格；账号删除重建不得继承旧申请。

管理员需在线验证同组织 isAdmin 且未封禁、当前单会话有效，并明确确认实际到账金额才可开通。审核在同一个订阅记录写入固定起止日期、Active 状态和 `manual:<name>` 人工核款引用；该引用不声称存在自动支付回调或网关收据。Casdoor 管理员保持可信管理者。拒绝保留申请及原因。相同渠道与付款单号映射唯一订阅名，跨账号冲突不泄露资料；同一账号审核串行，重复批准不再次延长。仅部署一个会员服务进程，不允许多个独立审核 writer。

续费从当前时刻、试用和已有可信有效权益的最晚到期时间取最大值起算，按 UTC 自然月/年截断月末；未来开始的权益由 Casdoor 管理 Upcoming。写入超时先只读确认，不自动重发未知写入；用户可刷新读取已有结果。

单次写入前独占创建并 fsync 私有 `write-intent.json`，保存目标及期望快照；这是恢复标记，不是第二套权益账本。确认写入或严格读回后才删除。未确认写入、进程退出及重启保留标记并阻止后续写入，仍可读取申请；管理员停止会员服务并核对 Casdoor 记录、在途请求和期望快照后才可人工恢复。所有实例必须共用持久化保护目录，部署仍只运行一个实例。

## Boundaries

`src/membership-server/` 拥有申请服务及独立浏览器收银页，复用当前 CasdoorClient 的服务端凭据。门户 OAuth 使用 PKCE/state/nonce、HttpOnly SameSite cookie、有限会话、同源写入防护和当前 token 在线复核。浏览器只收 cookie，不收 Casdoor client secret/access token。桌面续费入口可通过短时单次票据复用 main token，避免再登录挤掉桌面；独立网页登录仍遵守单账号单会话。

收款码原图不重绘；从仓库外私有部署目录提供，不将收款人资料提交公共仓库。无图片配置时不显示付款申请入口。所有原制作及千川文件不改；不修改其他会话拥有的 `src/main/index.ts`、`src/main/preload.ts`、Harness policy。

现有本机网络对 `api.reggie-sun.ccwu.cc` TLS 连接失败，而 `auth.reggie-sun.ccwu.cc` discovery 返回 200。公网验证又确认 Casdoor 4.18 的 `isSelfRedirectUri` 会将同 origin 回调转换成后台登录，因此服务公开 origin 必须独立：`billing.reggie-sun.ccwu.cc` 路由至会员服务，issuer `auth.reggie-sun.ccwu.cc` 整站保持 Casdoor。只追加精确 `https://billing.reggie-sun.ccwu.cc/billing/callback`，保留桌面 loopback 回调；撤回本轮失败的同源回调及路径分流。保留旧 API hostname 路由，不改其他站点或全局代理规则，不跳过证书验证。

## Milestones

1. Casdoor 适配与申请策略：提取共用身份核验，新增 Pending 申请、管理员批准/拒绝和确定性幂等；测试匿名/普通用户越权、串行审核、重复单号、未知结果、续费时长。
2. 门户与桌面入口：浏览器登录、原图扫码、提交申请/查看状态、管理员核款；有限请求、CSRF、安全 cookie、转义和无凭据泄露；不新增 renderer token 通道。
3. 本地真实 Casdoor 与浏览器验证，会员相关测试/typecheck/Harness、受管 Kimi 权限及持久化独立复核，之后备份并部署 VPS，记录真实验收与剩余网络限制。

## Verification And Self-Review

使用 `tests/membership-server.test.ts` 与必要的独立测试覆盖变更，运行 `npm run typecheck`、`npm run build:membership`、owned Harness。新测试必须显式运行，不能假定已有固定 testFiles 包含新文件。正式核款不由测试代行；真实隔离 fixture 验证申请/核款/撤权，生产只做无付款的页面与权限检查。最终审查精确稳定源码快照，所有 confirmed blocking findings 修复后复验。

Parent self-review：以上范围直接来自已批准人工核款方案；新增写接口必须保持 Casdoor 账本唯一性、单会话、封禁优先和未知结果关闭。迁移为增量记录及公开 callback 配置，旧订阅不重写。回滚旧 bundle 保留新记录，不能回滚数据库丢弃已确认权益。
