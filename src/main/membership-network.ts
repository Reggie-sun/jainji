import type { session } from "electron";

/** Only idempotent membership GETs use the recoverable connection pool. */
export async function createMembershipNetwork(sessions: Pick<typeof session, "fromPartition">) {
  const account = sessions.fromPartition("jianji-membership", { cache: false });
  const checks = sessions.fromPartition("jianji-membership-check", { cache: false });
  await Promise.all([account.setProxy({ mode: "direct" }), checks.setProxy({ mode: "direct" })]);
  const fetcher: typeof fetch = (target, options) => account.fetch(target instanceof URL ? target.href : target, options);
  const checkFetcher: typeof fetch = (target, options) => checks.fetch(target instanceof URL ? target.href : target, options);
  const recover = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await checks.closeAllConnections();
    signal?.throwIfAborted();
    await checks.clearHostResolverCache();
  };
  return { fetcher, checkFetcher, recover };
}
