import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConnectionStore } from "../src/main/connection-store";
import { inspectAIConnectionPreparation } from "../src/main/source-fact-ai-connections";

const secret = "private-dummy-key-never-print-0123456789";
async function fixture(action: (root: string, owner: ConnectionStore) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "jianji-ai-connection-test-"));
  try {
    const owner = new ConnectionStore(path.join(root, "connections")); await owner.load();
    await action(root, owner);
  } finally { await rm(root, { recursive: true, force: true }); }
}
describe("AI preparation reuses application connections without provider execution", () => {
  it("discovers saved MiniMax Responses and role selections without changing private configuration", async () => {
    await fixture(async (root, owner) => {
      const id = await owner.save({ name: "minimax", model: "MiniMax-M3", baseUrl: "https://api.minimaxi.com/v1", protocol: "responses", apiKey: secret });
      await owner.select(id); await owner.selectVision({ connectionId: id, model: "MiniMax-M3" });
      await owner.selectReviewer({ connectionId: id, model: "MiniMax-M3" });
      const file = path.join(root, "connections/connections.json"), before = await readFile(file), mode = (await stat(file)).mode;
      const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("provider forbidden"));
      try {
        const result = await inspectAIConnectionPreparation(root);
        expect(result).toMatchObject({ status: "CONFIG_FOUND", qualificationStatus: "INCOMPLETE", authority: "none", eligible: false,
          apiConnections: [{ connectionId: id, provider: "minimax", model: "MiniMax-M3", protocol: "responses", credentialConfigured: true,
            endpoint: "https://api.minimaxi.com/v1", routeQualification: "NOT_EVALUATED" }],
          savedSelections: { selected: id, vision: { connectionId: id, model: "MiniMax-M3" }, reviewer: { connectionId: id, model: "MiniMax-M3" } } });
        expect(JSON.stringify(result)).not.toContain(secret); expect(fetch).not.toHaveBeenCalled();
        expect(await readFile(file)).toEqual(before); expect((await stat(file)).mode).toBe(mode);
      } finally { fetch.mockRestore(); }
    });
  });
  it("distinguishes an application ChatGPT model selection from an OpenAI API connection", async () => {
    await fixture(async (root, owner) => {
      await owner.saveChatGPTModel("gpt-5.4"); await owner.select("chatgpt");
      const result = await inspectAIConnectionPreparation(root);
      expect(result).toMatchObject({ status: "CONFIG_FOUND", apiConnections: [],
        chatgpt: { savedModel: "gpt-5.4", authentication: "NOT_EVALUATED", hardGenerationBound: "NOT_EVALUATED" }, qualificationStatus: "INCOMPLETE" });
      expect(await readdir(root)).toEqual(["connections"]);
    });
  });
  it("does not assume that a profile named GPT at a custom endpoint is an OpenAI route", async () => {
    await fixture(async (root, owner) => {
      await owner.save({ name: "GPT", model: "gpt-5.4", baseUrl: "https://gateway.example/v1", apiKey: secret });
      expect(await inspectAIConnectionPreparation(root)).toMatchObject({ apiConnections: [], qualificationStatus: "INCOMPLETE" });
    });
  });
  it("rejects sensitive metadata rather than reflecting a saved credential through a model name", async () => {
    await fixture(async (root, owner) => {
      await owner.save({ name: "minimax", model: secret, baseUrl: "https://api.minimaxi.com/v1", protocol: "responses", apiKey: secret });
      const result = await inspectAIConnectionPreparation(root);
      expect(result).toMatchObject({ status: "SENSITIVE_METADATA_REJECTED", apiConnections: [], qualificationStatus: "INCOMPLETE" });
      expect(JSON.stringify(result)).not.toContain(secret);
    });
  });
  it("rejects a credential containing JSON escapes reflected through another saved role", async () => {
    await fixture(async (root, owner) => {
      const escapedSecret = 'private-key-with-"quote"-and-\\slash';
      const id = await owner.save({ name: "custom", model: "other", baseUrl: "https://gateway.example/v1", apiKey: escapedSecret });
      await owner.selectVision({ connectionId: id, model: escapedSecret });
      const result = await inspectAIConnectionPreparation(root);
      expect(result).toMatchObject({ status: "SENSITIVE_METADATA_REJECTED", apiConnections: [] });
      expect(JSON.stringify(result)).not.toContain(JSON.stringify(escapedSecret).slice(1, -1));
    });
  });
  it("reports an official OpenAI API configuration without inferring ChatGPT authentication", async () => {
    await fixture(async (root, owner) => {
      const id = await owner.save({ name: "GPT", model: "gpt-5.4", baseUrl: "https://api.openai.com/v1", protocol: "responses", apiKey: secret });
      expect(await inspectAIConnectionPreparation(root)).toMatchObject({ apiConnections: [{ connectionId: id, provider: "openai", credentialConfigured: true,
        routeQualification: "NOT_EVALUATED" }], chatgpt: { savedModel: null, authentication: "NOT_EVALUATED" }, qualificationStatus: "INCOMPLETE" });
    });
  });
  it("reports missing configuration without creating application state", async () => {
    await fixture(async root => {
      expect(await inspectAIConnectionPreparation(root)).toMatchObject({ status: "CONFIG_MISSING", apiConnections: [], qualificationStatus: "INCOMPLETE" });
      expect(await readdir(root)).toEqual([]);
    });
  });
  it("preserves malformed private configuration and never prints its contents", async () => {
    await fixture(async root => {
      await mkdir(path.join(root, "connections")); const file = path.join(root, "connections/connections.json");
      await writeFile(file, secret, { mode: 0o600 });
      const result = await inspectAIConnectionPreparation(root);
      expect(result).toMatchObject({ status: "CONFIG_UNREADABLE", apiConnections: [], qualificationStatus: "INCOMPLETE" });
      expect(JSON.stringify(result)).not.toContain(secret); expect(await readFile(file, "utf8")).toBe(secret);
    });
  });
});
