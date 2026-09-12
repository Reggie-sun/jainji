import manifest from "./asset-manifest.json";

export interface LibraryAsset {
  id: string;
  label: string;
  kind: "sticker" | "font";
  family?: string;
  url: string;
  blob: string;
  size: number;
  license: string;
}
export const LIBRARY_ASSETS = manifest.assets as LibraryAsset[];
export const LIBRARY_STICKERS = LIBRARY_ASSETS.filter((asset) => asset.kind === "sticker");
export const LIBRARY_FONTS = LIBRARY_ASSETS.filter((asset) => asset.kind === "font");
export const LIBRARY_LICENSES: Record<string, string> = manifest.licenses;
export interface LibraryAssetPreview { url: string }
