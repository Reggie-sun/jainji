import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { membershipServerConfigFromEnvironment, type MembershipServerConfig } from "./policy.js";
import { createMembershipServer } from "./server.js";

export const DEFAULT_MEMBERSHIP_SERVER_PORT = 8789;

export interface StartMembershipServerOptions {
  config?: MembershipServerConfig | null;
  listenPort?: number;
}

export async function startMembershipServer(options: StartMembershipServerOptions = {}): Promise<Server> {
  const config = options.config === undefined ? await membershipServerConfigFromEnvironment() : options.config;
  const listenPort = options.listenPort ?? DEFAULT_MEMBERSHIP_SERVER_PORT;
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) throw new Error("会员服务监听端口无效。");
  const server = createMembershipServer({ config });
  await new Promise<void>((resolve, reject) => {
    const onError = () => {
      server.off("listening", onListening);
      reject(new Error("无法启动会员服务。"));
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(listenPort, "127.0.0.1");
  });
  return server;
}

async function runMembershipServer(): Promise<void> {
  const server = await startMembershipServer();
  const stop = () => {
    const timeout = setTimeout(() => process.exit(0), 5_000);
    timeout.unref();
    server.close(() => { clearTimeout(timeout); process.exit(0); });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runMembershipServer().catch(() => { process.exitCode = 1; });
}
