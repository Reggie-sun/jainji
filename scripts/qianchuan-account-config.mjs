import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const products = ["蝴蝶贴", "氨糖膏", "滴耳康", "眼贴", "肥皂", "热敷贴"];
const run = promisify(execFile);
const idPattern = /^[1-9][0-9]{0,19}$/;

// This file owns only the manual CDP test's account mapping, not production uploads.
export function parseAccountConfig(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.accounts) || value.accounts.length !== products.length) {
    throw new Error("配置需要 version: 1 和六条 accounts。");
  }
  const seenProducts = new Set();
  const seenPorts = new Set();
  const seenAccounts = new Set();
  return value.accounts.map((entry) => {
    if (!entry || !products.includes(entry.product) || seenProducts.has(entry.product)) {
      throw new Error("产品名称缺失、不支持或重复。");
    }
    seenProducts.add(entry.product);
    if (typeof entry.cdpEndpoint !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(entry.cdpEndpoint)) {
      throw new Error(`${entry.product}：CDP 地址必须为 http://127.0.0.1:端口。`);
    }
    const port = Number(new URL(entry.cdpEndpoint).port);
    if (port < 1 || port > 65535 || seenPorts.has(port)) {
      throw new Error(`${entry.product}：CDP 端口无效或重复。`);
    }
    seenPorts.add(port);
    for (const key of ["advertiserId", "adId"]) {
      if (typeof entry[key] !== "string" || (entry[key] !== "" && !idPattern.test(entry[key]))) {
        throw new Error(`${entry.product}：${key} 必须是带双引号的数字字符串；未填写时保留空字符串。`);
      }
    }
    if (entry.adId && !entry.advertiserId) throw new Error(`${entry.product}：填写计划 ID 前必须填写广告账户 ID。`);
    if (entry.advertiserId && seenAccounts.has(entry.advertiserId)) throw new Error("六个产品的广告账户 ID 不能重复。");
    if (entry.advertiserId) seenAccounts.add(entry.advertiserId);
    return {
      product: entry.product,
      cdpEndpoint: entry.cdpEndpoint,
      advertiserId: entry.advertiserId,
      adId: entry.adId,
    };
  });
}

export async function readAccountConfig(filePath) {
  return parseAccountConfig(JSON.parse(await readFile(filePath, "utf8")));
}

export function accountPageUrl(account) {
  if (!account.advertiserId || !account.adId) throw new Error(`${account.product}：先填写 advertiserId 和 adId，不能猜测账户或计划。`);
  const url = new URL("https://qianchuan.jinritemai.com/uni-prom");
  url.searchParams.set("aavid", account.advertiserId);
  url.searchParams.set("adId", account.adId);
  return url.href;
}

export function assertSelectedPage(page, account) {
  if (page.origin !== "https://qianchuan.jinritemai.com" || page.path !== "/uni-prom" ||
      page.advertiserId !== account.advertiserId || page.adId !== account.adId ||
      !page.visibleAccount || !page.visiblePlan || page.accountClosed) {
    throw new Error(`${account.product}：页面未确认对应账户和计划，请人工检查登录、权限及账户状态。`);
  }
}

export async function openAccountPage(account, execute = run) {
  const sessionId = randomUUID();
  const url = accountPageUrl(account);
  // Bind this session to the configured endpoint before using its selected page.
  const invoke = async (args) => {
    const { stdout, stderr } = await execute("chrome-devtools", [...args, "--sessionId", sessionId], { timeout: 45000, maxBuffer: 128 * 1024 });
    if (/Could not connect|Failed to fetch|Error:/.test(stdout + stderr)) throw new Error("Chrome CDP 操作失败；没有继续执行。");
    return stdout;
  };
  await invoke(["start", "--browserUrl", account.cdpEndpoint, "--usageStatistics=false", "--performanceCrux=false", "--categoryExtensions=false", "--redactNetworkHeaders=true"]);
  await invoke(["new_page", url]);
  const expression = `() => ({origin:location.origin,path:location.pathname,advertiserId:new URL(location.href).searchParams.get('aavid'),adId:new URL(location.href).searchParams.get('adId'),visibleAccount:[...document.querySelectorAll('*')].some(e=>e.children.length===0&&e.textContent.trim()==='ID：${account.advertiserId}'),visiblePlan:[...document.querySelectorAll('*')].some(e=>e.children.length===0&&e.textContent.trim()==='ID：${account.adId}'),accountClosed:document.body.innerText.includes('你的账号已被关停')})`;
  const output = await invoke(["evaluate_script", expression]);
  const match = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error("没有取得可核验的页面结果；请人工检查。");
  assertSelectedPage(JSON.parse(match[1]), account);
  return { product: account.product, status: "account_and_plan_visible", url, sessionId, submitted: false };
}

async function main() {
  const [filePath, action = "--check", product] = process.argv.slice(2);
  if (!filePath || !["--check", "--open"].includes(action) ||
      (action === "--check" && product !== undefined) ||
      (action === "--open" && (!product || process.argv.length !== 5))) {
    throw new Error("用法：node scripts/qianchuan-account-config.mjs <配置文件> --check；或 <配置文件> --open <产品>。不会上传或提交投放。");
  }
  const accounts = await readAccountConfig(filePath);
  if (action === "--check") {
    console.log(JSON.stringify(accounts.map((a) => ({ ...a, ready: Boolean(a.advertiserId && a.adId) })), null, 2));
    return;
  }
  const account = accounts.find((a) => a.product === product);
  if (!account) throw new Error("未找到指定产品。");
  console.log(JSON.stringify(await openAccountPage(account), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
