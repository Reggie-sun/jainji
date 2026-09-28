---
title: Jianji Qianchuan Upload Only Implementation Plan
status: proposed
implementation: not_started
date: 2026-09-27
source_baseline: 77b3de9898cdbd59789c5101424eda38ee53c3aa
spec_path: docs/douyin-auto-upload-spec.md
spec_version: 0.2
spec_sha256: 3873866c4089b8fd41354ffa6cec7b87dd6263bfaf084da07035a2bc1e79fdca
---

# Goal

接通“选择一个产品账号 → 现有制作和正式导出 → 自动上传该账号已有千川计划 → 停在确定前”。依据 [Spec 0.2](../../douyin-auto-upload-spec.md)，替换本计划旧 creator 自动发布目标。当前用户授权文档修订；本文不是实现、测试通过或真实上传授权。

# Scope And Invariants

- 保留 ExportQueue/JobStore/FinalArtifactCommitted、现有 upload service/store、私有快照、可信 IPC 和结果页。
- 六账号映射只读人工 JSON，每批默认关闭且明确选择一个；配置由主进程解析和冻结。
- 新路径只操作千川全域已有计划，不调用 creator publish，不点击确定，不改变广告设置。
- ready 为 WAITING_FOR_CONFIRMATION；fence 后未知只读核查，零自动重传。
- 同批一个任务 tab，全局一个串行 runner，FFmpeg 继续独立并发。
- v1 creator 历史及 marker 保留并隔离；v2 默认关闭，不自动迁移授权或旧 pending。
- 不改 Project/ExportTask 格式、模型、渲染、登录、Chrome launcher 或账号配置实际内容。

# Current And Target Behavior

现有 UI 已把 douyinUpload 交给 registerBatch；两条正式完成事实通知调用 committed。service 当前 execute 会上传、fill、markSubmitting、publish、verify、accept，生产 creator contract 仍为空；配置只包含一个 endpoint/creator route。测试 CLI 能读取六账号文件并核对真实页面，但不与应用连接。

目标改造现有 owners 的上传语义，并抽出有限千川页面/账号规则。代码文件保留旧 douyin 命名以减少无关 rename；用户界面使用“千川上传”。不复制 service/store 或重新实现导出通知。本计划中的新增测试/fixture 为实施目标，不表示已经存在。

# File Structure And Ownership

| Paths | Action / Responsibility |
| --- | --- |
| `src/shared/qianchuan-account.ts` | Create：六产品与人工配置的 strict schema、映射可用性、共同解析 owner |
| `src/main/qianchuan-account-config.ts` | Create：授权文件读取、权限/大小限制、摘要与冻结映射 |
| `scripts/qianchuan-account-config.mjs`、`tests/qianchuan-account-config.node-test.mjs` | Modify：诊断 CLI 消费同一解析规则；保留 --check / --open 不上传语义 |
| `src/shared/douyin-upload.ts` | Modify：accountProduct 选择、v2 target/settings、待确认状态、ready evidence、typed failure |
| `src/main/douyin-upload-store.ts` | Modify：v2 identity、目标去重、upload-selection fence、v1 原字节隔离、恢复 |
| `src/main/douyin-upload-service.ts` | Modify：冻结账号、原产物准入、单 runner/batch tab、ready/未知恢复；退休新任务 creator publish 链 |
| `src/main/qianchuan-page-contract.ts` | Create：仅 /uni-prom 的有限语义及 account/plan/modal/ready guard；不拥有 durable 状态 |
| `src/main/douyin-cdp-uploader.ts` | Modify：复用 loopback transport 与停止；新任务消费千川页面合同，不保留生产双路径开关 |
| `src/main/index.ts`、`src/main/preload.ts`、`src/shared/desktop.ts` | Modify：配置文件对话框/刷新摘要、可信 IPC、装配和状态；不含 selectors |
| `src/shared/agent.ts`、`src/main/agent-controller.ts` | Modify only if needed：新选择准入、冻结到 registerBatch；不发给模型，assisted 拒绝保持 |
| `src/renderer/DouyinUploadControls.tsx`、`src/renderer/DouyinUploadPanel.tsx` | Modify：账号选择、配置入口、上传/待确认状态；去除 creator caption/提交发布交互 |
| `src/renderer/App.tsx`、`src/renderer/AppendProductionDialog.tsx`、`src/renderer/ResultsPanel.tsx` | Modify only seams：共享账号摘要、选择重置、追加独立授权与结果投影 |
| `tests/douyin-upload-contract.test.ts`、`tests/douyin-upload-store.test.ts`、`tests/douyin-upload-service.test.ts` | Extend/replace affected assertions：v2 严格合同、旧格式、fence 与 ready；保留导出/停止保护 |
| `tests/douyin-upload-integration.test.ts`、`tests/douyin-cdp-uploader.test.ts`、`tests/douyin-upload-ui.test.ts` | Modify：产物与千川 browser/UI 集成证据 |
| `tests/qianchuan-account-config.test.ts`、`tests/qianchuan-page-contract.test.ts` | Create：文件准入/冻结与有限页面 guard |
| `tests/fixtures/qianchuan-upload-page.html`、`tests/helpers/douyin-cdp-fixture.ts`、`scripts/douyin-upload-smoke.mjs` | Create fixture / adapt helpers：多账号与批次本地模拟，确认计数零；真实 Electron 路径 |
| `.agent/harness/policy.json`、`README.md`、`docs/qianchuan-cdp-test.md` | Modify during implementation：相关检查组、用户操作说明与分层证据 |

