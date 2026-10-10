# Scope

## Google Egress Deployment — 2026-10-11

用户明确授权复用本机 Mihomo 到南京 VPS。本次只部署账号服务的 Google 出口，不代表 Google OAuth client 已配置或真实登录已验收；此前 Google 登录及三天试用源码仍是未部署候选。

- 远端既有 `compose.yaml` 增加独立 `mihomo` 容器，在既有 Docker 私有网络中监听 17897，Casdoor 通过 `http://mihomo:17897` 使用代理；无宿主端口映射、管理 API、TUN 或宿主路由变更。非 root UID 10001、只读根文件系统、drop ALL capabilities、no-new-privileges、128 MiB 上限、健康检查和 `unless-stopped`。
- 复用本机当前“地球人 / 日本JP02”节点快照，不复制个人 Chrome、全局规则或订阅管理面板。配置 `mihomo/config.json` 为 0600，父目录 0700；节点更新需重新同步，未部署订阅自动更新。该节点的代理 TLS 保留原有 `skip-cert-verify` 设置；Google HTTPS 证书校验未关闭。
- Mihomo `1.19.21` 静态 amd64 程序传输前后 SHA-256 相同：`cbb631fd443273dd236f470e6351d1e5686a2bbc66ffda1ba7772f1a9ff34c98`。Casdoor 使用 `HTTP_PROXY` / `HTTPS_PROXY`，`NO_PROXY` 排除本地及数据库；代理规则仅将 Google 账号、Google APIs 与头像域名走节点，其他请求保持直连。
- 初次共享 Casdoor 网络命名空间的方案在单独重启 Casdoor 后真实失联，已替换为独立容器和稳定服务名；Casdoor 声明等待 Mihomo healthy，日常两者各自重启均已验证恢复。数据库、会员服务和 Tunnel 未重建。回退点为远端 `compose.yaml.before-google-mihomo` 与 `backup.sh.before-google-mihomo`；回退时先移除 Mihomo 容器，再恢复原 Compose 并重建 Casdoor，保留数据库卷。
- 原备份脚本已纳入 `mihomo` 目录，最终配置备份完成于 `backups/20261010T165029Z`（UTC）。私有配置与备份不进入 Git。

实际验证：Mihomo 配置检查通过；Casdoor / MySQL / Mihomo healthy；直接从 Casdoor 容器使用环境变量访问 Google discovery 返回 200，约 0.42 秒；Casdoor 单独重启后 200、约 0.70 秒，Mihomo 单独重启后 200、约 0.49 秒。无凭据请求 token、userinfo、People 分别返回 400、401、403，证明接口连通，不证明授权成功。公网登录页和收费页均返回 200。监听检查确认没有新增公网代理端口。最终证据位于本机 `/tmp/jianji-mihomo-20261011/verification-independent.json` 与 `restart-independent.log`；未执行整台 VPS 重启或真实 Google 授权。

受管 Kimi 调查 `a7aa465e-8b82-431f-9781-f3c58bf1b16f` 为只读部署假设检查，不是最终实现验收。Parent 通过独立容器及实际重启测试修复生命周期问题；原 MATCH REJECT 已改为 DIRECT，非 Google 出站保持原行为；配置以 UID 10001 实际校验、镜像为 VPS 已有镜像、无 geo 规则依赖，DNS 与节点已由真实请求验证。Google OAuth 源码客户端是否完整遵循代理仍须真实授权流程验收，不以 curl 或调查报告代替。

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

# Initial Deployment Checkpoint

- Cloudflare 指定账号授权已完成，证书 API 回读确认 zone 为 `reggie-sun.ccwu.cc`。两个独立 CNAME 已创建到本任务 Tunnel，没有覆盖旧记录；公共 DNS 查询得到 Cloudflare 地址。
- 公网 HTTPS discovery 的 issuer 正确；生产 OAuth/PKCE 经真实浏览器取得 token，公网会员接口返回 `allowed / trial`，用户为 `jianji/owner` 管理员，试用至 `2026-11-09T21:53:58.000Z`。尚未完成管理员后台交互验收。
- 本机默认网络访问 API 域名发生 TLS 连接失败；VPS 访问健康接口正常，本机使用公共 DNS 查询所得地址、保留域名和证书校验的 `curl --resolve` 可取得健康结果及上述会员结果。Mihomo DNS cache flush 返回 204，但默认路径仍失败，网络原因尚未完全定位。未改 hosts 或关闭 TLS 校验，未向当前简辑实例写入强制登录配置。
- 未提供收款商户资料，未启用真实支付、验收到账、续费或退款。
- swap 缓解了当前资源压力，不证明该 4 GB 主机能长期同时承载浏览器上传和会员峰值；尚未压测或整机重启验收。
- 本记录是部分部署检查点，不是完整交付或收费上线声明。

