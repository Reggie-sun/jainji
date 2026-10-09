# Scope

2026-10-10，用户将先前“仅写代码、不部署”的要求调整为部署到现有南京 VPS `jianji-vps-01`。本记录承接 [Membership](membership.md) 的登录、试用、定价、赠送、封禁和单会话合同；不改变视频制作、千川账号或历史上传结果。Cloudflare 使用用户指定账号，保留已有域名记录和服务，不开通付费附加产品。

# Deployment

- Ubuntu 24.04；Casdoor `4.18.0`、MySQL `8.0`、Node `22-alpine` 通过 Docker Compose 运行，设置 `restart: unless-stopped`。
- 远端配置 owner：`/home/ubuntu/.local/share/jianji-membership/compose.yaml`。私有目录 `0700`，数据库密码、会员服务配置和 Tunnel 凭据文件 `0600`；凭据不提交 Git、不进入桌面公开配置。
- Casdoor 只发布 `127.0.0.1:8000`；会员服务使用 host 网络并由既有代码只监听 `127.0.0.1:8789`；数据库没有宿主机端口映射。
- 独立 `cloudflared-jianji-membership.service` 已启用，计划路由为 `auth.reggie-sun.ccwu.cc` 和 `api.reggie-sun.ccwu.cc`，未知主机名返回 404。Tunnel ID：`b1ff09be-c8e9-47ae-ae1a-4fc5fd0c1f2e`。
- 原 VPS Chrome 工作负载占满内存及旧 2 GB swap。新增独立 `/swapfile-jianji-membership`（4 GB），登记到 `/etc/fstab`；没有终止浏览器。Casdoor、MySQL、会员服务、Tunnel 的内存上限分别为 384、512、128、128 MiB；MySQL buffer pool 为 128 MiB，关闭 performance schema。
- 管理员使用随机密码，内置应用关闭注册；新用户由 `jianji-desktop` 注册。首次初始化完成后关闭 `initDataFile`，防止重启重置用户标识、创建时间或密码。签名证书由 Casdoor 当前版本生成，不使用旧公开样例密钥。

# Verification

以下为本轮实际执行的检查，不能相互替代：

| Surface | Observed result |
| --- | --- |
| 本机真实 Casdoor 与当前会员代码 | 系统浏览器式 PKCE 登录成功，一个自然月试用允许使用 |
| 本机真实独立登录会话 | 第二次登录后，第一个 token 被拒绝，`session-expired` |
| 本机封禁 / 到期 / 赠送 | 封禁令会话失效；试用到期拒绝；Active 免费赠送允许；Suspended 赠送拒绝；恢复 fixture 后试用有效 |
| VPS 启动 | Casdoor 和 MySQL 为 healthy；两个服务健康接口返回成功 |
| VPS 默认凭据 | 实际请求 `admin / 123` 被拒绝，返回密码错误 |
| VPS 服务重启 | 管理员 UUID、创建时间及单会话配置与重启前一致 |
| Tunnel | systemd enabled/active，日志包含四条 Registered tunnel connection；这不代表域名已经可访问 |
| 数据恢复 | VPS 数据库备份已复制到本机私有目录并恢复到隔离数据库；管理员 UUID 匹配，恢复出两个应用、一个证书和三个套餐 |

证据目录为本机 `/tmp/jianji-membership-20261010/`：`local-policy-results.json`、`vps-before-restart.jsonl`、`vps-after-restart.jsonl` 和部署日志。备份含敏感认证材料，仅保存在私有目录，不归入普通日志或仓库。测试没有发起微信、支付宝交易或操作千川任务。

# Operations And Recovery

在 VPS 上检查和重启本任务服务：

```bash
sudo docker compose -f /home/ubuntu/.local/share/jianji-membership/compose.yaml ps
sudo docker compose -f /home/ubuntu/.local/share/jianji-membership/compose.yaml up -d
sudo systemctl status cloudflared-jianji-membership.service
```

`sudo /home/ubuntu/.local/share/jianji-membership/backup.sh` 创建日期命名的私有备份，包含 `mysqldump --single-transaction`、配置归档和 SHA-256 清单。不能把包含密码、证书和 Tunnel 凭据的归档上传到公开位置。初始备份已复制到本机 `/home/reggie/.local/share/jianji-membership/vps-backup/`。

恢复时使用相同版本镜像，先只启动数据库，导入备份并核对用户 UUID、证书及订阅，再启动 Casdoor、会员服务和 Tunnel。不要重新启用初始化文件。切换 VPS 时同步迁移数据库及私有配置；更换公网 issuer 后桌面用户需重新登录。不要同时运行两个独立可写的账号数据库。

停用本次部署时仅停止这个 Compose 项目和 `cloudflared-jianji-membership.service`；保留数据库卷和备份，不使用 `down -v`，不停止现有远程桌面、Chrome 或其他 Tunnel。额外 swap 当前承载有效页面，不直接 `swapoff`；只有确认内存余量足够时才处理。

# Pending Acceptance

- Cloudflare 控制台已通过指定 Google 账号进入。旧命令行凭据不具备该域名权限，新的域名授权仍在等待；两条 DNS 记录尚未确认创建。
- 尚未验证公网 DNS、HTTPS、VPS 完整登录与管理员后台交互；未向当前简辑实例写入强制登录配置，避免再次锁住用户。
- 未提供收款商户资料，未启用真实支付、验收到账、续费或退款。
- swap 缓解了当前资源压力，不证明该 4 GB 主机能长期同时承载浏览器上传和会员峰值；尚未压测或整机重启验收。
- 本记录是部分部署检查点，不是完整交付或收费上线声明。部署配置独立复核结果仍待归档。
