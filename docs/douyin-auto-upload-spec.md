---
title: Jianji Qianchuan Upload Only Integration
status: proposed
implementation: not_started
version: 0.2
date: 2026-09-27
source_baseline: 77b3de9898cdbd59789c5101424eda38ee53c3aa
---

# Summary

## Managed Account Browser Amendment (2026-10-01)

用户明确要求普通使用者无需点击远程调试许可。新制作默认使用简辑管理的账号 Chrome，覆盖下文“仅 attach、不能启动 Chrome”限制；不修改用户桌面启动器、不接管或关闭既有个人浏览器。主进程按严格 advertiserId 在应用私有目录派生独立 profile，使用已安装 Chrome，以 loopback 和动态端口启动。首次由用户登录；登录态仅由 Chrome 在该 profile 保存，程序不读取、复制或导出 cookie/token。没有 Chrome、平台未资格、目录不安全、启动超时或登录不可确认时明确阻断，不回退到需要临时授权的任意浏览器。

只有可信账号设置中的“打开账号浏览器”和用户明确选择上传的新制作可以启动；应用启动、刷新摘要和历史恢复不启动浏览器。账号设置入口沿用 strict product/planUrl/productName 输入，不接收路径、命令行或端口。运行中复用同一 advertiser 的专用进程；新制作发现当前端口后冻结，配置 digest 变化拒绝。不改写已冻结任务的地址、目标、页面归属或永久 fence；旧页面只读恢复仍 attach 原地址。停止和退出仅 detach，保留 Chrome、登录和待确认页面；不自动确认或发布。当前只资格 Linux，Windows 原阻断不变。

Self-Review：专用浏览器只拥有启动和连接准备，不建立第二上传队列；最终账号及计划仍由原 page contract 验证。目录按账号隔离，不从显示名称或旧端口推导归属；新 profile 可能需要首次登录，不能把旧浏览器登录态直接搬入。自动重连仍仅适用于未选文件，未知结果禁止重传。

首次登录可能停在 `/home?aavid=...`；它只允许按唯一精确 advertiser 发现专用连接，不授予文件动作。新任务链接由共享 `accountPageUrl` 强制带 `#umg=1` 进入推商品，再由原 page contract 核验可见账号及计划 ID。启动专用窗口及创建新上传 tab 时最大化所在窗口，避免千川响应式布局隐藏账号核验区；最大化失败在文件动作前停止。原页只读恢复不调整窗口或重开 tab，已有 fence、冻结目标及确认边界保持。

Parent Self-Review：已在首次登录的真实窗口复现错误默认进入推直播间、窄窗口隐藏账号区；只修正路由及新任务布局，不采用隐藏 ID 或 URL 替代可见页面归属证明。`/home` 发现仍限定官方 origin、唯一精确 aavid 和唯一浏览器。

## Current Production Scope Amendment (2026-10-01)

用户明确要求 CDP 上传只管理本次生成的一批，之前生成的任务不再处理。本修订覆盖下文历史账号阻塞和全局暂停的跨制作含义；同一制作范围内的暂停、九条分组、原页只读恢复及永久防重传仍有效。

可信主进程在单项目制作、手动导出、追加制作和跨模板整批开始前切换上传范围，先排空旧控制与浏览器操作，再撤销旧的运行内资格。本轮各项预检产生的 pageBatchId 都加入同一范围，同授权的多个导出 chunk 不切换范围。旧 UNKNOWN、失败和 PENDING 不阻塞本轮新字节，也不因切换被删除、结束、改写或重传；迟到旧完成通知和启动恢复扫描不读取旧媒体或补发历史上传。本轮结果页只展示本轮任务。重启不恢复运行范围或连接浏览器；旧授权不能因重新注册而获得本轮资格。

