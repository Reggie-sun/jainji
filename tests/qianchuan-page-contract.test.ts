import { expect, it } from "vitest";
import { parseSelectedCount, qianchuanReadiness } from "../src/main/qianchuan-page-contract";

it("only admits explicit selected/capacity observations, not arbitrary count text", () => {
  expect(parseSelectedCount("已选择 2/10")).toEqual({ selected: 2, capacity: 10 });
  expect(parseSelectedCount(" 已选择 0 / 250 ")).toEqual({ selected: 0, capacity: 250 });
  for (const value of ["2", "已选择 2/1", "已选择 0/0", "已选择 -1/3", "已选择 1/3 上传完成", "已选择 1/99999999999999999999"]) expect(() => parseSelectedCount(value)).toThrow();
});
it("keeps production readiness blocked until a finite page contract is qualified", () => {
  expect(qianchuanReadiness()).toContain("生产页面合同尚未核实");
});
