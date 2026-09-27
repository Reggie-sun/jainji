import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";

const run = promisify(execFile);
// Diagnostic-only: bundle the shared TS owner in memory, never into desktop runtime.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/shared/qianchuan-account.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
export const { parseAccountConfig, accountPageUrl } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

export async function readAccountConfig(filePath) {
  return parseAccountConfig(JSON.parse(await readFile(filePath, "utf8")));
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
