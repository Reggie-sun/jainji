import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ProjectSchema, type Project } from "./domain.js";
import { canonicalPath } from "./paths.js";
import { atomicWriteJson, readValidatedJson } from "./store.js";

const EntrySchema = z.object({ id: z.string().uuid(), filePath: z.string().refine(path.isAbsolute), name: z.string().min(1), mediaCount: z.number().int().nonnegative() });
const RegistrySchema = z.object({ schemaVersion: z.literal(1), entries: z.array(EntrySchema) });
type Entry = z.infer<typeof EntrySchema>;

/** A file index only; ProjectStore remains the owner of project contents. */
export class RecentProjects {
  private entries: Entry[] = [];
  private work: Promise<void> = Promise.resolve();
  warning?: string;
  constructor(private readonly filePath: string) {}

  async initialize(legacyDirectories: readonly string[] = []): Promise<void> {
    try {
      await stat(this.filePath);
      this.entries = (await readValidatedJson(this.filePath, (value) => RegistrySchema.parse(value))).value.entries;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.warning = "已保存素材集列表暂时无法读取。素材集文件不受影响，可通过“打开其他素材集”重新选择。";
        return;
      }
    }
    // Older versions saved JSON files without maintaining a recent-file index.
    for (const directory of new Set(legacyDirectories)) {
      const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".json")) continue;
        const filePath = path.join(directory, file.name);
        let project: Project;
        try { project = ProjectSchema.parse(JSON.parse(await readFile(filePath, "utf8"))); }
        catch { continue; }
        await this.remember(filePath, project);
      }
    }
    try { await atomicWriteJson(this.filePath, { schemaVersion: 1, entries: this.entries }); }
    catch { this.warnWriteFailure(); }
  }

  list() {
    return this.entries.map(({ id, name, mediaCount, filePath }) => ({ id, name, mediaCount, fileName: path.basename(filePath) }));
  }

  resolve(id: string): string {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) throw new Error("找不到该素材集，请使用“打开其他素材集”。");
    return entry.filePath;
  }

  remember(filePath: string, project: Pick<Project, "name" | "mediaItems">): Promise<void> {
    const name = project.name;
    const mediaCount = project.mediaItems.length;
    const pending = this.work.catch(() => undefined).then(async () => {
      const resolved = await canonicalPath(filePath);
      const existing = this.entries.find((item) => item.filePath === resolved);
      const entries = [{ id: existing?.id ?? randomUUID(), filePath: resolved, name, mediaCount }, ...this.entries.filter((item) => item.filePath !== resolved)];
      await atomicWriteJson(this.filePath, { schemaVersion: 1, entries });
      this.entries = entries;
      this.warning = undefined;
    }).catch(() => { this.warnWriteFailure(); });
    this.work = pending;
    return pending;
  }

  private warnWriteFailure(): void {
    this.warning = "已保存素材集列表暂时无法更新。素材集文件不受影响，可通过“打开其他素材集”继续使用。";
  }
}
