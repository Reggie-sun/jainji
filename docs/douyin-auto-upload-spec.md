---
title: Jianji Douyin Automatic Upload MVP
status: proposed
implementation: not_started
version: 0.1
date: 2026-09-27
source_baseline: 2f0f3b6b6023ac5d82b6e90ae8c67371e313504c
---

# Summary

简辑完成一条正式导出并持久化其最终产物后，将该文件交给独立 uploader，通过 Playwright `chromium.connectOverCDP()` 连接本机已启动、已人工登录抖音创作者后台的 Chrome，上传、填写用户指定的必要字段、提交发布并返回结构化结果。

MVP 只有一个 Chrome profile、一个当前登录账号和一个串行上传执行器。原有 FFmpeg 导出队列继续独立并发。登录与验证码由人工处理；提交结果不明时停止，禁止重新发布。本文是 **proposed spec**，不表示功能、页面定位或真实发布已实现、获准实施或验收。本轮只编写 spec，不创建 implementation plan、不安装依赖、不连接用户浏览器、不上传视频。

# 1. Goal

用户对本次制作明确开启“完成后自动上传抖音”后，每个被选中的正式导出满足简辑既有完成条件时，都能自动进入上传流程。输入是已经验证并发布到最终路径的视频字节；输出是持久化的上传状态、成功证据或明确的失败/人工介入原因。

“自动上传”在本文包括网页上传和提交发布；`SUCCEEDED` 表示后台已接受该次发布，允许处于平台审核中，不保证审核通过、公开可见、流量或商业结果。未开启时不产生浏览器、上传或发布副作用。

# 2. Non-goals

- 多账号、多店铺、账号切换与调度。
- 巨量千川、自动投流、自动投放及广告预算。
- AI 浏览器 Agent、LLM/VLM 页面理解、模型决策和验证码识别。
- API 上传、私有接口逆向、直接调用网页内部上传/发布接口。
- 自动登录、保存账号密码、自动处理验证码、规避平台风控。
- 自动生成标题/文案、从视频或展示文字推测文案、自动选品、自动挂商品。
- 修改视频生成、贴纸、覆盖、展示文字、剪辑、编译或渲染逻辑。
- 分布式任务队列、通用 workflow engine、复杂 adapter framework、跨机器 exactly-once。
- 定时发布、自动挑选封面、批量运营策略及发布后运营监控。

# 3. Repository Evidence And Reuse

按 `src/main/`、`src/shared/`、`src/renderer/`、`src/harness/`、`scripts/`、`tests/`、`package.json`、README 和 AGENTS.md 做仓库范围盘点；深入核对以下实际完成路径。没有将其他项目的 pipeline 或 Production 合同引入简辑。

