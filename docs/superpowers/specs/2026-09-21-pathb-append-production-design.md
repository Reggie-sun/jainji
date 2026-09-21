# In-App Path B: Batch-Level Append Production Design

Date: 2026-09-21
Status: approved by user (2026-09-21), pending implementation plan

## Background

`docs/batch-video-production-agent-playbook.md` 目前以**外部脚本**方式执行 Path B：直接改写项目 JSON（重新生成全部 UUID、替换展示文字、改写输出目录、对覆盖层做 digest 断言），再用隔离 Electron 实例经 CDP 调 `retryExport` 完成无模型渲染。本设计把该能力下沉为应用内功能，并提供 agent 可调用的 IPC 面。

用户三项已确认决策：

1. **入口**：批次级追加——「作品」页每个已完成批次提供「追加制作」操作。
2. **覆盖保存**：维持现状（手动「保存覆盖设置」+「保存素材集」两步；半自动草稿即时落盘），只需保证 agent 能通过现有 IPC 稳定完成，不新增保存语义。
3. **展示文字**：追加对话框预填原批次文字（来源是用户自己的历史手动输入，非模型生成），允许修改，提交前仍过共享 schema 校验，空白拒绝。

关键语义事实：从单个批次克隆 N 条会得到 N 条内容完全相同的视频（同素材、同冻结模板、同文字，仅文件名不同）。真实 Path B 的多样性来自遍历不同源批次。UI 必须在条数 >1 时明示这一点。

## Goal And Non-Goals

### Goal

- 在 ResultsPanel 为已完成（含 `completed_with_errors`）批次提供「追加制作」入口。
- 克隆冻结 `templateSnapshot`，仅替换展示文字、重新生成全部 id、指向新输出目录，经原导出队列本地渲染，零模型调用。
- 提供 `window.jianji.appendProduction` / `appendProductionPrefill` IPC，使 agent 可无人值守驱动。
- 覆盖保存的 agent 可调用性以集成测试 + playbook 文档化交付（现有 `setCoverSticker`/`saveProject`/`coverReview.*` IPC 已足够）。

### Non-Goals

- 贴纸资源替换求变化（playbook 的 digest-swap 增强）。
- 修改克隆批次的 `decorationDisplayMode`/`stickerDisplayMode`（沿源批次冻结值）。
- 跨批次批量勾选追加、项目级一键追加。
- 改动覆盖保存语义、新增来源批次 provenance 字段、任何 schema version 迁移。

## Current-State Facts (Verified 2026-09-21)

