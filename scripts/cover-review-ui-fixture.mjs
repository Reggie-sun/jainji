import { build } from "esbuild";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Local browser QA fixture: actual React panel + actual edit reducer, no user project or provider.
const backend = await build({ entryPoints: ["src/main/cover-review-session.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { createCoverReviewDraft, editCoverReviewDraft } = await import(`data:text/javascript;base64,${Buffer.from(backend.outputFiles[0].text).toString("base64")}`);
const work = await mkdtemp(path.join(tmpdir(), "jianji-cover-ui-"));
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(work, "source.mp4")]);
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=180x320:rate=24", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(work, "portrait.mp4")]);
const media = { id: randomUUID(), displayName: "交互测试素材", width: 320, height: 180, durationMs: 2000, fingerprint: "fixture", previewUrl: "/source.mp4" };
let draft = createCoverReviewDraft(randomUUID(), [media]);
let calls = [], failNext = false;
const identity = { id: randomUUID(), label: "测试框", semantics: "sticker", origin: "human" };
draft = editCoverReviewDraft(draft, { type: "put_segment", projectId: draft.projectId, draftId: draft.id, expectedRevision: draft.revision, mediaId: media.id, identity, segment: { id: randomUUID(), identityId: identity.id, origin: "human", track: { startMs: 0, endMs: 2000, keyframes: [{ timeMs: 0, rectangle: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 } }] } } });
const initial = structuredClone(draft);
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "jsx", contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CoverReviewPanel} from './src/renderer/CoverReviewPanel';
import './src/renderer/styles.css';
async function request(path, value) { const response = await fetch(path, value === undefined ? {} : {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(value)}); const data = await response.json(); if(!response.ok) throw new Error(data.error); return data; }
window.jianji = {editCoverReview: value => request('/edit',value)};
function Fixture() {
 const [draft, setDraft] = useState(${JSON.stringify(draft)});
 const [portrait, setPortrait] = useState(false);
 window.fixture = {snapshot:()=>request('/state'), reset:async()=>{setDraft(await request('/reset',{}))}, fail:()=>request('/fail',{}), portrait:()=>setPortrait(true)};
 return <main style={{maxWidth:820,margin:'24px auto',padding:16}}><CoverReviewPanel drafts={[draft]} mediaItems={[{...${JSON.stringify(media)}, ...(portrait ? {width:180,height:320,previewUrl:'/portrait.mp4'}: {})}]} input={{mediaIds:[${JSON.stringify(media.id)}],multiplier:1}} library={{profiles:[]}} onState={setDraft}/></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, format: "esm", outfile: "fixture.js", write: false });
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css")).contents;
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/fixture.js") { res.setHeader("content-type", "text/javascript"); return res.end(js); }
    if (req.url === "/fixture.css") { res.setHeader("content-type", "text/css"); return res.end(css); }
    if (req.url === "/source.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(await readFile(path.join(work, "source.mp4"))); }
    if (req.url === "/portrait.mp4") { res.setHeader("content-type", "video/mp4"); return res.end(await readFile(path.join(work, "portrait.mp4"))); }
    res.setHeader("content-type", "application/json");
    if (req.url === "/state") return res.end(JSON.stringify({ draft, calls }));
    if (req.url === "/reset") { draft = structuredClone(initial); calls = []; return res.end(JSON.stringify(draft)); }
    if (req.url === "/fail") { failNext = true; return res.end("{}"); }
    if (req.url === "/edit") {
      let body = ""; for await (const chunk of req) body += chunk;
      const command = JSON.parse(body); calls.push(command);
      if (failNext) { failNext = false; throw new Error("模拟保存失败"); }
      draft = editCoverReviewDraft(draft, command);
      return res.end(JSON.stringify(draft));
    }
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
});
server.listen(0, "127.0.0.1", () => console.log(`COVER_UI_FIXTURE=http://127.0.0.1:${server.address().port}`));
