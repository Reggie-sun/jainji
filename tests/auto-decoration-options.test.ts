import { expect, it } from "vitest";
import { DecorationSchema } from "../src/shared/decorations";

it("uses one automatic mode for price appearance and stickers without changing the manual draft", () => {
  const draft = { mode: "manual", productPrice: "19.9元30贴", priceStyle: "comic", sticker: "heart" };
  expect(DecorationSchema.parse({ ...draft, mode: "agent" })).toMatchObject({ mode: "agent", productPrice: "19.9元30贴", priceStyle: undefined, sticker: "template" });
  expect(DecorationSchema.parse(draft)).toMatchObject({ mode: "manual", productPrice: "19.9元30贴", priceStyle: "comic", sticker: "heart" });
});

it("ignores unfinished manual settings only in Agent mode", () => {
  const manual = { sticker: "missing", fontFamily: "unavailable", corners: { "bottom-right": { type: "text", text: "", fontFamily: "unavailable" } } };
  expect(() => DecorationSchema.parse(manual)).toThrow();
  expect(DecorationSchema.parse({ ...manual, mode: "agent" })).toMatchObject({ mode: "agent", sticker: "template", corners: undefined });
  expect(() => DecorationSchema.parse({ mode: "agent", unknown: true })).toThrow();
  expect(() => DecorationSchema.parse({ mode: "unknown" })).toThrow();
});
