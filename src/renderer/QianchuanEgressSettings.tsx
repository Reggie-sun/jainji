import { QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress";

export function QianchuanEgressSettings({ value, onChange, accounts, busy }: {
  value: QianchuanEgress | null; onChange(value: QianchuanEgress | null): void;
  accounts: readonly { egress?: QianchuanEgress }[]; busy: boolean;
}) {
  const groups = [...new Map(accounts.flatMap(account => account.egress ? [[account.egress.group, account.egress] as const] : [])).values()];
  const parsed = value ? QianchuanEgressSchema.safeParse(value) : undefined;
  return <fieldset disabled={busy} className="qianchuan-egress-settings">
    <legend>固定 VPS 出口</legend>
    <label><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? {
      group: "", sshHost: "", localPort: 19381 + groups.length, expectedIp: "",
    } : null)} />为此账号启用固定出口</label>
    {value && <>
      <label>浏览器运行位置<select aria-label="浏览器运行位置" value={value.mode ?? "local"} onChange={event => {
        const { mode: _old, ...route } = value;
        onChange(event.target.value === "remote-browser" ? { ...route, mode: "remote-browser" } : route);
      }}><option value="local">A：本机浏览器，VPS 出口</option><option value="remote-browser">B：VPS 远端浏览器</option></select></label>
      {value.mode === "remote-browser" && <p>浏览器和登录状态保存在对应 VPS，成片传输校验后由远端上传。本地简辑负责调度，运行期间需保持开机。首次登录或验证码请在 VPS 远程桌面处理。</p>}
      {groups.length > 0 && <label>复用已设置的主体<select aria-label="复用已设置的主体" value="" onChange={event => {
        const selected = groups.find(group => group.group === event.target.value); if (selected) onChange({ ...selected });
      }}><option value="">选择主体，或填写下方设置</option>{groups.map(group => <option key={group.group} value={group.group}>{group.group} · {group.expectedIp}</option>)}</select></label>}
      <label>主体代号<input aria-label="主体代号" maxLength={40} value={value.group} placeholder="例如：店铺主体一" onChange={event => onChange({ ...value, group: event.target.value })} /></label>
      <small>用代号区分营业执照，无需填写身份证号码。同一主体的账号复用同一组设置。</small>
      <label>SSH 主机别名<input aria-label="SSH 主机别名" maxLength={64} value={value.sshHost} placeholder="例如：shop-one" onChange={event => onChange({ ...value, sshHost: event.target.value })} /></label>
      <label>预期出口 IPv4<input aria-label="预期出口 IPv4" maxLength={15} value={value.expectedIp} placeholder="VPS 的固定公网 IPv4" onChange={event => onChange({ ...value, expectedIp: event.target.value })} /></label>
      <label>本地连接端口<input aria-label="本地连接端口" type="number" min={1024} max={65535} value={value.localPort} onChange={event => onChange({ ...value, localPort: Number(event.target.value) })} /></label>
      {parsed && !parsed.success && <p role="alert">{parsed.error.issues[0].message}</p>}
      <p>保存后，打开账号浏览器或新制作时自动连接并核对出口。连接失败会停止，不会改为直连。</p>
      <small>先在本机配置 SSH 密钥和可信主机指纹。更换出口前，需结束受保护任务并关闭该账号浏览器。视频上传也会消耗 VPS 流量。</small>
    </>}
  </fieldset>;
}
