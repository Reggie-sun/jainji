# Qianchuan Real Integration Implementation Evidence

## Status

本轮按 [Spec](superpowers/specs/2026-10-15-qianchuan-real-integration.md) 和 [Implementation Plan](superpowers/plans/2026-10-15-qianchuan-real-integration.md) 实施。工程交付为完整只读报表快照、历史/CSV、账户资源协调及受控投放的授权审计边界；**真实计划创建、预算/ROI 修改及启停尚未准入，不能称为“真实投放接入完成”**。

用户明确要求 worktree；分支为 `feat/qianchuan-real-integration`，基线 `1d31b9196ad068a573a0f2ed18bfc214d1d65ce4`。原目录其他任务的上传恢复、profile、账户及 AOCI 未提交修改未复制、覆盖或提交。本轮不合并到原目录，不替换其运行中的程序。

## Implemented Boundaries

- `QianchuanAccountOperations` 是原 `DouyinUploadService` 持有的报表/投放资源租约；保存/导入账户、开关浏览器、计划读取、恢复/处置上传和清理经原 owner 保护。租约在首次 await 前建立，取消按 sender/UUID 绑定，底层查询清理完成前不释放；原正式成片准入优先取消并等待观察操作，不改原队列并发。
- 新报表经 trusted IPC、原账户身份/出口核验及固定 `QianchuanBackendQueries` 读取。主进程复核完整快照后才持久化，分页仍只有共享 `collectMaterialEffects` 一个 owner；制作效果页与计划数据页都调用同一 main capture/store，renderer 不再直接持有分页请求。
- 报表只存归一化白名单：来源、账户/计划、北京统计窗、采集时刻、精确 ID、平台原始 metric value/display 和未知单位标记。31 天、2000 行、180 秒边界不扩大；缺页、重复、漂移、取消及无效指标不发布完整报告。私有目录同步、不可覆盖原子发布、重启读取由 `QianchuanReportStore` 独占。
- 制作效果页增加本地制作批次筛选、文件名/批次排序及原成片打开入口，仍调用既有 `openArtifact`；采集经 main 持久快照后才显示。
- CSV 按快照的精确素材行输出，不按本地文件别名重复累计，不计算或平均 ROI。平台文本作 CSV 引号和公式转义；不输出播放 URL、Cookie、token、本地路径、原始响应或凭据。
- 草稿、授权和投放审计独立于原上传账本。金额用精确十进制/整数分，显式目标上限、累计增加、动作数及期限；授权由 main 当前 session 签发，renderer 传入形状正确的数据也不能冒充已签发授权。
- 提交前持久预算预留和意图，失败零提交；一次 adapter 调用后必须独立回读。提交不明锁存 UNKNOWN、保留额度和历史，重启不恢复授权、不重发、不回滚、不切 provider。创建响应已返回的计划 ID 在独立回读前持久记录，UNKNOWN 与重启保留该未确认身份，只供精确核查。UNKNOWN 保守阻断同广告主后续投放，不写成上传 UNKNOWN。
- 生产组合未注册任何真实写 recipe，也没有授权签发 UI/IPC。因此六种写动作均显示未准入；隔离 adapter 只用于验证上述工程边界，不能作为平台资格。紧急停止只撤销本地后续执行，界面明确说明平台可能仍在投放。
- 保留六入口；投放工作台默认读取千川账号，千管家为用户明确选择的可选来源。计划与数据中复用同一选中账户，展示历史快照、素材筛选/消耗排序、CSV、逐动作准入和安全审计摘要；店铺未知保持“店铺未识别”。

## REA Evidence

使用本机 `/home/reggie/vscode_folder/tools/rea` 的 `rea-agents@6.4.0`，本轮已运行 CLI，不以 Chrome 或历史结果冒充 REA 执行。

| Evidence | 本轮事实 | 限制 |
| --- | --- | --- |
| `ev_02fef491fc4aecd6b03624d9bce67df0240b6f62ac7d9547b3e0c463b4fe15c9` | 精确千川 origin 的现有 page target 发现 | 附着状态有未知项；不授账户或写操作权限 |
| `ev_18080c66eaae7e00bbd42c6ecedd7ec47d308b24454105996da5ecc081bbf192` | 原用户投放管理页被动 DOM/a11y/JSON shape 观察；页面区分支付与净成交 ROI | `policy_filtered`、`attach_limited`；不能补回附着前网络响应，不证明完整请求参数 |
| `ev_a9eba9f172e4d8a91ae05e7310b6ae645037015619c1fc5f4d4c2ab6bb8ba0ea` | 按已观测精确 CDN origins 分析 335 个已加载脚本，335 个均解析，0 parse failure | 只证明所选已加载脚本的静态分析覆盖；动态拼接、懒加载写表单、服务端资格和行为仍未知 |

