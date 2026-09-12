import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatGPTSession, trustedLoginUrl } from "../src/main/chatgpt-session";
import type { RpcClient } from "../src/main/codex-rpc";

class FakeRpc extends EventEmitter implements RpcClient {
  account: unknown = null;
  models = [{ model: "vision", isDefault: true, hidden: false, inputModalities: ["text", "image"] }, { model: "vision-next", isDefault: false, hidden: false, inputModalities: ["image"] }, { model: "text-only", isDefault: false, hidden: false, inputModalities: ["text"] }];
  request = vi.fn(async (method: string, _params: unknown): Promise<any> => {
    if (method === "account/read") return { account: this.account };
    if (method === "model/list") return { data: this.models };
    if (method === "account/login/start") return { type: "chatgpt", loginId: "login", authUrl: "https://auth.openai.com/authorize?state=fake" };
    if (method === "thread/start") return { thread: { id: "thread" } };
    if (method === "turn/start") return { turn: { id: "turn" } };
    if (method === "account/logout") this.account = null;
    return {};
  });
  close() { this.emit("closed"); }
}
const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "jianji-chatgpt-")); directories.push(directory);
  const rpc = new FakeRpc(); const browser = vi.fn().mockResolvedValue(undefined);
  const session = new ChatGPTSession(async () => rpc, browser, directory, () => {});
  return { rpc, session, browser };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

