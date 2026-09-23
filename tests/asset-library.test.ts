import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetLibrary, bundledStickerDirectory } from "../src/main/asset-library";
import type { BuiltinStickerAssets, StickerAssets } from "../src/main/builtin-stickers";
import type { LibraryAsset } from "../src/shared/asset-library";
import { DecorationSchema } from "../src/shared/decorations";
import { LIBRARY_FONTS, LIBRARY_STICKERS } from "../src/shared/asset-library";
import { AUTOMATIC_STICKERS } from "../src/shared/automatic-stickers";
import { materializePlan } from "../src/main/agent-provider";

const contents = Buffer.from("89504e470d0a1a0a0000000049484452", "hex");
const blob = createHash("sha1").update(`blob ${contents.length}\0`).update(contents).digest("hex");
const entry: LibraryAsset = { id: "test-sticker", label: "Test", kind: "sticker", url: "https://raw.githubusercontent.com/microsoft/fluentui-emoji/pinned/test.png", blob, size: contents.length, license: "fluent" };
function fixtureEntry(id: string, kind: LibraryAsset["kind"], bytes: Buffer, family?: string): LibraryAsset {
  return { id, label: id, kind, ...(family ? { family } : {}), url: `https://raw.githubusercontent.com/microsoft/fluentui-emoji/pinned/${id}`, blob: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), size: bytes.length, license: "fluent" };
}
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function directory() { const value = await mkdtemp(path.join(tmpdir(), "jianji-library-test-")); directories.push(value); return value; }
describe("verified asset cache", () => {
  it("reads packaged sticker bytes offline and never downloads missing or corrupted package assets", async () => {
    const selected = LIBRARY_STICKERS[0];
    const offline = vi.fn(async (): Promise<Response> => { throw new Error("offline"); });
    const root = await directory();
    const library = new AssetLibrary(root, offline);
    const asset = await library.ensure(selected.id);
    expect(asset.assetPath).toBe(path.join(root, `${selected.blob}.png`));
    expect((await library.preview(selected.id)).url).toMatch(/^data:image\/png;base64,/);
    const brokenRoot = await directory();
    const broken = new AssetLibrary(await directory(), offline, [selected], { fluent: "MIT fixture" }, brokenRoot);
    await expect(broken.ensure(selected.id)).rejects.toThrow("内置贴纸缺失");
    await writeFile(path.join(brokenRoot, `${selected.blob}.png`), "corrupt");
    await expect(broken.ensure(selected.id)).rejects.toThrow("内置贴纸校验失败");
    expect(offline).not.toHaveBeenCalled();
  });
  it("preserves frozen resource paths when the application package moves", async () => {
    const selected = LIBRARY_STICKERS[0];
    const firstPackage = await directory(); const secondPackage = await directory(); const root = await directory();
    for (const destination of [firstPackage, secondPackage]) await copyFile(path.resolve("resources/sticker-library", `${selected.blob}.png`), path.join(destination, `${selected.blob}.png`));
    const offline = vi.fn(async (): Promise<Response> => { throw new Error("offline"); });
    const first = await new AssetLibrary(root, offline, [selected], { fluent: "MIT fixture" }, firstPackage).ensure(selected.id);
    await rm(firstPackage, { recursive: true });
    expect(await new AssetLibrary(root, offline, [selected], { fluent: "MIT fixture" }, secondPackage).ensure(selected.id)).toEqual(first);
    expect((await readFile(first.assetPath)).length).toBe(selected.size);
    expect(offline).not.toHaveBeenCalled();
  });
  it("resolves installed resources independently of the current working directory", () => {
    expect(bundledStickerDirectory({ resourcesPath: "/installed/resources" })).toBe(path.join("/installed/resources", "sticker-library"));
    expect(bundledStickerDirectory({ resourcesPath: "/electron/resources", defaultApp: true })).toBe(path.resolve("resources/sticker-library"));
  });
  it("coalesces requests, preserves license and reuses verified cache offline after restart", async () => {
    const root = await directory();
    const download = vi.fn(async () => new Response(contents));
    const library = new AssetLibrary(root, download, [entry], { fluent: "MIT fixture" });
    const [a, b] = await Promise.all([library.ensure(entry.id), library.ensure(entry.id)]);
    expect(a).toEqual(b); expect(download).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(root, "licenses", "fluent.txt"), "utf8")).toBe("MIT fixture");
    const offline = vi.fn(async (): Promise<Response> => { throw new Error("offline"); });
    expect(await new AssetLibrary(root, offline, [entry], { fluent: "MIT fixture" }).ensure(entry.id)).toEqual(a);
    expect(offline).not.toHaveBeenCalled();
    await writeFile(a.assetPath, "corrupt");
    await expect(new AssetLibrary(root, offline, [entry], { fluent: "MIT fixture" }).ensure(entry.id)).rejects.toThrow();
    expect(offline).toHaveBeenCalledTimes(1);
  });
  it("rejects unknown ids, tampered responses and oversize bodies, then permits retry", async () => {
    const download = vi.fn().mockResolvedValueOnce(new Response(Buffer.alloc(contents.length))).mockResolvedValueOnce(new Response(Buffer.alloc(contents.length + 1))).mockResolvedValueOnce(new Response(contents));
    const library = new AssetLibrary(await directory(), download, [entry], { fluent: "MIT" });
    await expect(library.ensure("../../secret")).rejects.toThrow();
    expect(download).not.toHaveBeenCalled();
    await expect(library.ensure(entry.id)).rejects.toThrow();
    await expect(library.ensure(entry.id)).rejects.toThrow();
    await expect(library.ensure(entry.id)).resolves.toHaveProperty("assetFingerprint");
  });
  it("admits only curated ids and font families", () => {
    expect(DecorationSchema.parse({ sticker: LIBRARY_STICKERS[0].id, fontFamily: LIBRARY_FONTS[0].family }).sticker).toBe(LIBRARY_STICKERS[0].id);
    expect(() => DecorationSchema.parse({ sticker: "fluent-arbitrary" })).toThrow();
    expect(() => DecorationSchema.parse({ fontFamily: "/tmp/random.ttf" })).toThrow();
  });
  it("prepares selected sticker assets without downloading decorative fonts", async () => {
    const serif = Buffer.from("serif");
    const sans = Buffer.from("sans");
    const heart = Buffer.from("heart");
    const entries = [
      fixtureEntry("serif-font", "font", serif, "Noto Serif CJK SC"),
      fixtureEntry("sans-font", "font", sans, "Noto Sans CJK SC"),
      fixtureEntry("heart", "sticker", heart),
    ];
    const files = new Map(entries.map((candidate, index) => [candidate.url, [serif, sans, heart][index]]));
    const download = vi.fn(async (url: RequestInfo | URL) => new Response(files.get(url.toString())!));
    const library = new AssetLibrary(await directory(), download as typeof fetch, entries, { fluent: "MIT" });
    const prepared = await library.prepare(DecorationSchema.parse({
      sticker: "heart",
      corners: {
        "top-left": { type: "sticker", sticker: "heart" },
        "bottom-right": { type: "sticker", sticker: "heart" },
      },
    }), {} as BuiltinStickerAssets);
    expect(download).toHaveBeenCalledTimes(1);
    expect(prepared.heart).toMatchObject({ assetPath: expect.stringMatching(/\.png$/) });
    await expect(library.resolveFont("Noto Serif CJK SC")).resolves.toBeNull();
    await expect(library.resolveFont("Noto Sans CJK SC")).resolves.toBeNull();
  });
  it("prepares the reviewed local library for random decoration", async () => {
    const offline = vi.fn(async (): Promise<Response> => { throw new Error("offline"); });
    const library = new AssetLibrary(await directory(), offline);
    const builtins = Object.fromEntries(["sparkle", "arrow", "heart", "burst"].map((id) => [id, { assetPath: `/tmp/${id}.png`, assetFingerprint: `sha256:${id}` }])) as BuiltinStickerAssets;
    const options = DecorationSchema.parse({ mode: "random" });
    const prepared = await library.prepare(options, builtins);
    expect(AUTOMATIC_STICKERS.every(({ id }) => Boolean(prepared[id]))).toBe(true);
    expect(Object.keys(prepared).length).toBeGreaterThan(4);
    const template = materializePlan({ summary: "随机", captions: [], filter: "warm", intensity: 0.4 }, "black-gold", { width: 640, height: 480 }, prepared, options);
    const stickers = template.layers.filter((layer) => layer.type === "sticker");
    expect(new Set(stickers.map((layer) => layer.assetFingerprint)).size).toBe(4);
    expect(offline).not.toHaveBeenCalled();
  });
  it("keeps only verified uploads in the random pool and ignores saved manual choices", async () => {
    const root = await directory();
    const validId = `uploaded-${"a".repeat(64)}`;
    const staleId = `uploaded-${"b".repeat(64)}`;
    const changedId = `uploaded-${"c".repeat(64)}`;
    const validPath = path.join(root, "valid.png");
    const changedPath = path.join(root, "changed.png");
    await writeFile(validPath, contents);
    await writeFile(changedPath, "changed");
    const builtins = {
      [validId]: { assetPath: validPath, assetFingerprint: `sha256:${createHash("sha256").update(contents).digest("hex")}` },
      [staleId]: { assetPath: path.join(root, "missing.png"), assetFingerprint: "sha256:stale" },
      [changedId]: { assetPath: changedPath, assetFingerprint: `sha256:${createHash("sha256").update(contents).digest("hex")}` },
    } as StickerAssets;
    const options = DecorationSchema.parse({ mode: "random", corners: { "top-left": { type: "sticker", sticker: staleId } } });
    const prepared = await new AssetLibrary(await directory()).prepare(options, builtins);
    expect(prepared[validId]).toEqual(builtins[validId]);
    expect(prepared[staleId]).toBeUndefined();
    expect(prepared[changedId]).toBeUndefined();
  });
});
