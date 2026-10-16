import { z } from "zod";
import { QianchuanProductSchema, qianchuanAccountName, type QianchuanAccountSummary, type QianchuanProduct } from "./qianchuan-account.js";
import { QIANCHUAN_QUERY_METRICS } from "./qianchuan-backend.js";
import { reportCsvCell } from "./qianchuan-report-export.js";
import { QianchuanReportSnapshotSchema, type QianchuanReportSnapshot } from "./qianchuan-report.js";
import type { QianguanjiaAccountDirectory } from "./qianguanjia.js";

const ACCOUNT_ID = /^[1-9][0-9]{0,19}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const accountIdSchema = z.string().regex(ACCOUNT_ID);
const targetSchema = z.object({
  key: z.string().min(1).max(64),
  product: QianchuanProductSchema,
  advertiserId: accountIdSchema,
  name: z.string().min(1).max(255),
  available: z.boolean(),
  supplierListed: z.boolean().optional(),
  blockedReason: z.string().max(255).optional(),
}).strict();
const statuses = ["pending", "reading", "complete", "failed", "cancelled", "missing", "blocked"] as const;

export interface AccountReportTarget {
  key: string;
  product: QianchuanProduct;
  advertiserId: string;
  name: string;
  available: boolean;
  supplierListed: boolean | undefined;
  blockedReason?: string;
}

export type AccountReportSnapshot = Extract<QianchuanReportSnapshot, { kind: "report" }>;

export interface AccountReportRow {
  target: AccountReportTarget;
  status: typeof statuses[number];
  snapshot?: AccountReportSnapshot;
  note?: string;
}

function accountKey(product: QianchuanProduct, advertiserId: string): string {
  return `${product}:${advertiserId}`;
}

function validatedTarget(raw: AccountReportTarget): AccountReportTarget {
  const target = targetSchema.parse(raw);
  if (target.key !== accountKey(target.product, target.advertiserId)) throw new Error("跨账户报表账户键与已保存账户身份不一致。");
  return { ...target, supplierListed: target.supplierListed };
}

function exactAccountId(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID.test(value);
}

/** Project every saved, exact advertiser identity; the supplier directory only annotates coverage. */
export function qianguanjiaReportTargets(
  accounts: QianchuanAccountSummary[],
  directory?: QianguanjiaAccountDirectory,
): AccountReportTarget[] {
  if (!Array.isArray(accounts)) throw new Error("千川账户配置无效。");
  const configured = accounts.flatMap(raw => {
    if (!raw || typeof raw !== "object") throw new Error("千川账户配置无效。");
    const product = QianchuanProductSchema.parse(raw.product);
    if (typeof raw.advertiserId !== "string") throw new Error(`${product} 账户 ID 无效。`);
    if (raw.advertiserId === "") return [];
    if (!exactAccountId(raw.advertiserId)) throw new Error(`${product} 账户 ID 无效。`);
    if (typeof raw.available !== "boolean") throw new Error(`${product} 账户可用状态无效。`);
    const target: AccountReportTarget = {
      key: accountKey(product, raw.advertiserId),
      product,
      advertiserId: raw.advertiserId,
      name: qianchuanAccountName(raw),
      available: raw.available,
      supplierListed: undefined,
      ...(!raw.available ? { blockedReason: "该千川账户配置当前不可用。" } : {}),
    };
    return [targetSchema.parse(target)];
  });

  const slots = new Set<QianchuanProduct>();
  const advertiserIds = new Set<string>();
  for (const target of configured) {
    if (slots.has(target.product) || advertiserIds.has(target.advertiserId)) {
      throw new Error("已保存千川账户存在重复产品槽位或广告账户 ID，未生成跨账户目标。");
    }
    slots.add(target.product);
    advertiserIds.add(target.advertiserId);
  }

  let listed = new Set<string>();
  if (directory !== undefined) {
    if (!directory || directory.source !== "qianguanjia" || !Array.isArray(directory.accounts)) throw new Error("千管家账户目录无效。");
    listed = new Set(directory.accounts.flatMap(account => exactAccountId(account?.advertiserId) ? [account.advertiserId] : []));
  }
  return configured.map(target => ({
    ...target,
    supplierListed: directory === undefined ? undefined : listed.has(target.advertiserId),
  }));
}

function validDate(value: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("跨账户报表日期无效。");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("跨账户报表日期无效。");
  return time;
}

interface RequestedWindow { startDate: string; endDate: string; startTime: string; }

function requestedWindow(startDate: string, endDate: string): RequestedWindow {
  const start = validDate(startDate), end = validDate(endDate);
  const days = (end - start) / DAY_MS;
  if (days < 0 || days >= 31) throw new Error("查询起止日期须按顺序，范围最多 31 天。");
  return { startDate, endDate, startTime: `${startDate} 00:00:00` };
}

function expectedEndTime(asOf: string, window: RequestedWindow): string | undefined {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) throw new Error("账户报表截止时间无效。");
  const beijing = new Date(timestamp + BEIJING_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
  const asOfDay = beijing.slice(0, 10);
  if (asOfDay < window.endDate) return undefined;
  const endTime = [`${window.endDate} 23:59:59`, beijing].sort()[0]!;
  return endTime >= window.startTime ? endTime : undefined;
}

