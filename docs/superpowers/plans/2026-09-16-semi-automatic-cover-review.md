# Semi-Automatic Cover Review Implementation Plan

## Status And Goal

- Status: `draft / not executed`，2026-09-16。
- Baseline: `main@6560f2c`；本次只新增计划，不实施、不运行模型、不启动或重启桌面应用。
- Spec: [Semi-Automatic Sticker Cover and Independent Review v0.1](../../semi-automatic-cover-review-spec.md)。REQ / AC 编号均引用该规格，不另建需求来源。
- Goal: 先让用户完成候选编辑、动态预览和确认导出，再以证据决定是否增加独立复核及一次修正。
- Scope: 显式 `assisted` 模式、持久审阅草稿、人工编辑、冻结方案预览、批准与幂等入队、可选复核和离线评测。
- Out of Scope: 修改现有严格自动判定、固定四角定位、擦除原画面、新模型训练/权重/依赖、默认商业调用、第二套任务队列及本次生产接入。

本计划不把写 spec/plan 等同于用户批准实现。后续明确开始实施时，先复核代码基线、ownership 和未提交改动；在当前工作目录使用 feature branch，不自行创建 worktree。只提交该实施阶段文件，保留已有项目 JSON、bak、tmp 和无关研究稿。

## Current Behavior And Constraints

本次核对了 spec 及以下代码事实；结构工具 `codegraph` / `tool_search` 在当前工具清单中均不可用，因此使用限定范围源码阅读，不声称完成全仓调用图扫描。

| Current evidence | Implementation consequence |
| --- | --- |
| `src/shared/cover-sticker.ts` 仅有 `manual` / `agent` | 新模式必须显式分派，不能掉进 manual 分支 |
| `AgentRunner.execute` 在 materialize/覆盖/角落补齐后直接 `enqueue` | 必须拆开“准备冻结方案”和“提交导出”，不是在现有调用后补弹窗 |
| `ExportQueue.createBatch` 每次生成新 UUID，先保存 job 再返回 | 批准重放和跨文件崩溃恢复必须在队列 owner 内去重 |
| `ProjectSchema`、`QueueStateSchema`、`ExportBatchSchema`、`EditTemplateSchema` 共用 `SCHEMA_VERSION = 1` | 不能简单全局加一并让旧模板/任务失效；需要按持久化边界迁移 |
| `readValidatedJson` 对 future schema 明确拒绝，但解析失败可能尝试备份恢复 | 新格式必须有明确版本，不能靠未知字段解析失败来保护降级读取 |
| `TemplatePreview.tsx` 为静态示意背景，并非源视频最终模板 | 保留示例用途，新增实际冻结模板预览，不能复用其“看起来相似”作为验收 |
| `automatic-cover.ts` 最后清理临时抽帧 | 审阅所需证据须在清理前由独立 owner 保存并绑定摘要 |

Hard invariants: 原视频顺序/时长/音频不变；展示文字只能由用户填写；覆盖开关默认关闭；`agent` 不隐式回退；未知不等于消失；模型不能执行工具或批准导出；修改输出相关设置使批准失效；正式任务重试不重新调用模型；Key 不进入日志、项目或证据。

## Boundaries And File Ownership

以下新增路径是计划目标，不代表文件已存在。实现不得为了满足文件名额外制造抽象；同一职责只能有一个 owner。

