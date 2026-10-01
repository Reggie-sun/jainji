# Qianchuan Original Profile Reuse Checkpoint

## Result And Boundary

已实现并加载到当前开发版：新制作优先识别正确原账号 Chrome，核验后保存私有 profile 绑定；关闭后使用相同目录、profile-directory 和 class 启动。绑定失配、歧义、损坏、丢失、写入未知或旧许可式连接明确阻断，不另开登录目录。原上传目标、文件 fence、UNKNOWN 和确认边界保持。

原六账号 launcher 已安装 opt-in 常规 loopback 动态 CDP 补丁，原 profile、图标和桌面身份保持。六个原主进程 PID 仍为 3585522、3213257、3213658、3213845、3213990、3214391，均尚无启动时 CDP 参数；没有关闭或重启，登录数据未读取或复制。实际激活和三账号新批量上传仍待原窗口安全重启，不能称为真实上传验收。

## Contract And Ownership

[Spec](douyin-auto-upload-spec.md) 与 [Plan](superpowers/plans/2026-10-02-qianchuan-original-profile-reuse.md) 的原 profile 修订为当前任务合同。browser manager 独占选择及启动；新 browser bindings owner 只保存连接身份，不成为产品设置或上传授权 owner。account settings、冻结目标 schema、service/page contract/store 均保持现有入口。

保留无 CDP 的运行 profile 身份，避免把仍在运行的原窗口误判为已关闭。Chrome 刚重启时可能暂留旧端口文件；管理器在启动期限内等待 `/json/version` 可连接，随后制作预检仍核验精确账户，上传原合同核验可见双 ID。所有等待均在选文件前，不改变 UNKNOWN 的零重传规则。

## Verification

- `npm run harness -- code`：`20261001T172206Z-b9bdd2c0` PASS；typecheck 和六个测试组全部 PASS，共 519 项，无 skip；before/after source identity 一致。
- 上传组 258 项包括原窗口优先、动态端口、三种坏绑定、账号歧义、跨账号复用拒绝、并发绑定、同步失败锁存、目录别名、运行中未启用 CDP、启动就绪等待及已有上传合同。
- 真实隔离 Chrome 测试：重复 detach 保留 tabs；绑定原 profile 后正常停止并以相同 directory/class 重启，保留本地测试标记。官方 URL 在该测试中由隔离 route 本地响应，不访问真实账号；这不是平台验收。
- `npm run build` PASS；Python 窄补丁测试 3 项与已安装 host manager 原生测试 14 项 PASS。测试退出时 Chrome 子进程短暂继续写入导致的临时目录清理竞争，使用有限 `rm` 重试处理。
- 当前 Electron 经 Chrome MCP 实际点击“作品 → 蝴蝶贴 → 打开账号浏览器”：显示新说明及“原账号 Chrome 尚未启用常规连接”提示；六个原进程保持，没有新增账号登录窗口、上传或确认。
- AOCI 四个受管对象已维护，Verify、Aggregate Check、Guide 均 aligned，`complete=true / next_action=none`；测试、脚本、文档按既有 observe scope 保留。

中间失败回执保留：首次构建被测试函数参数的 optional 类型错误阻断；后续隔离测试发现旧端口启动竞争并修复；一次检查的全部组通过，但清理 Python cache 改变工作区身份导致 aggregate NOT_EVALUATED。最终上述独立稳定运行 PASS，不复用这些中间结果充当通过证据。

## Launcher Installation Evidence

窄脚本 `scripts/enable-qianchuan-profile-cdp.py` 以已检查源码 SHA 做 CAS，备份源码，再安装仅供显式六 profile 使用的私有 opt-in 名单；不重启 Chrome。host manager preimage SHA `4948b5fa130c1b1418dfb7342a2da35e544f79dfd33361c66782c266d5ff39fe`，installed SHA `655962f41f8154c40f8df98069b45eef9000011afb50c81ebdc6b086fabccbfd`。不修改用户 Codex MCP 配置；软件连接不依赖该配置。

## Independent Investigation And Parent Decision

受管 Kimi deep 的第一 invocation `2bb8d3c5-3894-4834-a9d5-f805377785e7` 在 RESPONSE_HEADERS 发生 CONNECTION_ERROR，没有读取证据；调查 canonical receipt 后仅追加一次有界恢复。第二 invocation `62780c96-ff17-4691-b519-404156c5e143`：两个 authenticated k3/max 请求、五份冻结完整 Read、无截断、PARSED。该结果是源码调查，不是 implementation review 或验收。

Parent 核对了 profile-directory/class、动态端口和恢复边界的建议。未采用许可式 WS 回退及读取 host registry 的建议，避免再次授权和另一套发现输入；未扩展冻结账号 schema，连接元数据由 browser owner 的独立私有文件保存，维持旧账本解释。

## Implementation Review Risk Gate

稳定 candidate 绑定上述 Harness 的 source identity 与本轮 source SHA 清单，结果为 `KIMI_REVIEW_NOT_REQUIRED`。用户未要求该 snapshot 的 Kimi review；不存在新 renderer 路径/命令/端口 authority，未触碰账号凭据、历史 ledger 或文件动作 owner。跨账号绑定拒绝和原可见双 ID 上传门均有可执行证据；目录安全、独占保存及未知写入阻断已测试，没有关键级的新越权或不可恢复 production-state 路径。剩余原窗口激活与实际登录/上传是 live QA 缺口，源码 reviewer 无法代替该证据，不叠加重复审查。

## Remaining Work

代码和 launcher 修复已准备；当前安装包未替换，开发版已载入。原窗口重启会丢失待确认弹窗，须先核查其状态；随后核验六个常规 CDP 端点及账号，并在软件制作新 3 模板各 10 条，三个账号各自 10 READY、零模型请求、零确认。旧成片、旧 UNKNOWN 和未选历史任务不参与。仓库没有专用 session-record/capture skill；本文件记录本轮 substantive implementation、host effect、工程证据与真实阻碍，不写全局 memory。
