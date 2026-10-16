import { useEffect, useRef, useState } from "react";
import { QianguanjiaAnalysisInputSchema, QIANGUANJIA_REPORT_FIELDS, type QianguanjiaPlanReportPage } from "../shared/qianguanjia-analysis";
import type { QianguanjiaDesktopApi } from "../shared/qianguanjia";
import { subtractDecimalExact } from "../shared/qianguanjia-view";
const names=["平台消耗","成交订单数","含券成交金额","支付 ROI"];
export function QianguanjiaPlans({active,api,sessionId,startDate,endDate,externalBusy,onBusy,onSessionInvalid}:{active:boolean;api:QianguanjiaDesktopApi;sessionId:string;startDate:string;endDate:string;externalBusy:boolean;onBusy?(busy:boolean):void;onSessionInvalid?():void}){
 const[current,setCurrent]=useState<{key:string;data:QianguanjiaPlanReportPage}>(),[baseline,setBaseline]=useState<{sessionId:string;data:QianguanjiaPlanReportPage}>();
 const[busy,setBusy]=useState(false),[error,setError]=useState("");const request=useRef<string>();
 const key=JSON.stringify([sessionId,startDate,endDate]);const visible=current?.key===key?current.data:undefined,previous=baseline?.sessionId===sessionId?baseline.data:undefined;
 const cancel=()=>{const id=request.current;request.current=undefined;if(id){void api.cancelQianguanjiaQuery({requestId:id}).catch(()=>undefined);onBusy?.(false);onSessionInvalid?.();}};
 useEffect(()=>{cancel();setBusy(false);setCurrent(undefined);setError("");return cancel;},[active,key]);
 useEffect(()=>{setBaseline(undefined);},[sessionId]);
 async function read(page=1){
  if(!active||!sessionId||request.current||externalBusy)return;
  const parsed=QianguanjiaAnalysisInputSchema.safeParse({kind:"plan-report",startDate,endDate,page,limit:10});
  if(!parsed.success){setError("请选择有效且最多31天的日期范围。");return}
  const id=crypto.randomUUID();request.current=id;setBusy(true);onBusy?.(true);setError("");setCurrent(undefined);
  try{const result=await api.queryQianguanjia({...parsed.data,requestId:id,sessionId});if(request.current!==id)return;
   if(result.kind!=="plan-report"||result.requestId!==id||result.sessionId!==sessionId||result.data.scope!=="supplier-plan-ranking"||result.data.startDate!==startDate||result.data.endDate!==endDate||result.data.page!==page||result.data.filter!=="SMART_BID_CUSTOM")throw new Error();
   setCurrent({key,data:result.data});
  }catch{if(request.current===id){setError("计划榜读取失败，未用账户汇总或本地计划补齐。请重新连接后读取。");onSessionInvalid?.();}}
  finally{if(request.current===id){request.current=undefined;setBusy(false);onBusy?.(false);}}
 }
 const matches=visible&&previous?visible.rows.flatMap(row=>{const old=previous.rows.find(x=>x.planId===row.planId);return old?[{row,old}]:[]}):[];
 return <details className="qianguanjia-plan-report"><summary>计划维度 · 供应商计划榜</summary>
  <p className="qianguanjia-data-scope">使用上方日期。供应商用户范围，固定 SMART_BID_CUSTOM 筛选，每页10条。供应商分页总数无法核对，仅显示第一页观察，不代表完整计划目录。接口没有返回账户 ID，因此不受上方账户勾选限制，不推测账户归属。完整计划管理与投放操作仍使用千川入口。</p>
  <div className="qianchuan-query-actions"><button type="button" className="button secondary" disabled={!active||!sessionId||busy||externalBusy} onClick={()=>void read()}>查询供应商计划榜</button>{busy&&<button type="button" className="button secondary" onClick={()=>{cancel();setBusy(false);setCurrent(undefined);setError("计划榜查询已取消，迟到结果不会显示。");}}>取消计划榜查询</button>}</div>
  {busy&&<p role="status">正在读取计划榜…</p>}{error&&<p role="alert">{error}</p>}
  {visible?.availability==='not-provided'?<p>供应商未提供计划榜数据，不能当作零条。</p>:visible&&<>
   <p>{visible.startDate} 至 {visible.endDate} · 本页返回 {visible.rows.length} 条 · 全量总数未知 · 读取于 {new Date(visible.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）</p>
   {!visible.rows.length?<p>当前范围没有返回计划榜行。</p>:<div className="qianchuan-query-table"><table><thead><tr><th>计划（账户未返回）</th>{names.map(n=><th key={n}>{n}</th>)}</tr></thead><tbody>{visible.rows.map(row=><tr key={row.planId}><td>{row.name}<br/><small>{row.planId}</small></td>{QIANGUANJIA_REPORT_FIELDS.map(field=><td key={field}>{row.metrics[field]??'未知'}</td>)}</tr>)}</tbody></table></div>}
   <div className="qianchuan-query-actions"><button type="button" className="button secondary" disabled={!visible.rows.length} onClick={()=>setBaseline({sessionId,data:structuredClone(visible)})}>将计划榜本页设为基准</button></div>
  </>}
  {previous&&<section aria-label="供应商计划期间对比"><p>计划对比基准：{previous.startDate} 至 {previous.endDate} · 第 {previous.page} 页。按相同计划 ID 匹配，不按名称；缺行不补零，不合计 ROI，不折算不同期间长度。</p><button type="button" className="button secondary" onClick={()=>setBaseline(undefined)}>清除计划基准</button>
   {visible&&<><p>当前第 {visible.page} 页匹配 {matches.length} 行；当前未匹配 {visible.rows.length-matches.length} 行，基准未匹配 {previous.rows.length-matches.length} 行。差值为当前 − 基准。</p><div className="qianchuan-query-table"><table><thead><tr><th>计划 ID</th>{names.map(n=><th key={n}>{n}差值</th>)}</tr></thead><tbody>{matches.map(({row,old})=><tr key={row.planId}><td>{row.planId}</td>{QIANGUANJIA_REPORT_FIELDS.map(field=><td key={field}>{row.metrics[field]===null||old.metrics[field]===null?'未知':subtractDecimalExact(row.metrics[field]!,old.metrics[field]!)??'未知'}</td>)}</tr>)}</tbody></table></div></>}
  </section>}
 </details>;
}
