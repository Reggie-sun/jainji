import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { codexCompletionLaunch, codexLaunch, readChatGPTExecutionCredential } from "../src/main/model-connections";
import { CodexRpc } from "../src/main/codex-rpc";

const TEST_CHATGPT_ID_TOKEN = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF91c2VyX2lkIjoidXNlci0xMjMiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6InBybyIsImNoYXRncHRfYWNjb3VudF9pZCI6ImZpeHR1cmUtYWNjb3VudCJ9fQ.c2ln";

describe("bundled Codex runtime", () => {
  it("resolves platform binaries nested under the Codex package by electron-builder", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-nested-codex-"));
    const codexRoot = path.join(directory, "node_modules", "@openai", "codex");
    const platformRoot = path.join(codexRoot, "node_modules", "@openai", `codex-${process.platform}-${process.arch}`);
    try {
      await mkdir(platformRoot, { recursive: true });
      await writeFile(path.join(codexRoot, "package.json"), '{"name":"@openai/codex"}');
      await writeFile(path.join(platformRoot, "package.json"), '{}');
      expect(codexLaunch(directory, directory).command.startsWith(platformRoot + path.sep)).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("waits for a child that ignores graceful termination to actually exit", async () => {
    const program = `process.on('SIGTERM',()=>{});require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');});setInterval(()=>{},1000);`;
    const rpc = new CodexRpc(process.execPath, ["-e", program], {}, process.cwd());
    await rpc.initialize();
    const start = Date.now(); await rpc.close();
    if (process.platform !== "win32") expect(Date.now() - start).toBeGreaterThanOrEqual(1900);
    await expect(rpc.request("account/read", {})).rejects.toThrow("连接已关闭");
  }, 5000);
  it("has no executable, file, or web tools on the real model wire request", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-wire-"));
    let capture!: (value: any) => void;
    const captured = new Promise<any>((resolve) => { capture = resolve; });
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        capture(JSON.parse(body));
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const emit = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        emit("response.created", { type: "response.created", response: { id: "response-test" } });
        emit("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { id: "message-test", type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] } });
        emit("response.completed", { type: "response.completed", response: { id: "response-test", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const launch = codexLaunch(process.cwd(), directory);
    await mkdir(launch.cwd, { recursive: true });
    launch.args.push("-c", 'model_provider="fixture"', "-c", 'model_providers.fixture.name="Fixture"', "-c", `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`, "-c", 'model_providers.fixture.wire_api="responses"', "-c", "model_providers.fixture.requires_openai_auth=false", "-c", "model_providers.fixture.request_max_retries=0", "-c", "model_providers.fixture.stream_max_retries=0");
    const rpc = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
    try {
      await rpc.initialize();
      const thread = await rpc.request("thread/start", { model: "gpt-5.4", cwd: launch.cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [], baseInstructions: "Reply with OK only." });
      const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP8z0AaYCJR/aiGUQ1DSAMAQC4BH2bjRnMAAAAASUVORK5CYII=";
      await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Test" }, { type: "image", url: image, detail: "high" }], effort: "high", environments: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
      const request = await Promise.race([captured, new Promise((_, reject) => setTimeout(() => reject(new Error("No local model request")), 10_000))]);
      const names = request.tools.map((tool: any) => tool.name ?? tool.type);
      expect(request.reasoning.effort).toBe("high");
      expect(request.input.flatMap((item: any) => item.content ?? [])).toContainEqual(expect.objectContaining({ type: "input_image", detail: "high" }));
      expect(names.filter((name: string) => !["update_plan", "request_user_input"].includes(name))).toEqual([]);
    } finally {
      await rpc.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 250)); await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("initializes the real binary with isolated auth and disabled command tools, without inference", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-"));
    const launch = codexLaunch(process.cwd(), directory);
    expect(launch.env.CODEX_HOME).toBe(path.join(directory, "codex"));
    expect(launch.env.OPENAI_API_KEY).toBeUndefined();
    expect(launch.env.CODEX_THREAD_ID).toBeUndefined();
    await mkdir(launch.cwd, { recursive: true });
    const rpc = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
    try {
      await rpc.initialize();
      expect(await rpc.request("account/read", { refreshToken: false })).toMatchObject({ account: null });
      const response = await rpc.request("config/read", { includeLayers: false });
      expect(response.config.features).toMatchObject({ shell_tool: false, unified_exec: false, multi_agent: false, apps: false });
      expect(response.config.cli_auth_credentials_store).toBe("file");
      expect(response.config.web_search).toBe("disabled");
    } finally { await rpc.close(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
  it("sends one authenticated provider request when the first response is unauthorized", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-auth-once-"));
    await mkdir(path.join(directory, "codex"), { recursive: true });
    await writeFile(path.join(directory, "codex", "auth.json"), JSON.stringify({
      tokens: { id_token: TEST_CHATGPT_ID_TOKEN, access_token: "fixture-access-token", refresh_token: "fixture-refresh-token", account_id: "fixture-account" },
      last_refresh: "2099-01-01T00:00:00Z",
    }));
    let requests = 0;
    const server = createServer((req, res) => {
      requests += 1;
      expect(req.headers.authorization).toBe("Bearer fixture-access-token");
      expect(req.headers["chatgpt-account-id"]).toBe("fixture-account");
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":{"message":"fixture unauthorized"}}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const launch = codexCompletionLaunch(process.cwd(), directory, { accessToken: "fixture-access-token", accountId: "fixture-account" });
    launch.args.push("-c", `model_providers.jianji_openai_once.base_url="http://127.0.0.1:${address.port}/v1"`);
    await mkdir(launch.cwd, { recursive: true });
    const rpc = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
    try {
      await rpc.initialize();
      const thread = await rpc.request("thread/start", { model: "gpt-5.4", cwd: launch.cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [], baseInstructions: "Reply with OK only." });
      const completed = new Promise<any>((resolve) => rpc.on("notification", (method, params) => {
        if (method === "turn/completed" && params?.threadId === thread.thread.id) resolve(params);
      }));
      await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Test" }], environments: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
      const result = await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error("No failed turn result")), 10_000))]);
      expect(result.turn.status).not.toBe("completed");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(requests).toBe(1);
    } finally {
      await rpc.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("does not retry when the provider socket closes before a response", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-socket-once-"));
    let requests = 0;
    const server = createServer((req) => {
      requests += 1;
      req.socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const launch = codexCompletionLaunch(process.cwd(), directory, { accessToken: "fixture-access-token", accountId: "fixture-account" });
    launch.args.push("-c", `model_providers.jianji_openai_once.base_url="http://127.0.0.1:${address.port}/v1"`);
    await mkdir(launch.cwd, { recursive: true });
    const rpc = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
    try {
      await rpc.initialize();
      const thread = await rpc.request("thread/start", { model: "gpt-5.4", cwd: launch.cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [], baseInstructions: "Reply with OK only." });
      const completed = new Promise<any>((resolve) => rpc.on("notification", (method, params) => {
        if (method === "turn/completed" && params?.threadId === thread.thread.id) resolve(params);
      }));
      await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Test" }], environments: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
      const result = await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error(`No failed turn result after ${requests} requests`)), 5_000))]);
      expect(result.turn.status).not.toBe("completed");
      expect(requests).toBe(1);
    } finally {
      await rpc.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("does not reconnect after an established provider stream is interrupted", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-stream-once-"));
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('event: response.created\ndata: {"type":"response.created","response":{"id":"response-test"}}\n\n');
      setImmediate(() => res.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const launch = codexCompletionLaunch(process.cwd(), directory, { accessToken: "fixture-access-token", accountId: "fixture-account" });
    launch.args.push("-c", `model_providers.jianji_openai_once.base_url="http://127.0.0.1:${address.port}/v1"`);
    await mkdir(launch.cwd, { recursive: true });
    const rpc = new CodexRpc(launch.command, launch.args, launch.env, launch.cwd);
    try {
      await rpc.initialize();
      const thread = await rpc.request("thread/start", { model: "gpt-5.4", cwd: launch.cwd, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", environments: [], baseInstructions: "Reply with OK only." });
      const completed = new Promise<any>((resolve) => rpc.on("notification", (method, params) => {
        if (method === "turn/completed" && params?.threadId === thread.thread.id) resolve(params);
      }));
      await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Test" }], environments: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
      const result = await Promise.race([completed, new Promise((_, reject) => setTimeout(() => reject(new Error(`No failed turn result after ${requests} requests`)), 5_000))]);
      expect(result.turn.status).not.toBe("completed");
      expect(requests).toBe(1);
    } finally {
      await rpc.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("projects only the access token and account id from the application auth store", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-credential-"));
    try {
      await mkdir(path.join(directory, "codex"), { recursive: true });
      await writeFile(path.join(directory, "codex", "auth.json"), JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { access_token: "fixture-access-token", account_id: "fixture-account", refresh_token: "must-not-escape", id_token: { email: "must-not-escape" } },
        OPENAI_API_KEY: "must-not-escape",
      }));
      expect(await readChatGPTExecutionCredential(directory)).toEqual({ accessToken: "fixture-access-token", accountId: "fixture-account" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("rejects an execution home that could re-enable managed auth recovery", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "jianji-codex-auth-isolation-"));
    try {
      await mkdir(path.join(directory, "codex"), { recursive: true });
      await writeFile(path.join(directory, "codex", "auth.json"), JSON.stringify({ tokens: { access_token: "fixture-access-token", account_id: "fixture-account" } }));
      await mkdir(path.join(directory, "codex-execution"), { recursive: true });
      await writeFile(path.join(directory, "codex-execution", "auth.json"), "{}");
      await expect(readChatGPTExecutionCredential(directory)).rejects.toThrow("登录凭据不可用");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
