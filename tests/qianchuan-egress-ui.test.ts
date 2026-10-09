import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QianchuanEgressSettings } from "../src/renderer/QianchuanEgressSettings";
it("shows only non-secret egress setup, group reuse and the no-direct-fallback boundary", () => {
  const value = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
  const html = renderToStaticMarkup(createElement(QianchuanEgressSettings, { value, onChange: () => {}, accounts: [{ egress: value }], busy: true }));
  expect(html).toContain("复用已设置的主体");
  expect(html).toContain("不会改为直连");
  expect(html).toContain("fieldset disabled");
  expect(html).not.toContain('type="password"');
  expect(html).toContain("视频上传也会消耗 VPS 流量");
});
