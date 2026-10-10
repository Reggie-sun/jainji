import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { RemoteFrames } from "./qianchuan-remote-transport.js";
import { RemoteBrowserSchema, type RemoteRequest } from "../shared/qianchuan-remote.js";
import { QianchuanBrowserManager, launchChrome } from "./qianchuan-browser-manager.js";
import { secureUploadDirectory } from "./douyin-upload-store.js";
import { probeChromeEgress } from "./qianchuan-egress-probe.js";
import { RemoteFileStore } from "./qianchuan-remote-files.js";
import { RemoteDesktop } from "./qianchuan-remote-desktop.js";
import { desktopEnvironment } from "./qianchuan-remote-desktop-panel.js";
import { readPrivateJson } from "./qianchuan-account-config.js";
import { z } from "zod";

/** Runs as a dedicated non-root SSH user, over stdin/stdout only; never listens publicly. */
export class RemoteWorker {
  private readonly manager: QianchuanBrowserManager;
  private readonly files: RemoteFileStore;
  private readonly desktop: RemoteDesktop;
  private identity?: string;
  constructor(private readonly root: string, home = os.homedir()) {
    this.manager = new QianchuanBrowserManager(path.join(root, "browsers"), { launch: (profile, id, original) => launchChrome(profile, id, original, undefined, false) });
    this.files = new RemoteFileStore(path.join(root, "files"));
    this.desktop = new RemoteDesktop(root, home);
  }
  private async bind(request: RemoteRequest): Promise<void> {
    if (process.platform !== "linux" || !process.getuid?.()) throw new Error("Dedicated non-root Linux user required");
    const identity = JSON.stringify({ group: request.route.group, expectedIp: request.route.expectedIp });
    if (this.identity) { if (this.identity !== identity) throw new Error("Subject changed"); return; }
    await secureUploadDirectory(this.root);
    const file = path.join(this.root, "subject.json");
    try {
      const handle = await open(file, "wx", 0o600);
      try { await handle.writeFile(identity); await handle.sync(); } finally { await handle.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || info.mode & 0o7177 || info.size > 512 || await handle.readFile("utf8") !== identity) throw new Error("Subject mismatch");
    } finally { await handle.close(); }
    this.identity = identity;
    await secureUploadDirectory(path.join(this.root, "browsers"));
  }
  async handle(request: RemoteRequest, body: Buffer): Promise<unknown> {
    await this.bind(request);
    if (body.length !== request.bodyBytes) throw new Error("Truncated frame");
    const id = request.advertiserId;
    if (request.action === "file-status") return this.files.status(request.file!);
    if (request.action === "file-append") return this.files.append(request.file!, request.offset!, body);
    if (request.action === "assert-closed") { await this.manager.assertClosed(id); return {}; }
    if (request.action === "close") { await this.manager.control(id, "close"); return {}; }
    if (request.action === "desktop-sync") { await this.desktop.sync(id, request.displayName!); return {}; }
    const endpoint = request.action === "open" ? await this.manager.open(id) : request.action === "probe" ? await this.manager.existingConnection(id) : await this.manager.prepareExisting(id);
    return this.browserInfo(endpoint, id, request.route.expectedIp, request.action === "open");
  }
  /** Fixed launcher command: existing registered profile only, never a new account. */
  async focusDesktop(id: string): Promise<void> {
    if (process.platform !== "linux" || !process.getuid?.()) throw new Error("Dedicated non-root Linux user required");
    const subject = (await readPrivateJson(path.join(this.root, "subject.json"), input => z.object({ group: z.string().min(1).max(100), expectedIp: z.string().ip({ version: "v4" }) }).strict().parse(input))).value;
    Object.assign(process.env, await desktopEnvironment());
    if (await this.desktop.focus(id)) return;
    await this.browserInfo(await this.manager.open(id), id, subject.expectedIp, true);
    if (!await this.desktop.focus(id)) throw new Error("Account window unavailable");
  }
  private async browserInfo(endpoint: string, id: string, expectedIp: string, openAccount: boolean): Promise<unknown> {
    await probeChromeEgress(endpoint, expectedIp, AbortSignal.timeout(20_000));
    if (openAccount) {
      const opened = await fetch(`${endpoint}/json/new?${encodeURIComponent(`https://qianchuan.jinritemai.com/uni-prom?aavid=${id}`)}`, { method: "PUT", redirect: "error", signal: AbortSignal.timeout(5000) });
      await opened.body?.cancel(); if (!opened.ok) throw new Error("Remote account page unavailable");
    }
    const response = await fetch(`${endpoint}/json/version`, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Browser unavailable");
    const info = await response.json() as { webSocketDebuggerUrl?: string };
    const socket = new URL(info.webSocketDebuggerUrl ?? "invalid");
    if (socket.protocol !== "ws:" || socket.host !== new URL(endpoint).host) throw new Error("Browser identity mismatch");
    return RemoteBrowserSchema.parse({ port: Number(new URL(endpoint).port), browserPath: socket.pathname });
  }
}

export async function serveRemoteWorker(): Promise<void> {
  process.umask(0o077);
  process.env.DISPLAY ||= ":99";
  const worker = new RemoteWorker(path.join(os.homedir(), ".local", "share", "jianji-remote", "state"));
  const frames = new RemoteFrames();
  for await (const chunk of process.stdin) {
    for (const { request, body } of frames.push(Buffer.from(chunk))) {
      let result: { ok: boolean; value?: unknown };
      try { result = { ok: true, value: await worker.handle(request, body) }; } catch { result = { ok: false }; }
      await new Promise<void>((resolve, reject) => process.stdout.write(JSON.stringify(result) + "\n", error => error ? reject(error) : resolve()));
    }
  }
}
