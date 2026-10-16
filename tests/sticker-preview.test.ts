import { describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "../src/main/asset-library";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { LIBRARY_STICKERS } from "../src/shared/asset-library";
import { stickerContactSheets, stickerPreview } from "../src/main/sticker-preview";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeRgbaPng } from "../src/main/builtin-stickers";
import { runCommand } from "../src/main/ffmpeg";
import { fingerprintFile } from "../src/main/paths";
import { ffmpegBin } from "./helpers/ffmpeg-bin";

describe("local sticker preview cancellation", () => {
  it("stops the FFmpeg conversion when cancelled and does not return an image", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-preview-cancel-"));
    const asset = await new AssetLibrary(directory).ensure(LIBRARY_STICKERS[0].id);
    const controller = new AbortController();
    let finish!: (value: { code: number; stdout: string; stderr: string }) => void;
    const cancel = vi.fn(async () => { finish({ code: 1, stdout: "", stderr: "cancelled" }); });
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const run = vi.spyOn(ffmpeg, "run").mockReturnValue({ promise: new Promise((resolve) => { finish = resolve; }), cancel } as unknown as ReturnType<FfmpegAdapter["run"]>);
    const pending = stickerPreview(ffmpeg, asset, controller.signal);
    const rejected = expect(pending).rejects.toBeDefined();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
    await rm(directory, { recursive: true, force: true });
  });

  it("renders a full catalog as bounded row-major contact sheets", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-contact-sheet-"));
    try {
      const colors = Array.from({ length: 26 }, (_, index) => [24 + index * 7 % 208, 24 + index * 43 % 208, 24 + index * 83 % 208]);
      const stickers = await Promise.all(colors.map(async (color, index) => {
        const assetPath = path.join(directory, `candidate-${index}.png`);
        const rgba = new Uint8Array(256 * 256 * 4);
        for (let pixel = 0; pixel < 256 * 256; pixel += 1) rgba.set([...color, 255], pixel * 4);
        await writeFile(assetPath, encodeRgbaPng(rgba, 256, 256));
        return { id: `candidate-${index}`, asset: { assetPath, assetFingerprint: await fingerprintFile(assetPath) } };
      }));
      const ffmpeg = new FfmpegAdapter(ffmpegBin, "unused");
      const run = vi.spyOn(ffmpeg, "run");

      const sheets = await stickerContactSheets(ffmpeg, stickers, new AbortController().signal);

      expect(sheets.map(({ stickerIds }) => stickerIds)).toEqual([
        stickers.slice(0, 25).map(({ id }) => id),
        stickers.slice(25).map(({ id }) => id),
      ]);
      expect(sheets.map(({ columns }) => columns)).toEqual([5, 1]);
      expect(run).toHaveBeenCalledTimes(2);
      const sample = async (sheetIndex: number, x: number, y: number) => {
        const imagePath = path.join(directory, `sheet-${sheetIndex}.jpg`);
        const pixelPath = path.join(directory, `pixel-${sheetIndex}-${x}-${y}.rgb`);
        await writeFile(imagePath, Buffer.from(sheets[sheetIndex].url.slice("data:image/jpeg;base64,".length), "base64"));
        const decoded = await runCommand(ffmpegBin, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", imagePath,
          "-vf", `format=rgb24,crop=2:2:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", pixelPath]).promise;
        expect(decoded.code, decoded.stderr).toBe(0);
        const pixels = await readFile(pixelPath);
        return [0, 1, 2].map((channel) => Math.round((pixels[channel] + pixels[channel + 3] + pixels[channel + 6] + pixels[channel + 9]) / 4));
      };
      for (const index of [0, 6, 24, 25]) {
        const sheetIndex = index < 25 ? 0 : 1;
        const localIndex = index < 25 ? index : 0;
        const x = (localIndex % sheets[sheetIndex].columns) * 192 + 96;
        const y = Math.floor(localIndex / sheets[sheetIndex].columns) * 192 + 96;
        const actual = await sample(sheetIndex, x, y);
        for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(actual[channel] - colors[index][channel])).toBeLessThan(20);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("cancels an active contact-sheet render", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-contact-sheet-cancel-"));
    const assetPath = path.join(directory, "sticker.png");
    const bytes = encodeRgbaPng(new Uint8Array([255, 0, 0, 255]), 1, 1);
    await writeFile(assetPath, bytes);
    const asset = { assetPath, assetFingerprint: await fingerprintFile(assetPath) };
    const controller = new AbortController();
    let finish!: (value: { code: number; stdout: string; stderr: string }) => void;
    const cancel = vi.fn(async () => { finish({ code: 1, stdout: "", stderr: "cancelled" }); });
    const ffmpeg = new FfmpegAdapter("unused", "unused");
    const run = vi.spyOn(ffmpeg, "run").mockReturnValue({ promise: new Promise((resolve) => { finish = resolve; }), cancel } as unknown as ReturnType<FfmpegAdapter["run"]>);
    try {
      const pending = stickerContactSheets(ffmpeg, [{ id: "candidate", asset }], controller.signal);
      const rejected = expect(pending).rejects.toBeDefined();
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      controller.abort();
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
