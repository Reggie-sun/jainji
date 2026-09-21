# In-App Path B Append Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「作品」页为已完成批次提供「追加制作」入口：克隆冻结模板、仅替换展示文字、经原导出队列零模型调用渲染 N 条，并提供 agent 可驱动的 IPC。

**Architecture:** 克隆与预填全部发生在主进程（renderer 看不到 `templateSnapshot`）。`domain.ts` 提供带 digest 自校验的纯函数克隆；`queue.ts` 复用现有 `createBatchNow` 循环入队（继承全部校验与不覆盖发布）；`index.ts` 新增 `export.appendPrefill`/`export.append` 两个 IPC（守卫形态复用 `export.retry`/`export.create`）；`ResultsPanel` 在已完成批次行挂「追加制作」按钮并挂载自包含对话框。

**Tech Stack:** Electron + React 18 + TypeScript（strict）、zod、vitest、vite。

**Spec:** [docs/superpowers/specs/2026-09-21-pathb-append-production-design.md](../specs/2026-09-21-pathb-append-production-design.md) — 计划逐条论证自该 spec，执行者须同时阅读。

## Global Constraints

- 展示文字校验由共享 schema 独占：`RequiredProductPriceSchema`（[src/shared/decorations.ts:31](../../../src/shared/decorations.ts)）。空白、超 2 行、每行超 12 字必须在 IPC 入口被拒绝，不得仅靠前端禁用按钮。
- 冻结契约：克隆只允许改「模板 id + 全部图层 id + 文字层 content + 根 productPrice」，其余字段（贴纸/覆盖几何、轨迹、`decorationDisplayMode`/`stickerDisplayMode`、滤镜、布局策略）逐字节一致，由 `appendTemplateDigest` SHA-256 自校验 fail-closed。
- 克隆批次 `submission` 恒 `undefined`，绝不走幂等提交路径（[queue.ts:246-267](../../../src/main/queue.ts)）。
- 容量上限：`count × mediaIds.length ≤ MAX_AGENT_OUTPUTS (250)`（[src/shared/agent.ts:46](../../../src/shared/agent.ts)），检查放 `queue.appendFromBatch` 便于无 Electron 测试。
- 文字层 content 必须经 `formatProductPrice`（[decorations.ts:32-35](../../../src/shared/decorations.ts)），否则 `assertPriceOnlyTemplate`（[domain.ts:216-224](../../../src/main/domain.ts)）在 createBatch/retry/execute 三处拒绝。
- 输出目录必须已在 `approvedOutputDirectories`（[index.ts:73](../../../src/main/index.ts)）；发布经 `publishWithoutReplacement` 的 `link()` EEXIST 重分配，不覆盖已有文件（[queue.ts:805-818](../../../src/main/queue.ts)）。
- 零模型调用：追加路径不得触碰 `AgentController`/`agent-runner`；守卫 `agent.assertIdle()` 仅防止与运行中制作竞争。
- UI 文案中文；count > 1 时对话框必须显示「内容相同」提示。
- commit 只 `git add <specific-files>`（禁止 `git add .`），message 末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- **`src/main/index.ts` 存在与本任务无关的未提交改动（`requestQuit` 异步化，约 504–667 行）。执行 Task 4 前必须先 `git diff src/main/index.ts` 确认现状，编辑时不得回退这些改动；stage 该文件会连带这些改动，处理方式以用户在执行前的决定为准（默认建议：先由用户或 parent 把 quit-flow 修复单独提交）。**

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| [src/shared/agent.ts](../../../src/shared/agent.ts) | `AppendProductionSchema` 请求校验（shared 唯一入口） | Modify（L47 后插入） |
| [src/main/domain.ts](../../../src/main/domain.ts) | `appendTemplateDigest` + `cloneTemplateForAppend` 纯函数（模板域 owner） | Modify（L3 import、L224 后插入） |
| [src/main/queue.ts](../../../src/main/queue.ts) | `appendPrefill`/`appendFromBatch`/`findAppendSource`（导出生命周期 owner） | Modify（import + L309 后插入） |
| [src/main/index.ts](../../../src/main/index.ts) | `export.appendPrefill`/`export.append` IPC 守卫 | Modify（L19 import、L49 后 schema、L449 后 handler） |
| [src/main/preload.ts](../../../src/main/preload.ts) | `appendProductionPrefill`/`appendProduction` 桥接 | Modify（L2 import、L64 后插入） |
| [src/renderer/AppendProductionDialog.tsx](../../../src/renderer/AppendProductionDialog.tsx) | 自包含追加对话框（展示文字/条数/输出目录/提交） | Create |
| [src/renderer/ResultsPanel.tsx](../../../src/renderer/ResultsPanel.tsx) | 已完成批次行「追加制作」按钮 + 对话框挂载 | Modify |
| [tests/append-production.test.ts](../../../tests/append-production.test.ts) | schema + 克隆单元测试 | Create |
| [tests/append-production-queue.test.ts](../../../tests/append-production-queue.test.ts) | queue 集成测试（渲染完成、不覆盖、守卫） | Create |
| [tests/append-production-dialog.test.ts](../../../tests/append-production-dialog.test.ts) | 对话框 SSR 测试（预填、提示） | Create |
| [tests/results-panel.test.ts](../../../tests/results-panel.test.ts) | 追加按钮出现条件回归 | Modify（追加 1 个用例） |
| [tests/cover-save-agent.test.ts](../../../tests/cover-save-agent.test.ts) | 覆盖保存 agent 序列（setCoverSticker→saveProject→重载）集成测试 | Create |
| [docs/batch-video-production-agent-playbook.md](../../../docs/batch-video-production-agent-playbook.md) | 「应用内 Path B」章节（UI 路径 + agent IPC 序列 + 覆盖保存序列） | Modify |

---

### Task 1: AppendProductionSchema（shared/agent.ts）

**Files:**
- Modify: `src/shared/agent.ts`（在 L47 `ProductionMultiplierSchema` 之后插入）
- Test: `tests/append-production.test.ts`（新建，本任务只写 schema describe）

**Interfaces:**
- Consumes: `RequiredProductPriceSchema`、`MAX_AGENT_OUTPUTS`（均已在 agent.ts 内可用，L2 import 无需改）。
- Produces: `AppendProductionSchema`（zod strict object）、`AppendProductionInput`（`z.infer`）。Task 4 的 IPC 与 preload 依赖这两个名字。

- [ ] **Step 1: Write the failing test**

