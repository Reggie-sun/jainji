import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/** Serve an already-authorized local video with Chromium's byte-range contract. */
export async function mediaResponse(file: string, request: Request): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const { size } = await stat(file);
  const types: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".webm": "video/webm", ".avi": "video/x-msvideo" };
  const headers = new Headers({ "Content-Type": types[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Accept-Ranges": "bytes" });
  const range = request.method === "GET" ? request.headers.get("range") : null;
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  const body = request.method === "HEAD" || size === 0 ? null : Readable.toWeb(createReadStream(file, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers });
}