原 queue.ts 已具备完成 seam，默认不修改；如发现 seam 回归先用现有 integration tests 复现，不能为方便 uploader 改其验证顺序。旧 creator 页面合同文档保留历史证据，README 指向新用法。现有 playwright-core@1.63.0、external 和打包配置复用，不默认升级/装另一套 Chrome。

# Compatibility And Workspace

每个实施 checkpoint 重新检查 git status、live agent 和 exact ownership。目前 index/preload/App/ResultsPanel/shared agent/agent-controller 等有无关未提交改动；本轮文档不碰它们，实施写这些文件前必须按用户规则解决同文件 ownership，不能把这些改动当作本任务或覆盖它们。无需创建 worktree。

普通不带 douyinUpload 的旧请求保持有效；旧 caption-only 上传请求明确要求重新选择。v1 ledger 严格读取、保存原字节 legacy-v1.json 与原 markers 后写 v2，未知/失败阻断；旧 accepted/unknown 不重新解释。rollback 停动作并保留记录，旧程序不得通过 backup 获得许可。

# Major Milestones

## M1: Shared Account And Request Contracts

**Files:** shared/qianchuan-account、main/qianchuan-account-config、shared/douyin-upload、诊断 CLI 与账号/contract tests。

**Contract:** spec §4–5、§9。原六项 JSON 导入格式和 strict 私有读取保持；2026-09-29 用户修订为简辑软件内设置，日常点产品、粘贴计划链接、识别并保存。原 M1 已实现，不重新开始该 milestone。

**2026-09-29 Native Account Settings Addendum**

- **Goal / Current → Target:** 原来必须选择外部配置文件且不能在软件内换计划；改为内部持久设置，已有文件一次性导入。用户只点产品、粘贴计划链接；端口由程序识别，不需要用户填写。
- **Owners / Files:** 共享 `qianchuan-account.ts` 定义 URL/setup/partial internal schema；现有 `qianchuan-account-config.ts` 保留安全读取；新增 `qianchuan-account-settings.ts` 独占内部映射及导入/原子保存；service 复用该来源及原 store/configPath；index/preload 只增加 trusted 账号设置 IPC。新增 renderer `QianchuanAccountSettings.tsx`，现有 upload panel/controls/CSS 接入；不编辑其他 owner 的 ResultsPanel/App/agent files。
- **Compatibility / Invariants:** 六产品和外部六项格式不变；旧授权路径一次性导入，内部 mapping 存在时为唯一来源，损坏不 fallback。旧 intent/任务目标不变，预检 digest 改变拒绝新 intent。账号管理不选文件上传、不自动启用或选择每批账号、不改永久 fence。未实施的环境变量引导候选撤回，不作为正式 runtime path。
- **Acceptance:** 长链接精确识别字符串 IDs；假 origin/credentials/重复参数/非法 ID/非loopback或重复绑定均拒绝；保存后重启读回，删除外部文件不影响内部设置，原文件字节不变；原已注册批次使用旧计划，保存前后无真实浏览器动作。
- **Verification:** 账号设置/shared reader/service/UI/store/contract/integration tests 与 typecheck；隔离 Linux Electron 实际 UI→preload→IPC 保存、关闭再启动恢复，默认关闭且任务为零。真实 JSON 只读导入可核对，真实上传与 Windows out of scope。required production-adapter review 继续 `REVIEW_ESCALATION_REQUIRED`，不重置原三轮预算。

