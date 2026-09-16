import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectionStore } from "../src/main/connection-store";
import { ModelConnections } from "../src/main/model-connections";

const roots: string[] = [];
const profile = { name: "fixture", model: "creative", baseUrl: "https://example.test/v1", apiKey: "private-fixture-key" };
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-vision-role-")); roots.push(root);
  const connections = new ModelConnections(root, process.cwd(), async () => {}, () => {});
  await connections.restore(); await connections.save(profile);
  const id = connections.store.snapshot().profiles[0].id;
  await connections.select(id);
  return { root, connections, id };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it("restores an independent vision model without changing creative selection or duplicating credentials", async () => {
  const { root, connections, id } = await setup();
  try {
    expect(connections.visionProvider.status().configured).toBe(false);
    await connections.selectVision({ connectionId: id, model: "detector", reasoningEffort: "high" });
    expect(connections.provider.status().model).toBe("creative");
    expect(connections.visionProvider.status()).toMatchObject({ model: "detector", reasoningEffort: "high", configured: true });
    await connections.selectModel({ connectionId: id, model: "creative-next" });
    expect(connections.visionProvider.status().model).toBe("detector");
    const publicState = connections.store.snapshot();
    expect(publicState.selected).toBe(id);
    expect(JSON.stringify(publicState)).not.toContain(profile.apiKey);
    const saved = JSON.parse(await readFile(path.join(root, "connections/connections.json"), "utf8"));
    expect(saved.vision).toEqual({ connectionId: id, model: "detector", reasoningEffort: "high" });
    expect(saved.profiles[0].apiKey).toBe(profile.apiKey);
    const restored = new ModelConnections(root, process.cwd(), async () => {}, () => {});
    try {
      await restored.restore();
      expect(restored.provider.status().model).toBe("creative-next");
      expect(restored.visionProvider.status().model).toBe("detector");
      await restored.selectVision(null);
      expect(restored.visionProvider.status().configured).toBe(false);
      expect(restored.provider.status().configured).toBe(true);
    } finally { await restored.dispose(); }
  } finally { await connections.dispose(); }
});

it("keeps vision independent when creative is disconnected and clears deleted vision profiles", async () => {
  const { root, connections, id } = await setup();
  try {
    await connections.selectVision({ connectionId: id, model: "detector" });
    await connections.disconnect();
    const restored = new ModelConnections(root, process.cwd(), async () => {}, () => {});
    try {
      await restored.restore();
      expect(restored.provider.status().configured).toBe(false);
      expect(restored.visionProvider.status().configured).toBe(true);
      await restored.remove(id);
      expect(restored.store.snapshot().vision).toBeNull();
      expect(restored.visionProvider.status().configured).toBe(false);
    } finally { await restored.dispose(); }
  } finally { await connections.dispose(); }
});

it("reads legacy files with no implicit vision selection and rejects missing profile references", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-legacy-role-")); roots.push(root);
  await writeFile(path.join(root, "connections.json"), JSON.stringify({ version: 1, selected: null, profiles: [] }));
  const store = new ConnectionStore(root); await store.load();
  expect(store.snapshot().vision).toBeNull();
  await expect(store.selectVision({ connectionId: crypto.randomUUID(), model: "detector" })).rejects.toThrow();
  expect(store.snapshot().vision).toBeNull();
});

it("preserves shared-key throttling across roles while allowing a separate key its own request lane", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })));
  const { connections, id } = await setup();
  try {
    await connections.save({ ...profile, id, apiKey: "sk-cp-shared-fixture" });
    await connections.selectVision({ connectionId: id, model: "detector" });
    vi.useFakeTimers();
    const signal = new AbortController().signal;
    const creative = connections.provider.test(signal);
    const visual = connections.visionProvider.test(signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([creative, visual]);
    expect(request.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).model)).toEqual(["creative", "detector"]);
    vi.useRealTimers();
    await connections.save({ ...profile, name: "separate", apiKey: "sk-cp-separate-fixture" });
    const separateId = connections.store.snapshot().profiles.find((p) => p.name === "separate")!.id;
    await connections.selectVision({ connectionId: separateId, model: "separate-detector" });
    vi.useFakeTimers();
    const held = connections.provider.test(signal);
    const independent = connections.visionProvider.test(signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(request.mock.calls[2][1]!.body)).model).toBe("separate-detector");
    await vi.runAllTimersAsync(); await Promise.all([held, independent]);
  } finally { vi.useRealTimers(); await connections.dispose(); }
});

it("does not change either active provider when vision persistence fails and serializes mutations", async () => {
  const { connections, id } = await setup();
  try {
    let reject!: (reason: Error) => void;
    vi.spyOn(connections.store, "selectVision").mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    const selecting = connections.selectVision({ connectionId: id, model: "detector" });
    const failure = expect(selecting).rejects.toThrow("disk-full");
    await expect(connections.selectModel({ connectionId: id, model: "other" })).rejects.toThrow();
    reject(new Error("disk-full")); await failure;
    expect(connections.visionProvider.status().configured).toBe(false);
    expect(connections.provider.status().model).toBe("creative");
  } finally { await connections.dispose(); }
});

it("keeps a visual ChatGPT selection separate from an API creative connection and does not fall back when it cannot be restored", async () => {
  const { root, connections, id } = await setup();
  try {
    const assertModel = vi.spyOn(connections.chatgpt, "assertModel").mockImplementation(() => undefined);
    await connections.selectVision({ connectionId: "chatgpt", model: "vision-detector", reasoningEffort: "high" });
    expect(assertModel).toHaveBeenCalledWith("vision-detector", "high");
    expect(connections.provider.status()).toMatchObject({ configured: true, source: "api", model: "creative" });
    expect(connections.visionProvider.status()).toMatchObject({ configured: true, source: "chatgpt", model: "vision-detector", reasoningEffort: "high" });

    const restored = new ModelConnections(root, process.cwd(), async () => {}, () => {});
    try {
      await restored.restore();
      expect(restored.provider.status()).toMatchObject({ configured: true, source: "api", model: "creative" });
      expect(restored.visionProvider.status().configured).toBe(false);
      expect(restored.store.snapshot().vision).toEqual({ connectionId: "chatgpt", model: "vision-detector", reasoningEffort: "high" });
    } finally { await restored.dispose(); }

    await connections.dispose();
    (connections as unknown as { activateVision(): void }).activateVision();
    expect(connections.visionProvider.status().configured).toBe(false);
  } finally { await connections.dispose(); }
});
