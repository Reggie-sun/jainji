interface ParentChannel {
  env: NodeJS.ProcessEnv;
  send?: unknown;
  on(event: "message", handler: (message: unknown) => void): unknown;
}

/** Parent-only development control; renderer IPC and packaged launches cannot use it. */
export function installDevelopmentQuit(parent: ParentChannel, startup: Promise<void>, quit: () => void, canRestart: () => boolean = () => true): void {
  if (!parent.env.JIANJI_DEV_SERVER_URL || typeof parent.send !== "function") return;
  let pendingRestart = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearRestart = () => {
    pendingRestart = false;
    clearTimeout(timer);
    timer = undefined;
  };
  const tryRestart = () => {
    if (!pendingRestart) return;
    try {
      if (!canRestart()) {
        timer = setTimeout(tryRestart, 1000);
        timer.unref();
        return;
      }
    } catch {
      clearRestart();
      console.error("[dev] Could not establish idle state; automatic restart skipped.");
      return;
    }
    clearRestart();
    quit();
  };
  parent.on("message", message => {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    if (message.type === "jianji-dev-restart") {
      if (pendingRestart) return;
      pendingRestart = true;
      void startup.then(tryRestart, () => {
        if (pendingRestart) { clearRestart(); quit(); }
      });
      return;
    }
    if (message.type !== "jianji-dev-quit") return;
    clearRestart();
    // Do not exit while bootstrap may still be acquiring the durable store owner.
    void startup.then(quit, quit);
  });
}
