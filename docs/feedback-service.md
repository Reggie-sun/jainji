# Feedback Service

## Contract

桌面客户端通过 HTTPS 向 `/api/feedback` 提交，目标仓库固定为 `Reggie-sun/jainji`。`GET /health` 提供存活检查。截图经 `/api/feedback/<uuid>/screenshot` 公开访问；不要在此域名前增加登录拦截，否则普通用户及 GitHub 图片无法访问。

服务代码归属 `src/feedback-server/`，客户端归属 `src/main/bug-feedback.ts`，请求及回执由 `src/shared/bug-feedback.ts` 定义。GitHub 凭据只在服务端使用，不打包进桌面安装包。

## Local Setup

```bash
npm run build:feedback
npm run start:feedback
```

需要 Node.js 22 和已登录的 `gh`，或仅向服务进程设置 `JIANJI_GITHUB_TOKEN`。Token 应仅授权目标仓库的 Issues 读写。服务默认从 `gh auth token --hostname github.com` 读取凭据，不输出凭据。

| Environment | Default |
| --- | --- |
| `JIANJI_FEEDBACK_PORT` | `18181`，仅监听 `127.0.0.1` |
| `JIANJI_FEEDBACK_DATA_DIR` | `~/.local/share/jianji-feedback` |
| `JIANJI_FEEDBACK_PUBLIC_URL` | `https://reggie-sun.ccwu.cc` |

桌面主进程可用 `JIANJI_FEEDBACK_URL` 覆盖中继地址；生产只接受 HTTPS origin，测试允许 HTTP loopback。

## Public Routing

在管理 `reggie-sun.ccwu.cc` 的 Cloudflare 账号中配置独立隧道，将该域名转发至 `http://127.0.0.1:18181`。先确认域名现有用途，再调整 DNS；不要复用带有其他服务入口的旧隧道配置或覆盖其凭据。服务只在 loopback 连接中接受 Cloudflare 的客户端 IP header。

上线验证应同时检查本机和公网 `/health`，以及无效提交返回 400。存活检查不证明 GitHub 写入成功；真实 Issue 验证会向公开仓库写入内容，应使用明确授权的反馈。

## Persistence And Limits

数据目录包含脱敏提交记录、回执、截图及限额记录；权限目录 0700、文件 0600。备份整个目录，禁止在结果不明时清空记录后重试。服务先保存 pending 状态再请求 GitHub，结果不明时仅查找既有 Issue 标记；查找未确认时返回错误，不自动重复创建。

每小时最多 30 条新反馈、每 IP 5 条；GitHub 提交或核对操作单独限制为每小时全局 120 次、每 IP 20 次（一次核对最多查询 10 页），重复已完成回执不消耗配额。最多 4 个处理中的请求、16 个连接，带请求及响应时限。截图总量上限 512 MiB，满后拒绝新截图，不自动删除已发布附件。管理员需监控磁盘并保留回执及限额文件。

## Host Operation

本机用户服务使用 `jianji-feedback.service`。更新代码后重新构建中继并重启：

```bash
npm run build:feedback
systemctl --user restart jianji-feedback.service
systemctl --user status jianji-feedback.service
curl --fail http://127.0.0.1:18181/health
```

用户服务依赖登录会话；电脑关机、休眠或隧道断开时，公网反馈不可用。隧道应独立管理，完成公网验证前不能声称客户端已上线。
