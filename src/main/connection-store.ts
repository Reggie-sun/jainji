import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { ConnectionInputSchema, type ConnectionInput } from "../shared/agent.js";
import { SaveConnectionSchema, type ConnectionLibrary } from "../shared/connections.js";
import { ProviderError } from "./api-transport.js";

const ProfileSchema = ConnectionInputSchema.extend({ id: z.string().uuid(), name: z.string().trim().min(1).max(80) });
const StoreSchema = z.object({ version: z.literal(1), selected: z.string().nullable(), chatgptModel: ConnectionInputSchema.shape.model.optional(), chatgptReasoningEffort: ConnectionInputSchema.shape.reasoningEffort, profiles: z.array(ProfileSchema).max(100) }).strict().superRefine((store, ctx) => {
  if (new Set(store.profiles.map((p) => p.id)).size !== store.profiles.length ||
      (store.selected !== null && store.selected !== "chatgpt" && !store.profiles.some((p) => p.id === store.selected))) ctx.addIssue({ code: "custom", message: "Invalid profile selection" });
});
type Store = z.infer<typeof StoreSchema>;

// This file is private application configuration, never part of a project/export.
export class ConnectionStore {
  private state: Store = { version: 1, selected: null, profiles: [] };
  private error?: string;
  private loaded = false;
  exists = false;
  constructor(private readonly directory: string) {}
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await readFile(path.join(this.directory, "connections.json"), "utf8");
      this.state = StoreSchema.parse(JSON.parse(data)); this.exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = "本机连接配置无法读取，请检查 connections.json；原文件已保留。";
    }
    this.loaded = true;
  }
  snapshot(): ConnectionLibrary {
    return { selected: this.state.selected, chatgptModel: this.state.chatgptModel, chatgptReasoningEffort: this.state.chatgptReasoningEffort, error: this.error, profiles: this.state.profiles.map(({ id, name, baseUrl, model, reasoningEffort, protocol, authHeader }) => ({ id, name, baseUrl, model, reasoningEffort, protocol: protocol ?? "chat-completions", authHeader: authHeader ?? "bearer" })) };
  }
  get(id: string): { name: string; input: ConnectionInput } {
    const profile = this.state.profiles.find((p) => p.id === id);
    if (!profile) throw new ProviderError("找不到此连接配置，请刷新后重试。");
    return { name: profile.name, input: ConnectionInputSchema.parse({ baseUrl: profile.baseUrl, model: profile.model, reasoningEffort: profile.reasoningEffort, apiKey: profile.apiKey, protocol: profile.protocol, authHeader: profile.authHeader }) };
  }
  private async commit(next: Store): Promise<void> {
    if (!this.loaded || this.error) throw new ProviderError(this.error ?? "连接配置正在加载。");
    const parsed = StoreSchema.safeParse(next);
    if (!parsed.success) throw new ProviderError("连接配置无效或数量已达上限。");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, `connections-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(parsed.data), { mode: 0o600, flag: "wx" });
      await rename(temporary, path.join(this.directory, "connections.json"));
      this.state = parsed.data; this.exists = true;
    } catch { throw new ProviderError("无法保存本机连接配置，请检查目录权限和磁盘空间。"); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  async save(input: unknown): Promise<string> {
    const parsed = SaveConnectionSchema.safeParse(input);
    if (!parsed.success) throw new ProviderError("请检查连接名称、API 地址、模型和 Key。");
    const { id, ...fields } = parsed.data;
    const old = id ? this.state.profiles.find((p) => p.id === id) : undefined;
    if (id && !old) throw new ProviderError("此连接已不存在。");
    const apiKey = fields.apiKey ?? old?.apiKey;
    if (!apiKey) throw new ProviderError("新增连接需要填写 API Key。");
    const reasoningEffort = Object.hasOwn(fields, "reasoningEffort") ? fields.reasoningEffort :
      fields.model === old?.model && (fields.protocol ?? "chat-completions") === (old?.protocol ?? "chat-completions") ? old?.reasoningEffort : undefined;
    const profile = { ...fields, reasoningEffort, apiKey, id: id ?? randomUUID() };
    const profiles = old ? this.state.profiles.map((p) => p.id === id ? profile : p) : [...this.state.profiles, profile];
    await this.commit({ ...this.state, profiles });
    return profile.id;
  }
  async select(id: string | null): Promise<void> {
    if (id !== null && id !== "chatgpt") this.get(id);
    await this.commit({ ...this.state, selected: id });
  }
  async saveChatGPTModel(model: string, reasoningEffort?: string): Promise<void> { await this.commit({ ...this.state, chatgptModel: model, chatgptReasoningEffort: reasoningEffort }); }
  async remove(id: string): Promise<void> {
    this.get(id);
    await this.commit({ ...this.state, selected: this.state.selected === id ? null : this.state.selected, profiles: this.state.profiles.filter((p) => p.id !== id) });
  }
}
