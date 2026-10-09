# Qianchuan VPS Egress Implementation Plan

## Goal And Scope

在 Linux 本机 Chrome 千川自动化中加入可选的固定 VPS 出口。用户为营业执照使用代号分组，同组账号复用同一 SSH 别名、预期公网 IPv4 和本地 SOCKS 端口。Jianji 自动建立密钥认证隧道并校验出口；无需搬移视频或 Chrome 到 VPS。

## Contracts And Invariants

- `src/shared/qianchuan-egress.ts` 独占可分享的非秘密路由形状；账号配置、摘要和冻结上传 target 保存可选 `egress`。缺失字段保持旧行为，显式 null 仅用于设置时解除绑定。
- `QianchuanAccountSettings` 仍独占账号保存。改出口必须先结束该账号受保护任务并关闭原浏览器；导入亦校验，不能跨账号继承旧出口。相同 group 必须同配置，不同 group 不得复用 SSH 别名、预期 IP 或端口。
- `qianchuan-egress-runtime.ts` 管理本进程启动的 SSH 子进程；仅 loopback SOCKS，BatchMode、StrictHostKeyChecking、ExitOnForwardFailure，禁止密码交互和自动重试。凭据继续由本机 OpenSSH 配置及 agent 管理，应用不读私钥或记录 ssh stderr。
- 原浏览器 owner 启动时固定代理，禁用 QUIC、非代理 WebRTC 与外部本机 DNS；核验实际 Chrome 启动参数，不接受直连/PAC/额外 bypass。CDP 仍只走本机。
- 固定 HTTPS IP 探测经相同 SOCKS5 隧道，短超时、限量响应、比较 expectedIp；这是出口探测证据，不证明平台安全或全流量抓包。探测失败停止自动化，不切直连。隧道故障保持失败，用户明确重连后才可重建。
- Uploader 冻结绑定在连接和后续动作中保留；隧道死亡中止自动化。未知上传继续沿原 fence / NEEDS_HUMAN 处理，不重传、不清历史、不自动点确定。没有 egress 的旧任务不能复用已代理浏览器。
- 首次 SSH 主机指纹与密钥配置由部署完成；未提供真实 VPS，不进行真实账户或付费调用。Windows、自动登录/验证码、抖店其他业务与防关联保证不在范围。

## Major Milestones

1. 新建 shared schema、SSH runtime 与固定出口探测，写 schema/生命周期/失败注入测试。
2. 扩展既有账号保存、浏览器启动/复用及上传连接；新增专用账号出口设置 UI，保留原保存入口和旧配置兼容。
3. 验证配置冲突、代理参数缺失、IP不符、断线、历史冻结及禁止换路；执行 typecheck、相关 tests、Chrome MCP UI 与本地代理集成，不触碰真实账号。
4. 在最终稳定 candidate 评估 required read-only Kimi review，调查 findings；完成 AOCI owned 维护、Harness scope/receipt、commit/push 及远端 SHA 核验。

## Ownership And Verification

本 session 单 writer；不修改已有 dirty `tests/douyin-upload-ui.test.ts`、cleanup record 或 Python caches。新 UI 测试独立文件。原 `douyin-upload-service.ts` 已超过 800 行，仅接入简短 guard；隧道与配置验证不加入该文件。

本轮新增及受影响测试登记到 `.agent/harness/policy.json`，执行 `npm run typecheck` 和 scope 选中的 Harness。记录假服务与真实浏览器证据，真实 VPS、平台 IP、Windows 和人工登录保持 NOT_EVALUATED。

## Self Review

已核对 canonical owners 与冻结 target 的 schema 派生；路线字段是可选新增，不重写旧 ledger。浏览器不会在运行中换代理，所有设置入口共用保存校验。采用现有 OpenSSH/curl 能力，避免自行实现认证或 SOCKS 协议。用户已授权实现，无额外审批 gate。
