import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { QianchuanDeliveryAuthorizationSchema, QianchuanDeliveryAuditStateSchema, QianchuanDeliveryDraftSchema, deliveryBudgetIncrease, minorUnitsMoney, moneyMinorUnits, safeEvidenceReference, type QianchuanDeliveryAuthorization, type QianchuanDeliveryDraft, type QianchuanDeliveryAuditState } from "../shared/qianchuan-delivery.js";
import { secureUploadDirectory, strictSyncDirectory } from "./douyin-upload-store.js";

const processSessionId = randomUUID();
const uuid = z.string().uuid();
const platformId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const timestamp = z.string().datetime();
const version = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/);
const qualificationSchema = z.object({
  evidenceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  recipeDigest: z.string().regex(/^[a-f0-9]{64}$/), configDigest: z.string().regex(/^[a-f0-9]{64}$/),
  senderId: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const recordSchema = z.object({
  operationId: uuid,
  sessionId: uuid,
  draft: QianchuanDeliveryDraftSchema,
  authorization: QianchuanDeliveryAuthorizationSchema,
  state: QianchuanDeliveryAuditStateSchema,
  budgetIncrease: z.string().regex(/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/),
  createdAt: timestamp,
  updatedAt: timestamp,
  submissionStartedAt: timestamp.optional(),
  reason: z.enum(["STOPPED", "PRE_SUBMIT_FAILURE", "PLATFORM_REJECTED", "SUBMIT_OUTCOME_UNKNOWN", "READBACK_MISMATCH"]).optional(),
  evidenceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).optional(),
  providerRequestId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).optional(),
  afterVersion: z.string().min(1).max(128).optional(),
  readbackDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  adId: platformId.optional(),
  qualification: qualificationSchema.optional(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), records: z.array(recordSchema) }).strict().superRefine((value, context) => {
  const operations = new Set<string>(), authorizations = new Map<string, string>();
  for (const [index, record] of value.records.entries()) {
    if (operations.has(record.operationId)) context.addIssue({ code: "custom", path: ["records", index, "operationId"], message: "duplicate operation" });
    operations.add(record.operationId);
    const parsedDraft = QianchuanDeliveryDraftSchema.safeParse(record.draft);
    const parsedAuth = QianchuanDeliveryAuthorizationSchema.safeParse(record.authorization);
    if (!parsedDraft.success || !parsedAuth.success || parsedAuth.data.draftId !== parsedDraft.data.draftId ||
      parsedAuth.data.draftDigest !== draftDigest(parsedDraft.data) || parsedAuth.data.sessionId !== record.sessionId ||
      record.budgetIncrease !== minorUnitsMoney(deliveryBudgetIncrease(parsedDraft.data))) {
      context.addIssue({ code: "custom", path: ["records", index], message: "draft authorization mismatch" });
    }
    const authorization = authorizations.get(record.authorization.authorizationId), current = JSON.stringify(record.authorization);
    if (authorization && authorization !== current) context.addIssue({ code: "custom", path: ["records", index, "authorization"], message: "authorization ID reused" });
    authorizations.set(record.authorization.authorizationId, current);
    if (record.state === "PENDING" && record.reason) context.addIssue({ code: "custom", path: ["records", index, "reason"], message: "pending intent has a result reason" });
    if (record.state === "NOT_SENT" && !["STOPPED", "PRE_SUBMIT_FAILURE"].includes(record.reason ?? "")) context.addIssue({ code: "custom", path: ["records", index, "reason"], message: "not-sent intent must have a pre-submit reason" });
    if (record.state === "REJECTED" && (record.reason !== "PLATFORM_REJECTED" || !record.evidenceId)) context.addIssue({ code: "custom", path: ["records", index], message: "rejection evidence missing" });
    if (record.state === "CONFIRMED" && (!record.afterVersion || !record.readbackDigest || record.reason || record.draft.action === "create-plan" && !record.adId)) context.addIssue({ code: "custom", path: ["records", index], message: "confirmation readback missing" });
    if (record.state === "UNKNOWN" && !["SUBMIT_OUTCOME_UNKNOWN", "READBACK_MISMATCH"].includes(record.reason ?? "")) context.addIssue({ code: "custom", path: ["records", index, "reason"], message: "unknown reason missing" });
    if (record.state !== "REJECTED" && record.evidenceId) context.addIssue({ code: "custom", path: ["records", index, "evidenceId"], message: "unexpected evidence reference" });
    if (record.state !== "CONFIRMED" && (record.afterVersion || record.readbackDigest)) context.addIssue({ code: "custom", path: ["records", index], message: "unexpected readback" });
    if (!["REJECTED", "CONFIRMED", "UNKNOWN"].includes(record.state) && record.providerRequestId) context.addIssue({ code: "custom", path: ["records", index, "providerRequestId"], message: "unexpected provider request reference" });
    if (record.adId && (record.draft.action !== "create-plan" || !["PENDING", "UNKNOWN", "CONFIRMED"].includes(record.state))) context.addIssue({ code: "custom", path: ["records", index, "adId"], message: "unexpected created plan identity" });
    if (record.qualification && (!(["set-budget", "set-roi", "pause", "enable"] as const).includes(record.draft.action as "set-budget" | "set-roi" | "pause" | "enable") || record.authorization.maxActions !== 1)) {
      context.addIssue({ code: "custom", path: ["records", index, "qualification"], message: "invalid first qualification intent" });
    }
  }
});

