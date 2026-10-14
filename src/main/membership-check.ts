import { z } from "zod";
import { MembershipStatusSchema, type MembershipStatus } from "../shared/membership.js";

const NETWORK_CODES = ["ERR_NAME_NOT_RESOLVED", "ERR_NAME_RESOLUTION_FAILED", "ERR_CONNECTION_RESET", "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_ABORTED", "ERR_CONNECTION_FAILED", "ERR_INTERNET_DISCONNECTED", "ERR_NETWORK_CHANGED", "ERR_ADDRESS_UNREACHABLE",
  "ERR_TIMED_OUT", "ERR_CONNECTION_TIMED_OUT", "ERR_EMPTY_RESPONSE", "ERR_HTTP2_PROTOCOL_ERROR", "ERR_HTTP2_PING_FAILED",
  "ERR_QUIC_PROTOCOL_ERROR", "ERR_SSL_PROTOCOL_ERROR", "ERR_CERT_COMMON_NAME_INVALID", "ERR_CERT_DATE_INVALID",
  "ERR_CERT_AUTHORITY_INVALID", "ERR_CERT_REVOKED", "ERR_CERT_INVALID"] as const;
export const MembershipDiagnosticSchema = z.object({
  at: z.string().datetime(), phase: z.enum(["retry", "reconnect", "recovered", "failed"]),
  kind: z.enum(["network", "timeout", "tls", "http", "invalid-response", "server-unavailable", "recovery", "unknown"]),
  attempt: z.number().int().min(1).max(2), elapsedMs: z.number().finite().nonnegative(),
  httpStatus: z.number().int().min(100).max(599).optional(), networkCode: z.enum(NETWORK_CODES).optional(),
  state: MembershipStatusSchema.shape.state.optional(),
});
export type MembershipDiagnostic = z.infer<typeof MembershipDiagnosticSchema>;
type Failure = Pick<MembershipDiagnostic, "kind" | "httpStatus" | "networkCode"> & { retryable: boolean };
export class MembershipCheckError extends Error {
  constructor(readonly failure: Failure) { super("账号核验请求失败。"); }
}

export function membershipFailure(error: unknown): Failure {
  if (error instanceof MembershipCheckError) return error.failure;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return { kind: "timeout", retryable: true };
  if (error instanceof z.ZodError || error instanceof SyntaxError) return { kind: "invalid-response", retryable: false };
  const code = error instanceof Error ? NETWORK_CODES.find(value => error.message.includes(value)) : undefined;
  if (code?.startsWith("ERR_CERT_")) return { kind: "tls", networkCode: code, retryable: false };
  if (code || error instanceof TypeError) return { kind: "network", ...(code ? { networkCode: code } : {}), retryable: true };
  return { kind: "unknown", retryable: true };
}

export function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    try { work().then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    }); } catch (error) { signal.removeEventListener("abort", abort); reject(error); }
  });
}

function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 250);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function checkMembershipWithRecovery(input: {
  check(signal: AbortSignal): Promise<MembershipStatus>; signal: AbortSignal;
  recover?(signal: AbortSignal): Promise<void>; diagnostic?(event: MembershipDiagnostic): void | Promise<void>;
}): Promise<MembershipStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("账号核验超时。", "TimeoutError")), 22_000);
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const unavailable: MembershipStatus = { state: "unavailable", reason: "unavailable", message: "无法核验账号权限，请检查网络后重试。" };
  let failure: Failure = { kind: "unknown", retryable: true }, result = unavailable;
  const started = Date.now();
  const report = (phase: MembershipDiagnostic["phase"], attempt: number, state?: MembershipStatus["state"]) => {
    const { retryable: _retryable, ...safe } = failure;
    try { void Promise.resolve(input.diagnostic?.({ at: new Date().toISOString(), phase, attempt,
      elapsedMs: Math.max(0, Date.now() - started), ...(state ? { state } : {}), ...safe })).catch(() => {}); } catch { /* Diagnostics never authorize or interrupt work. */ }
  };
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const next = MembershipStatusSchema.parse(await abortable(() => input.check(signal), signal));
        if (next.state !== "unavailable") { if (attempt > 1) report("recovered", attempt, next.state); return next; }
        result = next; failure = { kind: "server-unavailable", retryable: true };
      } catch (error) { failure = membershipFailure(error); result = unavailable; }
      if (input.signal.aborted) return result;
      if (!failure.retryable || attempt === 2 || signal.aborted) { report("failed", attempt, "unavailable"); return result; }
      report("retry", attempt);
      try {
        if (input.recover && ["network", "timeout", "unknown"].includes(failure.kind)) {
          report("reconnect", attempt);
          await abortable(() => input.recover!(signal), signal);
        }
        await wait(signal);
      } catch {
        if (!input.signal.aborted) { failure = { kind: signal.aborted ? "timeout" : "recovery", retryable: false }; report("failed", attempt); }
        return unavailable;
      }
    }
    return result;
  } finally { clearTimeout(timer); }
}
