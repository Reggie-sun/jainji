import type { ProgressEvent, RunningCommand } from "./ffmpeg.js";

type StartProbe = (args: string[], onProgress: (event: ProgressEvent) => void) => RunningCommand;

/** Keep encoders open until every session has produced frames at the same time. */
export async function probeConcurrentEncodes(singleArgs: string[], count: number, start: StartProbe, timeoutMs = 5_000): Promise<boolean> {
  const args = [...singleArgs];
  args.splice(args.indexOf("-frames:v"), 2);
  args.splice(args.indexOf("-i"), 0, "-re");
  args[args.indexOf("-i") + 1] = "color=size=1280x720:rate=30";
  args.splice(args.indexOf("-f"), 0, "-filter_threads", "1", "-threads", "1");
  args.splice(args.indexOf("-pix_fmt"), 0, "-threads", "1");
  args.splice(args.length - 1, 0, "-progress", "pipe:1");
  const commands: RunningCommand[] = [];
  const ready = new Set<number>();
  let finish!: (success: boolean) => void;
  const settled = new Promise<boolean>((resolve) => { finish = resolve; });
  let overlapTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => finish(false), timeoutMs);
  const checkOverlap = () => {
    if (commands.length !== count || ready.size !== count || overlapTimer) return;
    overlapTimer = setTimeout(() => finish(commands.every((command) => command.process.exitCode === null)), 200);
  };
  try {
    for (let index = 0; index < count; index++) {
      const command = start(args, (event) => {
        if ((event.outTimeMs ?? 0) > 0 && event.progress !== 1) { ready.add(index); checkOverlap(); }
      });
      commands.push(command);
      // These inputs are intentionally open-ended: any early exit invalidates capacity.
      void command.promise.then(() => finish(false), () => finish(false));
    }
    checkOverlap();
    return await settled;
  } finally {
    clearTimeout(timeout);
    clearTimeout(overlapTimer);
    for (const command of commands) if (command.process.exitCode === null) command.process.kill("SIGKILL");
    await Promise.allSettled(commands.map((command) => command.promise));
  }
}
