# VPS Remote Browser

## Scope

B 模式将 Chrome、独立账号登录目录和千川文件上传放在主体 VPS；本地简辑负责视频制作、素材传输、原任务调度和账本。本地必须保持开机、简辑运行和 SSH 在线。尚不提供本机关机后的云端自治任务。

每个主体使用一个独立 Linux VPS 和专用非 root SSH 用户。该用户首次连接后绑定主体代号与预期公网 IPv4，不允许跨主体复用。账号分别保存浏览器目录；不复制本地 Cookie，不修改旧批次或历史结果。

## Deployment

远端需 Node.js 22 或更新兼容版、Google Chrome/Chromium、可供非 root 用户访问的图形显示 `:99`。可通过受保护的远程桌面提供该显示，也可使用 Xvfb 配合仅 loopback 监听的 VNC。显示环境必须能人工接管处理扫码/验证码；CDP 与 VNC 不开放公网。worker 使用 `DISPLAY=:99`（SSH 环境已有 DISPLAY 时保留）。本程序不安装系统依赖、不接受主机指纹、不采购服务器。

在本机构建：

```bash
npm run build:qianchuan-remote
```

把 `dist-electron/qianchuan-remote/` 中的 `worker.cjs`、`package.json` 和 `node_modules/` 完整部署到专用用户的 `$HOME/.local/share/jianji-remote/`。目录仅该用户可读写（0700），文件不可由其他用户写入。不要以 root 运行 Chrome，不关闭 Chrome sandbox。更新 worker 前停止简辑自动化，避免版本混用；既有 `state/` 必须保留。

本机 `~/.ssh/config` 配置 `Host shop-one` 等别名、远端用户、固定主机和本机私钥。先人工核实并记录主机指纹，确认下列命令可用：

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes shop-one 'node --version'
```

私钥不传入简辑或 VPS。服务器需允许 SSH local forwarding。应用仅执行固定 worker 命令并建立 loopback CDP 隧道，视频通过同一经过认证的持久 SSH worker 通道按原始二进制分片传输，无 base64 额外流量。

## Application

账号设置开启 VPS，浏览器运行位置选择“B：VPS 远端浏览器”，填写主体代号、SSH 别名、预期公网 IPv4、本地连接端口后保存。同主体账号复用同组配置，不同主体不得复用别名、端口或 IP。打开账号浏览器会在 VPS 打开 Chrome，首次登录请使用远程桌面。

原有“关闭”“重启并连接”和“重连固定出口”继续受任务保护。B 不会回退本地 Chrome、A 的 SOCKS 或直连。模式切换也必须先结束受保护批次并关闭旧浏览器。

## Account Dock

使用 XFCE 桌面的 B 模式，保存账号后首次点击“打开账号浏览器”，或进行新制作的浏览器准备时，程序在连接验证后自动将账号图标加入底部一排。名称取已保存的产品名称，首字显示为角标；账号仍由广告主 ID 与原专用 Chrome 目录绑定。同名账号不会共用登录资料，改名称不会更换账户、计划或出口。重复打开不增加重复图标；读取计划、探测、重连和恢复不会修改桌面栏。

远端需安装 `xfce4-panel`、`xfconf-query`、`wmctrl`、`xprop`，以及 SVG loader 和中文字体（Ubuntu 使用 `librsvg2-common`、`fonts-noto-cjk`；首次安装 loader 后需重新加载 panel）。worker 自动识别 `:99` 上本用户的 XFCE 会话 D-Bus；SSH 默认 bus 不能替代实际桌面 bus。新增图标时只短暂重启 panel，已有 Chrome 保留。顶栏与无关插件保留，已有底栏布局不覆盖。

程序将展示用登记保存到 `state/desktop/accounts.json`，图标保存到其 `icons/`；launcher 写入本用户 applications 与 XFCE panel 目录。固定 `worker.cjs --desktop-focus <advertiserId>` 只聚焦该原目录窗口；窗口关闭后通过原 worker 打开同一已登记、已存在的目录，先验证出口再打开千川页，不创建替代登录资料。展示登记不提供上传或平台操作授权。

更新需同时部署本机代码与完整远端 worker。旧 worker 不支持新增 `desktop-sync` 时明确报错，不回退。此前由 `jianji-vps-account` 创建且 Exec/Icon 精确匹配的旧入口会迁移为 worker 命令；其他文件冲突、损坏登记、残留 `sync.lock` 或不明确的桌面会话均阻断，保留资料供人工核查，不自动清锁或删除浏览器目录。

## Transfer And Recovery

- 只传原队列已准入的冻结成片；每组最多九文件，准备好一组就交给千川，已选组上传期间可传后续组。
- 分片上限 4 MiB，单文件上限 20 GiB；传输阶段有两小时上限，支持取消。5 GB / 50 Mbps 的理论本地传输下限约十三分钟，不承诺公网实测速率。
- 远端素材按账号、SHA256、原文件名隔离。临时文件不交给浏览器，完整长度和 hash 校验后无覆盖发布为只读文件。原本地快照路径及账本不改写。
- 传输中断只影响尚未选给千川的文件。明确重连后，对没有 selection fence 的任务点“安全继续”，复用已保存分片；禁止自动重传历史 UNKNOWN/MAY_HAVE_UPLOADED。
- 选文件调用前先落原永久屏障。选后断线、页面丢失或结果未知仍只读核查原页面，不能凭远端缓存重新上传。重连不启动队列，不点击平台“确定”。
- 远端 `state/files/` 保存缓存，当前不自动删除；磁盘不足失败关闭。手动维护只能在所有相关任务结束、浏览器不再读取文件时进行，不能删除 `state/subject.json` 或浏览器目录来绕过身份保护。残留锁或 hash 损坏需人工核查，不能盲目覆盖。

## Verification Limits

本地隔离测试不等同于真实 VPS 部署、50 Mbps 传输、千川接收或风险关联验证。没有真实服务器资料前，软件能力与云端验收分别报告。
