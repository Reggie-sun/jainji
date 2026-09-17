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
import { AssetLibrary } from "../src/main/asset-library";
import { AUTOMATIC_STICKERS } from "../src/shared/automatic-stickers";
import { getPriceStyle } from "../src/shared/price-styles";

describe("agent to local export", () => {
  for (const mode of ["manual", "agent"] as const) it(`extracts real frames and renders independent verified videos in ${mode} mode`, async (context) => {
    const [ffmpegPath, ffprobePath, font] = await Promise.all([discoverBinary("ffmpeg"), discoverBinary("ffprobe"), resolveFont(DEFAULT_TEXT_FONT_FAMILY)]);
    if (!ffmpegPath || !ffprobePath || !font) { context.skip(); return; }
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-agent-proof-"));
    const butterfly = AUTOMATIC_STICKERS.find(({ label }) => label === "蝴蝶")!;
    const requests: Array<{ model: string; messages: Array<{ content: string | Array<{ type: string; image_url?: { url: string } }> }> }> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push(JSON.parse(body));
        response.setHeader("Content-Type", "application/json");
        const system = requests.at(-1)!.messages[0].content as string;
        if (system.includes("你是视频画面覆盖物追踪器")) {
          const content = requests.at(-1)!.messages[1].content;
          const times = typeof content === "string" ? [] : content.flatMap((item) => {
            const match = /抽帧时间：(\d+)ms/.exec("text" in item ? String(item.text) : "");
            return match ? [Number(match[1])] : [];
          });
          response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok", frames: times.map((timeMs) => ({ timeMs, targets: [{ id: "fixture", rectangle: { x: 0.1, y: 0.1, width: 0.15, height: 0.15 } }] })) }) } }] }));
          return;
        }
        const shortlist = system.includes("你是视频贴纸选材师");
        const entries = shortlist ? JSON.parse(system.split("完整目录为 [编号,名称,资格]：")[1]) as [number, string, string][] : [];
        const result = shortlist ? { candidates: [entries.find(([, label]) => label === "蝴蝶")![0]] }
          : { summary: "根据画面选择滤镜", captions: [], filter: mode === "agent" ? "none" : "cool", intensity: mode === "agent" ? 0 : 0.3, ...(mode === "agent" ? { priceStyle: JSON.parse(system.match(/价格花字目录（仅外观，不含价格内容）：(\[.*?\])。/)![1])[0].id, stickers: [
            { corner: "top-left", sticker: butterfly.id, width: 0.08, rotationDeg: 0 },
            { corner: "top-right", sticker: butterfly.id, width: 0.08, rotationDeg: 0 },
            { corner: "bottom-left", sticker: butterfly.id, width: 0.08, rotationDeg: 0 },
            { corner: "bottom-right", sticker: butterfly.id, width: 0.1, rotationDeg: -11 },
          ] } : {}) };
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const adapter = new FfmpegAdapter(ffmpegPath, ffprobePath);
    const service = new ApplicationService(adapter, { resolve: resolveFont });
    const queue = new ExportQueue({ ffmpeg: adapter, fontResolver: { resolve: resolveFont }, jobStore: new JobStore(path.join(directory, "jobs")) });
    const stickerAssets = await ensureBuiltinStickerAssets(path.join(directory, "agent-stickers"));
    const library = new AssetLibrary(path.join(directory, "library"), async () => { throw new Error("sticker network forbidden"); });
    const controller = new AgentController(service, queue, adapter, () => {}, stickerAssets, library);
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
      controller.visionProvider.configure({ apiKey: "local-test-key", model: "local-test-detector", baseUrl: `http://127.0.0.1:${port}/v1` });
      controller.reviewerProvider.configure({ apiKey: "local-test-key", model: "local-test-reviewer", baseUrl: `http://127.0.0.1:${port}/v1` });
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: ids, outputDirectory, decorations: { productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" } }, new Set())).rejects.toThrow("系统对话框");
      expect(requests).toHaveLength(0);
      const fontFamily = await resolveFont("Noto Serif CJK SC") ? "Noto Serif CJK SC" : DEFAULT_TEXT_FONT_FAMILY;
      await expect(controller.start({ ruleId: "clean", brief: "", mediaIds: ids, outputDirectory, decorations: { productPrice: "19.90", sticker: "template", fontFamily: "Noto Sans CJK SC" }, multiplier: 126 }, new Set([outputDirectory]))).rejects.toThrow("250 条");
      expect(requests).toHaveLength(0);
      await controller.start({ ruleId: "clean", brief: "", mediaIds: ids, outputDirectory, multiplier: 2, decorations: { mode, productPrice: "19.90", priceStyle: "classic", sticker: "heart", fontFamily } }, new Set([outputDirectory]));
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const snapshot = queue.snapshot();
        if (!controller.busy && snapshot.batches.length === 4 && snapshot.batches.every(({ batch }) => batch.status !== "active")) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(controller.snapshot()?.items.map((item) => item.status)).toEqual(["exporting", "exporting", "exporting", "exporting"]);
      expect(requests).toHaveLength(mode === "agent" ? 12 : 4);
      const coverRequests = requests.filter((request) => (request.messages[0].content as string).includes("你是视频画面覆盖物追踪器"));
      const finalRequests = requests.filter((request) => !(request.messages[0].content as string).includes("你是视频贴纸选材师") && !coverRequests.includes(request));
      expect(coverRequests).toHaveLength(mode === "agent" ? 4 : 0);
      if (mode === "agent") {
        expect(coverRequests.filter(request => request.model === "local-test-detector")).toHaveLength(2);
        expect(coverRequests.filter(request => request.model === "local-test-reviewer")).toHaveLength(2);
      }
      if (mode === "agent") {
        const systems = finalRequests.map((request) => request.messages[0].content as string);
        expect(new Set(systems.map((system) => system.match(/当前为同批第 (\d+)\/4 条/)?.[1]))).toEqual(new Set(["1", "2", "3", "4"]));
        expect(requests.every((request) => !(request.messages[0].content as string).includes("本条视觉探索方向"))).toBe(true);
        expect(systems.every((system) => system.includes('"filters":["none","warm","cool","mono","vivid"]'))).toBe(true);
        expect(systems.every((system) => !system.includes('"sticker":"arrow"') && !system.includes("清透色彩配轻箭头贴纸"))).toBe(true);
      } else {
        expect(requests.every((request) => !(request.messages[0].content as string).includes("当前为同批第"))).toBe(true);
        expect(requests.every((request) => !(request.messages[0].content as string).includes("本条视觉探索方向"))).toBe(true);
      }
      for (const request of requests) {
        const content = request.messages[1].content;
        if (typeof content === "string") throw new Error("expected visual content");
        const images = content.filter((item) => item.type === "image_url");
        expect(images).toHaveLength(coverRequests.includes(request) || mode === "agent" && finalRequests.includes(request) ? 4 : 3);
        expect(images.every((item) => item.image_url!.url.startsWith("data:image/jpeg;base64,/9j/"))).toBe(true);
        expect(JSON.stringify(request)).not.toContain(directory);
      }
      const batches = queue.snapshot().batches;
      expect(batches.every(({ batch }) => batch.templateSnapshot.layers.every((layer) => layer.type !== "sticker" || !layer.cover))).toBe(true);
      if (mode === "agent") {
        const colors = batches.map(({ batch }) => JSON.stringify(batch.templateSnapshot.layers.find((layer) => layer.type === "text")!.color));
        const selectedColors = finalRequests.map((request) => {
          const styles = JSON.parse((request.messages[0].content as string).match(/价格花字目录（仅外观，不含价格内容）：(\[.*?\])。/)![1]);
          return JSON.stringify(getPriceStyle(styles[0].id).color);
        });
        expect(new Set(colors)).toEqual(new Set(selectedColors));
      }
      expect(batches.map(({ batch }) => batch.tasks[0].status)).toEqual(["completed", "completed", "completed", "completed"]);
      expect(batches.every(({ batch }) => batch.templateSnapshot.layers.filter((layer) => layer.type === "text").every((layer) => layer.content === "¥ 19.90"))).toBe(true);
      for (const { batch } of batches) {
        const stickers = batch.templateSnapshot.layers.filter(layer => layer.type === "sticker");
        if (mode === "manual") expect(stickers).toHaveLength(1);
        else {
          expect(stickers.filter(layer => !(layer.x < 0.5 && layer.y < 0.5))).toHaveLength(3);
          const occupied = stickers.find(layer => layer.x < 0.5 && layer.y < 0.5);
          // AAC padding can extend container duration beyond the final sampled video frame.
          if (occupied) expect(occupied.activeRanges?.every(range => range.startMs >= 1000)).toBe(true);
        }
      }
      if (mode === "agent") expect(new Set(batches.map(({ batch }) => JSON.stringify(batch.templateSnapshot.layers.find(layer => layer.type === "text")?.color))).size).toBe(4);
      if (mode === "agent") for (const { batch } of batches) {
        expect(batch.templateSnapshot.filter).toEqual({ presetId: "none", intensity: 0 });
        expect(batch.templateSnapshot.layers.some((layer) => layer.type === "sticker" && layer.width === 0.1 && layer.rotationDeg === -11)).toBe(true);
      }
      for (const { batch } of batches) {
        expect(batch.templateSnapshot.layers.find((layer) => layer.type === "text")).toMatchObject({ content: "¥ 19.90", fontFamily: DEFAULT_TEXT_FONT_FAMILY });
        expect(batch.templateSnapshot.layers.find((layer) => layer.type === "sticker")).toMatchObject({ assetPath: mode === "agent" ? (await library.ensure(butterfly.id)).assetPath : stickerAssets.heart.assetPath });
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
