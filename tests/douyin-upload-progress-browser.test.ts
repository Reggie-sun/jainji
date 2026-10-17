import { buildSync } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resolveChromeExecutable } from "./helpers/douyin-cdp-fixture";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true, args: ["--no-sandbox"] });
}, 30000);
afterAll(async () => { await browser?.close(); });

function fixtureScript() {
  return buildSync({ stdin: { contents: `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QianchuanUploadConfigSchema} from "./src/shared/douyin-upload";
    import {DouyinUploadPanel} from "./src/renderer/DouyinUploadPanel";
    const projectId="11111111-1111-4111-8111-111111111111";
    const oldEvidence={advertiserId:"123",adId:"456",fileName:"旧批次同内容.mp4",selectedCount:1,observedAt:"2026-10-17T00:00:00.000Z",pageOwnership:{targetId:"old-tab",pageBatchId:projectId,modalSessionId:projectId},platformVideoId:"old-platform-video",attempt:1,requestSha256:"d".repeat(64),responseSha256:"e".repeat(64)};
    const freshEvidence={...oldEvidence,fileName:"新上传.mp4",platformVideoId:"fresh-platform-video",pageOwnership:{...oldEvidence.pageOwnership,targetId:"new-tab"}};
    const makeTask=(id, overrides={})=>({project_id:projectId,batch_id:"22222222-2222-4222-8222-222222222222",export_task_id:"33333333-3333-4333-8333-333333333333",upload_task_id:id.padStart(64,"0"),artifact_sha256:"b".repeat(64),file_name:id+".mp4",accountProduct:"眼贴",advertiserId:"123",adId:"456",state:"ACCEPTED",upload_outcome:"ACCEPTED",retryable:false,retry_count:0,attempt_count:0,timestamp:"2026-10-18T00:00:00.000Z",...overrides});
    const aliases=Array.from({length:18},(_,index)=>makeTask(String(index+1),{duplicate_of:"c".repeat(64),acceptedEvidence:oldEvidence}));
    const fresh=makeTask("fresh",{attempt_count:1,acceptedEvidence:freshEvidence});
    const ready=makeTask("ready",{state:"WAITING_FOR_CONFIRMATION",upload_outcome:"READY",readyEvidence:{advertiserId:"123",adId:"456",fileName:"ready.mp4",selectedCount:1,observedAt:"2026-10-18T00:00:00.000Z",pageOwnership:{targetId:"ready-tab",pageBatchId:projectId,modalSessionId:projectId}}});
    const pending=makeTask("pending",{state:"PENDING",upload_outcome:"NOT_SELECTED"});
    const unknown=makeTask("unknown",{state:"NEEDS_HUMAN",upload_outcome:"MAY_HAVE_UPLOADED",attempt_count:1});
    const makeBatch=tasks=>({projectId,pageBatchId:projectId,advertiserId:"123",adId:"456",expectedCount:50,taskIds:tasks.map(task=>task.upload_task_id),readyCount:tasks.filter(task=>task.upload_outcome==="READY").length,acceptedCount:tasks.filter(task=>task.upload_outcome==="ACCEPTED").length,newAcceptedCount:tasks.filter(task=>task.upload_outcome==="ACCEPTED"&&!task.duplicate_of).length,duplicateCount:tasks.filter(task=>Boolean(task.duplicate_of)).length,unknownCount:tasks.filter(task=>task.upload_outcome==="MAY_HAVE_UPLOADED").length,notSelectedCount:tasks.filter(task=>task.upload_outcome==="NOT_SELECTED").length,canClose:false});
    const makeStatus=tasks=>{const admitted=tasks.filter(task=>task!==unknown);return {config:QianchuanUploadConfigSchema.parse({}),configSelected:false,accounts:[],ready:false,message:"fixture",tasks,batches:[makeBatch(admitted)],legacyTasks:[]};};
    function Fixture(){const [mixed,setMixed]=useState(false);window.showMixed=()=>setMixed(true);const tasks=mixed?[aliases[0],fresh,ready,pending,unknown]:aliases;return <><button type="button" onClick={()=>setMixed(true)}>切换混合状态</button><DouyinUploadPanel projectId={projectId} status={makeStatus(tasks)} onState={()=>{}}/></>;}
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } }).outputFiles[0]!.text;
}

async function fixture(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  await page.setContent('<meta charset="utf-8"><div id="root"></div>');
  await page.addScriptTag({ content: fixtureScript() });
  await page.getByRole("heading", { name: "千川上传任务" }).waitFor();
  return page;
}

it("renders reused upload evidence as skipped and keeps mixed progress tied to planned and unmatched rows", async () => {
  const page = await fixture();
  try {
    const initialProgress = await page.getByRole("status", { name: "上传进度" }).innerText();
    expect(initialProgress).toContain("已上传 0 / 50 条");
    expect(initialProgress).toContain("重复跳过 18 条");
    const firstAlias = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "1.mp4", exact: true }) });
    const aliasText = await firstAlias.innerText();
    expect(aliasText).toContain("引用既有平台接收回执");
    expect(aliasText).not.toContain("平台已接收该计划素材");
    expect(await firstAlias.getByRole("button").count()).toBe(0);

    await page.getByRole("button", { name: "切换混合状态" }).click();
    const progress = await page.getByRole("status", { name: "上传进度" }).innerText();
    expect(progress).toContain("已上传 2 / 51 条");
    expect(progress).toContain("重复跳过 1 条");
    expect(progress).toContain("待上传 1 条");
    expect(progress).toContain("需处理 1 条");
    expect(await page.getByText("本批新接收 1 条", { exact: false }).count()).toBeGreaterThan(0);
    expect(await page.getByText("重复跳过 1 条", { exact: false }).count()).toBeGreaterThan(0);
    const freshRow = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "fresh.mp4", exact: true }) });
    expect(await freshRow.innerText()).toContain("平台已接收该计划素材 · 视频 ID fresh-platform-video");
    expect(await page.evaluate(() => (window as any).showMixed instanceof Function)).toBe(true);
  } finally { await page.close(); }
});
