import { describe, expect, it } from "vitest";
import { chromeEgressArguments, assertEgressArguments } from "../src/main/qianchuan-egress-browser";
import { QianchuanEgressSchema } from "../src/shared/qianchuan-egress";

describe("extension-enabled proxy Chrome", () => {
  const route = QianchuanEgressSchema.parse({ group: "subject", sshHost: "subject-vps", localPort: 19401, expectedIp: "203.0.113.12" });
  it("enables account extensions while retaining all proxy leak restrictions", () => {
    const args = chromeEgressArguments(route);
    expect(args).not.toContain("--disable-extensions");
    expect(args).toContain("--disable-quic"); expect(args).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(() => assertEgressArguments({ endpoint: "http://127.0.0.1:19400", egressArguments: args }, route)).not.toThrow();
    for (const flag of args) expect(() => assertEgressArguments({ endpoint: "http://127.0.0.1:19400", egressArguments: args.filter(value => value !== flag) }, route)).toThrow();
  });
  it("keeps legacy frozen proxy browsers verifiable without weakening their other flags", () => {
    const args = [...chromeEgressArguments(route), "--disable-extensions"];
    expect(() => assertEgressArguments({ endpoint: "http://127.0.0.1:19400", egressArguments: args }, route)).not.toThrow();
    expect(() => assertEgressArguments({ endpoint: "http://127.0.0.1:19400", egressArguments: [...args, "--proxy-auto-detect"] }, route)).toThrow();
  });
});
