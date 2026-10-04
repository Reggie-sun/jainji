/** Immutable cpu-static-geometry/v2 archive contract. Add v3 rather than changing this version. */
import { z } from "zod";
import { freezeAI } from "./source-fact-ai-contract.js";
/** v1 config/kernel remain immutable archive inputs. v2 only changes the observation unit. */
export { STATIC_GEOMETRY_CONFIG } from "./source-mask-static-geometry-v1.js";
import { STATIC_GEOMETRY_CONFIG, StaticGeometryArtifactSchema as StaticGeometryArtifactSchemaV1,
  StaticGeometryFrameSchemaV1 as Frame, StaticGeometryReferenceSchemaV1 as Reference } from "./source-mask-static-geometry-v1.js";
export const STATIC_COMPONENT_GEOMETRY_CONFIG = freezeAI({ method: "cpu-static-component-geometry/v2", kernel: STATIC_GEOMETRY_CONFIG,
  referencePadding: 0, gradientSupportRadius: 3, searchSupportRadius: 8, unobservablePolicy: "ALL_COMPONENTS_REQUIRED" });
const KERNELS = { "scripts/shape-cover-static-geometry.py": "d8860f2ff885424e579314fb039f71a6a6116226ba85a92705257c1e71465266",
  "scripts/shape-cover-static-anomalies.py": "888dc35506a69236e544515b876bed8d548ea8fe492ba330fad0be660d9d82e0" };
const Digest = z.string().regex(/^[a-f0-9]{64}$/), BaseReceipt = StaticGeometryArtifactSchemaV1.shape.receipt;
const Box = Reference.shape.box, Summary = BaseReceipt.shape.summary;
export const ComponentGeometrySchema = z.object({ candidateId: Digest, componentDigest: Digest, sourceBox: Box,
  method: z.literal("component-local-persistent-gradients/v2"), referencePadding: z.literal(0),
  referenceDigest: Digest, metricsDigest: Digest, frameCount: z.number().int().positive().max(20000),
  status: z.enum(["SUPPORTED", "GEOMETRY_CONTRADICTION_OR_UNRESOLVED", "COMPONENT_GEOMETRY_UNOBSERVABLE"]),
  issueFrames: BaseReceipt.shape.issueFrames, issueRanges: BaseReceipt.shape.issueRanges, summary: Summary.nullable() }).strict();
export const StaticGeometryArtifactSchema = z.object({ type: z.literal("owned-static-geometry/v2"),
  receipt: BaseReceipt.extend({ method: z.literal("cpu-static-geometry/v2"), components: z.array(ComponentGeometrySchema).min(1).max(128),
    summary: Summary.nullable(), methodSources: z.record(z.string(), Digest).refine(v => Object.keys(v).length === 7
      && ["scripts/shape-cover-static-geometry-worker.py", "scripts/shape-cover-static-geometry-components.py",
        "src/main/source-mask-static-geometry.ts", "src/main/source-mask-static-geometry-v1.ts", "src/main/source-mask-static-geometry-v2.ts"].every(p => p in v)
      && Object.entries(KERNELS).every(([p, d]) => v[p] === d)) }).strict(),
  references: z.array(Reference.nullable()).min(1).max(128) }).strict();
export { Frame, Reference, Box, Digest, KERNELS };