创建 `tests/append-production.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { AppendProductionSchema } from "../src/shared/agent";

describe("AppendProductionSchema", () => {
  const valid = { batchId: crypto.randomUUID(), count: 2, productPrice: "19.9元拍一发三", outputDirectory: "/tmp/out" };
  it("accepts a valid append request", () => {
    expect(AppendProductionSchema.parse(valid)).toEqual(valid);
  });
  it.each([
    ["non-uuid batchId", { ...valid, batchId: "not-a-uuid" }],
    ["count 0", { ...valid, count: 0 }],
    ["count above 250", { ...valid, count: 251 }],
    ["fractional count", { ...valid, count: 1.5 }],
    ["blank display text", { ...valid, productPrice: "" }],
    ["line over 12 chars", { ...valid, productPrice: "一二三四五六七八九十一二三" }],
    ["three lines", { ...valid, productPrice: "一\n二\n三" }],
    ["blank middle line", { ...valid, productPrice: "一\n \n二" }],
    ["empty output directory", { ...valid, outputDirectory: "" }],
    ["unexpected key", { ...valid, extra: true }],
  ])("rejects %s", (_label, input) => {
    expect(AppendProductionSchema.safeParse(input).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/append-production.test.ts`
Expected: FAIL，编译错误 `AppendProductionSchema` 未导出（TS2305 或 vitest 收集失败）。

- [ ] **Step 3: Write minimal implementation**

在 `src/shared/agent.ts` L47（`ProductionMultiplierSchema` 行）之后插入：

```ts
export const AppendProductionSchema = z.object({
  batchId: z.string().uuid(),
  count: z.number().int().min(1).max(MAX_AGENT_OUTPUTS),
  productPrice: RequiredProductPriceSchema,
  outputDirectory: z.string().min(1),
}).strict();
export type AppendProductionInput = z.infer<typeof AppendProductionSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/append-production.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent.ts tests/append-production.test.ts
git commit -m "feat: add append-production request schema

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: appendTemplateDigest + cloneTemplateForAppend（domain.ts）

**Files:**
- Modify: `src/main/domain.ts`（L3 import 加 `createHash`；`assertPriceOnlyTemplate` 块 L224 结束后插入两个函数）
- Test: `tests/append-production.test.ts`（追加 clone describe）

**Interfaces:**
- Consumes: 现有 `cloneTemplate`（L376，函数声明有提升，可提前引用）、`RequiredProductPriceSchema`/`formatProductPrice`（L7 已 import）、`JianjiError`（L14 已 import）、`materializePlan`（测试用，[src/main/agent-provider.ts](../../../src/main/agent-provider.ts)，price-only.test.ts 同款夹具）。
- Produces: `appendTemplateDigest(template: EditTemplate): string`、`cloneTemplateForAppend(template: EditTemplate, productPrice: string): EditTemplate`。Task 3 的 queue 与 Task 3/4 的测试依赖这两个导出。

设计要点（对应 spec §Main-Process Design）：
- digest 剔除：根 `id`、根 `productPrice`、全部图层 `id`、文字层 `content`；其余一切（含 `createdAt`/`updatedAt`，克隆保持原值）必须哈希一致。
- 源模板必须恰含 1 个文字层，否则显式抛错（空模板/旧版布局无法追加）。
- 克隆自校验 digest 不一致即抛错（防 id 再生成误触几何）。

- [ ] **Step 1: Write the failing test**

在 `tests/append-production.test.ts` 顶部 import 区追加，并在文件末尾追加 describe：

```ts
import { appendTemplateDigest, assertPriceOnlyTemplate, cloneTemplateForAppend, createDefaultTemplate, EditTemplateSchema } from "../src/main/domain";
import { materializePlan } from "../src/main/agent-provider";
import { formatProductPrice } from "../src/shared/decorations";
import type { StickerAssets } from "../src/main/builtin-stickers";

