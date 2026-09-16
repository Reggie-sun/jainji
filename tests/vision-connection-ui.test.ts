import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VisionConnectionPanel } from "../src/renderer/VisionConnectionPanel";
import type { ChatGPTStatus } from "../src/shared/agent";

const chatgpt: ChatGPTStatus = {
  status: "ready", message: "旧创作模型失效，请重新选择。",
  models: [{ model: "valid-detector", displayName: "Detector", supportedReasoningEfforts: [] }],
};

it("allows independent visual model selection when the old creative ChatGPT model is unavailable", () => {
  const html = renderToStaticMarkup(createElement(VisionConnectionPanel, {
    chatgpt, library: { selected: null, profiles: [], vision: null }, disabled: false, onSelect: async () => true,
  }));
  expect(html).toContain('<option value="chatgpt">ChatGPT 登录</option>');
  expect(html).not.toContain("尚未就绪");
});

it("does not present a creative-model warning as a failure of a valid visual connection", () => {
  const html = renderToStaticMarkup(createElement(VisionConnectionPanel, {
    chatgpt, connection: { configured: true, source: "chatgpt", model: "valid-detector", baseUrl: "" },
    library: { selected: null, profiles: [], vision: { connectionId: "chatgpt", model: "valid-detector" } }, disabled: false, onSelect: async () => true,
  }));
  expect(html).toContain("valid-detector");
  expect(html).not.toContain("尚未就绪");
  expect(html).not.toContain("旧创作模型失效");
});
