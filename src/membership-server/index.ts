import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { membershipServerConfigFromEnvironment, type MembershipServerConfig } from "./policy.js";
import { createMembershipServer } from "./server.js";
import { SqliteGoogleTrialStore } from "./google-trial.js";

export const DEFAULT_MEMBERSHIP_SERVER_PORT = 8789;

export interface StartMembershipServerOptions {
  config?: MembershipServerConfig | null;
  listenPort?: number;
}

export async function startMembershipServer(options: StartMembershipServerOptions = {}): Promise<Server> {
  const config = options.config === undefined ? await membershipServerConfigFromEnvironment() : options.config;
  const listenPort = options.listenPort ?? DEFAULT_MEMBERSHIP_SERVER_PORT;
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) throw new Error("会员服务监听端口无效。");
  const trialPath = process.env.JIANJI_MEMBERSHIP_TRIAL_DATABASE;
  const trials = trialPath ? new SqliteGoogleTrialStore(trialPath) : undefined;
  let server: Server;
  try {
    server = createMembershipServer({ config, trials, billingAssets: process.env.JIANJI_MEMBERSHIP_BILLING_ASSETS, billingState: process.env.JIANJI_MEMBERSHIP_BILLING_STATE });
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
  } catch (error) { trials?.close(); throw error; }
  server.once("close", () => trials?.close());
  return server;
}

async function runMembershipServer(): Promise<void> {
  if (process.argv[2] === "--initialize-trials") {
    const trialPath = process.env.JIANJI_MEMBERSHIP_TRIAL_DATABASE;
    if (!trialPath) throw new Error("未配置试用记录路径。");
    SqliteGoogleTrialStore.initialize(trialPath);
    return;
  }
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
