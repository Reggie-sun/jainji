import { describe, expect, it, vi } from "vitest";
import { selectH264Encoder, videoEncodingArgs } from "../src/main/video-encoder";

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
});
