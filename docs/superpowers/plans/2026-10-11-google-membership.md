# Google Membership Implementation Plan

## Goal

用户选择 Google 登录替代手机号注册；每个 Google 身份仅一次 72 小时免费试用，不需要人工审核。复用 Casdoor 4.18.0 的 Google OAuth、原桌面 PKCE、会员准入和人工核款。

## Contract

- 身份来源仅为服务端 Casdoor 当前用户的 `google` provider ID，不使用客户端字段、邮箱或显示名。保留令牌 introspection、UUID、组织、封禁及单会话校验。
- 首次经认证领取时按服务器时间固定 72 小时；独立持久记录以组织及 Google ID 摘要为唯一键，同时约束简辑用户 ID。重启、注销、删除重建、解绑/更换 Google 均不重置记录；到期边界不包含。
- 试用账本只是防重复领取及试用期限 owner，不复制密码、付费订阅或赠送账本。已付费和管理员赠送仍由 Casdoor 决定。没有 Google 绑定的账号不能自动领试用，仍可付费或获赠；管理员身份不依赖试用。
- 人工核款只延续已经领取的有效试用，不再根据账号创建时间凭空增加一个月。既有 paid/grant 期限不缩短。
- 使用 Node 22 的 `node:sqlite` 事务和唯一约束，服务端私有目录持久化并备份；运行时缺失/损坏账本失败关闭，初始化必须显式执行，不因重启自动重建空账本。
- Google Provider 仅申请基本身份范围，禁止按邮箱自动绑定已有管理员。普通用户不能修改 Casdoor provider ID；管理员仍为可信管理者。Google OAuth 凭据只保存在服务端。

## Owners And Milestones

1. `src/membership-server/google-trial.ts`：SQLite 试用记录、显式初始化及只读期限查询。`tests/membership-server.test.ts`：真实临时 SQLite 重启、重复身份、账号重建、并发唯一性、到期和故障验证。
2. `casdoor.ts`、`policy.ts`、`server.ts`、`index.ts`、`manual-payments.ts`：读取可信 Google ID、注入同一个试用 owner；替换原按注册日期赠送一个月的路径，保留原付费/赠送/封禁和管理员准入。
3. `src/shared/membership.ts`、`src/renderer/MembershipGate.tsx`、`docs/membership.md`：3 天规则及管理员入口说明。补充操作入口用于显式初始化私有试用数据库。
4. VPS 上先备份，创建账本并纳入备份，再配置 Google Provider、精确 callback 与现有应用。用户使用指定 Google 账号配置 OAuth；缺凭据/用户确认/可用网络时报告部署阻断，不伪造 Google 登录成功。
5. `public-pages.ts` 复用原会员服务提供公开产品与隐私说明，绑定 Google 品牌 HTTPS 链接；修正续费页旧一月试用提示。公开说明不建立会话或改变准入；指定所有者身份经真实登录核验后显式授管理员，既有恢复账号保留。

## Verification

运行会员测试、typecheck、build:membership 和 owned Harness；Chrome MCP 验证登录入口及 UI。真实 Google 身份登录、普通注册不授试用、管理员入口和 VPS 重启账本读取分别验证；不发送短信、不进行真实付款。不修改其他会话的千川文件。

## Self-Review

已覆盖 3 天、一身份一次、删除重建、服务重启、支付续期与管理员保留；Google 多账号不能等同同一自然人，明确不声称彻底防止多账号。必须在最终稳定实现上评估 Review Risk Gate，再完成 AOCI 与 owned commit/push。
