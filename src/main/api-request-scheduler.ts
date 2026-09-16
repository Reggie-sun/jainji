import { createHash } from "node:crypto";
import type { ConnectionInput } from "../shared/agent.js";

// A shared credential keeps one request lane even when roles use different models.
export class ApiRequestScheduler {
  private readonly lanes = new Map<string, { tail: Promise<void>; lastStarted?: number }>();

  async run<T>(connection: ConnectionInput, interval: number, signal: AbortSignal, request: () => Promise<T>): Promise<T> {
    const key = createHash("sha256").update(JSON.stringify([connection.baseUrl.replace(/\/+$/, ""), connection.apiKey])).digest("hex");
    let lane = this.lanes.get(key);
    if (!lane) { lane = { tail: Promise.resolve() }; this.lanes.set(key, lane); }
    const previous = lane.tail;
    let release!: () => void;
    lane.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      signal.throwIfAborted();
      const wait = lane.lastStarted === undefined ? 0 : interval - (Date.now() - lane.lastStarted);
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lane.lastStarted = Date.now();
      return await request();
    } finally { release(); }
  }
}