const dimensions = { width: 720, height: 1280 };
const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as unknown as StickerAssets;
const automaticCatalog = { fonts: [], stickers: [{ id: "heart", label: "爱心" }] };
const pricedTemplate = (productPrice: string) => materializePlan(
  { summary: "测试方案", captions: [], filter: "warm", intensity: 0.4, priceStyle: "classic", stickers: [
    { corner: "top-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
    { corner: "top-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
    { corner: "bottom-left", sticker: "heart", width: 0.08, rotationDeg: 0 },
    { corner: "bottom-right", sticker: "heart", width: 0.08, rotationDeg: 0 },
  ] },
  "black-gold", dimensions, stickerAssets, { mode: "agent", productPrice, sticker: "none" }, automaticCatalog,
);

describe("cloneTemplateForAppend", () => {
  it("regenerates every id, swaps only the display text, and proves the rest byte-identical", () => {
    const source = pricedTemplate("19.9元拍一发三");
    const cloned = cloneTemplateForAppend(source, "29.9元\n第二件半价");
    expect(cloned.id).not.toBe(source.id);
    expect(cloned.productPrice).toBe("29.9元\n第二件半价");
    const sourceIds = source.layers.map((layer) => layer.id);
    const clonedIds = cloned.layers.map((layer) => layer.id);
    expect(new Set(clonedIds).size).toBe(cloned.layers.length);
    for (const id of clonedIds) expect(sourceIds).not.toContain(id);
    const sourceText = source.layers.find((layer) => layer.type === "text");
    const clonedText = cloned.layers.find((layer) => layer.type === "text");
    if (clonedText?.type !== "text") throw new Error("missing text layer");
    expect(clonedText.content).toBe(formatProductPrice("29.9元\n第二件半价"));
    expect(clonedText.id).not.toBe(sourceText?.id);
    expect(appendTemplateDigest(cloned)).toBe(appendTemplateDigest(source));
    expect(() => EditTemplateSchema.parse(cloned)).not.toThrow();
    expect(() => assertPriceOnlyTemplate(cloned)).not.toThrow();
  });

  it("formats pure numeric lines with the yen prefix", () => {
    const cloned = cloneTemplateForAppend(pricedTemplate("原价 99"), "19.9");
    const text = cloned.layers.find((layer) => layer.type === "text");
    if (text?.type !== "text") throw new Error("missing text layer");
    expect(text.content).toBe("¥ 19.9");
    expect(cloned.productPrice).toBe("19.9");
  });

  it("rejects invalid display text before touching the template", () => {
    expect(() => cloneTemplateForAppend(pricedTemplate("19.9元拍一发三"), "")).toThrow();
  });

  it("rejects sources without exactly one text layer", () => {
    expect(() => cloneTemplateForAppend(createDefaultTemplate(), "19.9元拍一发三")).toThrow(/展示文字层/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/append-production.test.ts`
Expected: FAIL，`appendTemplateDigest`/`cloneTemplateForAppend` 未导出。

- [ ] **Step 3: Write minimal implementation**

`src/main/domain.ts` L3 改为：

```ts
import { createHash, randomUUID } from "node:crypto";
```

在 `assertPriceOnlyTemplate` 函数块结束（L224 `}`）之后插入：

```ts
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hash everything an append clone must preserve: strips regenerated ids, the text layer content, and the root price. */
export function appendTemplateDigest(template: EditTemplate): string {
  const comparable = {
    ...template,
    id: undefined,
    productPrice: undefined,
    layers: template.layers.map((layer) => ({ ...layer, id: undefined, ...(layer.type === "text" ? { content: undefined } : {}) })),
  };
  return createHash("sha256").update(canonicalJson(comparable)).digest("hex");
}

export function cloneTemplateForAppend(template: EditTemplate, productPrice: string): EditTemplate {
  const price = RequiredProductPriceSchema.parse(productPrice);
  if (template.layers.filter((layer) => layer.type === "text").length !== 1) {
    throw new JianjiError("源批次不含可复用的展示文字层，无法追加制作。", "input_invalid", "input", false);
  }
  const before = appendTemplateDigest(template);
  const cloned = cloneTemplate(template);
  cloned.id = randomUUID();
  cloned.productPrice = price;
  for (const layer of cloned.layers) {
    layer.id = randomUUID();
    if (layer.type === "text") layer.content = formatProductPrice(price);
  }
  if (appendTemplateDigest(cloned) !== before) {
    throw new JianjiError("追加制作克隆校验失败：冻结方案在克隆中发生变化。", "input_invalid", "input", false);
  }
  return cloned;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/append-production.test.ts`
Expected: PASS（schema 2 + clone 4 用例）。

- [ ] **Step 5: Commit**

```bash
git add src/main/domain.ts tests/append-production.test.ts
git commit -m "feat: clone frozen templates for append production

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: queue.appendPrefill + appendFromBatch（queue.ts）

**Files:**
- Modify: `src/main/queue.ts`（import 区 L4-20 加 `cloneTemplateForAppend`；新增 `../shared/agent.js` import；`createBatchNow` 结束 L309 后插入三个方法）
- Test: `tests/append-production-queue.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 `cloneTemplateForAppend`、`appendTemplateDigest`（测试断言用）；现有 `createBatchNow`（L269）、`this.states`、`this.dependencies.jobStore.load`（[store.ts:192](../../../src/main/store.ts)）、`this.mediaLookup`（L632）、`MAX_AGENT_OUTPUTS`。
- Produces:
  - `appendPrefill(batchId: string, projectId: string): Promise<{ productPrice: string; mediaCount: number } | undefined>`
  - `appendFromBatch(input: { batchId: string; projectId: string; count: number; productPrice: string; outputDirectory: string }, signal?: AbortSignal): Promise<ExportBatch[]>`（只创建不启动；启动由 IPC 按 `export.create` 形态 `void queue.start(id)`）
  - Task 4 的 IPC 与 Task 5 的 preload 契约依赖以上签名。

行为要点：
- 跨项目、非完成状态（非 `completed`/`completed_with_errors`）、超容量、素材缺失均显式 `JianjiError` 抛错。
- `mediaItems` 优先 `mediaSnapshots`，缺快照（旧批次）回退 `mediaLookup`。
- 循环 `createBatchNow` 继承 `assertPriceOnlyTemplate`/`assertOutputDirectorySafe`/`validateTemplateResources`/不覆盖分配；`submission` 不传（恒 undefined）。任一失败即中止，已创建批次保留（与 agent 逐版入队一致）。
- 多克隆同素材同目录时创建期 outputPath 可同名——发布期 `publishWithoutReplacement` 经 `link()` EEXIST 重分配唯一名并回写 `task.outputPath`（[queue.ts:720](../../../src/main/queue.ts)、805-818），测试必须断言完成后的路径。

- [ ] **Step 1: Write the failing test**

创建 `tests/append-production-queue.test.ts`：

```ts
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactVerifier } from "../src/main/artifact";
import { materializePlan } from "../src/main/agent-provider";
import { DEFAULT_PRESET, appendTemplateDigest, now, type ExportBatch, type MediaItem, type OutputArtifact } from "../src/main/domain";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import type { StickerAssets } from "../src/main/builtin-stickers";

const stickerAssets = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: "fixture" }])) as unknown as StickerAssets;
const manualTemplate = (productPrice: string) => materializePlan(
  { summary: "测试方案", captions: [], filter: "warm", intensity: 0.4 },
  "black-gold", { width: 720, height: 1280 }, stickerAssets, { mode: "manual", productPrice, sticker: "none" },
);
const makeMedia = async (id: string, sourcePath: string): Promise<MediaItem> => ({ id, sourcePath, displayName: path.basename(sourcePath), fingerprint: await fingerprintFile(sourcePath), sizeBytes: 1, durationMs: 1_000, width: 10, height: 10, rotation: 0, probeStatus: "ready", importedAt: now() });
const fakeQueue = (directory: string, jobs = "jobs") => {
  const ffmpeg = { ffmpegPath: "/fake/ffmpeg", run: (args: string[]) => ({ process: {}, promise: (async () => { await writeFile(args[args.length - 1], "encoded"); return { code: 0, stdout: "", stderr: "" }; })(), cancel: async () => undefined }) } as unknown as FfmpegAdapter;
  const verifier = { verify: async (filePath: string, taskId: string): Promise<OutputArtifact> => ({ taskId, path: filePath, sizeBytes: 1, durationMs: 1_000, createdAt: now() }) } as unknown as ArtifactVerifier;
  const compiler = { compile: async () => ({ binary: "/fake", args: [], textFiles: [], durationSeconds: 1 }) } as any;
  return new ExportQueue({ jobStore: new JobStore(path.join(directory, jobs)), ffmpeg, compiler, artifactVerifier: verifier, fontResolver: { resolve: async () => "/tmp/font.ttf" } });
};
const completedSource = async (queue: ExportQueue, directory: string, media: MediaItem, projectId: string, productPrice = "19.9元拍一发三") => {
  const source = await queue.createBatch({ projectId, template: manualTemplate(productPrice), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out1"), preset: DEFAULT_PRESET });
  await queue.start(source.id);
  expect(queue.snapshot().batches[0].batch.status).toBe("completed");
  return source;
};

describe("appendFromBatch", () => {
  it("appends N rendered clones of a completed batch without model calls or overwrites", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);

    const appended = await queue.appendFromBatch({ batchId: source.id, projectId, count: 2, productPrice: "29.9元\n第二件半价", outputDirectory: path.join(directory, "out2") });
    expect(appended).toHaveLength(2);
    expect(new Set(appended.map((batch) => batch.id)).size).toBe(2);
    expect(appended.every((batch) => batch.id !== source.id)).toBe(true);
    expect(appended.every((batch) => batch.submission === undefined)).toBe(true);
    for (const batch of appended) {
      expect(batch.projectId).toBe(projectId);
      expect(batch.templateSnapshot.id).not.toBe(source.templateSnapshot.id);
      expect(batch.templateSnapshot.productPrice).toBe("29.9元\n第二件半价");
      const text = batch.templateSnapshot.layers.find((layer) => layer.type === "text");
      if (text?.type !== "text") throw new Error("missing text layer");
      expect(text.content).toBe("29.9元\n第二件半价");
      expect(appendTemplateDigest(batch.templateSnapshot)).toBe(appendTemplateDigest(source.templateSnapshot));
    }

    await Promise.all(appended.map((batch) => queue.start(batch.id)));
    const states = queue.snapshot().batches.map((state) => state.batch);
    const finished = appended.map((batch) => states.find((candidate) => candidate.id === batch.id)!);
    expect(finished.every((batch) => batch.status === "completed")).toBe(true);
    const outputPaths = finished.map((batch) => batch.tasks[0].outputPath);
    expect(new Set(outputPaths).size).toBe(2);
    for (const outputPath of outputPaths) expect(outputPath?.startsWith(path.join(directory, "out2") + path.sep)).toBe(true);
    expect((await readdir(path.join(directory, "out2"))).filter((name) => name.endsWith(".mp4"))).toHaveLength(2);
    expect((await new JobStore(path.join(directory, "jobs")).loadAll())).toHaveLength(3);
  });

  it("returns the frozen display text and media count for dialog prefill", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-prefill-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);

    expect(await queue.appendPrefill(source.id, projectId)).toEqual({ productPrice: "19.9元拍一发三", mediaCount: 1 });
    expect(await queue.appendPrefill(source.id, crypto.randomUUID())).toBeUndefined();
    expect(await queue.appendPrefill(crypto.randomUUID(), projectId)).toBeUndefined();
  });

  it("rejects cross-project, over-capacity, and not-yet-completed appends", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-guards-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const queue = fakeQueue(directory);
    queue.setMediaLookup((id) => (id === media.id ? media : undefined));
    const projectId = crypto.randomUUID();
    const source = await completedSource(queue, directory, media, projectId);
    const output = path.join(directory, "out2");

    await expect(queue.appendFromBatch({ batchId: source.id, projectId: crypto.randomUUID(), count: 1, productPrice: "1元", outputDirectory: output })).rejects.toThrow(/当前项目/);
    await expect(queue.appendFromBatch({ batchId: source.id, projectId, count: 251, productPrice: "1元", outputDirectory: output })).rejects.toThrow(/250/);
    const active = await queue.createBatch({ projectId, template: manualTemplate("1元"), mediaIds: [media.id], mediaItems: [media], outputDirectory: path.join(directory, "out3"), preset: DEFAULT_PRESET });
    await expect(queue.appendFromBatch({ batchId: active.id, projectId, count: 1, productPrice: "1元", outputDirectory: output })).rejects.toThrow(/已完成/);
  });

  it("rejects appends whose legacy source has no usable media snapshots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-append-legacy-"));
    const sourcePath = path.join(directory, "a.mp4");
    await writeFile(sourcePath, "a");
    const media = await makeMedia(crypto.randomUUID(), sourcePath);
    const projectId = crypto.randomUUID();
    const origin = fakeQueue(directory, "jobs-origin");
    origin.setMediaLookup((id) => (id === media.id ? media : undefined));
    const source = await completedSource(origin, directory, media, projectId);

    const legacyBatch = structuredClone(source) as ExportBatch;
    delete legacyBatch.mediaSnapshots;
    const legacyQueue = fakeQueue(directory, "jobs-legacy");
    legacyQueue.setMediaLookup(() => undefined);
    await legacyQueue.hydrate([legacyBatch]);
    await expect(legacyQueue.appendFromBatch({ batchId: legacyBatch.id, projectId, count: 1, productPrice: "1元", outputDirectory: path.join(directory, "out2") })).rejects.toThrow(/素材已变化/);
  });
});
```

注：legacy 用例中 `hydrate` 会把 queued 任务标记 interrupted，批次状态变为 `completed_with_errors`，仍通过完成状态守卫、走到素材守卫。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/append-production-queue.test.ts`
Expected: FAIL，`appendPrefill`/`appendFromBatch` 不存在（TS2339）。

