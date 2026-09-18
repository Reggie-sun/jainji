import { createHash } from "node:crypto";
import type { ConnectionInput } from "../shared/agent.js";

// Roles sharing credentials share both the start-rate limiter and in-flight cap.
export class ApiRequestScheduler {
  private readonly lanes = new Map<string, { tail: Promise<void>; active: Set<Promise<void>>; lastStarted?: number }>();

  async run<T>(connection: ConnectionInput, interval: number, signal: AbortSignal, request: () => Promise<T>): Promise<T> {
    const key = createHash("sha256").update(JSON.stringify([connection.baseUrl.replace(/\/+$/, ""), connection.apiKey])).digest("hex");
    let lane = this.lanes.get(key);
    if (!lane) { lane = { tail: Promise.resolve(), active: new Set() }; this.lanes.set(key, lane); }
    const previous = lane.tail;
    let release!: () => void;
    lane.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    let finished!: () => void;
    let slot!: Promise<void>;
    try {
      signal.throwIfAborted();
      while (lane.active.size >= 3) { await Promise.race(lane.active); signal.throwIfAborted(); }
      const wait = lane.lastStarted === undefined ? 0 : interval - (Date.now() - lane.lastStarted);
      if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
      signal.throwIfAborted();
      lane.lastStarted = Date.now();
      slot = new Promise<void>(resolve => { finished = resolve; });
      lane.active.add(slot);
    } finally { release(); }
    try { return await request(); }
    finally { lane.active.delete(slot); finished(); }
  }
}
