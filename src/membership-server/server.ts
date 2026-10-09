import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { signedOutMembership, MembershipStatusSchema } from "../shared/membership.js";
import { resolveMembershipStatus, type MembershipServerConfig } from "./policy.js";
import { BillingPortal } from "./billing.js";
import { ManualPayments } from "./manual-payments.js";
import { CasdoorClient } from "./casdoor.js";
import { FileBillingWriteGuard } from "./billing-write-guard.js";

export interface MembershipServerOptions {
  config?: MembershipServerConfig | null;
  fetcher?: typeof fetch;
  clock?: () => Date;
  billingAssets?: string;
  billingState?: string;
}

const MAX_ACCESS_TOKEN_LENGTH = 16_384;

export function createMembershipServer(options: MembershipServerOptions = {}): Server {
  const config = options.config ?? null;
  if (options.billingAssets && !options.billingState) throw new Error("人工核款需要配置持久化写入保护目录。");
  const billing = config && options.billingAssets && options.billingState ? new BillingPortal(config, options.billingAssets, new ManualPayments(config, new CasdoorClient(config), () => new Date(), new FileBillingWriteGuard(options.billingState))) : undefined;
  const server = createServer((request, response) => {
    void (async () => {
      if (billing && await billing.handle(request, response)) return;
      await handleRequest(request, response, config, options.fetcher, options.clock);
    })().catch(() => {
      sendJson(response, 200, MembershipStatusSchema.parse({
        state: "unavailable",
        reason: "unavailable",
        message: "账号服务暂不可用，请稍后重试。",
        checkedAt: (options.clock?.() ?? new Date()).toISOString(),
      }));
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: MembershipServerConfig | null,
  fetcher?: typeof fetch,
  clock?: () => Date,
): Promise<void> {
  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    sendJson(response, 400, { error: "请求无效。" });
    return;
  }
  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "GET" || pathname !== "/v1/membership") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const now = clock?.() ?? new Date();
  if (!config) {
    sendJson(response, 200, MembershipStatusSchema.parse({ state: "unconfigured", reason: "unconfigured", message: "账号服务尚未配置。", checkedAt: now.toISOString() }));
    return;
  }
  if (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0" || request.headers["transfer-encoding"] !== undefined) {
    request.resume();
    sendJson(response, 200, MembershipStatusSchema.parse({ state: "denied", reason: "session-expired", message: "请求无效，请重新登录。", checkedAt: now.toISOString() }));
    return;
  }

  const authorization = request.headers.authorization;
  if (!authorization) {
    sendJson(response, 200, signedOutMembership());
    return;
  }
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
  if (!match || match[1].length > MAX_ACCESS_TOKEN_LENGTH) {
    sendJson(response, 200, MembershipStatusSchema.parse({ state: "denied", reason: "session-expired", message: "登录已失效，请重新登录。", checkedAt: now.toISOString() }));
    return;
  }

  const status = await resolveMembershipStatus(match[1], config, { fetcher, clock: () => now });
  sendJson(response, 200, MembershipStatusSchema.parse(status));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
