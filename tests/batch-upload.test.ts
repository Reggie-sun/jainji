import { describe, expect, it } from "vitest";
import { resolveBatchUploadAccount } from "../src/shared/batch-upload";
import type { QianchuanAccountSummary } from "../src/shared/qianchuan-account";

const accounts: QianchuanAccountSummary[] = [
  { product: "蝴蝶贴", advertiserId: "123", adId: "456", available: true },
  { product: "眼贴", productName: "晚安油", advertiserId: "789", adId: "987", available: true },
];
describe("automatic batch upload account binding", () => {
  it("matches the exact saved display name and returns the stable slot", () => {
    expect(resolveBatchUploadAccount(" 蝴蝶贴 ", accounts)).toEqual({ accountProduct: "蝴蝶贴" });
    expect(resolveBatchUploadAccount("晚安油", accounts)).toEqual({ accountProduct: "眼贴" });
  });
  it.each(["眼贴", "晚安", "晚安油模板", "", "  "])("never guesses or uses a renamed slot as fallback: %s", name => {
    expect(resolveBatchUploadAccount(name, accounts)).toEqual({ error: "未找到同名千川商品账号，请在账号设置中核对商品名称，或关闭本项上传。" });
  });
  it("rejects unavailable and ambiguous matching accounts instead of selecting another", () => {
    expect(resolveBatchUploadAccount("晚安油", accounts.map(a => ({ ...a, available: false })))).toEqual({ error: "对应千川商品账号配置不可用，请先保存有效计划链接，或关闭本项上传。" });
    expect(resolveBatchUploadAccount("晚安油", [...accounts, { ...accounts[0], productName: "晚安油" }])).toEqual({ error: "同名千川商品账号不唯一，请在账号设置中区分商品名称，或关闭本项上传。" });
    expect(resolveBatchUploadAccount("蝴蝶贴", [])).toHaveProperty("error");
  });
});