| Concern | Current implementation | MVP consequence |
| --- | --- | --- |
| 应用与装配 | [package.json](../package.json)、[index.ts](../src/main/index.ts)：Electron + Node/TypeScript；`requestSingleInstanceLock()`；装配 `ExportQueue`、`ApplicationService`、IPC | uploader 位于主进程，复用单实例和可信 IPC；不增加 Python sidecar 或生产 CLI |
| 正式导出 | [queue.ts](../src/main/queue.ts) `ExportQueue.execute()`：`validating → running → verifying → completed` | 挂在最终 `completed` 的 durable boundary，不能挂在制作模型返回或 render progress 上 |
| 样片成为正式产物 | 同文件 `publishApprovedSample()` 复制已审核样片、验证并发布为一个正式 ExportTask；`executePreview()` 仅生成缓存预览 | 前者纳入同一最终产物准入；后者永不直接上传 |
| 最终路径 | [paths.ts](../src/main/paths.ts) `allocateOutputPath()` 分配 `<源文件名>_edited[_序号].<container>`；queue 中 `publishWithoutReplacement()` 遇到碰撞可再分配 | 以成功任务实际 `outputArtifact.path` 为准，不推导固定 `final.mp4` 或使用预分配路径 |
| 文件验证 | [artifact.ts](../src/main/artifact.ts) `ArtifactVerifier.verify()` 验证非空文件、视频轨道、尺寸与有效时长 | 保留现有验证；这不证明抖音准入、内容合规或观看质量 |
| 状态与身份 | [domain.ts](../src/main/domain.ts) `ExportBatch`、`ExportTask`、`OutputArtifact`；artifact 有 taskId/path/sizeBytes/durationMs/createdAt，当前没有输出 hash | 复用 project/batch/task 身份；新增上传合同的 hash，不把源素材指纹当最终视频 hash |
| 持久化 | [store.ts](../src/main/store.ts) `atomicWriteJson()`；`JobStore.save()`；queue `transition()` 等待 `persist()`；`ApplicationService.syncQueue()` 是项目副本同步 | JobStore 的成功落盘是导出依据；项目副本或 renderer 通知不是上传授权 |
| 恢复与重试 | queue `recover()` 把未完成任务标为 `interrupted`，不自动重渲染；`retry()` 复用 task ID、增加 attempt、重新分配路径；`hydrate()` 检查历史文件 | 上传有独立恢复规则，不能把导出 retry 解释为再次发布 |
| Browser/CDP | `scripts/template-preview-smoke.mjs`、`scripts/desktop-smoke.mjs` 等使用独立 profile 和原生 CDP/WebSocket 验证本地页面 | 可复用隔离 fixture、超时及诊断思路；这些是测试脚本，不是生产浏览器服务 |
| Playwright/抖音 | 当前 package、生产源码和测试中没有 Playwright uploader、`connectOverCDP()` 或抖音发布实现 | 实施时采用 Node `playwright-core`，固定验证过的版本；无需下载或启动另一套 Chromium |
| 错误与可观测性 | [errors.ts](../src/main/errors.ts) `JianjiError` 携带 code/stage/retryable；已有 classifier 有字符串回退；没有通用 uploader 日志系统 | 延续 typed errors 风格；新流程必须按 typed failure 和提交标记判断，不能复用字符串回退决定发布安全 |
| 外部副作用记录先例 | [bug-feedback.ts](../src/main/bug-feedback.ts) 用本地记录、串行执行、成功回执和明确 resume | 复用机制与 `atomicWriteJson`，不复用 GitHub relay、transport 或其重试授权 |
| Tests/Harness | [queue.test.ts](../tests/queue.test.ts)、[store.test.ts](../tests/store.test.ts)、[ffmpeg.integration.test.ts](../tests/ffmpeg.integration.test.ts)、[policy](../.agent/harness/policy.json)、[Harness Spec](video-validation-harness-spec.md) | 沿用 Vitest、依赖注入和本地 fixture；Harness 不连接真实账号或发布视频 |

CodeGraph 查询了 `ExportQueue.execute` 和 `ExportQueue.publishApprovedSample` 的关系；同名推断产生的关系仍以源码 import/callsite 核对，不能据其误匹配发明依赖。上传不依赖 MCP，已有产品 Agent 的禁用工具和会话边界保持有效。

# 4. Trigger Boundary

## Final Artifact Admission

正式触发必须同时满足：

1. 有本次制作冻结的 upload intent，精确列出 `project_id / batch_id / export_task_id`；用户开启全局能力不等于授权全部历史成片。
2. ExportTask 已完成 FFmpeg/样片复制、`ArtifactVerifier.verify()`、最终不覆盖发布，且 `transition(..., "completed")` 的 `JobStore.save()` **已经成功返回**。
3. `task.status === "completed"`，`task.outputArtifact.taskId === task.id`，`task.outputPath === task.outputArtifact.path`，路径属于该批次正式输出目录。
4. 主进程重开最终文件，确认是可读非空普通文件，size 与 artifact 一致，并计算全文件 SHA-256。MVP 只自动接受 MP4；MOV/MKV 上传明确报 `UNSUPPORTED_FORMAT`，提示选择 MP4，不能偷偷转码或改 preset。
5. 上传身份不存在已成功或可能已提交的同一任务/同字节记录。

此边界产生 durable `UploadTask(PENDING)`，然后唤醒单个本地执行器。上传 admission/浏览器错误不得传播到已完成导出的 render catch，也不得把 ExportTask 改为 `failed`、触发重渲染或占用 render slot。

## Integration Of Both Completion Paths

- 普通制作/手动导出/追加制作：在既有 `createBatch()` 成功后、`queue.start()` 前，由调用方注册此次明确选中的 task IDs 和冻结上传字段。
- `publishApprovedSample()`：任务在方法内部创建并立即执行。实施需要一个窄的 task-created 通知，位于任务已保存、复制/正式发布前，让装配层注册同样的 intent；不可仅在该方法返回后才保存 intent。
- 两条正式完成路径都在 completed 持久化成功之后发出同一 `FinalArtifactCommitted` 通知。queue 只报告自己已保存的事实；uploader service 再独立准入。通知的错误单独处理，不能进入导出失败逻辑。
- 上传 intent 保存失败时，导出可继续，上传明确显示初始化失败且不执行浏览器副作用；不以“自动上传已开启”冒充 intent 已保存。

不得扫描目录、按文件名猜最终产物，或依据 `progress=1`、`AgentRun` 已准备/入队、批次整体状态、预览文件、FFmpeg exit 0、UI 通知触发。每条正式视频独立触发，不等待整批完成。