type LedgerState = z.infer<typeof stateSchema>;
type DeliveryRecord = LedgerState["records"][number];
export type QianchuanDeliveryAuditEntry = Readonly<DeliveryRecord>;
export type QianchuanDeliverySettlement =
  | { state: "NOT_SENT"; reason: "STOPPED" | "PRE_SUBMIT_FAILURE" }
  | { state: "REJECTED"; reason: "PLATFORM_REJECTED"; evidenceId: string; providerRequestId?: string }
  | { state: "UNKNOWN"; reason: "SUBMIT_OUTCOME_UNKNOWN" | "READBACK_MISMATCH"; providerRequestId?: string }
  | { state: "CONFIRMED"; afterVersion: string; readbackDigest: string; providerRequestId?: string; adId?: string };
export type QianchuanDeliveryQualificationProvenance = z.infer<typeof qualificationSchema>;
export interface QianchuanDeliveryReservationOptions { qualification?: QianchuanDeliveryQualificationProvenance; }

export class QianchuanDeliveryStoreError extends Error {
  constructor(readonly code: "STORE_UNAVAILABLE" | "ADVERTISER_HAS_UNKNOWN" | "BUDGET_LIMIT" | "ACTION_LIMIT" | "AUTHORIZATION_INVALID" | "AUTHORIZATION_EXPIRED" | "OPERATION_STATE_INVALID") {
    super("Qianchuan delivery ledger unavailable or operation blocked");
    this.name = "QianchuanDeliveryStoreError";
  }
}

const emptyState = (): LedgerState => ({ version: 1, records: [] });
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sorted(child)]));
};

export function draftDigest(value: QianchuanDeliveryDraft): string {
  const parsed = QianchuanDeliveryDraftSchema.parse(value);
  return createHash("sha256").update(JSON.stringify(sorted(parsed))).digest("hex");
}

function stateCountsAsAction(value: DeliveryRecord): boolean { return value.state !== "NOT_SENT"; }
function stateRetainsBudget(value: DeliveryRecord): boolean { return value.state === "PENDING" || value.state === "UNKNOWN" || value.state === "CONFIRMED"; }
function setReasonState(record: DeliveryRecord, settlement: QianchuanDeliverySettlement): DeliveryRecord {
  const base = { ...record, state: settlement.state, updatedAt: new Date().toISOString(), reason: undefined, evidenceId: undefined,
    providerRequestId: "providerRequestId" in settlement && safeEvidenceReference(settlement.providerRequestId) ? settlement.providerRequestId : undefined,
    afterVersion: undefined, readbackDigest: undefined, adId: record.adId };
  if (settlement.state === "NOT_SENT" || settlement.state === "REJECTED" || settlement.state === "UNKNOWN") {
    return { ...base, reason: settlement.reason, ...(settlement.state === "REJECTED" ? { evidenceId: settlement.evidenceId } : {}) };
  }
  return { ...base, afterVersion: settlement.afterVersion, readbackDigest: settlement.readbackDigest,
    ...(settlement.adId ? { adId: settlement.adId } : {}) };
}