静态看到 `/ad/api/creation/v1/product/get-filter-roi2-limit`、商品/抖音号及 ROI 建议读取线索。它们不是完整可投商品资格、创建、预算或启停配方；未据此拼写请求。第一次数组参数格式错误及只允许单 origin 的不足已纠正并重新取证；未把早期两个脚本的完整解析当作整站覆盖。

二次读取的两个相关 CDN 文件 SHA-256 与 REA 记录一致；仅在临时私有目录检查接口事实，没有把第三方实现复制进产品。原始 envelopes、专有脚本、平台只读结果仅留本机 `/tmp/jianji-real-integration-20261015/`，不进入 Git；该目录不是正式报告数据库。

## Live Read-only Observations

通过本分支实际 `QianchuanAccountSettings`、`QianchuanBackendQueries` 和 `captureQianchuanReport` 做有限只读核验，使用正常已保存账户及原浏览器/出口；没有千管家连接、自有 API、广告写入、真实上传、模型或付费请求。

| 已保存账户槽 | 结果 | 可证明范围 |
| --- | --- | --- |
| 氨糖膏 | `LIVE_READ_PASS` | 当日商品自选控成本汇总，平台返回指标完整，通过新快照严格 schema |
| 滴耳康 | `LIVE_READ_PASS` | 同上，独立精确广告主身份，未与另一账户混用 |
| 蝴蝶贴 | `LIVE_READ_BLOCKED` | 原固定出口/IP 校验失败；未直连、未切 provider、未重试或自动重连 |

这些结果不证明两个店铺身份、真实上传/审核、素材加入新计划、创建/参数操作、实际花费、成交或整片观看。没有伪造缺数据零值或扩展写权限。两个读取的账户身份和窗口保存在私有严格快照；它们没有被导入原上传账本或迁移历史批次。

## Verification

基线 typecheck 及 29 项原 backend/effect 测试通过。实施检查点的 typecheck 与 12 个聚焦文件的 106 项测试通过；随后自查补充并复现并发审计初始化和科学计数法排序问题，修复后的 typecheck 及相关两文件 12 项测试通过。正式 Harness 和独立审查绑定最终源码快照；最终执行状态与 receipt 路径以本分支交付消息为准。

制作效果页另经 typecheck 与 13 项专项回归，覆盖完整两页采集、取消/隐藏/重绑隔离、三种宽度、批次筛选、原成片任务 ID 和仅匹配素材 CSV；打开动作在 fixture 中为显式 stub，未打开真实成片。

新 UI 的真实 Chromium fixture 覆盖：无供应商连接时读取、完整保存及历史重载、CSV 下载、取消/隐藏/换号丢弃迟到快照、360px 布局、按视频身份筛选、本地停止不冒充平台暂停。窄屏下拉框溢出先复现后修复。fixture 不证明 Electron 运行资料目录的真实用户点击或平台操作。

原工作台导航 20 项回归通过，明确断言默认千川且选择供应商前无供应商读取；fixture 补齐新只读 IPC。另以实际账户设置 owner 的隔离 stub 复现子账户目录与报表租约并行，原入口 guard 已补齐，覆盖占用时目录调用数为零。

投放发送边界另补两项 red/green 回归：持久化期间授权过期时，真正调用 adapter 前仍须拒绝；一个已发送的冻结创建草稿不能因剩余授权次数或商品版本未变再次提交。草稿消费由同一持久审计锁原子核验，已证明未发送的记录不占用该消费资格；UNKNOWN 仍按原规则保留。

报表保存也在原子发布开始前复核取消 signal；临时文件同步期间收到取消时，不发布完整快照并清理本次临时文件。以真实临时目录和文件 sync seam 先复现后验证，覆盖取消发生在读取结束之后的情况。已完成原子发布的完整历史记录不因后续取消回滚。

Chrome MCP 单独操作本分支组件的隔离页面：先采集账户汇总，再切素材报告并采集，360px 下按 `video-2` 筛至 1/2 行，根滚动宽度 345px；执行本地停止后提示平台仍可能在投放。计数为完整报告读取 2 次、供应商/原单页读取各 0 次、本地停止 1 次，console 无 error/warn。`resize_page` 因窗口最大化被协议拒绝后使用 DevTools viewport emulation；没有改变真实千川页面。证据为本机临时目录的 `chrome-smoke-filter.json`、`chrome-smoke-stop.json` 和 `chrome-smoke-snapshot.txt`。