以上为人工核款门户部署前的检查点，后续结果以下方 Manual Billing Deployment 为准。

# Review Adjudication

受管 Kimi 只读复核 `c59ea6a5-420e-44c7-872d-5af3ab59b08c` 已返回 canonical receipt，两个请求均 `IDENTITY_VERIFIED`，报告 `PARSED`；这不代替 parent 验证或公网验收。

- `REV-DEP-01` 判为 `FALSE_POSITIVE`：复核遗漏同一冻结 `app.conf:41` 的 `initDataFile = ""`。官方 Casdoor `v4.18.0` 的 `object/init_data.go:69` 在该值为空时立即返回，先于读取 `initDataNewOnly` 和导入文件；保留 mount 不会重新导入。远端回读与重启证据已有记录，没有因该误报改配置。
- `REV-DEP-06` 关于无限 refresh token 的推断为 `FALSE_POSITIVE`：同版 `object/token_jwt.go:606` 在 `RefreshExpireInHours == 0` 时令 refresh 到期时间等于 access token 到期时间；当前为 24 小时。
- `REV-DEP-02/03/04/05/07/08` 为运维限制：loopback 由当前服务监听代码约束；资源没有负载验收；MySQL/Node tags 未按 digest 固定；Casbin CDN 是外部依赖；尚无完整卡死检测及定期升级机制。保留这些限制，不用复核通过替代后续容量、更新和可用性工作。
- `REV-DEP-09` 的 DNS 未完成状态已被本轮实际记录取代；桌面网络、管理员交互及真实收款仍未验收。

# Manual Billing Deployment

2026-10-10，用户批准静态微信/支付宝原图收款码、提交付款单号、管理员核实到账后开通。用户回复“到了”仅记录为本人报告 1 元到账；没有制造支付回调、正式付费订单或会员授权。生产付款申请仍为空，完整核款写入只在本机隔离 Casdoor 测试。

- 新增 `billing.reggie-sun.ccwu.cc` CNAME 到同一专用 Tunnel，未覆盖旧 DNS。会员服务 `serviceUrl` 使用此独立 origin；`auth.reggie-sun.ccwu.cc` 保持 Casdoor issuer，旧 API 域名路由保留。
- 初次同源路径分流在公网 OAuth 验证失败：Casdoor 4.18 `web/src/lib/setting.tsx:86` 的 `isSelfRedirectUri` 判断 origin，`LoginPage.tsx:609` 将同源授权码请求转为后台登录。已撤销本轮同源回调及路径规则，改为精确 `https://billing.reggie-sun.ccwu.cc/billing/callback`，保留桌面 loopback callback。源码未因此修改；这是经过真实验证修正的部署配置。
- 会员服务挂载原始 `payment-assets`（只读）及 `billing-state`（可写、持久化）；状态目录无未决写入标记。原图与凭据均不提交仓库。备份脚本包含两个目录。
- 只重建 membership 容器、重启本任务 cloudflared unit，Casdoor / MySQL 数据和原 VPS 浏览器保持。切换前备份为 `backups/20261009T223059Z`；配置另有 `.before-manual` 和 `.before-billing-origin` 私有检查点。
- 最终备份为 `backups/20261009T230026Z`，服务状态为 Casdoor/MySQL healthy、membership running、专用 Tunnel active。本机忽略的 `resources/membership.json` 已写入公开配置，下次 `make frontend` 启动读取；未重启当前简辑进程。密码仍只保存在本机私有 `vps/credentials.json`。

## Manual Billing Verification

