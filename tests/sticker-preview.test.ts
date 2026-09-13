import { describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "../src/main/asset-library";
import { FfmpegAdapter } from "../src/main/ffmpeg";
import { LIBRARY_STICKERS } from "../src/shared/asset-library";
import { stickerPreview } from "../src/main/sticker-preview";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
});
