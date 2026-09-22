# Windows Agent Lifecycle Verification Design

Date: 2026-09-22
Status: approved by user (Approach A, 2026-09-22); addendum 2026-09-22（同步 a058826 之前的新代码事实，修正 W22/W23，新增 W29）；pending implementation plan and acceptance updates

## Background

[`CLAUDE.md`](../../CLAUDE.md) 给出产品 Agent 全链路的硬约束（价格手动、新增文字受限、自动覆盖与样片、原贴纸识别、半自动审阅、外部 agent 路径）。现有 Windows 验收规范 [`docs/windows-acceptance-spec.md`](../../windows-acceptance-spec.md) 与 W01–W20 覆盖了安装、连接、规则拒绝、出片、文件验证、安装版启动等基本场景；W07「1 视频 1 版本真实模型出片」粒度过粗，无法断言以下 Windows 易失败路径：

- 自动四角补齐与自动覆盖的定框与主管样片。
- 原贴纸视觉识别、跟随轨迹与源贴纸知识合同。
- 半自动审阅的证据、批准与可恢复草稿。
- 应用内 Path B（`window.jianji.appendProduction`）的 IPC 表面与守卫。

此外，[`docs/batch-video-production-agent-playbook.md`](../../batch-video-production-agent-playbook.md) 是 Linux 倾向的外部 agent 操作脚本，**没有**解释 Windows 上 NSIS 安装包、内置 FFmpeg 路径、`%APPDATA%`、PowerShell 启动、CDP 端口与隔离 userData 等差异；运行在 Windows 上的外部 agent 无法照搬。

本规格把「Windows 上产品 Agent 全生命周期 + 外部 agent IPC 表面」的定义固化为可验收的设计契约；通过回写 `windows-acceptance-spec.md`（加 W21–W29 测试用例）和 `batch-video-production-agent-playbook.md`（加 Windows Adaptation 小节），让两类 agent 在 Windows 上的真实表现都纳入统一验收与运行清单。

仅在已经实现、已经有 owner 的代码路径上做「Windows 验证」；不新增 IPC、不改写现有 schema、不改动产品 Agent 决策逻辑。

## Goal And Non-Goals

### Goal

- 为产品 Agent 在 Windows 安装包上的全链路路径提供统一验收口径：连接与模型选定 → 创作方案 → 价格与展示文字准入 → 主管样片 → 自动四角补齐 / 自动覆盖 → 原贴纸识别 → 半自动审阅 → 输出队列 → 应用内 Path B。
- 为外部 agent（CDP 与应用内 IPC）在 Windows 上的运行提供适配清单，覆盖 NSIS 包路径、内置 FFmpeg 路径、独立 `userData`、CDP 端口、PowerShell 启动与隔离 worker。
- 把 W21–W29 加到 `docs/windows-acceptance-spec.md` 的 Test Cases 表，引用本规格作为契约。
- 把 Windows Adaptation 小节加到 `batch-video-production-agent-playbook.md`，让外部 agent 路径在 Windows 上可重复。

### Non-Goals

