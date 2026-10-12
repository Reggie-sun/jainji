# Local Browser Autostart Record

## Scope

2026-10-13 用户要求本机也由程序检查账号 Chrome：未打开时自动启动，已打开时保持原行为。沿用 [上传合同](douyin-auto-upload-spec.md) 的新制作准备权限；应用启动、后台目录读取和历史恢复仍不启动 Chrome。

## Implementation

普通制作的 `current-browser` 预检原来只调用既有连接读取，本机 Chrome 关闭时会提示人工打开。现在由原 `QianchuanBrowserManager.existingConnection` 接受仅新制作使用的 `openLocalIfMissing`，确认对应进程缺席后委托原 `open` owner 启动。参数默认为关闭；VPS 仍走原资源保护及准备路径。

已打开的本机窗口只复用原连接，不重新要求网页属于保存的 advertiser 锚点：用户可保留当前已切换的子账户，原网页姓名/ID、所选计划、配置 digest 与前后快照核验继续约束上传。无调试连接、连接元数据损坏或多进程歧义均停止，不把故障当作“没打开”并启动替代窗口。没有增加本机完成后自动关闭行为。

## Verification

- 修改前两项冷启动回归失败，分别复现普通制作目录未打开和 manager 拒绝缺席连接。
- 修改后 `automation-upload`、`qianchuan-account-settings`、`qianchuan-browser-manager` 共 107 项测试通过，`npm run typecheck` 通过。
- 假平台完整链覆盖本机初始关闭及已打开两种情况，原确认 owner 得到绑定接受证据后仍保持浏览器打开，已打开子账户不同于保存锚点也不被切回；映射字节不变。
- 真实隔离 Linux Chrome 验证缺席时启动、再次准备复用同一 PID/CDP 端口及全部 page target IDs；原目录/class/本地数据保留回归也通过。
- 工程证据不表示真实千川新增素材或 Windows 实机验证。本轮没有改变真实账号绑定或提交平台素材。

## Delegation And Record Boundary

通过 `external-subagent` 封存副本，委托受管 Kimi `deep` 对冷启动与当前子账户复用进行只读映射；Parent 保留实现、验证及判断职责，transport/report 状态以私有 canonical receipt 为准。

当前合同索引没有声明专用 session-record Skill，本记录保存这次可复现缺口、持久修复及验证边界；运行日志、封存副本和任务回执不进入 Git。
