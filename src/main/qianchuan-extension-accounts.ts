import path from "node:path";
import { QianchuanBrowserBindings } from "./qianchuan-browser-bindings.js";
import { QianchuanExtensionBridge } from "./qianchuan-extension-bridge.js";
import { QianchuanExtensionRemote } from "./qianchuan-extension-remote.js";
import { QianchuanExtensionCatalog } from "./qianchuan-extension-catalog.js";
import { ExtensionSnapshotSchema, type ExtensionSnapshot } from "./qianchuan-extension-protocol.js";
import { readExtensionBrowserMetadata } from "./qianchuan-extension-process.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";

export interface ExtensionAccountSession { identity: string; endpoint: string; uploadEndpointVerified: boolean; snapshot: ExtensionSnapshot; catalog: QianchuanExtensionCatalog; }
export interface ExtensionAccountsPort {
  current(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<ExtensionAccountSession>;
  accounts(session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanSubaccountCatalog>;
  switch(session: ExtensionAccountSession, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<ExtensionSnapshot>;
  plans(session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanPlanOption[]>;
  reconnect?(target: FrozenQianchuanAccount): Promise<void>;
}
/** Profile resolution uses the original browser binding and current settings, never example account IDs. */
export class QianchuanExtensionAccounts implements ExtensionAccountsPort {
  private readonly bridge: QianchuanExtensionBridge;
  private readonly remote: QianchuanExtensionRemote;
  private readonly bindings: QianchuanBrowserBindings;
  private started = false;
  constructor(private readonly root: string) {
    this.bridge = new QianchuanExtensionBridge(root); this.remote = new QianchuanExtensionRemote(this.bridge); this.bindings = new QianchuanBrowserBindings(root);
  }
  async current(target: FrozenQianchuanAccount, signal: AbortSignal): Promise<ExtensionAccountSession> {
    signal.throwIfAborted();
    if (!this.started) { this.started = true; process.once("exit", () => { this.remote.dispose(); this.bridge.dispose(); }); }
    const original = target.egress?.mode === "remote-browser" ? await this.remote.prepare(target.egress, target.advertiserId, signal, target.cdpEndpoint) : undefined;
    const binding = original ?? await this.bindings.get(target.advertiserId) ?? { profile: path.resolve(this.root, "account-browsers", target.advertiserId), profileDirectory: "Default" };
    if (!original) await this.bridge.registerProfile(binding.profile);
    const connection = await this.bridge.connection(original?.route ?? "local", binding.profile, binding.profileDirectory);
    const metadata = original ? undefined : await readExtensionBrowserMetadata(connection.process);
    const snapshot = ExtensionSnapshotSchema.parse(await connection.call({ kind: "identity" }, signal));
    signal.throwIfAborted();
    return { identity: `${connection.id}:${snapshot.tabId}:${snapshot.documentId}`, endpoint: original?.endpoint ?? (metadata ? `http://127.0.0.1:${metadata.port}` : target.cdpEndpoint),
      uploadEndpointVerified: original?.uploadEndpointVerified ?? !!metadata, snapshot, catalog: new QianchuanExtensionCatalog(connection.call) };
  }
  accounts(session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanSubaccountCatalog> { return session.catalog.accounts(session.snapshot, signal, guard); }
  switch(session: ExtensionAccountSession, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<ExtensionSnapshot> { return session.catalog.switch(session.snapshot, advertiserId, signal, guard); }
  plans(session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanPlanOption[]> { return session.catalog.plans(session.snapshot, signal, guard); }
  async reconnect(target: FrozenQianchuanAccount): Promise<void> { if (target.egress?.mode === "remote-browser") await this.remote.reset(target.egress); }
}
