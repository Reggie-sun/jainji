/** Renderer projections only; production state and persistence do not wait on notifications. */
export class StateNotifications<State> {
  private pending = false;
  private running = false;
  private timer?: ReturnType<typeof setTimeout>;
  private lastStarted = -Infinity;

  constructor(private readonly dependencies: { read(): Promise<State>; send(state: State): void; available(): boolean }) {}

  request(): void {
    if (!this.dependencies.available()) return;
    this.pending = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.pending || this.running || this.timer) return;
    if (!this.dependencies.available()) { this.pending = false; return; }
    // Bound expensive full-state projections even when reads finish between
    // progress events. Coalesce invalidations, without retaining stale states.
    const delay = Math.max(0, 500 - (performance.now() - this.lastStarted));
    if (delay === 0) void this.flush();
    else this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }

  private async flush(): Promise<void> {
    if (!this.dependencies.available()) { this.pending = false; return; }
    this.pending = false;
    this.running = true;
    this.lastStarted = performance.now();
    try {
      const state = await this.dependencies.read();
      if (this.dependencies.available()) this.dependencies.send(state);
    } catch { /* A later notification can retry; never accumulate readers. */ }
    finally { this.running = false; this.schedule(); }
  }
}
