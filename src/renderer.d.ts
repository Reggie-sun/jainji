import type { AppState } from "./main/application";
import type { EditTemplate, ExportPreset } from "./main/domain";
import type { LayoutAgentInput } from "./main/layout-agent";

declare global {
  interface Window {
    jianji: {
      getPathForFile(file: File): string;
      getState(): Promise<AppState & { capabilities: any }>;
      selectAndProbe(): Promise<AppState & { capabilities: any }>;
      addAndProbe(paths: string[]): Promise<AppState & { capabilities: any }>;
      removeMedia(mediaId: string): Promise<AppState & { capabilities: any }>;
      selectStickerAsset(): Promise<{ assetPath: string; assetFingerprint: string } | null>;
      updateTemplate(template: EditTemplate): Promise<AppState & { capabilities: any }>;
      applyLayoutAgent(input: LayoutAgentInput): Promise<AppState & { capabilities: any }>;
      saveTemplate(): Promise<EditTemplate | null>;
      loadTemplate(): Promise<AppState & { capabilities: any } | null>;
      saveProject(): Promise<AppState & { capabilities: any } | null>;
      loadProject(): Promise<AppState & { capabilities: any } | null>;
      newProject(): Promise<AppState & { capabilities: any }>;
      selectOutputDirectory(): Promise<string | null>;
      renderProof(mediaId: string): Promise<{ taskId: string }>;
      createExport(input: { mediaIds: string[]; outputDirectory: string; preset: ExportPreset }): Promise<{ batchId: string; taskIds: string[] }>;
      cancelExport(taskId: string): Promise<AppState & { capabilities: any }>;
      retryExport(taskIds?: string[]): Promise<AppState & { capabilities: any }>;
      openArtifact(taskId: string): Promise<boolean>;
      revealArtifact(taskId: string): Promise<boolean>;
      onExportSnapshot(listener: (state: AppState & { capabilities: any }) => void): () => void;
    };
  }
}

export {};
