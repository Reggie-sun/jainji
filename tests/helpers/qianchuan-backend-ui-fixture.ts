import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

export function qianchuanBackendFixtureStyles() { return readFileSync("src/renderer/qianchuan-backend.css", "utf8"); }
export function qianchuanBackendFixtureScript() {
  return buildSync({ stdin: { contents: `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QianchuanBackendPanel} from "./src/renderer/QianchuanBackendPanel";
    import {QIANCHUAN_QUERY_METRICS} from "./src/shared/qianchuan-backend";
    window.reads=[]; window.cancellations=[]; window.pending=[]; window.delay=false; window.fail=false;
    const metrics=Object.fromEntries(QIANCHUAN_QUERY_METRICS.map(key=>[key,{value:"123.45",display:"123.45"}]));
    const result=input=>({kind:input.kind,advertiserId:input.expectedAdvertiserId,observedAt:"2026-10-13T10:00:00Z",
      ...(input.kind==="plan"?{adId:input.adId,name:"真实结构示例计划",budget:"100000000",roiGoal:"2",products:[{id:"700",name:"示例商品"}]}:
      {startTime:input.startDate+" 00:00:00",endTime:input.endDate+" 12:00:00",...(input.kind==="report"?{metrics}:
      {adId:input.adId,offset:input.offset,limit:input.limit,total:101,rows:[{materialId:String(900+input.offset),name:"素材页 "+input.offset,metrics}]})})});
    window.jianji={queryQianchuanBackend:input=>{window.reads.push(input);if(window.fail)return Promise.reject(new Error("ws://private-secret-token"));
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
