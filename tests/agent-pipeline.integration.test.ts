import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { ApplicationService } from "../src/main/application";
import { AgentController } from "../src/main/agent-controller";
import { DEFAULT_TEXT_FONT_FAMILY } from "../src/main/domain";
import { discoverBinary, FfmpegAdapter, resolveFont, runCommand } from "../src/main/ffmpeg";
import { ExportQueue } from "../src/main/queue";
import { JobStore } from "../src/main/store";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";

describe("agent to local export", () => {
  for (const mode of ["manual", "agent"] as const) it(`extracts real frames and renders independent verified videos in ${mode} mode`, async (context) => {
    const [ffmpegPath, ffprobePath, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
    if (!ffmpegPath || !ffprobePath || !font) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-agent-proof-"));
    const requests: Array<{ model: string; messages: Array<{ content: string | Array<{ type: string; image_url?: { url: string } }> }> }> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push(JSON.parse(body));
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "根据画面选择滤镜", captions: [], filter: "cool", intensity: 0.3, ...(mode === "agent" ? { stickers: [{ corner: "bottom-right", sticker: "heart" }] } : {}) }) } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const adapter = new FfmpegAdapter(ffmpegPath, ffprobePath);
    const service = new ApplicationService(adapter, { resolve: resolveFont });
    const queue = new ExportQueue({ ffmpeg: adapter, fontResolver: { resolve: resolveFont }, jobStore: new JobStore(path.join(directory, "jobs")) });
    const stickerAssets = await ensureBuiltinStickerAssets(path.join(directory, "agent-stickers"));
    const controller = new AgentController(service, queue, adapter, () => {}, stickerAssets);
    try {
      for (const name of ["素材一.mp4", "素材二.mp4"]) {
        const source = path.join(directory, name);
        const generated = await runCommand(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]).promise;
        expect(generated.code).toBe(0);
        await service.addMedia([source]);
      }
      const ids = service.currentProject.mediaItems.map((item) => item.id);
      const outputDirectory = path.join(directory, "out");
      controller.provider.configure({ apiKey: "local-test-key", model: "local-test-vision", baseUrl: `http://127.0.0.1:${port}/v1` });
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: ids, outputDirectory, decorations: { productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" } }, new Set())).rejects.toThrow("系统对话框");
      expect(requests).toHaveLength(0);
      const fontFamily = await resolveFont("Noto Serif CJK SC") ? "Noto Serif CJK SC" : DEFAULT_TEXT_FONT_FAMILY;
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: ids, outputDirectory, decorations: { productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" }, multiplier: 126 }, new Set([outputDirectory]))).rejects.toThrow("250 条");
      expect(requests).toHaveLength(0);
      await controller.start({ ruleId: "clean", brief: "", mediaIds: ids, outputDirectory, multiplier: 2, decorations: { mode, productPrice: "19.90", sticker: "heart", fontFamily } }, new Set([outputDirectory]));
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const snapshot = queue.snapshot();
        if (!controller.busy && snapshot.batches.length === 4 && snapshot.batches.every(({ batch }) => batch.status !== "active")) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(controller.snapshot()?.items.map((item) => item.status)).toEqual(["exporting", "exporting", "exporting", "exporting"]);
      expect(requests).toHaveLength(4);
      if (mode === "agent") {
        const systems = requests.map((request) => request.messages[0].content as string);
        expect(new Set(systems.map((system) => system.match(/当前为同批第 (\d+)\/4 条/)?.[1]))).toEqual(new Set(["1", "2", "3", "4"]));
        expect(systems.every((system) => !system.includes('"sticker":"arrow"') && !system.includes("清透色彩配轻箭头贴纸"))).toBe(true);
      } else {
        expect(requests.every((request) => !(request.messages[0].content as string).includes("当前为同批第"))).toBe(true);
      }
      for (const request of requests) {
        const content = request.messages[1].content;
        if (typeof content === "string") throw new Error("expected visual content");
        const images = content.filter((item) => item.type === "image_url");
        expect(images).toHaveLength(3);
        expect(images.every((item) => item.image_url!.url.startsWith("data:image/jpeg;base64,/9j/"))).toBe(true);
        expect(JSON.stringify(request)).not.toContain(directory);
      }
      const batches = queue.snapshot().batches;
      expect(batches.map(({ batch }) => batch.tasks[0].status)).toEqual(["completed", "completed", "completed", "completed"]);
      expect(batches.every(({ batch }) => batch.templateSnapshot.layers.filter((layer) => layer.type === "text").every((layer) => layer.content === "¥ 19.90"))).toBe(true);
      expect(batches.every(({ batch }) => batch.templateSnapshot.layers.some((layer) => layer.type === "sticker"))).toBe(true);
      for (const { batch } of batches) {
        expect(batch.templateSnapshot.layers.find((layer) => layer.type === "text")).toMatchObject({ content: "¥ 19.90", fontFamily: DEFAULT_TEXT_FONT_FAMILY });
        expect(batch.templateSnapshot.layers.find((layer) => layer.type === "sticker")).toMatchObject({ assetPath: stickerAssets.heart.assetPath });
      }
      expect(new Set(batches.map(({ batch }) => batch.tasks[0].outputPath)).size).toBe(4);
      expect(new Set(batches.map(({ batch }) => batch.tasks[0].id)).size).toBe(4);
      expect(new Set(batches.map(({ batch }) => batch.tasks[0].mediaId)).size).toBe(2);
      for (const { batch } of batches) {
        expect(batch.tasks[0].outputArtifact).toMatchObject({ taskId: batch.tasks[0].id, path: batch.tasks[0].outputPath });
        const result = await adapter.probe(batch.tasks[0].outputPath!);
        expect(result.streams?.some((stream) => stream.codec_type === "audio")).toBe(true);
        expect(result.streams?.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 1280, height: 720 });
      }
    } finally {
      await controller.cancel(); await queue.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