- 已完成批次持久化在两处：`userData/jobs/<batchId>.json`（QueueState）与项目文件 `exportBatches[]`（`application.syncQueue` 同步）。`ExportBatch` 携带冻结 `templateSnapshot`（EditTemplate）、`mediaSnapshots`、`outputDirectory`、`preset`、`tasks[]`（[domain.ts:280-296](../../src/main/domain.ts)）。
- `queue.createBatchNow`（[queue.ts:269-309](../../src/main/queue.ts)）已具备：新鲜 batch/task id、`assertPriceOnlyTemplate`、素材 ready 校验、`assertOutputDirectorySafe`、`validateTemplateResources` 指纹校验、`allocateOutputPath` 不覆盖分配、JobStore 落盘。Agent 路径正是每个版本调一次它（[agent-controller.ts:304-310](../../src/main/agent-controller.ts)）。
- `export.retry` IPC（[index.ts:449](../../src/main/index.ts)）模式：`agent.assertIdle()` → `queue.retry`，复用冻结模板无模型渲染，是本设计直接参照的守卫形态。
- Renderer 公开队列经 `toPublicQueue` 剥离 `templateSnapshot`/`mediaSnapshots`（[application.ts:365-376](../../src/main/application.ts)），因此克隆与预填都必须发生在主进程。
- `assertPriceOnlyTemplate`（[domain.ts:216-224](../../src/main/domain.ts)）要求唯一的居中文字层位于 x=0.1/y=0.13/width=0.8 且 content 等于 `formatProductPrice(productPrice)`；`formatProductPrice` 对纯数字行加 `¥ ` 前缀（[decorations.ts:32-35](../../src/shared/decorations.ts)）。克隆写文字必须经此函数，否则 createBatch 与后续 retry 都会 `input_invalid`。
- `submission` 字段触发幂等提交路径（[queue.ts:246-267](../../src/main/queue.ts)），克隆必须恒 `undefined`，否则可能返回原批次或抛摘要冲突。
- 输出目录批准集 `approvedOutputDirectories` 由 `output.selectDirectory` / `output.createAutomaticDirectory` 维护（[index.ts:405-422](../../src/main/index.ts)），agent.start 与 export.create 都强制校验。
- 容量：`MAX_AGENT_OUTPUTS=250`（[shared/agent.ts:46](../../src/shared/agent.ts)）目前仅模型路径强制；retry 路径无上限。本设计对追加同样设 250 上限（`count × mediaIds.length ≤ 250`）。
- 克隆批次经 `syncQueue` 进入 `project.exportBatches` 后会参与 `previousCoverStickerId` 换款轮换（[cover-sticker.ts:57-65](../../src/main/cover-sticker.ts)）与 `completedCoverPlacements` 覆盖位置复用缓存（[cover-placement-session.ts:20-23](../../src/main/cover-placement-session.ts)）；源身份（指纹/时长/尺寸）完全一致时行为与 retry 一致，属良性。
- 覆盖保存链路：手动 `保存覆盖设置` → `setCoverSticker` IPC（[index.ts:297-301](../../src/main/index.ts)）→ `application.setCoverSticker` 校验后写内存标脏（[application.ts:119-125](../../src/main/application.ts)），`saveProject` 落盘；半自动 `coverReview.*` IPC 全程即时落盘（[application.ts:82-117](../../src/main/application.ts)）。两者均已被 resume 脚本验证可经 CDP 驱动。

## User Flow

1. 用户打开「作品」页，已完成（含 `completed_with_errors`）批次行显示「追加制作」按钮。
2. 点击后前端调 `appendProductionPrefill(batchId)`，主进程返回 `{productPrice, mediaCount}`（renderer 无 templateSnapshot，预填必须主进程提供）。
3. 对话框展示：源批次素材名与创建时间、展示文字输入框（预填、可改）、条数（默认 1，上限 250）、输出目录（默认「自动新建目录」，复用 `createAutomaticOutputDirectory` 批准流程；也可另选已批准目录）。
4. 条数 >1 时显示提示：「同一批次追加多条将生成内容相同的视频，仅文件名不同；需要不同画面请从多个批次各追加 1 条。」
5. 提交调 `appendProduction(input)`；新批次以 `active` 状态出现在任务列表，走原有渲染进度、完成通知与文件校验。
6. 取消/关闭对话框不产生任何持久化副作用。

## Main-Process Design

### `cloneTemplateForAppend(template, productPrice)` — domain.ts

模板域 owner 新增纯函数：

1. 深拷贝冻结 `EditTemplate`。
2. 重新生成模板 id 与全部 layer id（`EditTemplateSchema` superRefine 要求 layer id 唯一，[domain.ts:176-203](../../src/main/domain.ts)）。
3. 居中文字层 content 设为 `formatProductPrice(productPrice)`；模板 `productPrice` 字段同步更新。
4. 其余一切——贴纸层、覆盖层几何/轨迹/时段、`decorationDisplayMode`/`stickerDisplayMode`、滤镜、布局策略——逐字节保持。
5. **Digest 自校验（fail-closed）**：本设计不做贴纸资源替换，克隆后除「再生的 id」与「刻意改动的文字层 content/模板 productPrice」外必须与源模板逐字节一致。实现：对全部图层剔除 `id` 字段、对文字层再剔除 `content`、对模板根剔除 `productPrice` 后做 SHA-256，克隆前后必须一致，否则抛错。这防止 id 再生成代码误触几何或任何其他字段。

