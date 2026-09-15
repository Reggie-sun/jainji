import { expect, it, vi } from "vitest";
import { AgentStartSchema } from "../src/shared/agent";
import { formatProductPrice, RequiredProductPriceSchema } from "../src/shared/decorations";
import { AgentController } from "../src/main/agent-controller";
import type { ApplicationService } from "../src/main/application";
import type { ExportQueue } from "../src/main/queue";
import type { FfmpegAdapter } from "../src/main/ffmpeg";
import type { StickerAssets } from "../src/main/builtin-stickers";

const input = { ruleId: "clean" as const, brief: "价格由 Agent 猜测", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp/output" };

it.each(["manual", "agent"])("preserves two manual price lines in %s mode", (mode) => {
  const productPrice = "9.9元到手5卷\n19.9元拍一发三";
  expect(AgentStartSchema.parse({ ...input, decorations: { mode, productPrice } }).decorations?.productPrice).toBe(productPrice);
  expect(formatProductPrice(productPrice)).toBe(productPrice);
  expect(formatProductPrice("9.9\n19.9元拍一发三")).toBe("¥ 9.9\n19.9元拍一发三");
  expect(formatProductPrice(productPrice.replace("\n", "\r\n"))).toBe(productPrice);
});

it.each(["9元\n19元\n29元", "9元\n \n19元", "9元\n\n19元", "一二三四五六七八九十一二三", "9元\u0000贴"])("rejects malformed multiline offers: %s", (price) => {
  expect(RequiredProductPriceSchema.safeParse(price).success).toBe(false);
});

it.each(["19.9元30贴", "29.90元50片", "9元1盒", "19.90", "19.9元"])("accepts manually entered price and quantity: %s", (productPrice) => {
  expect(AgentStartSchema.parse({ ...input, decorations: { productPrice } }).decorations?.productPrice).toBe(productPrice);
});

it.each(["19.9元30贴产品名", "19.9元面膜", "19.999元30贴", "19元0贴", "19元30", "19元30贴\n买一送一"])("accepts user-authored text without amount grammar: %s", (price) => {
  expect(RequiredProductPriceSchema.parse(price)).toBe(price);
});

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

it.each(["19.9元\n到手30贴", "春日新品\n拍一发三", "手工棉柔巾", "折扣 50%", "%{n}", "19.999"])("preserves arbitrary manual text: %s", (productPrice) => {
  for (const mode of ["manual", "agent"]) {
    expect(AgentStartSchema.parse({ ...input, decorations: { mode, productPrice } }).decorations?.productPrice).toBe(productPrice);
  }
  expect(formatProductPrice(productPrice)).toBe(productPrice);
});
