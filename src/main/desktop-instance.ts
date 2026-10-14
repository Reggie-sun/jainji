import { lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

interface InstanceApplication {
  getPath(name: "userData" | "sessionData"): string;
  setPath(name: "userData" | "sessionData", value: string): void;
  requestSingleInstanceLock(data?: Record<string, unknown>): boolean;
}

/** Each development window retains one Electron/store owner and a reusable profile. */
export function claimDesktopInstance(app: InstanceApplication, input: { multiple: boolean; directory?: string }) {
  const root = app.getPath("userData");
  const instances = path.join(root, "instances");
  const claim = (directory: string) => {
    const primary = directory === root;
    if (!primary) {
      mkdirSync(instances, { recursive: true, mode: 0o700 });
      if (lstatSync(instances).isSymbolicLink()) throw new Error("多开数据目录不能是符号链接。");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (lstatSync(directory).isSymbolicLink()) throw new Error("多开数据目录不能是符号链接。");
      app.setPath("userData", directory);
      app.setPath("sessionData", directory);
    }
    return { locked: app.requestSingleInstanceLock(input.multiple ? { independentWindow: true } : undefined), primary, directory };
  };
  if (!input.multiple) return claim(root);
  if (input.directory) {
    if (input.directory !== root && (path.dirname(input.directory) !== instances || !/^[1-9]\d*$/.test(path.basename(input.directory)))) {
      throw new Error("开发窗口的数据目录无效。");
    }
    return claim(input.directory);
  }
  const primary = claim(root);
  if (primary.locked) return primary;
  for (let slot = 1; slot <= 32; slot++) {
    const instance = claim(path.join(instances, String(slot)));
    if (instance.locked) return instance;
  }
  throw new Error("多开窗口已达到上限或数据目录不可用，请关闭空闲窗口后重试。");
}