| Boundary | Existing files | Proposed focused files / responsibility |
| --- | --- | --- |
| 数据与兼容 | `src/shared/cover-sticker.ts`、`src/shared/agent.ts`、`src/main/domain.ts`、`src/main/store.ts` | `src/shared/cover-review.ts`：草稿/问题/命令/批准数据；`src/main/state-migrations.ts`：已知旧格式到当前格式迁移 |
| 候选与证据 | `src/main/automatic-cover.ts`、`src/main/cover-track-provider.ts`、`src/main/automatic-cover-tracks.ts` | `src/main/cover-candidates.ts`：候选适配，不输出已批准模板；`src/main/cover-review-evidence.ts`：PTS、原分辨率证据及受控文件生命周期 |
| 审阅准备子状态 | `src/main/agent-controller.ts`、`src/main/application.ts` | `src/main/cover-review-session.ts`：状态转换、修订、人工决定与准入；依附现有制作生命周期，不管理导出任务 |
| 方案准备 | `src/main/agent-runner.ts`、`src/main/agent-provider.ts`、`src/main/cover-sticker.ts`、`src/main/automatic-corner-layout.ts` | `src/main/agent-template-preparation.ts`：抽取现有单版本 materialize/覆盖/补齐共同路径；新旧模式共同消费 |
| 预览与批准 | `src/main/queue.ts`、`src/main/compiler.ts`、`src/main/artifact.ts` | `src/main/cover-review-preview.ts`：预览请求与冻结模板绑定；`src/main/cover-review-approval.ts`：摘要及批准校验纯逻辑；队列仍独占执行/任务去重 |
| UI / IPC | `src/renderer/App.tsx`、`CoverStickerPanel.tsx`、`CoverTrackEditor.tsx`；`src/shared/desktop.ts`、`src/main/preload.ts`、`src/main/index.ts` | `src/renderer/CoverReviewPanel.tsx`、`CoverReviewTimeline.tsx`：集中审阅、时段与帧导航；IPC 只暴露受校验的领域命令 |
| 可选复核 | `src/main/model-connections.ts`、`src/main/connection-store.ts`、`src/shared/connections.ts` | `src/main/cover-review-provider.ts`：隔离视觉请求/响应；轮次和预算仍归 session owner |
| 验证工具 | `tests/`、`scripts/` | 新增测试及 `scripts/assisted-cover-smoke.mjs`、`scripts/assisted-cover-evaluate.mjs`；运行证据写 `/home/reggie/jianji-validation/` 新目录，不提交原片/密钥 |

移除/替换的旧路径仅为抽取后的重复方案准备逻辑；旧 `manual` / `agent` 的外部行为保留，不把旧严格识别和新草稿识别串成两次调用。实验脚本不直接成为 production import，也不新增第二套素材/连接/项目 store。

## Implementation Decisions

### Draft And Persistence

1. 项目持有草稿和批准摘要；大图片/预览放 `userData/cover-review/<projectId>/<draftId>/<revision>/`，由 evidence owner 统一管理。引用只接受受控目录内文件并校验摘要。缺失、磁盘写入失败或摘要不符使草稿不可批准，不清理源视频。
2. 草稿引用中的证据不自动清理；临时未引用文件在本次会话结束后清理。完成/放弃草稿的证据仅通过显式清理操作回收，清理前检查引用；首版不增加后台定时 GC。写入前估算空间，空间不足明确停止，不删除其他草稿腾位置。
3. 拆分项目、队列状态/批次、模板的版本常量。项目与带新提交元数据的 queue/batch 使用新版本；模板格式及旧冻结渲染语义保持原版本。旧项目、嵌套旧批次、独立 job 通过已知迁移读取，未知未来版本保持 `future_schema`，不得进入“损坏文件”隔离/备份回退。
4. 主进程对每个编辑命令校验 project/media ID、expected revision、状态和几何；写后修订递增并使相关批准失效。主进程是唯一运行时状态 owner，UI 只持有可丢弃编辑缓冲。重启不自动请求模型或提交任务。

### Candidate And Selection

1. 首版适配现有视觉抽帧/检测能力为不可信候选，不在该里程碑重新攻关一个定位模型。严格聚合失败保留可展示的证据和错误；格式非法的边界不得变成可执行轨迹。零候选要求用户明确补框或不覆盖。
2. 全画面采样及所有坐标记录原始帧 PTS、分辨率、旋转/缩放映射；近出现/消失或切镜处提供逐帧导航，不把切镜当作消失。抽样外 presence 保持未知。
3. 半自动改变几何准入，不自动改变选材规则：本轮统一覆盖款复用当前自动覆盖候选池与轮换；人工框只决定几何/时段，不代替选材。无可用素材时预览准备失败，不使用固定兜底。
4. 身份与可见 segment 分离。转换使用现有单区间轨迹及 `[startMs,endMs)`；PTS 到毫秒边界需要在原帧与输出帧上测试，不通过简单四舍五入制造额外出现/消失帧。不可表达时人工调整或失败。

