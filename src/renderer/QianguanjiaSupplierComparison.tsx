import { useEffect, useState } from "react";
import { QIANGUANJIA_REPORT_FIELDS, type QianguanjiaReportPage } from "../shared/qianguanjia-analysis";
import { subtractDecimalExact } from "../shared/qianguanjia-view";

const names=["平台消耗","成交订单数","含券成交金额","支付 ROI"];
/** Keeps one explicitly selected, already-read page for a same-account period comparison. No extra requests. */
export function QianguanjiaSupplierComparison({current,sessionId,accountIds}:{current?:QianguanjiaReportPage;sessionId:string;accountIds:string[]}) {
  const [baseline,setBaseline]=useState<QianguanjiaReportPage>();
  const binding=JSON.stringify([sessionId,[...accountIds].sort()]);
  const [baselineBinding,setBaselineBinding]=useState("");
  useEffect(()=>{setBaseline(undefined);setBaselineBinding("");},[binding]);
  const visible=baselineBinding===binding?baseline:undefined;
  const compatible=current&&visible&&current.scope===visible.scope&&current.page===visible.page&&
    JSON.stringify([...current.advertiserIds].sort())===JSON.stringify([...visible.advertiserIds].sort());
  const rows=compatible?current.rows.flatMap(row=>{const previous=visible.rows.find(other=>other.advertiserId===row.advertiserId);return previous?[{row,previous}]:[]}):[];
  return <section aria-label="供应商历史期间对比">
    <div className="qianchuan-query-actions"><button type="button" className="button secondary" disabled={!current||current.availability!=="provided"||!current.rows.length} onClick={()=>{setBaseline(structuredClone(current!));setBaselineBinding(binding);}}>将本页设为对比基准</button>
      {visible&&<button type="button" className="button secondary" onClick={()=>setBaseline(undefined)}>清除对比基准</button>}</div>
    {!visible?<p className="qianguanjia-data-scope">可将实际读取的一页设为基准，再更改日期并查询。只对两个期间均返回的相同账户比较；缺行不补零。</p>:<>
      <p>对比基准：{visible.startDate} 至 {visible.endDate} · 第 {visible.page} 页 · 读取于 {new Date(visible.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间）。基准仅保留在本页，切换会话或账户后清除。</p>
      {current&&compatible?<><p>当前：{current.startDate} 至 {current.endDate} · 第 {current.page} 页。按账户 ID 匹配 {rows.length} 行；当前页未匹配 {current.rows.length-rows.length} 行，基准页未匹配 {visible.rows.length-rows.length} 行。差值为当前 − 基准，未折算不同区间长度。</p>
        {!!rows.length&&<div className="qianchuan-query-table"><table><thead><tr><th>账户</th>{names.map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map(({row,previous})=><tr key={row.advertiserId}><td>{row.name}<br/><small>{row.advertiserId}</small></td>{QIANGUANJIA_REPORT_FIELDS.map(field=>{
          const now=row.metrics[field],old=previous.metrics[field],delta=now===null||old===null?null:subtractDecimalExact(now,old);
          return <td key={field}>当前 {now??'未知'}<br/>基准 {old??'未知'}<br/>差值 {delta??'未知'}</td>;
        })}</tr>)}</tbody></table></div>}</>:<p>请选择相同账户集合和页码，查询另一个日期范围后比较。基准不代表当前查询结果。</p>}
    </>}
  </section>;
}
