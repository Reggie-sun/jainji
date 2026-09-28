// Real React interactions with an isolated desktop bridge; no accounts or media.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const directory = await mkdtemp(path.join(tmpdir(), "jianji-production-interaction-"));
let browser;
const server = await createServer({
  cacheDir: path.join(directory, "vite-cache"),
  server: { port: 0, strictPort: false },
  plugins: [{ name: "production-interaction-fixture", configureServer(instance) {
    instance.middlewares.use(async (request, response, next) => {
      if (request.url !== "/__production-interaction") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html lang="zh-CN"><body><div id="root"></div><script type="module">
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import App from '/src/renderer/App.tsx'; import '/src/renderer/styles.css';
        import {DecorationSchema} from '/src/shared/decorations.ts';
        import {DEFAULT_EXPORT_SETTINGS} from '/src/shared/export-settings.ts';
        const projectId=crypto.randomUUID(), mediaId=crypto.randomUUID(), taskId=crypto.randomUUID(), batchId=crypto.randomUUID();
        const initial={mediaIds:[mediaId], decorations:DecorationSchema.parse({mode:'random',productPrice:'本轮文字'}),exportFormat:'mp4'};
        const clone=value=>structuredClone(value);
        let listener=()=>{};
        const state={project:{id:projectId,name:'制作期间操作',hasUnsavedChanges:false,template:{productPriceDraft:'本轮文字'},
          mediaItems:[{id:mediaId,displayName:'合成素材',probeStatus:'ready',width:720,height:1280,durationMs:10000,sizeBytes:1000}],
          workspaceDraft:{step:'templates',selectedMediaIds:[mediaId],ruleId:'clean',brief:'本轮说明',decorations:initial.decorations,exportSettings:DEFAULT_EXPORT_SETTINGS,exportFormat:'mp4',outputDirectoryMode:'manual',outputDirectory:'/tmp/original'}},
          queue:{batches:[]},capabilities:{ready:true},connection:{configured:false},connections:{profiles:[],selected:null},
          agentRun:{id:crypto.randomUUID(),projectId,ruleId:'clean',status:'running',usesModel:false,items:[{id:crypto.randomUUID(),mediaId,version:1,name:'合成素材',status:'analyzing'}]}};
        window.fixture={state,frozen:clone(initial),writes:[],starts:[],emit:()=>listener(clone(state)),
          finishAgent:()=>{state.agentRun.status='finished';state.queue.batches=[{batch:{id:batchId,projectId,mediaIds:[mediaId],tasks:[{id:taskId,batchId,mediaId,status:'running',progress:0.5}]}}];listener(clone(state));},
          finishExport:()=>{state.queue.batches[0].batch.tasks[0].status='completed';listener(clone(state));}};
        window.jianji={getState:async()=>clone(state),onExportSnapshot:fn=>{listener=fn;return()=>{listener=()=>{};}},
          decorationCatalog:async()=>({fonts:[],stickers:[]}),libraryAsset:async()=>({url:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}),selectOutputDirectory:async()=>'/tmp/next',
          setProductPriceDraft:async(id,text)=>{if(state.agentRun.status==='running')throw new Error('Agent busy');if(id!==projectId)throw new Error('wrong project');window.fixture.writes.push(text);state.project.template.productPriceDraft=text;return clone(state);},
          setWorkspaceDraft:async(id,draft)=>{if(state.agentRun.status==='running')throw new Error('Agent busy');state.project.workspaceDraft=clone(draft);return clone(state);},
          startAgent:async input=>{window.fixture.starts.push(clone(input));state.agentRun.status='running';return clone(state);},
          cancelAgent:async()=>{state.agentRun.status='cancelled';return clone(state);}};
        createRoot(document.getElementById('root')).render(React.createElement(App));
      </script></body></html>`));
    });
  } }],
});
try {
  await server.listen();
  const url = new URL("/__production-interaction", server.resolvedUrls.local[0]).href;
  if (process.argv.includes("--serve")) {
    console.log(JSON.stringify({ url, directory }));
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  } else {
    browser = await chromium.launch({ executablePath: process.env.JIANJI_SMOKE_CHROME || "/usr/bin/google-chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
    await page.goto(url);
    await page.locator("#product-price").fill("下一轮文字");
    await page.locator("#creative-brief").fill("下一轮说明");
    await page.locator("#production-count").fill("5");
    await page.locator("#export-format").selectOption("mkv");
    await page.locator("#decoration-display-mode").selectOption("first-5s");
    await page.locator(".directory-picker").click();
    await page.getByRole("button", { name: "自己设置", exact: true }).click();
    await page.getByRole("button", { name: "本地随机", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: /本地制作，制作 5 条成片/ }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "打开", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "自动生成提示词", exact: true }).isDisabled(), true);
    await page.evaluate(() => window.fixture.emit());
    assert.equal(await page.locator("#product-price").inputValue(), "下一轮文字");
    assert.equal(await page.locator("#export-format").inputValue(), "mkv");
    assert.deepEqual(await page.evaluate(() => window.fixture.writes), []);
    assert.equal(await page.evaluate(() => window.fixture.frozen.decorations.productPrice), "本轮文字");
    await page.getByRole("button", { name: "素材", exact: true }).click();
    const media = page.getByRole("checkbox", { name: "选择 合成素材" });
    await media.uncheck(); await media.check();
    assert.equal(await page.getByRole("button", { name: "下一步，设置制作规则" }).isEnabled(), true);
    assert.equal(await page.getByRole("button", { name: "选择本地素材" }).isDisabled(), true);
    await page.getByRole("button", { name: "下一步，设置制作规则" }).click();
    assert.equal(await page.locator("#product-price").inputValue(), "下一轮文字");
    await page.evaluate(() => window.fixture.finishAgent());
    await page.waitForFunction(() => window.fixture.writes.includes("下一轮文字"));
    await page.locator("#product-price").fill("导出时编辑");
    await page.waitForFunction(() => window.fixture.writes.includes("导出时编辑"));
    assert.equal(await page.getByRole("button", { name: /本地制作，制作 5 条成片/ }).isDisabled(), true);
    await page.evaluate(() => window.fixture.finishExport());
    await page.getByRole("button", { name: /本地制作，制作 5 条成片/ }).click();
    await page.waitForFunction(() => window.fixture.starts.length === 1);
    const input = await page.evaluate(() => window.fixture.starts[0]);
    assert.equal(input.decorations.productPrice, "导出时编辑");
    assert.equal(input.decorations.displayMode, "first-5s");
    assert.equal(input.decorations.mode, "random");
    assert.equal(input.brief, "下一轮说明");
    assert.equal(input.exportFormat, "mkv");
    assert.equal(input.outputDirectory, "/tmp/next");
    assert.equal(input.multiplier, 5);
    assert.deepEqual(errors, []);
    const report = { status: "passed", checks: ["edit during production", "selection and navigation", "frozen request unchanged", "deferred price save", "edit during export", "duplicate start blocked", "next run uses new draft"], pageErrors: errors, mediaAndModelCalls: 0 };
    await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, directory }));
  }
} finally {
  await browser?.close();
  await server.close();
}
