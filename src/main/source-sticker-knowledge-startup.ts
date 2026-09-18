import { KnowledgeStoreError, SourceStickerKnowledgeStore } from "./source-sticker-knowledge-store.js";

export type KnowledgeRecoveryFailure = KnowledgeStoreError["code"] | "unknown";

type RecoveryOptions = {
  confirmRecovery: () => Promise<boolean>;
  reportRecoveryFailure: (reason: KnowledgeRecoveryFailure) => Promise<void>;
};

/** Opens normally or, after explicit confirmation, replaces an abandoned owner with a
 * fresh store while retaining one bounded recovery copy. Other startup failures remain
 * fail-closed and do not mutate the existing store. */
export async function openSourceStickerKnowledge(userData: string, options: RecoveryOptions): Promise<SourceStickerKnowledgeStore | undefined> {
  try { return await SourceStickerKnowledgeStore.open(userData); }
  catch (error) {
    if (!(error instanceof KnowledgeStoreError) || error.code !== "locked") return undefined;
  }
  if (!await options.confirmRecovery()) return undefined;
  try { return await SourceStickerKnowledgeStore.recoverAbandoned(userData); }
  catch (error) {
    const reason = error instanceof KnowledgeStoreError ? error.code : "unknown";
    try { await options.reportRecoveryFailure(reason); } catch { /* Reporting cannot weaken fail-closed startup. */ }
    return undefined;
  }
}
