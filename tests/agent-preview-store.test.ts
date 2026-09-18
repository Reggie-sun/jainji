import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgentPreviewStore } from "../src/main/agent-preview-store";
import type { AgentRun } from "../src/shared/agent";

it("serves only an accepted preview from the matching current run and removes it on clear", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-agent-preview-test-"));
  const file = path.join(directory, "accepted.mp4");
  await writeFile(file, "preview");
  const runId = crypto.randomUUID(), itemId = crypto.randomUUID();
  const store = new AgentPreviewStore();
  store.retainDirectory(directory);
  const previewUrl = store.register(runId, itemId, file);
  const run = { id: runId, projectId: crypto.randomUUID(), ruleId: "clean", status: "finished", items: [
    { id: itemId, mediaId: crypto.randomUUID(), version: 1, name: "sample", status: "exporting", previewUrl },
  ] } as AgentRun;

  expect(previewUrl).toBe(`jianji-agent-preview://${runId}/${itemId}`);
  expect(previewUrl).not.toContain(file);
  await expect(store.resolve(run, runId, itemId)).resolves.toBe(file);
  await expect(store.resolve(run, crypto.randomUUID(), itemId)).rejects.toThrow("不存在");
  await expect(store.resolve({ ...run, items: [{ ...run.items[0], previewUrl: "jianji-agent-preview://wrong/value" }] }, runId, itemId)).rejects.toThrow("不存在");

  await store.clear();
  await expect(access(directory)).rejects.toThrow();
  await expect(store.resolve(run, runId, itemId)).rejects.toThrow("不存在");
});

it("rejects files outside directories created for accepted previews", () => {
  const store = new AgentPreviewStore();
  expect(() => store.register(crypto.randomUUID(), crypto.randomUUID(), "/tmp/unowned-preview.mp4")).toThrow("不属于");
});

it("removes unregistered and superseded preview directories when a run settles", async () => {
  const acceptedDirectory = await mkdtemp(path.join(tmpdir(), "jianji-agent-preview-accepted-"));
  const staleDirectory = await mkdtemp(path.join(tmpdir(), "jianji-agent-preview-stale-"));
  const accepted = path.join(acceptedDirectory, "accepted.mp4");
  await writeFile(accepted, "preview");
  const store = new AgentPreviewStore();
  store.retainDirectory(acceptedDirectory);
  store.retainDirectory(staleDirectory);
  store.register(crypto.randomUUID(), crypto.randomUUID(), accepted);

  await store.prune();

  await expect(access(acceptedDirectory)).resolves.toBeUndefined();
  await expect(access(staleDirectory)).rejects.toThrow();
  await store.clear();
});
