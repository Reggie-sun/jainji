import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

export function overviewFixtureScript(options: { active?: boolean } = {}) {
  return buildSync({ stdin: { contents: `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QianchuanOverview} from "./src/renderer/QianchuanOverview";
    const accounts=[
      {product:"蝴蝶贴",productName:"过期商品别名",browserProfileName:"登录账号 A",advertiserId:"123",adId:"456",available:true},
      {product:"氨糖膏",browserProfileName:"登录账号 B",advertiserId:"223",adId:"556",available:true}
    ];
    const directories={蝴蝶贴:[{advertiserId:"123",name:"A 主账户"},{advertiserId:"124",name:"A 子账户一"},{advertiserId:"125",name:"A 子账户二"}],氨糖膏:[{advertiserId:"223",name:"B 主账户"},{advertiserId:"224",name:"B 子账户一"}]};
    const plan=(advertiserId,adId,name,productNames)=>({advertiserId,adId,name,productNames,accountSource:"current-browser"});
    const f=window.overviewFixture={calls:{directory:[],plans:[],switches:[],cancels:[],writes:[],navigation:[]},current:{蝴蝶贴:"124",氨糖膏:"224"},plans:{"124":[plan("124","789","眼罩投放计划",["蒸汽眼罩"]),plan("124","790","关联商品待读取",undefined)],"125":[plan("125","891","鼻贴投放计划",["鼻贴"])],"224":[plan("224","889","护肩贴投放计划",["护肩贴"])]},pending:[],mode:"",fail:false,delay:false};
    const current=product=>directories[product].find(a=>a.advertiserId===f.current[product]);
    const cache=()=>({source:"cache",readAt:Date.now()-86400000,stale:true});
    const assertAnchor=input=>{if(!accounts.some(a=>a.product===input.product&&a.advertiserId===input.expectedAdvertiserId))throw new Error("anchor mismatch");};
    window.jianji={
      listQianchuanSubaccounts:async input=>{assertAnchor(input);f.calls.directory.push(input);return {current:current(input.product),accounts:directories[input.product],cache:cache()};},
      listQianchuanPlans:async input=>{
        assertAnchor(input);f.calls.plans.push(input);
        const result={account:current(input.product),plans:structuredClone(f.plans[f.current[input.product]]??[]),cache:f.planCache??cache()};
        if(f.mode==="wrong-account"){result.account={advertiserId:"999",name:"其他账户"};result.plans=[plan("999","9991","错误账户的计划",["错误商品"])];}
        if(f.delay)return new Promise(resolve=>f.pending.push(()=>resolve(result)));
        if(f.fail)throw new Error("read failure");return result;
      },
      cancelQianchuanPlans:async input=>{f.calls.cancels.push(input);},
      switchQianchuanSubaccount:async input=>{assertAnchor(input);f.calls.switches.push(input);if(f.mode==="switch-unknown")throw new Error("切换结果未能核对");if(input.expectedCurrentAdvertiserId!==f.current[input.product])throw new Error("current mismatch");f.current[input.product]=input.advertiserId;return current(input.product);},
      saveQianchuanAccount:async()=>{f.calls.writes.push("save");throw new Error("not authorized");},
      startDouyinUpload:async()=>{f.calls.writes.push("upload");throw new Error("not authorized");}
    };
    function Fixture(){const[active,setActive]=useState(${options.active !== false}),[saved,setSaved]=useState(accounts);f.setActive=setActive;f.setAccounts=setSaved;f.accounts=accounts;
      return <QianchuanOverview active={active} state={{project:{id:"11111111-1111-4111-8111-111111111111"},douyinUpload:{accounts:saved,tasks:[]}}} onNavigate={page=>f.calls.navigation.push(page)}/>;
    }
    createRoot(document.getElementById("root")).render(<Fixture/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "empty" } }).outputFiles[0]!.text;
}
export function overviewFixtureStyles() {
  return ["styles.css", "workspace-redesign.css", "qianchuan-backend.css", "qianchuan-console.css"].map(file => readFileSync(`src/renderer/${file}`, "utf8")).join("\n") + "\nbody{margin:12px}#root{min-width:0}";
}