| Surface | Evidence |
| --- | --- |
| 会员回归 | 5 个测试文件、41 项测试通过；typecheck、会员服务 bundle build 通过 |
| 本机真实门户 | OAuth 登录、Pending 不赋权、管理员核款与试用后续期、桌面及 390px 页面无横向溢出 |
| 普通用户权限 | 到期用户可申请；只读自己的申请；门户审核 403；直接 Casdoor 新增/修改订阅被拒绝 |
| 重复及未知结果 | 重复批准不再加时；提交/审核写入结果不明时只读回查；持久标记跨服务实例重建阻止后续写入，仍可读取申请 |
| 真实 Casdoor 时间状态 | 独立临时订阅由 Upcoming 在起始时间后转为 Active，检查后清理；未调用支付网关 |
| 公网门户 | 真实管理员 OAuth 回到独立域名门户，管理员审核区可见；两张二维码响应与用户原图 SHA-256 一致 |
| 公网桌面协议及续费票据 | 默认网络、正常证书校验的原 PKCE helper 登录成功，会员为 allowed/trial；新页面消费单次票据后原 token 仍有效；cookie 为 Secure/HttpOnly/SameSite=Lax |

本机证据目录 `/tmp/jianji-membership-20261010/` 包含 `manual-tests-r2.log`、`manual-browser-result-r2.log`、`manual-normal-user-result-2.log`、`manual-upcoming-result.log`、`manual-public-smoke-result-r4.log` 和公网截图。源码验证与实际公网检查分别记录，不以单元测试替代付款到账证明。公网测试中 Cloudflare 统计脚本被门户 CSP 阻止，这是非必需第三方统计，不影响上述功能验证。

## Manual Billing Review Adjudication

受管只读 Kimi R1 `747fdfbd-1bf9-4b76-bc5e-dfef442b5eb7`、R2 `f21fe6a2-b4e1-47a2-90ab-83fd9147f8f7` 均有 canonical receipt，分别 5、8 个请求 `IDENTITY_VERIFIED`、报告 `PARSED`。Parent 逐项裁决；无未解决 blocking finding。R2 绑定最终实现源码；随后仅修正部署 origin 及本文档，由公网测试单独验收。

- R1-F1 确认并修复：续期叠加先验证显式时区日期及直接用户订阅，再计算期限；R2 复核修复与回归用例。
- Parent P1：未知写入必须跨重启保持关闭。新增私有持久化 write-intent fence，确认成功或严格读回才清除；R2 独立复核实现和重启回归。
- R1-F2 保留为运行限制：无单 IP 限速，内存会话数量有界；不能宣称已完成抗滥用或容量验收。
- R1-F3 采用失败关闭：损坏的人工申请会阻止整批列表，需管理员核对修复，不静默跳过。
- R2-N1 为安全方向的提示限制：短暂并发写入也返回统一 503 核对提示；不因此删除恢复标记或自动重放。
- R2-N2 为低风险覆盖空隙：真实持久保护测试覆盖审核失败及重启后其他用户提交被阻止；提交首次失败只用 stub guard 验证，实际 guard 不区分新增/更新。保留该范围，不声称所有文件系统故障均已注入测试。
- R2-N3 为部署边界：一个会员服务 writer，管理员不得在另一个 Casdoor 后台并发改同一申请；没有跨后台 CAS 事务保证。

仍未接通商户自动支付回调、自动退款、负载测试或整机重启验收。人工核款必须逐笔核对实际账单。管理员后台的免费赠送/停用沿用现有 Casdoor 能力。

# Remembered Login

2026-10-11，用户要求默认保存登录，并让本窗口自行测试。Google Cloud 登录和 OAuth 配置仍暂停，本次只修复现有账号密码登录及会话持久性。

## Diagnosis And Implementation

- 桌面原环境实际选择 `basic_text`，安全存储拒绝落盘；软件关闭后 token 丢失。新增初始化前的私有 D-Bus / 原生密钥环准备，保留显式后端与已识别桌面选择，未识别桌面使用 `gnome-libsecret`，仍不允许明文降级。启动显示恢复状态，成功后沿既有在线准入进入工作区。
- 原门户会话仅在内存中保留一小时，重启必定失效。浏览器改为 30 天随机 HttpOnly cookie；服务端在既有私有 `billing-state/sessions` 内持久加密 token 和 CSRF，并绑定配置、密钥与 cookie ID。退出同步删除记录，重启不会重建已退出的会话。
- 桌面及门户移除强制 `prompt=login`，允许复用有效 Casdoor 浏览器登录。默认记住凭据，不保存密码，不以 IP / device / UA 声明授权；每次使用仍核验当前账号、token 与权益。
- 官方固定版本源调查确认 Casdoor 4.18.0 的 public PKCE 授权码 token 保存 `GrantType=authorization_code`；refresh 路径因此要求 client secret。使用有界 30 天 access token 与原在线 introspection，不将服务端 secret 交给桌面，也不新增刷新代理。受管 Kimi 调查 `3b951afe-f051-4623-9082-2eb22b6a73c6` 为 deep/k3，3 次请求身份已验证；Parent 另外核对了 token grant 写入、access_token hint 内省撤销检查与当前封禁检查，未采纳额外 DPoP 或新授权 owner 建议。