范围仅为运行内调度权限，不修改 ledger 格式、原 task identity 或永久 fence。全部历史仍参与同目标/hash 防重传；命中旧 UNKNOWN 的同字节仅形成无文件动作的去重结果，并暂停本轮。当前范围内一组未全 READY 仍停止后续上传，只有本轮任务可以明确继续。切换排空失败时拒绝开始新的范围。用户未授权本轮处置或重新上传任何真实历史媒体，也不要求完成原五店历史验收。

Parent Self-Review：预检是主进程已有授权 owner，pageBatchId 独立于队列 chunk；由可信开始入口划定整次制作范围可覆盖跨模板多个授权，避免以时间或最后一个 chunk 猜测范围。旧结果与 hash/fence 继续由原 store 独占，范围切换不证明平台 outcome。

将简辑现有“正式导出完成 → 独立上传任务”接入巨量千川全域投放。用户每次制作明确选择一个产品账号；程序读取本机账号配置，冻结对应 CDP、广告账户和已有计划，逐条上传本次正式 MP4，在网页“确定”前停止，由用户在 Chrome 中决定是否确认。

本修订取代本文 0.1 的单账号创作者中心自动发布目标。原版本及其离线实现证据保留在 Git 历史和 [旧实现记录](douyin-upload-page-contract.md)，不将已通过的旧测试等同于千川接入。当前已完成六账号各一条的人工 CDP 上传测试，见 [Live Evidence](qianchuan-cdp-test.md)；制作界面的千川账号选择及生产上传尚未实现。

当前用户授权编写 spec 与 plan。本修订为待审阅合同，本轮不修改代码、启动浏览器、上传或提交素材；批准文档也不授权自动点击“确定”。

# 1. Goal And Scope

目标使用流程：

1. 用户按现有逻辑选择素材、手动填写展示文字、设置包装与 MP4 导出。
2. 在制作或追加制作入口开启“完成后上传千川”，从六个产品中明确选择一个账号。开关默认关闭，账号默认不选，不从素材路径、展示文字、项目名或历史选择推测。
3. 本次正式 ExportTask 完成并成功保存后，自动上传至冻结账号的已有计划。未完成、失败或未授权任务不上传。
4. 结果页分别展示“导出已完成”和“上传完成，待在 Chrome 确认”。用户在该任务浏览器页面自行确认；程序不点击“确定”，也不宣称已提交、审核通过或开始投放。

本轮支持现有普通制作、手动导出与追加制作，以及已支持的审核样片转正式产物完成通知。assisted 审阅 prepare/approve 的上传选项仍明确拒绝，不扩大其支持范围。每次追加属于新授权，不能继承原批次账号或上传许可。

2026-09-29 用户授权扩展到跨模板批量制作：每个模板独立开启上传并明确选择一个产品账号，默认关闭且不猜账号。整批冻结模板时预检各项账号、MP4 与精确条数，主进程授权只保留在运行内存及原上传 ledger，不写入可分享项目；无有效上传预检的项在模型或导出前失败。各项经原 AgentController 注册正式 task intent，仍由现有完成通知和单一上传 service 执行；没有选择的项只导出。映射改变不把等待项转到新计划，原 intent、页面归属、九条分组及永久 fence 不变。批量结果详情只读投影该项 task 的上传状态，区分导出完成与待 Chrome 确认；不新增跨项目上传操作权限。取消批量或该项时停止该项尚未完成的上传，保留已 ready 记录和全部 fence；制作失败不改变现有上传失败后的全局暂停，不能自动切账号继续上传。旧批量记录缺上传字段时按未授权解释，重启零自动连接、零重新制作。

# 2. Non-goals

- 自动提交素材到计划、自动发布抖音作品、新建/编辑计划、修改预算/出价/ROI、启动/暂停投放。
- 自动选账号、切换 Chrome 内登录态、自动选品、挂商品、创建计划或自动运营。
- 自动登录、验证码识别、风控规避、cookie/token 导出、读取 Chrome 数据库。
- 模型操作网页、模型选择账号、生成或改写上传文案；千川流程不消费旧 creator caption。
- 私有 API、网页内部接口、直接网络上传、生产 CLI/HTTP/MCP 上传入口。
- 新导出队列、第二个上传生命周期、通用多平台 adapter registry、跨机器 exactly-once。
- 改变 FFmpeg、模板、贴纸、覆盖、展示文字、成片内容或本地随机无需模型的性质。
- 永久修改 Chrome launcher、自动启动/关闭 Chrome、动态给运行中的 Chrome 加 CDP。

