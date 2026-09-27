---
title: Jianji Douyin Automatic Upload MVP Implementation Plan
status: proposed
implementation: not_started
date: 2026-09-27
source_baseline: ef2b09f34ce8a3c67649ea15d8d3dcfd69d6d9ce
spec_path: docs/douyin-auto-upload-spec.md
spec_sha256: b606362daa7e73f6780c644ea86735a4e1976d2f4a336afdc439b183660de710
---

# Goal

简辑将本次明确选中的、已经验证且完成落盘的正式 MP4 交给独立 uploader，通过 Playwright CDP 连接本机已登录的 Chrome，完成网页上传与发布，并返回可验证、可恢复且避免重复发布的结构化结果。

本计划依据 [Douyin Upload Spec](../../douyin-auto-upload-spec.md)。用户当前要求编写 plan；本文不表示 spec/plan 已获准实施，也不授权安装依赖、连接用户浏览器或真实发布。spec 仍为 `proposed`，本轮只交付本文。后续 implementation 必须使用批准的合同与当时的源码快照。

# Scope And Contract Surfaces

- 单一 Chrome profile、单一当前登录账号、单个串行 uploader；复用现有 ExportQueue、JobStore、文件验证、指纹、IPC、Vitest 与 Harness。
- 请求：本次制作 opt-in、可选手工 caption；内部输入由主进程绑定 project/batch/export task、实际最终路径、最终文件 SHA-256 和大小。
- 状态：上传 intent/task/result 与不可回退的提交标记独立保存在本机 userData；不增加第二套导出生命周期。
- 浏览器：只 attach 已启动 Chrome，使用已有 default context 和任务专用 tab；登录、验证码、安全验证由人工完成。
- 外部副作用：先持久化提交屏障，再进行一次发布操作；提交结果未知只核查，不重新发布。
- 不新增生产 CLI、API 上传、账号/店铺管理、千川/投流、模型浏览器控制、文案生成、商品操作、分布式队列或通用 adapter framework，不改变制作和渲染内容。

# Current And Target Behavior

当前 [queue.ts](../../../src/main/queue.ts) 有两个正式完成入口：`execute()` 经 FFmpeg 生成、验证并发布文件；`publishApprovedSample()` 将通过审核的样片复制、验证并发布为正式 ExportTask。`executePreview()` 只产生缓存。两条正式路径均通过 `transition()` / `persist()` 等待 `JobStore.save()`；`onSnapshot` 同时承担进度、恢复和 UI 通知，不能用作发布授权。

最终路径由不覆盖发布决定，可能与预分配路径不同；[artifact.ts](../../../src/main/artifact.ts) 的 OutputArtifact 没有输出 hash。[agent-controller.ts](../../../src/main/agent-controller.ts) 的 `enqueue` 与 `publishApproved`，以及 [index.ts](../../../src/main/index.ts) 的 `export.create` / `export.append` 是接入位置。`ApplicationService.syncQueue()` 只是项目副本同步。当前没有生产 Playwright uploader，build 在 `package.json` 中执行 esbuild。

目标是在 completed 成功持久化之后报告最终产物事实，由 uploader 使用冻结 intent 独立准入。关闭功能时保持现有行为；开启后每条正式视频独立上传，FFmpeg 继续按设备能力并发。上传失败不改变 ExportTask 的 completed 状态，也不触发重渲染。

当前源码还包含 shape-cover admission 校验，以及每次导出/重试执行前的输出目录安全检查与缺失目录创建；接入完成通知和样片 task-created seam 时必须保留这些保护的验证顺序、绑定和失败行为，不沿用 spec 较早 baseline 的代码覆盖当前实现。CodeGraph 关系已与实际调用点核对；同名推断关系不构成新的依赖。

# Invariants