**2026-09-29 Automatic Browser Binding Addendum**

- **Owner / Files:** `qianchuan-account-settings.ts` 继续独占保存；新增 `src/main/qianchuan-browser-discovery.ts` 只负责有界、只读连接识别。共享 setup schema 与 renderer 删除端口输入；原 mapping/frozen target 格式不变。tests 使用隔离进程元数据和本机 HTTP fixture。
- **Contract:** 同账户已绑定产品保留原 endpoint；首次绑定或账户改变时识别当前用户 Chrome/Chromium 主进程的显式调试端口或其 DevToolsActivePort，有限读取 loopback `/json/list`，以唯一千川 aavid 选连接。URL 仅定位候选，不能替代 uploader 可见身份检查。零匹配、重复匹配、超时、非 loopback、重定向及非法元数据拒绝，不保存猜测结果。
- **Boundaries:** 不读取登录文件，不启动或重启真实 Chrome，不扫描固定端口，不改 uploader/queue/fence，不重定向旧批次。未启用调试连接的浏览器明确提示不可连接；本轮无真实上传或 Windows 验证。
- **Acceptance / Verification:** 首次保存不传端口且自动得到唯一连接；同账户换计划无需浏览器动作；换账户重识别；歧义及无连接保持原 mapping 字节；伪造端口输入拒绝。运行 discovery/settings/UI/service tests、typecheck/build，以及隔离 Chrome/Electron 实际点击和保存；AOCI 在稳定状态对齐。

**Acceptance:** 错 JSON、重复绑定、权限/大小/symlink、非法链接、未绑定浏览器均拒绝；main 重新校验设置输入。预检与 registerBatch 之间 mapping 变化拒绝初始化，已冻结任务保持原目标。caption-only 请求不变成千川上传许可。

**Verification:** `npm run typecheck`；`npx vitest run tests/qianchuan-account-config.test.ts tests/douyin-upload-contract.test.ts`；`node --test tests/qianchuan-account-config.node-test.mjs`。主进程正常 import TS 解析器；诊断 CLI 使用已安装 esbuild 的内存 bundle（`write:false`）载入同一解析器，不落盘编译产物，不额外引入 runtime dependency。

## M2: Versioned Ledger And Upload Selection Fence

**Dependencies:** M1。
**Files:** store、store tests；服务仅补新 identity/target 类型 seam。

**Contract:** spec §8。v2 identity 绑定正式任务、hash、advertiserId/adId，intent key 阻止同 task 换目标。同目标 hash 去重，跨目标证据隔离；旧 creator state/marker 只读隔离。调用选文件前持久化不可覆盖 selection fence，未知时无重传许可。

