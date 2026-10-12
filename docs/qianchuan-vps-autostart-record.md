# Qianchuan VPS Browser Autostart

## Behavior

2026-10-13：新制作使用 B 方案时，由简辑准备对应账号的 VPS Chrome。用户不需要先进入 VPS 桌面启动 Chrome；原账号完成上传与确认后，沿原 owner 正常关闭，再切换账号。制作和导出仍在本机。

修复了普通制作选择 `current-browser` 计划时，已关闭的 VPS Chrome 导致预检要求先开浏览器的问题。`DouyinUploadService.preflight` 在既有单账号资源保护完成后调用 `QianchuanAccountSettings.prepare`，随后才读取并核对网页账户与计划。定时执行继续使用原自动准备路径。

后台预加载、刷新计划目录和历史恢复仍只连接既有浏览器；不会因为启动软件就同时打开全部账号。已有 READY / UNKNOWN、账号漂移和关闭失败继续阻断不安全切换。登录过期或验证码仍由平台原登录流程处理。

## Evidence

- 基线 `56c2ee317cc43c379bf813836f8003105f0cd16e`；修复后 service SHA-256 `33ea1f70b9c918b99c2644be7a9d832831bdee2dea439a40841d4fe01ae4e5c5`。
- 新回归测试在修复前以 `catalog browser closed` 失败，修复后通过：从关闭状态预检，自动启动一次、先启动后读取当前账户、预检结束后关闭。
- `npm run typecheck` 通过；`automation-upload`、`qianchuan-account-settings`、`qianchuan-browser-manager` 三组串行执行，103 项通过。最初并行执行遇到浏览器发现与真实 Chrome fixture 干扰，改用既有 Harness 的串行文件执行方式。
- 运行中的 `make frontend` watcher 完成正常空闲重启，当前主进程 bundle 含新增预检调用。
- 通过运行中简辑公开 `openQianchuanAccountBrowser` / `controlQianchuanAccountBrowser` 接口实测安序、予浅：远端 Chrome 数量依次 `0 → 1 → 0 → 1 → 0`，保持各自原 profile。此证据验证原浏览器 owner 的真实启动与关闭；新预检分支由回归测试验证，本轮未新增真实素材上传或投放。
- 完整路由 Harness 与 completion receipt 留在 `.agent/harness/runs/20261013-vps-autostart/` 指向的运行证据中；最终 review gate 决策留在下述私有证据目录。

## Boundaries

本轮仅修改 service 的准备调用与对应回归测试，不改变队列、账号映射、出口、历史处置或确认能力。共享工作树的其他改动保留；AOCI 仅维护本轮 service Entry 与对应 baseline。

受管 Kimi 只读调查 invocation `5988d9ae-e8d2-4ebc-b560-42450e074855` 返回 `EVIDENCE_INCOMPLETE`，缺少合格报告，未采纳为独立结论，也不充当 final reviewer。根因和修复依据是 Parent 源码核查、失败复现与可执行验证。

私有证据目录：`/home/reggie/.cache/jianji-vps-autostart-20261013`。不提交凭据、登录数据或平台素材。103 项回归与程序开关浏览器的实测不代表五账号长期性能或新的真实上传验收。
