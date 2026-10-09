import { z } from "zod";

export const QianchuanEgressSchema = z.object({
  mode: z.literal("remote-browser").optional(),
  group: z.string().trim().min(1, "请填写主体代号。").max(40).regex(/^[^\u0000-\u001f\u007f]+$/),
  sshHost: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "请填写本机 SSH 配置中的主机别名。"),
  localPort: z.number().int().min(1024).max(65535),
  expectedIp: z.string().ip({ version: "v4", message: "请填写 VPS 的固定公网 IPv4。" }).refine(value => {
    const [a, b] = value.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
  }, "预期出口必须为公网 IPv4，不能填写本机或内网地址。"),
}).strict();
export type QianchuanEgress = z.infer<typeof QianchuanEgressSchema>;
export const EGRESS_FLAG_NAMES = ["--proxy-server", "--proxy-bypass-list", "--proxy-pac-url", "--proxy-auto-detect", "--no-proxy-server",
  "--host-resolver-rules", "--disable-quic", "--force-webrtc-ip-handling-policy", "--disable-extensions"];
export const egressIdentity = (value: QianchuanEgress | undefined): string => value ? JSON.stringify(QianchuanEgressSchema.parse(value)) : "direct";
export const egressProxy = (value: QianchuanEgress): string => `socks5://127.0.0.1:${value.localPort}`;

export function validateEgressGroups(accounts: readonly { egress?: QianchuanEgress }[], ctx: z.RefinementCtx): void {
  for (let i = 0; i < accounts.length; i++) {
    const current = accounts[i].egress;
    if (!current) continue;
    for (const previous of accounts.slice(0, i).flatMap(account => account.egress ? [account.egress] : [])) {
      if (current.group === previous.group ? egressIdentity(current) !== egressIdentity(previous) :
        current.sshHost === previous.sshHost || current.localPort === previous.localPort || current.expectedIp === previous.expectedIp) {
        ctx.addIssue({ code: "custom", message: "同主体必须使用相同出口设置；不同主体不能共用 SSH 别名、端口或出口 IP。" });
      }
    }
  }
}
