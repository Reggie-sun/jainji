import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  actionReason, maxTargetBudget, moneyMinorUnits,
  QIANCHUAN_DELIVERY_ACTIONS, QianchuanDeliveryActionCapabilitySchema, QianchuanDeliveryAuthorizationSchema,
  QianchuanDeliveryCapabilityStatusSchema, QianchuanDeliveryDraftSchema, QianchuanDeliveryResultSchema,
  safeEvidenceReference, type QianchuanDeliveryActionCapability, type QianchuanDeliveryAuthorization,
  type QianchuanDeliveryDraft, type QianchuanDeliveryResult,
} from "../shared/qianchuan-delivery.js";
import { draftDigest, QianchuanDeliveryStore, QianchuanDeliveryStoreError, type QianchuanDeliverySettlement } from "./qianchuan-delivery-store.js";

const platformId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const version = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/);
const money = z.string().regex(/^(?:0|[1-9][0-9]{0,12})\.[0-9]{2}$/);
const roi = z.string().regex(/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/);
const safeId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const qualificationBindingSchema = z.object({
  evidenceId: safeId, recipeDigest: sha256, configDigest: sha256, senderId: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
const qualificationContextSchema = z.object({ configDigest: sha256, senderId: z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const recipeSchema = z.object({
  action: z.enum(QIANCHUAN_DELIVERY_ACTIONS), advertiserId: platformId, mode: z.literal("product-cost-control"),
  status: QianchuanDeliveryCapabilityStatusSchema, evidenceId: safeId.optional(), recipeDigest: sha256.optional(), observedAt: z.string().datetime().optional(),
}).strict();
const observationSchema = z.object({
  advertiserId: platformId, adId: platformId.optional(), productId: platformId.optional(), version,
  values: z.unknown().refine(value => typeof value === "object" && value !== null && !Array.isArray(value)),
}).strict();
const createAfterValues = z.object({ budget: money, budgetType: z.literal("daily"), roi, status: z.literal("paused"), materialIds: z.array(platformId).max(200) }).strict();
const bindAfterValues = z.object({ materialIds: z.array(platformId).max(500) }).strict();
const roiAfterValues = z.object({ roi }).strict();
const budgetAfterValues = z.object({ budget: money, budgetType: z.literal("daily") }).strict();
const statusAfterValues = z.object({ status: z.enum(["paused", "enabled"]) }).strict();
const submittedSchema = z.object({ kind: z.literal("submitted"), providerRequestId: safeId.optional(), adId: platformId.optional() }).strict();
const rejectedSchema = z.object({ kind: z.literal("rejected"), code: z.literal("PLATFORM_REJECTED"), evidenceId: safeId, providerRequestId: safeId.optional() }).strict();
const notSentSchema = z.object({ kind: z.literal("not-sent"), reason: z.literal("AUTHORIZATION_EXPIRED") }).strict();
const authorizationBoundsSchema = z.object({
  maxTargetBudget: money, totalBudgetIncrease: money, maxActions: z.number().finite().int().min(1).max(1000), expiresAt: z.string().datetime(),
}).strict();

export type QianchuanDeliveryRecipe = z.infer<typeof recipeSchema>;
export type QianchuanDeliveryObservation = z.infer<typeof observationSchema>;
export type QianchuanDeliverySubmission = z.infer<typeof submittedSchema>;
export type QualificationBinding = z.infer<typeof qualificationBindingSchema>;
export type QualificationExecutionContext = z.infer<typeof qualificationContextSchema>;
export interface QianchuanDeliverySubmissionContext { readonly expiresAt: string; }
export interface QianchuanDeliveryAdapter {
  capabilities(advertiserId: string, mode: "product-cost-control"): readonly unknown[];
  readFresh(draft: QianchuanDeliveryDraft, signal: AbortSignal): Promise<unknown>;
  submitOnce(draft: QianchuanDeliveryDraft, signal: AbortSignal, context: QianchuanDeliverySubmissionContext): Promise<unknown>;
  readback(draft: QianchuanDeliveryDraft, submission: QianchuanDeliverySubmission, signal: AbortSignal): Promise<unknown>;
}

export interface QianchuanDeliveryAuthorizationBounds {
  maxTargetBudget: string;
  totalBudgetIncrease: string;
  maxActions: number;
  expiresAt: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
}
function readbackDigest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function result(state: QianchuanDeliveryResult["state"], reason: QianchuanDeliveryResult["reason"], action?: QianchuanDeliveryDraft["action"], operationId?: string, adId?: string): QianchuanDeliveryResult {
  return QianchuanDeliveryResultSchema.parse({ state, reason, ...(action ? { action } : {}), ...(operationId ? { operationId } : {}), ...(adId ? { adId } : {}) });
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(stable(left)) === JSON.stringify(stable(right)); }
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { operation.catch(() => undefined); reject(signal.reason); return; }
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
function ids(values: readonly { materialId: string }[]): string[] { return values.map(value => value.materialId); }
function beforeMatches(draft: QianchuanDeliveryDraft, observation: z.infer<typeof observationSchema>): boolean {
  if (observation.advertiserId !== draft.advertiserId || observation.version !== draft.beforeVersion ||
    ("productId" in draft && observation.productId !== draft.productId) ||
    (draft.action === "create-plan" ? observation.adId !== undefined : observation.adId !== draft.adId)) return false;
  const parsed = QianchuanDeliveryDraftSchema.safeParse({ ...draft, beforeVersion: observation.version, beforeValues: observation.values });
  return parsed.success && same(parsed.data.beforeValues, draft.beforeValues);
}
function afterMatches(draft: QianchuanDeliveryDraft, observation: z.infer<typeof observationSchema>, submittedAdId?: string): boolean {
  if (observation.advertiserId !== draft.advertiserId || ("productId" in draft && observation.productId !== draft.productId)) return false;
  if (draft.action === "create-plan") {
    if (!submittedAdId || observation.adId !== submittedAdId) return false;
    const actual = createAfterValues.safeParse(observation.values);
    return actual.success && actual.data.budget === draft.target.budget && actual.data.budgetType === draft.target.budgetType &&
      actual.data.roi === draft.target.roi && actual.data.status === draft.target.status && same(actual.data.materialIds, ids(draft.target.materials));
  }
  if (observation.adId !== draft.adId) return false;
  if (draft.action === "bind-materials") {
    const actual = bindAfterValues.safeParse(observation.values);
    if (!actual.success) return false;
    const expected = [...draft.beforeValues.materialIds, ...ids(draft.target.materials)].sort();
    return same(actual.data.materialIds.slice().sort(), expected);
  }
  if (draft.action === "set-roi") { const actual = roiAfterValues.safeParse(observation.values); return actual.success && actual.data.roi === draft.target.roi; }
  if (draft.action === "set-budget") { const actual = budgetAfterValues.safeParse(observation.values); return actual.success && actual.data.budget === draft.target.budget && actual.data.budgetType === draft.target.budgetType; }
  const actual = statusAfterValues.safeParse(observation.values);
  return actual.success && actual.data.status === draft.target.status;
}
function storeFailure(error: unknown): QianchuanDeliveryResult["reason"] {
  if (!(error instanceof QianchuanDeliveryStoreError)) return "STORE_UNAVAILABLE";
  switch (error.code) {
    case "ADVERTISER_HAS_UNKNOWN": return "ADVERTISER_HAS_UNKNOWN";
    case "BUDGET_LIMIT": return "BUDGET_LIMIT";
    case "ACTION_LIMIT": return "ACTION_LIMIT";
    case "AUTHORIZATION_EXPIRED": return "AUTHORIZATION_EXPIRED";
    case "AUTHORIZATION_INVALID": return "INVALID_AUTHORIZATION";
    default: return "STORE_UNAVAILABLE";
  }
}

/** Main-process delivery boundary. No adapter means every write remains blocked. */
export class QianchuanDelivery {
  private stoppedValue = false;
  private readonly active = new Set<AbortController>();
  private readonly issuedAuthorizations = new Map<string, QianchuanDeliveryAuthorization>();
  private readonly qualificationAuthorizations = new Map<string, { binding: QualificationBinding; consumed: boolean }>();
  constructor(private readonly store: QianchuanDeliveryStore, private readonly adapter?: QianchuanDeliveryAdapter) {}

  get stopped(): boolean { return this.stoppedValue; }

  issueAuthorization(value: QianchuanDeliveryDraft, limits: QianchuanDeliveryAuthorizationBounds): QianchuanDeliveryAuthorization {
    if (this.stoppedValue) throw new Error("Delivery session stopped");
    const draft = QianchuanDeliveryDraftSchema.parse(value), bounds = authorizationBoundsSchema.parse(limits), now = new Date();
    if (Date.parse(bounds.expiresAt) <= now.getTime()) throw new Error("Authorization expiry must be in the future");
    const targetBudget = maxTargetBudget(draft);
    if (targetBudget !== undefined && targetBudget > moneyMinorUnits(bounds.maxTargetBudget)) throw new Error("Target budget exceeds authorization ceiling");
    const authorization = QianchuanDeliveryAuthorizationSchema.parse({
      authorizationId: randomUUID(), sessionId: this.store.sessionId, draftId: draft.draftId, draftDigest: draftDigest(draft),
      currency: "CNY", budgetType: "daily", maxTargetBudget: bounds.maxTargetBudget,
      totalBudgetIncrease: bounds.totalBudgetIncrease, maxActions: bounds.maxActions,
      issuedAt: now.toISOString(), expiresAt: bounds.expiresAt,
    });
    this.issuedAuthorizations.set(authorization.authorizationId, authorization);
    return structuredClone(authorization);
  }

  issueQualificationAuthorization(value: QianchuanDeliveryDraft, limits: QianchuanDeliveryAuthorizationBounds, bindingInput: QualificationBinding): QianchuanDeliveryAuthorization {
    if (this.stoppedValue) throw new Error("Delivery session stopped");
    const draft = QianchuanDeliveryDraftSchema.parse(value), bounds = authorizationBoundsSchema.parse(limits);
    const binding = qualificationBindingSchema.parse(bindingInput);
    if (bounds.maxActions !== 1 || !this.isQualificationAction(draft.action) || !this.hasQualificationRecipe(draft, binding)) {
      throw new Error("First qualification is not bound to one observed action recipe");
    }
    const authorization = this.issueAuthorization(draft, bounds);
    this.qualificationAuthorizations.set(authorization.authorizationId, { binding, consumed: false });
    return authorization;
  }

  private isQualificationAction(action: QianchuanDeliveryDraft["action"]): boolean {
    return action === "set-budget" || action === "set-roi" || action === "pause" || action === "enable";
  }

  private hasQualificationRecipe(draft: QianchuanDeliveryDraft, binding: QualificationBinding): boolean {
    if (!this.adapter) return false;
    let values: readonly unknown[];
    try { values = this.adapter.capabilities(draft.advertiserId, "product-cost-control"); }
    catch { return false; }
    if (!Array.isArray(values)) return false;
    const matches: QianchuanDeliveryRecipe[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const parsed = recipeSchema.safeParse(value);
      if (!parsed.success) return false;
      const recipe = parsed.data;
      if (recipe.advertiserId !== draft.advertiserId || recipe.mode !== "product-cost-control") continue;
      if (seen.has(recipe.action)) return false;
      seen.add(recipe.action);
      if (recipe.action === draft.action) matches.push(recipe);
    }
    const recipe = matches[0];
    return matches.length === 1 && recipe?.status === "live-read-verified" && recipe.evidenceId === binding.evidenceId &&
      recipe.recipeDigest === binding.recipeDigest && recipe.observedAt !== undefined;
  }

  capabilities(advertiserId: string): QianchuanDeliveryActionCapability[] {
    const validAdvertiser = platformId.safeParse(advertiserId).success;
    const defaults = QIANCHUAN_DELIVERY_ACTIONS.map(action => ({ action, status: validAdvertiser ? "not-investigated" as const : "unavailable" as const,
      reason: validAdvertiser ? actionReason("not-investigated") : "Invalid advertiser identity." }));
    if (!validAdvertiser || !this.adapter) return defaults.map(item => QianchuanDeliveryActionCapabilitySchema.parse(item));
    let values: readonly unknown[];
    try { values = this.adapter.capabilities(advertiserId, "product-cost-control"); }
    catch { return defaults.map(item => QianchuanDeliveryActionCapabilitySchema.parse({ ...item, status: "unavailable", reason: "Capability evidence is unavailable." })); }
    if (!Array.isArray(values)) return defaults.map(item => QianchuanDeliveryActionCapabilitySchema.parse({ ...item, status: "unavailable", reason: "Capability evidence is invalid." }));
    const recipes = new Map<string, QianchuanDeliveryRecipe>(), invalid = new Set<string>();
    for (const value of values) {
      const parsed = recipeSchema.safeParse(value);
      if (!parsed.success) return defaults.map(item => QianchuanDeliveryActionCapabilitySchema.parse({ ...item, status: "unavailable", reason: "Capability evidence is invalid." }));
      const recipe = parsed.data;
      if (recipe.advertiserId !== advertiserId || recipe.mode !== "product-cost-control") continue;
      if (recipes.has(recipe.action) || recipe.status === "live-write-verified" && (!recipe.evidenceId || !recipe.observedAt)) invalid.add(recipe.action);
      else recipes.set(recipe.action, recipe);
    }
    return defaults.map(item => {
      const recipe = recipes.get(item.action);
      if (invalid.has(item.action)) return QianchuanDeliveryActionCapabilitySchema.parse({ action: item.action, status: "unavailable", reason: "Capability evidence is duplicated or incomplete." });
      if (!recipe) return QianchuanDeliveryActionCapabilitySchema.parse(item);
      return QianchuanDeliveryActionCapabilitySchema.parse({ action: recipe.action, status: recipe.status,
        reason: actionReason(recipe.status), ...(recipe.evidenceId ? { evidenceId: recipe.evidenceId } : {}), ...(recipe.observedAt ? { observedAt: recipe.observedAt } : {}) });
    });
  }

  stop(): void {
    this.stoppedValue = true;
    for (const controller of this.active) controller.abort(new Error("Stopped"));
  }

  async execute(draftInput: unknown, authorizationInput: unknown, parentSignal?: AbortSignal, qualificationContextInput?: QualificationExecutionContext): Promise<QianchuanDeliveryResult> {
    const parsedDraft = QianchuanDeliveryDraftSchema.safeParse(draftInput);
    if (!parsedDraft.success) return result("NOT_SENT", "INVALID_DRAFT");
    const draft = parsedDraft.data, action = draft.action;
    const parsedAuthorization = QianchuanDeliveryAuthorizationSchema.safeParse(authorizationInput);
    if (!parsedAuthorization.success) return result("NOT_SENT", "INVALID_AUTHORIZATION", action);
    const authorization = parsedAuthorization.data, issued = this.issuedAuthorizations.get(authorization.authorizationId);
    if (!issued || !same(issued, authorization) || authorization.sessionId !== this.store.sessionId || authorization.draftId !== draft.draftId || authorization.draftDigest !== draftDigest(draft)) {
      return result("NOT_SENT", "INVALID_AUTHORIZATION", action);
    }
    const now = Date.now();
    if (Date.parse(authorization.issuedAt) > now || Date.parse(authorization.expiresAt) <= now) return result("NOT_SENT", "AUTHORIZATION_EXPIRED", action);
    if (this.stoppedValue) return result("NOT_SENT", "STOPPED", action);
    const qualification = this.qualificationAuthorizations.get(authorization.authorizationId);
    if (qualification) {
      const context = qualificationContextSchema.safeParse(qualificationContextInput);
      if (!context.success || context.data.configDigest !== qualification.binding.configDigest || context.data.senderId !== qualification.binding.senderId) {
        return result("NOT_SENT", "INVALID_AUTHORIZATION", action);
      }
      if (qualification.consumed) return result("NOT_SENT", "ACTION_LIMIT", action);
      qualification.consumed = true;
      if (!this.hasQualificationRecipe(draft, qualification.binding)) return result("NOT_SENT", "CAPABILITY_UNQUALIFIED", action);
    } else {
      const capability = this.capabilities(draft.advertiserId).find(item => item.action === action);
      if (!capability || capability.status !== "live-write-verified" || !capability.evidenceId || !capability.observedAt) return result("NOT_SENT", "CAPABILITY_UNQUALIFIED", action);
    }
    const target = maxTargetBudget(draft);
    if (target !== undefined && target > moneyMinorUnits(authorization.maxTargetBudget)) return result("NOT_SENT", "BUDGET_LIMIT", action);
    const controller = new AbortController(); this.active.add(controller);
    const signal = parentSignal ? AbortSignal.any([controller.signal, parentSignal]) : controller.signal;
    let operationId: string | undefined;
    let submissionInvoked = false, createdAdId: string | undefined;
    const pending = new Set<Promise<unknown>>();
    const tracked = <T>(operation: Promise<T>): Promise<T> => {
      pending.add(operation);
      void operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return abortable(operation, signal);
    };
    try {
      if (signal.aborted) return result("NOT_SENT", "STOPPED", action);
      if (await this.store.hasUnresolved(draft.advertiserId)) return result("NOT_SENT", "ADVERTISER_HAS_UNKNOWN", action);
      let beforeRaw: unknown;
      try { beforeRaw = await tracked(Promise.resolve().then(() => {
        if (signal.aborted || this.stoppedValue) throw new Error("Stopped");
        return this.adapter!.readFresh(draft, signal);
      })); }
      catch { return result("NOT_SENT", signal.aborted ? "STOPPED" : "READ_FAILED", action); }
      const before = observationSchema.safeParse(beforeRaw);
      if (!before.success || !beforeMatches(draft, before.data)) return result("NOT_SENT", "PRECONDITION_CHANGED", action);
      if (signal.aborted || this.stoppedValue) return result("NOT_SENT", "STOPPED", action);
      try { operationId = await this.store.reserve(draft, authorization, qualification ? { qualification: qualification.binding } : undefined); }
      catch (error) { return result("NOT_SENT", storeFailure(error), action); }
      if (signal.aborted || this.stoppedValue) {
        return await this.settleNotSent(operationId, action, "STOPPED");
      }
      try { await this.store.markSubmitStarted(operationId); }
      catch { return result("NOT_SENT", "STORE_UNAVAILABLE", action, operationId); }
      if (signal.aborted || this.stoppedValue) {
        return await this.settleNotSent(operationId, action, "STOPPED");
      }
      let rawSubmission: unknown;
      const submission = Promise.resolve().then(() => {
        if (signal.aborted || this.stoppedValue) throw new Error("Stopped");
        const sendingAt = Date.now();
        if (Date.parse(authorization.issuedAt) > sendingAt || Date.parse(authorization.expiresAt) <= sendingAt) throw new Error("Authorization expired before submission");
        submissionInvoked = true;
        return this.adapter!.submitOnce(draft, signal, { expiresAt: authorization.expiresAt });
      });
      try { rawSubmission = await tracked(submission); }
      catch {
        if (!submissionInvoked) return await this.settleNotSent(operationId, action, signal.aborted || this.stoppedValue ? "STOPPED" : "AUTHORIZATION_EXPIRED");
        let lateRequestId: string | undefined;
        if (action === "create-plan") {
          // Drain this same request. A late identity is a reference, never confirmation or permission to resend.
          const late = submittedSchema.safeParse(await submission.catch(() => undefined));
          if (late.success) lateRequestId = late.data.providerRequestId;
          if (late.success && late.data.adId) {
            createdAdId = late.data.adId;
            try { await this.store.recordCreatedPlan(operationId, createdAdId); }
            catch { return result("UNKNOWN", "STORE_UNAVAILABLE", action, operationId, createdAdId); }
          }
        }
        return await this.settleUnknown(operationId, "SUBMIT_OUTCOME_UNKNOWN", action, lateRequestId, createdAdId);
      }
      const notSent = notSentSchema.safeParse(rawSubmission);
      if (notSent.success) return await this.settleNotSent(operationId, action, notSent.data.reason);
      const rejected = rejectedSchema.safeParse(rawSubmission);
      if (rejected.success) {
        try {
          await this.store.settle(operationId, { state: "REJECTED", reason: "PLATFORM_REJECTED", evidenceId: rejected.data.evidenceId,
            ...(rejected.data.providerRequestId ? { providerRequestId: rejected.data.providerRequestId } : {}) });
          return result("REJECTED", "PLATFORM_REJECTED", action, operationId);
        } catch { return result("UNKNOWN", "STORE_UNAVAILABLE", action, operationId); }
      }
      const submitted = submittedSchema.safeParse(rawSubmission);
      if (!submitted.success || action === "create-plan" && !submitted.data.adId || action !== "create-plan" && submitted.data.adId && submitted.data.adId !== draft.adId) {
        return await this.settleUnknown(operationId, "SUBMIT_OUTCOME_UNKNOWN", action);
      }
      if (action === "create-plan") {
        createdAdId = submitted.data.adId;
        try { await this.store.recordCreatedPlan(operationId, createdAdId!); }
        catch { return result("UNKNOWN", "STORE_UNAVAILABLE", action, operationId, createdAdId); }
      }
      let afterRaw: unknown;
      try { afterRaw = await tracked(Promise.resolve().then(() => {
        if (signal.aborted || this.stoppedValue) throw new Error("Stopped");
        return this.adapter!.readback(draft, submitted.data, signal);
      })); }
      catch { return await this.settleUnknown(operationId, "SUBMIT_OUTCOME_UNKNOWN", action, submitted.data.providerRequestId, createdAdId); }
      const after = observationSchema.safeParse(afterRaw);
      if (!after.success || !afterMatches(draft, after.data, submitted.data.adId)) return await this.settleUnknown(operationId, "READBACK_MISMATCH", action, submitted.data.providerRequestId, createdAdId);
      const evidenceDigest = readbackDigest(after.data);
      try {
        await this.store.settle(operationId, { state: "CONFIRMED", afterVersion: after.data.version, readbackDigest: evidenceDigest,
          ...(submitted.data.providerRequestId ? { providerRequestId: submitted.data.providerRequestId } : {}),
          ...(action === "create-plan" && submitted.data.adId ? { adId: submitted.data.adId } : {}) });
      } catch { return result("UNKNOWN", "STORE_UNAVAILABLE", action, operationId, action === "create-plan" ? submitted.data.adId : undefined); }
      return result("CONFIRMED", "READBACK_CONFIRMED", action, operationId, action === "create-plan" ? submitted.data.adId : undefined);
    } catch (error) {
      if (operationId && submissionInvoked) return await this.settleUnknown(operationId, "SUBMIT_OUTCOME_UNKNOWN", action, undefined, createdAdId);
      if (operationId) return await this.settleNotSent(operationId, action, signal.aborted || this.stoppedValue ? "STOPPED" : "PRE_SUBMIT_FAILURE");
      return result("NOT_SENT", storeFailure(error), action);
    } finally {
      controller.abort(); await Promise.allSettled(pending);
      this.active.delete(controller);
    }
  }

  private async settleNotSent(operationId: string, action: QianchuanDeliveryDraft["action"], reason: "STOPPED" | "PRE_SUBMIT_FAILURE" | "AUTHORIZATION_EXPIRED"): Promise<QianchuanDeliveryResult> {
    try {
      await this.store.settle(operationId, { state: "NOT_SENT", reason: reason === "AUTHORIZATION_EXPIRED" ? "PRE_SUBMIT_FAILURE" : reason });
      return result("NOT_SENT", reason, action, operationId);
    } catch { return result("NOT_SENT", "STORE_UNAVAILABLE", action, operationId); }
  }

  private async settleUnknown(operationId: string, reason: "SUBMIT_OUTCOME_UNKNOWN" | "READBACK_MISMATCH", action: QianchuanDeliveryDraft["action"], providerRequestId?: string, createdAdId?: string): Promise<QianchuanDeliveryResult> {
    const safeRequestId = safeEvidenceReference(providerRequestId);
    try {
      const settlement: QianchuanDeliverySettlement = { state: "UNKNOWN", reason, ...(safeRequestId ? { providerRequestId: safeRequestId } : {}) };
      await this.store.settle(operationId, settlement);
      return result("UNKNOWN", reason, action, operationId, createdAdId);
    } catch { return result("UNKNOWN", "STORE_UNAVAILABLE", action, operationId, createdAdId); }
  }
}