# 3. Current Evidence And Canonical Owners

| Concern | Current owner and evidence | Integration decision |
| --- | --- | --- |
| 正式完成事实 | `src/main/queue.ts` 的 `onFinalArtifactCommitted`，两条正式完成路径在 completed save 后通知 | 保留原通知及失败隔离，不创建新扫描器 |
| 批次授权 | `src/main/index.ts`、`src/main/agent-controller.ts` 注册 `DouyinUploadService.registerBatch` | 复用已有 seam，冻结此次选中的账号 |
| 准入与执行 | `src/main/douyin-upload-service.ts`：重读 JobStore、最终文件 hash、私有快照、单 runner | 保留单一 owner，改为 upload-only；旧 execute 中 fill/publish/accept 不适用于新任务 |
| 独立记录 | `src/main/douyin-upload-store.ts`：v1 state、creator submit markers、identity 与跨 job hash 去重 | 显式 v2 兼容与隔离，不自动给旧任务分配账号 |
| 浏览器 | `src/main/douyin-cdp-uploader.ts`：Playwright CDP、loopback relay、production contract 为空 | 复用连接/停止边界；千川页面语义由单独有限页面合同负责 |
| UI / IPC | `DouyinUploadControls.tsx`、`DouyinUploadPanel.tsx`、preload / desktop | 在现有入口替换 creator 发布文案，显示账号及待确认状态 |
| 账号测试工具 | `scripts/qianchuan-account-config.mjs`，本机人工配置已填写 | 现有脚本只打开/核对页面，不是桌面生产上传器 |
| 真实证据 | 六个账号的人工上传均停在“确定”前 | 支持界定外部边界；不证明 Playwright 生产 adapter、整批容量或重启恢复 |

CodeGraph 已查询 service 的 entity 和 execute 关系，实际源代码确认其仍会 markSubmitting → publish → verify → accept。图中的同名推断关系不作为事实。实施必须在当时 working tree 重新核对；当前存在无关代码改动，不允许用旧 baseline 覆盖它们。

# 4. Account Configuration Contract

2026-09-29 用户明确修订为软件内账号设置：用户点选产品并粘贴千川计划链接，程序识别账户和计划，明确保存后供以后制作选择。产品更换时允许修改显示名称，保留原 Chrome 绑定。六产品枚举作为稳定账号槽位保持现状，新增可选 `productName` 只描述用户填写的显示名称，不根据名称、链接顺序、当前页面或模型重新分配账号。旧六账号 JSON 仍可原样一次性导入，不再要求用户日常编辑外部文件。

