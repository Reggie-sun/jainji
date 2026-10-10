# Remote Account Dock Implementation Plan

## Goal

将 VPS 底部账号 Chrome 图标纳入 B 模式程序流程：首次打开新增账号自动创建入口，同一账号重复打开复用入口，其他账号继续追加。现有予浅、安序入口迁移到同一 owner。

## Scope And Ownership

- `qianchuan-remote-desktop.ts` 独占展示用 registry、图标和 `.desktop`；`qianchuan-remote-desktop-panel.ts` 适配当前 XFCE 会话及 launcher 注册。
- 原 `QianchuanAccountSettings` 提供已保存显示名称，`QianchuanBrowserManager` 沿现有 remote open 路径调用；`QianchuanRemoteRuntime` 在连接验证后请求 `desktop-sync`，原 `RemoteWorker` 核主体并调用桌面 owner。
- `src/remote-worker.ts` 提供固定 `--desktop-focus` 入口；缺窗口时仍委托原 worker 的浏览器启动与出口检查，不建立第二浏览器生命周期。

## Contracts And Invariants

- 账号由 `advertiserId` 和原 canonical profile 绑定；名称只展示，不改变账号、计划、出口或上传资格。
- `desktop-sync` 只接受有界显示名称与十进制 ID，零 body；原 v1 请求保持兼容，旧 worker 不支持新增动作时明确失败，需要同步部署更新。
- 注册必须已有安全的远端账号目录，不发现、复制 Cookie 或新建登录目录；展示 registry 不授予平台操作权。
- 仅显式打开/新制作准备更新图标；catalog、probe、reconnect、恢复和文件传输保持原行为。
- 精确 WM_CLASS 聚焦已有窗口，最小化可恢复；未匹配才通过原 worker 打开同一个已有 profile，先核出口再开账号页。
- 保留 top panel、foreign plugins 和旧工具记录；动态分配空闲 plugin ID。识别已知旧账号 launcher 后复用其 ID。重复注册不重启 panel，新增时仅短暂重启 panel，Chrome 不关闭。
- 读写只限本用户受管文件，拒绝符号链接、foreign targets、损坏 registry、未知锁和错误桌面会话；失败不回退另一账号。
- 本次不解除 VPS 切换暂停，不处置两个保留批次，也不上传、确认、删除或投放。

## Major Milestones

### 1. Persistent Desktop Owner

建立桌面文件及 XFCE adapter；用已有 canonical 私有目录/持久化接缝，安全处理 Desktop Entry escaping、SVG 首字角标、幂等注册和真实会话 D-Bus。相关测试覆盖追加第三账号、重复注册、foreign plugin 保留、非法输入与文件冲突、精确窗口聚焦。

### 2. Existing B Workflow Integration

增加 `desktop-sync` protocol、显示名投影及验证后调用，固定 CLI 聚焦委托原浏览器 owner。测试原请求兼容、readonly 路径无桌面写入、缓存窗口也能注册、错误主体拒绝，以及无 matching window 时不创建新 profile。

### 3. Deployment And Verification

运行 typecheck、受影响 tests、remote build 与 owned Harness；维护对应 AOCI 对象并评估稳定候选的 Review Risk Gate。部署完整 worker，保留 `state/`；仅对两个现有 profile 注册图标并实际点击，新增第三个账号用隔离 fixture 验证，不在真实主体制造新账号。记录最低真实证据，commit 本任务文件并 push，核对远端 HEAD。

## Self Review

上述三个里程碑覆盖程序接入、旧入口迁移、未来账号追加与实际验证；没有增加主体、云端自治、账号槽位或平台操作授权。配置、浏览器生命周期和上传账本分别留在原 owner，展示 registry 不成为账号来源。
