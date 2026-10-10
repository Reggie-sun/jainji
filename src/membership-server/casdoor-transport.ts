import type { MembershipServerConfig } from "./policy.js";

/** Keep public OIDC identities intact while contacting a colocated Casdoor privately. */
export function casdoorOidcFetch(config: MembershipServerConfig, fetcher: typeof fetch = fetch): typeof fetch {
  return async (target, options) => {
    const url = new URL(target instanceof Request ? target.url : String(target));
    if (url.origin !== config.issuer || url.username || url.password) throw new Error("Invalid issuer.");
    const endpoint = new URL(config.casdoorUrl ?? config.issuer);
    endpoint.pathname = url.pathname; endpoint.search = url.search;
    const timeout = AbortSignal.timeout(10_000);
    return fetcher(endpoint, { ...options, redirect: "error", signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  };
}
