import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  EditTemplateSchema,
  now,
  type Color,
  type EditTemplate,
  type TextLayer,
} from "./domain.js";
import { CORNER_SAFE_POLICY } from "../shared/layout-policy.js";

export const LayoutAgentInputSchema = z.object({
  style: z.enum(["black-gold", "clean"]),
  title: z.string().trim().min(1).max(12),
  price: z.string().trim().min(1).max(12),
}).strict();
export type LayoutAgentInput = z.infer<typeof LayoutAgentInputSchema>;

function textLayer(input: {
  content: string;
  x: number;
  y: number;
  width: number;
  fontSizeRatio: number;
  color: Color;
  strokeColor: Color;
  backgroundColor: Color;
  zIndex: number;
}): TextLayer {
  return {
    id: randomUUID(), type: "text", content: input.content, fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    fontSizeRatio: input.fontSizeRatio, color: input.color, strokeColor: input.strokeColor, strokeWidthRatio: 0.001,
    backgroundColor: input.backgroundColor, backgroundPaddingRatio: 0.006,
    x: input.x, y: input.y, width: input.width, opacity: 1, zIndex: input.zIndex, visible: true,
  };
}

export function runLayoutAgent(templateInput: EditTemplate, rawInput: LayoutAgentInput): EditTemplate {
  const template = EditTemplateSchema.parse(templateInput);
  const input = LayoutAgentInputSchema.parse(rawInput);
  const blackGold = input.style === "black-gold";
  const title = textLayer({
    content: input.title, x: 0.025, y: 0.022, width: blackGold ? 0.38 : 0.28, fontSizeRatio: blackGold ? 0.026 : 0.024,
    color: blackGold ? { r: 255, g: 255, b: 255, a: 1 } : { r: 24, g: 33, b: 43, a: 1 },
    strokeColor: blackGold ? { r: 0, g: 0, b: 0, a: 0.55 } : { r: 255, g: 255, b: 255, a: 0 },
    backgroundColor: blackGold ? { r: 0, g: 0, b: 0, a: 0.55 } : { r: 255, g: 255, b: 255, a: 0.82 },
    zIndex: 1,
  });
  const price = textLayer({
    content: input.price, x: 0.7, y: 0.022, width: 0.275, fontSizeRatio: 0.026,
    color: { r: 255, g: 255, b: 255, a: 1 }, strokeColor: { r: 143, g: 21, b: 21, a: 0.9 },
    backgroundColor: { r: 232, g: 62, b: 62, a: 0.92 }, zIndex: 2,
  });
  return EditTemplateSchema.parse({
    ...template,
    layoutPolicy: CORNER_SAFE_POLICY.id,
    layers: [title, price],
    filter: blackGold ? { presetId: "warm", intensity: 0.35 } : { presetId: "vivid", intensity: 0.2 },
    updatedAt: now(),
  });
}
