import { buildSync } from "esbuild";
export function qianguanjiaSessionFixtureScript(initialActive = false) {
  return buildSync({ stdin: { contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {QianguanjiaPanel} from './src/renderer/QianguanjiaPanel'; import {QIANCHUAN_PRODUCTS} from './src/shared/qianchuan-account';
    const fields=['statCost','totalPayOrderGmvIncludeCouponForRoi2','totalPayOrderCountForRoi2','totalPrepayAndPayOrderRoi2'];
    const f=window.supplier={reads:[],cancels:[],disconnects:0,mode:'single',delay:'',pending:[],cleanup:[],blockCleanup:false,homeEmpty:false,captures:[]};
    const savedAccounts=QIANCHUAN_PRODUCTS.map((product,i)=>({product,productName:'我的账户'+(i+1),advertiserId:'187999999999999999'+(i+1),adId:'1878754135410692',available:true}));
    window.jianji={listQianchuanReports:async()=>[],captureQianchuanReport:async q=>{f.captures.push(q);throw Error('fixture-unavailable')},cancelQianchuanIntegration:async()=>{}};
    const api={queryQianguanjia:async q=>{f.reads.push(q);if(f.mode==='fail')throw Error('secret-upstream-token');
      const result=q.kind==='discover'?{...q,unavailableBrowsers:0,sessions:(f.mode==='empty'?[]:f.mode==='multiple'?[1,2]:[1]).map(i=>({sessionId:'11111111-1111-4111-8111-11111111111'+i,label:'已登录页面 '+i}))}:q.kind==='accounts'?{...q,data:{source:'qianguanjia',observedAt:'2026-10-17T00:00:00Z',accounts:[{advertiserId:'123',name:'已授权账户',authStatus:1,authStatusDesc:'授权正常'}]}}:{...q,data:{source:'qianguanjia',scope:'supplier-home-aggregate',date:f.replyDate??q.date??'2026-10-17',observedAt:'2026-10-17T00:00:00Z',availability:f.homeEmpty?'not-provided':'provided',groups:Object.fromEntries(['ALL','LIVE_PROM_GOODS','VIDEO_PROM_GOODS'].map(k=>[k,{current:Object.fromEntries(fields.map(x=>[x,f.homeEmpty?null:'12.34'])),comparison:Object.fromEntries(fields.map(x=>[x,f.homeEmpty?null:'1']))}]))}};
      if(f.delay===q.kind)return new Promise(resolve=>f.pending.push(()=>resolve(result)));return result;},cancelQianguanjiaQuery:async q=>{f.cancels.push(q);},disconnectQianguanjia:async()=>{f.disconnects++;if(f.blockCleanup)await new Promise(resolve=>f.cleanup.push(resolve));}};
    function App(){const [active,setActive]=useState(${initialActive});return <><button onClick={()=>setActive(true)}>显示千管家</button><button onClick={()=>setActive(false)}>隐藏千管家</button><QianguanjiaPanel active={active} api={api} accounts={savedAccounts}/></>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  `, resolveDir: process.cwd(), sourcefile: "qgj-session-fixture.tsx", loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", loader: { ".css": "empty" } }).outputFiles[0]!.text;
}