### Preview And Export Handoff

1. 按当前实际模板和输出设置生成动态预览；不再调用创作模型，不把静态 `TemplatePreview` 升格为最终证据。
2. 预览复用现有 compiler、FFmpeg 执行资源调度和 verifier。给现有队列 owner 增加**临时预览执行入口**：只生成受控缓存，不创建 `ExportBatch`、不登记成片、不发布到用户输出目录、不自动恢复。这里区分资源调度中的预览工作与 spec 禁止的“未批准创建正式导出任务”；不能用第二个导出队列或直接无约束 spawn 绕过。
3. 单次只准备一个版本预览，所有版本按需串行完成；最终确认要求全部版本冻结且对应动态预览可用。预览与导出共享同一编译路径和渲染参数；缓存绑定源/资产/模板/preset 摘要，改稿立即失效。不能因缓存失败允许确认。
4. 先持久化包含稳定提交 ID、逐素材版本键、冻结模板摘要的批准意图，再调用现有 `ExportQueue`。队列以 `submissionId + mediaId + version` 去重，把键和对应任务 ID 与 job 一起持久化；相同键/相同摘要返回原任务，不同摘要明确冲突。
5. 同一提交键的并发创建在队列内串行或共享同一 promise。job 保存成功而项目回执保存失败时，恢复通过 job 的提交键反查，不重新随机创建。提交路径的去重须覆盖所有异步等待窗口，而不只查询一次内存 Map。
6. 批准只允许提交其冻结版本集合。恢复先核对已入队任务，未入队版本需用户显式继续；对已入队任务保留现有中断/重试规则。不得创建“自动重试批准”后台流程。

## Major Milestones

执行顺序：`M1 → M2 → M3 → M4 → M5 → M6 → M7`。M1–M5 对应 Phase 1，M6 对应 Phase 2，M7 对应 Phase 3。默认单 writer 串行；后续只有精确文件集合不相交才适合委派，不能按表中逻辑模块直接假定可并发。

### M1 — Contracts, Mode Dispatch And Migration

**Files:** 新增 `src/shared/cover-review.ts`、`src/main/state-migrations.ts`；修改 shared cover/agent、domain/store、controller/application/IPC 入口中涉及模式分派的部分；新增 `tests/cover-review-schema.test.ts`、`tests/state-migrations.test.ts`。

**Contract:** REQ-01–03、17–21。定义草稿、人工决定、问题、证据引用、冻结版本与批准记录；状态只允许 spec 转换，显式区分取消、失败、过期。先更新所有 mode 使用方再允许保存 `assisted`，避免兼容阶段把它当 manual。

**Acceptance:** 旧项目/旧单框/旧 job 读取不改变输出；新数据可往返保存；future schema 不被覆盖或隔离。关闭覆盖零识别/复核请求。此阶段半自动制作入口仍明确“尚不可制作”，不暴露半成品导出路径。

**Verification:** `npm run typecheck`；`npm test -- tests/cover-review-schema.test.ts tests/state-migrations.test.ts tests/store.test.ts tests/cover-sticker.test.ts tests/agent-controller.test.ts tests/product-price.test.ts`。先写未知模式误入 manual、旧备份覆盖未来版本等失败测试，再实现。

### M2 — Candidate Draft, Evidence And Recovery

**Depends on:** M1。

**Files:** 新增 candidates/evidence/session 模块；适配 automatic-cover/cover-track-provider；修改 application/domain/store 的草稿保存衔接；新增 `tests/cover-candidates.test.ts`、`tests/cover-review-session.test.ts`、`tests/cover-review-evidence.test.ts`。

