import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ConnectionPanel } from "../src/renderer/ConnectionPanel";
import { DEFAULT_QWEN_CONNECTION } from "../src/shared/connections";

const noop = () => {};
const props = {
  connection: { configured: false, baseUrl: "", model: "" }, library: { selected: null, profiles: [] }, busy: false,
  onSave: async () => true, onSelect: async () => true, onRemove: async () => true, onImport: async () => true,
  onTest: noop, onDisconnect: noop, onContinue: noop, onLogin: noop, onRefreshLogin: noop, onCancelLogin: noop,
};
describe("default team connection form", () => {
  it("opens the API form with team Qwen defaults and an empty required Key for a new installation", () => {
    const html = renderToStaticMarkup(createElement(ConnectionPanel, props));
    expect(html).toContain(DEFAULT_QWEN_CONNECTION.baseUrl);
    expect(html).toContain(DEFAULT_QWEN_CONNECTION.model);
    expect(html).toMatch(/type="password"[^>]*required=""[^>]*value=""/);
    expect(html).not.toContain("local-jainji");
  });
  it("preserves a saved ChatGPT selection instead of showing a new API form", () => {
    const html = renderToStaticMarkup(createElement(ConnectionPanel, { ...props, library: { selected: "chatgpt", profiles: [] } }));
    expect(html).not.toContain('type="password"');
    expect(html).toContain("使用 ChatGPT 登录");
  });
});
