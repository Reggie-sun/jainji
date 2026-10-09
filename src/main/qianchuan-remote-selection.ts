import { randomUUID } from "node:crypto";
import type { ElementHandle, Page } from "playwright-core";

/** CDP paths are resolved by VPS Chrome, never by Playwright's local filesystem helper. */
export async function selectRemoteFiles(page: Page, element: ElementHandle, files: string[], signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!files.length || files.length > 9 || files.some(file => !file.startsWith("/") || /[\u0000-\u001f]/.test(file)) || await element.ownerFrame() !== page.mainFrame()) throw new Error("Invalid remote file selection");
  const key = `__jianji_remote_${randomUUID().replaceAll("-", "")}`, session = await page.context().newCDPSession(page);
  try {
    await page.evaluate(({ input, name }) => {
      if (!(input instanceof HTMLInputElement) || input.type !== "file" || !input.multiple) throw new Error("Invalid file input");
      Object.defineProperty(globalThis, name, { value: input, configurable: true });
    }, { input: element, name: key });
    signal.throwIfAborted();
    const { result } = await session.send("Runtime.evaluate", { expression: `globalThis[${JSON.stringify(key)}]`, objectGroup: key });
    if (!result.objectId) throw new Error("File input unavailable");
    signal.throwIfAborted();
    await session.send("DOM.setFileInputFiles", { objectId: result.objectId, files });
    signal.throwIfAborted();
  } finally {
    await session.send("Runtime.evaluate", { expression: `delete globalThis[${JSON.stringify(key)}]` }).catch(() => undefined);
    await session.send("Runtime.releaseObjectGroup", { objectGroup: key }).catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}