- 导入文件仍必须恰有六项；软件内私有设置可按产品逐项添加，最多六项。两者复用产品、CDP 端口、非空 advertiserId 唯一性和 strict 字段校验；缺少完整配置的产品不可选择上传。
- 计划链接仅接受 `https://qianchuan.jinritemai.com/uni-prom`，拒绝用户信息、其他 origin/path、重复 `aavid` / `adId`、空值及非法 ID。从 query 中各取唯一的十进制字符串，不经 Number 转换；其余 query/fragment 不保存、不导航、不作为操作授权。
- 链接不包含浏览器登录或 CDP 绑定，但端口属于程序连接细节，用户不填写。已有产品且账户未变时保留原绑定；首次设置或更换账户时，主进程只读识别当前用户正在运行的 Chrome/Chromium 主进程的调试参数，必要时读取该进程指定目录的有限 DevToolsActivePort 元数据，再从 loopback 调试端点的有限 tab URL 列表定位唯一匹配的 aavid。零匹配或多个浏览器匹配时拒绝保存并提示打开对应账户的计划或关闭重复窗口后重新识别；无调试能力时明确报告浏览器连接不可用，不伪称普通 Chrome 可附加连接。软件不扫描固定端口范围、不读登录数据、不猜 profile、不登录、启动或重启 Chrome。URL 匹配只建立候选连接，正式上传仍须可见双 ID 及页面归属核验。
- 软件内 mapping 由 `QianchuanAccountSettings` 独占，保存在 userData 下的私有上传目录；原 reader 继续负责有限读取、普通文件/当前用户/0600 或更严格/symlink 检查及 digest。Windows 未通过权限/持久化验证时上传保持阻断。
- 新安装不扫描磁盘、不消费账号环境变量。已授权外部路径在软件内 mapping 不存在时沿原 reader 读取并导入；软件内设置存在时优先使用它，损坏或已保存文件丢失时阻断，不回退外部文件。导入不改原文件；修改只写软件内 mapping。保存采用独占 writer lock、私有临时文件、fsync、原子替换和目录同步，结果不确定时阻断后续配置使用；不自动清除残留 lock。
- 账号保存入口为 trusted main IPC 的 strict `{ product, planUrl, productName? }`，拒绝端口、任意 path、endpoint、独立 ID 或额外字段。`productName` 由共享 schema 去首尾空白、限制 1–40 字符并拒绝控制字符；各槽位的有效显示名称（未设置时沿用默认名称）不得重复。省略该字段的旧调用保留已存名称。设置按钮、制作及批量账号下拉框和高级账号摘要显示有效名称，但提交稳定 `product` 值。仅改名保留原链接及 `cdpEndpoint / advertiserId / adId`，不探测 Chrome；已有冻结目标和上传账本不改写。renderer 显示识别预览，main 独立重新解析并识别连接后保存；界面不提供端口输入。连接探测限当前用户的运行进程、loopback、请求数量、响应大小和 deadline，拒绝重定向；不返回 profile、凭据、内部路径或原长 URL。该入口只维护设置，不授权上传。
- 制作入口仍只提交产品枚举；设置、制作预检和 intent 准入均读取当前私有映射。冻结 `product / cdpEndpoint / advertiserId / adId` 与内容 digest；预检到 intent 之间变化则上传初始化失败，同批消费同一份主进程快照。已注册的旧批次仍使用旧冻结目标，不被新计划重定向。
- 共享 schema 与 URL 解析由 `src/shared/qianchuan-account.ts` 独占；`qianchuan-account-config.ts` 负责安全读取，`qianchuan-account-settings.ts` 负责内部持久化和一次性导入。原诊断 CLI 的六项导入格式不变，不成为桌面 runtime dependency。全局与每批上传默认关闭、显式选择、永久 fence、UNKNOWN 零重传及停在确定前均不变。

# 5. Selection And Final Artifact Contract

沿用制作请求字段 `douyinUpload` 以减少调用面变更，新语义为 strict `{ enabled: true, accountProduct: <六产品之一> }`。没有字段表示不上传；旧 `{ enabled: true, caption? }` 不能被静默解释成千川许可，明确拒绝并提示重新选择。所选账号没有两个 ID 时在制作/追加请求入口拒绝上传选项，且在模型调用或入队前停止。

每批只有一个冻结目标，全部版本一致；制作提交、切项目或关闭开关后清空本次选择，追加独立选择。不让账号或配置进入模型 prompt、可分享项目和 assisted requestJson。

正式文件准入复用原 service：精确 intent 对应 project/batch/task，completed 的 JobStore.save 成功返回；OutputArtifact task/path/size 与记录一致，路径位于正式输出目录，非空可读普通 MP4；计算最终字节 SHA-256，再复制到私有快照并验证一致。MOV/MKV 明确不支持，不自动转码。实际碰撞后路径为准，不猜预分配文件名。

