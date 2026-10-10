# Membership Remember Login Implementation Plan

## Goal

默认保存已登录设备的会话，软件重启、网页刷新及账号服务重启后无需反复输入密码；现有账号密码登录立即受益，Google 配置保持暂停。

## Contract

- 不保存密码，不以 IP 或 User-Agent 代替认证。桌面凭据仍由 OS keyring / safeStorage 加密；网页只保留随机 HttpOnly / Secure / SameSite cookie，令牌在服务器私有持久目录保存。
- 默认登录期限为 30 天，独立于会员、免费试用或赠送的有效期。每次恢复和操作仍由 Casdoor introspection、当前账号 UUID / organization、单会话和封禁状态决定权限；退出、新登录顶替、封禁、令牌到期均不能恢复授权。
- 修复 Linux 无有效 D-Bus / desktop environment 时无法选择可用 Secret Service 的情况；无安全密钥环时不降级明文。安全后端初始化只在应用启动的既有 membership owner 完成，保留显式 password-store 选择。
- 不强制 OAuth prompt=login；首次仍经系统浏览器、PKCE / state / nonce。有效桌面凭据恢复期间展示恢复状态，避免闪出可点击的新登录。
- 收费门户随机会话 ID 在私有 session 目录绑定配置及原令牌，期限固定 30 天，退出删除记录；重启读取同一记录。上游权限不缓存成授权，目录不可用或记录损坏失败关闭。
- 持久数据仅为原认证运输的恢复，不新增账号、密码、会员订阅或授权 owner。旧桌面加密 token 格式和单次续费票据保持兼容。

## Milestones

1. `src/main/membership-keyring.ts`、`membership-desktop.ts`、`membership-session.ts`、`membership-oauth.ts`：Linux 密钥环启动准备、恢复状态与复用浏览器登录；现有 desktop/storage/oauth 测试验证重启、退出、网络失败和被顶替。
2. `src/membership-server/billing-session-store.ts`、`billing.ts`、`server.ts`：30 天私有文件会话，保留 CSRF / origin / single-use ticket 检查；持久记录重建、到期、配置绑定、退出、权限撤销和不泄露 token 由会员测试验证。
3. `docs/membership.md`、`docs/membership-deployment-record.md`：记录持久性和部署事实。VPS 备份后仅更新会话运输代码及 Casdoor application 登录期限 / 默认记住设置，不启用暂停中的 Google 及三天试用候选。

## Verification

先新增能复现旧行为的测试并观察失败，再运行会员相关测试、typecheck、构建、owned Harness / completion、AOCI Verify / Check / Guide。真实 Electron 用隔离 userData 和系统 keyring 两次进程验证加密 token 跨重启恢复。真实 Casdoor 验证 30 天新 token 和第二次独立登录使旧 token 失效；Chrome MCP 检查本地门户重启后 cookie 恢复。不能把固定 IP、单元测试或配置保存当成真实登录验收。

## Self-Review

范围覆盖用户要求的默认保存与同设备恢复，并保留已有会员和会话限制。期限增加不授予付费权益；服务器会话文件需纳入现有 billing-state 私有备份。若公开 PKCE refresh 不安全或需要 secret，不把 secret 带到桌面，采用有界 30 天 token 及在线撤销核验。旧会话需完成一次正常登录以取得新的期限。
