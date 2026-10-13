import { describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { QianchuanExtensionCatalog, signQianchuanRequest } from "../src/main/qianchuan-extension-catalog";

const snapshot = { tabId: 1, documentId: randomUUID(), account: { advertiserId: "9007199254740993", name: "当前账户" }, gfversion: "dev" };
describe("extension account catalog", () => {
  it("signs the exact ordered GET params using the observed qc protocol", () => {
    const params = { page: 1, limit: 100, keyword: "", aavid: snapshot.account.advertiserId, gfversion: "dev" };
    const expected = createHash("md5").update(`abcdefghX&Y${JSON.stringify(params).replace(/"/g, "")}M#NGETM#N/ad/api/v1/account/user-listM#N123X&Yabcdefgh`.toUpperCase()).digest("hex");
    expect(signQianchuanRequest("/ad/api/v1/account/user-list", params, 123, "abcdefgh")).toEqual({ "qc-date": "123", "qc-key": "abcdefgh", "qc-auth": expected });
  });
  it("reads a complete catalog and confirms current API identity before returning", async () => {
    const call = vi.fn(async (op: any) => op.kind === "identity" ? snapshot : op.path.endsWith("info") ? { kind: "user-info", accountInfo: { advId: snapshot.account.advertiserId, advName: snapshot.account.name } } : { kind: "user-list", accounts: [{ advertiserId: snapshot.account.advertiserId, name: snapshot.account.name }, { advertiserId: "22", name: "另一个账户" }], totalPages: 1, totalCount: 2, currentPage: 1 });
    const reader = new QianchuanExtensionCatalog(call);
    expect(await reader.accounts(snapshot, new AbortController().signal)).toEqual({ current: snapshot.account, accounts: [snapshot.account, { advertiserId: "22", name: "另一个账户" }] });
    expect(call.mock.calls.filter(([op]) => op.path?.endsWith("info"))).toHaveLength(2);
  });
  it.each(["drift", "duplicate", "incomplete", "unsafe", "different-navigation-id"])("rejects %s directory evidence", async mode => {
    let page = 0;
    const call = vi.fn(async (op: any) => {
      if (op.kind === "identity") return snapshot;
      if (op.path.endsWith("info")) return { kind: "user-info", accountInfo: { advId: snapshot.account.advertiserId, advName: snapshot.account.name } };
      page++;
      return { kind: "user-list", accounts: [{ advertiserId: mode === "unsafe" ? 9007199254740992 : page === 1 || mode === "duplicate" ? snapshot.account.advertiserId : "22", name: page === 1 ? snapshot.account.name : "另一个账户", ...(mode === "different-navigation-id" ? { advid: "33" } : {}) }], totalPages: mode === "drift" && page === 2 ? 3 : 2, totalCount: mode === "incomplete" ? 3 : 2, currentPage: page };
    });
    await expect(new QianchuanExtensionCatalog(call).accounts(snapshot, new AbortController().signal)).rejects.toThrow();
  });
  it("checks fresh guard immediately before a single navigation, never retries unknown results", async () => {
    const guard = vi.fn();
    const call = vi.fn(async (op: any) => {
      if (op.kind === "identity") return snapshot;
      if (op.kind === "switch") throw new Error("UNAVAILABLE");
      if (op.path.endsWith("info")) return { kind: "user-info", accountInfo: { advId: snapshot.account.advertiserId, advName: snapshot.account.name } };
      return { kind: "user-list", accounts: [{ advertiserId: snapshot.account.advertiserId, name: snapshot.account.name }, { advertiserId: "22", name: "另一个账户" }], totalPages: 1, totalCount: 2, currentPage: 1 };
    });
    await expect(new QianchuanExtensionCatalog(call).switch(snapshot, "22", new AbortController().signal, guard)).rejects.toThrow();
    expect(call.mock.calls.filter(([op]) => op.kind === "switch")).toHaveLength(1);
    expect(guard).toHaveBeenCalled();
  });
});
