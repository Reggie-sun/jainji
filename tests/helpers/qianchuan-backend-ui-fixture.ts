import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

export function qianchuanBackendFixtureStyles() { return ["src/renderer/qianchuan-backend.css", "src/renderer/qianchuan-console.css"].map(path => readFileSync(path, "utf8")).join("\n"); }
export function qianchuanBackendFixtureScript() {
  return buildSync({ stdin: { contents: `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QianchuanBackendPanel} from "./src/renderer/QianchuanBackendPanel";
    import {QIANCHUAN_QUERY_METRICS} from "./src/shared/qianchuan-backend";
    import {QIANCHUAN_REPORT_METRIC_PROVENANCE} from "./src/shared/qianchuan-report";
    window.supplierReads=[]; window.supplierCancels=[]; window.supplierDisconnects=0; window.supplierPending=[]; window.supplierDelay=false; window.supplierFail=false; window.supplierEmpty=false; window.reads=[]; window.cancellations=[]; window.pending=[]; window.delay=false; window.fail=false;
    const metrics=Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key=>[key,{value:"123.45",display:"123.45"}]));
    const result=input=>({kind:input.kind,advertiserId:input.expectedAdvertiserId,observedAt:"2026-10-13T10:00:00Z",
      ...(input.kind==="plan"?{adId:input.adId,name:"真实结构示例计划",budget:"100000000",roiGoal:"2",products:[{id:"700",name:"示例商品"}]}:
      {startTime:input.startDate+" 00:00:00",endTime:input.endDate+" 12:00:00",...(input.kind==="report"?{metrics}:
      {adId:input.adId,offset:input.offset,limit:input.limit,total:101,rows:[{materialId:String(900+input.offset),name:"素材页 "+input.offset,metrics}]})})});
    const supplierResult=input=>input.kind==="discover"?{requestId:input.requestId,kind:"discover",sessions:[{sessionId:"6fcb5ecd-7608-4a57-bf4d-26625804a38c",label:"千管家首页 · 页面 1"}],unavailableBrowsers:0}:
      {requestId:input.requestId,kind:input.kind,sessionId:input.sessionId,data:input.kind==="accounts"?{source:"qianguanjia",observedAt:"2026-10-14T08:00:00Z",accounts:window.supplierEmpty?[]:[{advertiserId:"1879999999999999999",name:"授权测试账户",authStatus:1,authStatusDesc:"授权正常"}]}:
      {source:"qianguanjia",scope:"supplier-home-aggregate",observedAt:"2026-10-14T08:00:00Z",date:"2026-10-14",groups:Object.fromEntries(["ALL","LIVE_PROM_GOODS","VIDEO_PROM_GOODS"].map(key=>[key,{current:{statCost:"12.34",totalPayOrderCountForRoi2:"3",totalPayOrderGmvIncludeCouponForRoi2:"99.99",totalPrepayAndPayOrderRoi2:"8.10"},comparison:{}}]))}};
    window.auditOperations=[];window.historyPending=[];window.historyDelay=window.historyDelay??false;window.reportReads=[];window.reportCancels=[];window.reportPending=[];window.reportDelay=false;window.reportHistory=[];window.localStops=0;
    const captured=input=>({version:1,id:crypto.randomUUID(),source:'qianchuan-browser',product:input.product,advertiserId:input.expectedAdvertiserId,kind:input.kind,
      startTime:input.startDate+' 00:00:00',endTime:input.endDate+' 12:00:00',asOf:'2026-10-15T04:00:00Z',capturedAt:'2026-10-15T04:00:05Z',complete:true,metricProvenance:QIANCHUAN_REPORT_METRIC_PROVENANCE,
      ...(input.kind==='report'?{metrics}:{adId:input.adId,total:2,rows:[{materialId:'7696527003390771254',videoId:'video-1',name:'fixture-video-1',metrics},{materialId:'7696527003390771255',videoId:'video-2',name:'fixture-video-2',metrics}]})});
    window.jianji={listQianchuanReports:async input=>{const next=structuredClone(window.reportHistory.filter(x=>x.product===input.product&&x.advertiserId===input.expectedAdvertiserId));if(window.historyDelay)return new Promise(resolve=>window.historyPending.push(()=>resolve(next)));return next;},
      getQianchuanIntegration:async()=>({capabilities:['create-plan','bind-materials','set-roi','set-budget','pause','enable'].map(action=>({action,status:'not-investigated',reason:'no qualified recipe'})),stopped:window.localStops>0,auditUnavailable:false,operations:window.auditOperations}),
      stopQianchuanIntegration:async()=>{window.localStops++;},cancelQianchuanIntegration:async input=>{window.reportCancels.push(input);},
      captureQianchuanReport:async input=>{window.reportReads.push(input);if(window.fail)throw new Error('private-secret-token');const next=captured(input);if(window.reportDelay)return new Promise(resolve=>window.reportPending.push(()=>resolve(next)));window.reportHistory.push(next);return next;},
      queryQianguanjia:input=>{window.supplierReads.push(input);if(window.supplierFail)return Promise.reject(new Error("private-secret-token"));if(window.supplierDelay)return new Promise(resolve=>window.supplierPending.push(()=>resolve(supplierResult(input))));return Promise.resolve(supplierResult(input));},cancelQianguanjiaQuery:async input=>{window.supplierCancels.push(input);},disconnectQianguanjia:async()=>{window.supplierDisconnects++;},queryQianchuanBackend:input=>{window.reads.push(input);if(window.fail)return Promise.reject(new Error("ws://private-secret-token"));
      if(window.delay)return new Promise(resolve=>window.pending.push(()=>resolve(result(input))));return Promise.resolve(result(input));},
      cancelQianchuanBackendQuery:async input=>{window.cancellations.push(input);}};
    function Fixture(){const [active,setActive]=useState(true),[accounts,setAccounts]=useState([
      {product:"眼贴",advertiserId:"12345",adId:"67890",available:true},
      {product:"肥皂",advertiserId:"12346",adId:"67891",available:true}]);
      window.setActive=setActive; window.setAccounts=setAccounts;
      return <div style={{maxWidth:1000,margin:"auto"}}><QianchuanBackendPanel accounts={accounts} active={active}/></div>;}
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, loader: { ".css": "empty" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic" }).outputFiles[0]!.text;
}