普通制作与审核样片转正式产物复用既有完成 seam；预览、partial、proof、未选中历史产物、目录扫描和进度 100% 不构成触发。intent 失败不执行浏览器，导出继续且显示上传初始化失败；完成通知/上传错误不改变导出 completed、不重渲染、不占 FFmpeg slot。

# 6. Browser And Batch Contract

允许的页面仅为 `https://qianchuan.jinritemai.com/uni-prom`。由主进程以冻结 ID 构建 aavid/adId 参数，不使用用户提供的自由 URL。不放宽旧 creator allowlist 让千川页面进入 creator publish 链。

连接用户已启动的对应 Chrome/default context，在每个批次建立并拥有一个专用 tab。同批每条视频串行加入同一个指定计划的上传弹窗；不同批次不复用彼此 tab，不覆盖用户既有草稿。全局单 runner，不新建每账号并行队列；FFmpeg 并发保持独立。

进入上传前、每次传文件前和 ready 判定时，核对可见广告账户 ID、计划 ID、对应任务 tab 与目标页面；URL 参数本身不够。无法唯一证明、账户关停/登录失效/挑战、计划不可用或结构变化则停止，绝不选择其他账户/计划补救。

有限页面操作：计划详情的“素材” → “添加视频” → “上传视频” → 唯一文件控件。定位必须限制在本批拥有的 drawer/modal 中，按 role/label/可见语义/stable attribute 唯一匹配；不使用动态 UID、坐标或 `.first()` 消除歧义。每次传文件前必须证明该页面有独立“确定”边界，选文件不会直接提交到计划。

读取剩余可添加数量，在首次选文件前与本批冻结的全部待上传 task 数量核对；不足则停止整个批次并提示人工处理，不能截断条数、自动提交腾位置或另建计划。同批文件列表须与已记录任务对应；同名碰撞无法区分时停止，不依据旧素材 ID/审核状态推断新上传。用户提前确认、取消或编辑弹窗导致归属失效时，停止本批剩余动作。

默认独立 deadline：连接 10 秒、导航 45 秒、文件控件/选文件 30 秒、处理 ready 30 分钟、其他固定页面动作 15 秒、恢复只读核查 120 秒。取消或超时停止旧操作，迟到 Promise 不能继续选文件/点击。登录/挑战由人工处理。保留 Chrome/default context/任务 tab，应用退出只 detach，不关闭、杀进程或删除页面。

# 7. State And Ready Evidence

新任务状态：

```text
PENDING → CONNECTING_BROWSER → OPENING_UPLOAD_PAGE → UPLOADING
        → WAITING_UPLOAD_COMPLETE → WAITING_FOR_CONFIRMATION
任何阶段 → NEEDS_HUMAN / FAILED_RETRYABLE / FAILED_TERMINAL / CANCELLED
```

`WAITING_FOR_CONFIRMATION` 表示自动工作已停止，属于本轮上传终点；不进入 SUBMITTING / VERIFYING / SUCCEEDED，不填写 creator caption，不创建 creator submit marker，不调用 publish/confirm API。即使用户手动确认，程序也不自动记录“平台已接受”，本轮不跟踪人工投放结果。

ready 必须同时满足：

- 任务拥有的批次 tab、可见账户与计划均匹配。
- 原本空的新上传弹窗中，出现与本次文件选择关联的精确文件项；列表与本批已选任务数量一致，无不属于本批的条目。
- 对应传输/平台处理已结束，页面明确可确认，唯一“确定”按钮可用，无失败/拒绝/取消上传进度；100% 或 setInputFiles 返回不能单独通过。
- 当前快照 hash 与冻结字节一致；有限 evidence 和观察时间保存成功。

保存 `readyEvidence { advertiserId, adId, fileName, selectedCount, observedAt, pageOwnership }`，以及 `upload_outcome: NOT_SELECTED / MAY_HAVE_UPLOADED / READY`。`pageOwnership` 是本地有限 browser target/tab 归属记录，不含 token/原始 WS URL。不得从“无错误”推出 ready；按钮只观察、不点击。ready 记录是当时页面事实，不能保证关闭浏览器后草稿存在。

