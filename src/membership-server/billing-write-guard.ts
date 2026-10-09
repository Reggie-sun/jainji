import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { ManualSubscription } from "./casdoor.js";

export interface BillingWriteGuard { run(row: ManualSubscription, write: () => Promise<void>): Promise<void>; }

/** Recovery marker only, never an entitlement ledger. Unknown writes survive process restarts. */
export class FileBillingWriteGuard implements BillingWriteGuard {
  private active = false;
  constructor(private readonly directory: string) {}
  async run(row: ManualSubscription, write: () => Promise<void>): Promise<void> {
    if (this.active) throw new Error("Another billing write is in progress.");
    this.active = true;
    const file = path.join(this.directory, "write-intent.json");
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      // Exclusive creation fences both concurrent processes and abandoned/unknown writes.
      const handle = await open(file, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, subscription: `${row.owner}/${row.name}`, expected: row, sha256: createHash("sha256").update(JSON.stringify(row)).digest("hex"), startedAt: new Date().toISOString() }));
        await handle.sync();
      } finally { await handle.close(); }
      const directory = await open(this.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      await write();
      await unlink(file);
      const updatedDirectory = await open(this.directory, "r");
      try { await updatedDirectory.sync(); } finally { await updatedDirectory.close(); }
    } finally { this.active = false; }
  }
}
