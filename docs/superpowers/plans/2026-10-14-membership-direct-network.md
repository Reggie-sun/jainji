# Membership Direct Network Implementation Plan

## Goal And Scope

账号 HTTP 请求使用独立的 Electron 直连会话，不继承应用默认会话或系统 HTTP 代理。范围为权限核验与心跳、OAuth token/JWKS 和续费票据，复用 `membership-desktop.ts` 的唯一运输注入接缝。

## Contract And Ownership

修订 [Membership](../../membership.md) 的桌面运输约定，替换历史 Login Latency Plan 的默认 `net.fetch` 运输行为。使用非持久、禁缓存的专用 Session；等待 `setProxy({ mode: "direct" })` 成功后才注入 `Session.fetch`。不得修改全局或默认 Session 的代理，不回退默认代理。

权限、TLS、可信 origin、重定向拒绝、超时、取消、凭据存储与未知结果失败关闭沿用现有 owner。系统浏览器中的 Google 登录仍由浏览器及操作系统管理；应用级直连不绕过 OS TUN。模型与千川运输不在修改范围内，不部署服务、不读取真实账号凭据。

Parent 串行拥有 `src/main/membership-desktop.ts`、`tests/membership-desktop.test.ts`、`docs/membership.md` 和本 Plan；它们在修改前无既有 diff。保留其他会话源码与暂存区；共享 AOCI 按当前官方合同和 ownership 边界处理。

## Implementation And Verification

先增加回归验证：直连配置未完成时不发送请求；默认代理不可用时，恢复、重新核验、OAuth 和续费均使用专用会话；直连初始化失败时不得走默认运输。再替换桌面运输接缝并更新合同。

运行会员测试集合与 typecheck。使用当前 Electron、隔离 userData、本地 HTTP fixture 和故意不可用的默认代理验证实际生产运输代码仍完成核验与续费；不得把此证据当作真实账号验收。执行 owned Harness code / verify，记录 Risk Gate，按必要性维护 owned AOCI 对象，最终只提交 owned files/hunks，push 并核对 upstream SHA。

## Acceptance And Self-Review

专用会话返回 DIRECT，默认代理不变；账号请求不调用默认 `net.fetch`；初始化完成前零请求，初始化失败零回退。既有封禁、登录失效及网络不可用行为回归通过。当前 Electron API 使用 `Session.fetch`，不向 `net.fetch` 添加不存在的 session 选项。该计划覆盖用户要求及运输边界，无离线授权、全局代理变更或额外业务能力。
