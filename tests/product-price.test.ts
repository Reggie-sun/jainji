import { expect, it, vi } from "vitest";
import { AgentStartSchema } from "../src/shared/agent";
import { AgentController } from "../src/main/agent-controller";
import type { ApplicationService } from "../src/main/application";
import type { ExportQueue } from "../src/main/queue";
import type { FfmpegAdapter } from "../src/main/ffmpeg";
import type { StickerAssets } from "../src/main/builtin-stickers";

const input = { ruleId: "clean" as const, brief: "价格由 Agent 猜测", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp/output" };

it.each([undefined, {}, { productPrice: "" }, { productPrice: "   " }, { mode: "agent" }, { mode: "agent", productPrice: "" }])("rejects production without a manually entered price: %j", async (decorations) => {
  expect(AgentStartSchema.safeParse({ ...input, decorations }).success).toBe(false);
  const controller = new AgentController({} as ApplicationService, { snapshot: () => ({ batches: [] }) } as unknown as ExportQueue, {} as FfmpegAdapter, () => {}, {} as StickerAssets);
  controller.provider.configure({ apiKey: "fixture", model: "fixture", baseUrl: "https://example.test/v1" });
  const plan = vi.spyOn(controller.provider, "plan");
  await expect(controller.start({ ...input, decorations } as Parameters<typeof controller.start>[0], new Set())).rejects.toThrow("请手动填写产品价格");
  expect(plan).not.toHaveBeenCalled();
  expect(controller.busy).toBe(false);
});

it.each(["manual", "agent"])("preserves the entered price in %s mode", (mode) => {
  expect(AgentStartSchema.parse({ ...input, decorations: { mode, productPrice: "19.90" } }).decorations?.productPrice).toBe("19.90");
});