- [ ] **Step 3: Write minimal implementation**

`src/main/queue.ts` 两处 import 修改：

```ts
// L4-20 的 domain.js import 列表中加入 cloneTemplateForAppend（放 cloneTemplate 后）
  cloneTemplate,
  cloneTemplateForAppend,
// L32 后新增一行：
import { MAX_AGENT_OUTPUTS } from "../shared/agent.js";
```

在 `createBatchNow` 结束（L309 `}`）之后插入：

```ts
  async appendPrefill(batchId: string, projectId: string): Promise<{ productPrice: string; mediaCount: number } | undefined> {
    const source = await this.findAppendSource(batchId);
    if (!source || source.projectId !== projectId) return undefined;
    return { productPrice: source.templateSnapshot.productPrice ?? "", mediaCount: source.mediaIds.length };
  }

  async appendFromBatch(input: { batchId: string; projectId: string; count: number; productPrice: string; outputDirectory: string }, signal?: AbortSignal): Promise<ExportBatch[]> {
    const source = await this.findAppendSource(input.batchId);
    if (!source || source.projectId !== input.projectId) throw new JianjiError("只能追加当前项目中的已完成批次。", "input_invalid", "input", false);
    if (source.status !== "completed" && source.status !== "completed_with_errors") throw new JianjiError("只能追加已完成导出的批次。", "input_invalid", "input", false);
    if (input.count * source.mediaIds.length > MAX_AGENT_OUTPUTS) throw new JianjiError(`追加条数超出单次上限 ${MAX_AGENT_OUTPUTS} 条。`, "input_invalid", "input", false);
    const mediaItems = source.mediaIds.map((id) => source.mediaSnapshots?.find((item) => item.id === id) ?? this.mediaLookup?.(id));
    if (mediaItems.some((item): item is undefined => !item)) throw new JianjiError("源批次素材已变化，无法追加制作。", "input_invalid", "input", false);
    const media = mediaItems as MediaItem[];
    const created: ExportBatch[] = [];
    for (let index = 0; index < input.count; index += 1) {
      const template = cloneTemplateForAppend(source.templateSnapshot, input.productPrice);
      created.push(await this.createBatchNow({ template, projectId: source.projectId, mediaIds: [...source.mediaIds], mediaItems: media, outputDirectory: input.outputDirectory, preset: source.preset }, signal));
    }
    return created;
  }

  private async findAppendSource(batchId: string): Promise<ExportBatch | undefined> {
    const cached = this.states.get(batchId);
    if (cached) return structuredClone(cached.batch);
    try {
      return structuredClone((await this.dependencies.jobStore.load(batchId)).state.batch);
    } catch {
      return undefined;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/append-production-queue.test.ts`
