import { expect, it } from "vitest";
import { DecorationSchema } from "../src/shared/decorations";

it("ignores unfinished manual settings only in Agent mode", () => {
  const manual = { sticker: "missing", fontFamily: "unavailable", corners: { "bottom-right": { type: "text", text: "", fontFamily: "unavailable" } } };
  expect(() => DecorationSchema.parse(manual)).toThrow();
  expect(DecorationSchema.parse({ ...manual, mode: "agent" })).toMatchObject({ mode: "agent", sticker: "template", corners: undefined });
  expect(() => DecorationSchema.parse({ mode: "agent", unknown: true })).toThrow();
  expect(() => DecorationSchema.parse({ mode: "unknown" })).toThrow();
});
