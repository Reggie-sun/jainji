import { describe, expect, it } from "vitest";
import { AppendProductionSchema } from "../src/shared/agent";

describe("AppendProductionSchema", () => {
  const valid = { batchId: crypto.randomUUID(), count: 2, productPrice: "19.9元拍一发三", outputDirectory: "/tmp/out" };
  it("accepts a valid append request", () => {
    expect(AppendProductionSchema.parse(valid)).toEqual(valid);
  });
  it.each([
    ["non-uuid batchId", { ...valid, batchId: "not-a-uuid" }],
    ["count 0", { ...valid, count: 0 }],
    ["count above 250", { ...valid, count: 251 }],
    ["fractional count", { ...valid, count: 1.5 }],
    ["blank display text", { ...valid, productPrice: "" }],
    ["line over 12 chars", { ...valid, productPrice: "一二三四五六七八九十一二三" }],
    ["three lines", { ...valid, productPrice: "一\n二\n三" }],
    ["blank middle line", { ...valid, productPrice: "一\n \n二" }],
    ["empty output directory", { ...valid, outputDirectory: "" }],
    ["unexpected key", { ...valid, extra: true }],
  ])("rejects %s", (_label, input) => {
    expect(AppendProductionSchema.safeParse(input).success).toBe(false);
  });
});