## Preparation And Verification

- 更新前备份：`backups/20261010T172802Z`。Casdoor application 原配置保存到私有 `application.before-remember-20261011.json`。仅更新 `expireInHours=720`、`cookieExpireInHours=720`，回读确认其他字段不变；`enableExclusiveSignin=true`、`maxSessions=1`、`refreshExpireInHours=0`、原 grant 保留。`enableAutoSignin` 不是记住登录开关，未启用。
- 会员 53 项测试、typecheck、构建通过；owned Harness `20261010T172742Z-0655c3eb` 包含 104 项 Harness 回归，并通过文档、owned AOCI；只读 completion `20261010T173243Z-d3246710` 通过。首次 red 与索引维护前的失败保留在 `/tmp/jianji-login-persistence-20261011/`，不将历史失败改写成成功。
- 两次独立真实 Electron 进程使用 `gnome_libsecret` 加密保存及恢复；第二次未调用登录且做了两次在线 fixture 校验。Chrome DevTools MCP 连接隔离 Electron，实际 Gate / preload / desktop owner：关闭重开进入工作区；点击退出后第三次启动保持登录页。此处后端是受控 HTTP fixture，不当作真实 Casdoor 验收。
- 公网候选从生产原始 `9b2971284037f5386eea37dc108912132dac1cd4` 导出源码后，只加入本次 billing transport 与 server constructor，22 项对应服务测试通过。未使用 Git worktree，未将暂停中的 Google / 三天试用代码部署；原生产权益策略保持。候选 bundle SHA-256：`4f626e204a4a7ab0285c464e5aa5299877f62da5e6e855932317ee8dd2f4f5b5`。
- 凭据持久化命中 Review Risk Gate；最终候选由受管只读 Kimi R1 独立复核，Parent 裁决及公网实际结果以下方最终检查点为准。本段准备证据不声明门户候选已经部署。

## Final Candidate And Public Proof

- R1 `13580eb3-a134-45d3-8066-f4cdfb6398c3` 有 canonical receipt，5 次 k3 请求身份已验证。Parent 确认 LP-01：桌面退出删除失败后可能复活旧凭据，已增加先同步的 `logout-pending` 标记和故障注入回归；LP-02：门户删除失败未清 cookie，已用 finally 清除并保留 503。LP-03 的同系子域 cookie tossing 风险保留在操作合同，不声明完整跨子域隔离。LP-05/06/07 的运行证据与 scope 缺口由本段及最终 owned receipt 关闭，不用 reviewer verdict 代替实测。
- 修复后会员 54 项及 Harness 104 项、typecheck、documents、owned AOCI 全部通过，代码回执 `20261010T174335Z-dabd3561`。AOCI Verify / Check / Guide 对齐，Guide `complete=true`、`next_action=none`。两次独立 Electron 进程再次实测 `gnome_libsecret` 加密与恢复，第二次登录调用数为 0；删除失败回归证明标记存在时旧凭据不能恢复。
- 公网只更新已测试的生产兼容 transport bundle，SHA-256 `dd121c28d912d34163584b437fa00dea74567c87507ec3506db891c328e57988`；原 bundle 保存在私有 `server.mjs.before-remember-20261011`。会员服务重新创建，其余服务未由本次更新重建。原生产权益策略与暂停的 Google 配置保持原样，生产兼容导出源码对应的 22 项测试通过。
- 真实公网浏览器：首次登录取得 30 天 Secure / HttpOnly / SameSite=Lax cookie；关闭并重新启动独立 Chrome 后直接进入门户；仅重启 membership 服务后仍直接进入；退出并重开后返回登录、申请接口 401。未提交或审核付款。
- 真实公网 native PKCE：取得 30 天 token，在线会员状态 allowed；第二个独立浏览器登录后新 token allowed、旧 token denied。真实登录表单默认勾选 Auto sign in。两份 native QA 失败日志保留：首次为 SPA 表单未就绪的测试时序问题，第二次为隔离 SOCKS 浏览器错误代理本机 callback；补充显式本机 bypass 后实测成功，未改产品 OAuth 回调合同。
- 当前本机默认网络及现有代理访问公共域名出现 TLS 连接中断；VPS 公网请求和服务健康检查正常。本轮公网浏览器与 native 网络证明使用私有临时 SSH SOCKS 通道，保留 TLS 校验和原公开 origin。它证明真实服务与会话行为，不能证明本机日常代理路径已修复；全局代理选择未变。证据在 `/tmp/jianji-login-persistence-20261011/` 的 public-result-r2、public-native-result-r2 与 probe 日志。Windows 实机与整机断电恢复未评估。

