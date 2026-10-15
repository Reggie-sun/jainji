import path from "node:path";
import os from "node:os";
import { QianchuanBrowserBindings } from "./qianchuan-browser-bindings.js";
import { findExtensionProcess, readExtensionBrowserMetadata, verifyExtensionProcess } from "./qianchuan-extension-process.js";
import { QianchuanCdpAccountSession, CdpSnapshotSchema, sameCdpSnapshot, switchedCdpSnapshot, type CdpSnapshot } from "./qianchuan-cdp-account-session.js";
import { QianchuanAccountCatalog, type CatalogOperation } from "./qianchuan-account-catalog.js";
import { qianchuanRemoteRuntime } from "./qianchuan-remote-runtime.js";
import { readQianchuanCdpProfile } from "./qianchuan-cdp-profile.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanCurrentAccountPort, QianchuanCurrentAccountSession } from "./qianchuan-current-account-port.js";

interface BrowserProof { identity: string; endpoint: string; browserContextId?: string; verify(): Promise<void>; }
interface BrowserSession {
  current(signal: AbortSignal): Promise<CdpSnapshot>;
  call(operation: CatalogOperation<CdpSnapshot>, signal?: AbortSignal): Promise<unknown>;
}
interface BrowserAccountDependencies {
  resolve?(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<BrowserProof>;
  session?(target: FrozenQianchuanAccount, verify: () => Promise<void>, excludedTargets: ReadonlySet<string>): BrowserSession;
}
interface BoundSession { proof: BrowserProof; snapshot: CdpSnapshot; catalog: QianchuanAccountCatalog<CdpSnapshot>; }

const changed = () => new Error("原 Chrome 进程、连接或网页账户已变化，请重新读取子账户。");

/** Saved IDs locate original browsers; current webpage children never rewrite that anchor. */
export class QianchuanBrowserAccounts implements QianchuanCurrentAccountPort {
  private readonly bindings: QianchuanBrowserBindings;
  private readonly sessions = new WeakMap<QianchuanCurrentAccountSession, BoundSession>();
  private readonly profileContexts = new Map<FrozenQianchuanAccount["product"], { identity: string; context: Promise<string> }>();
  constructor(private readonly root: string, private readonly dependencies: BrowserAccountDependencies = {}) {
    this.bindings = new QianchuanBrowserBindings(root);
  }
  private async resolve(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<BrowserProof> {
    signal.throwIfAborted();
    if (this.dependencies.resolve) return this.dependencies.resolve(target, signal);
    if (target.egress?.mode === "remote-browser") {
      const route = target.egress, before = await qianchuanRemoteRuntime.browserProfile(route, target.advertiserId, signal);
      // A catalog owns its forward; another live app may already hold the configured port.
      const endpoint = await qianchuanRemoteRuntime.attachMetadata(route, target.advertiserId, before.browser, 0);
      const verify = async () => {
        signal.throwIfAborted();
        const after = await qianchuanRemoteRuntime.browserProfile(route, target.advertiserId, signal);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
        await this.verifyEndpoint(endpoint, before.browser.browserPath, signal);
      };
      await verify(); return { identity: JSON.stringify({ route, ...before }), endpoint, verify };
    }
    const managed = { advertiserId: target.advertiserId, profile: path.resolve(this.root, "account-browsers", target.advertiserId), profileDirectory: "Default" };
    const binding = await this.bindings.get(target.advertiserId) ?? managed;
    let processIdentity, startedAt, metadata;
    try {
      processIdentity = await findExtensionProcess(binding.profile, binding.profileDirectory, "/proc", "cdp-default-profile");
      startedAt = await verifyExtensionProcess(processIdentity, "/proc", os.homedir(), "cdp-default-profile");
      metadata = await readExtensionBrowserMetadata(processIdentity, "/proc", "cdp-default-profile");
    } catch { signal.throwIfAborted(); throw new Error("无法核对该账号的原 Chrome，请先打开对应账号浏览器后刷新子账户。"); }
    if (!metadata?.browserPath) throw new Error("该账号 Chrome 未提供可核对的连接，请从账号设置打开原浏览器后刷新。");
    const endpoint = `http://127.0.0.1:${metadata.port}`, expected = JSON.stringify({ binding, processIdentity, startedAt, metadata });
    const verify = async () => {
      signal.throwIfAborted();
      const currentBinding = await this.bindings.get(target.advertiserId) ?? managed;
      const start = await verifyExtensionProcess(processIdentity, "/proc", os.homedir(), "cdp-default-profile"), currentMetadata = await readExtensionBrowserMetadata(processIdentity, "/proc", "cdp-default-profile");
      if (JSON.stringify({ binding: currentBinding, processIdentity, startedAt: start, metadata: currentMetadata }) !== expected) throw changed();
      await this.verifyEndpoint(endpoint, metadata.browserPath!, signal);
    };
    await verify();
    // A live process keeps its default profile. Recheck OS/endpoint proof on
    // every read, but share the one internal proof page for that exact process.
    let profile = this.profileContexts.get(target.product);
    if (profile?.identity !== expected) {
      const context = readQianchuanCdpProfile({ ...target, cdpEndpoint: endpoint }, binding, signal).then(async context => { await verify(); return context; });
      profile = { identity: expected, context };
      this.profileContexts.set(target.product, profile);
      const pending = profile;
      void context.catch(() => { if (this.profileContexts.get(target.product) === pending) this.profileContexts.delete(target.product); });
    }
    const browserContextId = await profile.context;
    await verify(); return { identity: `${expected}:${browserContextId}`, endpoint, browserContextId, verify };
  }
  private async verifyEndpoint(endpoint: string, browserPath: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${endpoint}/json/version`, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw changed();
    const value = await response.json() as { webSocketDebuggerUrl?: unknown };
    if (typeof value.webSocketDebuggerUrl !== "string") throw changed();
    const socket = new URL(value.webSocketDebuggerUrl);
    if (socket.protocol !== "ws:" || socket.host !== new URL(endpoint).host || socket.pathname !== browserPath || socket.username || socket.password || socket.search || socket.hash) throw changed();
  }
  async current(target: FrozenQianchuanAccount, signal: AbortSignal, excludedTargets: ReadonlySet<string> = new Set()): Promise<QianchuanCurrentAccountSession> {
    const proof = await this.resolve(target, signal), bound = Object.freeze({ ...target, cdpEndpoint: proof.endpoint });
    const exclusions = new Set(excludedTargets);
    const reader = this.dependencies.session?.(bound, proof.verify, exclusions) ?? new QianchuanCdpAccountSession(bound, proof.verify, exclusions, proof.browserContextId);
    await proof.verify();
    const snapshot = CdpSnapshotSchema.parse(await reader.current(signal));
    await proof.verify(); signal.throwIfAborted();
    const catalog = new QianchuanAccountCatalog((operation, operationSignal) => reader.call(operation, operationSignal), {
      parse: value => CdpSnapshotSchema.parse(value), same: sameCdpSnapshot, switched: switchedCdpSnapshot,
    });
    const session = Object.freeze({ identity: `${proof.identity}:${snapshot.browserContextId}:${snapshot.targetId}:${snapshot.documentId}`, endpoint: proof.endpoint,
      uploadEndpointVerified: true, account: Object.freeze({ ...snapshot.account }) });
    this.sessions.set(session, { proof, snapshot, catalog }); return session;
  }
  private async bound(session: QianchuanCurrentAccountSession, signal: AbortSignal): Promise<BoundSession> {
    signal.throwIfAborted();
    const bound = this.sessions.get(session); if (!bound) throw changed();
    await bound.proof.verify(); signal.throwIfAborted(); return bound;
  }
  async accounts(session: QianchuanCurrentAccountSession, signal: AbortSignal, guard: () => Promise<void>) {
    const bound = await this.bound(session, signal);
    return bound.catalog.accounts(bound.snapshot, signal, guard);
  }
  async switch(session: QianchuanCurrentAccountSession, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>) {
    const bound = await this.bound(session, signal), after = await bound.catalog.switch(bound.snapshot, advertiserId, signal, guard);
    return { account: after.account };
  }
  async plans(session: QianchuanCurrentAccountSession, signal: AbortSignal, guard: () => Promise<void>) {
    const bound = await this.bound(session, signal); return bound.catalog.plans(bound.snapshot, signal, guard);
  }
}
