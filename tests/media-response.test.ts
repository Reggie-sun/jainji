import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mediaResponse } from "../src/main/media-response";

describe("authorized video byte responses", () => {
  let directory: string, file: string;
  beforeAll(async () => { directory = await mkdtemp(path.join(tmpdir(), "jianji-range-")); file = path.join(directory, "video.mp4"); await writeFile(file, "0123456789"); });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
  it("advertises the complete file length and seek support", async () => {
    const response = await mediaResponse(file, new Request("http://local/video"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe("0123456789");
  });
  it.each([["bytes=2-4", "234", "bytes 2-4/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"]])("serves %s as a partial response", async (range, content, contentRange) => {
    const response = await mediaResponse(file, new Request("http://local/video", { headers: { Range: range } }));
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(content.length));
    expect(await response.text()).toBe(content);
  });
  it.each(["bytes=10-", "bytes=5-2", "bytes=-0", "bytes=-", "bytes=1-2,4-5", "bad"])("rejects unsatisfiable or unsupported range %s", async (range) => {
    const response = await mediaResponse(file, new Request("http://local/video", { headers: { Range: range } }));
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */10");
  });
  it("returns HEAD metadata without streaming a body", async () => {
    const response = await mediaResponse(file, new Request("http://local/video", { method: "HEAD" }));
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.body).toBeNull();
  });
});
