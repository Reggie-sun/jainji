import { egressProxy, type QianchuanEgress } from "../shared/qianchuan-egress.js";
import { runningChromeBrowsers, type RunningChromeBrowser } from "./qianchuan-browser-discovery.js";
import { qianchuanEgressRuntime, type EgressLease } from "./qianchuan-egress-runtime.js";
import { probeChromeEgress } from "./qianchuan-egress-probe.js";
import { qianchuanRemoteRuntime } from "./qianchuan-remote-runtime.js";

export function chromeEgressArguments(route: QianchuanEgress): string[] {
  return [`--proxy-server=${egressProxy(route)}`, "--proxy-bypass-list=<-loopback>", "--disable-quic", "--disable-extensions",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];
}
export function assertEgressArguments(browser: RunningChromeBrowser, route?: QianchuanEgress): void {
  const actual = browser.egressArguments ?? [], expected = route ? chromeEgressArguments(route) : [];
  // Legacy Chrome may have unrelated flags; an explicit proxy cannot stand in for a frozen direct route.
  if (!route && !actual.some(arg => ["--proxy-server", "--proxy-pac-url", "--proxy-auto-detect"].some(flag => arg === flag || arg.startsWith(`${flag}=`)))) return;
  if (actual.length !== expected.length || expected.some(arg => !actual.includes(arg))) throw new Error("账号浏览器的固定出口与配置不一致，未执行自动化。请先关闭该账号浏览器，核查设置后重启并连接。");
}
export async function verifyBrowserEgress(endpoint: string, route?: QianchuanEgress, browsers = runningChromeBrowsers): Promise<EgressLease | undefined> {
  if (route?.mode === "remote-browser") return qianchuanRemoteRuntime.verify(endpoint, route);
  const matches = (await browsers()).filter(browser => browser.endpoint === endpoint);
  if (matches.length !== 1 || matches[0].connectionIssue) throw new Error("无法唯一验证账号浏览器的固定出口。");
  assertEgressArguments(matches[0], route);
  if (!route) return;
  const lease = await qianchuanEgressRuntime.verify(route);
  await probeChromeEgress(endpoint, route.expectedIp, lease.signal);
  return lease;
}
