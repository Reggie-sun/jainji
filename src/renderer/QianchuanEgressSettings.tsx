import { useId } from "react";
import { QianchuanEgressSchema, type QianchuanEgress } from "../shared/qianchuan-egress";

export function QianchuanEgressSettings({ value, onChange, accounts, busy, groupError }: {
  value: QianchuanEgress | null; onChange(value: QianchuanEgress | null): void;
  accounts: readonly { egress?: QianchuanEgress }[]; busy: boolean; groupError?: string;
}) {
  const choiceId = useId();
  const groups = [...new Map(accounts.flatMap(account => account.egress ? [[account.egress.group, account.egress] as const] : [])).values()];
  const parsed = value ? QianchuanEgressSchema.safeParse(value) : undefined;
  const method = !value ? "direct" : value.mode === "remote-browser" ? "remote-browser" : "local";
  const selectedGroup = groups.find(group => group.group === value?.group && group.sshHost === value.sshHost &&
    group.localPort === value.localPort && group.expectedIp === value.expectedIp)?.group ?? "";
  const selectMethod = (next: string) => {
    if (next === "direct") { onChange(null); return; }
    const { mode: _old, ...route } = value ?? { group: "", sshHost: "", localPort: 19381 + groups.length, expectedIp: "" };
    onChange(next === "remote-browser" ? { ...route, mode: "remote-browser" } : route);
  };
  return <fieldset disabled={busy} className="qianchuan-egress-settings">
    <legend>上传方式</legend>
    <div className="qianchuan-upload-methods">{([
      ["direct", "本机上传", "浏览器和成片都在本机，使用本机网络。"],
      ["local", "本机上传 · VPS 出口", "浏览器在本机，上传流量经过 VPS。"],
      ["remote-browser", "VPS 上传", "浏览器和上传在 VPS，需本机简辑运行。"],
    ] as const).map(([id, title, description]) => <label key={id}>
      <input type="radio" name={choiceId} value={id} aria-label={title} checked={method === id} onChange={() => selectMethod(id)} />
      <span><strong>{title}</strong><small>{description}</small></span>
    </label>)}</div>
    {value && <>
      {value.mode === "remote-browser" && <p>浏览器和登录状态保存在对应 VPS，成片传输校验后由远端上传。本地简辑负责调度，运行期间需保持开机。首次登录或验证码请在 VPS 远程桌面处理。</p>}
      {groups.length > 0 && <label>复用已设置的主体<select aria-label="复用已设置的主体" value={selectedGroup} onChange={event => {
        const selected = groups.find(group => group.group === event.target.value);
        if (selected) {
          const { mode: _savedMode, ...route } = selected;
          onChange(method === "remote-browser" ? { ...route, mode: "remote-browser" } : route);
        }
      }}><option value="">选择主体，或填写下方设置</option>{groups.map(group => <option key={group.group} value={group.group}>{group.group} · {group.expectedIp}</option>)}</select></label>}
      <small>用代号区分营业执照，无需填写身份证号码。同一主体的账号复用同一组设置。</small>
      <div className="qianchuan-egress-fields">
      <label>主体代号<input aria-label="主体代号" maxLength={40} value={value.group} placeholder="例如：店铺主体一" onChange={event => onChange({ ...value, group: event.target.value })} /></label>
      <label>SSH 主机别名<input aria-label="SSH 主机别名" maxLength={64} value={value.sshHost} placeholder="例如：shop-one" onChange={event => onChange({ ...value, sshHost: event.target.value })} /></label>
      <label>预期出口 IPv4<input aria-label="预期出口 IPv4" maxLength={15} value={value.expectedIp} placeholder="VPS 的固定公网 IPv4" onChange={event => onChange({ ...value, expectedIp: event.target.value })} /></label>
      <label>本地连接端口<input aria-label="本地连接端口" type="number" min={1024} max={65535} value={value.localPort} onChange={event => onChange({ ...value, localPort: Number(event.target.value) })} /></label>
      </div>
      {parsed && !parsed.success && <p role="alert">{parsed.error.issues[0].message}</p>}
      {groupError && <p role="alert">{groupError} 请复用该主体的原设置；整组迁移需先结束受保护任务并关闭浏览器。</p>}
      <p>保存后，打开账号浏览器或新制作时自动连接并核对出口。连接失败会停止，不会改为直连。</p>
      <small>先在本机配置 SSH 密钥和可信主机指纹。更换出口前，需结束受保护任务并关闭该账号浏览器。视频上传也会消耗 VPS 流量。</small>
    </>}
  </fieldset>;
}