Expected: PASS（4 个用例）。再跑 `npx vitest run tests/queue.test.ts` 确认未破坏现有队列行为。

- [ ] **Step 5: Commit**

```bash
git add src/main/queue.ts tests/append-production-queue.test.ts
git commit -m "feat: append production batches from completed exports

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: IPC handlers + preload API（index.ts + preload.ts）

**Files:**
- Modify: `src/main/index.ts`（L19 import、L49 后 schema、L449 `export.retry` handler 后插入两个 handler）
- Modify: `src/main/preload.ts`（L2 import、L64 `retryExport` 后插入两个方法）

**Interfaces:**
- Consumes: Task 1 `AppendProductionSchema`/`AppendProductionInput`；Task 3 `queue.appendPrefill`/`queue.appendFromBatch`；现有 `assertTrustedSender`、`agent.assertIdle()`、`capabilities.ready`、`canonicalPath`、`approvedOutputDirectories`、`service.currentProject.id`、`uuidSchema`。
- Produces: IPC 通道 `export.appendPrefill` → `{ productPrice: string; mediaCount: number }`；`export.append` → `{ batchIds: string[]; outputDirectory: string }`。preload 方法 `window.jianji.appendProductionPrefill(batchId)` / `window.jianji.appendProduction(input)`（Task 5 对话框依赖；`src/renderer.d.ts` 的 `DesktopApi = typeof api` 自动获得类型）。

**执行前置（MUST）**：先 `git diff src/main/index.ts`，确认仅有 requestQuit 相关未提交改动（约 504–667 行）；本任务 diff 不得触碰该区域。stage 该文件前确认用户已决定 quit-flow 改动归属（见 Global Constraints 末条）。

- [ ] **Step 1: 修改 `src/main/index.ts`**

L19 import 行改为：

```ts
import { AgentStartSchema, AppendProductionSchema, FrozenAgentStartSchema } from "../shared/agent.js";
```

在 L49 `retrySchema` 之后插入：

```ts
const appendPrefillSchema = z.object({ batchId: uuidSchema }).strict();
```

在 L449 `export.retry` handler 之后插入：

```ts
  ipcMain.handle("export.appendPrefill", async (event, input: unknown) => {
    assertTrustedSender(event);
    const { batchId } = appendPrefillSchema.parse(input);
    const prefill = await queue.appendPrefill(batchId, service.currentProject.id);
    if (!prefill) throw new Error("找不到属于当前项目的已完成批次。");
    return prefill;
  });
  ipcMain.handle("export.append", async (event, input: unknown) => {
    assertTrustedSender(event);
    agent.assertIdle();
    if (!capabilities.ready) throw new Error(capabilities.message ?? "FFmpeg capability is not ready");
    const parsed = AppendProductionSchema.parse(input);
    const outputDirectory = await canonicalPath(parsed.outputDirectory);
    if (!approvedOutputDirectories.has(outputDirectory)) throw new Error("请选择由系统对话框授权的输出目录。");
    const batches = await queue.appendFromBatch({ batchId: parsed.batchId, projectId: service.currentProject.id, count: parsed.count, productPrice: parsed.productPrice, outputDirectory });
    for (const batch of batches) void queue.start(batch.id);
    return { batchIds: batches.map((batch) => batch.id), outputDirectory };
  });
```

说明：状态守卫（跨项目/完成状态/容量/素材）在 `queue.appendFromBatch` 内已显式抛错，IPC 不重复；`capabilities.ready` 检查对齐 `export.create`（追加同样创建新渲染）。

- [ ] **Step 2: 修改 `src/main/preload.ts`**

L2 import 行改为：

```ts
import type { AgentStartInput, AppendProductionInput, GenerateBriefInput } from "../shared/agent.js";
```

在 L64 `retryExport` 之后插入：

```ts
  appendProductionPrefill: (batchId: string): Promise<{ productPrice: string; mediaCount: number }> => ipcRenderer.invoke("export.appendPrefill", { batchId }),
  appendProduction: (input: AppendProductionInput): Promise<{ batchIds: string[]; outputDirectory: string }> => ipcRenderer.invoke("export.append", input),
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过，无新增错误。

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/main/preload.ts
git commit -m "feat: expose append production over IPC

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: AppendProductionDialog + ResultsPanel 接线（renderer）

