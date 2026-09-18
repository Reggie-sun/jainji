---
title: Reusable Source Sticker Knowledge Implementation Plan
status: in-progress
execution: m5-in-progress
version: 0.1
date: 2026-09-17
baseline: ef74adf
spec: source-sticker-knowledge-spec.md
---

# Goal And Authority

落实 [Source Sticker Knowledge Spec](source-sticker-knowledge-spec.md)：将经过原图核查与真实样片检查的源贴纸事实保存下来，后续同源素材复用；原事实被纠正时传播给本批受影响版本，保持新包装逐版本创作与检查。

M1 的共享合同与独立持久 owner、M2 的结构化主管结果与证据交接、M3 的自动制作复用及修订传播、M4 的一次性刷新入口与状态展示已实现；M5 已补齐本地终态制作审计、历史争议提示及输出尺寸/款式配对回归。**一条真实素材已取得冷、暖和主动刷新出片证据；暖运行曾因创作候选解析失败，增加结构化初筛约束后成功。完整对照与整体验收仍未完成。** 计数口径、保留边界及证据见 [验收报告](source-sticker-knowledge-validation.md)。

采用 Native Codex 执行，按仓库现行规则进行有界实施、验证及提交。默认使用当前工作树，不创建 worktree；实现前检查当前规则、Git 状态、live agents 与精确文件 ownership，保留无关工作。技术选择在规格内自行收敛；只有真实同文件冲突或目标/授权变化才需要用户决定。

# Baseline And Integration Seams

规划时已通过 Codegraph 实体/关系查询和实际代码读取核对以下边界；注入回调的真实调用以代码为准，不能将图谱同名匹配当成实际依赖。

| Seam | Current behavior | Planned change |
| --- | --- | --- |
| [AgentController.start](../src/main/agent-controller.ts) | 配置准入后注入识别、主管、预览和入队依赖 | 注入单一知识协调 owner，保持配置、源文件和取消准入 |
| [AgentRunner.execute](../src/main/agent-runner.ts) | 用运行内 `pendingCoverTracks` 按 media ID 缓存，主管通过版本暂存到 `reviewed` 后统一入队 | 改为按源身份持有知识修订与版本依赖；修订传播后再入队 |
| [superviseRenderedTemplate](../src/main/supervised-preview.ts) | 返回最终 `EditTemplate`，内部维护最多 5 次检查 / 2 次修订预算 | 返回模板、源事实修订、检查证据和累计预算；支持同版本恢复检查而不重置预算 |
| [SupervisorEvidence](../src/main/supervisor-evidence.ts) | 抽取配对帧，结束时清理临时文件 | 提供证据持久交接；由知识 store 管理通过后的证据 |
| [domain.ts](../src/main/domain.ts) / [state-migrations.ts](../src/main/state-migrations.ts) | 素材指纹、冻结模板和批次迁移已有 owner | 仅增加必要的知识来源引用和兼容迁移，不增加动态重试依赖 |
| [index.ts](../src/main/index.ts) / [preload.ts](../src/main/preload.ts) | userData 初始化、受信 IPC、制作入口 | 初始化知识 store，投影最小状态；复用已有制作命令传递刷新意图 |

本计划替换的是自动制作中的临时识别结果来源，不保留另一条可绕开知识门槛的持久缓存。手动 / 半自动草稿和现有导出快照仍各自负责原职责，不合并为源知识。

# Proposed Module Ownership

下列新增路径是建议落点，实施时可依据现有结构调整名称，但职责不可重复。

