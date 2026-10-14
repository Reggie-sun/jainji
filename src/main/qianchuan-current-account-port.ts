import type { FrozenQianchuanAccount } from "./qianchuan-account-config.js";
import type { QianchuanCurrentAccount, QianchuanPlanOption } from "../shared/qianchuan-plan-selection.js";
import type { QianchuanSubaccountCatalog } from "../shared/qianchuan-subaccounts.js";

export type QianchuanNamedCurrentAccount = QianchuanCurrentAccount & { name: string };

export interface QianchuanCurrentAccountSession {
  identity: string;
  endpoint: string;
  uploadEndpointVerified: boolean;
  account: QianchuanNamedCurrentAccount;
}

/** Current browser account operations shared by extension and browser transports. */
export interface QianchuanCurrentAccountPort<Session extends QianchuanCurrentAccountSession = QianchuanCurrentAccountSession> {
  current(target: FrozenQianchuanAccount, signal: AbortSignal, excludedTargets?: ReadonlySet<string>): Promise<Session>;
  accounts(session: Session, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanSubaccountCatalog>;
  switch(session: Session, advertiserId: string, signal: AbortSignal, guard: () => Promise<void>): Promise<{ account: QianchuanNamedCurrentAccount }>;
  plans(session: Session, signal: AbortSignal, guard: () => Promise<void>): Promise<QianchuanPlanOption[]>;
  reconnect?(target: FrozenQianchuanAccount): Promise<void>;
}