export class QianchuanDeliveryStore {
  private loaded = false;
  private initializing?: Promise<void>;
  private unavailable = false;
  readonly root: string;
  constructor(root: string, private readonly syncDirectory: (directory: string) => Promise<void> = strictSyncDirectory, private readonly currentSessionId = processSessionId) { this.root = path.resolve(root); }
  get sessionId(): string { return this.currentSessionId; }
  get statePath(): string { return path.join(this.root, "state.json"); }
  private get lockPath(): string { return path.join(this.root, "ledger.lock"); }

  initialize(): Promise<void> {
    this.initializing ??= this.initializeOnce();
    return this.initializing;
  }

  private async initializeOnce(): Promise<void> {
    if (this.loaded) return;
    if (this.unavailable) throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    try {
      const parent = path.dirname(this.root);
      if (!(await lstat(parent)).isDirectory()) throw new Error("Missing ledger parent directory");
      await secureUploadDirectory(this.root);
      await this.syncDirectory(parent);
      const state = await this.locked(true, async current => {
        let next = current;
        if (!next) { next = emptyState(); await this.write(next); }
        let changed = false;
        const records = next.records.map(record => {
          if (record.state !== "PENDING" || record.sessionId === this.currentSessionId) return record;
          changed = true;
          return { ...record, state: "UNKNOWN" as const, reason: "SUBMIT_OUTCOME_UNKNOWN" as const, updatedAt: new Date().toISOString() };
        });
        if (changed) { next = stateSchema.parse({ ...next, records }); await this.write(next); }
        return next;
      });
      stateSchema.parse(state);
      this.loaded = true;
    } catch {
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    }
  }

  async list(advertiserId: string): Promise<QianchuanDeliveryAuditEntry[]> {
    this.assertReady();
    try {
      const state = await this.read(false);
      if (!state) throw new Error("missing ledger");
      return state.records.filter(record => record.draft.advertiserId === advertiserId).map(record => structuredClone(record));
    } catch {
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    }
  }

  async hasUnresolved(advertiserId: string): Promise<boolean> {
    this.assertReady();
    try {
      const state = await this.read(false);
      if (!state) throw new Error("missing ledger");
      return state.records.some(record => record.draft.advertiserId === advertiserId && (record.state === "PENDING" || record.state === "UNKNOWN"));
    } catch {
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    }
  }