| Owner | Responsibility | Boundaries |
| --- | --- | --- |
| 新增 `src/shared/source-sticker-knowledge.ts` | 源身份、区间、事实修订、证据引用、状态及最小公开状态 schema | 复用既有轨迹 schema；不复制展示文字、连接或模板 schema |
| 新增 `src/main/source-sticker-knowledge-store.ts` | 读取/发布不可变修订、校验摘要、CAS、失效、索引重建和清理 | 独占持久化，不调用模型、不控制导出 |
| 新增 `src/main/source-sticker-knowledge-session.ts` | 本次制作的查找/刷新、修订绑定、争议、预算及受影响版本传播 | 作为原制作生命周期内部协调模块，不建立第二队列 |
| 现有 supervisor / evidence 模块 | 原图与样片审查、受限纠正、证据抽取 | 输出结构化结果，不直接写知识库或提交任务 |
| 现有 controller / runner | 接入协调模块、保留逐版本计划、冻结与原队列交接 | 不继续堆积存储、清理或身份匹配逻辑 |
| 现有 shared agent / desktop、preload、renderer | 刷新意图、状态投影、进度及最小入口 | UI 不决定命中、事实有效性或入队准入 |

存储目录必须由当前应用 `userData` 派生。不得从成功 session 的 `/tmp` 脚本或外部项目复制人工坐标作为默认事实。暂不新增数据库或第三方依赖，优先复用已有文件和摘要能力。

# Contract Decisions Before Coding

首次实现前完成以下技术决定并写入对应代码合同和测试，不另建重复 contract 文档：

- 确定源身份序列化、解码方向/时间解释版本及兼容规则；验证相同字节副本与源文件运行中变化的行为。
- 确定知识记录/索引格式、必要的项目或模板 schema 迁移、原子发布及恢复顺序；不可读新版本保留原文件。
- 确定最小持久证据、存储配额、按引用保护的回收规则及源身份锁的作用范围；明确多实例共享 userData 时如何拒绝冲突，不能仅依赖进程内 Map。
- 定义 supervisor 的结构化结果、修订原因和累计预算；区分源事实变化、仅外观变化、未解决问题和协议错误。
- 明确查找结果是有效命中、普通未命中、已知争议还是不可读状态；不能把已有反证丢失后的读取失败当作普通 cache miss。
- 冻结“重新检查”是下次制作的一次性输入，其源范围、消费时点及失败语义；点击设置意图不调用模型。

单一源知识 owner 是实现准则；图层仍由既有模板准备与布局模块生成。覆盖开关、人工文字、半自动批准、导出重试不可被缓存架构改写。

# Milestones

依赖顺序：`M1 → M2 → M3 → M4 → M5`。默认串行实施；不为形式上的并行增加共享写入。当前 M1–M4 阶段完成，M5 本地验收进行中，尚未满足整体验收。

## M1 — Source Contract And Durable Store

**Status:** 完成共享合同、store 与两份 focused tests；38 项测试及 `npm run typecheck` 通过。当前证据限于本机临时文件、确定性 fixture 和故障注入；未做真实断电、Windows 或真实模型/媒体验收。共享 userData 使用独占 owner lock；异常退出或无法持久保存阻断信息时保留锁并拒绝自动恢复，后续接入须明确处理恢复提示。

**Scope:** 新增共享知识 schema 和知识 store；仅在必要处接入既有指纹/路径工具。不接通生产模型或制作路径。

实现精确源身份、核查时域、不可变 revision 和证据引用；区分候选、已核查、争议、被替代和不可用。证据先写入并校验，记录与索引原子发布；索引可重建，未完成写入不可作为成功修订读取。独立保存反证与阻断标记，不依赖新修订成功；未完成事务与完整性未知在重启后仍阻断相关源。以基础修订校验解决并发提交，保护运行引用，回收时同步失效。存储配额在本阶段确定并可执行测试。

**Convergence:** 文件改名/复制可匹配，同路径换内容不能匹配；3 秒知识不能满足全程；空目标包含明确核查范围；损坏、未来格式、断电、并发 CAS、磁盘错误不会误报可复用。旧人工框不会被扫描导入。

**Verification:** 新增 `tests/source-sticker-knowledge.test.ts`、`tests/source-sticker-knowledge-store.test.ts`；仅使用临时文件与确定性 fixture。覆盖 AC-01、03–05、08、12–14、19、22 中的持久化合同。

## M2 — Supervisor Results And Evidence Handoff