## Missed Notification And Restart

通知是唤醒信号，durable export/task/intents 才是依据。进程崩溃造成“completed 已保存，UploadTask 尚未创建”时，启动只读对照已冻结 intent 与 `JobStore`，补齐同一 deterministic identity 的本地 PENDING task；不回填未选中的历史产物。

启动不自动操作浏览器或提交发布。用户明确恢复后才执行尚未提交的任务；已有提交标记的任务只能走只读核查。关闭自动上传停止后续副作用，不删除历史去重或提交记录。

# 5. Input Contract

使用新的 strict Zod schema，与 renderer 请求和主进程内部的最终文件绑定分开；以下命名是 proposed uploader DTO，不要求把现有 camelCase 模型改成 snake_case。

| Field | Required in MVP | Source and rule |
| --- | --- | --- |
| `project_id` | 是 | 当前导出项目 UUID；拒绝跨项目 caller |
| `batch_id` | 是 | 既有 ExportBatch.id，作为当前 job identity；不再新增一套 job id |
| `export_task_id` | 是 | 既有 ExportTask.id；export attempt 不是新发布身份 |
| `video_path` | 是，主进程填写 | completed artifact 的绝对最终路径；renderer 不得提交任意文件路径 |
| `artifact_sha256` | 是，主进程计算 | 最终输出的全文件 SHA-256，统一为 64 位小写 hex；复用 `fingerprintFile()` 时移除其 `sha256:` 前缀 |
| `size_bytes` | 是，主进程测量 | 正整数，与 OutputArtifact 一致 |
| `caption` | 否 | 用户原样输入的单一标题/说明文本；只在页面确有对应字段时按已验证规则填写；不自动生成或截断 |
| `metadata` | 否 | 本地诊断用最多 16 个 scalar key/value、序列化最多 4 KiB；不能传 selector、脚本、URL、商品、账号、凭据或其他动作 |

`upload_task_id` 由服务生成，不由 caller 自选。`title` 不另建并行文案来源；未来只有真实需要不同 title/caption 字段时才扩展 schema。`caption` 可在 intent 创建前为空；若真实后台要求非空，则在上传/提交前返回 `NEEDS_HUMAN(CAPTION_REQUIRED)`，用户补齐后才能继续。不能用文件名、居中展示文字、补充说明或模型输出代填。网页自动预填的文件名不等于用户 caption，应在已验证的字段操作中清空或替换。

上传字段、目标页面配置和视频 identity 在进入执行前冻结。同一 identity 带不同 caption/metadata 重复请求时返回 `INPUT_CONFLICT`；真正需要补齐人工字段时仅允许尚无提交标记的任务显式修订，保留修订记录，不能借修订制造第二个发布任务。

# 6. Browser Contract

前置条件由操作人准备：

- 本机可见 Chrome 已启动，启用指定 `--remote-debugging-port`，监听仅 loopback。
- 使用专用、非默认的 `--user-data-dir`，与日常 Chrome、简辑 Electron userData 和 ChatGPT/Codex 会话目录分离。
- 操作人已在该 profile 手工登录唯一目标抖音账号，并确认当前账号；使用期间不切换账号，不人工编辑 uploader 正在操作的页面。
- 已配置 CDP HTTP endpoint 可达，返回的 WebSocket endpoint 同样为 loopback；不接受远程地址、凭据、可疑跳转或代理隧道。
- 有已侦察验证的抖音上传页面地址及匹配版本的页面合同。页面 origin 固定允许 `https://creator.douyin.com`；实际上传 pathname 待验证，不能将任意 HTTPS 页面配置为上传页。MVP 只支持选文件不会直接发布、具有明确提交步骤的页面；若无法证明这点，在 `setInputFiles` 前拒绝执行，不能先上传来探测是否自动发布。

操作示意（路径由操作人选择，不是程序自动启动行为）：

```text
google-chrome --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/absolute/private/jianji-douyin-chrome
```