**Files:**
- Create: `src/renderer/AppendProductionDialog.tsx`
- Modify: `src/renderer/ResultsPanel.tsx`（4 处 hunk）
- Test: `tests/append-production-dialog.test.ts`（新建）、`tests/results-panel.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 4 的 `window.jianji.appendProductionPrefill`/`appendProduction`/`createAutomaticOutputDirectory`/`selectOutputDirectory`；现有 CSS 类 `result-preview-backdrop`、`result-preview-dialog card`、`card-header`、`directory-picker`、`notice error`、`button primary/secondary`、`text-button`、`icon-button`（不新增 CSS）；`PublicExportBatch` 类型（[application.ts:25](../../../src/main/application.ts)，`Omit<ExportBatch,"templateSnapshot"|"mediaSnapshots">`）。
- Produces: `AppendProductionDialog({ batch, prefill, mediaLabel, initialCount?, onClose })` 组件；ResultsPanel 已完成批次行「追加制作」按钮。

行为要点：
- 按钮只出现在 `batch.status === "completed" | "completed_with_errors"` 的已完成任务行；现有测试的 mock 任务无 `batchId` → 不显示，回归安全。
- 对话框提交前客户端做 `RequiredProductPriceSchema` 提示性校验；真正准入仍在 IPC（Global Constraint 1）。
- `createAutomaticOutputDirectory` 可能因素材已移出项目而报错 → 错误内联展示，用户可改手动目录。
- 提交成功后 `onClose()`；批次经既有 `export.subscribe` 推送出现在列表（无需 App.tsx 改动）。
- `initialCount` 仅作 SSR 可测试接缝（默认 1）。

- [ ] **Step 1: Write the failing tests**

创建 `tests/append-production-dialog.test.ts`：

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AppendProductionDialog } from "../src/renderer/AppendProductionDialog";
import type { PublicExportBatch } from "../src/main/application";

const batch = { id: crypto.randomUUID(), status: "completed", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp/out", createdAt: new Date().toISOString(), tasks: [] } as unknown as PublicExportBatch;

it("prefills the frozen display text and defaults to one append without the identical-content hint", () => {
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "19.9元拍一发三", mediaCount: 1 }, mediaLabel: "a.mp4", onClose: () => {} }));
  expect(html).toContain("追加制作");
  expect(html).toContain("19.9元拍一发三");
  expect(html).not.toContain("内容相同的视频");
});

it("warns that multiple appends of one batch produce identical videos", () => {
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "19.9元拍一发三", mediaCount: 1 }, mediaLabel: "a.mp4", initialCount: 2, onClose: () => {} }));
  expect(html).toContain("内容相同的视频");
});
```

在 `tests/results-panel.test.ts` 末尾追加：

```ts
it("offers append production on rows of completed batches only", () => {
  const completedBatchId = crypto.randomUUID();
  const activeBatchId = crypto.randomUUID();
  const html = renderToStaticMarkup(createElement(ResultsPanel, {
    state: {
      project: { mediaItems: [] },
      queue: { batches: [
        { batch: { id: completedBatchId, status: "completed", mediaIds: [], tasks: [{ id: crypto.randomUUID(), batchId: completedBatchId, mediaId: crypto.randomUUID(), status: "completed", progress: 1 }] } },
        { batch: { id: activeBatchId, status: "active", mediaIds: [], tasks: [{ id: crypto.randomUUID(), batchId: activeBatchId, mediaId: crypto.randomUUID(), status: "running", progress: 0.4 }] } },
      ] },
    } as unknown as DesktopState,
    busy: false, retryingIds: [], onCancel: () => {}, onRetry: () => {}, onOpen: () => {}, onReveal: () => {}, onNew: () => {},
  }));
  expect(html.match(/追加制作/g)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/append-production-dialog.test.ts tests/results-panel.test.ts`
Expected: FAIL（`AppendProductionDialog` 模块不存在；results-panel 新用例 `match` 为 null）。

- [ ] **Step 3: 创建 `src/renderer/AppendProductionDialog.tsx`**

```tsx
import { useState } from "react";
import { MAX_AGENT_OUTPUTS } from "../shared/agent";
import { PRODUCT_PRICE_HELP, PRODUCT_PRICE_MAX_LENGTH, RequiredProductPriceSchema } from "../shared/decorations";
import type { PublicExportBatch } from "../main/application";
import { Icon } from "./ui";

export function AppendProductionDialog({ batch, prefill, mediaLabel, initialCount, onClose }: {
  batch: PublicExportBatch;
  prefill: { productPrice: string; mediaCount: number };
  mediaLabel: string;
  initialCount?: number;
  onClose(): void;
}) {
  const [productPrice, setProductPrice] = useState(prefill.productPrice);
  const [count, setCount] = useState(initialCount ?? 1);
  const [manualDirectory, setManualDirectory] = useState<string>();
  const [useManualDirectory, setUseManualDirectory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maxCount = Math.max(1, Math.floor(MAX_AGENT_OUTPUTS / prefill.mediaCount));
  const priceValid = RequiredProductPriceSchema.safeParse(productPrice).success;
  const countValid = Number.isInteger(count) && count >= 1 && count <= maxCount;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const parsed = RequiredProductPriceSchema.safeParse(productPrice);
      if (!parsed.success) throw new Error(PRODUCT_PRICE_HELP);
      if (!countValid) throw new Error(`请填写 1 到 ${maxCount} 之间的整数条数。`);
      const outputDirectory = useManualDirectory ? manualDirectory : await window.jianji.createAutomaticOutputDirectory(batch.mediaIds);
      if (!outputDirectory) throw new Error("请选择成片保存目录。");
      await window.jianji.appendProduction({ batchId: batch.id, count, productPrice: parsed.data, outputDirectory });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "追加制作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return <div className="result-preview-backdrop" role="presentation" onClick={busy ? undefined : onClose}><section className="result-preview-dialog card" role="dialog" aria-modal="true" aria-label="追加制作" onClick={(event) => event.stopPropagation()}>
    <div className="card-header"><h2>追加制作</h2><button type="button" className="icon-button" aria-label="关闭追加制作" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button></div>
    <p>源批次：{mediaLabel} · {prefill.mediaCount} 条素材 · 复用已冻结的包装方案，不重新调用模型。</p>
    <label htmlFor="append-price">展示文字 / 价格 <span>必填 · 手动输入</span></label>
    <textarea id="append-price" rows={2} required aria-invalid={!priceValid} inputMode="text" maxLength={PRODUCT_PRICE_MAX_LENGTH} disabled={busy} value={productPrice} onChange={(event) => setProductPrice(event.target.value)} />
    <small>预填的是源批次保存的手动文字，可修改；按 Enter 换行，最多2行、每行12字。</small>
    {!priceValid && <p role="alert">{PRODUCT_PRICE_HELP}</p>}
    <label htmlFor="append-count">追加条数</label>
    <input id="append-count" type="number" min={1} max={maxCount} step={1} value={count} disabled={busy} onChange={(event) => setCount(event.target.valueAsNumber)} />
    {count > 1 && <p role="note">同一批次追加多条将生成内容相同的视频，仅文件名不同；需要不同画面请从多个批次各追加 1 条。</p>}
    <label htmlFor="append-directory">成片保存到</label>
    <button id="append-directory" type="button" className="directory-picker" disabled={busy} onClick={() => void window.jianji.selectOutputDirectory().then((selected) => { if (selected) { setManualDirectory(selected); setUseManualDirectory(true); } })}><Icon name="folder" /><span>{useManualDirectory && manualDirectory ? manualDirectory : "自动创建 视频/M.D HH:MM"}</span></button>
    {useManualDirectory && <button type="button" className="text-button" disabled={busy} onClick={() => { setUseManualDirectory(false); setManualDirectory(undefined); }}>改为自动创建目录</button>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div><button type="button" className="text-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button primary" disabled={busy || !priceValid || !countValid} onClick={() => void submit()}>{busy ? "正在追加…" : `追加 ${Number.isFinite(count) ? count : ""} 条并开始渲染`}</button></div>
  </section></div>;
}
```