# 8. Idempotency, Recovery And Migration

新 task identity 为 SHA256(canonical JSON `{schema:"jianji-qianchuan-upload/2", project_id,batch_id,export_task_id,artifact_sha256,advertiserId,adId}`)。intent key 仍以正式 task 身份锁定一次目标；重复同 task 不允许换账号/计划/hash。配置冻结 digest 含 endpoint/产品等字段，但连接端口不成为新发布身份。

同目标 advertiserId + adId + hash 的已开始选择或 ready 记录跨 job 去重；同字节不同目标不共享成功/失败证据，只有新批次显式选定新目标才可上传。不自动多账号分发，也不把同名/同字节去重当作平台接受证明。

选文件也是外部副作用。在调用 file input/chooser 前，以 exclusive create + 文件/目录 sync 写不可覆盖的 upload-selection fence，绑定 v2 task、目标、hash、冻结 digest 和 attempt。写失败零文件选择。它表示“可能已上传”，不表示“已提交”；不能复用旧 creator submit marker 的语义。

fence 后断线、崩溃、timeout、取消或 ready 保存失败，只能对原批次页面做有界只读核查，禁止自动重新选文件、新开弹窗重传、删除列表项或清除 fence。无法证明原页面关联则 NEEDS_HUMAN(UPLOAD_OUTCOME_UNKNOWN)。页面/草稿丢失并不证明平台没有收到文件。fence 前已确认未选文件的连接/导航失败可标 FAILED_RETRYABLE，但本轮无自动 retry；用户显式继续仅增加一次有限 attempt。

启动只载入/补齐已授权本地 task，不连接 Chrome。新任务完成不能唤醒重启留下的旧 pending。WAITING_FOR_CONFIRMATION 重复通知保持原记录，不重传；显式“核查页面”只读更新当时 ready 证据，丢失则人工处理。同批未知、挑战或身份失配阻断本批及该账号后续任务；其他账号需用户明确继续，不能在失败后自动切账号绕过。

用户明确删除整个旧上传批次时，主进程可将完整且未在执行的批次标为不可逆的 `DISCARDED`，从界面任务列表和待处理计数中移除，解除该批次的人工处理阻塞。所有原 intent/task、目标、快照身份、上传结果、失败诊断和 selection fence 保留；结果未知仍为 `MAY_HAVE_UPLOADED`，不得宣称未上传或成功。同账户/计划下的同 hash 防重传继续有效。删除前保存不可覆盖、已同步的原批次审计，再由唯一 store owner 原子提交整批状态；任何不确定写入均停用上传。仅允许已经完整准入、无 READY 或正在运行任务的批次；删除不依赖浏览器、账号当前映射或文件是否仍存在，不产生新选文件权限，不删除本地视频，不自动启动其他任务。重启保留删除状态，旧任务不得恢复、改传或再次选文件。

### Explicit Local Batch Closure

用户明确确认“结束本批本地上传”时，允许完整、非运行、未处置且无成员 alias 的 READY/UNKNOWN/未选混合批次结束。此操作不可恢复，全部未选成员也永久失去本批上传资格；原 result/outcome、READY 证据、failure、attempt/retry、冻结输入和目标、快照及 fence 保持不变，不表示平台接受或拒绝。部分准入、成员/目标/项目不一致、重复结束、DISCARDED 批次及并发上传/控制冲突拒绝。关闭不依赖当前 mapping 或浏览器，不启动或继续其他批次。

