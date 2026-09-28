import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { lock } from "proper-lockfile";

export interface NvencPermit {
  assertValid(): void;
  started(): Promise<void>;
  release(): Promise<void>;
}

export function parseNvencSessionCount(output: string): number | undefined {
  const lines = output.trim().split(/\r?\n/);
  if (lines.some(line => !/^\d+$/.test(line.trim()))) return undefined;
  const count = lines.reduce((sum, line) => sum + Number(line), 0);
  return Number.isSafeInteger(count) ? count : undefined;
}

export function readNvencSessionCount(): Promise<number | undefined> {
  return new Promise(resolve => {
    execFile("nvidia-smi", ["--query-gpu=encoder.stats.sessionCount", "--format=csv,noheader,nounits"],
      { timeout: 1500, maxBuffer: 16_384, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : parseNvencSessionCount(stdout)));
  });
}

const sharedDirectory = () => path.join(tmpdir(), `jianji-nvenc-${createHash("sha256").update(userInfo().username).digest("hex").slice(0, 16)}`);

/** Coordinate startup across app instances; GPU telemetry includes other applications. */
export class NvencAdmission {
  private observed = false;
  private compromised?: Error;

  constructor(private readonly directory = sharedDirectory(), private readonly sessions = readNvencSessionCount) {}

  async acquire(maximum: number): Promise<NvencPermit | undefined> {
    if (this.compromised) throw this.compromised;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let unlock: () => Promise<void>;
    try {
      unlock = await lock(this.directory, {
        lockfilePath: path.join(this.directory, "startup.lock"),
        stale: 30_000, update: 5000, retries: 0,
        onCompromised: error => { this.compromised = error; },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") return undefined;
      throw error;
    }
    let released: Promise<void> | undefined;
    const release = () => released ??= unlock().catch(error => { this.compromised = error; });
    const count = await this.sessions().catch(() => undefined);
    if (count !== undefined) this.observed = true;
    // Startup's verified allocation is a conservative global budget, not a claim
    // about a driver's maximum. Sum devices since GeForce limits may be shared.
    if ((count === undefined && this.observed) || (count !== undefined && count >= maximum)) {
      await release();
      return undefined;
    }
    return {
      assertValid: () => { if (this.compromised) throw this.compromised; },
      // A positive output timestamp proves the encoder opened. Release startup
      // serialization then, while the task keeps its normal local render slot.
      // Without telemetry retain the lock until exit, allowing one global encode.
      started: async () => { if (count !== undefined) await release(); },
      release,
    };
  }
}
