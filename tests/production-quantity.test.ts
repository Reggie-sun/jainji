import { describe, expect, it } from "vitest";
import { AgentStartSchema, calculateProductionQuantity } from "../src/shared/agent";

describe("requested video count", () => {
  it.each([
    [3, 10, 4, 12], [3, 9, 3, 9], [5, 2, 1, 5], [1, 10, 10, 10], [3, 100, 34, 102],
    [1, 250, 250, 250], [29, 232, 8, 232], [29, 250, 9, 261],
  ])("rounds %i sources and %i requested videos up to complete source sets", (sources, requested, multiplier, total) => {
    expect(calculateProductionQuantity(sources, requested)).toEqual({ multiplier, total });
  });

  it.each([0, -1, 1.5, NaN, Infinity])("does not resolve an invalid requested count %s", (requested) => {
    expect(calculateProductionQuantity(3, requested)).toBeUndefined();
  });

  it("cannot produce videos without sources", () => {
    expect(calculateProductionQuantity(0, 10)).toBeUndefined();
  });
  it("accepts 250 source videos and rejects 251", () => {
    const input = { ruleId: "clean", brief: "", outputDirectory: "/tmp/outputs", decorations: { productPrice: "19.90" }, mediaIds: Array.from({ length: 250 }, () => crypto.randomUUID()) };
    expect(AgentStartSchema.safeParse(input).success).toBe(true);
    input.mediaIds.push(crypto.randomUUID());
    expect(AgentStartSchema.safeParse(input).success).toBe(false);
  });
});
