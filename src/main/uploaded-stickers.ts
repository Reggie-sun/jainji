import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isUploadedStickerId } from "../shared/decorations.js";
import type { BuiltinStickerAsset } from "./builtin-stickers.js";
import { isUploadedFrameId } from "../shared/frames.js";

const MAX_BYTES = 10 * 1024 * 1024;
const digest = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

// Inspect encoded dimensions before the Electron main process decodes pixels.
function assertImageDimensions(bytes: Buffer): void {
  const check = (width: number, height: number) => {
    if (!width || !height || width > 4096 || height > 4096) throw new Error("图片宽高不得超过 4096 像素。");
  };
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && bytes.toString("ascii", 12, 16) === "IHDR") {
    check(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    return;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) break;
        check(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
        return;
      }
      offset += length;
    }
  }
  throw new Error("请选择有效的 PNG 或 JPG 图片。");
}

export class UploadedStickers {
  constructor(private readonly root: string, private readonly decodePng: (bytes: Buffer) => Buffer, private readonly kind: "sticker" | "frame" = "sticker") {}

  private validId(id: string): boolean { return this.kind === "frame" ? isUploadedFrameId(id) : isUploadedStickerId(id); }
  private id(bytes: Buffer): string { return `${this.kind === "frame" ? "uploaded-frame" : "uploaded"}-${digest(bytes)}`; }

  async importFile(source: string): Promise<{ id: string; asset: BuiltinStickerAsset }> {
    if (this.kind === "frame" && !/\.png$/i.test(source)) throw new Error("边框只支持透明 PNG 图片。");
    if (!/\.(png|jpe?g)$/i.test(source)) throw new Error("请选择 PNG 或 JPG 图片。");
    const file = await open(source, "r");
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES) throw new Error("贴纸必须是 10 MB 以内的图片。");
      bytes = Buffer.alloc(info.size + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== info.size) throw new Error("图片已变化，请重新上传。");
      bytes = bytes.subarray(0, bytesRead);
    } finally { await file.close(); }
    assertImageDimensions(bytes);
    if (this.kind === "frame" && !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error("边框只支持透明 PNG 图片。");
    const png = this.decodePng(bytes);
    if (!png.length || png.length > MAX_BYTES) throw new Error("图片过大，请缩小后上传。");
    const hash = digest(png);
    const id = this.id(png);
    await mkdir(this.root, { recursive: true });
    const assetPath = path.join(this.root, `${id}.png`);
    const temporary = path.join(this.root, `${randomUUID()}.part`);
    try {
      await writeFile(temporary, png, { flag: "wx" });
      try { await link(temporary, assetPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (digest(await readFile(assetPath)) !== hash) throw new Error("已保存的贴纸损坏，请检查本地素材目录。");
      }
    } finally { await rm(temporary, { force: true }); }
    await rm(path.join(this.root, `${id}.deleted`), { force: true });
    return { id, asset: { assetPath, assetFingerprint: `sha256:${hash}` } };
  }

  async remove(id: string): Promise<void> {
    if (!this.validId(id)) throw new Error("只能删除用户上传的素材。");
    if (!(await stat(path.join(this.root, `${id}.png`))).isFile()) throw new Error("上传贴纸不存在。");
    // Keep the immutable image at its original path for frozen export retries.
    await writeFile(path.join(this.root, `${id}.deleted`), "", { flag: "a" });
  }

  async load(): Promise<Record<string, BuiltinStickerAsset>> {
    await mkdir(this.root, { recursive: true });
    const assets: Record<string, BuiltinStickerAsset> = {};
    const names = new Set(await readdir(this.root));
    for (const name of [...names].sort()) {
      const id = name.replace(/\.png$/, "");
      if (name !== `${id}.png` || !this.validId(id) || names.has(`${id}.deleted`)) continue;
      const assetPath = path.join(this.root, name);
      const bytes = await readFile(assetPath);
      if (bytes.length > MAX_BYTES || this.id(bytes) !== id) continue;
      if (this.kind === "frame") {
        try { assertImageDimensions(bytes); this.decodePng(bytes); } catch { continue; }
      }
      assets[id] = { assetPath, assetFingerprint: `sha256:${digest(bytes)}` };
    }
    return assets;
  }

  async catalog() {
    const assets = await this.load();
    return Promise.all(Object.entries(assets).map(async ([id, asset]) => ({
      id, label: this.kind === "frame" ? `我的边框 ${id.slice(15, 23)}` : `我的贴纸 ${id.slice(9, 17)}`, animated: false, source: "uploaded" as const,
      url: `data:image/png;base64,${(await readFile(asset.assetPath)).toString("base64")}`,
    })));
  }
}
