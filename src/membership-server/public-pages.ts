import type { IncomingMessage, ServerResponse } from "node:http";

const pages: Record<string, { title: string; content: string }> = {
  "/billing/about": {
    title: "简辑账号中心",
    content: `<p>简辑是本地视频包装软件。素材、项目与导出视频保存在用户电脑，账号中心负责登录、使用权限与会员续费。</p>
<p>使用 Google 账号登录，每个 Google 身份可领取一次 3 天试用。月度会员 ¥100，年度会员 ¥666，到期手动续费。</p>
<p>当前采用微信或支付宝收款码与管理员核款。提交付款申请不代表到账；核款后更新使用期限。一个账号同时只允许一处登录，新登录会使旧会话失效。</p>
<p><a href="/billing">登录与续费</a> · <a href="/billing/privacy">隐私说明</a></p>`,
  },
  "/billing/privacy": {
    title: "简辑隐私说明",
    content: `<p>更新日期：2026-10-11。适用于简辑账号登录、使用权限与会员续费服务。</p>
<h2>账号与登录</h2><p>使用 Google 登录时，账号服务接收 Google 身份标识、邮箱、名称及头像，用于创建和识别简辑账号。不索取 Google 密码，也不申请读取邮件、联系人或云盘的权限。Google 负责验证您的 Google 账号；Casdoor 管理简辑账号与会话。</p>
<p>默认记住登录 30 天。桌面登录凭据通过操作系统加密存储，网页通过安全 Cookie 与服务端加密会话恢复登录。退出可清除对应入口的记住登录状态；权限仍由服务器在线检查。</p>
<h2>会员与试用</h2><p>服务保存账号、订阅、管理员赠送期限及您提交的付款申请信息，用于权限检查和人工核款。试用账本保存 Google 身份及简辑用户身份的摘要与领取时间，以限制一个 Google 身份领取一次试用。删号或撤销 Google 授权不重置试用记录。</p>
<h2>视频与网络</h2><p>账号与续费服务不接收您的原视频、项目或导出视频，这些内容保存在本机。视频制作中另行配置的模型连接属于独立功能。访问账号服务会经过 Cloudflare，Google 登录与微信、支付宝付款也分别由相应服务处理。</p>
<h2>管理与联系</h2><p>管理员可查看会员与付款申请、调整赠送期限及停用账号。账号和交易记录用于持续提供服务及处理核款问题；防重复试用摘要不随删号删除。您可在 Google 账号设置中撤销授权，或联系 <!--email_off--><a href="mailto:sunruijie42@gmail.com">sunruijie42@gmail.com</a><!--/email_off--> 申请查看、更正或删除账号资料；涉及付款争议和防重复领取的记录需另行处理。</p>
<p><a href="/billing/about">账号中心说明</a> · <a href="/billing">登录与续费</a></p>`,
  },
};

export function handleMembershipPublicPage(request: IncomingMessage, response: ServerResponse): boolean {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const page = pages[pathname];
  if (!page) return false;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    request.resume();
    response.writeHead(405, { ...headers, Allow: "GET, HEAD" }).end();
    return true;
  }
  response.writeHead(200, headers);
  response.end(request.method === "HEAD" ? undefined : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${page.title}</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;font:18px/1.8 sans-serif;color:#19283e}h1{font-size:32px}h2{font-size:22px}a{color:#2452a5}</style></head><body><main><h1>${page.title}</h1>${page.content}</main></body></html>`);
  return true;
}