**Contract:** REQ-02、13–17、19、21。算法结果与人工工作稿分开保存；已有严格识别函数的成功/失败合同不改变。先建立 evidence manifest，校验并固定引用后才允许临时抽帧清理。分析阶段启动前冻结并显示抽帧请求批次及上限，失败也计数，不静默扩批或重试。每个响应绑定 runId/revision，晚到响应丢弃。

**Acceptance:** 5.25 秒失败点可保存为“分析未完成”的可审阅证据，不产生合法覆盖结果假象；取消、切换项目、重启与保存乱序不覆盖新草稿。非法候选只能作错误证据，不能进入轨迹编译。文件缺失使旧批准失效。

**Verification:** `npm test -- tests/cover-candidates.test.ts tests/cover-review-session.test.ts tests/cover-review-evidence.test.ts tests/automatic-cover.test.ts tests/project-sync.test.ts`。使用本地伪服务/固定响应，不调用真实视觉账号；注入抽帧失败、取消、旧修订返回、摘要失配和磁盘写入失败。

### M3 — Human Editing And Timeline

**Depends on:** M2。

**Files:** 新增 `CoverReviewPanel.tsx`、`CoverReviewTimeline.tsx`；按职责复用 `CoverTrackEditor.tsx`；修改 App、CoverStickerPanel、desktop/preload/index；新增 `tests/cover-review-commands.test.ts` 及 `scripts/assisted-cover-smoke.mjs` 的编辑场景。

**Contract:** REQ-04–06、14–16。支持全画面新增、改完整边界、删除误框、身份拆合、区间拆分/起止编辑、逐帧查看、明确不覆盖；主进程执行相同校验。无确定答案的项由用户显式处置，不默认批量忽略。

**Acceptance:** 无候选也能人工建稿；能删除商品误框并补上画面中部漏框；两个可见区间之间无插值。字幕/商品误识别有明确来源标签，人工接受不会改写机器原始 presence。尚未确认不可导出。

**Verification:** `npm test -- tests/cover-review-commands.test.ts tests/per-media-cover.test.ts tests/manual-cover-regions.test.ts tests/cover-review-session.test.ts`；在隔离桌面 profile 使用 Chrome MCP 验证播放/逐帧/窄窗口/多素材切换和实际 IPC，并保存操作截图。M5 前 smoke 只覆盖编辑，不声称端到端已通过。

### M4 — Frozen Preparation, Preview And Idempotent Approval

**Depends on:** M2、M3；这是 Phase 1 的关键交接点。

**Files:** 新增 preparation/preview/approval 模块；修改 runner/controller、queue/domain/store、index/preload/desktop 和审阅 UI；新增 `tests/cover-review-preview.integration.test.ts`、`tests/cover-review-approval.test.ts`、`tests/assisted-cover.integration.test.ts`；扩展 `tests/queue.test.ts`。

**Contract:** REQ-03、07–08、13、17–20。从 runner 抽取共同准备逻辑；旧模式仍按原时序提交，新模式在准备后暂停。复用 materialize、选材轮换、覆盖底板及角落补齐；全部版本模板进入不可变快照。正式导出只允许通过主进程批准准入，预览缓存不是任务。

**Acceptance:** 所有版本动态预览与冻结方案对应；任何输出相关编辑或素材/贴纸变化都会失效。重复 IPC 返回原任务，批准与 job 两次保存之间崩溃也无重复导出。取消后不新入队；已在取消前持久化的任务按现有队列取消，不丢失回执。导出重试的模型请求数为零。

**Verification:** `npm test -- tests/cover-review-preview.integration.test.ts tests/cover-review-approval.test.ts tests/assisted-cover.integration.test.ts tests/agent-runner.test.ts tests/queue.test.ts tests/cover-render.integration.test.ts tests/four-corner-coverage.test.ts`。在意图保存前后、job 保存前后、回执保存前后逐点故障注入；并发重复点击；模拟关闭应用再恢复。真实 FFmpeg 核对同模板关键帧、区间端点、VFR 映射及半透明上传素材的不透明底板。

