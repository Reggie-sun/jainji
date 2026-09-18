interface ParentChannel {
  env: NodeJS.ProcessEnv;
  send?: unknown;
  on(event: "message", handler: (message: unknown) => void): unknown;
}

/** Parent-only development control; renderer IPC and packaged launches cannot use it. */
export function installDevelopmentQuit(parent: ParentChannel, startup: Promise<void>, quit: () => void): void {
  if (!parent.env.JIANJI_DEV_SERVER_URL || typeof parent.send !== "function") return;
  parent.on("message", message => {
    if (!message || typeof message !== "object" || !("type" in message) || message.type !== "jianji-dev-quit") return;
    // Do not exit while bootstrap may still be acquiring the durable store owner.
    void startup.then(quit, quit);
  });
}