  async reserve(value: QianchuanDeliveryDraft, suppliedAuthorization: QianchuanDeliveryAuthorization, options?: QianchuanDeliveryReservationOptions): Promise<string> {
    this.assertReady();
    const draft = QianchuanDeliveryDraftSchema.parse(value), authorization = QianchuanDeliveryAuthorizationSchema.parse(suppliedAuthorization);
    const qualification = options?.qualification === undefined ? undefined : qualificationSchema.parse(options.qualification);
    if (options && Object.keys(options).some(key => key !== "qualification")) throw new QianchuanDeliveryStoreError("AUTHORIZATION_INVALID");
    if (qualification && (!(["set-budget", "set-roi", "pause", "enable"] as const).includes(draft.action as "set-budget" | "set-roi" | "pause" | "enable") || authorization.maxActions !== 1)) {
      throw new QianchuanDeliveryStoreError("AUTHORIZATION_INVALID");
    }
    this.validateAuthorization(draft, authorization);
    const operationId = randomUUID(), budgetIncrease = deliveryBudgetIncrease(draft), now = new Date().toISOString();
    try {
      await this.locked(false, async current => {
        const state = current!;
        if (state.records.some(record => record.draft.advertiserId === draft.advertiserId && (record.state === "PENDING" || record.state === "UNKNOWN"))) {
          throw new QianchuanDeliveryStoreError("ADVERTISER_HAS_UNKNOWN");
        }
        if (state.records.some(record => record.draft.draftId === draft.draftId && stateCountsAsAction(record))) {
          throw new QianchuanDeliveryStoreError("ACTION_LIMIT");
        }
        if (Date.parse(authorization.expiresAt) <= Date.now()) throw new QianchuanDeliveryStoreError("AUTHORIZATION_EXPIRED");
        const previous = state.records.filter(record => record.authorization.authorizationId === authorization.authorizationId);
        if ((qualification || previous.some(record => record.qualification)) && previous.length > 0) throw new QianchuanDeliveryStoreError("ACTION_LIMIT");
        if (previous.some(record => record.authorization.draftDigest !== authorization.draftDigest || JSON.stringify(record.authorization) !== JSON.stringify(authorization))) {
          throw new QianchuanDeliveryStoreError("AUTHORIZATION_INVALID");
        }
        if (previous.filter(stateCountsAsAction).length >= authorization.maxActions) throw new QianchuanDeliveryStoreError("ACTION_LIMIT");
        const reserved = previous.filter(stateRetainsBudget).reduce((total, record) => total + moneyMinorUnits(record.budgetIncrease), 0n);
        if (reserved + budgetIncrease > moneyMinorUnits(authorization.totalBudgetIncrease)) throw new QianchuanDeliveryStoreError("BUDGET_LIMIT");
        const next = stateSchema.parse({ ...state, records: [...state.records, {
          operationId, sessionId: this.currentSessionId, draft, authorization, state: "PENDING", budgetIncrease: minorUnitsMoney(budgetIncrease),
          createdAt: now, updatedAt: now,
          ...(qualification ? { qualification } : {}),
        }] });
        await this.write(next);
      });
      return operationId;
    } catch (error) {
      if (error instanceof QianchuanDeliveryStoreError && error.code !== "STORE_UNAVAILABLE") throw error;
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    }
  }

  async markSubmitStarted(operationId: string, submittedAt = new Date().toISOString()): Promise<void> {
    this.assertReady();
    try {
      await this.locked(false, async current => {
        const state = current!, index = state.records.findIndex(record => record.operationId === operationId);
        if (index < 0 || state.records[index]!.state !== "PENDING" || state.records[index]!.sessionId !== this.currentSessionId || state.records[index]!.submissionStartedAt) {
          throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        }
        const records = state.records.slice(); records[index] = { ...records[index]!, submissionStartedAt: timestamp.parse(submittedAt), updatedAt: timestamp.parse(submittedAt) };
        await this.write(stateSchema.parse({ ...state, records }));
      });
    } catch {
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    }
  }

