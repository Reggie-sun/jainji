import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAccountConfig, readAccountConfig, accountPageUrl, assertSelectedPage, openAccountPage } from "../scripts/qianchuan-account-config.mjs";

const template = () => ({ version: 1, accounts: ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"].map((product, i) => ({ product, cdpEndpoint: `http://127.0.0.1:${9222 + i}`, advertiserId: "", adId: "" })) });
const ready = () => ({ ...template().accounts[0], advertiserId: "1876024170199244", adId: "1876036593854788" });
const page = () => ({ origin: "https://qianchuan.jinritemai.com", path: "/uni-prom", advertiserId: ready().advertiserId, adId: ready().adId, visibleAccount: true, visiblePlan: true, accountClosed: false });

test("reads edited files afresh and preserves large IDs as strings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jianji-qianchuan-config-test-"));
  try {
    const path = join(directory, "accounts.json");
    const value = template();
    await writeFile(path, JSON.stringify(value));
    assert.equal((await readAccountConfig(path))[0].advertiserId, "");
    value.accounts[0] = ready();
    await writeFile(path, JSON.stringify(value));
    assert.equal((await readAccountConfig(path))[0].advertiserId, ready().advertiserId);
    await writeFile(path, "{broken");
    await assert.rejects(readAccountConfig(path), SyntaxError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("incomplete mappings cannot open a guessed account or plan", () => {
  const rows = parseAccountConfig(template());
  assert.equal(rows.length, 6);
  assert.throws(() => accountPageUrl(rows[0]), /先填写/);
  assert.equal(accountPageUrl(ready()), "https://qianchuan.jinritemai.com/uni-prom?aavid=1876024170199244&adId=1876036593854788");
});

test("rejects ambiguous products, duplicate accounts and invalid or remote CDP endpoints", () => {
  for (const mutate of [
    c => { c.extra = true; },
    c => { c.accounts[0].url = "https://example.com"; },
    c => { c.version = 2; },
    c => { c.accounts.pop(); },
    c => { c.accounts[1].product = "蝴蝶贴"; },
    c => { c.accounts[0].advertiserId = 1876024170199244; },
    c => { c.accounts[0].advertiserId = "123&adId=456"; },
    c => { c.accounts[0].adId = "123"; },
    c => { c.accounts[0].advertiserId = "123"; c.accounts[1].advertiserId = "123"; },
    c => { c.accounts[0].cdpEndpoint = c.accounts[1].cdpEndpoint; },
    c => { c.accounts[0].cdpEndpoint = "http://example.com:9222"; },
    c => { c.accounts[0].cdpEndpoint = "http://127.0.0.1:9222/?redirect=x"; },
    c => { c.accounts[0].cdpEndpoint = "http://127.0.0.1:0"; },
    c => { c.accounts[0].cdpEndpoint = "http://127.0.0.1:65536"; },
  ]) {
    const value = template(); mutate(value);
    assert.throws(() => parseAccountConfig(value));
  }
});

test("URL IDs alone cannot prove identity: visible account and plan must match", () => {
  assert.doesNotThrow(() => assertSelectedPage(page(), ready()));
  for (const overrides of [{ advertiserId: "999" }, { adId: "999" }, { visibleAccount: false }, { visiblePlan: false }, { accountClosed: true }, { path: "/login" }, { origin: "https://example.com" }]) {
    assert.throws(() => assertSelectedPage({ ...page(), ...overrides }, ready()), /页面未确认/);
  }
});

test("opens a new tab in a private session without touching drafts or submitting", async () => {
  const calls = [];
  const result = await openAccountPage(ready(), async (binary, args) => {
    calls.push({ binary, args });
    return { stdout: args[0] === "evaluate_script" ? "```json\n" + JSON.stringify(page()) + "\n```" : "OK", stderr: "" };
  });
  assert.equal(result.submitted, false);
  assert.deepEqual(calls.map(c => c.args[0]), ["start", "new_page", "evaluate_script"]);
  assert.ok(calls[0].args.includes(ready().cdpEndpoint));
  assert.equal(new Set(calls.map(c => c.args.at(-1))).size, 1);
});

test("stops on CLI text errors even when the command exit was zero", async () => {
  let calls = 0;
  await assert.rejects(openAccountPage(ready(), async () => {
    calls += 1; return { stdout: "Could not connect to Chrome", stderr: "" };
  }), /CDP 操作失败/);
  assert.equal(calls, 1);
});