**Status:** 完成结构化结果、逐版本累计预算、源事实/外观修正分离及证据交接。新增 `supervisor-knowledge.ts` 只组装临时证据和调用持久化回调，不成为第二个 store。反证在修补校验和预算判断前交接；已接受的多项反证在取消、关闭及清理竞争中保持受保护，迟到响应不能新增决定。重新绑定基础修订计入原预算，并使旧问题解决状态失效。识别证据按窗口释放，避免将样片保留额度错误应用到整个长视频。

本阶段相关 13 份测试、224 项通过，另经 `npm run typecheck`、`npm run build`、`git diff --check` 验证；native `reviewer_xhigh` 独立审查无剩余阻断项。证据包含确定性 store 故障/竞争测试、合成 CFR/VFR/裁剪帧、真实 FFmpeg 及原队列的多窗口识别、样片重检与取消；不包含真实模型或用户素材验收。旋转 fixture 验证了本机指定方向的几何，尚未证明所有探测元数据约定、FFmpeg 版本或 Windows 方向一致。构建仍报告 bundle 大小提示，未为此扩展优化范围。

**Scope:** `supervisor-protocol.ts`、`supervised-preview.ts`、`supervisor-provider.ts`、`supervisor-evidence.ts` 及其调用适配，保持既有对外制作行为。

将只返回模板的内部结果改为明确结构：最终模板、源事实结果/基础修订、实际检查范围、问题及解决记录、用于发布的证据、累计调用和有效修订次数。样片主管取得整个所需时域的事实摘要与证据引用；仍可请求有界补帧/放大。

让预算属于该版本整个制作过程，同素材修订引起重审时继续累计；不重新初始化 5 轮 / 2 次上限。外观修正不生成事实修订；原贴纸纠正必须可追溯到原图。替换当前仅比较渲染图层的 no-op 判定，分别比较源事实和有效图层：有证据且解决对应事实问题的源修正，即使画面不变，也计入有效修订并重新渲染/检查，绑定新事实摘要。保留非法/完全 no-op 修订后的问题锁定；按问题引用区分事实与成片缺陷，无关事实微调不能解除尚未解决的缺角等成片问题。

在清理临时目录前分别交接成功修订证据和已成立的反证。已有知识出现合法且绑定原图的具体反证时即持久阻断旧修订，不等新样片通过；失败或取消不发布新事实，但不能丢弃取消前已确认的反证。证据持久化失败必须由协调层按规格区分“不能复用但可完成本次”与“事实冲突或完整性未知，必须停止”；后者包括重启后的保护，不能仅依赖内存状态。

**Convergence:** 源事实与渲染结果分离且无双重 owner；有效修订后只能在新样片上通过；保存的证据不引用已删除的临时文件。原有手动/半自动路径无需使用新返回结构中的自动知识。

**Verification:** 扩展 `tests/supervised-preview.test.ts`、`tests/supervisor-evidence.integration.test.ts`、`tests/supervised-agent.integration.test.ts`；证明 source/output 配对、VFR、裁剪映射、取消及累计预算。覆盖 AC-04、07、10–11、13、21–22。

## M3 — Reuse And Revision Propagation

**Status:** 完成。`source-sticker-knowledge-session.ts` 独占运行内源事实和版本绑定，替代 `pendingCoverTracks`；`source-sticker-recognition.ts` 按实际解码时间生成未扩边的源事实，安全扩边只发生在覆盖渲染。旧识别入口移至历史测试 fixture，保留像素回归。应用只创建一个 userData store，并在正常退出和部分启动失败时释放 owner。正式入队前通过 store 的串行准入重新核对修订、反证、模板和源文件；冻结任务不依赖知识库。

本阶段确定性测试覆盖冷/暖跨项目与重启复用、同源不同 ID、B→A 重建重审、预算延续、CAS 冲突、原文字冻结、知识清理后原队列重试，以及窗口失败/取消后反证持久阻断。只比较实际观察时刻的反证，避免新识别标签与窗口尾部插值产生误争议；冷候选的已知问题也不能被另开版本直接通过。后续版本只继承事实引用及裁剪父证据，不累积无关预览原图。

