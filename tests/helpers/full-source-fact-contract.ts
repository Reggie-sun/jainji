import { z } from "zod";
import { SourceIdentitySchema } from "../../src/shared/source-sticker-knowledge";

// Executable draft only. This helper checks claims; it never reviews pixels, issues proofs,
// reads canonical revisions or admits masks. No production module may consume its result.
const integer = z.number().int().safe();
const ordinal = integer.nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1);
const binding = { source: SourceIdentitySchema, revisionId: id, factsDigest: digest, decodeProfile: z.literal("full-canvas-rgba-pts-v1") };
const InventorySchema = z.object({ ...binding, horizonEndPts: integer, frames: z.array(z.object({
  index: ordinal, pts: integer, endPts: integer, pixelSha256: digest, byteLength: integer.positive(),
}).strict()).min(1) }).strict();
const ClaimSchema = z.object({ ...binding, schemaVersion: z.literal(1), frames: z.array(z.object({
  index: ordinal, pts: integer, pixelSha256: digest, byteLength: integer.positive(), scope: z.literal("full-canvas-rgba"),
  state: z.enum(["COMPLETE", "UNKNOWN"]), targets: z.array(id),
}).strict()), targets: z.array(z.object({ id, segments: z.array(z.object({ id, startFrame: ordinal, endFrame: ordinal }).strict()).min(1) }).strict()) }).strict();

export type FrameInventory = z.infer<typeof InventorySchema>;
export type FullSourceClaim = z.infer<typeof ClaimSchema>;
type FrameInterval = { startFrame: number; endFrame: number };
type ContractCheck = {
  consistency: "CONSISTENT" | "INVALID";
  authority: "none";
  eligible: false;
  semanticReview: "NOT_EVALUATED";
  issues: string[];
  claimedCoveredIntervals: FrameInterval[];
  claimedNoStickerIntervals: FrameInterval[];
  unverifiedIntervals: FrameInterval[];
};

function intervals(indices: number[]): FrameInterval[] {
  const result: FrameInterval[] = [];
  for (const index of indices) {
    const last = result.at(-1);
    if (last?.endFrame === index) last.endFrame++;
    else result.push({ startFrame: index, endFrame: index + 1 });
  }
  return result;
}
const unique = (values: string[]) => new Set(values).size === values.length;

export function checkFullSourceFactContract(rawInventory: unknown, rawClaim: unknown): ContractCheck {
  const base = { authority: "none", eligible: false, semanticReview: "NOT_EVALUATED" } as const;
  const invalid = (issue: string): ContractCheck => ({ ...base, consistency: "INVALID", issues: [issue], claimedCoveredIntervals: [], claimedNoStickerIntervals: [], unverifiedIntervals: [] });
  const parsedInventory = InventorySchema.safeParse(rawInventory); const parsedClaim = ClaimSchema.safeParse(rawClaim);
  if (!parsedInventory.success || !parsedClaim.success) return invalid("Unsupported or malformed draft contract");
  const inventory = parsedInventory.data; const claim = parsedClaim.data;
  for (const key of Object.keys(inventory.source) as (keyof FrameInventory["source"])[]) {
    if (inventory.source[key] !== claim.source[key]) return invalid("Source identity mismatch");
  }
  if (inventory.revisionId !== claim.revisionId || inventory.factsDigest !== claim.factsDigest || inventory.decodeProfile !== claim.decodeProfile) return invalid("Revision or interpretation mismatch");
  if (inventory.source.rotation !== 0) return invalid("Unsupported decoded canvas orientation");
  for (let index = 0; index < inventory.frames.length; index++) {
    const frame = inventory.frames[index];
    const nextPts = inventory.frames[index + 1]?.pts ?? inventory.horizonEndPts;
    if (frame.index !== index || frame.endPts <= frame.pts || frame.endPts !== nextPts
      || (index === 0 && frame.pts !== inventory.source.timeOriginPts)
      || frame.byteLength !== inventory.source.width * inventory.source.height * 4) return invalid("Incomplete decoded frame horizon or pixel binding");
  }
  const [numerator, denominator] = inventory.source.timeBase.split("/").map(BigInt);
  // Existing durationMs is rounded metadata, not the exact tail clock authority.
  const durationTicks = BigInt(inventory.horizonEndPts) - BigInt(inventory.source.timeOriginPts);
  const delta = durationTicks * numerator * 1000n - BigInt(inventory.source.durationMs) * denominator;
  if (delta < -denominator || delta > denominator) return invalid("Decoded horizon disagrees with source duration");
  const rows = new Map<number, FullSourceClaim["frames"][number]>();
  for (const row of claim.frames) {
    const frame = inventory.frames[row.index];
    if (!frame || rows.has(row.index) || row.pts !== frame.pts || row.pixelSha256 !== frame.pixelSha256
      || row.byteLength !== frame.byteLength || !unique(row.targets)) return invalid("Missing, duplicate or mismatched frame evidence");
    rows.set(row.index, row);
  }
  if (!unique(claim.targets.map(target => target.id))) return invalid("Duplicate target identity");
  const observed = new Set(claim.frames.flatMap(row => row.targets));
  const catalogue = new Set(claim.targets.map(target => target.id));
  if (observed.size !== catalogue.size || [...observed].some(target => !catalogue.has(target))) return invalid("Catalogue does not equal the observed target union");
  for (const target of claim.targets) {
    if (!unique(target.segments.map(segment => segment.id))) return invalid("Duplicate segment identity");
    const active = new Set<number>();
    for (const segment of target.segments) {
      if (segment.startFrame >= segment.endFrame || segment.endFrame > inventory.frames.length) return invalid("Invalid target segment horizon");
      for (let index = segment.startFrame; index < segment.endFrame; index++) {
        if (active.has(index)) return invalid("Overlapping target segments");
        active.add(index);
      }
    }
    for (const [index, row] of rows) {
      if (row.state === "COMPLETE" && active.has(index) !== row.targets.includes(target.id)) return invalid("Segment activity differs from the complete frame target set");
      if (row.targets.includes(target.id) && !active.has(index)) return invalid("Observed target is outside its segments");
    }
  }
  const covered: number[] = []; const noSticker: number[] = []; const unverified: number[] = [];
  for (const frame of inventory.frames) {
    const row = rows.get(frame.index);
    if (!row || row.state === "UNKNOWN") unverified.push(frame.index);
    else { covered.push(frame.index); if (row.targets.length === 0) noSticker.push(frame.index); }
  }
  return { ...base, consistency: "CONSISTENT", issues: [], claimedCoveredIntervals: intervals(covered),
    claimedNoStickerIntervals: intervals(noSticker), unverifiedIntervals: intervals(unverified) };
}
