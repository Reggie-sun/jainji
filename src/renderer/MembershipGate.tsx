import { useEffect, useState, type ReactNode } from "react";
import { MEMBERSHIP_OFFERS, type MembershipStatus } from "../shared/membership";
import "./membership.css";

const labels: Record<string, string> = { trial: "免费试用", monthly: "月度会员", yearly: "年度会员", grant: "管理员赠送" };
export function MembershipGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<MembershipStatus>();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true, received = false;
    const update = (next: MembershipStatus) => { if (active) { setStatus(next); if (next.state === "allowed" || next.state === "local-development") setOpened(true); } };
    const unsubscribe = window.jianji.onMembership(next => { received = true; update(next); });
    void window.jianji.membershipStatus().then(next => { if (!received) update(next); }, () => { if (active) setError("无法读取账号状态，请重启后重试。"); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const action = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch { setError("操作未完成，请检查账号服务后重试。"); }
    finally { setBusy(false); }
  };
  const allowed = status?.state === "allowed" || status?.state === "local-development";
  const expires = status?.expiresAt ? new Date(status.expiresAt).toLocaleString("zh-CN", { hour12: false }) : undefined;
  const unavailable = !status || status.state === "unconfigured";
  const signingIn = status?.state === "signing-in";
  const admin = status?.user?.isAdmin && !["forbidden", "session-expired", "unavailable"].includes(status.reason);
  return <div className="membership-shell">
    {status?.state === "allowed" && <aside className="membership-bar" aria-label="简辑账号">
      <span><strong>{status.user?.displayName || status.user?.name}</strong> · {labels[status.reason]}{expires && <span className="membership-expiry"> · 到期 {expires}</span>}</span>
      <div>
        {admin && <button onClick={() => void action(window.jianji.openMembershipAdmin)} disabled={busy}>管理用户</button>}
        <button onClick={() => void action(window.jianji.openMembershipPricing)} disabled={busy}>续费会员</button>
        <button onClick={() => void action(window.jianji.logoutMembership)} disabled={busy}>退出登录</button>
      </div>
    </aside>}
    {opened && <div className="membership-workspace" hidden={!allowed}>{children}</div>}
    {!allowed && <main className="membership-screen">
      <section className="membership-card" aria-labelledby="membership-title">
        <div className="membership-brand">简辑 <span>账号中心</span></div>
        <h1 id="membership-title">登录，让制作继续</h1>
        <p className="membership-intro">新账号免费试用一个月，素材与项目保留在本机。</p>
        <div className="membership-status" role="status">
          {status?.message ?? "正在读取账号状态…"}
          {status?.user && <small>当前账号：{status.user.displayName || status.user.name}</small>}
          {expires && <small>权益截止：{expires}</small>}
        </div>
        <div className="membership-actions">
          <button className="membership-primary" disabled={unavailable || signingIn || busy} onClick={() => void action(window.jianji.loginMembership)}>登录 / 注册</button>
          <button disabled={unavailable || signingIn || busy} onClick={() => void action(window.jianji.refreshMembership)}>刷新权限</button>
          {(status?.user || signingIn) && <button onClick={() => { void window.jianji.logoutMembership().catch(() => setError("退出未完成，请重试。")); }}>{signingIn ? "取消登录" : "退出账号"}</button>}
        </div>
        <div className="membership-offers">
          {MEMBERSHIP_OFFERS.map(offer => <article key={offer.id}><h2>{offer.label}</h2><p><b>¥{offer.price}</b><span> / {offer.id === "monthly" ? "月" : "年"}</span></p><small>到期手动续费，无自动扣款</small></article>)}
        </div>
        <div className="membership-actions">
          <button disabled={unavailable || busy || signingIn || status?.reason === "forbidden"} onClick={() => void action(window.jianji.openMembershipPricing)}>查看套餐 / 续费</button>
          {admin && <button disabled={busy} onClick={() => void action(window.jianji.openMembershipAdmin)}>管理用户与免费授权</button>}
        </div>
        <p className="membership-footnote">一个账号同时只允许一处登录，新登录会使旧会话失效。<br />管理员可赠送使用期限或停用账号；支付后请刷新权限。</p>
        {opened && <button onClick={() => { void window.jianji.saveProject().catch(() => setError("项目未保存，请重试。")); }}>保存当前本地项目</button>}
        {error && <p className="membership-error" role="alert">{error}</p>}
      </section>
    </main>}
    {allowed && error && <p className="membership-error" role="alert">{error}</p>}
  </div>;
}