function accountIdentityMatches(snapshot: QianchuanReportSnapshot, target: AccountReportTarget): boolean {
  return snapshot.product === target.product && snapshot.advertiserId === target.advertiserId;
}

function hasRequestedWindow(snapshot: AccountReportSnapshot, window: RequestedWindow): boolean {
  const endTime = expectedEndTime(snapshot.asOf, window);
  return endTime !== undefined && snapshot.startTime === window.startTime && snapshot.endTime === endTime;
}

/** Parse and validate one complete report against its saved account slot and exact requested range. */
export function validateAccountReport(
  raw: unknown,
  targetInput: AccountReportTarget,
  startDate: string,
  endDate: string,
): AccountReportSnapshot {
  const target = validatedTarget(targetInput);
  const window = requestedWindow(startDate, endDate);
  const snapshot = QianchuanReportSnapshotSchema.parse(raw);
  if (snapshot.kind !== "report") throw new Error("跨账户账户报表不能使用素材快照。");
  if (!accountIdentityMatches(snapshot, target)) throw new Error("账户报表与所选千川账户身份不一致。");
  if (!hasRequestedWindow(snapshot, window)) throw new Error("账户报表与所选日期范围不一致或只覆盖部分统计日。");
  return snapshot;
}

/** Strictly parse the entire saved history, then choose the newest exact-window account report. */
export function latestAccountReport(
  raw: unknown[],
  targetInput: AccountReportTarget,
  startDate: string,
  endDate: string,
): AccountReportSnapshot | undefined {
  const target = validatedTarget(targetInput);
  const window = requestedWindow(startDate, endDate);
  if (!Array.isArray(raw)) throw new Error("千川账户报表历史无效。");
  const history = raw.map(value => QianchuanReportSnapshotSchema.parse(value));
  for (const snapshot of history) {
    if (!accountIdentityMatches(snapshot, target)) throw new Error("千川历史快照包含其他账户或产品槽位，已停止读取。");
  }
  let latest: AccountReportSnapshot | undefined;
  for (const snapshot of history) {
    if (snapshot.kind !== "report" || !hasRequestedWindow(snapshot, window)) continue;
    if (!latest || Date.parse(snapshot.capturedAt) > Date.parse(latest.capturedAt)) latest = snapshot;
  }
  return latest;
}

function csvRow(values: string[]): string {
  return values.map(reportCsvCell).join(",");
}

/** Export one row per selected account; absent results have blank metric cells, never synthetic zeros. */
export function exportQianguanjiaAccountReportsCsv(
  rows: AccountReportRow[],
  startDate: string,
  endDate: string,
): string {
  requestedWindow(startDate, endDate);
  if (!Array.isArray(rows)) throw new Error("跨账户报表导出行无效。");
  const identities = new Set<string>();
  const productSlots = new Set<QianchuanProduct>();
  const advertiserIds = new Set<string>();
  const snapshotIds = new Set<string>();
  const metricColumns = QIANCHUAN_QUERY_METRICS.flatMap(metric => [
    `${metric}_raw`, `${metric}_display`, `${metric}_unit`, `${metric}_definition`,
  ]);
  const header = ["account_key", "product_slot", "advertiser_id", "status", "snapshot_id", "source",
    "start_time_beijing", "end_time_beijing", "as_of", "captured_at", ...metricColumns];
  const output = [csvRow(header)];

  for (const row of rows) {
    if (!row || typeof row !== "object" || !statuses.includes(row.status)) throw new Error("跨账户报表状态无效。");
    const target = validatedTarget(row.target);
    if (identities.has(target.key) || productSlots.has(target.product) || advertiserIds.has(target.advertiserId)) {
      throw new Error("跨账户报表包含重复产品槽位或账户身份。");
    }
    identities.add(target.key);
    productSlots.add(target.product);
    advertiserIds.add(target.advertiserId);

    if ((row.status === "complete") !== (row.snapshot !== undefined)) {
      throw new Error("跨账户报表完成状态与快照不匹配。");
    }
    let snapshot: AccountReportSnapshot | undefined;
    if (row.snapshot !== undefined) {
      snapshot = validateAccountReport(row.snapshot, target, startDate, endDate);
      if (snapshotIds.has(snapshot.id)) throw new Error("跨账户报表复用了重复快照 ID。");
      snapshotIds.add(snapshot.id);
    }
    const values = [target.key, target.product, target.advertiserId, row.status,
      snapshot?.id ?? "", snapshot?.source ?? "", snapshot?.startTime ?? "", snapshot?.endTime ?? "",
      snapshot?.asOf ?? "", snapshot?.capturedAt ?? ""];
    if (snapshot) {
      for (const metric of QIANCHUAN_QUERY_METRICS) {
        const cell = snapshot.metrics[metric], provenance = snapshot.metricProvenance[metric];
        values.push(cell.value, cell.display, provenance.unit, provenance.definition);
      }
    } else {
      values.push(...Array(metricColumns.length).fill(""));
    }
    output.push(csvRow(values));
  }
  return `\uFEFF${output.join("\r\n")}\r\n`;
}
