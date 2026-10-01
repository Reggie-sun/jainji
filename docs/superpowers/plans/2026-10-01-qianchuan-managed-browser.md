# Qianchuan Managed Browser Plan

## Goal

普通用户在简辑里打开账号浏览器并首次登录后，批量制作自动连接上传，无需 MCP、端口配置或 Chrome 临时远程调试许可。实现原 [Upload Spec](../../douyin-auto-upload-spec.md) 的 Managed Account Browser Amendment。

## Scope And Invariants

Linux 已安装 Chrome；每个 advertiser 独立应用私有 profile，启动即启用 loopback 动态 CDP。应用启动不打开浏览器；明确账号打开或新制作才启动。保留现有账号配置格式、冻结历史、永久 fence、每组至多九条、READY 后推进和停在确定前。Windows 未资格继续拒绝。个人 Chrome、桌面启动器和凭据不迁移或修改。

## Milestones

1. 新建 `src/main/qianchuan-browser-manager.ts`，独占安全目录、已安装 Chrome 启动、按精确 profile 复用运行进程及有界等待；`qianchuan-browser-discovery.ts` 返回可核对的运行 profile 元数据。测试证明路径拒绝、启动参数、账号隔离、并发只启动一次、复用及超时；隔离真实 Chrome 验证无许可 attach 与跨 manager 实例复用。
2. `qianchuan-account-settings.ts` 默认使用该 owner，首次设置和新制作准备动态端口；旧配置和冻结目标保持。`douyin-upload-service.ts`、`index.ts`、`preload.ts` 添加可信“打开账号浏览器”入口；`QianchuanAccountSettings.tsx` / `DouyinUploadPanel.tsx` 提供首次登录操作与明确说明。测试非法 IPC 输入、无主动动作零启动、旧任务及设置改名兼容。
3. typecheck、上传 Harness、账号与浏览器 tests、build 和 Chrome UI 验证。真实账号首次登录由用户完成后，用软件新批量生成验证正确账号和 READY，不处理历史未知文件。评估 Implementation Review Risk Gate，维护 AOCI、记录边界、只提交本轮内容。

## Self-Review

唯一 profile/启动 owner 不拥有上传 authority；renderer 只能传既有 strict 设置数据。目录和端口不出界，启动无任意参数；旧 browser WebSocket 适配保留供历史 attach，不是新制作默认回退。首次登录未完成则真实验收未完成，隔离测试不能代替平台验收。

## First Login Follow-up

真实制作三条完成后，新 profile 默认进入推直播间导致上传未选文件即超时；登录主页未被发现，以及窄窗口隐藏账号区也已复现。共享 `accountPageUrl` 固定推商品路由 `#umg=1`；discovery 接受精确 `/home?aavid=...` 元数据；manager 启动最大化，uploader 在新建生产 tab 时最大化所在窗口。保留原可见账号/计划校验、历史页只读和所有 fence。

修改四个 owner 及对应 account-config、discovery、manager、CDP tests；先证明四项失败，再修复并运行 typecheck、上传 Harness 与 build。从真实软件启动新的本地随机三条，核对全部正式输出、原上传列表 READY、正确双 ID 及零确认。失败的第一批保留，不重传旧任务。Parent Self-Review：只读主页发现不授上传权；路由和窗口准备发生在选文件前，不改变广告设置或其他浏览器。
