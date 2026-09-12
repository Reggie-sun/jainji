import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "../src/main/asset-library";
import type { BuiltinStickerAssets } from "../src/main/builtin-stickers";
import type { LibraryAsset } from "../src/shared/asset-library";
import { DecorationSchema } from "../src/shared/decorations";
import { LIBRARY_FONTS, LIBRARY_STICKERS } from "../src/shared/asset-library";

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
});