1. 只有本次授权的 task，且最终验证、不覆盖发布、completed 保存均成功，才能创建上传任务。partial、缓存预览、proof、未选中历史产物均不能上传。
2. uploader 的身份和去重不依赖 render attempt、文件名或 caption；同 task 更换视频字节必须拒绝，已成功/可能提交的同字节跨 job 也不能再发布。
3. 提交标记先于任何发布副作用完成持久化，存在即永久禁止该任务重新发布；标记不等于发布成功。
4. `SUCCEEDED` 必须有本次提交的稳定内容 ID、同 ID 管理页接受状态和落盘证据；进度 100%、click 返回或无报错不够。
5. 启动只恢复本地状态，不自动连接、上传或发布。人工“继续”在有提交标记时只能进入只读 `VERIFYING`。
6. 账号验证、风控、页面合同变化或未知发布结果停止该账号的后续自动任务；导出继续。所有阶段有独立有限 deadline，超时后的旧操作不能继续点击。
7. 不保存密码、cookie、storage token 或 profile 内容；CDP discovery 与 WS 都限 loopback，页面合同限已验证的 creator route。默认禁用敏感诊断。

# File Structure And Ownership

以下是 implementation 的目标文件，不代表本轮已创建。执行者在每个 checkpoint 核对实际文件与 ownership；单 writer 在当前 working tree 串行推进，禁止覆盖无关改动。若与其他 writer 同文件冲突，按仓库规则停下处理。

| File | Action / single responsibility |
| --- | --- |
| `src/shared/douyin-upload.ts` | Create：strict 输入/配置/公开状态/result、typed failure、有限 timeout 合同；不导入 Playwright |
| `src/main/douyin-upload-store.ts` | Create：intent/task/config、不可覆盖提交标记、恢复和成功证据；复用 `atomicWriteJson`，不写 Project/JobStore |
| `src/main/douyin-upload-service.ts` | Create：最终文件准入、身份/hash 去重、私有快照、串行执行、重试/暂停/恢复/取消及净化日志 |
| `src/main/douyin-cdp-uploader.ts` | Create：CDP 连接、任务 tab、有限页面合同、传文件、一次发布和只读核查；不拥有 retry 或 durable success |
| `src/main/queue.ts` | Modify：两个 completed-save 后的最终事实通知，以及样片保存后、复制前的 task-created seam；不加入上传领域逻辑 |
| `src/main/agent-controller.ts` | Modify：冻结本次上传选择，在正式 enqueue/样片创建时交给装配回调；不发给模型，不改变方案 |
| `src/shared/agent.ts` | Modify：既有制作/追加请求可选携带共享的上传选择 schema，旧请求保持有效 |
| `src/main/index.ts` | Modify：装配服务、可信 IPC、状态投影、普通/追加导出 intent、启动恢复和安全退出；不写 selectors |
| `src/main/preload.ts`, `src/shared/desktop.ts` | Modify：窄的配置/状态/继续/停止/手工字段入口及公开类型 |
| `src/renderer/DouyinUploadControls.tsx` | Create：本次 opt-in 与手工 caption 控件，制作和追加入口复用 |
| `src/renderer/DouyinUploadPanel.tsx` | Create：最少连接设置、任务状态、人工恢复/停止；不提供账号管理或浏览器命令 |
| `src/renderer/App.tsx`, `src/renderer/TemplatePanel.tsx`, `src/renderer/AppendProductionDialog.tsx`, `src/renderer/ResultsPanel.tsx` | Modify：挂载控件和按 task 显示结果；保持现有结果数量和制作表单语义 |
| `package.json`, `package-lock.json` | Modify：固定已验证的 `playwright-core`、esbuild external 与 runtime 打包；不下载另一套 Chromium |
| `.agent/harness/policy.json`, `README.md` | Modify：新增 offline uploader 检查组及本机 Chrome/恢复说明；不将操作手册放入 AGENTS.md |
| `docs/douyin-upload-page-contract.md` | Create during implementation：侦察得到的有限页面合同、验证版本/日期与证据定位；净化，不保存真实账号数据 |
| `tests/douyin-upload-contract.test.ts`, `tests/douyin-upload-store.test.ts`, `tests/douyin-upload-service.test.ts` | Create：输入、发布屏障/恢复、准入/去重/生命周期故障注入 |
| `tests/douyin-upload-integration.test.ts`, `tests/douyin-cdp-uploader.test.ts`, `tests/douyin-upload-ui.test.ts` | Create：正式导出边界、browser port/页面状态、IPC/界面合同 |
| `tests/fixtures/douyin-upload-page.html`, `tests/helpers/douyin-cdp-fixture.ts`, `scripts/douyin-upload-smoke.mjs` | Create：合成网页、隔离 Chrome CDP 与 Electron smoke；仅测试入口，无真实账号 |
| `tests/queue.test.ts`, `tests/agent-controller.test.ts`, `tests/append-production-queue.test.ts`, `tests/harness.test.ts` | Extend：相关正式完成/取消/追加与 policy 回归 |