Fresh verification：完整测试 837 项通过、2 项跳过（NVENC/字体能力条件及未启用的在线素材下载），`npm run typecheck`、`npm run build`、`git diff --check` 通过；native `reviewer_xhigh` 独立审查无剩余阻断项。覆盖 AC-01–17、19、21–22 的本地合同/集成部分，包含合成 CFR/VFR、真实 FFmpeg 和模拟模型；AC-15、17–18 的用户交互与 AC-20 真实素材仍留待 M4/M5，不将历史 fixture 或模拟主管判断当作真实识别质量。构建的 bundle 大小提示未在本阶段优化。

**Handoff limitation:** 内部显式刷新可绕过健康知识命中，但已持久 disputed 的源在 `readHead` 时继续阻断；M4 明确采用保守边界：刷新不是恢复或重置，不删除反证解锁，界面说明阻断原因。恢复能力需另行定义有证据的恢复合同，未在本阶段实现。相同字节副本的刷新意图必须在运行前按源统一，迟到刷新会停止受影响版本。未运行真实模型、Windows 实机或人工全片验收。

**Scope:** 新增知识 session 协调模块；接入 `agent-controller.ts`、`agent-runner.ts`、`index.ts`；按需要扩展 `domain.ts`、`state-migrations.ts` 及冻结引用。由一个 writer 拥有本阶段这些共享文件。

原配置准入通过后校验源文件，按 source key 查找。命中时跳过执行识别和主管识别，未命中或显式刷新时运行原识别路径。逐版本仍创作、生成图层、渲染和主管复核。首个满足发布门槛的事实结果可持久化；新版本不能凭历史样片结果直接导出。

移除自动路径中独立的 `pendingCoverTracks` 事实来源，以 session owner 统一运行内复用及版本绑定。保留每个版本原创作方案和冻结手动文字，让后续源事实修订只重建受影响图层，不为同一版本偷偷重新选款、改文字或调用创作模型。

当版本 B 修正源事实时，将受影响版本 A 的旧检查标记失效；在原预算内重建、重渲染并重审。每个版本准备结果绑定有效修订，最终交接前统一核对。仍不收敛的版本失败，不能为凑数量换预算重来。跨运行发布冲突不能以最后写入获胜，也不能绕过最终准入。

入队通过原 queue owner 执行；已有任务与重试完全依赖冻结模板。知识引用只说明来源，不成为历史任务运行所需的外部数据。普通写入失败、取消、重启与争议的处置严格按 spec，不启动第二套恢复任务系统。

**Convergence:** 同源不同 media ID / 项目冷暖两次运行正确；第二次识别阶段请求为 0；修正后的事实向全部受影响未入队版本传播；重试不访问最新知识或模型；新旧 schema 兼容有证据。

**Verification:** 新增 `tests/source-sticker-knowledge-session.test.ts`、`tests/source-sticker-knowledge.integration.test.ts`；扩展 `agent-controller`、`agent-runner`、`agent-pipeline`、`state-migrations` 和 `cover-sticker` 测试。覆盖 AC-01–17、19、21–22 的跨模块行为，以 AC-09、11、12、16、22 为本阶段硬门槛。

## M4 — Minimal User Controls

**Status:** 完成。`sourceStickerRefresh` 由原制作入口携带，绑定项目和本轮素材子集；相同字节副本在开始前统一刷新。renderer 的独立小组件与本地 hook 保存一次性意图：选择、项目、模式变化清除，准入成功消费、拒绝保留，不持久化或单独调用模型。原 typed preload / DesktopState 已传递共享制作输入与 AgentRun，无需新增 IPC 或第二套状态通道；assisted prepare/approve 在保存草稿前拒绝刷新字段。

逐条展示冷/暖/刷新来源、识别/修正/终态，以及折叠的核查时域、模型、请求和渲染计数、耗时。错误只投影安全原因；失败渲染计入尝试次数，修正完成不残留进行中文案，制作或提交失败不会仍显示正在复用。已知争议与完整性未知继续阻断；刷新不提供重置或恢复功能。

