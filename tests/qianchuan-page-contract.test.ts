import { expect, it } from "vitest";
import { QianchuanPageSession, parseSelectedCount, PRODUCTION_QIANCHUAN_CONTRACT, qianchuanReadiness } from "../src/main/qianchuan-page-contract";
import type { Page } from "playwright-core";
import type { UploadTaskRecord } from "../src/main/douyin-upload-store";

it("only admits explicit selected/capacity observations, not arbitrary count text", () => {
  expect(parseSelectedCount("已选择 2/10")).toEqual({ selected: 2, capacity: 10 });
  expect(parseSelectedCount(" 已选择 0 / 250 ")).toEqual({ selected: 0, capacity: 250 });
  expect(parseSelectedCount("已选择 1/64：")).toEqual({ selected: 1, capacity: 64 });
  for (const value of ["2", "已选择 2/1", "已选择 0/0", "已选择 -1/3", "已选择 1/3 上传完成", "已选择 1/64：上传完成", "已选择 1/99999999999999999999"]) expect(() => parseSelectedCount(value)).toThrow();
});
it("uses the finite production page contract without claiming live acceptance", () => {
  expect(PRODUCTION_QIANCHUAN_CONTRACT).toBeDefined();
  expect(qianchuanReadiness()).toBeUndefined();
});
it("builds the exact production account URL from frozen account fields without leaking the config digest", () => {
  const session = new QianchuanPageSession({} as Page, PRODUCTION_QIANCHUAN_CONTRACT, () => undefined);
  const task = {
    authorization: { target: { product: "眼贴", cdpEndpoint: "http://127.0.0.1:9222", advertiserId: "123456", adId: "987654", configDigest: "d".repeat(64) } },
  } as UploadTaskRecord;
  expect(session.url(task)).toBe("https://qianchuan.jinritemai.com/uni-prom?aavid=123456&adId=987654");
});
