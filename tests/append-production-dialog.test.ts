import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AppendProductionDialog } from "../src/renderer/AppendProductionDialog";
import type { PublicExportBatch } from "../src/main/application";

const batch = { id: crypto.randomUUID(), status: "completed", mediaIds: [crypto.randomUUID()], outputDirectory: "/tmp/out", createdAt: new Date().toISOString(), tasks: [] } as unknown as PublicExportBatch;

it("prefills the frozen display text and defaults to one append without the randomization note", () => {
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "19.9元拍一发三", mediaCount: 1 }, mediaLabel: "a.mp4", onClose: () => {} }));
  expect(html).toContain("追加制作");
  expect(html).toContain("19.9元拍一发三");
  expect(html).not.toContain("随机搭配不同贴纸和滤镜");
});

it("explains that multiple appends randomize stickers and filters", () => {
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "19.9元拍一发三", mediaCount: 1 }, mediaLabel: "a.mp4", initialCount: 2, onClose: () => {} }));
  expect(html).toContain("随机搭配不同贴纸和滤镜");
});

// Regression: ISSUE-001 — a frozen text-off batch could not submit the append form.
// Found by /qa on 2026-10-05.
// Report: .agent/harness/runs/20261005-qa/qa-report.md
it("allows a text-off source to append without a text editor or required-text error", () => {
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "", mediaCount: 1, displayTextEnabled: false }, mediaLabel: "a.mp4", onClose: () => {} }));
  expect(html).toContain("源批次已关闭展示文字");
  expect(html).not.toContain('id="append-price"');
  expect(html).not.toContain('role="alert"');
  expect(html).toMatch(/<button[^>]*class="button primary"(?![^>]*disabled)[^>]*>追加 1 条并开始渲染/);
});

it("still requires manual text for legacy prefill without a display switch", () => {
  const html = renderToStaticMarkup(createElement(AppendProductionDialog, { batch, prefill: { productPrice: "", mediaCount: 1 }, mediaLabel: "a.mp4", onClose: () => {} }));
  expect(html).toContain('id="append-price"');
  expect(html).toMatch(/<button[^>]*class="button primary"[^>]*disabled/);
});