- 同一真实公网 token 经 Electron `gnome_libsecret` 加密保存后，两次独立软件进程恢复并各做两次真实在线核验，均 allowed，登录调用数为 0；该网络校验仍使用上文隔离通道。更新后私有备份 `backups/20261010T175208Z` 包含会话目录。

- R2 `0c7f1a5c-f39d-455a-b61f-4bd14d704580` 实际 11 次 k3 请求身份已验证，进程 exit 0，但 canonical classification 为 `EVIDENCE_INCOMPLETE`：两处 standalone Harness receipt 的引用只读过包内副本，没有对应 standalone 原生 Read。报告已隔离，不作为通过回执。原源码未变；第三轮以去除巨大回执副本的最小完整边界包补齐引用与真实公网证明，保留前两轮全部消费和失败事实。

- R3 `e00cec7c-f40d-4eb2-a778-46ee074f533c` canonical receipt `PARSED`、exit 0，3 次 k3 请求身份已验证；只读复核完整当前边界，未提出新的代码 blocker。Parent 核对 LP-01 / LP-02 的源码、故障回归和实际运行证据后关闭；公网源码 hash 与实际 token / cookie / 互踢结果由 Parent 核验。PC-1：`20261010T174335Z-dabd3561` 为最终源码检查点，前面的 53 项回执仅为历史；后续文档收尾的 owned scope 以最终 completion 回执为准。PC-2 Windows 实机仍不在本轮实测范围；PC-3 日常本机代理仍为明确剩余问题；PC-4 `__Host-` 迁移不纳入此次保存登录修复。R3 对容量限制的描述不作机器事实采用：`FileBillingSessionStore.create` 实际强制 active >= 1000 时拒绝，单实例运行则为部署约束。

# Google Login Activation

2026-10-11 用户完成 Google Cloud 登录后继续原授权部署。复用 reggie-sun 的正常 Chrome 会话，经个人 profile 的 Chrome DevTools MCP / CLI 操作，未重新索取密码、验证码或改变共享 MCP 配置。

## Configuration And Migration

- Google Cloud project `eng-origin-478812-n7` 的 Web application client 回调为 `https://auth.reggie-sun.ccwu.cc/callback`；基本身份范围 `openid email profile`。品牌主页与隐私链接分别为 `https://billing.reggie-sun.ccwu.cc/billing/about` 和 `/billing/privacy`，发布状态回读为“正式版”。不声明品牌认证已经完成。
- Casdoor 的 `admin/jianji-google` Provider 加入原 `jianji-desktop` application；允许注册和登录，不允许解绑，`bindingRule=[]`，不按邮箱自动绑定旧管理员。应用保留 720 小时 token / cookie、独占登录及单会话设置。首次生成的 OAuth secret 在配置过程中作废删除，新 secret 只写本机及 VPS 私有文件；仓库不保存 secret。
- Google 用户经真实回调创建并核对 Google ID / Casdoor ID `115584184003583039108` 后，显式设置该身份为管理员；`owner` 密码管理员仍保留。没有对其他账号按邮箱授管理员，也没有给普通注册账号增加管理员权限。
- 部署前备份 `backups/20261010T181254Z`；旧 bundle、compose、backup 脚本分别保留私有检查点。原已有 `owner` / `reggie` 的一个月试用以 `legacy-trial-20261011-*` 显式免费 Subscription 保留，截止分别为 `2026-11-09T21:53:58Z` / `2026-11-10T16:00:39Z`，不伪造付款。
- 显式初始化私有 `trial-state/trials.sqlite`，文件 0600；compose 持久挂载并设置 `JIANJI_MEMBERSHIP_TRIAL_DATABASE`。仅更新会员服务 bundle 和会员容器，不重建 Casdoor / MySQL 数据。最终 bundle SHA-256 `e2122e87d9021b3cd5e9db2126ddbf17c7865331150d7414087a0619d4132cab`。
- backup 脚本停止运行中的 membership，保存数据库及私有配置、人工核款与加密会话、试用账本，再恢复服务。实际备份 `backups/20261010T182406Z/config.tar.gz` 含 `trial-state/trials.sqlite` 和 `billing-state/sessions/`。首次非 sudo 调用因 Docker / 目录权限失败，未生成有效备份；随后 sudo 调用成功。不以失败目录充当备份。

