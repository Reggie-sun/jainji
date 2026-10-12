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
it("makes all upload methods discoverable even before a VPS has been configured", () => {
  const html = renderToStaticMarkup(createElement(QianchuanEgressSettings, { value: null, onChange: () => {}, accounts: [], busy: false }));
  expect(html).toContain('aria-label="本机上传" checked=""');
  expect(html).toContain('aria-label="本机上传 · VPS 出口"');
  expect(html).toContain('aria-label="VPS 上传"');
  expect(html).not.toContain('aria-label="SSH 主机别名"');
  expect(html).not.toContain('浏览器运行位置');
});
it("interprets historical mode-less routes as local browsers and explicitly labels remote routes", () => {
  const route = { group: "主体一", sshHost: "shop-one", localPort: 19381, expectedIp: "203.0.113.11" };
  for (const mode of [undefined, "remote-browser"] as const) {
    const value = mode ? { ...route, mode } : route;
    const html = renderToStaticMarkup(createElement(QianchuanEgressSettings, { value, onChange: () => {}, accounts: [], busy: false }));
    expect(html).toContain(`aria-label="${mode ? "VPS 上传" : "本机上传 · VPS 出口"}" checked=""`);
    if (mode) { expect(html).toContain("本地简辑"); expect(html).toContain("首次登录或验证码"); }
  }
});