**Acceptance:** 故障注入证明 fence 创建/文件 sync/目录 sync 失败零选文件；原字节 migration、恢复中断、旧备份/孤立 marker/坏版本均保守停止。ready 保存失败保留 MAY_HAVE_UPLOADED，重启不创建第二次选择许可。旧 v1 pending 零浏览器动作，新 enabled=false。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-upload-store.test.ts tests/douyin-upload-contract.test.ts`；保留真实独立进程 fence 后退出注入。Windows 未证明目录 durability/ACL 时明确阻断，不用 Linux/mock PASS 替代。

## M3: Upload Only Browser And Batch Execution

**Dependencies:** M1–M2。
**Files:** qianchuan-page-contract、cdp uploader、service、page/browser/service tests、千川 fixture、现有 helper。

**Contract:** spec §6–8。同批冻结计划共用专用 tab，单 runner 逐个消费 completed MP4；原产物准入/快照/通知隔离保留。生产 origin/route 严格限制千川，页面合同 source-owned，不把 CLI 动态 UID 或 creator selectors 直接放行。

**Implementation Notes:** 在 iframe/drawer/modal 的正确上下文唯一定位，先核对可见 account/plan 和整批容量；不选择“首个计划”。调用选文件前写 fence；在拥有的上传列表核对逐条文件、数量、ready 与错误。新 port 的业务操作仅 connect/open/upload/waitReady/readOnlyCheck/stop，删除新任务的 fill/publish/verify-accepted 调用，不能只替换 URL 仍进入旧 publish 链。

**Acceptance:** 多个 render 并发完成仍按单 runner 上传并保留 FFmpeg 并发；整批容量不足零选文件。目标变化、旧同名素材、弹窗被人工确认/关闭、验证码或结构漂移停止；fence 后 disconnect、late Promise、timeout/cancel 与重启均零重传。每条 WAITING_FOR_CONFIRMATION 保存 ready evidence，任何 scenario 确认计数恒为零。

**Verification:** `npm run typecheck`；`npx vitest run tests/qianchuan-page-contract.test.ts tests/douyin-cdp-uploader.test.ts tests/douyin-upload-service.test.ts tests/douyin-upload-integration.test.ts`；本地专用 Chrome CDP fixture 实测上传、批次容量、迟到动作与 detach 保留 Chrome/tab。真正页面语义无法可靠定位时生产合同保持阻断，不能用模拟页面证明可用。

## M4: Desktop Selection And User Handoff

**Dependencies:** M1–M3。
**Files:** index/preload/desktop、shared agent/controller 必要 seam、两上传控件、App/AppendProductionDialog/ResultsPanel、UI tests、Electron smoke。

**Contract:** spec §1、§5、§9。设置读取授权配置并展示六产品摘要；每次制作/追加明确选一个，初始/切项目/提交后清空。请求入口在模型/入队前验证，不发送账号给模型。结果页分离导出完成、上传中、待 Chrome 确认及人工问题。

**Acceptance:** UI 不显示 creator caption/提交发布，不提供自动确认按钮。文件对话框授权与 strict IPC 实际走 production preload；错误任务跨项目操作被拒绝。旧 confirm/caption API 对新任务失败，legacy 仅只读。关闭功能停止新动作且保留历史，重启零自动连接，新 completed 不唤醒旧 pending。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-upload-ui.test.ts tests/douyin-upload-integration.test.ts tests/agent-controller.test.ts tests/append-production-queue.test.ts`；`npm run build`；隔离 Electron smoke 实际选择账号 → FFmpeg 正式完成 → 本地千川 ready，确认计数零；核对切项目、追加、配置更改、恢复/停止。Chrome MCP 验证实际界面交互，默认不接真实账号。

## M4 Addendum: Cross-template Batch Upload

**Goal / Current → Target:** 用户已授权将批量制作接入千川；当前批量只导出，目标为逐模板显式选产品账号、正式成片自动上传并停在确定前。

**Owners / Files:** `src/shared/batch-production.ts` 增加 strict 可选 selection 及只读结果类型；`src/main/batch-production-controller.ts` 在整批冻结时预检并只在内存保留授权，过滤详情 task，取消转交既有上传 owner；`src/main/batch-production-runtime.ts` 向各项既有 AgentController 注入原 register/preflight seam；`src/main/index.ts` 装配同一 service。现有 `douyin-upload-service.ts` 增加仅主进程可调用的按 project/task 停止接缝，阻断取消后的迟到通知，不改 durable identity/fence。`src/renderer/BatchProductionPanel.tsx` 复用上传控件的简洁账号下拉框、提交后清空选择；`BatchProductionDetails.tsx` 展示本项上传状态；普通和批量结果共用 `qianchuan-upload-status.ts` 的状态文案。不修改其他任务拥有的 shared agent/controller/runner/ResultsPanel，不增上传队列或页面逻辑。

**Contracts / Compatibility:** 每项独立 pageBatchId、冻结目标及精确 expectedCount；旧请求/记录无选择则不上传。整批预检先于首次模型/入队；非 MP4 和失败预检拒绝该项。授权不进入保存项目或模型。后续 mapping 改变仍由 registerBatch digest guard 拒绝，不重选新目标。状态投影限定 projectId 及该项 taskIds，不新增跨项目继续/确认 API；取消只停止本项上传，ready/fence 保留。原上传暂停和未知零重传不变，制作完成不代表上传完成。

