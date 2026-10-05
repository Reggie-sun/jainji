import { it, expect } from "vitest";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverBinary } from "../src/main/ffmpeg.js";
import { identifySource } from "../src/main/source-sticker-knowledge-store.js";
import { prepareDiscoveryEvidence, discoveryHash } from "../src/main/source-fact-discovery-evidence.js";
import { discoverStationaryTargets } from "../src/main/shape-cover-stationary-discovery.js";
import { buildVisionCandidatePacket } from "../src/main/shape-cover-vision-packet.js";
import { decodeShapeCoverPng } from "../src/main/shape-cover-alpha.js";

it("builds context and crops from actual M1 frames with deterministic pixel mapping, cancellation and source drift rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "jianji-hybrid-packet-"));
  const ffmpeg = { ffmpegPath: (await discoverBinary("ffmpeg"))!, ffprobePath: (await discoverBinary("ffprobe"))! };
  const signal = new AbortController().signal, tools = { ...ffmpeg, signal };
  const width = 48, height = 40, raw = Buffer.alloc(width * height * 3 * 12);
  for (let f = 0; f < 12; f++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = x >= 10 && x < 22 && y >= 10 && y < 20 ? ((x + y) % 3 ? 240 : 20) : (f * 103 + x * 13 + y * 11) % 230 + 10;
    const p = ((f * height + y) * width + x) * 3; raw.fill(value, p, p + 3);
  }
  const sourcePath = join(root, "private-source.mp4");
  let evidence: Awaited<ReturnType<typeof prepareDiscoveryEvidence>> | undefined;
  try {
    const render = spawnSync(ffmpeg.ffmpegPath, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height}`, "-r", "6", "-i", "pipe:0",
      "-vf", "setsar=1", "-c:v", "libx264", "-qp", "0", "-bf", "0", "-pix_fmt", "yuv444p", "-video_track_timescale", "6000", "-n", sourcePath], { input: raw, timeout: 20000 });
    expect(render.status).toBe(0);
    const source = await identifySource(sourcePath, { width, height, rotation: 0, durationMs: 2000, timeBase: "1/6000", timeOriginPts: 0, interpretationVersion: 1 });
    evidence = await prepareDiscoveryEvidence({ sourcePath, source, ffmpeg, signal }, { frames: 12 });
    const result = await discoverStationaryTargets(evidence, signal), id = result.components.find(c => c.state === "CANDIDATE")!.id;
    const packet = await buildVisionCandidatePacket(evidence, [id], tools);
    expect(packet.packetDigest).toBe((await buildVisionCandidatePacket(evidence, [id], tools)).packetDigest);
    const images = packet.content().filter(i => i.type === "image_url");
    expect(images).toHaveLength(6); expect(packet.manifest.images.map(i => i.ordinal)).toEqual([0, 0, 5, 5, 11, 11]);
    expect(JSON.stringify(packet.content())).not.toContain(sourcePath);
    for (let i = 0; i < images.length; i++) {
      const binding = packet.manifest.images[i], item = images[i];
      if (item.type !== "image_url") throw Error("missing image");
      const png = Buffer.from(item.image_url.url.split(",")[1], "base64");
      expect(discoveryHash(png)).toBe(binding.imageSha256);
      const decoded = await decodeShapeCoverPng(png, binding.crop, tools);
      const original = await evidence.readFrame(evidence.receipt.frames.findIndex(f => f.index === binding.ordinal));
      const expected = Buffer.alloc(decoded.length), b = binding.crop;
      for (let y = 0; y < b.height; y++) original.copy(expected, y * b.width * 4, ((b.y + y) * width + b.x) * 4, ((b.y + y) * width + b.x + b.width) * 4);
      expect(decoded.equals(expected)).toBe(true);
    }
    await expect(buildVisionCandidatePacket(evidence, ["invented"], tools)).rejects.toThrow(/CANDIDATE/);
    await expect(buildVisionCandidatePacket(evidence, [id], { ...tools, signal: AbortSignal.abort() })).rejects.toThrow();
    await appendFile(sourcePath, Buffer.from([1])); await expect(packet.verifyFresh()).rejects.toThrow(/generation/);
  } finally { await evidence?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