- [ ] **Step 4: 修改 `src/renderer/ResultsPanel.tsx`（4 处 hunk）**

Hunk 1 — import 区（L1-4）改为：

```tsx
import { useState } from "react";
import type { DesktopState } from "../shared/desktop";
import type { PublicExportBatch } from "../main/application";
import { AppendProductionDialog } from "./AppendProductionDialog";
import { SourceStickerKnowledgeDetails } from "./SourceStickerKnowledgeDetails";
import { Heading, Icon } from "./ui";
```

Hunk 2 — L18 `const [preview, setPreview] ...` 之后插入：

```tsx
  const [appendTarget, setAppendTarget] = useState<{ batch: PublicExportBatch; prefill: { productPrice: string; mediaCount: number } }>();
  const [appendError, setAppendError] = useState("");
  const batchById = new Map(state.queue.batches.map(({ batch }) => [batch.id, batch]));
  const openAppend = async (batchId: string) => {
    setAppendError("");
    try {
      const batch = batchById.get(batchId);
      if (!batch) throw new Error("找不到源批次。");
      const prefill = await window.jianji.appendProductionPrefill(batchId);
      setAppendTarget({ batch, prefill });
    } catch (cause) {
      setAppendError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : "无法读取源批次信息。");
    }
  };
```

Hunk 3 — 任务行 map 内，`const playable = ...` 之后插入两行；`row-actions` 的 completed 分支插入「追加制作」按钮：

```tsx
        const sourceBatch = batchById.get(task.batchId);
        const appendable = sourceBatch?.status === "completed" || sourceBatch?.status === "completed_with_errors";
```

completed 分支改为：

```tsx
<div className="row-actions">{task.status === "completed" ? <><button className="button secondary compact" onClick={() => onOpen(task.id)}><Icon name="play" size={15} />播放</button>{appendable && <button className="text-button" disabled={busy} onClick={() => void openAppend(task.batchId)}>追加制作</button>}<button className="icon-button" aria-label="打开成片文件夹" onClick={() => onReveal(task.id)}><Icon name="folder" size={18} /></button></> : task.status === "failed" || task.status === "interrupted" ? <button className="text-button" disabled={busy || state.agentRun?.status === "running" || retryingIds.includes(task.id)} onClick={() => onRetry(task.id)}>重试导出</button> : task.status === "cancelled" ? null : <button className="text-button muted" disabled={busy} onClick={() => onCancel(task.id)}>停止</button>}</div>
```

Hunk 4 — `{preview && <SupervisorPreviewDialog ... />}` 行之后、`.result-footnote` 之前插入：

```tsx
    {appendError && <p className="notice error" role="alert">{appendError}</p>}
    {appendTarget && <AppendProductionDialog batch={appendTarget.batch} prefill={appendTarget.prefill} mediaLabel={appendTarget.batch.mediaIds.map((id) => state.project.mediaItems.find((item) => item.id === id)?.displayName ?? "历史素材").join("、")} onClose={() => setAppendTarget(undefined)} />}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/append-production-dialog.test.ts tests/results-panel.test.ts`
Expected: PASS（dialog 2 + results-panel 原 2 + 新 1）。再跑 `npm run typecheck`。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/AppendProductionDialog.tsx src/renderer/ResultsPanel.tsx tests/append-production-dialog.test.ts tests/results-panel.test.ts
git commit -m "feat: append production from the results page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 覆盖保存 agent 序列集成测试

**Files:**
- Test: `tests/cover-save-agent.test.ts`（新建）

**Interfaces:**
- Consumes: `ApplicationService`（构造签名 `(ffmpeg, fontResolver)`，[application.ts](../../../src/main/application.ts)；`setCoverSticker` L119、`saveProject` L247、`hasUnsavedChanges`）、`ProjectStore`（[store.ts:158](../../../src/main/store.ts)）。夹具模式参照 [tests/per-media-cover.test.ts](../../../tests/per-media-cover.test.ts)。
- Produces: 证明「手动覆盖配置 → setCoverSticker → saveProject → 重载」agent 序列幂等可用的集成测试（对应 spec Goal 第 4 条的测试半；文档半在 Task 7）。

- [ ] **Step 1: Write the test**

创建 `tests/cover-save-agent.test.ts`：

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ApplicationService } from "../src/main/application";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { ProjectStore } from "../src/main/store";
import type { CoverSticker } from "../src/shared/cover-sticker";
import type { MediaItem } from "../src/main/domain";

it("persists manual cover settings through the agent-driven save sequence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-cover-save-"));
  const service = new ApplicationService(new FfmpegAdapter("unused", "unused"), { resolve: async () => null });
  const media: MediaItem = { id: crypto.randomUUID(), sourcePath: "/tmp/source.mp4", displayName: "source", fingerprint: "fixture", sizeBytes: 1, durationMs: 1_000, width: 640, height: 480, rotation: 0, probeStatus: "ready", importedAt: new Date().toISOString() };
  service.currentProject.mediaItems.push(media);
  const region = { id: crypto.randomUUID(), rectangle: { x: 0, y: 0, width: 0.2, height: 0.1 } };
  const settings: CoverSticker = {
    enabled: true, trackingMode: "manual",
    stickerIds: [`uploaded-${"a".repeat(64)}`],
    rectangle: region.rectangle, regions: [region],
    mediaRegions: { [media.id]: [{ id: crypto.randomUUID(), rectangle: { x: 0.1, y: 0.05, width: 0.25, height: 0.12 } }] },
  };
  service.setCoverSticker(settings);
  expect(service.hasUnsavedChanges).toBe(true);
  const filePath = path.join(directory, "project.jianji-project.json");
  await service.saveProject(filePath);
  expect(service.hasUnsavedChanges).toBe(false);
  const loaded = await new ProjectStore(filePath).load();
  expect(loaded.project.coverSticker).toEqual(settings);
});
```

- [ ] **Step 2: Run test（本任务为纯测试任务，现有实现应直接通过；若失败则说明 agent 保存链路真实回退，必须停下报告，不得修改实现去迁就测试）**

Run: `npx vitest run tests/cover-save-agent.test.ts`
Expected: PASS。若 FAIL：按 systematic-debugging 定位 `setCoverSticker`/`saveProject`/`ProjectStore.load` 哪一环偏离现有契约，报告 parent。

- [ ] **Step 3: Commit**

```bash
git add tests/cover-save-agent.test.ts
git commit -m "test: cover save round-trip for agent-driven flows

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: playbook 文档 + 全量验证 + 桌面 smoke

