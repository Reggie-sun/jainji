# Goal And Scope

这份说明回答本机试运行和以后迁移 VPS 的部署边界。服务器只运行 Casdoor、MySQL、简辑的 Node 会员查询服务和 HTTPS 反向代理；视频仍由用户电脑处理，不上传到 VPS。Casdoor v4.18.0 是本项目当前选定版本，官方当前部署文档可能对应更新版本，升级前须对照固定版本源码和做恢复演练。

# Suggested VPS Size

| 用途 | 建议配置 | 适用范围 |
| --- | --- | --- |
| 本机/小规模试运行 | 2 vCPU、4 GB RAM、40 GB SSD | 单机运行 Casdoor、MySQL、会员服务和代理；低并发验证 |
| 初始正式运行 | 2 vCPU、4–8 GB RAM、60–80 GB SSD | 小型会员服务，留出数据库、容器镜像、日志与备份空间 |
| 需要更大余量时 | 4 vCPU、8 GB RAM 起，独立数据库备份存储 | 并发、日志保留或备份增长后再按监控扩容 |

这些是按本项目组件数量和“无视频处理”的负载做的工程估算，不是 Casdoor 厂商吞吐承诺。会员检查约每 30 秒在线一次，实际余量仍要用目标用户数和真实并发压测。数据库流量与公网带宽主要承载登录、权限查询和支付通知；不需要为视频转码预留 GPU 或大带宽。Casdoor v4.18.0 自带 Compose 示例使用 MySQL 8；沿用 MySQL 可减少首轮适配。[v4.18.0 Compose](https://github.com/casdoor/casdoor/blob/v4.18.0/docker-compose.yml)

# Services And Network

正式结构建议为：公网 DNS 与 HTTPS 反向代理 → `auth.<你的域名>` 上的 Casdoor、`api.<你的域名>` 上的会员服务 → 仅容器内可访问的 MySQL。Casdoor 官方 Docker 指南要求生产用域名指向服务器并通过反向代理提供 HTTPS；代理示例使用 80/443，Casdoor 容器内部服务端口为 8000。[Casdoor Docker 部署](https://casdoor.ai/docs/deployment/docker/) [Nginx 部署](https://casdoor.ai/docs/deployment/nginx/)

对外仅开放 SSH（最好限制来源）、80 和 443；MySQL 3306、Casdoor 8000、会员服务 8789 不应直接暴露公网。项目会员进程固定监听 `127.0.0.1:8789`，可由同机 Nginx/Caddy 转发到 `api` 子域；桌面配置的 `issuer` 和 `serviceUrl` 都是 HTTPS origin，且当前 schema 不接受 URL 路径，因此建议分别使用 `auth` 与 `api` 子域。[membership-server/index.ts](../src/membership-server/index.ts) [membership.ts](../src/shared/membership.ts)

当前 v4.18.0 仓库 Compose 文件是示例而非可原样上线的安全配置：它把 MySQL 映射到宿主机端口，并使用示例 root 凭据；`conf/app.conf` 也带示例数据库连接。正式配置应新建最小权限数据库用户、换成随机强凭据、删除数据库公网端口映射、固定镜像版本，并仅让反向代理接收公网流量。[v4.18.0 Compose](https://github.com/casdoor/casdoor/blob/v4.18.0/docker-compose.yml) [v4.18.0 app.conf](https://github.com/casdoor/casdoor/blob/v4.18.0/conf/app.conf)

# Local First, Then VPS

本机先用 Docker Compose 跑 Casdoor 与 MySQL、会员服务监听 loopback，可验证注册、OIDC 登录和本机权限判定。此时 `issuer`/`serviceUrl` 可使用 loopback HTTP；桌面 OAuth 回调仍是 `http://127.0.0.1:43829/jianji-login`。如果本机没有公网 DNS 和 HTTPS，微信/支付宝的服务器通知无法把付款结果送回本机，因此本机阶段只适合登录/沙箱流程验证，不能据此宣布真实收费可用。

迁往 VPS 时，优先完整迁移 MySQL 数据库，并同时保留 Casdoor `/conf`、登录签名/加密证书、支付证书与 provider 配置；保持 Casdoor 用户标识、订阅、订单和支付记录一致。Casdoor 提供 JSON 导出/初始化，可用于对象迁移或辅助核查，覆盖列表包括 users、payments、plans、subscriptions 等；不要把对象 JSON 当作已经验证过的数据库备份替代品。应先做一致性数据库备份，异机加密保存，再实际恢复演练。[Casdoor 数据导入导出](https://casdoor.ai/docs/deployment/data-initialization/)

Casdoor 会用 Xorm 同步不少 schema 变化，但官方说明列改名及部分数据迁移需要手工 migration。升级前先固定目标版本、备份数据库和 `/conf`，在副本上完成升级及回滚/恢复验证，再处理正式实例。[Casdoor 数据库迁移说明](https://casdoor.ai/docs/deployment/db-migration/)

# HTTPS, Payments, And Domestic Latency

Casdoor `origin`、桌面 `issuer`、会员 `serviceUrl` 分别指向各自的真实 HTTPS 公网域名，并与反向代理配置对应；它们可以是不同子域。支付通知须能从公网到达 Casdoor 服务端，不是桌面 loopback OAuth 回调。以 WeChat Pay 为例，Casdoor 文档要求商户账号、APIv3 key、商户证书/私钥、序列号和 App ID，并把 Payment provider 绑定到 Casdoor 产品；Alipay 接入也需要证书签名配置。没有已开通的商户账号和真实证书，只能验证登录或测试支付流程，不能验证到账、回调、续费或退款。[Casdoor WeChat Pay 配置](https://casdoor.ai/docs/provider/payment/WeChatPay/) [Casdoor Payments](https://casdoor.ai/docs/category/payments/)

部署地按主要用户选：若主要用户在中国大陆，优先评估离用户近且访问路径稳定的大陆地域；购买前向云厂商确认该地域对域名、备案和公网服务的要求。香港节点可作为先行测试或面向港澳用户的选择，但大陆到香港的时延和稳定性受运营商线路影响，不能只凭地理距离保证。上述选址是网络层面的建议，未对任一 VPS 厂商或线路做实测。

# Readiness Limits

本说明记录部署前的技术研究，不作为部署成功的证据。会员服务无独立用户/订单数据库，权威账号和订阅仍在 Casdoor。实际部署与验证进度另见 [Deployment Record](membership-deployment-record.md)；真实支付、并发容量与公网登录必须分别验收。
