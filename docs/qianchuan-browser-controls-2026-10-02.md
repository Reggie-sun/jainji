# Qianchuan In-App Browser Controls

## Scope

用户要求打开、关闭及重新连接账号 Chrome 都在简辑内完成。本轮在 `make frontend` 的作品页账号设置中提供“打开账号浏览器 / 登录”“重启并连接”“关闭账号浏览器”。只管理已准确绑定的原账号目录或应用账号目录，当前资格为 Linux；晚安油仍按用户要求暂不处理。

合同见 [Upload Spec](douyin-auto-upload-spec.md#in-app-browser-controls-amendment-2026-10-02) 与 [Implementation Plan](superpowers/plans/2026-10-02-qianchuan-browser-controls.md)。

## Behavior

- 关闭或重启使用已保存账号和预期 advertiserId，不能通过未保存链接、任意 PID、路径或端口更换目标。界面说明会关闭该目录的全部窗口并要求明确确认。
- 主进程先保护制作、导出、上传控制、账号准备和该账号所有尚未结束的上传记录，包括当前制作范围以外的 READY、UNKNOWN、selection fence 与待导出意图。拒绝时不改记录、不关 Chrome。
- 退出前按实际匹配进程的 HTTP/WS 端口再次核对全历史任务，保护 binding 引入前同一进程里的其他 advertiser 草稿；缺 endpoint 无法证明分离时保守阻断。Chrome 更新后的 deleted executable 仍参与唯一进程识别与 pidfd 校验。
- 已核查并明确结束本地批次后，另一次明确浏览器操作才能退出窗口；本地结束不等于平台确认，历史记录及防重传屏障保留。
- 原上传服务的准入计数覆盖普通制作、批量制作、直接导出及追加入口，从准备、预检到队列和上传意图登记持续保护；异步路径检查不能留下允许关闭的间隙，失败时释放计数。
- 重查唯一主进程后，由 `/usr/bin/python3` 先打开 pidfd，再核对 UID、Chrome 主进程、启动时间、目录及 class，只向该进程实例发送一次 SIGTERM；缺 Python 3.9+ 或 Linux pidfd 支持时拒绝，不回退数字 PID 信号。有界等待正常退出；身份改变、退出超时或连接不唯一即停止，不强杀、不删除锁和登录目录。重启确认旧窗口退出后打开同一目录，等待新的常规 CDP，并使旧准备缓存失效。
- 无可识别的原账号绑定时拒绝猜关窗口。应用启动恢复仍不会自动关闭窗口、恢复上传或点击确定。

## Executable Evidence

- RED：新增 manager 控制测试首先因不存在 `control` 失败。后续独立审查指出异步制作准入间隙与数字 PID 复用风险；对应 deferred admission 和过期进程身份回归均在修复前失败，修复后通过。
- 修复后的三组 focused 测试共 99 项通过，`npm run typecheck` 与 `npm run build` 通过。扩展 25 文件运行首先为 355/359，通过单 worker 复查全部失败文件，恢复 13 项、改传 6 项、manager 28 项均通过。真实 manager 生命周期包含四次退出和多次启动，测试总预算从 30 秒改为 120 秒；软件单次退出 10 秒及启动 15 秒上限未变。保留失败日志，不把调度超时隐藏为一次全绿。
- scoped Harness `20261002T125115Z-4d425003` 的 1,136 项断言及 typecheck 全部通过；运行期间其他会话修改 Harness policy、scope 和研究脚本，最终整体为 `NOT_EVALUATED`。新 policy 重复登记三项测试，文档与 AOCI 子进程因此无法加载配置；这不是链接回归或浏览器测试失败，不能把该回执称为完成证明。
- 最终修正后的五组相关测试共 154 项通过，`npm run typecheck` 与 `npm run build` 通过。跨 advertiser 的 HTTP / WS / 无 endpoint 保护、实际进程 guard 和 deleted executable 回归均先 RED 后 GREEN。源码与 `review-source-4/snapshot.json` 的全部对应哈希一致。
- 最终 scoped Harness `20261002T132045Z-82bf4054`：11 个测试组共 1,142 项断言、typecheck、12 份文档引用和 20 项本轮 AOCI disposition 全部通过。四个其他会话的研究脚本/测试在执行中变化，整体回执因 `workspace-identity / source_changed` 为 `NOT_EVALUATED`；本轮 owned bytes 未改变。该回执不能通过 completion verify，不修订回执或缩小参与身份来伪造通过。
- 真实隔离 Chrome：验证正常关闭、重新打开同一目录、无 CDP 时通过软件逻辑重启，以及目录 marker 保留。使用隔离 headless profile 和本地页面，未消耗商业账号额度。
- 真实软件 Chrome MCP：在作品页选择肥皂，点击关闭及重启的确认按钮，两次均因未结束的 READY 历史被主进程拒绝；持久上传 ledger 前后 SHA-256 相同。原账号待确认窗口保持打开，没有上传、平台确认或发布动作。
- 首次 UI 复查在点击前因批量制作运行中拒绝，没有操作窗口。制作结束后开发进程自动重载；最终修正加载后，2026-10-02 13:21:44 UTC 的真实 Chrome MCP 再次验证肥皂关闭/重启保护，两次被正确拒绝，ledger SHA-256 保持 `6e8987da9616293b1148689d09ec47db256216de6608f26f45e24d524da3c6ae`，`confirmationClicks=0`、`uploadActions=0`；没有强制重启软件。
- 证据目录：`.agent/harness/runs/20261002-account-browser-controls/`，保留各轮失败和通过日志。最终相关测试在 `review-round2-red.log` / `review-round2-green.log`，类型和构建在 `typecheck-round2.log` / `build-round2.log`，真实交互在 `ui-round2/ui-proof.json` 及截图。此前截图已人工核看按钮与提示。

## Review And Governance

受管 Kimi mapping invocation `67696ceb-1c27-444d-b62d-a11c268776bc` 的 canonical receipt、实际读取与产物哈希已由 parent 核查。首次最终审查 `81a94b0b-46d7-46cc-8d97-f10adfeddb12` 因并行会话修改 AGENTS.md 返回 SOURCE_CHANGED，没有采用其报告；保留原失败回执，代码身份不变后另行封存有限审查。

两次后续受管审查 `ed00ef7f-a5f2-425c-bea1-23ce5cd84c6e` 与 `615f8690-4a7b-48b1-8b30f420f731` 分别为上游 timeout 和必需 protocol evidence 不完整。Parent 核查 canonical receipts、产物字节与已消耗请求，隔离其输出，按 SUBAGENTS 的连续故障规则改由一个只读 `reviewer_xhigh` 接手；没有继续请求 Kimi 或声称 native 具备原 Docker route proof。两个 blocking findings 经 parent 证实并修复；第三轮完整复审核对 `review-source-4` 的 27/27 个文件哈希，最终 finding set 为空。Parent 另核对当前最终 diff、回归及真实交互，空 findings 不授予 Harness completion。

第二轮发现 `BCR-003`：原 profile 首次绑定给 B，但同进程还保留 A 的旧 fenced 草稿。Parent 复现并证实，新增退出前实际 endpoint guard；HTTP、WS 和缺 endpoint 三类回归均先 RED。`BCR-004` 的更新后 executable 被遗漏也通过 fake `/proc` 复现，保留 deleted suffix 的主进程发现并沿原 pidfd 校验退出，避免假称已关闭。

用户授权本窗口接手 README 链接校验后，核对 GitHub heading slug 语义：删除标点后的两个空格应各转成一个连字符，原链接正确。只修正 `src/harness/governance.ts` 的空格替换并添加有区分力的回归，RED 失败，23 项 governance 测试 GREEN；没有改写正确链接。

用户随后授权接手 policy 的三项重复测试登记。写入前发现原会话已完成相同修正；本窗口的 patch 没有应用，不把其整个 policy 变更计为本轮所有。当前测试路径无重复，原关联测试组和 route 保留。

共享索引已按完整机器批次维护。本轮十个浏览器 source owner 及授权的 governance source 均无官方漂移；测试和文档按 observe scope 核对，不扩大索引。最终五个再次改变的 source owner 通过完整批次一次维护，官方 Verify、Check、Guide 均 aligned，证据为 `aoci-round2-verify.json`、`aoci-round2-check.json`、`aoci-round2-guide.json`。最终 Harness 进一步证明 20 项 owned disposition 与官方当前快照吻合；全库治理与本轮对象证明分开保存。

## Limits

未关闭用户真实待确认账号窗口，正常退出路径由隔离 Chrome 验证；登录目录保留不代表平台登录永不过期。Linux 证明不代表 Windows 实机资格，也不代表平台已确认上传。

本轮功能及相关验证已形成稳定 checkpoint，正式 scoped completion 仍受其他会话在运行中修改参与源码阻断。不得将全部测试断言通过改称完整 Harness 或完整平台验收通过。