唯一 store 的 v3 state 增加 strict `closedBatches`，绑定 store 重读的 projectId/pageBatchId/advertiserId/adId/expectedCount、排序完整 taskIds、原整批 intents/tasks 归档的 archiveSha256 和 closedAt。`batch-closure-history/<pageBatchId>.json` 私有独占归档经文件及目录 sync、control generation 复查后，才原子提交 closure。引用缺失或不一致、未知版本及写入/同步不确定均 STORE_UNAVAILABLE；孤立归档不自动重放。已结束任务加载时跳过恢复改写，所有更新、选文件、继续、改传、删除和准入回填入口均不得激活。活动阻塞/调度排除 closed，但永久 duplicate/sameTargetBytes/fence 检查遍历全部历史；别批引用 closed 原任务的 alias 保留原证据且没有新选择权。

可信 `closeDouyinUploadBatch(projectId, uploadTaskId)` 只接受当前项目任务锚点，renderer 不提交成员列表或 hash。UI 在确认前显示项目、账号、冻结计划、pageBatchId、完整总数及 READY/UNKNOWN/未选分布，说明未选成员也终结、视频和历史保留、平台结果不变。普通与批量详情分别展示活跃任务和只读结束历史。继续 IPC 返回准入接收或拒绝，不等待上传完成；接收不是 READY。

Parent Self-Review：以上窄修订沿用单一 store/service/queue，不放宽 DISCARDED/READY schema，不授予真实批次处置、新制作、重传或发布权限。实施与验收顺序见 [Recovery and Live Acceptance Plan](superpowers/plans/2026-09-30-qianchuan-recovery-and-live-acceptance.md)。

仍由 `DouyinUploadStore` 一个 ledger owner 管理，state 升为 v3，task identity/fence 仍为 v2：
- 新 state 保存千川 settings/intents/tasks/selection fences 的引用，默认 enabled=false。
- v2 严格验证后以空 `closedBatches` 升级 v3，原任务、授权和 fence 不变，启动零浏览器操作。v1 首次加载先严格验证旧 state 和全部 creator markers，保存不可覆盖、相同原字节的 `legacy-v1.json`，再原子保存 v3。旧 marker 目录和旧记录保留；步骤不确定、旧记录损坏/冲突/孤立 marker、未知版本则阻断，不能清空后继续。
- v1 内容仅作为 legacy 只读记录，不重新编号、不转成千川任务、不运行旧 pending、不把旧 SUCCEEDED 转成待确认。不消费旧全局开启或 caption 作为新授权。
- 不做通用 migration framework，不创建第二套 service/store/queue。旧 creator adapter 生产仍阻断，新运行路径只选择有限千川合同。
- POSIX 私有目录 0700、状态/fence 0600、快照 0400；不能证明权限及目录 durability 的平台阻断。v2 程序不能读取 v3；回滚代码须继续兼容 v3，保留全部 closure 和新旧 fence。新处置/入账/选择后不得恢复旧 ledger；只有无新数据且逐项相同才可完整恢复数据，不能自动恢复 backup 授权重传。

# 9. Public Surface And Safety

全局设置：enabled 默认 false、主进程持有软件内 mapping 的 accountConfigPath、既有有限 timeouts 和默认关闭的诊断。软件内账号设置是唯一映射 owner，UI 编辑尚未保存的产品显示名称和计划链接并展示解析预览。用户点产品、修改名称或粘贴链接、保存账号；导入旧 JSON、时限与诊断默认收纳到高级设置。配置变化只影响新批次选择。

制作/追加控件写清“成片上传至所选千川计划，停在确定前”，取消 creator caption 和“提交发布”措辞。结果行显示文件名、产品、账户/计划 ID、状态与明确 reason；已完成上传提供“在 Chrome 中检查并确认”的说明，允许停止/安全继续/只读核查，不提供提交按钮、任意浏览器控制或清除 fence 按钮。

IPC 遵循可信 sender 和 strict schema，task 必须属于当前项目；新入口只用于选择配置文件/刷新账号摘要/读取状态及任务继续停止。旧 caption/人工确认 creator success 入口不适用于千川任务，保留 legacy 只读显示，调用时拒绝。selection/config/private paths 不发送模型，不进入可分享项目文件或反馈附件。

