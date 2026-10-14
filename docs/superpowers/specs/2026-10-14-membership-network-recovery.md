# Membership Network Recovery

## Goal And Evidence

客户使用中一次短暂核验失败不能立即打断正常任务，客户端必须自动恢复并留下可定位的脱敏诊断。原实例核验约 230 ms 后进入 unavailable，公网探测与 VPS 健康正常；开发进程自动重启后原登录恢复，后续核验通过。原异常已被 catch 丢弃，不能据此断言 DNS、TLS 或具体 HTTP 根因。

## Accepted Contract

用户已授权稳定性修复。本增量只改变既有账号 owner 的只读核验运输与错误处理；不改变收费、试用、封禁、单会话或离线授权。

- 一次逻辑核验最多两次 GET，单次 HTTP 上限 10 秒，总逻辑预算 22 秒；第一次可恢复失败后等待 250 ms，仅再尝试一次。并发 refresh / heartbeat / admission 共用同一核验，不重叠请求。
- 网络与超时失败在重试前关闭只读核验 Session 的连接、清理 DNS 缓存；服务 unavailable 或 HTTP 408/429/5xx 可有限重试，但不因服务失败重置本机连接。其他 HTTP 错误、超长/非法 JSON/schema 响应及确认拒绝立即失败，不重试。
- 只读核验 Session 与登录 token/JWKS、续费票据 Session 均非持久、禁缓存、固定 direct。重连只操作核验 Session，不能关闭系统浏览器、默认 Session 或敏感写请求，也不能重放 OAuth 和续费 POST。
- 中间失败不广播 unavailable、不取消既有任务；重试成功正常继续。新的受保护操作始终等待本次在线核验成功，不能按旧 allowed 状态放行。预算耗尽或不可重试异常仍 unavailable 并沿原 lostAccess 取消链；确认封禁/登录失效沿原清凭据与取消链。
- logout / dispose 中止在途核验、重连后的继续请求与延迟重试，代际 fence 阻止旧结果恢复权限。丢失权限后的未知生产结果仍禁止重试；恢复账号不自动重放任务。
- 日志仅保存固定事件字段：时间、阶段、错误类别、允许的网络错误码、HTTP 状态、尝试次数、耗时及结果。不保存原始 Error/response、URL、路径、token、用户或商品信息。固定私有 JSONL 文件最多 64 KiB，保留一份轮转；日志失败不能改变权限结果。

## Ownership And Compatibility

`membership-session.ts` 保持唯一会话及准入 owner；`membership-check.ts` 负责只读重试预算与安全错误分类；`membership-network.ts` 负责两个直连网络 Session 与仅核验连接恢复；`membership-diagnostics.ts` 负责私有日志。既有公开状态/schema、IPC、OAuth 与队列接口保持；`fetchMembership` 的现有导出保留，增加可选取消信号。

## Verification And Self-Review

先复现一次故障导致失权的旧行为，再验证重试恢复、并发准入等待、持续故障、确认拒绝、无效响应、HTTP 分类、取消及日志脱敏/轮转。真实隔离 Electron 使用本地 fixture、故意不可用的默认代理与注入的一次网络错误，验证实际连接恢复不影响其他账号请求。会员、启动恢复、typecheck、owned Harness 和必需 AOCI 完成后判断 Risk Gate，提交并推送 owned 变更。

Self-review：预算有限、只重试 GET、正常 HTTP 成功仍在线授权；日志只接受白名单字段；没有离线准入、泛化网络控制或第二生命周期。原底层故障不能被宣称已定位，本增量按可验证的故障处理与客户支持能力验收。
