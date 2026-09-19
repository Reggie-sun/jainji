import { describe, expect, it, vi } from "vitest";
import { encoderDeviceArgs, encoderPixelFormat, previewEncodingArgs, selectH264Encoder, videoEncodingArgs } from "../src/main/video-encoder";

describe("H.264 encoder selection", () => {
  it("prefers NVENC only after an actual encode succeeds", async () => {
    const probe = vi.fn(async (_args: string[]) => true);
    expect(await selectH264Encoder(" V....D h264_nvenc NVIDIA\n V....D libx264 CPU", probe)).toBe("h264_nvenc");
    expect(probe).toHaveBeenCalledOnce();
    const args = probe.mock.calls[0][0];
    expect(args).toContain("h264_nvenc");
    expect(args).toContain("-frames:v");
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });

  it.each([false, new Error("driver unavailable")])("uses CPU when the compiled GPU encoder is unusable: %s", async (result) => {
    const probe = async () => { if (result instanceof Error) throw result; return result; };
    expect(await selectH264Encoder("h264_nvenc libx264", probe)).toBe("libx264");
  });

  it("does not probe hardware absent from the binary", async () => {
    const probe = vi.fn(async () => true);
    expect(await selectH264Encoder("libx264", probe)).toBe("libx264");
    expect(probe).not.toHaveBeenCalled();
  });

  it("does not claim an encoder when neither route works", async () => {
    expect(await selectH264Encoder("h264_nvenc", async () => false)).toBeUndefined();
  });

  it("allows a verified GPU encoder even without libx264", async () => {
    expect(await selectH264Encoder("h264_nvenc", async () => true)).toBe("h264_nvenc");
  });

  it("tries AMD after a failed NVIDIA probe", async () => {
    const probe = vi.fn(async (args: string[]) => args[args.indexOf("-c:v") + 1] === "h264_amf");
    expect(await selectH264Encoder("h264_nvenc h264_amf libx264", probe)).toBe("h264_amf");
    expect(probe.mock.calls.map(([args]) => args[args.indexOf("-c:v") + 1])).toEqual(["h264_nvenc", "h264_amf"]);
  });

  it("tries Intel after unavailable NVIDIA and AMD probes", async () => {
    const probe = vi.fn(async (args: string[]) => args[args.indexOf("-c:v") + 1] === "h264_qsv");
    expect(await selectH264Encoder("h264_nvenc h264_amf h264_qsv libx264", probe)).toBe("h264_qsv");
    expect(probe.mock.calls.map(([args]) => args[args.indexOf("-c:v") + 1])).toEqual(["h264_nvenc", "h264_amf", "h264_qsv"]);
  });

  it("continues after a throwing hardware probe and falls back to CPU", async () => {
    const probe = vi.fn(async () => { throw new Error("device unavailable"); });
    expect(await selectH264Encoder("h264_nvenc h264_amf h264_qsv libx264", probe)).toBe("libx264");
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("uses the encoder pixel format in hardware probes", async () => {
    const probe = vi.fn(async (_args: string[]) => true);
    await selectH264Encoder("h264_amf", probe);
    const args = probe.mock.calls[0][0];
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("nv12");
  });

  it("requires QSV hardware device initialization before probing", async () => {
    const probe = vi.fn(async (_args: string[]) => false);
    expect(await selectH264Encoder("h264_qsv libx264", probe)).toBe("libx264");
    const args = probe.mock.calls[0][0];
    expect(args.slice(args.indexOf("-init_hw_device"), args.indexOf("-init_hw_device") + 2)).toEqual(["-init_hw_device", "qsv:hw"]);
    expect(args.indexOf("-init_hw_device")).toBeLessThan(args.indexOf("-f"));
  });
});

describe("encoder-specific quality options", () => {
  it.each(["high", "balanced", "small"] as const)("uses NVENC options for %s without x264-only flags", (quality) => {
    const args = videoEncodingArgs("h264_nvenc", quality);
    expect(args[args.indexOf("-c:v") + 1]).toBe("h264_nvenc");
    expect(args[args.indexOf("-preset") + 1]).toMatch(/^p[1-7]$/);
    expect(args[args.indexOf("-rc") + 1]).toBe("vbr");
    expect(args[args.indexOf("-b:v") + 1]).toBe("0");
    expect(args).toContain("-cq");
    expect(args).not.toContain("-crf");
  });

  it("preserves software encoding quality defaults", () => {
    expect(videoEncodingArgs("libx264", "balanced")).toEqual(["-c:v", "libx264", "-preset", "medium", "-crf", "23"]);
    expect(videoEncodingArgs("libx264", "high")).toContain("slow");
  });

  it.each([
    ["high", "quality", "18"],
    ["balanced", "balanced", "23"],
    ["small", "speed", "28"],
  ] as const)("uses AMF CQP options for %s", (quality, amfQuality, qp) => {
    expect(videoEncodingArgs("h264_amf", quality)).toEqual([
      "-c:v", "h264_amf", "-quality", amfQuality, "-rc", "cqp", "-qp_i", qp, "-qp_p", qp, "-qp_b", qp,
    ]);
  });

  it.each([
    ["high", "slow", "18"],
    ["balanced", "medium", "23"],
    ["small", "fast", "28"],
  ] as const)("uses QSV quality options for %s", (quality, preset, globalQuality) => {
    expect(videoEncodingArgs("h264_qsv", quality)).toEqual([
      "-c:v", "h264_qsv", "-preset", preset, "-global_quality", globalQuality,
    ]);
  });

  it.each([
    ["libx264", "yuv420p"],
    ["h264_nvenc", "yuv420p"],
    ["h264_amf", "nv12"],
    ["h264_qsv", "nv12"],
  ] as const)("uses %s pixel format %s", (encoder, pixelFormat) => {
    expect(encoderPixelFormat(encoder)).toBe(pixelFormat);
  });

  it.each([
    ["libx264", []],
    ["h264_nvenc", []],
    ["h264_amf", []],
    ["h264_qsv", ["-init_hw_device", "qsv:hw"]],
  ] as const)("uses %s device arguments", (encoder, deviceArgs) => {
    expect(encoderDeviceArgs(encoder)).toEqual(deviceArgs);
  });
});

describe("preview draft encoding options", () => {
  it("uses the fastest NVENC preset with draft quality for review samples", () => {
    const args = previewEncodingArgs("h264_nvenc");
    expect(args[args.indexOf("-c:v") + 1]).toBe("h264_nvenc");
    expect(args[args.indexOf("-preset") + 1]).toBe("p1");
    expect(args[args.indexOf("-rc") + 1]).toBe("vbr");
    expect(args[args.indexOf("-cq") + 1]).toBe("30");
    expect(args).not.toContain("-tune");
  });

  it("uses fast software draft encoding for review samples", () => {
    expect(previewEncodingArgs("libx264")).toEqual(["-c:v", "libx264", "-preset", "veryfast", "-crf", "28"]);
  });

  it("uses speed-first AMF and QSV draft encoding", () => {
    expect(previewEncodingArgs("h264_amf")).toEqual([
      "-c:v", "h264_amf", "-quality", "speed", "-rc", "cqp", "-qp_i", "30", "-qp_p", "30", "-qp_b", "30",
    ]);
    expect(previewEncodingArgs("h264_qsv")).toEqual(["-c:v", "h264_qsv", "-preset", "veryfast", "-global_quality", "30"]);
  });
});