### `appendFromBatch(sourceBatch, {count, productPrice, outputDirectory})` — queue.ts

导出生命周期 owner 新增方法：循环 `count` 次调用现有 `createBatchNow`（复用其全部校验与不覆盖分配），`submission` 恒 `undefined`。任一 `createBatchNow` 失败即中止并抛出，已成功创建的批次保留（与 agent 逐版入队行为一致）。

### `export.append` IPC — index.ts

守卫顺序复用 `export.retry` 形态：

1. `agent.assertIdle()`（队列空闲，不与运行中任务竞争）。
2. `AppendProductionSchema.parse(input)`（共享 schema 入口校验）。
3. 从 `queue.states` + `jobStore.loadAll()` 找源批次；找不到报 `input_invalid`。
4. **拒绝跨项目**：`source.projectId !== 当前项目 id` 报错。
5. 输出目录必须在 `approvedOutputDirectories`。
6. `count × sourceBatch.mediaIds.length ≤ MAX_AGENT_OUTPUTS`（250）。
7. 委托 `queue.appendFromBatch`，返回新批次摘要（ids、输出目录）。

## Contracts

### `AppendProductionSchema` — shared/agent.ts

制作请求校验 owner 新增：

```
{ batchId: uuid, count: int 1..250, productPrice: RequiredProductPriceSchema, outputDirectory: string(非空) }
```

展示文字校验继续由共享 schema 独占定义；空白、超行、超长在 IPC 入口拒绝，不靠前端禁用按钮。

### Preload 新增

- `appendProductionPrefill(batchId) → { productPrice, mediaCount }`
- `appendProduction(input) → { batchIds: string[], outputDirectory: string }`

无新增持久化字段、无 schema version 变更、无迁移。

## Guardrails And Invariants

- **冻结契约**：克隆不动覆盖几何/轨迹/角落布局/时序模式，digest 证明；不重识别、不换款、不改轨迹。
- **展示文字**：预填来源是用户自己的历史手动输入；提交前过 `RequiredProductPriceSchema`；空值拒绝。产品 Agent 不参与此流程。
- **输出安全**：`allocateOutputPath` 不覆盖已有文件；目录需批准；先写临时输出验证后再发布（沿用 createBatchNow → execute 路径）。
- **历史效应**：克隆批次进入 `exportBatches` 后参与后续换款轮换与覆盖位置复用，与 retry 行为一致。
- **源素材变动**：`execute()` 指纹校验失败 → 任务显式失败，不静默。
- **错误显式**：克隆 digest 不匹配、跨项目、目录未批准、超容量、队列为忙均显式报错，不回退、不重试。

## Testing And Verification

- **单元**：`cloneTemplateForAppend`（id 全新、文字层 content 等于 `formatProductPrice`、digest 一致、几何逐字节相等）；`AppendProductionSchema`（空文字/超长/超上限/非 uuid 拒绝）。
- **queue 集成**：`appendFromBatch` 产出 N 个批次、id 无碰撞、无 `submission`、输出路径互不覆盖、JobStore 落盘；追加 → 真实渲染完成（沿用现有 queue 测试夹具与 FFmpeg）。
- **准入回归**：`tests/product-price.test.ts`、`tests/agent-provider.test.ts` 不受影响并通过。
- **静态**：`npm run typecheck` + 受影响测试。
- **UI smoke**：按 README 桌面 smoke，CDP 驱动对话框全流程（预填 → 改文字 → 追加 2 条 → 渲染完成 → 文件校验）。
- **文档**：playbook 增补「应用内 Path B」章节：UI 路径 + agent 经 `window.jianji.appendProduction` 的调用序列。

## Completion Notes

- 本 spec 仅为设计冻结；实现前需经 writing-plans 产出 implementation plan。
- 非微小 UI 行为变更，完成时必须提供实际交互验证证据。
- 最终 review 按 dual-review gate：Codex native reviewer + Kimi deep reviewer 对同一 immutable snapshot 独立审查。
