import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url), directory = await mkdtemp(path.join(os.tmpdir(), "jianji-closure-smoke-"));
const packaged = process.argv.includes("--packaged"), home = path.join(directory, "home");
const userData = packaged ? path.join(home, ".config/jianji") : path.join(directory, "userData");
await mkdir(home); await mkdir(userData, { recursive: true });
const bootstrap = path.join(directory, "bootstrap.cjs");
await writeFile(bootstrap, `if(process.type === "browser") { const {app}=require("electron"); app.setPath("userData",${JSON.stringify(userData)}); app.setPath("documents",${JSON.stringify(directory)}); app.getAppPath=()=>${JSON.stringify(root)}; process.resourcesPath=${JSON.stringify(path.join(root,"resources"))}; require(${JSON.stringify(path.join(root,"dist-electron/main.cjs"))}); }`);
const environment = { PATH: process.env.PATH, DISPLAY: process.env.DISPLAY, ...(process.env.XAUTHORITY ? {XAUTHORITY:process.env.XAUTHORITY}:{}), HOME: home, NODE_PATH: path.join(root,"node_modules"), LANG:"C.UTF-8", XDG_CONFIG_HOME: path.join(home,".config"), XDG_CACHE_HOME: path.join(home,".cache"), XDG_DATA_HOME:path.join(home,".local/share") };
let app;
async function launch() {
  app = await require("playwright-core")._electron.launch({ executablePath: process.env.JIANJI_SMOKE_ELECTRON || require("electron"), args:packaged ? [] : [bootstrap], cwd:root, env:environment });
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.jianji);
  return page;
}
async function close() { if(app) { const current=app;app=undefined;await current.close(); } }
const report = { result:"NOT_EVALUATED", directory, realAccountsUsed:false };
try {
  let page = await launch(), state = await page.evaluate(() => window.jianji.getState());
  const projectId=state.project.id;
  await app.evaluate(({dialog}, file) => { dialog.showSaveDialog = async () => ({canceled:false,filePath:file}); }, path.join(directory,"fixture.jianji-project.json"));
  state=await page.evaluate(() => window.jianji.saveProject("结束回归")); const recentId=state.activeRecentProjectId; await close();
  const storeModule=path.join(directory,"store.mjs");
  await require("esbuild").build({entryPoints:[path.join(root,"src/main/douyin-upload-store.ts")],bundle:true,platform:"node",format:"esm",outfile:storeModule});
  const {DouyinUploadStore,frozenInputDigest,uploadTaskId}=await import(pathToFileURL(storeModule).href);
  const store = new DouyinUploadStore(path.join(userData,"douyin-upload"));await store.load();
  const batchId=randomUUID(),authorization={target:{product:"蝴蝶贴",cdpEndpoint:"http://127.0.0.1:1",advertiserId:"123",adId:"456",configDigest:"a".repeat(64)},pageBatchId:randomUUID(),expectedCount:3};
  const ids=[];
  for(let i=0;i<3;i++) {
    const input={project_id:projectId,batch_id:batchId,export_task_id:randomUUID(),video_path:path.join(directory,`formal-${i}.mp4`),artifact_sha256:i.toString(16).padStart(64,"0"),size_bytes:10};
    await store.saveIntents([{project_id:projectId,batch_id:batchId,export_task_id:input.export_task_id,selection:{enabled:true,accountProduct:"蝴蝶贴"},authorization,config:store.config}]);
    const id=uploadTaskId(input,authorization.target);ids.push(id);
    await store.saveTask({input,inputDigest:frozenInputDigest(input,authorization),authorization,config:store.config,snapshotPath:input.video_path,result:{project_id:projectId,batch_id:batchId,export_task_id:input.export_task_id,artifact_sha256:input.artifact_sha256,upload_task_id:id,file_name:path.basename(input.video_path),accountProduct:"蝴蝶贴",advertiserId:"123",adId:"456",state:i===1?"NEEDS_HUMAN":"PENDING",upload_outcome:"NOT_SELECTED",retryable:false,retry_count:0,attempt_count:i<2?1:0,timestamp:new Date().toISOString()}});
  }
  await store.markSelecting(ids[0],{targetId:"lost-original",pageBatchId:authorization.pageBatchId,modalSessionId:randomUUID()},1);
  const unknown=store.task(ids[0]);unknown.result.state="NEEDS_HUMAN";await store.saveTask(unknown);
  await store.markSelecting(ids[1],{...store.fence(ids[0]).pageOwnership},2);
  const ready=store.task(ids[1]);ready.result={...ready.result,state:"WAITING_FOR_CONFIRMATION",upload_outcome:"READY",readyEvidence:{advertiserId:"123",adId:"456",fileName:ready.result.file_name,selectedCount:2,observedAt:new Date().toISOString(),pageOwnership:store.fence(ids[1]).pageOwnership},failure:undefined};await store.saveTask(ready);
  const before=JSON.parse(JSON.stringify(store.tasks())),intentsBefore=JSON.parse(JSON.stringify(store.intents()));
  const fencePath=path.join(store.root,"selection-fences",`${ids[0]}.json`),fenceBefore=await readFile(fencePath);
  page=await launch();await page.evaluate(id=>window.jianji.loadProject(id),recentId);await page.getByRole("button",{name:"作品",exact:true}).click();
  state=await page.evaluate(()=>window.jianji.getState());assert.equal(state.douyinUpload.tasks.length,3);
  const rejected=await page.evaluate(async ({id})=>{try {await window.jianji.closeDouyinUploadBatch("11111111-1111-4111-8111-111111111111",id);return false;}catch{return true;}},{id:ids[0]});assert.equal(rejected,true);
  const task=page.getByRole("region",{name:"千川上传任务",exact:true});
  await task.getByRole("button",{name:"结束本批本地上传",exact:true}).click();
  await task.getByRole("button",{name:"保留本批",exact:true}).click();
  assert.equal((await page.evaluate(()=>window.jianji.getState())).douyinUpload.tasks.length,3);
  await task.getByRole("button",{name:"结束本批本地上传",exact:true}).click();
  await task.getByRole("button",{name:"确认结束本批本地上传",exact:true}).click();
  await page.getByText("当前项目没有千川上传任务。",{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.jianji.getState())).douyinUpload.tasks.length,0);
  assert.deepEqual(await readFile(fencePath),fenceBefore);
  await close();page=await launch();await page.evaluate(id=>window.jianji.loadProject(id),recentId);
  assert.equal((await page.evaluate(()=>window.jianji.getState())).douyinUpload.tasks.length,0);
  const reopened=new DouyinUploadStore(store.root);await reopened.load();assert.deepEqual(reopened.tasks(),before);assert.deepEqual(reopened.intents(),intentsBefore);assert.equal(reopened.closedBatches().length,1);
  state=await page.evaluate(()=>window.jianji.getState());assert.equal(state.douyinUpload.closedBatches[0].readyCount,1);assert.equal(state.douyinUpload.closedBatches[0].unknownCount,1);assert.equal(state.douyinUpload.closedBatches[0].notSelectedCount,1);
  const rejection=await page.evaluate(async({projectId,id})=>{try{await window.jianji.resumeDouyinUpload(projectId,id);return "wrongly accepted"}catch(e){return String(e)}},{projectId,id:ids[0]});assert.match(rejection,/已结束/);
  await page.getByRole("button",{name:"作品",exact:true}).click();await page.getByText("已结束的本地上传历史（只读）",{exact:true}).waitFor();await page.screenshot({path:path.join(directory,"closed-history.png"),fullPage:true});
  report.result="PASS";report.checks=["trusted IPC rejects another project","cancel keeps full mixed batch","trusted UI confirmation closes whole mixed batch","restart retains original results and audit","original fence bytes unchanged","closed history read-only","stale resume rejection reaches caller","no reachable upload browser configured"];
} catch(error) {report.error=String(error.stack??error);process.exitCode=1;} finally {await close();await writeFile(path.join(directory,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