Windows 使用本机 chrome.exe 与独立 Windows 绝对路径，同样要求核对监听地址。不能给普通已启动 Chrome 动态添加调试开关；未满足前置条件时返回具体原因，不关闭用户 Chrome 或接管默认 profile。Chrome 136 起默认数据目录不支持上述 remote debugging 开关，必须配合非默认 `--user-data-dir`。[Chrome 官方说明](https://developer.chrome.com/blog/remote-debugging-port)。

uploader 只调用 `connectOverCDP`，使用已有 default browser context，不创建无登录态的新 context。优先复用上次属于本任务的页面；新任务在该 context 建立专用上传 tab，避免覆盖用户有未提交草稿的 tab。没有可信 page ownership 时新开 tab，不从“第一个 page”猜测目标。不启动 Chrome、不读取 profile 文件、不导出/导入 storageState。

单个 uploader 独占这一个页面的自动操作，发布前重验已登录及目标账号未改变的可观察信号。账号信号的读取方法属于 reconnaissance；若无法可靠判断当前目标账号，要求人工确认本次连接，不虚构 account detection。不增加账号注册表。

`NEEDS_HUMAN` 和提交结果未知时保留页面供检查。关闭简辑只解除自动连接，保留 Chrome/profile/用户 tab；禁止 CDP `Browser.close`、关闭已有 context 或杀 Chrome。所选 Playwright 版本的 disconnect/cleanup 行为必须通过 fixture 验证。官方区分 launch 后关闭浏览器与连接后清理/断开，不能将名称相同的 close 操作当成无影响保证。[Playwright Browser](https://playwright.dev/docs/api/class-browser#browser-close)。

# 7. Upload State Machine

```text
PENDING → CONNECTING_BROWSER → OPENING_UPLOAD_PAGE → UPLOADING
        → WAITING_UPLOAD_COMPLETE → SUBMITTING → VERIFYING → SUCCEEDED

任何阶段 → FAILED_RETRYABLE / FAILED_TERMINAL / NEEDS_HUMAN
未提交阶段 → CANCELLED
```

| State | Enter / exit contract |
| --- | --- |
| `PENDING` | 已持久化 intent、最终文件身份和去重结果；尚未操作浏览器 |
| `CONNECTING_BROWSER` | 有界连接 CDP；检查 loopback、context 与已登录前置条件 |
| `OPENING_UPLOAD_PAGE` | 打开/复用任务 tab；页面语义及账号符合已验证合同 |
| `UPLOADING` | 重新核对文件 identity，调用一次 `setInputFiles` 或已验证 file chooser 路径 |
| `WAITING_UPLOAD_COMPLETE` | 等待文件传输与平台处理均 ready，相关媒体与表单可提交；100% 进度不够 |
| `SUBMITTING` | 必需字段和文件已核对；**先 durable 写提交标记，再允许一次发布按钮操作** |
| `VERIFYING` | 仅观察/刷新/打开管理页核实同一个平台内容 ID；禁止再上传或发布 |
| `SUCCEEDED` | 满足第 8 节并持久化 success evidence；重复执行只返回已有结果 |
| `FAILED_RETRYABLE` | 已知未提交且临时连接/网络/导航错误；保持 phase 与 retry count |
| `FAILED_TERMINAL` | 不支持格式、文件被改、输入冲突、确定的后台拒绝等；不自动恢复 |
| `NEEDS_HUMAN` | 登录/验证码/风控、账号或页面不确定、提交结果未知、需要人工字段；明确 reason 与 next action |
| `CANCELLED` | 发布标记前的明确停止；可显式恢复，同一身份与计数保留 |

typed `publish_outcome` 独立于进度状态，至少为 `NOT_SUBMITTED / MAY_HAVE_SUBMITTED / ACCEPTED / REJECTED_KNOWN`。一旦提交标记存在，即使点击抛异常、取消、断线、进程退出或状态 JSON 未及时更新，也不能回到 `NOT_SUBMITTED`。`FAILED_RETRYABLE` 必须同时满足无标记且 `NOT_SUBMITTED`。

人工完成登录/验证后点击“继续”：无提交标记时重新检查页面、文件与字段；有标记时只能恢复 `VERIFYING`。`NEEDS_HUMAN` 不后台轮询验证、不自动完成挑战。遇到涉及该唯一账号的验证/风控或未知结果时暂停其余 pending 任务，避免继续消耗同一账号的发布机会；导出队列继续运行。

# 8. Success Criteria

自动 `SUCCEEDED` 必须具备以下全部可观察证据：

1. 当前任务的受控 tab 出现与本次提交关联的后台接受确认，并能取得稳定、非草稿的 `platform_content_id` 或包含该 ID 的内容详情定位。
2. 通过正常网页导航到创作者作品管理/详情，按同一 ID 重开内容；条目存在且明确处于后台已接受的状态（例如审核中/已发布），不是本地草稿、未完成上传或提交失败。
3. 证据来自本次页面链路，媒体/手工 caption 与任务匹配，记录 content ID、接受状态、净化后的 URL 和观察时间。文件名、标题、时长、缩略图或时间相似不能单独建立身份。
4. success evidence 已通过 UploadStore durable 保存；保存失败保留提交标记并进入未知结果处理，不能报告可安全重试。

本轮未操作真实抖音后台，**不声称这些 ID、状态文字、URL 形式或 selector 已被确认**。以上是 implementation reconnaissance 必须验证的 contract。若真实页面无法提供足以关联本次提交并重开的稳定证据，自动成功验收不成立：返回 `NEEDS_HUMAN(PUBLISH_CONFIRMATION_UNAVAILABLE)`，由人工在后台核查并绑定具体内容 ID 后记录 `confirmation_source=human`，或保留 unresolved。

不得把点击成功、文件进度 100%、按钮消失、页面跳转、无错误提示或标题相同当成功。平台审核中属于“已接受”，不属于“公开发布通过”；后续审核拒绝不授权再次发布，MVP 不自动跟踪审核结果。

# 9. Idempotency And Local Persistence

## Identity

```text
upload_task_id = SHA256(canonical JSON {
  schema: "jianji-douyin-upload/1",
  project_id, batch_id, export_task_id, artifact_sha256
})
```

不含 export attempt、路径、文件名、timestamp、caption 或 retry count。相同最终文件换名/重发通知不创建新发布。一个已绑定的 ExportTask 后续发现不同 hash，报 `ARTIFACT_CHANGED`，不自动 mint 新身份。新制作使用新 ExportTask；当前单账号下，已有相同 `artifact_sha256` 的成功/提交标记同样阻止复制文件或新 job 绕过去重。不同视频字节独立处理；同字节但不同文案需求返回冲突，不默许再发，显式重复发布不属于 MVP。

## Small Local Store

在 `app.getPath("userData")/douyin-upload/` 保存冻结 intent、task record 和提交标记，单实例内串行执行准入和所有 publish 检查。复用 `atomicWriteJson()` 保存 task record；不更改 ExportTask/Project/Queue schema，不建立数据库、broker、daemon 或分布式锁。

提交标记是每个 task 一个不可覆盖的小文件，至少绑定 task ID、视频 SHA-256、冻结输入 digest 和带时区时间。用 exclusive create、文件 sync 及适用目录持久化在按钮操作**之前**完成；已有标记或写入失败都不得点击。标记永不因 retry、页面恢复、清空当前进度或任务成功而删除，是 crash 后的保守发布屏障。它不证明平台已接受。

`atomicWriteJson` 的旧备份可能早于提交。上传记录不得直接使用默认 backup fallback 还原可重试状态；必须读取/校验提交标记，且任何缺失、冲突、损坏记录均 fail closed。人工恢复 `.bak`、丢失 store 或机器断电不能自动获得再次发布许可。目录同步不受支持的 filesystem，需在实施时验证 durable barrier 能力；不能证明时在发布前阻断，而不是宣称所有平台断电安全。

相同 SHA-256 的提交标记检查与标记创建处于同一串行临界区，两个并发 render 完成不会同时发布同字节视频。已有成功返回原平台证据和 `duplicate_of`；已有可能提交记录进入只读 reconciliation。成功记录与提交标记均保留，自动清理只处理可选诊断，不能清除去重历史。

## Retry And Unknown Outcome

在任一提交标记存在时，只能核查同一内容 ID/同一次页面提交。后台列表暂时没有条目、超过 timeout 或人工暂未找到都不是“未发布”的证明。MVP 不提供清除标记后重新点击的按钮；无法确认则人工处理并保持 unresolved。人工确认已接受必须给出具体后台内容定位，不能只点击“登录完成”就变成功。

这个本地协议以宁可暂停保证避免重复自动发布，不承诺平台级 exactly-once；人工并发操作、外部删除所有记录或平台缺少可观察身份超出其保证。既有浏览器 profile 不得在运行中切换账号。

# 10. Retry Policy

| Failure | Policy |
| --- | --- |
| CDP 短暂不可达、已确认的导航/网络临时错误 | 无提交标记时 `FAILED_RETRYABLE`；最多 2 次自动 retry，等待 2 秒/5 秒，计数 durable，不因重启归零 |
| 上传传输/处理临时失败 | 仅在未提交且已确认任务 tab 可安全清理或重新打开时，重走上传；无法辨认平台是否自动提交则 `NEEDS_HUMAN` |
| 登录失效、验证码、安全/风控验证 | `NEEDS_HUMAN`；不自动 retry、不换 profile、不尝试绕过 |
| selector 缺失/不唯一、页面结构明显变化、账号身份不明 | `NEEDS_HUMAN(PAGE_CONTRACT_CHANGED)` 或对应身份 reason；停止此账号后续自动操作 |
| 文件缺失/改变、非 MP4、非法参数、确定的文件/内容拒绝 | `FAILED_TERMINAL`，用户修正后显式处理；不调用导出 retry 自动再发 |
| durable intent/提交标记无法保存 | 副作用前停止；记录 typed store failure，不在无法持久化时继续 |
| 已写标记后 click timeout、断线、确认超时或进程中断 | `NEEDS_HUMAN(PUBLISH_OUTCOME_UNKNOWN)`；`retryable=false`，仅允许 verify |

超出自动 retry 预算停在 `FAILED_RETRYABLE`，可由用户显式恢复安全的未提交任务；每次人工恢复也必须有有限 attempt，保留累计计数。Playwright 的自动等待只是一次操作的 actionability wait；不能对发布 click 加 retry wrapper，不能开启其他服务的 retry/fallback。

# 11. Selector Strategy And Reconnaissance

定位优先级：role + accessible name、label、明确可见的语义 text、已验证 stable attributes。每个操作先验证唯一目标与上下文；不得 `.first()` 消除歧义。仅在必要时使用限定在稳定区域内的 CSS/XPath 回退，不依赖大量生成 class、长层级链或坐标点击。[Playwright Locators](https://playwright.dev/docs/locators)。

`douyin-cdp-uploader` 内集中保存 upload control、caption、ready、publish、challenge、success、content identity/management 的有限页面合同，注明验证日期与 fixture；上层不能知道 selector。`setInputFiles()` 优先，动态 file chooser 使用等待事件后再点击的官方模式，不操作系统文件对话框。[Playwright Actions](https://playwright.dev/docs/input#upload-files)。

实施前对操作人指定的单一后台环境完成以下最小侦察：

- 确认上传路由、登录/验证码/风控信号、唯一文件输入和必需字段；明确上传是否会自动发布或仅保存草稿。
- 确认文件传输与平台处理 ready 的信号，以及同一发布操作是否有后续确认；每个可能产生发布副作用的动作都必须位于提交标记之后。
- 确认接受证据、稳定内容 ID、管理页重开，以及审核中/草稿/失败的区分。
- 确认必要固定字段与实际文件/文案限制；默认仅普通即时发布，不擅自接受声明、勾选协议或变更可见范围。新增必填项需用户明确选择，未决定时 `NEEDS_HUMAN`。
- 建立净化 fixture，并在获得明确真实发布授权后用 **一条用户指定成片** 验证上述链路；任何疑似已提交结果都不再发第二条来“测试”。

不编造 DOM selector、平台格式/大小限制、真实成功文案或发布 API。侦察不能调用 LLM/VLM、自动验证码服务、隐藏 API，也不自动获得本轮 spec-only 之外的发布权限。页面不符合合同直接停止。

# 12. Timeouts

以下为可落地的初始默认值，不是平台 SLA；每个阶段独立使用有限 deadline，不设一个总 timeout 替代所有状态，不用固定 sleep 判断成功。

| Stage | Default | Timeout handling |
| --- | --- | --- |
| CDP connect | 10 秒 | 未提交且暂时不可达可 bounded retry |
| Navigation / management-page open | 每次 45 秒 | 提交前可 retry；提交后只读 verify 超时进入人工 |
| File input / chooser / setInputFiles | 30 秒 | 若结构正常但超时为未提交失败；结构不符进入人工 |
| Upload transfer + platform processing | 30 分钟 | 不因 progress 更新无限延长；已知未提交方可安全重试 |
| Fixed field actions + publish action | 每次 15 秒 | 字段前检查；提交标记后的任何异常按未知结果 |
| Publish confirmation | 120 秒 | 覆盖接受确认和同 ID 管理页核查的总预算；到期不得再 publish |

deadline 需覆盖底层实际操作，取消/timeout 后不得让迟到的 promise 继续点击。重连只在先前自动操作已停止后发生；无法确认是否仍在执行的副作用保持 unknown。`NEEDS_HUMAN` 是已停止的持久状态，没有后台等待人工的无限脚本。

# 13. Failure Observability

UploadStore 是唯一发布状态来源，structured logs 是诊断，不是第二 lifecycle。每次状态变更及失败记录 `upload_task_id`、`project_id`、`batch_id`、`export_task_id`、`artifact_sha256`、`video_path`、`state`、`publish_outcome`、净化 browser endpoint/page URL、typed failure category/code、净化 exception type/message、`retry_count` 与带时区 timestamp。

完整 video path 只存在权限受控的本机 task/log；renderer 显示文件名和可定位任务，不打印主目录或内部堆栈。URL 去除 query、fragment、userinfo，保留允许的路由和 content ID；exception stack 按路径/token 规则脱敏。不能靠 exception 字符串判断已经发布或可以 retry。

失败默认只保存这些最小结构化信息。可选诊断由用户显式开启：限制截图为任务区域，遮挡账号、头像、手机号等信息；DOM 只保留 allowlist 的 role/label/必要错误状态，不保存整页 `page.content()`、脚本、隐藏输入、表单值或 network dump。诊断文件只在本机、POSIX 目录 0700/文件 0600 或等效 Windows ACL，默认保留 7 天/最多 100 MiB，超限停捕获。无法脱敏则不保存；诊断失败不能改变业务状态。

# 14. Security

- 不保存、读取或打印抖音账号密码、cookies、localStorage/sessionStorage token、Chrome profile 数据库或 OAuth 数据；不调用 `storageState()` 导出登录态。
- 不记录 CDP/WebSocket 原始报文、请求/响应 headers、完整 console、HAR/trace 或网页脚本。所选 Playwright 的 debug logging 默认关闭。
- CDP 默认只允许 literal `127.0.0.1` / `[::1]`，检查 HTTP discovery 与 WS host 均为 loopback；不接受公网、LAN、端口转发或带鉴权的远程 endpoint。
- profile 目录持久化由 Chrome 自己负责；不得提交到 Git、上传反馈服务或与简辑模型连接共享。
- uploader 仅接收主进程从已选正式 ExportTask 绑定的视频；可信 IPC + strict schema，renderer 不能提供任意 path、selector、script 或自由 browser command。
- 输入 caption 是文本数据，metadata 不执行；禁止把页面返回或模型输出作为命令、selector 或权限请求。
- 当前制作开启自动上传意味着该明确集合的文件将通过浏览器传到抖音并提交发布；界面必须清楚说明这个外部副作用，默认关闭。不改变模型请求的素材/凭据边界。
- 文件 hash 在准入和 setInputFiles 前校验，使用任务私有、按 hash 命名的已验证上传快照，禁止硬链接到可变输出。快照复制后测量 hash，必须等于冻结 `artifact_sha256`，并限制读写权限；复用相同 hash 不再复制。发布完成/已停止后可清理快照，保留 task/标记。不覆盖源文件或最终成片。若外部修改导致 identity 不能保证，发布前拒绝。

# 15. Integration Boundary

```text
ExportQueue (render/verify/publish/persist completed)
  → FinalArtifactCommitted + frozen upload intent
  → DouyinUploadService (admission / local store / serial execution)
  → DouyinCdpUploader (Playwright + finite semantic page operations)
  → structured UploadResult
```

建议新增最小 owner 集合：

| Proposed module | Responsibility |
| --- | --- |
| `src/shared/douyin-upload.ts` | strict request/config/public result schemas、state/failure enums；不包含 Playwright 或私密连接对象 |
| `src/main/douyin-upload-service.ts` | final artifact 准入、intent/task identity、去重、串行执行、finite retries、取消/恢复 |
| `src/main/douyin-upload-store.ts` | 本机 task/intent/submit marker 读写，复用 `atomicWriteJson`，不写 JobStore/Project |
| `src/main/douyin-cdp-uploader.ts` | CDP attach、任务 page、selectors、上传、一次提交与只读 verify；不自行 retry、改 export 或认定 Store success |

在 `index.ts` 仅装配/IPC/状态通知；`queue.ts` 仅增加上述事实通知和 sample task-created seam，不继续加入发布领域逻辑。现有 [preload.ts](../src/main/preload.ts) / [desktop.ts](../src/shared/desktop.ts) 模式提供窄的设置、状态、继续/停止入口，方法参数是任务 ID 和固定业务字段，禁止自由浏览器命令。

MVP 接口只需 `enqueueFinalArtifact(...)`、`runPending(...)`、`resume(uploadTaskId)`、`cancel(uploadTaskId)` 和内部 `upload/verify`，不创建 Provider registry、通用 adapter 选择器、额外账号系统或后台 worker 进程。uploader 不在模型 Agent 中执行，不依赖模型连接，本地随机无需模型的性质保留。

`UploadResult` 至少包含 identity、current state、publish outcome、attempt/retry count、timestamps，以及互斥的 `success { platform_content_id, accepted_status, confirmation_source, confirmed_at, evidence }` 或 `failure { category, code, retryable, requires_human, message, next_action }`。重复返回增加 `duplicate_of`；上层展示“导出已完成，上传待处理/需人工/已接受”，不能将两种完成合并。

UI 限于本次制作的默认关闭开关、手工 caption、当前上传状态和明确继续/停止动作。关闭自动上传及退出停止后续操作；提交后停止只结束核查，不撤回平台发布、不变成可重试。浏览器 challenge 留给人工；不增加浏览器控制面板。CLI 当前只有 Harness 等工具入口，没有生产视频 run CLI；本阶段不新增公开上传 CLI、HTTP 服务或 MCP 工具。

# 16. Configuration

独立本机配置保存在 userData，按现有 strict Zod + atomic JSON 风格读取，不混入 ModelConnections 或可分享项目文件。

| Configuration | MVP default / rule |
| --- | --- |
| `enabled` | `false`；开启后仍要求本次制作明确 opt-in，不自动扫描历史 |
| `cdpEndpoint` | `http://127.0.0.1:9222`，端口可配置；只接受 loopback |
| `uploadPageUrl` | 无猜测默认值，实施侦察后配置已验证的 creator HTTPS route；没有则不 ready |
| `timeouts` | 第 12 节独立有限值；允许用户按真实网络/文件大小调整，不允许 0/无限 |
| `captureFailureDiagnostics` | `false`；启用后执行第 13 节脱敏、权限与保留上限 |

upload concurrency=1、automatic retry 上限=2、store root 和诊断保留规则为代码常量，不增加无必要配置。caption 属于本次任务输入，账号/profile 只属于手工 Chrome 前置条件；不加入 password、cookie、account pool、shop id、千川、商品、Provider、API endpoint、selector JSON 或分布式 queue 配置。

# 17. Verification And Acceptance

实施验证沿用 Vitest + 依赖注入，不在默认 tests/Harness 使用真实抖音账号。

| Test layer | Required evidence |
| --- | --- |
| Contract/unit | strict input/config、loopback/URL/path 拒绝、state transitions、typed failure、独立 timeout、caption 缺失、artifact identity 与字段冻结 |
| Export integration | normal completion 与 approved sample 两条路径；verify/publish/store 失败不触发；partial/preview/proof 未选中不触发；通知重复、完成与 task 创建之间 crash 补齐；上传失败不改变导出/并发 |
| Persistence/idempotency | export retry/task ID 保持、相同 hash 跨 job/不同名复制、并发完成、success replay、标记前/后 crash、点击前标记、state 丢失/损坏/旧 backup、success 存储失败、未知结果/取消/退出后零重复 click |
| Browser fixture | 本地 HTML fixture + 专用 Chrome CDP：file input/chooser、processing ready、必需字段、captcha/login/structure drift、稳定 content ID、管理页验证、迟到 promise、disconnect 保留原 Chrome 与 tab |
| Desktop/build | `npm run typecheck`、受影响 Vitest、`npm run build`、实际 Electron IPC/状态 smoke；`playwright-core` 打包与已安装 Chrome 的 Linux/Windows 连接分别验证 |
| Harness regression | 使用现有 code policy 检查核心制作/导出不回归；不能把本地 fixture success 视为真实抖音发布 |
| Authorized live acceptance | 用户指定账号/profile 与一条正式 MP4，明确发布授权；实际后台接受与同 ID 重开；重复触发无第二次 publish；人工登录/验证路径可接管 |

最低可验收条件：选中正式导出自动创建一个 durable task；一个既有 Chrome 登录态可完成一次网页发布；成功有第 8 节真实可观察证据；所有验证/未知结果路径停止且无 duplicate publish；重新启动不自动执行未确认外部副作用；原制作/导出行为及文件不被修改。

Spec 自检：Goal/Non-goals、触发边界、输入、浏览器、状态、后台接受、去重、retry、selectors、独立 timeout、失败诊断、安全、模块和配置均已定义。当前未完成的 implementation reconnaissance 包括真实上传 URL、页面 signals/selectors、必需字段/限制、稳定内容 ID 和管理页重开能力；这些不能由文档或模拟 tests 证明。若稳定接受合同在真实页面不可验证，保留 `NEEDS_HUMAN`，不能把较弱信号升级为自动成功。

本轮文档验证只检查当前源码引用、边界一致性、需求覆盖和 patch 格式；不运行无关媒体/账号测试。Spec 经用户批准用于 implementation 后，再按现行规则生成 durable implementation plan；批准本文不等于允许本轮直接发布真实视频。

# References

- [Repository rules](../AGENTS.md)、[README](../README.md)、[Harness policy](../.agent/harness/policy.json)。
- [Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)：attach 既有 Chromium browser/default context；CDP 相比 Playwright protocol 有功能差异，所选实际 Chrome/Playwright 组合须验证。
- [Playwright Locators](https://playwright.dev/docs/locators) 与 [file upload actions](https://playwright.dev/docs/input#upload-files)：语义定位与文件输入操作。
- [Chrome remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port)：独立非默认 user-data-dir 的要求。
- [Playwright Browser.close](https://playwright.dev/docs/api/class-browser#browser-close)：连接后清理/断开与 launch 后关闭的区别，需验证本阶段 ownership/cleanup。

官方技术文档于 2026-09-27 核对；这些来源不证明抖音页面合同、平台权限或真实账号发布能力。
