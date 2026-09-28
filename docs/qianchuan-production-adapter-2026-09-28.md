# Scope

按已授权的 spec 0.2 与 M1–M5 plan，继续把千川真实页面合同接到现有上传 service/store、正式导出通知和结果页。Spec SHA-256 为 `919b3791fb6e7f22ceee680bbff1afcaaf556133b7a977c569a8480bddf9dd1a`，plan SHA-256 为 `bb746d5f702792e6fb15f6630d5cdfbbceb581d85e4205f14714e09a6bf44ce2`。本次只修改干净的页面适配器及其测试、隔离 smoke 和记录，不接管已有制作/UI seam 修改。

本次没有再选择或上传真实视频。此前用户授权的蝴蝶贴历史视频单条人工上传见 [Live Evidence](qianchuan-cdp-test.md#butterfly-single-video-upload)，它不是应用正式导出后的自动上传验收。确认、发布及广告设置始终不在应用操作能力内。

# Source Contract

生产定位使用源码内有限的 `.ovui-drawer--no-maskable .ad-drawer-body`、素材 tab、添加视频按钮、独占的添加视频 drawer、上传视频 tab、`data-e2e="oc_emptyKey_uni-prom__createMaterialUploadVideo"` 拖拽入口。账户 ID 必须全局可见且唯一；计划 ID 必须在当前计划 drawer 内可见且唯一，主列表的同计划 ID 不参与匹配。允许 ID 文案两端空白，不允许宽松数字匹配。初始客户端渲染有界等待；之后每个操作都重新核对 URL、可见 ID、drawer、modal session tag 和独立确认按钮。

服务先永久落盘 selection fence，随后 adapter 只通过 CDP 原生文件拖拽送入一个私有快照。拖拽坐标只由已经唯一证明的 DOM 控件计算，并在每个事件前重新滚动、核对归属及命中测试；不使用坐标寻找控件或消除歧义。iframe 路径不具备已核实的 viewport 合同，拒绝拖拽。没有网页内部上传 API、脚本伪造上传成功或点击确认路径。

处理中允许最新文件行迟到、已选数量暂时未增加。先前 ready 文件必须保持，陌生/重复/丢失文件、超过预期的行/数量均拒绝。列表按精确文件名集合核对，不假定显示顺序。Ready 必须同时具备全体预期文件、精确数量、每行可见成功图标和成功 progress 标记、确认按钮可用，以及无取消上传/失败信号。进度 100% 或拖拽调用返回不能单独通过。

恢复只找原 target 与原 modal session，不新开页面、不拖拽、不删除素材。未知结果继续永久禁止重传。旧版 creator 发布路径不开放；Windows 权限/目录同步准入仍阻断。

# Live Evidence

使用当前生产 adapter，仅在蝴蝶贴已登录 Chrome 的新专用空 tab 执行 connect/open。核对账户和计划并打开空上传面板，返回独占 target、modal session 与 selectedIndex 1；没有选择文件或点击确定。报告保存在 `/tmp/jianji-production-page-probe/report.json`。这证明当前 adapter 的空页面导航/归属/容量及入口可用，不证明上传处理、连续多条或应用真实账号端到端验收。

探测固定了两个 fixture 未覆盖的真实差异：冻结 target 的 `configDigest` 不可传入 strict account URL schema；可见账户 ID 文案有前导空白。均在本次源码和回归中处理。此前人工上传的原 target 在稍后的只读尝试中不可恢复；没有打开新页重传或推定草稿仍存在。

# Verification

本机 Linux、Node v22.21.0、Electron 33.2.1、playwright-core 1.63.0、FFmpeg/ffprobe 8.1.2：

| Check | Evidence | Boundary |
| --- | --- | --- |
| Typecheck / build / package:linux | exit 0 | 当前 working tree；生成 AppImage、deb 和 linux-unpacked |
| Related tests | 123/123 PASS | account/schema/store/service/export/fixture browser/UI；没有真实账号 |
| Code Harness | `20260927T164818Z-b3797897` PASS，374 tests | 运行前后 sourceIdentity 相同；visualReview 未评估 |
| Dev desktop smoke | `/tmp/jianji-qianchuan-smoke-6PTYSz/report.json` PASS | 合成 MP4 正式导出、原生 CDP drop、ready/结果页、独立追加、IPC、重启零重选 |
| Packaged desktop smoke | `/tmp/jianji-qianchuan-smoke-XVVYwA/report.json` PASS | 未修改的 app.asar adapter；独立测试 driver 将生产 origin 截获到本地页面 |
| Real empty panel | connect/open PASS | 蝴蝶贴可见双 ID、唯一入口、整批容量；零选文件、零确认 |
| Current app real video upload | NOT_EVALUATED | 先前人工上传不替代该验收；本次没有新真实文件选择 |
| Windows | BLOCKED | 权限/目录同步仍未实机核实；保持 fail closed |

两个桌面报告均为 `realAccountsUsed:false`、`confirmClicks:0`，同时检查广告设置事件为 0。临时报告可能消失，上表持久保留最小结论。当前不宣称 M5 的应用真实账号上传完成。

# Review Risk Decision

稳定 implementation snapshot 为 `ed676dc03244e39cfb6ff81123b9a6a0d89c37bb629999374e0c91dc57cba5ae`：将六个变更的 source/test/smoke 路径排序，按 `path<TAB>SHA-256<LF>` 计算；文档和 AOCI 不参与，避免自引用。Review 在上述 native verification 后启动。

结果为 `KIMI_REVIEW_REQUIRED`。用户未单独要求此 snapshot 的 final review；本次没有发现关键级持久状态损坏或凭据暴露路径。联合条件命中：生产文件 delivery 可使商业素材进入错误账户/计划，后果重大；真实当前应用完整上传未验收，真实 DOM guard、异步 ready 与永久屏障的组合仍有验证缺口；独立 adversarial review 可核查身份/页面归属、选择次数、未知恢复和 fixture 掩盖的源级错误。不会用静态 review 替代真实页面验收。

使用 `external-subagent` 的 sealed read-only Kimi deep route，禁止浏览器、账号文件、媒体、写入、测试执行、commit 和 nested delegation。第一轮 receipt `79443295-64db-4acf-88f8-2318bbb55bc2` 为 `OUTCOME_UNKNOWN`：前三个 authenticated wire requests 实际模型为 k3、effort max，并完整读取了源码、service/store 和测试；第四请求收到上游流但约 312 秒后超时，native result 为 `Request timed out`。没有最终 findings，不作为 review 通过证据。已调查后以同一 snapshot、去掉重复材料、最多两批 Read 和三个 wire requests 开始第二轮；不能以 exit 0、PARSED 或空 findings 自动接受。

# Ownership And Governance

保留其他 working-tree 修改和用户项目删除，不 stage 相关 seam 或用户文件。构建和桌面检查针对已知当前 working tree，因此包内包含其他未提交修改，不称为仅本提交的发布包。Repository 没有专用 session-record/capture skill，本记录承担持久检查记录；没有写全局 memory。

AOCI 当前完整机器批次只包含 `src/main/qianchuan-page-contract.ts`；已更新对应 Entry 和源码/索引 baseline。Verify、Check 均 aligned，Guide 为 `complete:true / next_action:none`。这是当前 working-tree 治理证据，不宣称完整系统认知已验证，也不接管其他源码。

第二轮 receipt `ec6040c1-a253-4dd1-9fe1-108680cce01a` 为 `PROTOCOL_ERROR`，虽然 native exit 0 且最终 authenticated k3/max response 完成，正式回执未建立有效 Read/report 证据。诊断发现六次 denied Read；输出中的未读 service/store/schema 问题不能被当作已审核。Parent 核查了源码：ID 由共享十进制 schema 保证；普通页面错误在 service 变成 NEEDS_HUMAN，fence 后任何错误均保持未知；service 在 port.upload 前调用永久 markSelection。计数先于文件行的未知顺序继续 fail closed，是未观察到的多文件页面可用性限制，未据此放宽准入。未将该无效回执作为通过。第三轮仍绑定同一 source snapshot，恢复 schema/fixture/service/store 上下文和六个有限 wire requests，最多两批 Read；不修改 acceptance criteria，也不启动第四轮。

# Checkpoint Status

第三轮 receipt `ce573efb-8b0b-483e-8125-ad8034a0260a` 为 `OUTCOME_UNKNOWN`：480 秒 wall budget 到期，前三个 authenticated requests 为 k3/max，第四个上游请求约 352 秒后未建立最终 response identity；没有 terminal report，正式 `observed_reads` 为 0。诊断事件包含 28 次 Read 调用与 12 次 denied Read，不能把流中的部分输出当成有效独立审查。Receipt 保存在 `/tmp/jianji-production-page-probe/kimi-receipt-r3.json`，canonical invocation 由 `agent-subagent-router` 保存。

本 checkpoint 为 `REVIEW_ESCALATION_REQUIRED`。三轮预算已用完；按 `SUBAGENTS.md` 不自动发起第四轮、不修改 external runtime/router、不以 Parent 复查替代 required review。源码快照保持不变，native verification 已完成，但 completion/commit 被有效审查回执缺失阻断，当前候选保留为本任务暂存内容。

审查结束后再次运行当前 working-tree typecheck 与暂存 diff 检查，均 exit 0。AOCI 的其他条目和 baseline 在等待期间出现别的任务的未暂存更新；保留其 working-tree 字节，不重新 stage 或覆盖，仅保留此前本任务已暂存的对应条目。上节 AOCI aligned 证据指本任务更新完成时的检查，不宣称后来并发更新已经由本任务验收。当前应用真实账号视频上传与 Windows 验收仍未完成。