**Fresh verification:** 全量 855 项通过、2 项条件跳过（GPU 能力及未启用在线素材下载）；`npm run typecheck`、`npm run build`、`git diff --check` 通过。关键合同与审查发现有 red→green 回归。隔离 Electron smoke 通过 AC-15、17–18 的刷新、配置准入、选择/项目/模式切换、并发拒绝、失败不回退、取消及源事实修正状态场景：冷/暖/刷新源识别相关请求分别 6/0/6，每版仍创作和检查样片；另一个暖版本修正消耗 2 次样片检查、1 次修订、2 次渲染，未重复创作。最终本机证据为 `/tmp/jianji-desktop-smoke-a0xvlX/knowledge-smoke.json` 及同目录截图，可通过 README 命令重跑；产物仅为合成视频、模拟模型与真实 FFmpeg 的交互证据，不是识别准确率验收。Chrome MCP 共享 profile 被占用，未干扰已有浏览器，采用现有隔离 Electron/CDP 路径。真实模型、真实素材人工观看和 Windows 实机留待 M5；bundle 大小提示未在本阶段优化。

独立 native `reviewer_xhigh` 最终结论为 accept，无剩余阻断项；复核覆盖代码/测试/文档及最终 smoke JSON 与截图。已修复失败渲染计数、成功后残留进行中文案、assisted 写入一次性意图和外部失败耗时偏低的问题；未增加新的恢复、模型调用或导出生命周期 owner。

**Scope:** `src/shared/agent.ts`、`src/shared/desktop.ts`、`src/main/preload.ts`、对应 IPC、制作输入组装、素材操作及 `ResultsPanel.tsx`。新增独立小组件承接刷新入口，避免在 `App.tsx` 中加入知识领域逻辑；如需修改该文件先重新检查 ownership。

沿用制作入口传递一次性重新检查意图，主进程验证选定素材属于本轮、模式允许且运行未冲突。显示首次检查、复用、修正、未保存供复用及可理解的失败原因；详细来源折叠展示。不要新增完整知识管理台或自动模式人工审批。

制作进行中禁用相冲突操作，IPC 同样拒绝越界请求。用户改变选择或切换项目时刷新意图不能误用到另一素材集合。更新 README 的使用说明和 AGENTS 中重新生成可复用识别事实的最小语义例外，详细规则仍指向代码/spec owner。

**Convergence:** 用户能清楚区分复用与重新检查；点击刷新设置不触发模型，开始制作才执行；失败、取消和未配置连接时表现与规格一致。

**Verification:** 在现有 `scripts/desktop-smoke.mjs` 增加知识冷/暖/刷新场景，使用隔离 userData、模拟服务及真实 FFmpeg；实际 Electron 交互检查进度、点击、取消和项目切换。AC-15、17–18 必须有界面与主进程两层证据。

## M5 — Review And Real-Media Acceptance

**Status:** 进行中，未通过整体验收。本地审计、历史争议提示与配对回归已完成；真实单条素材已有冷、修复后暖、主动刷新及开启覆盖暖出片证据，尚缺覆盖开启冷/刷新、旧基线、代表性素材矩阵及完整人工质量验收。AC 分层结果、实际调用、审计限制、独立复审证据与下一步仅记录在 [验收报告](source-sticker-knowledge-validation.md)，不把单条出片当作 AC-20 通过。

**Scope:** 最终 diff、相关回归、真实同批对照及验证报告。先完成本地确定性检查，再执行授权范围内的真实模型与真实视频测试。

按 spec 的 Real-Media Validation Protocol 冻结素材清单、展示文字、连接/模型、资产和设置，分别测原基线、冷启动、暖复用、主动刷新。先在隔离副本及少量样片验证，再扩展至代表性素材；调用预算明确，不拿用户正在生产的任务当 fixture。

