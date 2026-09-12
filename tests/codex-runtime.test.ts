import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { codexLaunch } from "../src/main/model-connections";
import { CodexRpc } from "../src/main/codex-rpc";

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
      await rpc.request("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Test" }], effort: "high", environments: [], sandboxPolicy: { type: "readOnly", networkAccess: false } });
      const request = await Promise.race([captured, new Promise((_, reject) => setTimeout(() => reject(new Error("No local model request")), 10_000))]);
      const names = request.tools.map((tool: any) => tool.name ?? tool.type);
      expect(request.reasoning.effort).toBe("high");
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
});