**Files:**
- Modify: `docs/batch-video-production-agent-playbook.md`（文末追加章节）

**Interfaces:**
- Consumes: Task 1-6 全部产物；README 桌面 smoke 说明；memory 中固化的 `make frontend`（含 env -u ELECTRON_RUN_AS_NODE 修复，勿删）。

- [ ] **Step 1: playbook 追加「应用内 Path B」章节**

在 `docs/batch-video-production-agent-playbook.md` 文末追加以下正文（注意最外层是 markdown 小节，代码块用 js 标注）：

````markdown
## 应用内 Path B：批次追加制作（2026-09-21 起）

外部脚本改写项目 JSON 的 Path B 已下沉为应用内功能，优先使用本条，不再直接改项目文件。

### UI 路径

1. 「作品」页每个已完成（含部分失败）批次的任务行显示「追加制作」。
2. 对话框预填源批次保存的手动展示文字（可改）、条数（默认 1）、输出目录（默认自动新建）。
3. 提交后新批次直接本地渲染，零模型调用；同一批次追加多条内容相同，仅文件名不同，需要不同画面请遍历多个源批次各追加 1 条。

### Agent 调用序列（CDP / window.jianji）

```js
// 1. 从公开队列挑选已完成源批次
const batches = (await jianji.getState()).queue.batches.map(({ batch }) => batch);
const source = batches.find((b) => b.status === "completed" && b.mediaIds.length === 1);
// 2. 预填（主进程读取冻结模板，renderer 无 templateSnapshot）
const prefill = await jianji.appendProductionPrefill(source.id); // { productPrice, mediaCount }
// 3. 输出目录：自动新建（素材仍在项目中）或复用已批准目录
const outputDirectory = await jianji.createAutomaticOutputDirectory(source.mediaIds);
// 4. 追加：展示文字必须人工指定（可用源批次预填值），空白/超行会被共享 schema 拒绝
const { batchIds } = await jianji.appendProduction({ batchId: source.id, count: 1, productPrice: prefill.productPrice, outputDirectory });
// 5. 轮询 getState() 直至新批次 completed；任务级失败走既有 retryExport
```

守卫与不变量：克隆仅替换展示文字与全部 id，覆盖几何/轨迹/时序模式逐字节冻结（主进程 digest 自校验）；`count × 素材数 ≤ 250`；只接受当前项目已完成批次；输出目录必须经系统对话框或自动目录批准；发布不覆盖已有文件。

### 覆盖保存的 agent 序列

- 手动模式：`jianji.setCoverSticker(settings)`（校验并标脏）→ `jianji.saveProject()`（落盘）。两步都必须调用；只调前者重启后丢失。
- 半自动（人工审阅）模式：`coverReview.*` 系列 IPC 全程即时落盘，退出保留可恢复草稿，无需额外保存动作。
````

- [ ] **Step 2: 静态与单元/集成验证**

```bash
npm run typecheck
npx vitest run tests/append-production.test.ts tests/append-production-queue.test.ts tests/append-production-dialog.test.ts tests/results-panel.test.ts tests/cover-save-agent.test.ts
npx vitest run tests/product-price.test.ts tests/agent-provider.test.ts
```

Expected: 全部 PASS（准入回归红线：product-price / agent-provider 不得受影响）。

- [ ] **Step 3: 全量测试与构建**

```bash
npm test
npm run build
```

Expected: 全量测试通过；构建成功（renderer 改动需 vite build 后才能进桌面 smoke）。如全量测试存在与本改动无关的既有失败，逐一核对并在交付中明示。

- [ ] **Step 4: 桌面 CDP smoke（非微小 UI 行为变更，必须提供实际交互证据）**

按 README 桌面 smoke 与 memory 固化方式启动（`make frontend`，已含 `env -u ELECTRON_RUN_AS_NODE`），经 CDP 驱动：

1. 打开含已完成批次的项目，确认「作品」页出现「追加制作」按钮。
2. 点击 → 对话框打开且展示文字已预填源批次文字。
3. 修改展示文字（如追加一行「第二件半价」），条数填 2，保持自动目录。
4. 提交 → 对话框关闭，列表出现 2 个新批次并渲染至 completed。
5. 校验输出目录：2 个新成片文件存在、非空、文件名互不覆盖，且不覆盖源批次旧文件。
6. 播放其中 1 条确认新文字可见（人工或截帧）。

证据（日志/截图/文件列表）随交付提交。缺 FFmpeg/字体/平台能力时明确报告跳过项。

- [ ] **Step 5: Commit**

```bash
git add docs/batch-video-production-agent-playbook.md
git commit -m "docs: in-app Path B append production playbook

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录（2026-09-21）

**1. Spec coverage：**
- Goal 1（ResultsPanel 入口）→ Task 5 ✓；Goal 2（克隆+零模型渲染）→ Task 2/3 ✓；Goal 3（IPC）→ Task 4 ✓；Goal 4（覆盖保存测试+文档）→ Task 6/7 ✓。
- Non-Goals：无任务涉及贴纸替换/时序模式/跨批次勾选/保存语义改动/provenance 字段/迁移 ✓。
- User Flow 6 步 → Task 5（按钮/预填/对话框/提示/提交/取消无副作用）✓；Main-Process Design 三段 → Task 2/3/4 ✓；Contracts 两段 → Task 1/4 ✓；Guardrails 全部映射 Global Constraints ✓；Testing 五类 → Task 1/2（单元）、3（queue 集成）、7 Step 2（准入回归+静态）、7 Step 4（UI smoke）、7 Step 1（文档）✓。
- 偏差说明（有意）：spec §export.append 守卫 6 的容量检查实现在 `queue.appendFromBatch`（可在无 Electron 环境测试），IPC 透传错误，语义不变。

**2. Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码；测试含完整断言 ✓。

**3. Type consistency：** `AppendProductionSchema`/`AppendProductionInput`（Task 1）在 Task 4 preload/index 使用一致；`cloneTemplateForAppend`/`appendTemplateDigest`（Task 2）在 Task 3 实现与测试使用一致；`appendPrefill`/`appendFromBatch` 签名（Task 3 Produces）与 Task 4 调用一致；`AppendProductionDialog` props（Task 5 Produces）与 ResultsPanel 挂载、SSR 测试一致 ✓。