不提前改 `domain.ts`、ExportTask/Project/Queue schema、模型 Provider 或渲染器。大文件只增加窄的装配/事实 seam，新的领域逻辑由四个 uploader owner 承担。

# Major Milestones

## M0: Validate The Page And Durability Contracts

**Files:** `docs/douyin-upload-page-contract.md`，本地净化 fixture 的初始合同；不在 plan-only 阶段执行。

**Dependencies:** implementation 授权；查看真实后台需要操作人准备目标 Chrome/profile。发布验证另依赖 M6 的单条真实发布授权。

**Contract And Work:**

- 操作人用指定 `remote-debugging-port`、专用非默认 `user-data-dir` 启动 Chrome 并人工登录，核对仅监听 loopback。profile 与简辑/ChatGPT/Codex 目录分离，由 Chrome 持久化；程序不启动或接管默认 Chrome，不保存账号密码。
- 核对当前 Chrome/Node/Electron 与候选 `playwright-core` 兼容性并固定一个实际通过 fixture 的版本，不把“最新”当兼容保证。确认 CDP default context 行为、文件上传、受控 tab 重连、停止与 detach；不依赖 Playwright 私有 connection 属性。[Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) 与 [Browser cleanup](https://playwright.dev/docs/api/class-browser#browser-close) 是技术参考，实际版本仍需测量。
- 确认 creator 上传 pathname、唯一文件控件、caption/必需字段、处理完成信号、账号及挑战信号、发布动作序列。定位优先 role/label/text/stable attributes，所有动作要求唯一匹配；不编造 selectors，不用 `.first()` 消除歧义。
- 在传文件前证明选文件不会直接发布；每个可能造成发布的动作必须晚于提交标记。不能证明时禁止 `setInputFiles`。新增声明/协议/可见范围需人工明确选择，不能自动勾选。
- 确认能够从本次提交取得稳定非草稿 content ID，再通过正常管理/详情网页按同 ID 重开并区分接受/草稿/失败。先确认可验证方式，最终真实接受证据在 M6 取得；标题/文件名相似不作为身份依据。
- 验证目标 filesystem 的发布屏障：exclusive create、文件 sync 和适用目录持久化必须在动作前成功。现有 `atomicWriteJson()` 吞掉 directory fsync 错误，不能直接承担这项证明。Linux 与 Windows 能力分开记录，不能证明的平台阻断发布，不静默降级。

**Acceptance:** 得到无副作用的页面前置合同、接受证据的核查方式、固定版本的连接与清理证据、目标平台的 durable barrier 能力结论。接受链路的真实证明只在 M6 的受控单条授权下完成，不要求 M0 先试发一条。真实页面不满足接受合同则记录 `NEEDS_HUMAN(PUBLISH_CONFIRMATION_UNAVAILABLE)` 的具体原因，自动成功验收保持未通过。offline 合同/store 开发可继续；常规自动发布保持关闭，直至 M6 验证完成。

**Verification:** 隔离 Chrome 的本地 fixture；操作人指定后台的最小侦察。拒绝完整 HTML/HAR/trace/token 采集。未知 selector 是此 milestone 必须核实的外部条件，不允许用猜测补齐。

## M1: Establish Strict Contracts And The Durable Publish Fence

**Files:** shared schema、upload store 及其两个 test files。

**Contract And Work:**

- 共享 `DouyinUploadSelectionSchema` 定义可选 `douyinUpload: { enabled: true, caption?: string }`；缺省表示本次不上传。全局配置默认 `enabled=false`，与本次选择分别校验。caption 原样保留、不代填、不截断，实际页面限制由 M0 合同校验。
- 区分可信 renderer 请求与内部 `FinalArtifactInput`。后者严格包含 spec §5 的 `project_id / batch_id / export_task_id / video_path / artifact_sha256 / size_bytes`，可选 caption/最多 16 keys、4KiB 的 scalar metadata；renderer 不能填写最终 path/hash 或 browser command。
- 定义公开 `UploadState`、`UploadResult`、typed failure 与 `publish_outcome`；状态列表和四种 outcome 完整采用 spec §7。`UploadResult` 至少含 task identity、state、publish_outcome、retryable、retry_count、timestamp，失败包含 category/code/next_action，成功包含 platform_content_id、accepted status、净化 URL、observed_at 与 confirmation_source。公开投影仅显示必要定位、文件名和结果，不泄露路径、stack、连接对象或账号；`duplicate_of` 返回原记录，不能另算一次发布成功。
- 以 spec §9 的 canonical JSON 算 `upload_task_id`，schema/version 与字段顺序固定；caption/metadata/attempt/path/time 不进入 identity，冻结输入单独保存 digest。task、intent、配置和成功证据复用 atomic JSON；submit marker 使用独立不可覆盖创建，绑定 ID/hash/输入 digest/时间。
- load 时先核对 markers 再解释 task；已有 marker 即使 task 为旧 `PENDING` 也只能核查。缺失/损坏/冲突的已知记录和旧 `.bak` 不恢复发布许可，未知 schema fail closed。已存在/创建或同步失败均零发布；marker 永不自动删除。
- 配置仅含 spec §16 的五项；timeout 默认 connect 10s、navigation 45s、file input 30s、processing 30min、field/publish action 15s、confirmation 总计 120s，全部有限正值。retry=2、concurrency=1、诊断 7 天/100MiB 保持常量。

**Acceptance:** schema 能拒绝未知字段、远程/带凭据 CDP、未验证路由和无限 timeout。所有恢复分支保守保留提交事实；文件/目录持久化失败不能进入 browser side effect。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-upload-contract.test.ts tests/douyin-upload-store.test.ts`。关键失败用可注入 fs 及独立进程中断验证，不把 mock sync PASS 声称为目标平台断电保证。

## M2: Implement Admission, Serial Execution And Safe Recovery

**Files:** upload service、service tests，复用 store/schema 与 `paths.fingerprintFile()`。

**Dependencies:** M1；此时使用 recording browser double，不访问真实浏览器。

**Contract And Work:**

- 最小服务入口为 intent registration、`enqueueFinalArtifact(...)`、`runPending(...)`、`resume(uploadTaskId)`、`cancel(uploadTaskId)`；配套安全停止和只读状态投影，不建立通用任务框架。
- 准入重读该已授权正式任务，要求 completed、artifact/task/path 一致、目录安全、可读非空普通 MP4、size 匹配。全文件计算 SHA-256，不能用源素材 fingerprint。创建私有 copy 快照并重新 hash，上传前重验；不硬链接、转码、修改或覆盖成片。
- 任务 identity、同 export task 的 hash 绑定和跨 job 同 hash 的成功/marker 检查放在单一串行临界区；发布前再查一次同 hash。已有 success 返回原证据及 `duplicate_of`；可能提交只核查；hash 变化为 `ARTIFACT_CHANGED`，冻结字段冲突为 `INPUT_CONFLICT`。两个 pending 同字节任务也不能先后各自发布。
- 持久化每次状态/失败/retry count。唯一执行器按 spec 状态推进，浏览器 adapter 只产生 typed observations，service 决定转移/持久化。进入 SUBMITTING 时 store barrier 成功后才调用发布；success evidence 存储失败保留 marker，结果 unknown。
- 仅无 marker 的已确认临时 CDP/navigation/network 错误可最多自动 retry 两次，延迟 2s/5s；重启不重置计数。用户继续是有限的新 attempt，有 marker 时唯一入口为 VERIFYING，不包装重试 publish click。
- 文件/参数/明确内容拒绝 terminal；登录/挑战/页面变化/账号不明/必填字段与未知提交 NEEDS_HUMAN。人工补字段仅无 marker 可显式修订同 task，保存历史。有账号挑战/unknown 时暂停其他 pending；普通单任务 terminal 不阻断全部导出。
- 启动对照冻结 intent 与既有 JobStore 的有效结果补齐漏通知的 PENDING；不扫描文件夹、不回填历史、不改 export 记录，不自动唤醒浏览器。读取失败阻断该任务，不从 UI/project 副本推定 completed。
- 停止/关闭功能/退出取消未提交动作并等待其停止；marker 后不能按安全 CANCELLED 处理。保留 unknown 页面和提交记录，阻止迟到 promise、重复 resume 或旧 tab 操作绕过状态守卫。
- 最小本机日志包含 spec §13 的 identity/path/state/outcome/URL/category/exception/retry/time；URL、异常和公开结果净化。可选截图/allowlist DOM 无法脱敏则不存，诊断失败不改变业务结果。

**Acceptance:** recording double 中任何重复通知、并发完成、重启、失败、恢复、取消组合，每个 identity/hash 的 publish 动作最多一次；只有证明安全且无 marker 才能重上传。startup 和 disabled 均零 browser 调用。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-upload-service.test.ts tests/douyin-upload-store.test.ts`。重点覆盖 marker 前/后 crash、旧备份、success 保存失败、同字节跨 job、retry 累计、unknown 队列暂停和超时后零动作。

## M3: Connect Both Formal Export Paths

**Files:** queue、agent-controller、shared agent 请求、index 装配，以及 queue/controller/append 与 uploader integration tests。

**Dependencies:** M2；仍使用 uploader double。

**Contract And Work:**

- 新增 `FinalArtifactCommitted` 事实通知，携带冻结的 project/batch/task 与实际 artifact。两个正式入口均在 `transition(..., "completed")` 成功返回之后发出；不是通用 `onSnapshot` hook。同步 throw/异步 rejection 独立报告，不能进入 render catch、改 completed 或扣住 render slot。通知只唤醒 service；准入仍重新读取已保存任务，不能信任 caller 构造的 artifact。
- 普通 enqueue、`export.create` / `export.append` 在 createBatch 成功后、start 前注册 exact task intents；冻结本次 opt-in、caption 和配置。注册失败显示 upload initialization failure，但导出仍可继续，绝不以全局 enabled 替代已保存 intent。
- `publishApprovedSample()` 添加窄的内部 per-call task-created seam，在任务首次持久化成功后、复制前等待 intent 注册结束。传入回调只接收正式身份；不能在方法返回后补授权。回调失败隔离、无 intent 则不上传；shape admission 与原验证/发布顺序保持。
- AgentController 只经装配回调交付本次字段，不让模型决定是否上传、文案或浏览器动作。既有请求新增可选选择，旧请求不上传；取消发生在创建与 start 之间时保留现有取消语义。
- `executePreview()` 不发正式通知。proof 即使形成正式导出也没有本次 upload intent，不能上传；approved sample 的原缓存路径不上传，审核后正式 artifact 路径可以触发。
- 漏通知 reconciliation 等待既有 queue recovery 完成，依据 durable intents 与有效任务重建；不把 `syncQueue`、通知次数、AgentRun prepared/exporting 或批次 completed 当依据。

**Acceptance:** normal 与 approved sample 各产生一次正确 artifact admission；完成 save 被故意阻塞时零通知/上传，save 拒绝时也零上传。通知失败后 task 仍 completed，其他 export 照常运行。已有文件碰撞后采用实际新路径，partial/cache/proof/history 均零上传。

**Verification:** `npm run typecheck`；`npx vitest run tests/queue.test.ts tests/agent-controller.test.ts tests/append-production-queue.test.ts tests/queue-output-directory.test.ts tests/queue-output-directory.integration.test.ts tests/douyin-upload-integration.test.ts`。用保存调用序列和可控 Promise 证明 durable boundary；保留现有 shape-cover、输出目录、取消与并发回归。

## M4: Implement The CDP Page Flow And Read-only Confirmation

**Files:** CDP uploader、browser tests、本地 HTML/helper fixture、M0 页面合同，package/lock 的版本与 external 设置。

**Dependencies:** M1/M2；生产页面动作依赖 M0。本地 fixture 用同一有限页面 port；fixture origin 只通过测试依赖注入允许，不成为用户可配置的生产放行开关。

**Contract And Work:**

- 校验 HTTP discovery 和返回 WS 均 loopback，拒绝远程/带凭据/异常 redirect；使用有限 connect timeout attach 现有 default context，不 launch Chrome、不读取 profile/storageState，不新建未登录 context。
- 新任务创建专用 tab；只可信复用本任务页面，不挑第一 tab、不覆盖用户草稿。重连后不能确认 ownership 时，提交前可安全新建任务 tab；marker 后不能上传新页，只核查/人工接管。
- 按 M0 合同检查登录/目标账号、唯一控件、必要字段和不会自动发布，再 `setInputFiles` 私有快照或预置 chooser listener 后触发选择。无法可靠识别账号时要求人工确认本次连接，不虚构检测；运行中切换账号停止。处理 ready 必须包括平台处理成功与提交准入，不等同传输 100%。页面预填文件名须清空/替换为手工 caption，缺必填值进入 NEEDS_HUMAN。
- adapter 的 upload/prepare 与 publish/verify 分开。service 完成 marker 后调用一次发布动作序列；每个动作唯一定位并在独立 deadline 内执行，不加 click retry。marker 后超时/断连/cancel/进程中断均 outcome unknown；没有列表条目不授权重发。
- confirm 在 120s 总预算内取得本次 stable content ID、按同 ID 正常打开管理/详情页并确认接受状态，返回净化 evidence，由 service 保存成功。draft/失败/无稳定身份为非成功；只读 `verify` 绝不选择文件或触发发布。
- 任何 challenge、结构漂移、人工改动或账号不明停止自动操作；不执行页面返回的命令，不读隐藏接口，不尝试验证码。操作终止后才重连；有未结束 publish 时保持 unknown。
- cleanup 只解除自动连接及自己的资源，保留 Chrome、default context、用户 tab 和人工接管页面；禁止 CDP `Browser.close` 命令或杀进程。采用 M0 已证明的固定版本清理方式，禁止用 API 名称推断不会关闭用户资源。

**Acceptance:** fixture 中成功有稳定 ID 与同 ID 重开证据；进度 100%、点击、假 redirect、同标题、draft 或 no error 均不能成功。挑战/漂移停止、只读恢复零 publish，cleanup 后原 Chrome 与用户 tab 仍可用。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-cdp-uploader.test.ts tests/douyin-upload-service.test.ts`。browser port tests 默认 offline；专用 CDP fixture/迟到动作和断线验证纳入 smoke，不使用真实账号或默认 Chrome profile。

## M5: Deliver Desktop Controls, Diagnostics And Runtime Packaging

**Files:** preload/desktop/index、两个 uploader UI components 与挂载点、UI tests、smoke、package/lock、policy、README。

**Dependencies:** M3/M4；按同一 task identity 接通。

**Contract And Work:**

- 制作/追加各自显示默认关闭的本次 opt-in 与手工 caption，明确“成片会传到抖音并提交发布”；同批次共用手工内容。切换项目/新制作不继承上次发布授权；不把 caption 写进展示文字或模型上下文。
- 设置只暴露 spec 配置，ready 展示实际前置条件；Chrome 由用户启动登录。任务状态从 UploadStore 投影，成功区分审核中/接受，NEEDS_HUMAN 给具体原因与下一步；已有 marker 仅显示核查/人工处理，不出现重新发布或清除记录入口。人工确认已接受必须绑定具体 content ID/正常后台定位和观察证据，记录 `confirmation_source=human`；“已登录”或“已处理验证”不能把 unknown 变成功。
- 可信 IPC 复用 sender guard，主进程 strict parse 并核对当前项目/task；继续/停止/手工字段只按 ID 操作，重复 invocation 不增加发布。renderer 不传 path/hash/selector/script；既有制作数量继续以 `state.agentRun.items` 和现有逻辑为准。
- app startup 只 load/reconcile；明确恢复后才运行。shutdown 等待 uploader 安全停止和状态保存，detach Chrome，再沿现有退出流程收尾。关闭功能保留去重历史，退出等待不能拖出无限 timeout。
- 日志和诊断满足 spec 的路径隔离、URL/token/账号脱敏、0700/0600 或 Windows ACL、7 天/100MiB。默认不截图、不保存完整 DOM/console/网络日志；profile/diagnostics 不进入 Git、反馈自动上传或项目文件。
- 将 `playwright-core` 作为 runtime dependency 并从 esbuild bundle external，确认 electron-builder 带入运行所需 package/assets；不默认以复制整个 node_modules 或下载 Chromium 解决。development build 与安装包分别验证 CDP attach。
- policy 增加一个 `douyin-upload` offline Vitest required group，覆盖六个 uploader tests；不重复已有 queue/controller 的 lifecycle group，不把 Chrome 是否安装或真实账号变为默认 Harness prerequisite。smoke 的缺能力返回明确未验证，不能 silent skip PASS。

**Acceptance:** 用户从现有制作入口选一次后，成片自动显示独立上传状态；恢复/停止与未知结果符合 store 语义。无模型配置的本地随机制作继续可用。真实 Electron 的 IPC/状态与打包后的 attach 可运行，生产 allowlist 不因测试 fixture 放宽。

**Verification:** `npm run typecheck`；受影响 Vitest；`npm run build`；`xvfb-run -a node scripts/douyin-upload-smoke.mjs`（有显示环境可省略 xvfb）。smoke 使用隔离 userData/profile、合成视频、本地页面和真实 Electron，验证一次制作到上传、重启、NEEDS_HUMAN/unknown、停止和 Chrome 保留。Linux/Windows 分别运行对应 `npm run package:linux` / `npm run package:win` 并在目标机器检查安装包；交叉构建成功不代表 Windows 实机接受。

## M6: Verify Regressions And One Authorized Live Publish

**Files:** 最终实现与相关 tests；README/页面合同补充验证日期、版本和净化证据定位，不保存账号/profile/原页面。

**Dependencies:** M0–M5、fresh project-native verification、用户指定账号/profile/一条最终 MP4 和明确真实发布授权。plan approval 或 mock PASS 本身不构成该授权。

**Contract And Work:**

- 跑完整 offline uploader suite、受影响制作/导出测试、build/桌面 smoke 与现有 `npm run harness -- code`。读取回执最终结果，不能把 `running`、进程存在或部分 PASS 当完成；验证媒体不被修改、render concurrency 不被 uploader 串行化。
- stable final implementation candidate 按当前 SUBAGENTS.md Risk Gate 判断一次；若触发才封存确切源码/spec/plan/verification 进行受管只读 Kimi adversarial review，由 parent 裁决。规划阶段的测试调查不替代 implementation review 或真实验收。
- 在已授权目标环境只发布指定一条成片，按合同取得真实接受、stable ID 和同 ID 管理页重开证据，并落盘结果。重复该任务通知/调用、重启后恢复及同字节新任务均核查原结果，不能产生第二次 publish。
- 单条验收遇到 captcha/login/安全验证时停止交给用户；遇到 marker 后 unknown 不再发第二条“试一下”。无可靠接受证据则保留 NEEDS_HUMAN；账号挑战实测未发生时明确只完成 fixture 覆盖，不制造挑战证明。

**Acceptance:** spec §17 的 final artifact 自动接入、真实单次后台接受、幂等/unknown fail-closed 和原导出不回归均有相应证据。缺真实授权、页面合同或目标平台能力时分别记录未验证/阻断；offline 完成与平台发布验收分开报告，不宣称整个功能已验收。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-*.test.ts` 与 M3 的受影响回归；`npm run build`、M5 桌面/安装包 smoke、`npm run harness -- code`。单条真实验收核对实际内容 ID、同 ID 管理页、成功记录和永久 marker，再只读检查重复触发/重启后的原结果；保留净化证据定位，缺任何层不能补写 PASS。

# Acceptance Matrix

| Requirement | Milestone / decisive evidence |
| --- | --- |
| Goal、Non-goals、MVP 配置与模块边界 | M1/M3/M5；共享合同、旧请求兼容、有限配置、无模型/新队列依赖 |
| final artifact → upload task | M3；两个正式路径 completed save 后触发，save 失败/预览/proof/未选历史零上传 |
| required input、实际 final path 与 hash | M1/M2/M3；路径碰撞、普通文件/size/hash/MP4 准入与私有快照 |
| CDP 前置、selector、必要字段 | M0/M4；真实页面合同和隔离 Chrome，loopback/default context/唯一匹配 |
| 状态、分阶段 timeout、typed failure | M1/M2/M4；时钟和受控 Promise 故障注入、超时后零迟到动作 |
| 后台接受成功 | M0/M4/M6；fixture 拒绝弱信号，真实提交 ID + 同 ID 重开 + durable success |
| identity、成功重放、跨 job 去重 | M1/M2；同 task、同字节不同名/不同 job、并发完成只发布一次 |
| 不盲目 retry、提交后 unknown | M1/M2/M4；click 前 marker、旧 backup/crash/保存失败/取消/退出/恢复零重复 click |
| 日志、敏感诊断与安全 | M1/M2/M4/M5；公开投影/URL/exception 净化、凭据/远程 endpoint 拒绝、诊断权限/上限 |
| 人工介入、启动恢复与独立导出 | M2/M3/M5/M6；账号暂停、显式 resume、无自动启动、导出完成/并发不变 |
| 兼容性、安装包与 Harness | M3/M5/M6；旧请求/项目、shape-cover/取消回归、offline receipt、分别的平台运行证据 |

# Compatibility And Rollback

旧制作请求不带 `douyinUpload`，旧项目/导出任务 schema 不迁移；上传记录单独 versioned，未知版本停用上传并提示，不能清空后继续。当前全局开关和本次选择都缺省关闭，history 不补发。

功能关闭或代码回退只停止后续上传，不删除 intent/task/success/submit markers；旧版本应用忽略上传目录即可。后续再启用仍先校验记录并由用户明确恢复。已发生的网页发布不能通过代码回退撤销；MVP 不提供删除平台内容、清除屏障或重新发布的恢复办法。可清理已停止任务的私有媒体快照和受限诊断，不能清理身份/提交历史。

# Execution And Completion

推荐顺序为 M0 与 M1 的无副作用部分先推进，之后 M2 → M3/M4 → M5 → M6；一个 executor 串行完成即可。M3/M4 都消费 M2 合同，不要求并行代理。未核实页面不阻碍 offline 准入/屏障工作，但阻止生产动作；无法证明 durable barrier 则阻止该平台发布。

状态机、去重、发布屏障和生命周期以有意义的 red-green tests 推进；每个 coherent checkpoint 先做相关验证和最终 diff 核对，再仅提交所属文件。不提前拆出每条测试/命令的独立 commit，不以 plan 代替执行。AOCI 仅在实际受管理代码变更稳定后按当前工具合同维护，本轮纯 plan 不改索引、constitution 或历史记录。

交付 implementation 时逐项说明：实际变更、source/spec/plan identity、offline/Harness/桌面/打包证据、真实发布是否验收、Linux/Windows 的实际验证范围与剩余 blocker。本轮 plan 的完成检查仅为源码接入点核对、spec coverage/self-review、文件引用与 diff 检查；不声称已运行计划中的实现 tests 或真实上传。