**Acceptance / Verification:** schema 拒绝伪造目标/未知账号/旧 caption；controller 测试无选择零预检、全项先预检、失败项零制作、只读 task 过滤、独立授权及取消/恢复；runtime integration 使用原 service/store 和实际 FFmpeg 正式通知。运行相关 batch/upload tests、`npm run typecheck`、`npm run build`、`npm run harness -- code`；隔离 Electron 实际勾选两模板、选择账号、10 条跨组上传、零确认/广告设置、未知阻断及重启防重传。仅 fixture，无真实视频新增上传、无 Windows 验证。稳定修改后维护 AOCI，并单独判断新接缝风险；原生产 adapter 的 `REVIEW_ESCALATION_REQUIRED` 不被本次证据清除。

**Self-Review:** 对照 spec §1 批量扩展及 §5–9，保持原导出与上传 owner；实施和验证仍须使用当前源码，旧 implementation metadata 不代表现状。

## M5: Regression, Packaging And Authorized Live Acceptance

**Dependencies:** M1–M4；真实测试须指定产品/正式 MP4 和上传授权。
**Files:** 最终候选、相关 tests/Harness、README 与千川 evidence；原历史记录不改成新验收。

**Contract:** spec §10；项目 verification-before-completion 与风险规则。真实验收来自应用入口，不只运行 --open 或手工 CLI。只上传指定文件并停“确定”前，不以真实提交验证功能；六账号人工测试只作为既有边界证据。

**Acceptance:** 完整 offline 回归、isolated desktop/CDP、打包与 Harness 分层报告。至少一个已授权账号完成应用到千川 ready 的真实路径；其余账号的 fixture/历史人工/应用 live 证据明确区分，不宣称全部自动接入验收。未知不试第二条、不清 fence，人工挑战保留页面。

**Verification:** `npm run typecheck`；`npx vitest run tests/douyin-*.test.ts tests/qianchuan-*.test.ts tests/queue.test.ts tests/append-production-queue.test.ts`；`npm run build`；`xvfb-run -a node scripts/douyin-upload-smoke.mjs`（有显示环境可省略 xvfb）；`npm run harness -- code`，等待最终 receipt。Linux `npm run package:linux` 后验证包内 Playwright 的本地 attach；Windows `npm run package:win` 构建与 Windows 实机/权限分别报告，未 qualification 保持阻断。

stable implementation 完成 project-native verification 后，按 SUBAGENTS.md Risk Gate 判断是否需要独立 Kimi adversarial review；本轮源码 mapping 不替代该判断，不因文档存在默认增加 reviewer。

# Acceptance Matrix

| Spec sections | Milestone |
| --- | --- |
| §1–3 目标、旧路径退休、owner、既有证据 | M3–M5 |
| §4 账号 JSON、授权读取、冻结、共同解析器 | M1 / M4 |
| §5 每次选择、追加、模型隔离、正式产物 | M1 / M3 / M4 |
| §6 目标/弹窗/容量/tab/timeout/停止 | M3 |
| §7 ready evidence、零确认、状态与 UI | M2–M4 |
| §8 identity、fence、只读恢复、旧格式与回滚 | M2 / M3 / M5 |
| §9 安全、IPC、用户交接、私有诊断 | M1 / M3 / M4 |
| §10 验收与分层实际证据 | M5 |

# Self-Review And Execution Handoff

已按 spec 逐节检查 coverage、名词与方法一致性、可执行验证 seam 和旧路径退休。没有把 WAITING_FOR_CONFIRMATION 写成 SUCCEEDED，也没有把新 fence 写成 creator 提交许可。目标文件为实施清单；本轮只修改此 plan 和 spec，保留所有无关 working-tree 改动。

推荐 Native Codex 在当前 working tree 串行执行 M1 → M2 → M3 → M4 → M5；仅在解决具体不确定性时采用有限 delegation。实际行为用有意义的 regression/fault-injection tests 验证；当前 docs-only 不运行无关 tests，也不制造新真实上传记录。获准实施后重新核对 workspace ownership 与当时源码，不以本计划授权覆盖其他 writer。