### M5 — Phase 1 Release Evidence

**Depends on:** M1–M4。

**Files:** 完成 `scripts/assisted-cover-smoke.mjs`；新增 `scripts/assisted-cover-evaluate.mjs` 的清单/结果记录能力；更新 README 与 AGENTS 中新模式的最小产品说明；新增 `docs/semi-automatic-cover-validation.md` 作为实施验证报告，不把 runtime 状态塞回本 plan。

**Contract:** G1/G2/G4；Phase 1 对应 AC-01–03、08–15、17。脚本放仓库 `scripts/`，大帧/视频和运行证据放独立 validation 目录。继承现有 smoke 的隔离 profile、模拟连接与临时项目，不触碰当前桌面或真实项目。

**Acceptance:** 完成一条“候选失败→人工补框/时段→每版动态预览→批准→真实导出→冻结重试”的全流程；另测覆盖关闭、manual、严格 agent 拒绝的回归。分别记录模拟服务、真实媒体、界面行为及用户播放确认，不宣称真实模型或 Windows 验收已完成。

**Verification:** `npm run typecheck`、`npm test`、`npm run build`；`node scripts/assisted-cover-smoke.mjs` 和 `node scripts/vision-connection-smoke.mjs`。无显示 Linux 用 `xvfb-run -a` 运行隔离脚本。构建仅允许本地已有依赖/资源验证；若缺少资源需下载，先报告 blocker，不扩大授权。报告 ffprobe、逐帧对比和实际操作证据；无 Windows 实机时标注未验证。

### M6 — Independent Review Pilot

**Depends on:** Phase 1 有效交付证据；复核默认关闭。

**Files:** 新增 `src/main/cover-review-provider.ts`、`tests/cover-review-provider.test.ts`、`tests/cover-review-budget.test.ts`；扩展 session、共享 review schema、连接角色选择、审阅 UI 及 evaluate 脚本；验证记录追加到 M5 的报告。

**Contract:** REQ-09–11、13、22；本阶段一轮、零自动修正。先盲检请求并校验持久化响应，再发送候选核对请求。盲检不携带候选 ID/标注/旧结论；两个请求批次都计入冻结预算。异常不能被解释为无问题。

**Acceptance:** 两个模型一致也不能批准导出；超时、402、非法 JSON、证据缺失或预算耗尽要求人工明确处置，不重试/换服务。复核报告候选外问题但不直接写模板。连接快照在运行期间冻结，Key 不进入任何草稿或日志。

**Verification:** `npm test -- tests/cover-review-provider.test.ts tests/cover-review-budget.test.ts tests/connection-store.test.ts tests/cover-review-session.test.ts tests/assisted-cover.integration.test.ts`；截获两个阶段输入与顺序，验证调用数、错误和恶意工具响应。真实服务试点仅在用户明确授权连接、素材抽帧及请求上限后执行，不复用历史 MiniMax 单次授权。

**Evaluation gate:** 冻结数据清单和分组，先完成无复核基线；再按 spec REQ-22 配对比较。若已知严重问题被隐藏、人工质量降低、人工操作耗时中位数未下降或预算越界，则保持试点/关闭状态，不进入 M7。样本不足只报告试点，不宣称泛化。

### M7 — One Correction Cycle

**Depends on:** M6 配对评测支持继续；用户选择启用修正。

**Files:** 扩展 session/provider/candidates 的修正命令与候选来源记录；新增 `tests/cover-review-correction.test.ts`；扩展 smoke/evaluate 与同一验证报告。不新增第三个长期 Agent 或循环 owner。

**Contract:** REQ-12–13，完整 AC-06。最多第一轮复核、一次针对问题的候选修正、第二轮独立复核。修正产生新草稿修订，保留前后差异；第二轮 blind input 仍不带第一轮答案。所有修正请求计入本轮预算，不扩大抽帧计划。