制作效果页 Chrome MCP 独立核验：完整读取 offset 0/100，按已接收批次筛为一行，原成片打开 stub 收到原 export task UUID，CSV 为表头加四指标行且不含 UNKNOWN 批次；360px 无整页横向溢出，生产调用为零。证据 `chrome-effects-smoke.json`；这仍是隔离 IPC fixture，非真实成片播放或平台验收。

`npm run build` 在本 worktree 完成，含资源完整性校验、typecheck、Vite、main/preload bundle；保留原大包提示，未制作安装包。AOCI 对本轮 21 个新增/变更对象完成机器批次维护并移除已迁移的旧分页 Entry，Verify、Check 和 Guide 均为 aligned/complete；正式治理仍由最终 owned Harness 复核。

首轮全路由验证保留环境失败：shell 的首个 Python 来自另一个项目的虚拟环境，缺 `numpy`，既有 `source-mask-static` 几何 worker 拒绝执行。使用本机现存 Miniconda 的 Python（NumPy 2.2.6、OpenCV 4.12.0、Pillow 11.3.0）重新验证；只为验证进程前置 PATH，不安装依赖、不改产品算法或 Python 查找规则。

独立原生审查首轮指出四项真实工程问题，Parent 均确认并修复：新 store 目录同步既有父目录后才准入；adapter 取消后等待真实 promise 清理，租约未排空不释放；创建响应返回的计划 ID 先落账并跨 UNKNOWN/重启保留；历史读取版本隔离已保存的新快照。新增回归先复现 6 个失败后转绿；新候选须重新完成验证及同一 reviewer 复审，最终状态以交付消息对应 receipt 为准。修复后的 50 项聚焦回归通过；随后补充取消先到、提交回包迟到时仍只保留计划身份、UNKNOWN 与零重发的 red/green 回归；Chrome MCP 再现迟到历史返回仍保留新快照，并显示未确认计划 789 与 UNKNOWN 提示（隔离数据）。证据 `chrome-s2-history.json`、`chrome-s2-audit.json`。父目录必须已存在，未进行真实掉电测试；隔离 adapter 不因这些修复取得平台资格。

S2 完整验证保留一次失败：授权过期回归在真实文件/目录同步时超过 Vitest 默认 5 秒预算，未给出业务断言失败；同一 9 文件 `--pool=threads` 命令复跑 88/88 通过。该单项测试改为显式 15 秒预算，保留原授权过期及零提交断言，产品授权和执行时限未调整；再次全量验证的实际结果以最终 receipt 为准。不将一次复跑称为已确定宿主 I/O 延迟根因。

## Acceptance Gaps

| Spec | 本轮状态 |
| --- | --- |
| F01 / A07 | 原账户隔离复用，两个真实广告主汇总已读取；店铺 ID 未核验，多店铺未验收 |
| F02 | 原计划详情/关联商品只读保留；可投商品目录、资格、预算类型/状态及模式范围仍缺平台完整证据 |
| F03 / A02 | 原上传/确认 owner 不变；未执行本轮真实制作上传及素材审核回读，独立素材库上传未准入 |
| F04–F05 / A03–A04 | 创建、绑定、ROI、预算及启停缺完整实际写配方和有界真实授权，均未执行；核心真实投放验收阻断 |
| F06 / A08 | 账户控成本汇总与逐计划素材快照工程可用；新增真实素材链路、计划级完整指标及口径对账尚未完整验收 |
| F07 | 原精确视频关联及一对多素材保持；快照素材筛选/排序/CSV 已接入；本地批次筛选、原成片打开和去重归因 CSV 已接入；平台商品身份及跨快照分析未交付 |
| F08 / A05–A06 | 隔离测试验证预算、持久化、取消、一次调用及 UNKNOWN；无真实投放授权入口或真实写能力准入 |
| A09–A11 | 工程取消隔离和原回归由 tests/Harness 验证；实际 Chrome 集成与最终回执另外分层记录 |

Windows 的新快照/投放 store 复用已有 Linux 私有权限与目录持久化准入，Windows 明确失败关闭；没有用 Linux PASS 冒充 Windows。原单页只读入口保持可用；制作效果页的新持久采集同样受 Windows store 未资格限制。没有两家可核验店铺、真实上传及有界写入证据时，M3 保持未完成。

## Session Capture Decision

仓库未声明专用 session-record/capture Skill。本轮有 durable 实施与真实只读证据，使用本报告、实施计划、正式 AOCI 及 Harness receipts 记录；不写 Codex memory，不制造 `.agent/bug-memory/` 操作手册。
