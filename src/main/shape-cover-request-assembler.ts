import { AgentStartSchema } from "../shared/agent.js";
import { DEFAULT_PRESET, ExportPresetSchema, type MediaItem } from "./domain.js";
import type { ApplicationService } from "./application.js";
import type { FfmpegAdapter } from "./ffmpeg.js";
import { JianjiError } from "./errors.js";
import type { SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";
import { SupervisorEvidence } from "./supervisor-evidence.js";
import { readAdmittedShapeCoverTarget } from "./shape-cover-candidates.js";

function unsafe(reason: string): never { throw new JianjiError(`UNSAFE: ${reason}`, "input_invalid", "input", false); }

/** Product preparation only. No request can be issued before full-source and placement authority exist.
 * The raw M4 fixture seam and M4 sample/publication admission remain separate owners. */
export class ShapeCoverRequestAssembler {
  constructor(private readonly owners: { service: ApplicationService; store?: SourceStickerKnowledgeStore; ffmpeg: FfmpegAdapter }) {}

  async assemble(intent: unknown, signal: AbortSignal): Promise<never> {
    try {
      signal.throwIfAborted();
      const parsed = AgentStartSchema.safeParse(intent);
      if (!parsed.success || parsed.data.coverStrategy !== "shape-matched-static-v1") unsafe("需要严格的 shape intent，不能提交 production request 或 authority 字段。");
      const input = parsed.data;
      const project = this.owners.service.currentProject;
      if (!project.coverSticker?.enabled || project.coverSticker.trackingMode !== "agent" || input.sourceStickerRefresh
        || input.decorations?.mode === "random" || input.douyinUpload) unsafe("该 intent 不属于新的独立自动 shape 覆盖。");
      const preset = ExportPresetSchema.parse({ ...DEFAULT_PRESET, ...input.exportSettings, container: input.exportFormat ?? DEFAULT_PRESET.container });
      if (preset.container !== "mp4") unsafe("shape 产品准备仅允许 MP4。");
      const ids = [...new Set(input.mediaIds)];
      const media = ids.map(id => project.mediaItems.find(item => item.id === id));
      if (media.some(item => !item || item.probeStatus !== "ready")) unsafe("素材不属于当前项目或尚未 ready。");
      const store = this.owners.store;
      if (!store) unsafe("canonical mask store 不可用。");
      // Collect every canonical source, never accept caller identities/revisions or infer masks.
      for (const item of media as MediaItem[]) {
        signal.throwIfAborted();
        const evidence = new SupervisorEvidence(this.owners.ffmpeg, item);
        try {
          const source = await evidence.sourceIdentity(signal);
          if (source.rotation !== 0 || source.byteLength !== item.sizeBytes || source.durationMs !== item.durationMs) unsafe("不支持或失配的源解释。");
          await store.verifySource(item.sourcePath, source);
          const head = await store.readHead(source);
          if (!head || head.revision.state !== "reviewed" || head.revision.verification !== "source-mask-only") unsafe("缺当前 admitted mask revision。");
          const targets = head.revision.candidate.facts.targets;
          if (!targets.length) unsafe("缺可信全片无贴纸证明，不能由空目标推断 absence。");
          for (const target of targets) for (const segment of target.segments) {
            await readAdmittedShapeCoverTarget({ id: segment.id, sourcePath: item.sourcePath, source, revisionId: head.revision.id,
              targetId: target.id, segmentId: segment.id, range: { startMs: segment.track.startMs, endMs: segment.track.endMs }, placements: [] }, store);
            signal.throwIfAborted();
          }
        } finally { await evidence.dispose(); }
      }
      signal.throwIfAborted();
      // Recorded segment completeness is not whole-source eligibility. No callback can supply PASS.
      return unsafe("M5-D 全片源事实 authority 与可信 shape placement 尚未建立，不能签发 production request。");
    } catch (error) {
      if (signal.aborted) return unsafe("准备已取消。");
      if (error instanceof JianjiError) throw error;
      return unsafe("canonical 源身份、修订或 mask 无效，准备已停止。");
    }
  }
}