  async recordCreatedPlan(operationId: string, adId: string): Promise<void> {
    this.assertReady();
    try {
      const identity = platformId.parse(adId);
      await this.locked(false, async current => {
        const state = current!, index = state.records.findIndex(record => record.operationId === operationId), record = state.records[index];
        if (!record || record.state !== "PENDING" || record.sessionId !== this.currentSessionId || record.draft.action !== "create-plan" ||
          !record.submissionStartedAt || record.adId && record.adId !== identity) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        const records = state.records.slice(); records[index] = { ...record, adId: identity, updatedAt: new Date().toISOString() };
        await this.write(stateSchema.parse({ ...state, records }));
      });
    } catch { this.unavailable = true; throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE"); }
  }

  async settle(operationId: string, settlement: QianchuanDeliverySettlement): Promise<void> {
    this.assertReady();
    try {
      await this.locked(false, async current => {
        const state = current!, index = state.records.findIndex(record => record.operationId === operationId);
        if (index < 0 || state.records[index]!.state !== "PENDING" || state.records[index]!.sessionId !== this.currentSessionId) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        const record = state.records[index]!;
        if (record.adId && (settlement.state === "NOT_SENT" || settlement.state === "REJECTED" || settlement.state === "CONFIRMED" && settlement.adId !== record.adId)) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        if (settlement.state !== "NOT_SENT" && !record.submissionStartedAt) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        if (settlement.state === "REJECTED" && !safeEvidenceReference(settlement.evidenceId)) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        if (settlement.state === "CONFIRMED" && (!/^[a-f0-9]{64}$/.test(settlement.readbackDigest) || !version.safeParse(settlement.afterVersion).success)) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        if ("providerRequestId" in settlement && settlement.providerRequestId !== undefined && !safeEvidenceReference(settlement.providerRequestId)) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        if (settlement.state === "CONFIRMED" && settlement.adId !== undefined && !platformId.safeParse(settlement.adId).success) throw new QianchuanDeliveryStoreError("OPERATION_STATE_INVALID");
        const records = state.records.slice(); records[index] = recordSchema.parse(setReasonState(record, settlement));
        await this.write(stateSchema.parse({ ...state, records }));
      });
    } catch {
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    }
  }

  private validateAuthorization(draft: QianchuanDeliveryDraft, authorization: QianchuanDeliveryAuthorization): void {
    if (authorization.sessionId !== this.currentSessionId || authorization.draftId !== draft.draftId || authorization.draftDigest !== draftDigest(draft)) {
      throw new QianchuanDeliveryStoreError("AUTHORIZATION_INVALID");
    }
    if (Date.parse(authorization.issuedAt) > Date.now() || Date.parse(authorization.expiresAt) <= Date.now()) throw new QianchuanDeliveryStoreError("AUTHORIZATION_EXPIRED");
    const target = draft.action === "create-plan" || draft.action === "set-budget" ? moneyMinorUnits(draft.target.budget) : undefined;
    if (target !== undefined && target > moneyMinorUnits(authorization.maxTargetBudget)) throw new QianchuanDeliveryStoreError("BUDGET_LIMIT");
  }

  private assertReady(): void {
    if (!this.loaded || this.unavailable) throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
  }

  private async locked<T>(allowMissing: boolean, work: (state: LedgerState | undefined) => Promise<T>): Promise<T> {
    const handle = await open(this.lockPath, "wx", 0o600).catch(() => {
      this.unavailable = true;
      throw new QianchuanDeliveryStoreError("STORE_UNAVAILABLE");
    });
    let result!: T, failure: unknown;
    try {
      await handle.sync(); await this.syncDirectory(this.root);
      const state = await this.read(allowMissing);
      result = await work(state);
    } catch (error) { failure = error; }
    try {
      await handle.close(); await unlink(this.lockPath); await this.syncDirectory(this.root);
    } catch (error) { this.unavailable = true; if (!failure) failure = error; }
    if (failure) throw failure;
    return result;
  }

  private async read(allowMissing: boolean): Promise<LedgerState | undefined> {
    try {
      const before = await lstat(this.statePath);
      if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o7177) !== 0 || before.uid !== process.getuid?.() || before.size > 4 * 1024 * 1024 || await realpath(this.statePath) !== this.statePath) throw new Error("unsafe record");
      const handle = await open(this.statePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat();
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.mode !== before.mode || opened.uid !== before.uid) throw new Error("changed record");
        const bytes = await handle.readFile(), after = await handle.stat(), current = await lstat(this.statePath);
        if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.mode !== before.mode || after.uid !== before.uid || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size || current.mode !== before.mode || current.uid !== before.uid || current.isSymbolicLink() || await realpath(this.statePath) !== this.statePath) throw new Error("changed record");
        return stateSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) return undefined;
      throw error;
    }
  }

  private async write(state: LedgerState): Promise<void> {
    const value = stateSchema.parse(state), temporary = `${this.statePath}.tmp-${randomUUID()}`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, this.statePath); await this.syncDirectory(this.root);
    } catch (error) {
      await handle?.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); throw error;
    }
  }
}
