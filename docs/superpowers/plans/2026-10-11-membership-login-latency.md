# Membership Login Latency Implementation Plan

## Goal And Scope

缩短桌面点击登录到打开浏览器、以及认证完成到进入工作区的等待。复用既有 Casdoor / openid-client、会员会话及权限 owner，不改变收费、试用、会话期限或视频处理。

## Evidence And Boundaries

`loginMembership` 在打开浏览器前等待 discovery；`CasdoorClient` 每次在线查询通过公网 issuer 访问同一 VPS 的账号服务。当前实测 public application 查询 526–1390 ms，loopback 查询 19–25 ms。CodeGraph 已查询相关关系，但存在跨文件同名符号误连，关系须结合当前 source 核对。

Native Codex 串行拥有 membership 文件及三个既有会员测试文件；其他会话的 store、自动化记录和清理记录保留。受管 Kimi 只读调查四个冻结源文件，receipt 核验结束前不修改该集合。共享 AOCI 按官方 CAS 批次维护，不能覆盖他人条目。

## Contract

- 桌面是明确的 Casdoor public client。使用该服务稳定的 authorize、token、JWKS 路径建立 openid-client Configuration，打开浏览器前无需 discovery 请求。仍用 S256 / state / nonce 与可信 issuer 校验 ID token。
- 桌面所有会员 HTTP 请求由 Electron `net.fetch` 发送，使用应用网络配置；默认 Node fetch 保留为测试 / 非 Electron 调用接缝。不得关闭 TLS 校验、改全局 fetch 或新增凭据。
- 私有服务配置可提供 `casdoorUrl`，仅允许 loopback HTTP origin。缺字段继续通过既有 issuer。REST、门户 discovery / token / JWKS 可走该私有地址，公开 issuer 和授权跳转保持原域名；拒绝跨 issuer 和重定向。桌面公开 schema 拒绝此字段。
- 每次使用仍在线 introspect、读取当前用户、应用及权益；不缓存授权、不按 IP/device 放行，不改变封禁优先和单会话语义。暂不并行化政策读取，先消除实测的大头公网绕行。
- 服务响应限时限量、OAuth 取消及 loopback 校验、记住登录和核款未知写入保护保持原契约。

## Major Milestones

### Desktop Login

修改 `src/main/membership-oauth.ts`、`membership-session.ts`、`membership-desktop.ts`；使用 `tests/membership-oauth.test.ts` 验证浏览器先于网络打开以及 PKCE/nonce/cancel，`tests/membership-desktop.test.ts` 验证 Electron transport 用于检查和续费票据。

### Server Communication

修改 `src/membership-server/policy.ts`、`casdoor.ts`、`billing.ts`，新增小型 `casdoor-transport.ts` owner；`billing-session-store.ts` 的加密绑定排除私有运输地址，保持旧会话兼容。在 `tests/membership-server.test.ts` 验证私有 loopback transport、公开 issuer 不变、错 issuer / 非 loopback / 重定向拒绝及旧会话兼容。更新 [Membership](../../membership.md) 的私有配置合同。

### Runtime And Delivery

备份 VPS 后部署当前测试 bundle 与私有配置，只重建 membership。实测公网权限、门户和原 Google 会话；用真实 Electron / Chrome MCP 测量打开及登录恢复，不以临时 SSH SOCKS 成功代替日常路径。保存前后耗时及局限到 [Deployment Record](../../membership-deployment-record.md)。执行 typecheck、会员回归、build、owned Harness、AOCI Verify / Check / Guide 与 completion。稳定候选按 Risk Gate 判断独立最终复核；仅提交 owned 文件 / hunks，push 后核远端 SHA。

## Acceptance And Self-Review

浏览器打开前没有网络请求；取消、错误 nonce、封禁、旧会话失效仍拒绝。VPS 私有 REST 不再经过 Cloudflare；公网入口与 issuer 保持一致。实际耗时与环境明确记录，网络抖动不承诺固定 SLA。Plan 覆盖两个症状、运输和授权边界、兼容、回退与验证；不增加短信、自动支付、全局 VPN 或视频公网部署。
