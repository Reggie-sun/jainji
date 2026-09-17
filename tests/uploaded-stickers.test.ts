import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UploadedStickers } from "../src/main/uploaded-stickers";
import { ensureBuiltinStickerAssets } from "../src/main/builtin-stickers";
import { AssetLibrary } from "../src/main/asset-library";
import { materializePlan } from "../src/main/agent-provider";
import { DecorationSchema } from "../src/shared/decorations";
import { isAutomaticStickerAllowed } from "../src/shared/automatic-stickers";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-upload-")); roots.push(root);
  const builtins = await ensureBuiltinStickerAssets(path.join(root, "builtins"));
  const png = await readFile(builtins.heart.assetPath);
  const source = path.join(root, "my-heart.png"); await writeFile(source, png);
  const store = new UploadedStickers(path.join(root, "uploads"), (bytes) => {
    if (!bytes.equals(png)) throw new Error("invalid image");
    return bytes;
  });
  return { root, builtins, source, store };
}

describe("uploaded stickers", () => {
  it("removes uploads from the persistent catalog while preserving frozen export files, and restores on reimport", async () => {
    const { root, source, store } = await fixture();
    const imported = await store.importFile(source);
    const original = await readFile(imported.asset.assetPath);
    await store.remove(imported.id);
    expect(await store.catalog()).toEqual([]);
    const reloaded = new UploadedStickers(path.join(root, "uploads"), () => { throw new Error("unused"); });
    expect(await reloaded.load()).toEqual({});
    expect(await readFile(imported.asset.assetPath)).toEqual(original);
    expect(await readFile(source)).toEqual(original);
    expect(await store.importFile(source)).toEqual(imported);
    expect(Object.keys(await reloaded.load())).toEqual([imported.id]);
  });

  it("rejects deleting builtins, path traversal and unknown uploads", async () => {
    const { store } = await fixture();
    for (const id of ["heart", "../../source.png", `uploaded-${"f".repeat(64)}`]) {
      await expect(store.remove(id)).rejects.toThrow();
    }
    expect(await store.load()).toEqual({});
  });

  it("copies and deduplicates images, reloads without the source and exports through the existing plan", async () => {
    const { root, builtins, source, store } = await fixture();
    const imported = await store.importFile(source);
    expect(await store.importFile(source)).toEqual(imported);
    expect(await readdir(path.join(root, "uploads"))).toEqual([`${imported.id}.png`]);
    await unlink(source);
    const reloaded = new UploadedStickers(path.join(root, "uploads"), () => { throw new Error("unused"); });
    expect(await reloaded.load()).toEqual({ [imported.id]: imported.asset });
    expect(await reloaded.catalog()).toEqual([expect.objectContaining({ id: imported.id, source: "uploaded", url: expect.stringMatching(/^data:image\/png;base64,/) })]);
    const options = DecorationSchema.parse({ sticker: "none", productPrice: "19.90", corners: { "top-left": { type: "sticker", sticker: imported.id } } });
    const assets = await new AssetLibrary(path.join(root, "library")).prepare(options, { ...builtins, ...await reloaded.load() });
    const template = materializePlan({ summary: "测试", captions: [], filter: "warm", intensity: 0.4 }, "black-gold", { width: 720, height: 1280 }, assets, options);
    expect(template.layers).toEqual(expect.arrayContaining([expect.objectContaining({ type: "sticker", ...imported.asset }), expect.objectContaining({ type: "text", content: "¥ 19.90" })]));
    expect(isAutomaticStickerAllowed(imported.id)).toBe(false);
    expect(DecorationSchema.parse({ mode: "agent", sticker: imported.id }).sticker).toBe("template");
    const automatic = { summary: "选择用户上传贴纸", captions: [], priceStyle: "classic", stickers: [
      { corner: "top-left", sticker: imported.id, width: 0.08, rotationDeg: 0 },
      { corner: "top-right", sticker: imported.id, width: 0.08, rotationDeg: 0 },
      { corner: "bottom-left", sticker: imported.id, width: 0.08, rotationDeg: 0 },
      { corner: "bottom-right", sticker: imported.id, width: 0.08, rotationDeg: 0 },
    ], filter: "warm", intensity: 0.4 };
    const automaticLayers = materializePlan(automatic, "black-gold", { width: 720, height: 1280 }, assets, { mode: "agent", productPrice: "19.90" }, { fonts: [], stickers: [{ id: imported.id, label: "用户上传" }] }).layers;
    expect(automaticLayers.filter((layer) => layer.type === "sticker")).toHaveLength(4);
    expect(automaticLayers).toEqual(expect.arrayContaining([expect.objectContaining({ type: "sticker", ...imported.asset })]));
    expect(() => materializePlan(automatic, "black-gold", { width: 720, height: 1280 }, assets, { mode: "agent", productPrice: "19.90" }, { fonts: [], stickers: [] })).toThrow();
  });

  it("rejects unsupported, invalid and oversized files without publishing assets", async () => {
    const { root, source, store } = await fixture();
    await expect(store.importFile(`${source}.svg`)).rejects.toThrow("PNG");
    await writeFile(source, "not an image");
    await expect(store.importFile(source)).rejects.toThrow("有效");
    await writeFile(source, Buffer.alloc(10 * 1024 * 1024 + 1));
    await expect(store.importFile(source)).rejects.toThrow("10 MB");
    expect(await store.load()).toEqual({});
    expect(await readdir(path.join(root, "uploads"))).toEqual([]);
  });

  it("rejects oversized encoded PNG and JPEG dimensions before decoding", async () => {
    const { root, source } = await fixture();
    const store = new UploadedStickers(path.join(root, "uploads"), () => { throw new Error("decoder must not run"); });
    const png = await readFile(source);
    png.writeUInt32BE(100000, 16);
    await writeFile(source, png);
    await expect(store.importFile(source)).rejects.toThrow("4096");
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0xff, 0xff, 0xff, 0xff, 1]);
    await writeFile(source, jpg);
    await expect(store.importFile(source)).rejects.toThrow("4096");
    expect(await store.load()).toEqual({});
  });

  it("rejects unknown and corrupted uploads before model preparation", async () => {
    const { root, source, store, builtins } = await fixture();
    const imported = await store.importFile(source);
    const options = DecorationSchema.parse({ sticker: imported.id });
    const library = new AssetLibrary(path.join(root, "library"));
    await expect(library.prepare(options, builtins)).rejects.toThrow("缺失");
    await writeFile(imported.asset.assetPath, "corrupted");
    expect(await store.load()).toEqual({});
    await expect(library.prepare(options, { ...builtins, [imported.id]: imported.asset })).rejects.toThrow("变化");
    await expect(store.importFile(source)).rejects.toThrow("损坏");
    expect(() => DecorationSchema.parse({ sticker: "uploaded-../../etc/passwd" })).toThrow();
  });
});