**Acceptance:** 无新证据、无改善、相互矛盾、预算耗尽或第二轮仍不确定时停止并交人工；不把问题列表变短当成改善的唯一依据。只有问题对应的新证据和边界/语义/时段结果支持时才标记修正，不能删 issue 伪装修复。人工修改后不自动开始新付费运行，仍必须确认最终所有版本预览。

**Verification:** `npm test -- tests/cover-review-correction.test.ts tests/cover-review-budget.test.ts tests/cover-review-session.test.ts tests/assisted-cover.integration.test.ts`；固定响应构造持续错误、振荡建议、删问题未改框、修正后旧响应和取消场景，断言轮次/请求上限与最终确认未被绕过。按 M6 相同冻结集合重新比较人工成本和最终质量。

## Traceability And Verification Levels

| Spec requirements | Milestones | Acceptance |
| --- | --- | --- |
| REQ-01–03 | M1、M2、M4、M5 | AC-01–03、09、13–14 |
| REQ-04–06 | M3、M5 | AC-03、09、11 |
| REQ-07–08 | M4、M5 | AC-04、10、12–14 |
| REQ-09–11 | M6 | AC-04–05、07、15 |
| REQ-12–13 | M2、M4、M6、M7 | AC-06–07 |
| REQ-14–16 | M2–M5 | AC-03、08–09、14 |
| REQ-17–21 | M1–M5 | AC-01、10–13、15、17 |
| REQ-22 | M5–M7 | AC-16 |

所有行为里程碑先针对实际失败模式建立测试，再实现；每个稳定 checkpoint 运行 typecheck 和受影响测试，审查 scoped diff 后提交。涉及 schema 迁移、并发保存、批准或队列交接的实现需要 native `reviewer_xhigh` 独立复核；评审不能替代实际测试。本文档单文件计划由主线程自审，不为规划再启动重复架构审查。

验收证据分层保存：schema/unit → 模拟服务集成 → 隔离桌面交互 → 真实 FFmpeg/ffprobe → 经授权真实模型 → 用户播放确认。任何层缺失明确记录，不由上一层 PASS 推导下一层成功。

离线评测从原素材及已知失败段开始，包括 5.25 秒附近、出现/消失、切镜、小动画和商品/字幕负样本；调参前封存开发/留出清单与摘要。人工 GT 只交评估脚本，自动候选及复核请求均不得读取 GT。结果分开记录机器失败、用户补框、用户明确不覆盖及最终质量。

## Rollout, Rollback And Stop Conditions

- Phase 1 未完成 M5 前不向用户提供可导出的半自动入口；Phase 2/3 默认关闭并显式启用，不影响已有严格模式。
- 功能回退优先停止新建 assisted 草稿/复核，保留新格式读取、人工查看和已经冻结任务的重试能力；不把已有 assisted 草稿降级成 manual/agent。
- 二进制降级使用迁移前独立保存的旧项目副本；不得让旧版本覆盖新项目或新 job。常规 `.bak` 会继续轮换，不能单独充当永久降级副本；执行迁移前保存独立副本并报告位置。新 job/批准只由支持其格式的版本读取。
- 若原轨迹无法合法表达用户选择、预览无法保持编译一致、幂等交接仍有重复窗口、批准可被旧修订复用，则停止该里程碑，不降低 gate。
- 若需新依赖、权重、商业调用、操作当前桌面、改变严格自动合同或覆盖他人同文件改动，先报告具体 blocker / scope change，不自动扩权。
- 复核无收益不阻塞已验证的 Phase 1；保持可选复核关闭并交付证据，不增加更多 Agent 寻求一致投票。

## Next Action And Plan Validation

后续收到实施授权后的第一项是 M1：先补显式模式分派与旧/新持久化兼容测试，再实现数据合同。不要从增加模型调用、修改 prompt 或绕过旧严格失败开始。

本次计划校验仅包括源码依据、spec 覆盖、依赖顺序、文件目标/命令存在性、链接和 diff 检查。所有新增模块、脚本和测试均为计划项，未创建、未运行；没有真实模型、媒体或桌面验收结果。