- 不新增 IPC、schema、模型角色或评审角色（复用既有 [canonical ownership](../../CLAUDE.md#canonical-ownership)）。
- 不改动产品 Agent 在 Windows 上的任何决策逻辑；只把现有行为纳入验收。
- 不在 Windows 上引入对真实商业账号的强制自动化；模型/GPU/账号仍按 W11/W12 待人工验收。
- 不在外部 agent 路径上引入与 `batch-video-production-agent-playbook.md` 冲突的合同；Windows Adaptation 是补全而非替代。
- 不在本规格里复制参数表、贴纸尺寸、价格字号、滤镜范围；这些由代码 owner 独占。

## Current-State Facts (Verified 2026-09-22)

- **既有验收基线**：[W01–W20](../../windows-acceptance-spec.md#test-cases) 仍有效；0.1.2 验证见 [`windows-verification-0.1.2.md`](../../windows-verification-0.1.2.md)。W07 在 Windows 上已通过；本规格在此之上加 W21–W29。
- **代码 owner（来自 [`CLAUDE.md` §Canonical Ownership](../../CLAUDE.md)）**：

| Concern | Owner |
| --- | --- |
| 制作请求、价格与装饰数据校验 | [`src/shared/agent.ts`](../../../src/shared/agent.ts)、[`src/shared/decorations.ts`](../../../src/shared/decorations.ts) |
| 模型连接、凭据与 ChatGPT 会话 | [`src/main/model-connections.ts`](../../../src/main/model-connections.ts)、[`src/main/connection-store.ts`](../../../src/main/connection-store.ts)、[`src/main/chatgpt-session.ts`](../../../src/main/chatgpt-session.ts) |
| 制作准入、取消与逐素材执行 | [`src/main/agent-controller.ts`](../../../src/main/agent-controller.ts)、[`src/main/agent-runner.ts`](../../../src/main/agent-runner.ts) |
| 模型方案校验与本地图层生成 | [`src/main/agent-provider.ts`](../../../src/main/agent-provider.ts) |
| 自动四角覆盖优先与补齐时段 | [`src/main/automatic-corner-layout.ts`](../../../src/main/automatic-corner-layout.ts) |
| 自动主管协议、修正与样片检查 | [`src/main/supervisor-protocol.ts`](../../../src/main/supervisor-protocol.ts)、[`src/main/collaborative-cover.ts`](../../../src/main/collaborative-cover.ts)、[`src/main/supervised-preview.ts`](../../../src/main/supervised-preview.ts)、[`src/main/supervisor-evidence.ts`](../../../src/main/supervisor-evidence.ts) |
| 近似自动覆盖合同、定框与逐版复核 | [`src/shared/cover-placement.ts`](../../../src/shared/cover-placement.ts)、[`src/main/cover-placement-proposal.ts`](../../../src/main/cover-placement-proposal.ts)、[`src/main/cover-placement-session.ts`](../../../src/main/cover-placement-session.ts) |
| 原贴纸自动识别与跟随轨迹 | [`src/main/source-sticker-recognition.ts`](../../../src/main/source-sticker-recognition.ts)、[`src/main/cover-track-provider.ts`](../../../src/main/cover-track-provider.ts)、[`src/main/automatic-cover-tracks.ts`](../../../src/main/automatic-cover-tracks.ts) |
| 可复用源贴纸合同、持久化与逐版本修订传播 | [`src/shared/source-sticker-knowledge.ts`](../../../src/shared/source-sticker-knowledge.ts)、[`src/main/source-sticker-knowledge-store.ts`](../../../src/main/source-sticker-knowledge-store.ts)、[`src/main/source-sticker-knowledge-session.ts`](../../../src/main/source-sticker-knowledge-session.ts) |
| 半自动审阅、证据与批准 | [`src/shared/cover-review.ts`](../../../src/shared/cover-review.ts)、[`src/main/cover-review-controller.ts`](../../../src/main/cover-review-controller.ts)、[`src/main/cover-review-session.ts`](../../../src/main/cover-review-session.ts)、[`src/main/cover-review-evidence.ts`](../../../src/main/cover-review-evidence.ts)、[`src/main/cover-review-approval.ts`](../../../src/main/cover-review-approval.ts) |
| 模板领域、编译、导出生命周期与文件验证 | [`src/main/domain.ts`](../../../src/main/domain.ts)、[`src/main/compiler.ts`](../../../src/main/compiler.ts)、[`src/main/queue.ts`](../../../src/main/queue.ts)、[`src/main/artifact.ts`](../../../src/main/artifact.ts) |
| 外部 agent IPC 表面（`window.jianji.*`） | [`src/main/index.ts`](../../../src/main/index.ts)（`export.retry`、`export.append`、`coverReview.*`、`setCoverSticker`、`saveProject`） |

- **Windows 平台差异（已知、需在 W21–W29 上断言）**：
  - NSIS 安装包内置 `resources/ffmpeg/ffmpeg.exe`、`ffprobe.exe`、`Noto Sans CJK SC 2.004` 与各自许可证；缺一则禁止出片。
  - 用户 `userData` 默认 `C:\Users\<user>\AppData\Roaming\jianji`（`%APPDATA%\jianji`）；隔离 worker 用独立子目录，不与主 APPDATA 混。
  - 应用启动时按 NVIDIA NVENC → AMD AMF → Intel QSV 顺序试编码；GPU 列表不等于实际可用；以试编码结果为准。
  - FFmpeg 路径查找顺序：`JIANJI_FFMPEG_PATH` / `JIANJI_FFPROBE_PATH` → `userData\tools\ffmpeg\bin\` → NSIS 内置 → 系统 PATH。
  - ChatGPT 登录使用 `app.getPath('userData')` 下独立子目录（不读全局 Codex 登录）。
- **外部 agent 路径（Linux 已用，Windows 待补）**：[playbook §Prerequisites / §Machine Layout / §Adaptation Checklist](../../batch-video-production-agent-playbook.md) 给出 Linux 路径与 `taskset -c` 启动；Windows 上要替换为：`%LOCALAPPDATA%\jianji\tools\ffmpeg\bin\`、PowerShell 启动器、独立端口、`taskset` 不可用。
- **2026-09-22 addendum（规格冻结后落地的代码事实，commit `9c612e0..a058826`）**：
  - **本地随机路径（第三条制作路径，零模型调用）**：`decorations.mode === "random"`（[`src/shared/decorations.ts:53`](../../../src/shared/decorations.ts)）是唯一触发；`coverSticker.trackingMode` 的 `random` 枚举已被 `3aaeb3b` 移除（它曾静默联动四角随机）。随机路径每个素材版本从内置+上传贴纸池 Fisher-Yates 选 4 款不同贴纸分置四角、从 `PRICE_STYLES` 随机选价格花字、从规则滤镜范围随机选滤镜与强度；UI 为 CornerDecorationPicker「本地随机」按钮与 TemplatePanel「本地随机包装」页（模板网格隐藏，价格花字显示随机说明）。展示文字校验不变。
  - **H.264 编码器三态分类**（`6213b85`）：[`src/main/video-encoder.ts`](../../../src/main/video-encoder.ts) 引入 `H264Capability` tagged union（`hardware` / `software-fallback` / `software-only`）。两者都跑 libx264，但 fallback 表示 GPU 显存被其他进程占用、释放后可恢复硬件编码；only 表示 FFmpeg 未编译硬件编码器。界面以黄点/灰点区分。
  - **开发实例退出自动保存**（`a058826`）：`JIANJI_DEV_SERVER_URL` 存在且项目已保存过文件时，退出自动落盘并直接退出，不弹保存提示；从未保存的项目与安装版保持交互式提示。退出提示前会先恢复并聚焦窗口。
  - **UI 移除**（不影响 W 用例语义）：'模板' 子导航（`f46a996`）、规则模板页的源贴纸刷新卡片（`6676258`）、CoverStickerPanel 的随机跟随按钮（`3aaeb3b`）。
  - **锚点修正**：覆盖开关（「启用覆盖」勾选）位于规则模板页的 CoverStickerPanel，不在「作品」页；W23 行已按此修正。创作模型抽帧为 **3 帧**（[`src/main/agent-frames.ts:14`](../../../src/main/agent-frames.ts)，fractions 0.1/0.5/0.85）；W22 行已按此修正。

## Lifecycle Stages

每阶段都引用现有代码 owner；末尾标号对应 W21–W29。

### Stage 1. 模型连接、角色与档位 → W21

- Windows 入口：API 连接管理界面 + ChatGPT 登录。
- 关键契约：`connections.json` 落盘在 `userData\connections\`、与项目文件物理隔离；Key 明文存放于该目录，删除连接即移除保存的 Key。
- 三个角色（创作、视觉识别、视觉复核）从同一连接库选连接 + 模型 + 推理档位，**凭据只保存一份**，请求/上下文按角色隔离；运行中禁止切换。
- W21：在 NSIS 安装版首次启动后，`userData\connections\` 目录权限与 Linux `0600/0700` 兼容（Windows 用当前用户权限）；ChatGPT 登录走应用独立 `userData`，不读全局；最小权限模型请求能成功返回方案（允许用模拟服务）。

### Stage 2. 创作模型方案与本地图层生成 → W22

- Windows 入口：导入素材 → 选模板 → 手动填展示文字 → 「交给 Agent，制作 N 条成片」。
- 关键契约：`RequiredProductPriceSchema` 与 `agent.assertIdle()` 守在 IPC 入口；非 `formatProductPrice(productPrice)` 形态在 IPC 入口拒绝；运行中切换连接被禁用。
- Windows 验证 3 帧抽帧（0.1/0.5/0.85 处各一张）→ 中心贴纸与四角贴纸 → 本地 FFmpeg → 输出验证通过；同批价格一致，只生成居中手填价格；模型返回非法方案时显式失败，**不静默重试、不切换模型**。
- W22：在隔离 fixture 模型上制作 1 视频 1 版本（或 N 版本小批）；运行中尝试切换连接被禁用；非法展示文字在 IPC 入口拒绝；模型返回非法方案时任务显式失败并保留 `interrupted` 状态，不重试不切换。

**本地随机路径（`decorations.mode === "random"`，零模型调用）** → W29：随机路径是创作模型路径之外的第三条制作路径（与手动、Agent 并列）。Windows 上需验证：每个素材版本四角各得 1 款互不重复的随机贴纸（池 = 内置 + 上传）、价格花字从 `PRICE_STYLES` 随机、滤镜与强度在规则范围内随机；不发起任何模型请求；展示文字仍走共享 schema 在 IPC 入口拒绝；规则模板页在随机模式下隐藏模板网格与具体花字选择器（显示随机说明），避免误读为手动草稿生效。

### Stage 3. 价格准入与超时 → 已在 W06 覆盖

[W06](../../windows-acceptance-spec.md) 已要求价格留空、纯金额、含「元」格式均在入口拒绝；本规格不重复。

### Stage 4. 自动四角补齐（覆盖关闭） → W23

- 关键契约：见 [`src/main/automatic-corner-layout.ts`](../../../src/main/automatic-corner-layout.ts) 与 [`src/main/cover-sticker.ts`](../../../src/main/cover-sticker.ts)；每窗口执行 1 次、主管最多 3 次；贴纸全程保留、不随价格渐隐。
- 自动模式可保留原色；手动模式仍可空置；不重不漏；自动方案的覆盖层（含补齐时段）冻结进模板。
- W23：在隔离 fixture 模型上跑覆盖关闭的自动补角；确认四个角的归属（哪一角归属给源视频的角落贴纸、哪些角由自动补齐分配）；补齐时段在导出前可被补帧或局部放大；超时在每窗口执行次数内显式失败。

### Stage 5. 自动覆盖与主管样片 → W24

- 关键契约：[`src/main/supervisor-protocol.ts`](../../../src/main/supervisor-protocol.ts)、[`src/main/collaborative-cover.ts`](../../../src/main/collaborative-cover.ts)、[`src/main/supervised-preview.ts`](../../../src/main/supervised-preview.ts)、[`src/main/supervisor-evidence.ts`](../../../src/main/supervisor-evidence.ts)。
- 视觉连接先看 12 张全片联系帧 → 近似覆盖框 → 主管对真实样片判断遮盖是否可接受、是否挡住主体。
- 定框最多 3 次无效方案 / 协议纠正；补检 40 帧预算；鉴权或网络等服务错误直接停止；样片最多 5 次检查、2 次修订；非法或未改变有效画面的修订不能转通过。
- W24：在隔离 fixture（含视觉模型服务）上开启自动覆盖；开 → 自动视觉连接返回近似覆盖框 → 主管样片渲染 → 主管判断 → 至多 N 次修订；新生成的覆盖层以白色不透明底板渲染，关闭覆盖的补齐不改变该策略。

### Stage 6. 原贴纸自动识别与跟随轨迹 → W25

- 关键契约：[`src/main/source-sticker-recognition.ts`](../../../src/main/source-sticker-recognition.ts)、[`src/main/cover-track-provider.ts`](../../../src/main/cover-track-provider.ts)、[`src/main/automatic-cover-tracks.ts`](../../../src/main/automatic-cover-tracks.ts)；可复用源贴纸知识与 [`src/shared/source-sticker-knowledge.ts`](../../../src/shared/source-sticker-knowledge.ts)。
- 已知源知识争议或完整性未知继续阻断；近似覆盖方案与原贴纸事实分开；近似覆盖的位置只从带专用标记的已完成导出模板复用；精确源身份必须相同；新版本仍检查实际样片。
- W25：先在隔离 fixture 上验证 `source-sticker-recognition` 接受同一连接的角色 + 模型设置（与创作模型分开）；随后在原贴纸事实稳定时，复用部分同源其他批次；事实有疑议时显式阻断，不得静默沿用。

### Stage 7. 半自动审阅、证据与批准 → W26

- 关键契约：[`src/shared/cover-review.ts`](../../../src/shared/cover-review.ts)、[`src/main/cover-review-controller.ts`](../../../src/main/cover-review-controller.ts)、[`src/main/cover-review-session.ts`](../../../src/main/cover-review-session.ts)、[`src/main/cover-review-evidence.ts`](../../../src/main/cover-review-evidence.ts)、[`src/main/cover-review-approval.ts`](../../../src/main/cover-review-approval.ts)。
- 半自动（人工审阅）模式：算法候选与人工决定分开保存；草稿编辑使旧预览和批准失效；冻结并经动态预览、用户明确确认后，才可经原导出队列幂等提交；独立复核默认关闭，只报告问题，不能批准或自动改稿；退出保留可恢复草稿，不自动调用模型或提交未入队版本。
- W26：进 `coverReview.*` 系列 IPC，完成「识别 → 候选 → 草稿编辑 → 动态预览 → 用户批准 → 导出队列」；草稿在退出/重启后可恢复；草稿编辑失效旧预览；独立复核关闭时不能批准/自动改稿。

### Stage 8. 输出队列、文件验证与重试 → W13/W14（已覆盖）

输出队列与重试生命周期由 [W13/W14](../../windows-acceptance-spec.md) 覆盖；本规格不重复。

### Stage 9. 应用内 Path B（外部 agent IPC 表面） → W27

- 关键契约：Path B IPC 表面已就位（参见 [`2026-09-21-pathb-append-production-design.md`](2026-09-21-pathb-append-production-design.md)）。
- Windows 入口：作品页已完成批次的「追加制作」按钮 → 对话框预填（`appendProductionPrefill`）→ 提交（`appendProduction`）→ 本地渲染零模型调用。
- 覆盖保存的 agent 序列：`setCoverSticker` → `saveProject`（手动）；`coverReview.*` 全程即时落盘（半自动）。
- W27：在安装版上启动隔离 worker（独立 `userData` 子目录、独立 CDP 端口），经 `window.jianji.appendProduction` 完成「预填 → 改文字 → 追加 2 条 → 渲染完成 → 文件校验」；与 queued `export.retry` 不竞争（`agent.assertIdle()` 守门）；展示文字/条数/目录在 IPC 入口按既有 schema 拒绝非法值。

## Windows Test Matrix（W21–W29，追加于 [`windows-acceptance-spec.md`](../../windows-acceptance-spec.md#test-cases) 表）

| ID | Priority | Stage | Action | Acceptance |
| --- | --- | --- | --- | --- |
| W21 | P0 | 1 | 在 NSIS 安装版首次启动后，检查 `%APPDATA%\jianji\connections\`；用任意 API Key + 模拟 endpoint；启动最小视觉模型请求 | 凭据明文保存在该目录（不写入项目文件、不写入环境、不写入浏览器存储）；ChatGPT 登录走应用独立 `userData`；三个角色各自可设模型与档位而不互相覆盖；运行中切换连接被拒绝 |
| W22 | P1 | 2 | 在隔离 fixture 模型上 1 视频 1 版本手填价格；运行中尝试切换连接 | 模型抽 3 帧（0.1/0.5/0.85 处各一张）→ 本地中心 + 四角 → FFmpeg 渲染 → 输出验证通过；运行中切换连接被禁用；非法价格在 IPC 入口拒绝；非法方案显式失败且不重试不切换 |
| W23 | P1 | 4 | 覆盖关闭的自动补角；「启用覆盖」开关在规则模板页 CoverStickerPanel 可见且默认关闭 | 每角归属明确（源贴纸角 vs 补齐角），补齐时段在导出前可被补帧/放大，每窗口执行 1 次、主管最多 3 次；超时显式失败，不静默重试 |
| W24 | P1 | 5 | 在含视觉模型 fixture 上开启自动覆盖；制作 1 视频 1 版本 | 视觉连接返回近似覆盖框并定框 → 主管样片渲染 → 修订反馈保留 → 非法/未改变画面的修订不能转通过；样片最多 5 次检查、2 次修订；新覆盖层以白色不透明底板渲染；不可用视觉模型时在调用前拒绝制作 |
| W25 | P1 | 6 | 在隔离 fixture 上先识别一张原贴纸 → 复用同源其他批次 → 删除源再识别 | 复用位置只在带专用标记的已完成模板复用、精确源身份相同；事实有疑议时显式阻断；近似覆盖方案与原贴纸事实分开 |
| W26 | P1 | 7 | 进 `coverReview.*` 系列 IPC 完成「识别→候选→草稿→预览→批准→出片」 | 草稿落盘独立于项目文件；草稿编辑失效旧预览与批准；独立复核关闭时不能批准/自动改稿；退出/重启后草稿可恢复；草稿未通过批准前不会进入正式队列 |
| W27 | P1 | 9 | 经 `window.jianji.appendProduction` 完成「预填→改文字→追加 2 条→渲染完成→文件校验」 | 展示文字/条数/目录按既有 schema 拒绝；与 `export.retry` 不竞争；零模型调用；输出文件不覆盖已有产物；Path B digest 自校验通过 |
| W28 | P1 | 全部 | 在 NSIS 安装版上按 `batch-video-production-agent-playbook.md` §Windows Adaptation 启动隔离 worker（独立 CDP 端口、独立 `%APPDATA%` 子目录），跑 1 个版本的 Path B 完整链路 | worker 与用户应用不竞争 userData；CDP `127.0.0.1:<port>` 连接成功并暴露 `window.jianji.*`；W21–W27 同样适用于该 worker；`packaged-runtime-smoke` 继续通过 |
| W29 | P1 | 2 | 选择「本地随机」模式制作 2 素材 × 各 1 版本；全程观察网络面板或日志确认零模型请求 | 每个素材版本四角各 1 款互不重复的随机贴纸（池 = 内置 + 上传）、价格花字来自 `PRICE_STYLES` 随机、滤镜与强度在规则范围内随机；两个素材版本组合不同（允许小概率相同，记录即可）；展示文字仍按共享 schema 在 IPC 入口拒绝空白/超行；规则模板页隐藏模板网格与具体花字选择器；导出文件通过既有验证 |

**测试机制**：W21–W29 与既有 W01–W20 共享同一验证基础。`packaged-runtime-smoke`、`desktop-smoke`、`feedback-smoke` 复用；模型、登录、CC Switch、GitHub 继续用隔离 fixture，遵循 [`windows-acceptance-spec.md §Environment Record`](../../windows-acceptance-spec.md#environment-record) 的禁止项（不消耗真实账号、不提交真实 Issue）。W29 不依赖任何模型 fixture（路径本身零模型调用）。

## External Agent Windows Adaptation（追加于 `batch-video-production-agent-playbook.md` 末尾）

> 原 playbook 是 Linux 路径，本小节给出 Windows 适配；不替换原内容。读者交叉对照原 §Prerequisites / §Machine Layout / §Step 1–§4，将 `bash + python3 + taskset` 替换为下列 PowerShell + 隔离 worker。

### WA.1 路径与二进制

- **app 仓库**：checkout 到与产生源批次相同的 commit；`npm ci`、`npm run build`，产物 `dist-electron\main.cjs`。
- **FFmpeg**：NSIS 安装包路径 `<install>\resources\ffmpeg\bin\ffmpeg.exe` 与 `ffprobe.exe`；隔离 worker 也可使用 `JIANJI_FFMPEG_PATH=C:\Users\<user>\AppData\Local\jianji\tools\ffmpeg\bin\ffmpeg.exe`。
- **userData 隔离**：worker 启动通过 `app.setPath('userData', '<worker-run>\.app-profile')` 与 `app.setPath('documents', '<worker-run>')` 重定向；不得使用用户主 APPDATA。
- **Codex 二进制**：NSIS 包内 `app.asar.unpacked\resources\codex\win32-x64\codex.exe` 由包自带；开发版需要从源码构建。

### WA.2 启动 worker（PowerShell）

```powershell
$ErrorActionPreference = 'Stop'
$workerRoot = 'C:\jianji-workers\再次4x70-20260922-100000'
$projectPath = Join-Path $workerRoot '<项目名>.jianji-project.json'
$port = 9541
$repoRoot = 'C:\path\to\jianji'
$ffmpegDir = 'C:\Users\<user>\AppData\Local\jianji\tools\ffmpeg\bin'

# 不要从 IDE 继承 ELECTRON_RUN_AS_NODE=1（与 Linux 同）
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:JIANJI_FFMPEG_PATH = (Join-Path $ffmpegDir 'ffmpeg.exe')
$env:JIANJI_FFPROBE_PATH = (Join-Path $ffmpegDir 'ffprobe.exe')

$launch = @"
const { app } = require('electron');
app.setPath('userData', '$($workerRoot)\.app-profile');
app.setPath('documents', '$workerRoot');
app.getAppPath = () => '$repoRoot';
process.defaultApp = true;
app.commandLine.appendSwitch('remote-debugging-port', '$port');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
require('$repoRoot\\dist-electron\\main.cjs');
"@
Set-Content -Path "$workerRoot\launch.cjs" -Value $launch -Encoding UTF8

$proc = Start-Process -FilePath "$repoRoot\node_modules\.bin\electron.cmd" `
  -ArgumentList "$workerRoot\launch.cjs" `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput "$workerRoot\electron.out.log" `
  -RedirectStandardError  "$workerRoot\electron.err.log" `
  -PassThru
"$($proc.Id)" | Out-File "$workerRoot\electron.pid" -Encoding utf8
```

WSL 旁路（若要复用 Linux 脚本）：保留 `bash` + `python3`，但路径改为挂载点（如 `\\wsl$\…\…`），CDP 端口不变，PowerShell 只承担启动隔离 Electron。

### WA.3 CDP 驱动脚本（Node.js，对应原 §Step 1 `cdp.mjs`）

```js
// cdp.mjs
import { readFile } from 'node:fs/promises';
const port = 9541;                 // 替换为分配给 worker 的端口
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
const expression = await readFile(process.argv[2], 'utf8');
const id = 1;
ws.send(JSON.stringify({
  id,
  method: 'Runtime.evaluate',
  params: { expression, awaitPromise: true, returnByValue: true }
}));
ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.id === id) { console.log(JSON.stringify(m.result)); ws.close(); }
});
```

启动与监控脚本对应 Linux §Step 2、§Step 3；同样以 `live-status.json`、`completed-tasks.json` 与 `production-blocker-current.json` 作为门禁；WA 临时文件（`*.partial.mp4`、`.jianji-*.txt`）的清理与原 §Step 4 / §6 一致。

### WA.4 taskset 不可用时的 CPU 限制

Windows 没有 `taskset`。可选：

1. `start /affinity <mask>` 启动 electron 进程（按位掩码选核）。
2. 用 PowerShell `[System.Diagnostics.Process]` 设 `ProcessorAffinity`；脚本需要至少 `SeIncreaseQuotaPrivilege` 才能跨进程修改，多数普通用户权限足够改自己启动的子进程。

WA 文档不强求做 CPU 限速；只在需要复刻 Linux 的固定核行为时启用。

### WA.5 端口与编码

- 端口：与 Linux 同；`netstat -ano | findstr :9541` 看占用；`Stop-Process -Id <pid>` 释放。
- 编码：所有 JSON 写入用 `UTF8`（含 BOM 由 `Out-File -Encoding utf8` 处理）；PowerShell 5.1 默认 ANSI，需要显式指定 `utf8` 或 `utf8BOM`。
- 路径分隔符：用 `Path.Combine` 或 `Join-Path`；脚本里避免硬编码 `\`。

### WA.6 闸口

- W21–W29 同样适用；任一 FAIL/BLOCKED/NOT_RUN 不能宣布「Windows Agent 验证完成」。
- `verify.py` 的 ffprobe 在 Windows 上改用 `ffprobe.exe`，从 `JIANJI_FFPROBE_PATH` 取绝对路径；不能用 `which ffprobe`。
- 残留临时文件：`Remove-Item -Force -Recurse` 删 `*.partial.mp4` 与 `.jianji-*.txt`；与 `verify.py` §file-set mismatch 检查一致。

## Guardrails And Invariants

- **产品 Agent 在 Windows 上的行为不变**：本规格不触碰算法、不动 schema、不改覆盖 / 审阅决策；只把它们在 Windows 上运行时是否真的能跑通纳入验收。
- **凭据与目录**：API Key 仍仅写在 `userData\connections\connections.json`；NSIS 安装版内置 FFmpeg 与 Noto 字体路径不得被替换为系统路径。
- **跨平台打包不互证**：Linux 出片 ≠ Windows 出片；GPU 列表 ≠ 实际可用；不可用视觉模型时必须在调用前拒绝制作（不得回退到创作连接）。
- **外部 agent 隔离**：worker 启动必须改写 `userData` 与 CDP 端口；不得读写 `%APPDATA%\jianji\connections`；不得重启用户应用；项目文件不得被 worker 写入用户主目录。
- **审阅角色**：独立复核默认关闭、只报告问题、不能批准或自动改稿；开放阶段也不通过本规格打开。
- **真实模型 / 真实账号 / 真实 GPU**：仍按 W11/W12 待人工验收，不在 W21–W29 中自动化跑商业模型。

## Testing And Verification

- **单元与集成**：`npm run typecheck`、`npm test`；新增不引入新测试文件；既有 `tests/product-price.test.ts`、`tests/agent-provider.test.ts` 不受影响并通过；桌面 smoke 与 packaged-runtime-smoke 在 Windows 上重跑通过。
- **W21–W29 自动化**：尽可能复用现有 desktop / packaged-runtime smoke 与 `batch-video-production-agent-playbook.md §Verify`；fixture 限于隔离模型、模拟服务、模拟 GitHub。真实商业模型、账号、GPU 按 W11/W12 人工。W29 不需要模型 fixture。
- **外部 agent**：按 WA.2 / §Step 2 / §Step 3 / §Step 4 在 Windows 安装版或开发版上启动 worker；最少跑 1 个版本的 Path B；与 Linux 上同样跑过的版本对比，仅做存在性证明，不要求逐字节一致。
- **文档**：`docs/windows-acceptance-spec.md` 加 W21–W29；`docs/batch-video-production-agent-playbook.md` 加 Windows Adaptation 小节；不修改 W01–W20 与既有 Linux 步骤。

## References

- [`../../CLAUDE.md`](../../CLAUDE.md) — 产品约束与 canonical ownership
- [`../../windows-acceptance-spec.md`](../../windows-acceptance-spec.md) — Windows 验收规范（待回写 W21–W29）
- [`../../windows-verification-0.1.2.md`](../../windows-verification-0.1.2.md) — 0.1.2 验证记录
- [`../../batch-video-production-agent-playbook.md`](../../batch-video-production-agent-playbook.md) — 外部 agent 操作（待补 Windows Adaptation）
- [`../../batch-video-production-runbook.md`](../../batch-video-production-runbook.md) — 批量制作合同与边界
- [`2026-09-21-pathb-append-production-design.md`](2026-09-21-pathb-append-production-design.md) — 应用内 Path B 设计
- [`../../README.md`](../../README.md) — 环境与启动

## Completion Notes

- 本规格仅为设计冻结；实现前需经 writing-plans 产出 implementation plan。
- 实现计划应明确只生成两份文档改动（`windows-acceptance-spec.md` 加 W21–W29；`batch-video-production-agent-playbook.md` 加 Windows Adaptation），不修改产品代码、不新增测试文件。注意：`docs/batch-video-production-agent-playbook.md` 当前未被 git 跟踪，实施时须先将现有内容作为基线单独提交，再提交 Windows Adaptation 增量，保证增量 diff 可审。
- 非微小文档改动，提交前必须对更新后的两份文档做实际可渲染性检查（Markdown 链接、表头、引用块）。
- 最终 review 按 dual-review gate：Codex native reviewer 与 Kimi deep reviewer 对同一 immutable snapshot（仅含两份文档 + 新规格）独立审查。