describe("managed ChatGPT session", () => {
  it("restores saved effort and requires reselection if the catalog withdraws it", async () => {
    const { rpc, session: unused } = await setup(); await unused.dispose(); rpc.account = { type: "chatgpt" };
    Object.assign(rpc.models[0], { supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Deep" }], defaultReasoningEffort: "high" });
    const session = new ChatGPTSession(async () => rpc, async () => {}, directories.at(-1)!, () => {}, () => "vision", () => "high");
    await session.refresh(); expect(session.status().reasoningEffort).toBe("high");
    Object.assign(rpc.models[0], { supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Quick" }], defaultReasoningEffort: "low" });
    await session.refresh(); expect(session.status().model).toBeUndefined();
    expect(session.status().message).toContain("档位");
    await expect(session.complete([], new AbortController().signal)).rejects.toThrow();
    await session.dispose();
  });
  it("exposes model-specific efforts, passes selection to turn/start, and rejects unsupported levels", async () => {
    const { rpc, session } = await setup(); rpc.account = { type: "chatgpt" };
    Object.assign(rpc.models[0], { supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Quick" }, { reasoningEffort: "ultra", description: "Deep" }], defaultReasoningEffort: "low" });
    await session.refresh();
    expect(session.status().models?.[0].supportedReasoningEfforts).toEqual([{ reasoningEffort: "low", description: "Quick" }, { reasoningEffort: "ultra", description: "Deep" }]);
    expect(session.status().reasoningEffort).toBe("low");
    expect(() => session.selectModel("vision", "high")).toThrow();
    session.selectModel("vision", "ultra");
    const result = session.complete([{ role: "user", content: "brief" }], new AbortController().signal);
    await vi.waitFor(() => expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.objectContaining({ effort: "ultra" })));
    rpc.emit("notification", "item/completed", { threadId: "thread", item: { type: "agentMessage", text: "ok" } });
    rpc.emit("notification", "turn/completed", { threadId: "thread", turn: { status: "completed" } });
    expect(await result).toBe("ok");
    session.selectModel("vision"); expect(session.status().reasoningEffort).toBe("low");
    await session.dispose();
  });
  it("loads later model pages and excludes hidden and text-only entries", async () => {
    const { rpc, session } = await setup(); rpc.account = { type: "chatgpt" };
    rpc.request.mockImplementation(async (method, params: any) => {
      if (method === "account/read") return { account: rpc.account };
      if (method === "model/list") return params.cursor ? { data: [rpc.models[1]], nextCursor: null } : { data: [rpc.models[0], rpc.models[2], { ...rpc.models[1], model: "hidden", hidden: true }], nextCursor: "page-2" };
      return {};
    });
    await session.refresh();
    expect(session.status().models?.map((item) => item.model)).toEqual(["vision", "vision-next"]);
    expect(rpc.request).toHaveBeenCalledWith("model/list", { includeHidden: false, cursor: "page-2" });
    await session.dispose();
  });
  it("uses the selected vision model on the actual thread and rejects unavailable models", async () => {
    const { rpc, session } = await setup(); rpc.account = { type: "chatgpt" }; await session.refresh();
    expect(session.status().models?.map((item) => item.model)).toEqual(["vision", "vision-next"]);
    expect(() => session.selectModel("text-only")).toThrow();
    expect(() => session.selectModel("unknown")).toThrow();
    session.selectModel("vision-next");
    const result = session.complete([{ role: "user", content: "brief" }], new AbortController().signal);
    await vi.waitFor(() => expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.anything()));
    expect(rpc.request).toHaveBeenCalledWith("thread/start", expect.objectContaining({ model: "vision-next", environments: [] }));
    rpc.emit("notification", "item/completed", { threadId: "thread", item: { type: "agentMessage", text: "ok" } });
    rpc.emit("notification", "turn/completed", { threadId: "thread", turn: { status: "completed" } });
    expect(await result).toBe("ok"); await session.dispose();
  });
  it("restores the preferred model and requires reselection if it is no longer available", async () => {
    const { rpc, session: unused } = await setup(); await unused.dispose();
    rpc.account = { type: "chatgpt" };
    const session = new ChatGPTSession(async () => rpc, async () => {}, directories.at(-1)!, () => {}, () => "vision-next");
    await session.refresh(); expect(session.status().model).toBe("vision-next");
    rpc.models = rpc.models.filter((item) => item.model !== "vision-next");
    await session.refresh(); expect(session.status().model).toBeUndefined();
    expect(session.status().message).toContain("重新选择");
    await expect(session.complete([], new AbortController().signal)).rejects.toThrow();
    await session.dispose();
  });
  it("accepts a new login while a cancelled login metadata request is still pending", async () => {
    const { rpc, session } = await setup(); await session.login();
    let finish!: (value: unknown) => void;
    rpc.request.mockImplementationOnce(() => new Promise((ok) => { finish = ok; }));
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await session.cancelLogin(); await session.login();
    rpc.account = { type: "chatgpt" };
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    rpc.emit("notification", "account/updated", { authMode: "chatgpt" });
    await vi.waitFor(() => expect(session.status().status).toBe("ready"));
    finish({ account: null }); await new Promise((ok) => setTimeout(ok, 0));
    expect(session.status().status).toBe("ready"); await session.dispose();
  });
  it.each(["null", "error"])("does not let a stale notification refresh overwrite a manual refresh: %s", async (failure) => {
    const { rpc, session } = await setup(); await session.login();
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    rpc.request.mockImplementationOnce(() => new Promise((ok, no) => { resolve = ok; reject = no; }));
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    rpc.account = { type: "chatgpt" }; expect(await session.refresh()).toBe(true);
    if (failure === "null") resolve({ account: null }); else reject(new Error("stale failure"));
    await new Promise((ok) => setTimeout(ok, 0));
    expect(session.status().status).toBe("ready"); await session.dispose();
  });
  it("recovers a persisted login without a completion event and clears its cancellation timer", async () => {
    const { rpc, session } = await setup();
    await session.login();
    rpc.account = { type: "chatgpt" };
    expect(await session.refresh()).toBe(true);
    expect(session.status().status).toBe("ready");
    await session.cancelLogin();
    expect(rpc.request).not.toHaveBeenCalledWith("account/logout", {});
    await session.dispose();
  });
  it("keeps existing credentials when a metadata read fails while reconnecting", async () => {
    const { rpc, session } = await setup();
    rpc.account = { type: "chatgpt" };
    rpc.request.mockRejectedValueOnce(new Error("private remote failure"));
    await expect(session.login()).rejects.toThrow("账户信息");
    expect(rpc.request).not.toHaveBeenCalledWith("account/logout", {});
    expect(session.status().status).toBe("error");
    expect(await session.refresh()).toBe(true);
    await session.dispose();
  });
  it("opens official OAuth, reacts only to the matching completion and exposes account metadata", async () => {
    const { rpc, session, browser } = await setup();
    await session.login();
    expect(browser).toHaveBeenCalledWith("https://auth.openai.com/authorize?state=fake");
    expect(session.status().status).toBe("logging-in");
    rpc.emit("notification", "account/login/completed", { loginId: "different", success: true });
    expect(session.status().status).toBe("logging-in");
    rpc.account = { type: "chatgpt", email: "test@example.test", planType: "plus", tokens: "must-not-escape" };
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    await vi.waitFor(() => expect(session.status().status).toBe("ready"));
    expect(session.status()).toEqual({ status: "ready", email: "test@example.test", plan: "plus", model: "vision", models: [{ model: "vision", displayName: "vision", supportedReasoningEfforts: [] }, { model: "vision-next", displayName: "vision-next", supportedReasoningEfforts: [] }] });
    session.dispose();
  });
  it("refreshes again when account/updated follows a successful login before account/read is ready", async () => {
    const { rpc, session } = await setup();
    await session.login();
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    await vi.waitFor(() => expect(session.status().message).toContain("同步"));
    rpc.account = { type: "chatgpt", email: "test@example.test", planType: "plus" };
    rpc.emit("notification", "account/updated", { authMode: "chatgpt", planType: "plus" });
    await vi.waitFor(() => expect(session.status()).toMatchObject({ status: "ready", email: "test@example.test", plan: "plus", model: "vision" }));
    session.dispose();
  });
  it("cancels login and ignores its late success notification", async () => {
    const { rpc, session } = await setup();
    await session.login(); await session.cancelLogin();
    expect(rpc.request).toHaveBeenCalledWith("account/login/cancel", { loginId: "login" });
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    expect(session.status().status).toBe("signed-out"); session.dispose();
  });
  it("does not reactivate a session cancelled while models were loading", async () => {
    const { rpc, session } = await setup();
    rpc.account = { type: "chatgpt" };
    let finish!: (value: any) => void;
    rpc.request.mockImplementation(async (method) => method === "account/read" ? { account: rpc.account } : new Promise((resolve) => { finish = resolve; }));
    const refresh = session.refresh();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await session.cancelLogin();
    finish({ data: [{ model: "vision", isDefault: true, hidden: false }] });
    expect(await refresh).toBe(false); expect(session.status().status).toBe("signed-out"); session.dispose();
  });
  it("clears a login already persisted when cancel returns notFound", async () => {
    const { rpc, session } = await setup();
    await session.login();
    rpc.account = { type: "chatgpt", email: "test@example.test" };
    rpc.request.mockImplementationOnce(async () => ({ status: "notFound" }));
    await session.cancelLogin();
    rpc.emit("notification", "account/login/completed", { loginId: "login", success: true });
    expect(rpc.request).toHaveBeenCalledWith("account/logout", {});
    expect(await session.refresh()).toBe(false);
    expect(session.status().status).toBe("signed-out"); session.dispose();
  });
  it("does not claim logout succeeded when the credentials could remain", async () => {
    const { rpc, session } = await setup();
    rpc.account = { type: "chatgpt" }; await session.refresh();
    rpc.request.mockRejectedValueOnce(new Error("raw-sensitive-error"));
    await expect(session.logout()).rejects.toThrow("退出登录未完成");
    expect(session.status()).toEqual({ status: "error", message: "未能确认退出登录，请重新连接后退出。" });
    expect(rpc.account).not.toBeNull(); session.dispose();
  });
  it("sends images in an ephemeral read-only turn, ignores commentary and other threads", async () => {
    const { rpc, session } = await setup();
    rpc.account = { type: "chatgpt" }; await session.refresh();
    const result = session.complete([{ role: "system", content: "hard rules" }, { role: "user", content: [{ type: "text", text: "brief" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,aA==", detail: "low" } }] }], new AbortController().signal);
    await vi.waitFor(() => expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.anything()));
    expect(rpc.request).toHaveBeenCalledWith("thread/start", expect.objectContaining({ ephemeral: true, sandbox: "read-only", approvalPolicy: "never", developerInstructions: "hard rules", environments: [] }));
    expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.objectContaining({ input: [{ type: "text", text: "brief" }, { type: "image", url: "data:image/jpeg;base64,aA==", detail: "low" }], sandboxPolicy: { type: "readOnly", networkAccess: false }, environments: [] }));
    rpc.emit("notification", "turn/completed", { threadId: "other", turn: { status: "failed" } });
    rpc.emit("notification", "item/completed", { threadId: "thread", item: { type: "agentMessage", text: "comment", phase: "commentary" } });
    rpc.emit("notification", "item/completed", { threadId: "thread", item: { type: "agentMessage", text: '{"summary":"ok"}', phase: "final_answer" } });
    rpc.emit("notification", "turn/completed", { threadId: "thread", turn: { status: "completed" } });
    expect(await result).toBe('{"summary":"ok"}');
    expect(rpc.request).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread" });
    expect(rpc.listenerCount("notification")).toBe(1); session.dispose();
  });
  it("allows task-requested plain text without weakening tool restrictions", async () => {
    const { rpc, session } = await setup();
    rpc.account = { type: "chatgpt" }; await session.refresh();
    const result = session.complete([{ role: "system", content: "Return a plain Chinese creative brief." }, { role: "user", content: "自然风格" }], new AbortController().signal);
    await vi.waitFor(() => expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.anything()));
    const params = rpc.request.mock.calls.find(([method]) => method === "thread/start")![1] as { baseInstructions: string };
    expect(params.baseInstructions).not.toContain("Return only the requested JSON");
    expect(params.baseInstructions).toContain("Do not use tools, commands, files, skills, or external services");
    rpc.emit("notification", "item/completed", { threadId: "thread", item: { type: "agentMessage", text: "保留自然光与留白。", phase: "final_answer" } });
    rpc.emit("notification", "turn/completed", { threadId: "thread", turn: { status: "completed" } });
    expect(await result).toBe("保留自然光与留白。");
    session.dispose();
  });
  it("interrupts a cancelled request and drops provider error details", async () => {
    const { rpc, session } = await setup();
    rpc.account = { type: "chatgpt" }; await session.refresh();
    const abort = new AbortController();
    const result = session.complete([{ role: "user", content: "test" }], abort.signal);
    const rejected = expect(result).rejects.toThrow("已停止生成");
    await vi.waitFor(() => expect(rpc.request).toHaveBeenCalledWith("turn/start", expect.anything()));
    abort.abort(); await rejected;
    expect(rpc.request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread", turnId: "turn" });
    const failure = session.complete([{ role: "user", content: "test" }], new AbortController().signal);
    const failed = expect(failure).rejects.toThrow("ChatGPT 任务失败");
    await vi.waitFor(() => expect(rpc.request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(2));
    rpc.emit("notification", "turn/completed", { threadId: "thread", turn: { status: "failed", error: { message: "secret-token-raw-body" } } });
    await failed; session.dispose();
  });
  it("rejects nonofficial browser targets", () => {
    for (const url of ["http://auth.openai.com", "https://auth.openai.com.evil.test", "file:///tmp/a", "https://user@chatgpt.com/"]) expect(() => trustedLoginUrl(url)).toThrow();
  });
});
