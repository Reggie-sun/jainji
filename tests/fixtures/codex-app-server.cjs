// Offline stdio fixture used only by the Electron smoke bootstrap.
const readline = require("node:readline");
if (process.argv[2]) require("node:fs").writeFileSync(process.argv[2], String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
let loggedIn = false;
let timer;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === "account/read") result = { account: loggedIn ? { type: "chatgpt", email: "smoke@example.test", planType: "plus" } : null };
  if (message.method === "model/list") result = { data: [{ model: "smoke-codex-vision", isDefault: true, hidden: false, inputModalities: ["text", "image"] }, { model: "smoke-codex-next", displayName: "Smoke Next", isDefault: false, hidden: false, inputModalities: ["image"] }, { model: "smoke-text", isDefault: false, hidden: false, inputModalities: ["text"] }] };
  if (message.method === "account/login/start") {
    result = { type: "chatgpt", loginId: "smoke-login", authUrl: "https://auth.openai.com/authorize?state=smoke" };
    timer = setTimeout(() => {
      loggedIn = true;
      send({ method: "account/login/completed", params: { loginId: "smoke-login", success: true } });
    }, 1500);
  }
  if (message.method === "account/login/cancel") clearTimeout(timer);
  if (message.method === "account/logout") loggedIn = false;
  send({ id: message.id, result });
});
