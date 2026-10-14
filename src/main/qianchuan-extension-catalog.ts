import type { QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";
import type { QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import { QianchuanAccountCatalog, signQianchuanRequest } from "./qianchuan-account-catalog.js";
import { ExtensionSnapshotSchema, sameExtensionSnapshot, type ExtensionCall, type ExtensionSnapshot } from "./qianchuan-extension-protocol.js";

export { signQianchuanRequest };

/** Extension-specific identity and document checks around the shared catalog rules. */
export class QianchuanExtensionCatalog {
  private readonly catalog: QianchuanAccountCatalog<ExtensionSnapshot>;

  constructor(call: ExtensionCall) {
    this.catalog = new QianchuanAccountCatalog(call, {
      parse: value => ExtensionSnapshotSchema.parse(value),
      same: sameExtensionSnapshot,
      switched: (before, after) => before.tabId === after.tabId && before.documentId !== after.documentId,
    });
  }

  accounts(snapshot: ExtensionSnapshot, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<QianchuanSubaccountCatalog> {
    return this.catalog.accounts(snapshot, signal, guard);
  }

  switch(snapshot: ExtensionSnapshot, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<ExtensionSnapshot> {
    return this.catalog.switch(snapshot, advertiserId, signal, guard);
  }

  plans(snapshot: ExtensionSnapshot, signal: AbortSignal, guard: () => Promise<void> = async () => {}): Promise<QianchuanPlanOption[]> {
    return this.catalog.plans(snapshot, signal, guard);
  }
}