源事实比较与外观比较分开：确定性测试固定创作响应，验证复用只改变识别调用；真实模型测试记录随机方案差异，不能把换了一款好看贴纸算作识别改善。关闭覆盖和开启覆盖分别报告，不能混为一个通过率。

**Convergence:** AC-01–22 有可追溯结果；命中时识别请求为 0；不存在仍被传播的已知错误；真实结果保留可播放样片和配对证据。未做的人工全片观看、Windows 实机或商业模型组合明确列为未验证，不伪造通过。

实施后的最终独立审查使用 native `reviewer_xhigh`，因为变更涉及跨模块持久化、并发修订、付费调用与导出准入。审查只读，由 parent 验证重要发现并负责最终决定；修复后按影响范围重验，不叠加多个重复 review gate。

# Verification Commands And Evidence

以下为未来实施命令，不代表本次已运行。新增测试文件只有落地后才执行，禁止把文件未发现或 skip 作为通过。

```bash
npm run typecheck
npm test -- --maxWorkers=2 --minWorkers=2 tests/source-sticker-knowledge.test.ts tests/source-sticker-knowledge-store.test.ts tests/source-sticker-knowledge-session.test.ts tests/source-sticker-knowledge.integration.test.ts
npm test -- --maxWorkers=2 --minWorkers=2 tests/supervised-preview.test.ts tests/supervisor-evidence.integration.test.ts tests/supervised-agent.integration.test.ts tests/agent-controller.test.ts tests/agent-runner.test.ts tests/agent-pipeline.integration.test.ts tests/state-migrations.test.ts tests/cover-sticker.test.ts tests/product-price.test.ts
npm run build
npm test -- --maxWorkers=2 --minWorkers=2
```

行为与并发合同采用可复现失败的测试优先；不为每个字段写镜像实现测试。完整测试在集成收敛时运行一次，之后按实际变更影响重跑。桌面 smoke 使用本机核验过的 FFmpeg 路径和隔离 profile；不能为启动测试关闭其他 session 的浏览器、应用或制作进程。

真实记录包含代码版本、冻结源 SHA、模型非敏感标识、冷/暖运行 ID、知识修订、请求/修订/渲染计数、失败分类、正式输出及验证文件。可播放媒体、完整证据与含本机路径的日志留在授权验证目录；仓库报告只保留结论、必要定位和明确限制，不提交凭据或原视频。

# Risk Controls And Non-Goals

| Risk | Required response |
| --- | --- |
| 缓存放大首次误识别 | 保留新样片核查和原图依据；反证使新复用暂停，修订传播有测试 |
| 同一批版本来回纠正、隐式超预算 | 版本累计预算不可重置，受影响版本不收敛即失败 |
| 预览已通过但知识修订随后变化 | 原队列交接前在主进程重新校验并序列化关键区间 |
| 知识库缺失、损坏或 future schema | 明确区分未命中、争议和不可读；保留旧文件，禁止覆写或静默恢复有反证的事实 |
| 新 store 与旧缓存并存形成两个 owner | M3 移除替代的临时事实路径，仅保留 session owner 调用的运行内缓存 |
| 新功能拖慢全部制作 | 分别测 hash、证据存储、识别、样片耗时；只承诺可验证的识别复用，不省略样片以换速度 |
| 迁移或清理破坏历史任务 | 冻结模板完整自足；迁移正反例及知识清理后的重试回归 |

不在本计划中顺带重构整个 `App.tsx`、实现内容相似搜索、增加模型供应商、导入历史人工框、搭建知识管理后台或重做导出调度。若现有架构无法满足核心合同，报告具体边界冲突并修正实施方案，不能通过削弱门槛完成 milestone。

# Completion And Handoff

实施交付需要：与 spec 对照的 AC 结果、相关测试和实际桌面证据、独立审查结果、真实素材报告及未验证项、任务范围内的 commit。完成前按仓库要求执行 `verification-before-completion`；仅有 plan 勾选或模型自报通过不构成验收。

计划仅维护 milestone 状态，不复制运行日志。当前仓库没有为本任务声明专用 session-capture owner，不另建重复会话记录。
