import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

// The current App runs against an isolated bridge. Every side effect is either
// recorded in memory or rejected; no real project, account or model is used.
export function taskPagesFixtureScript() {
  return buildSync({ stdin: { contents: `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import App from "./src/renderer/App";
    import {DecorationSchema} from "./src/shared/decorations";
    import {DEFAULT_EXPORT_SETTINGS} from "./src/shared/export-settings";
    import {QianchuanUploadConfigSchema} from "./src/shared/douyin-upload";
    const clone = value => structuredClone(value);
    const projectId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const media = ["素材 A.mp4", "素材 B.mp4", "素材 C.mp4"].map((displayName,i) => ({id:"00000000-0000-4000-8000-00000000000"+i,displayName,probeStatus:"ready",width:720,height:1280,durationMs:15000,sizeBytes:1000}));
    const recent = [{id:projectId,name:"蝴蝶贴",mediaCount:3},{id:secondId,name:"项目 B",mediaCount:3}];
    const workspace = {step:"import",selectedMediaIds:media.map(x=>x.id),ruleId:"clean",brief:"",decorations:DecorationSchema.parse({mode:"random",frame:{mode:"none"}}),exportSettings:DEFAULT_EXPORT_SETTINGS,exportFormat:"mp4",outputDirectoryMode:"automatic"};
    const state = {project:{id:projectId,name:"蝴蝶贴",hasUnsavedChanges:false,template:{productPriceDraft:""},mediaItems:media,workspaceDraft:clone(workspace)},recentProjects:recent,queue:{batches:[]},connection:{configured:false},connections:{profiles:[],selected:null},chatgpt:{status:"logged-out"},capabilities:{ready:true,executionLimits:{exports:2}},douyinUpload:{config:QianchuanUploadConfigSchema.parse({}),ready:false,message:"上传已关闭",configSelected:false,accounts:[],tasks:[],legacyTasks:[],closedBatches:[]}};
    let snapshots = new Set(); const emit=()=>snapshots.forEach(fn=>fn(clone(state)));
    let automations=[]; let automationListeners=new Set();
    const automationStatus=()=>({tasks:clone(automations),timeZone:"Asia/Hong_Kong",running:false});
    const calls={starts:[],batchStarts:[],batchDetails:[],batchResumes:[],coverSaves:[],created:[],configured:[],sideEffects:[],plans:[],reviewEdits:[]};
    let batchDetail;
    const showBatchResults=({unknown=false,historical=false}={})=>{
      const runId=crypto.randomUUID(),jobId=crypto.randomUUID();
      const tasks=Array.from({length:50},(_,i)=>({id:crypto.randomUUID(),batchId:crypto.randomUUID(),mediaId:media[0].id,status:i<40?"completed":"failed",progress:i<40?1:0,errorMessage:i<40?undefined:"隔离渲染异常"}));
      const job={id:jobId,recentProjectId:secondId,projectId:secondId,name:"绿眼贴",requestedCount:50,actualCount:50,productPrice:"隔离文字",coverEnabled:false,displayMode:"full",accountProduct:"蝴蝶贴",status:"completed",taskIds:tasks.map(x=>x.id),completedCount:40,failedCount:10};
      const uploads=tasks.slice(0,40).map((task,i)=>({upload_task_id:i.toString(16).padStart(64,"0"),project_id:secondId,export_task_id:task.id,file_name:"上传文件 "+i+".mp4",accountProduct:"蝴蝶贴",advertiserId:"321",adId:"654",state:unknown&&i===0?"NEEDS_HUMAN":"CANCELLED",upload_outcome:unknown&&i===0?"MAY_HAVE_UPLOADED":"NOT_SELECTED",failure:{message:"上传已停止。",next_action:"明确继续才处理。"}}));
      batchDetail={runId,job,tasks,usesModel:false,items:tasks.map((t,i)=>({id:crypto.randomUUID(),mediaId:t.mediaId,taskId:t.id,version:1,name:"成片 "+i,status:"exporting"})),upload:{message:"旧上传操作未能安全停止，请先关闭应用并核查 Chrome。",accounts:clone(accounts),tasks:uploads,historical,closedBatches:[]}};
      state.batchProduction={id:runId,status:"finished",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),jobs:[job]};emit();
    };
    const blocked = async()=>{calls.sideEffects.push("blocked");throw new Error("隔离界面禁止平台、模型和文件副作用");};
    const accounts=[{product:"蝴蝶贴",productName:"蝴蝶贴",browserProfileName:"隔离账号",advertiserId:"123",adId:"456",available:true}];
    window.jianji={
      getState:async()=>clone(state),onExportSnapshot:fn=>{snapshots.add(fn);return()=>snapshots.delete(fn);},
      decorationCatalog:async()=>({fonts:[],stickers:[],frames:[]}),libraryAsset:async()=>({url:""}),
      setProductPriceDraft:async(id,text)=>{state.project.template.productPriceDraft=text;return clone(state);},
      setWorkspaceDraft:async(id,draft)=>{state.project.workspaceDraft=clone(draft);return clone(state);},
      setCoverSticker:async draft=>{calls.coverSaves.push(clone(draft));state.project.coverSticker=clone(draft);return clone(state);},
      editCoverReview:async input=>{calls.reviewEdits.push(clone(input));state.project.reviewDrafts=state.project.reviewDrafts.map(draft=>draft.id===input.draftId?window.editTaskPageReview(draft,input):draft);state.project.reviewDrafts=await Promise.all(state.project.reviewDrafts);return clone(state);},
      selectOutputDirectory:async()=>"/tmp/隔离成片",createAutomaticOutputDirectory:async()=>"/tmp/隔离自动成片",
      saveProject:async(name,draft)=>{state.project.name=name;state.project.workspaceDraft=clone(draft);state.project.hasUnsavedChanges=false;return clone(state);},
      renameProject:async name=>{state.project.name=name;},
      loadProject:async id=>{state.project={id:id??secondId,name:id===projectId?"蝴蝶贴":"项目 B",template:{productPriceDraft:id===projectId?"A 的文字":"B 的文字"},mediaItems:clone(media),workspaceDraft:{...clone(workspace),brief:id===projectId?"A 的说明":"B 的说明",requestedCount:id===projectId?9:6},hasUnsavedChanges:false};return clone(state);},
      batchProductionProjects:async()=>recent.map(x=>({recentProjectId:x.id,projectId:x.id,name:x.name,sourceCount:3,requestedCount:5,productPrice:"隔离文字",coverEnabled:false,coverMode:"manual",displayMode:"full",mode:"random"})),
      saveBatchUploadAccount:async input=>({accountProduct:input.accountProduct,advertiserId:input.expectedAdvertiserId}),
      batchProductionDetails:async input=>{calls.batchDetails.push(clone(input));if(!batchDetail||input.runId!==batchDetail.runId||input.jobId!==batchDetail.job.id)throw new Error("隔离详情身份不匹配");return clone(batchDetail);},
      resumeBatchUpload:async input=>{calls.batchResumes.push(clone(input));},
      startBatchProduction:async input=>{calls.batchStarts.push(clone(input));const id=crypto.randomUUID();state.batchProduction={id,status:"running",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),jobs:input.entries.map(entry=>({id:crypto.randomUUID(),recentProjectId:entry.recentProjectId,name:"隔离新制作",requestedCount:entry.requestedCount,actualCount:entry.requestedCount,productPrice:entry.productPrice,coverEnabled:entry.coverEnabled,displayMode:entry.displayMode,status:"producing",taskIds:[],completedCount:0,failedCount:0}))};return clone(state);},
      listQianchuanPlans:async input=>{calls.plans.push(clone(input));return [{advertiserId:input.expectedAdvertiserId,adId:"456",name:"隔离计划"}];},cancelQianchuanPlans:async()=>{},
      saveDouyinUploadConfig:async config=>{state.douyinUpload.config=clone(config);return clone(state);},
      saveQianchuanAccount:async()=>{state.douyinUpload.accounts=clone(accounts);state.douyinUpload.configSelected=true;return clone(state);},
      startAgent:async input=>{calls.starts.push(clone(input));state.agentRun={id:crypto.randomUUID(),projectId:state.project.id,status:"running",usesModel:false,items:media.map(x=>({id:crypto.randomUUID(),mediaId:x.id,version:1,name:x.displayName,status:"waiting"}))};return clone(state);},
      getAutomation:async()=>automationStatus(),onAutomation:fn=>{automationListeners.add(fn);return()=>automationListeners.delete(fn);},
      createAutomation:async request=>{calls.created.push(clone(request));automations.push({id:crypto.randomUUID(),request:clone(request),binding:"a".repeat(64),summary:"隔离固定范围",createdAt:new Date().toISOString()});automationListeners.forEach(fn=>fn(automationStatus()));return automationStatus();},
      configureAutomation:async input=>{calls.configured.push(clone(input));automations=automations.map(t=>t.id===input.id?{...t,request:{...t.request,time:input.time,enabled:input.enabled}}:t);automationListeners.forEach(fn=>fn(automationStatus()));return automationStatus();},removeAutomation:blocked,
      getQianchuanVideoLibrarySchedule:async()=>({settings:{enabled:false,time:"00:30",accounts:[]},timeZone:"Asia/Hong_Kong"}),onQianchuanVideoLibrarySchedule:()=>()=>{},
      getCCSwitchConnections:async()=>[],openArtifact:blocked,revealArtifact:blocked,
      openQianchuanAccountBrowser:blocked,controlQianchuanAccountBrowser:blocked,clearQianchuanVideoLibraries:blocked,generateBrief:blocked,
    };
    window.taskPagesFixture={state,calls,emit,showBatchResults,configureAccounts:()=>{state.douyinUpload.accounts=clone(accounts);state.douyinUpload.config.enabled=true;state.douyinUpload.ready=true;emit();},showResults:()=>{const id=crypto.randomUUID();const tasks=media.map((x,i)=>({id:crypto.randomUUID(),batchId:id,mediaId:x.id,status:i===2?"failed":"completed",progress:i===2?0:1,errorMessage:i===2?"隔离失败":""}));state.agentRun=undefined;state.queue.batches=[{batch:{id,projectId:state.project.id,mediaIds:media.map(x=>x.id),status:"completed_with_errors",tasks}}];state.project.latestProduction={id:crypto.randomUUID(),usesModel:false,items:tasks.map((t,i)=>({id:crypto.randomUUID(),mediaId:t.mediaId,taskId:t.id,version:1,name:media[i].displayName,status:"exporting"}))};emit();}};
    createRoot(document.getElementById("root")).render(<div className="membership-workspace"><App/></div>);
  `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}

export function taskPagesFixtureStyles() {
  return ["styles.css", "workspace-redesign.css", "membership.css", "batch-production.css", "automation.css", "qianchuan-cleanup.css", "douyin-upload.css", "cover-sticker.css", "decorations.css", "material-collection.css"].map(path => readFileSync(`src/renderer/${path}`, "utf8")).join("\n") + "\nhtml,body,#root{height:100%;}.membership-workspace{height:100%;}";
}