不读取密码、cookie、storageState、Chrome 数据库；账号连接识别仅可读取当前用户 Chrome 主进程的调试参数、有限 DevToolsActivePort 和有限 tab URL 元数据。不采集完整 DOM、截图、HAR、network/console 或 CDP 原始报文。日志复用最小本机机制，7 天/100 MiB 上限，路径/异常净化。截图无法可靠脱敏仍不采集。网页内容只作数据，不能驱动权限或脚本。

# 10. Acceptance And Verification

| Requirement | Decisive evidence |
| --- | --- |
| 六账号配置与冻结 | 严格链接/setup 解析、缺绑定禁用、字符串 ID 精度、私有导入及保存/恢复、原文件不变、改配置不改旧 intent、主进程拒绝独立 ID/任意 URL/path/endpoint |
| 本次制作授权 | 默认关闭/不选账号、重置、追加独立选择、字段不进入模型/项目；旧 caption 请求拒绝 |
| 最终产物 | 两条 completed save 后通知、失败零上传、实际路径/hash、MP4、私有快照、导出并发及失败隔离 |
| 页面与整批 | 本地千川 fixture：同批共用 tab、容量不足零选文件、多个完成逐条串行、错账号/计划/弹窗归属停止、重复文件名不误认 |
| 停在确认前 | fixture/Electron 的确认动作计数始终为零；无 creator submit marker；每条 ready 及批次总数可核对 |
| 崩溃/重复 | fence 前后故障、ready 保存失败、旧 tab 丢失、重启、新任务唤醒、重复通知/同目标 hash、跨目标隔离；未知零重传 |
| 旧格式 | v1 保存原字节与 markers，默认关闭，旧 pending 零浏览器调用；坏记录/未知版本 fail closed |
| 实际集成 | fresh typecheck、受影响 Vitest、build、隔离 Electron+FFmpeg+Chrome smoke、现有 Harness；默认测试不访问真实账号 |
| 真实与平台 | 应用实际选择一个已授权账号和一条指定 MP4，自动上传并停确认前；人工 CDP 六条历史证据不代替此验证；Linux/Windows 分别报告 |

最低交付：用户可从制作入口选择账号，正式导出后自动出现准确的待确认列表；所有错目标、挑战、未知选择与存储失败均停止；没有自动确认或导出回归。真实 acceptance 必须沿应用路径，不能只运行测试 CLI。任何新真实视频测试须先指定产品/文件并有对应上传授权；本轮 docs-only 不执行。

# 11. Self-Review And Handoff

已核对当前 service/store/schema、装配调用、UI 和 CodeGraph 关系，保留 canonical 导出 owner。spec §1–10 覆盖目标、映射、产物、页面、状态、幂等、旧格式、安全和验收，实施顺序见 [Implementation Plan](superpowers/plans/2026-09-27-douyin-auto-upload.md)。

受管 Kimi deep 只读源码梳理 receipt：`48199a29-4206-474d-a210-c6f893068b1a`，qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`；核对四个 source Read 的 hash 与当前字节一致。Parent 确认旧 creator origin/成功 schema、v1 identity 与全局 hash 去重、publish 调用链不适用于新目标，已在 §3、§7–8 修订；单 owner 装配另由当前 index 调用核对。其余问题由本合同明确决定：本轮不支持 creator/千川双平台自动路由、新状态独立于 SUCCEEDED、沿用一个 ledger。该调查不是 spec/plan 独立审查或 implementation acceptance；本轮由 Parent 完成 Self-Review，不额外启动 reviewer。仓库没有专用 session-record/capture skill，此处记录文档 checkpoint，不写全局 memory。

本次仅交付可审阅文档。实际生产 adapter 的语义定位、整批容量、可靠 page ownership 恢复及 Windows durability 仍须实施验证；失败保持阻断，不以现有人工 CDP 证据填补。旧页面实现记录继续描述旧 checkpoint，不是本修订的验收报告。
