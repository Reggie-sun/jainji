/** Immutable archive validator for cpu-static-geometry/v1. Never imports the current geometry implementation. */
import { z } from "zod";
import { freezeAI } from "./source-fact-ai-contract.js";
/** Exact M2-C v2 parameters; the owned method wraps, never retunes, its CPU kernel. */
export const STATIC_GEOMETRY_CONFIG = freezeAI({ method: "cpu-static-geometry-development/v2", gaussianSigma: 0.6,
  minimumGradient: 8, sampleDirectionCosine: 0.9, sampleConsensus: 0.9, sampleStrengthRatio: [0.5, 2], grid: [3, 3],
  landmarksPerCell: 48, minimumLandmarksPerCell: 8, minimumCells: 6, minimumSpatialSpan: 0.5,
  searchRadius: 4, localSearchRadius: 2, subpixelStep: 0.25, maximumOffset: 0.5, maximumLocalOffset: 0.75,
  minimumCorrelation: 0.9, minimumCellCorrelation: 0.8, ambiguityDistance: 1.5, ambiguityCorrelationGap: 0.02,
  landmarkPresenceRatio: 0.35, maximumLostFraction: 0.15, energyRatio: [0.45, 2.25], boxPadding: 3 });
const KERNELS = { "scripts/shape-cover-static-geometry.py": "d8860f2ff885424e579314fb039f71a6a6116226ba85a92705257c1e71465266",
  "scripts/shape-cover-static-anomalies.py": "888dc35506a69236e544515b876bed8d548ea8fe492ba330fad0be660d9d82e0" };
const NumberValue = z.number().finite(), Offset = z.tuple([NumberValue, NumberValue]);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Fit = z.object({ offset: Offset, correlation: NumberValue.min(-1).max(1), zeroCorrelation: NumberValue.min(-1).max(1),
  distinctPeakGap: NumberValue.nullable(), boundary: z.boolean(), ambiguous: z.boolean() }).strict();
const Frame = z.object({ index: z.number().int().nonnegative(), pts: z.number().int().safe(), endPts: z.number().int().safe(),
  byteLength: z.number().int().positive(), pixelSha256: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(["STATIC_GEOMETRY_OBSERVED", "GEOMETRY_CONTRADICTION_OR_UNRESOLVED"]),
  reasons: z.array(z.string()).max(6), globalOffset: Offset, globalAlignment: Fit, gradientEnergyRatio: NumberValue.nonnegative(),
  lostLandmarkFraction: NumberValue.min(0).max(1), cells: z.array(Fit.extend({ cell: z.number().int().min(0).max(8), landmarks: z.number().int().min(8).max(48) }).strict()).min(6).max(9), oldRgbAnomaly: z.boolean() }).strict();
const Reference = z.object({ extent: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  box: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  sampleCount: z.number().int().min(3).max(96), landmarks: z.array(z.object({ sourceX: z.number().int(), sourceY: z.number().int(),
    cell: z.number().int().min(0).max(8), gradient: Offset }).strict()).min(48).max(432),
  origin: z.literal("PERSISTENT_GRADIENT_LANDMARKS_NOT_MASK_OR_REQUIRED_PIXELS") }).strict();
export const StaticGeometryArtifactSchema = z.object({ type: z.literal("owned-static-geometry/v1"),
  receipt: z.object({ method: z.literal("cpu-static-geometry/v1"), kernelMethod: z.literal("cpu-static-geometry-development/v2"), authority: z.literal("none"), eligible: z.literal(false),
    sourceKey: z.string().regex(/^[a-f0-9]{64}$/), confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/), targetId: z.string().uuid(),
    range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict(),
    evidenceDigest: Digest, clockDigest: Digest, bindingDigest: Digest, configDigest: Digest, referenceDigest: Digest, frameMetricsDigest: Digest,
    frameCount: z.number().int().positive().max(20000), firstPts: z.number().int().safe(), lastPts: z.number().int().safe(), endPts: z.number().int().safe(),
    status: z.enum(["DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED", "INCOMPLETE_GEOMETRY_CONTRADICTION_OR_UNRESOLVED"]), issueFrames: z.array(z.number().int()).max(20000),
    issueRanges: z.array(z.object({ startFrame: z.number().int(), endFrame: z.number().int() }).strict()).max(20000),
    summary: z.object({ maximumGlobalOffset: NumberValue, minimumGlobalCorrelation: NumberValue, minimumDistinctPeakGap: NumberValue,
      maximumLostLandmarkFraction: NumberValue, gradientEnergyRatio: z.tuple([NumberValue, NumberValue]), minimumLocalCorrelation: NumberValue, maximumLocalOffset: NumberValue }).strict(),
    methodSources: z.record(z.string(), Digest).refine(v => Object.keys(v).length === 4
      && ["scripts/shape-cover-static-geometry-worker.py", "src/main/source-mask-static-geometry.ts"].every(p => p in v)
      && Object.entries(KERNELS).every(([p, d]) => v[p] === d)),
    runtime: z.object({ pythonFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), numpy: z.literal("2.2.6"), opencv: z.literal("4.12.0") }).strict(),
    geometryDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(), reference: Reference,
}).strict();
export { Frame as StaticGeometryFrameSchemaV1, Reference as StaticGeometryReferenceSchemaV1 };
