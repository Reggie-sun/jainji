import path from "node:path";
import { QianchuanBrowserBindings } from "./qianchuan-browser-bindings.js";
import { QianchuanExtensionBridge } from "./qianchuan-extension-bridge.js";
import { QianchuanExtensionRemote } from "./qianchuan-extension-remote.js";
import { QianchuanExtensionCatalog } from "./qianchuan-extension-catalog.js";
import { ExtensionSnapshotSchema, type ExtensionSnapshot } from "./qianchuan-extension-protocol.js";
import { readExtensionBrowserMetadata } from "./qianchuan-extension-process.js";
import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanCurrentAccountPort, QianchuanCurrentAccountSession } from "./qianchuan-current-account-port.js";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import type { QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";

export interface ExtensionAccountSession extends QianchuanCurrentAccountSession { snapshot: ExtensionSnapshot; catalog: QianchuanExtensionCatalog; }
export type ExtensionAccountsPort = QianchuanCurrentAccountPort<ExtensionAccountSession>;
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
      uploadEndpointVerified: original?.uploadEndpointVerified ?? !!metadata, account: snapshot.account, snapshot, catalog: new QianchuanExtensionCatalog(connection.call) };
  }
  accounts(session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanSubaccountCatalog> { return session.catalog.accounts(session.snapshot, signal, guard); }
  async switch(session: ExtensionAccountSession, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<{ account: ExtensionSnapshot["account"] }> {
    const snapshot = await session.catalog.switch(session.snapshot, advertiserId, signal, guard);
    return { account: snapshot.account };
  }
  plans(session: ExtensionAccountSession, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanPlanOption[]> { return session.catalog.plans(session.snapshot, signal, guard); }
  async reconnect(target: FrozenQianchuanAccount): Promise<void> { if (target.egress?.mode === "remote-browser") await this.remote.reset(target.egress); }
}
