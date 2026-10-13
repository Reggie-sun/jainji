import { createServer } from "node:net";
import path from "node:path";
import { QianchuanBrowserBindings, verifyOriginalProfile } from "./qianchuan-browser-bindings.js";
import { findExtensionProcess, readExtensionBrowserMetadata, verifyExtensionProcess } from "./qianchuan-extension-process.js";
import { installQianchuanExtensionHost, registerQianchuanExtensionProfile, type ExtensionHostConfig } from "./qianchuan-extension-install.js";
import { QIANCHUAN_EXTENSION_ORIGIN, extensionChanged, type ExtensionProcess } from "./qianchuan-extension-protocol.js";

export class RemoteExtensionHost {
  constructor(private readonly root: string, private readonly home: string) {}
  private async binding(advertiserId: string) {
    const root = path.join(this.root, "browsers"), original = await new QianchuanBrowserBindings(root).get(advertiserId);
    const binding = original ?? { advertiserId, profile: path.join(root, "account-browsers", advertiserId), profileDirectory: "Default" };
    await verifyOriginalProfile(binding); return binding;
  }
  async verify(advertiserId: string, identity: ExtensionProcess): Promise<string> {
    const binding = await this.binding(advertiserId);
    if (identity.profile !== binding.profile || identity.profileDirectory !== binding.profileDirectory) throw extensionChanged();
    return verifyExtensionProcess(identity);
  }
  async profile(advertiserId: string): Promise<{ profile: string; profileDirectory: string; browser?: { port: number; browserPath: string } }> {
    const binding = await this.binding(advertiserId), identity = await findExtensionProcess(binding.profile, binding.profileDirectory);
    const startedAt = await this.verify(advertiserId, identity);
    // Metadata only: no CDP request or page connection is made here.
    await registerQianchuanExtensionProfile(this.root, binding.profile);
    const metadata = await readExtensionBrowserMetadata(identity);
    const browser = metadata?.browserPath ? { port: metadata.port, browserPath: metadata.browserPath } : undefined;
    if (await this.verify(advertiserId, identity) !== startedAt) throw extensionChanged();
    return { profile: binding.profile, profileDirectory: binding.profileDirectory, ...(browser ? { browser } : {}) };
  }
  async setup(config: Omit<ExtensionHostConfig, "version" | "extensionOrigin">, advertiserId: string): Promise<{ port: number }> {
    let port = config.port;
    if (!port) port = await new Promise<number>((resolve, reject) => {
      const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") { server.close(); reject(extensionChanged()); return; } server.close(error => error ? reject(error) : resolve(address.port)); });
    });
    const binding = await this.binding(advertiserId);
    await installQianchuanExtensionHost(this.root, { version: 1, port, token: config.token, extensionOrigin: QIANCHUAN_EXTENSION_ORIGIN }, { profiles: [binding.profile], resources: path.join(path.dirname(process.argv[1]), "qianchuan-extension") });
    return { port };
  }
}
