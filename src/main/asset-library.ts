import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LIBRARY_ASSETS, LIBRARY_STICKERS, LIBRARY_LICENSES, type LibraryAsset, type LibraryAssetPreview } from "../shared/asset-library.js";
import { CORNERS, type DecorationOptions } from "../shared/decorations.js";
import { DEFAULT_TEXT_FONT_FAMILY } from "../shared/defaults.js";
import type { BuiltinStickerAsset, StickerAssets } from "./builtin-stickers.js";
import { resolveFont } from "./ffmpeg.js";

const bundledStickerIds = new Set(LIBRARY_STICKERS.map(({ id }) => id));
export function bundledStickerDirectory(runtime: { resourcesPath?: string; defaultApp?: boolean } = process as NodeJS.Process & { resourcesPath?: string; defaultApp?: boolean }): string {
  return runtime.resourcesPath && !runtime.defaultApp
    ? path.join(runtime.resourcesPath, "sticker-library") : path.resolve("resources/sticker-library");
}

function hasAutomaticCorners(options: DecorationOptions): boolean {
  return CORNERS.some((corner) => !options.corners?.[corner]);
}

export function decorationFontFamilies(options: DecorationOptions): string[] {
  return options.productPrice?.trim() ? [DEFAULT_TEXT_FONT_FAMILY] : [];
}

function decorationStickerIds(options: DecorationOptions): string[] {
  const stickers = Object.values(options.corners ?? {})
    .flatMap((decoration) => decoration?.type === "sticker" ? [decoration.sticker] : []);
  if (hasAutomaticCorners(options) && options.sticker !== "template" && options.sticker !== "none") stickers.push(options.sticker);
  return [...new Set(stickers)];
}

/** Pinned upstream files are the only accepted inputs; IPC never accepts URLs or paths. */
export class AssetLibrary {
  private readonly entries: Map<string, LibraryAsset>;
  private readonly pending = new Map<string, Promise<BuiltinStickerAsset>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly root: string, private readonly download: typeof fetch = fetch,
    entries: readonly LibraryAsset[] = LIBRARY_ASSETS, private readonly licenses: Readonly<Record<string, string>> = LIBRARY_LICENSES,
    private readonly bundledRoot = bundledStickerDirectory()) {
    this.entries = new Map(entries.map((entry) => [entry.id, entry]));
  }

  private file(entry: LibraryAsset): string { return path.join(this.root, `${entry.blob}.${entry.kind === "font" ? "ttf" : "png"}`); }
  private valid(entry: LibraryAsset, bytes: Buffer): boolean {
    return bytes.length === entry.size && createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === entry.blob;
  }
  private async cached(entry: LibraryAsset): Promise<Buffer | null> {
    try {
      if ((await stat(this.file(entry))).size !== entry.size) return null;
      const bytes = await readFile(this.file(entry));
      return this.valid(entry, bytes) ? bytes : null;
    } catch { return null; }
  }
  private async acquire(): Promise<void> {
    if (this.running < 4) { this.running += 1; return; }
    if (this.waiting.length >= 64) throw new Error("素材下载繁忙，请稍后重试。");
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); else this.running -= 1;
  }

  async ensure(id: string): Promise<BuiltinStickerAsset> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("未知素材，请从素材库重新选择。");
    const existing = this.pending.get(id);
    if (existing) return existing;
    const pending = this.materialize(entry);
    this.pending.set(id, pending);
    try { return await pending; } finally { this.pending.delete(id); }
  }

  private async materialize(entry: LibraryAsset): Promise<BuiltinStickerAsset> {
    await this.acquire();
    try {
      const license = this.licenses[entry.license];
      if (!license) throw new Error("素材缺少许可证。");
      await mkdir(path.join(this.root, "licenses"), { recursive: true });
      await writeFile(path.join(this.root, "licenses", `${entry.license}.txt`), license, "utf8");
      let bytes = await this.cached(entry);
      if (!bytes) {
        if (entry.kind === "sticker" && bundledStickerIds.has(entry.id)) {
          try { bytes = await readFile(path.join(this.bundledRoot, `${entry.blob}.png`)); }
          catch { throw new Error("内置贴纸缺失，请重新安装完整软件包。"); }
          if (!this.valid(entry, bytes)) throw new Error("内置贴纸校验失败，请重新安装完整软件包。");
        } else {
          const response = await this.download(entry.url, { signal: AbortSignal.timeout(30000), redirect: "error" });
          if (!response.ok || !response.body) throw new Error("素材下载失败，请检查网络后重试。");
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > entry.size) throw new Error("素材大小校验失败。");
              chunks.push(value);
            }
          } finally { await reader.cancel(); }
          bytes = Buffer.concat(chunks);
          if (!this.valid(entry, bytes)) throw new Error("素材内容校验失败，请重试。");
        }
        const temporary = `${this.file(entry)}.${randomUUID()}.part`;
        try { await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, this.file(entry)); }
        finally { await rm(temporary, { force: true }); }
      }
      return { assetPath: this.file(entry), assetFingerprint: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
    } finally { this.release(); }
  }

  async preview(id: string): Promise<LibraryAssetPreview> {
    const asset = await this.ensure(id);
    const mime = this.entries.get(id)!.kind === "font" ? "font/ttf" : "image/png";
    return { url: `data:${mime};base64,${(await readFile(asset.assetPath)).toString("base64")}` };
  }

  async resolveFont(family: string): Promise<string | null> {
    const entry = [...this.entries.values()].find((candidate) => candidate.kind === "font" && candidate.family === family);
    // Registered names never fall back to a different system font.
    return entry ? await this.cached(entry) ? this.file(entry) : null : resolveFont(family);
  }

  async prepare(options: DecorationOptions, builtins: StickerAssets): Promise<StickerAssets> {
    for (const family of decorationFontFamilies(options)) {
      const font = [...this.entries.values()].find((entry) => entry.kind === "font" && entry.family === family);
      if (font) await this.ensure(font.id);
    }
    const selected = await Promise.all(decorationStickerIds(options)
      .filter((id) => this.entries.has(id))
      .map(async (id) => [id, await this.ensure(id)] as const));
    return selected.length ? { ...builtins, ...Object.fromEntries(selected) } : builtins;
  }
}