## Runtime Evidence

- 真实 Google 授权从 Google 回到 Casdoor，再到公网续费门户成功；Google identity 新账号首次请求仅新增一条试用记录，`started_at=1791656370462`，`expires_at=1791915570462`，相差精确 259200000ms。重启会员服务后同一条记录未重新授时，门户 cookie 仍能读取申请接口 200；管理员“付款申请审核”区实际可见。
- 原 native PKCE helper 复用当前 Casdoor Google SSO，未强制重新输入 Google 密码；取得 30 天 token，在线会员检查 allowed 且当前用户为管理员。两个独立 Electron 进程用 `gnome_libsecret` 加密保存/恢复该真实 Google token，各两次在线检查，登录调用数均为 0。网络校验使用有界私有 SSH SOCKS QA 通道，保留公开 HTTPS origin / TLS 校验；不能据此声称日常本机网络问题已修复。
- 公开产品/隐私页实际 Chrome MCP 检查，390px 宽度无横向溢出；三天试用及 30 天记住登录提示正确，隐私说明不申请邮件/联系人/云盘权限。Cloudflare 对邮箱替换依赖脚本，按[官方静态 HTML 例外](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)保留直接联系链接，不放宽 CSP。
- 会员 5 文件 55 项测试、typecheck 与会员 bundle build 通过；新增公开页面 GET / HEAD、非支持方法拒绝、不建立 cookie、不授会员权限回归，续费页不再显示一月试用。最终 scoped Harness / completion 以本轮机器回执为准。

## Independent Investigation And Limits

- 受管 Kimi deep 第一次调查 `f4361bc6-d952-4d33-81f1-ad2b31ae741f` 因 `STRUCTURED_OUTPUT_EXHAUSTED` 无可用终态报告，保留失败、不当作通过。收窄到 SQLite / policy 的第二次 `064939f4-320f-4e86-ac23-cc90d8f21dc8` 为 `PARSED`，2 次 k3 请求身份已验证。Parent 核对 `index.ts` 正常启动仅打开数据库，缺失/损坏时抛错退出；初始化仅显式 CLI，现有库独占创建失败；实际 compose 持久挂载与停机备份已核验。
- Kimi 指出的真实边界保留：人为丢弃全部记录后显式初始化全新合法库，无法从空库推断过去领取历史；运营不得把重新初始化作为丢账恢复，必须恢复完整备份。这是可信管理员恢复边界，不宣称能够防止管理员故意清账。单会员 writer，未做多实例 / 容量、整机断电、Windows 实机验收。
- Google 不同账号仍是不同身份，不能证明同一自然人不会领取多次。微信/支付宝仍人工核款，本轮没有真实付款或商户自动回调验收。Google 用户浏览器须能访问 Google；此前日常本机网络问题仍须单独处理。
- 最终源码 checkpoint 的 owned Harness `20261010T182658Z-fbfb1187` 通过会员 55 项、Harness 104 项、typecheck、documents 及 owned AOCI；官方 Verify / Check / Guide 对齐，Guide `complete=true` / `next_action=none`。Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：当前代码只新增固定静态说明路由与修正提示，不改凭据、身份授权或账本算法；无用户指定 review，也未发现关键级故障路径或重大后果且仍有实质验证缺口的组合。部署管理员绑定已按精确真实身份回读，不能将前述 Kimi 调查冒充 implementation review。源码 bundle hash 绑定上文，详细判定及 owned snapshot 位于 `/tmp/jianji-google-resume-20261011/review-risk-decision.json`。
- 最后备份 `backups/20261010T182832Z` 已完成且会员容器恢复；清除了配置操作临时复制的系统管理员凭据。软件同一 Google token 的单次续费票据在新文档成功消费并清除 URL 片段，申请接口 200、管理员审核区可见；未另行登录或审核付款。本段记录后只读 completion 仍须绑定最终文档 scope。
