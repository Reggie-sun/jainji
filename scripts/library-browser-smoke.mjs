// Local Chrome fixture: production picker + real verified downloads, no model calls.
import { build } from "esbuild";
import { createServer } from "vite";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-library-browser-"));
const bundle = path.join(directory, "library.mjs");
await build({ entryPoints: ["src/main/asset-library.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle });
const { AssetLibrary } = await import(pathToFileURL(bundle).href);
const library = new AssetLibrary(path.join(directory, "cache"));
let server;
const manifest = JSON.parse(await readFile("src/shared/asset-manifest.json", "utf8"));
const handle = async (request, response, next) => {
  const url = new URL(request.url, "http://127.0.0.1:5187");
  if (url.pathname === "/__library-asset") {
    try { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(await library.preview(url.searchParams.get("id")))); }
    catch { response.statusCode = 502; response.end("Asset download failed"); }
    return;
  }
  if (url.pathname !== "/__library-proof") return next();
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(await server.transformIndexHtml(url.pathname, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="proof" style="max-width:1100px;margin:auto"></main><script type="module">
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {DecorationPicker} from '/src/renderer/DecorationPicker.tsx';
    import '/src/renderer/styles.css';
    window.jianji = {
      decorationCatalog: async()=>({fonts:[],stickers:[]}),
      libraryAsset: async(id)=>{const r=await fetch('/__library-asset?id='+encodeURIComponent(id));if(!r.ok)throw Error('download');return r.json();}
    };
    function Fixture(){const [value,setValue]=React.useState({sticker:'template',fontFamily:'Noto Sans CJK SC'});window.proofSelection=value;return React.createElement(DecorationPicker,{value,onChange:setValue,disabled:false});}
    createRoot(document.getElementById('proof')).render(React.createElement(React.StrictMode,null,React.createElement(Fixture)));
  </script></body></html>`));
};
server = await createServer({ cacheDir: path.join(directory, "vite-cache"), optimizeDeps: { include: ["react", "react-dom/client"] }, plugins: [{ name: "library-proof", configureServer(instance) { instance.middlewares.use(handle); } }], server: { host: "127.0.0.1", port: 5187 } });
await server.listen();
console.log(`Browser fixture: http://127.0.0.1:5187/__library-proof (${manifest.assets.length} assets); cache ${directory}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await server.close(); process.exit(0); });
