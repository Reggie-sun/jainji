import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../src/main/connection-store";
import { ModelConnections } from "../src/main/model-connections";

const directories: string[] = [];
const input = { name: "My provider", model: "vision", baseUrl: "https://example.test/v1", apiKey: "private-test-key", protocol: "responses" as const };
async function setup() { const directory = await mkdtemp(path.join(tmpdir(), "jianji-connections-")); directories.push(directory); const store = new ConnectionStore(directory); await store.load(); return { directory, store }; }
afterEach(async () => { await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
describe("built-in connections", () => {
  it("retains legacy ChatGPT selection when an inactive API profile is saved", async () => {
    const { directory } = await setup(); await mkdir(path.join(directory, "codex"));
    await writeFile(path.join(directory, "codex", "auth.json"), "fixture-only");
    const connections = new ModelConnections(directory, process.cwd(), async () => {}, () => {});
    vi.spyOn(connections.chatgpt, "refresh").mockResolvedValue(true);
    await connections.restore(); await connections.save(input);
    const restored = new ConnectionStore(path.join(directory, "connections")); await restored.load();
    expect(restored.snapshot().selected).toBe("chatgpt"); await connections.dispose();
  });
  it("persists selection across restart without exposing keys in public state", async () => {
    const { directory, store } = await setup(); const id = await store.save(input); await store.select(id);
    const restored = new ConnectionStore(directory); await restored.load();
    expect(restored.snapshot().selected).toBe(id); expect(restored.get(id).input.apiKey).toBe(input.apiKey);
    expect(JSON.stringify(restored.snapshot())).not.toContain(input.apiKey);
    if (process.platform !== "win32") expect((await stat(path.join(directory, "connections.json"))).mode & 0o777).toBe(0o600);
  });
  it("preserves keys during editing and supports explicit replacement and deletion", async () => {
    const { store } = await setup(); const id = await store.save(input); await store.select(id);
    const { apiKey: _, ...edit } = input;
    await store.save({ ...edit, id, model: "vision-next" }); expect(store.get(id).input.apiKey).toBe(input.apiKey);
    await store.save({ ...edit, id, apiKey: "replacement" }); expect(store.get(id).input.apiKey).toBe("replacement");
    await store.remove(id); expect(store.snapshot()).toMatchObject({ profiles: [], selected: null });
    await expect(store.select(id)).rejects.toThrow("找不到");
  });
  it("rejects incomplete new profiles, unknown edits, and corrupt stores without replacing data", async () => {
    const { store, directory } = await setup(); const { apiKey: _, ...noKey } = input;
    await expect(store.save(noKey)).rejects.toThrow("API Key");
    await expect(store.save({ ...input, id: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("不存在");
    await writeFile(path.join(directory, "connections.json"), "corrupt-secret-data");
    const restored = new ConnectionStore(directory); await restored.load();
    expect(restored.snapshot().error).toContain("无法读取");
    await expect(restored.save(input)).rejects.toThrow("无法读取");
    expect(await readFile(path.join(directory, "connections.json"), "utf8")).toBe("corrupt-secret-data");
  });
  it("restores and switches independent API profiles without CC Switch or OAuth", async () => {
    const { directory } = await setup();
    const connections = new ModelConnections(directory, process.cwd(), async () => { throw new Error("Unexpected browser login"); }, () => {});
    await connections.store.load(); await connections.save(input);
    const id = connections.store.snapshot().profiles[0].id;
    await connections.select(id); expect(connections.provider.status()).toMatchObject({ source: "api", configured: true, model: "vision" });
    await connections.save({ ...input, id, model: "edited" }); expect(connections.provider.status().model).toBe("edited");
    const second = new ModelConnections(directory, process.cwd(), async () => {}, () => {}); await second.restore();
    expect(second.provider.status().model).toBe("edited");
    await second.disconnect(); expect(second.store.snapshot().profiles).toHaveLength(1);
    const third = new ModelConnections(directory, process.cwd(), async () => {}, () => {}); await third.restore();
    expect(third.provider.status().configured).toBe(false);
    await connections.dispose(); await second.dispose(); await third.dispose();
  });
});
