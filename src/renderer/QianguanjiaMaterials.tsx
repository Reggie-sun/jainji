import { useEffect, useRef, useState } from "react";
import type { QianguanjiaAccountDirectory, QianguanjiaDesktopApi } from "../shared/qianguanjia";
import type { QianguanjiaMaterialPage } from "../shared/qianguanjia-analysis";
import type { QianchuanUploadTaskStatus } from "../shared/douyin-upload";
import { qianguanjiaLocalMaterials, qianguanjiaMaterialLinks } from "../shared/qianguanjia-materials";
import { qianchuanUploadLabels } from "./qianchuan-upload-status";
import type { QianchuanAccountSummary } from "../shared/qianchuan-account";
import { QianguanjiaEffects } from "./QianguanjiaEffects";

export function QianguanjiaMaterials({ active, api, sessionId, directory, accounts = [], onBusy, onSessionInvalid }: {
  active:boolean; api:QianguanjiaDesktopApi; sessionId:string; directory?:QianguanjiaAccountDirectory;
  accounts?:QianchuanAccountSummary[];
  onBusy?(busy:boolean):void; onSessionInvalid?():void;
}) {
  const [advertiserId,setAdvertiserId]=useState("");
  const [catalog,setCatalog]=useState<QianguanjiaMaterialPage>();
  const [tasks,setTasks]=useState<QianchuanUploadTaskStatus[]>([]),[loaded,setLoaded]=useState(false),[observedAt,setObservedAt]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [effectsBusy,setEffectsBusy]=useState(false),effectsBusyRef=useRef(false);
  const [filter,setFilter]=useState(""),[stateFilter,setStateFilter]=useState(""),[localPage,setLocalPage]=useState(0);
  const current=useRef<{id:string;kind:"materials"|"local-materials"}>();
  const changeBusy=(value:boolean)=>{setBusy(value);onBusy?.(value||effectsBusyRef.current);};
  const changeEffectsBusy=(value:boolean)=>{effectsBusyRef.current=value;setEffectsBusy(value);onBusy?.(value||Boolean(current.current));};
  const combinedBusy=busy||effectsBusy;
  const cancel=()=>{
    const work=current.current;current.current=undefined;
    if(work)void api.cancelQianguanjiaQuery({requestId:work.id}).catch(()=>undefined);
    if(work?.kind==='materials')onSessionInvalid?.();
  };
  useEffect(()=>{cancel();changeBusy(false);setCatalog(undefined);setError("");setNotice("");return cancel;},[active,sessionId]);
  function resetAccount(id:string){cancel();changeBusy(false);setAdvertiserId(id);setCatalog(undefined);setError("");setNotice("");}
  async function read(kind:"materials"|"local-materials",page=1){
    if(!active||current.current||effectsBusyRef.current||kind==='materials'&&(!sessionId||!advertiserId))return;
    const work={id:crypto.randomUUID(),kind};current.current=work;changeBusy(true);setError("");setNotice("");
    if(kind==='materials')setCatalog(undefined);else{setTasks([]);setLoaded(false);setObservedAt("");}
    try{
      const next=await api.queryQianguanjia(kind==='materials'?{kind,requestId:work.id,sessionId,advertiserId,page,limit:20}:{kind,requestId:work.id});
      if(current.current!==work)return;
      if(next.kind!==kind||next.requestId!==work.id)throw new Error();
      if(next.kind==='materials'){
        if(next.sessionId!==sessionId||next.data.advertiserId!==advertiserId||next.data.page!==page||next.data.scope!=='supplier-platform-video-catalog')throw new Error();
        qianguanjiaMaterialLinks(next.data,tasks);setCatalog(next.data);
      }else if(next.kind==='local-materials'){
        qianguanjiaLocalMaterials(next.tasks);setTasks(next.tasks);setLoaded(true);setObservedAt(next.observedAt);setLocalPage(0);
      }
    }catch{
      if(current.current===work){setError(kind==='materials'?"平台素材读取未完成。请重新连接正常千管家会话后读取；没有自动同步或重试。":"本地上传记录读取失败，未展示部分或冲突记录。");
        if(kind==='materials')onSessionInvalid?.();}
    }finally{if(current.current===work){current.current=undefined;changeBusy(false);}}
  }
  const local=qianguanjiaLocalMaterials(tasks).filter(({task,accepted,contentCopies})=>(!advertiserId||task.advertiserId===advertiserId)&&
    (!filter||[task.file_name,task.artifact_sha256,task.export_task_id,task.acceptedEvidence?.platformVideoId??"",task.adId,task.project_id].some(v=>v.toLocaleLowerCase().includes(filter.toLocaleLowerCase())))&&
    (!stateFilter||stateFilter==='accepted'&&accepted||stateFilter==='unknown'&&task.upload_outcome==='MAY_HAVE_UPLOADED'||stateFilter==='duplicate'&&contentCopies>0));
  const pageCount=Math.ceil(local.length/20),shownPage=Math.min(localPage,Math.max(0,pageCount-1));
  const platform=catalog?qianguanjiaMaterialLinks(catalog,tasks).filter(({row})=>!filter||[row.filename,row.materialId,row.videoId].some(v=>v.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))):[];
  async function open(taskId:string){try{if(!await window.jianji.openArtifact(taskId))throw new Error();}catch{setError("成片未能打开。请在原项目作品中核对该导出任务及文件，本页不会切换项目。");}}
  return <section className="qianguanjia-card" aria-label="千管家素材中心">
    <div className="qianguanjia-card-title"><h2>素材中心</h2><span>平台视频 · 本地成片 · 上传回执</span></div>
    <div className="qianchuan-query-fields"><label>素材账户<select aria-label="素材账户" value={advertiserId} disabled={combinedBusy} onChange={e=>resetAccount(e.target.value)}><option value="">全部本地账户 / 请选择平台账户</option>
      {directory?.accounts.map(a=><option key={a.advertiserId} value={a.advertiserId}>{a.name} · {a.advertiserId}</option>)}
      {[...new Set(tasks.map(t=>t.advertiserId))].filter(id=>!directory?.accounts.some(a=>a.advertiserId===id)).map(id=><option key={id} value={id}>本地历史账户 · {id}</option>)}
    </select></label><label>素材搜索<input aria-label="素材中心搜索" placeholder="名称、素材/视频 ID、成片 SHA-256、计划 ID" value={filter} onChange={e=>{setFilter(e.target.value);setLocalPage(0);}} /></label>
    <label>本地状态<select aria-label="本地素材状态" value={stateFilter} onChange={e=>{setStateFilter(e.target.value);setLocalPage(0);}}><option value="">全部状态</option><option value="accepted">平台已接收</option><option value="unknown">上传结果未知</option><option value="duplicate">重复成片字节</option></select></label></div>
    <div className="qianchuan-query-actions"><button className="button secondary" disabled={!active||combinedBusy} onClick={()=>void read('local-materials')}>读取本地上传记录</button>
      <button className="button" disabled={!active||combinedBusy||!sessionId||!directory?.accounts.some(a=>a.advertiserId===advertiserId)} onClick={()=>void read('materials')}>读取平台素材</button>
      {busy&&<button className="button secondary" onClick={()=>{cancel();changeBusy(false);setCatalog(undefined);setNotice("读取已取消，迟到结果不会显示。平台查询需重新连接后再读。");}}>取消素材查询</button>}</div>
    {busy&&<p role="status">正在只读查询素材…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <QianguanjiaEffects active={active} tasks={tasks} loaded={loaded} accounts={accounts} directory={directory} externalBusy={busy} onBusy={changeEffectsBusy}/>
    <h3>平台素材</h3><p className="qianguanjia-data-scope">来源：千管家中台的千川视频目录。只查询已授权账户，不执行手动同步。目录没有投放效果的日期口径；供应商同步延迟未知。</p>
    {!catalog?<p>选择已连接的授权账户后读取平台视频目录。</p>:catalog.availability==='not-provided'?<p role="status">供应商未提供目录数据（total/list 为 null），不能解释为没有素材。</p>:<>
      <p>账户 {catalog.advertiserId} · 读取于 {new Date(catalog.observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 共 {catalog.total} 条 · 第 {catalog.page} 页，本页匹配 {platform.length} 条</p>
      {!catalog.total?<p>供应商为该账户明确返回了空目录。</p>:!platform.length?<p>本页没有匹配的平台素材，请调整搜索或翻页。</p>:<div className="qianchuan-query-table"><table><thead><tr><th>平台视频素材</th><th>本地成片关联</th></tr></thead><tbody>{platform.map(({row,uploads,samePlatformVideo,conflictingLocalContent})=><tr key={row.materialId}><td>{row.filename}<br/><small>素材 {row.materialId}<br/>视频 {row.videoId}<br/>时长 {row.durationSeconds??'未知'} 秒</small>{samePlatformVideo>1&&<p>本页有 {samePlatformVideo} 条相同平台视频标识</p>}</td>
        <td>{conflictingLocalContent?'接收回执对应不同成片字节，关联存在冲突，请核查':uploads.length?uploads.map(t=><p key={t.upload_task_id}>精确账户与视频 ID 匹配 · {t.file_name}<br/><small>项目 {t.project_id} · 计划 {t.adId}<br/>SHA-256 {t.artifact_sha256}</small></p>):loaded?'未找到可靠的本地接收回执；不代表未上传':'请先读取本地上传记录以核对关联'}</td></tr>)}</tbody></table></div>}
      {catalog.page>=500&&catalog.page*20<(catalog.total??0)&&<p role="status">已达到本次目录读取上限（500页 / 10,000条）；其余素材未读取，不代表完整目录。</p>}
      <div className="qianchuan-query-actions"><button className="button secondary" disabled={combinedBusy||catalog.page<=1} onClick={()=>void read('materials',catalog.page-1)}>上一页平台素材</button><button className="button secondary" disabled={combinedBusy||catalog.page>=500||catalog.page*20>=(catalog.total??0)} onClick={()=>void read('materials',catalog.page+1)}>下一页平台素材</button></div>
    </>}
    <h3>本地成片与上传记录</h3><p className="qianguanjia-data-scope">来源：原上传账本，包含各项目的已登记成片及关闭批次。只有有效平台接收回执标为已接收；READY、等待确认和未知结果分别保留。未登记上传的成片不在此列表。</p>
    {!loaded?<p>尚未读取本地上传记录。</p>:<><p>读取于 {new Date(observedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 匹配 {local.length} / {tasks.length} 条记录。相同 SHA-256 表示成片字节重复，不自动合并不同账户或计划。</p>
      {!local.length?<p>没有匹配的本地上传记录。</p>:<div className="qianchuan-query-table"><table><thead><tr><th>本地成片 / 冻结目标</th><th>上传状态与重复情况</th></tr></thead><tbody>{local.slice(shownPage*20,shownPage*20+20).map(({task,valid,accepted,contentCopies})=><tr key={task.upload_task_id}><td>{task.file_name}<br/><small>账户 {task.advertiserId} / 计划 {task.adId}<br/>项目 {task.project_id}<br/>导出任务 {task.export_task_id}<br/>SHA-256 {task.artifact_sha256}</small><br/><button className="button secondary" onClick={()=>void open(task.export_task_id)}>打开原成片</button></td><td>{valid?(accepted?'平台已接收':qianchuanUploadLabels[task.state]):'接收证据无效'} · {task.upload_outcome}
        {task.acceptedEvidence&&valid&&<p>视频 {task.acceptedEvidence.platformVideoId}</p>}{contentCopies>0&&<p>同字节另有 {contentCopies} 条上传记录</p>}{task.duplicate_of&&<small>原账本重复引用 {task.duplicate_of}</small>}</td></tr>)}</tbody></table></div>}
      {pageCount>1&&<div className="qianchuan-query-actions"><button className="button secondary" disabled={shownPage===0} onClick={()=>setLocalPage(shownPage-1)}>上一页本地记录</button><span>第 {shownPage+1}/{pageCount} 页</span><button className="button secondary" disabled={shownPage+1>=pageCount} onClick={()=>setLocalPage(shownPage+1)}>下一页本地记录</button></div>}
    </>}
    <p className="qianguanjia-data-scope">仅按账户及精确平台视频 ID 连接有效接收回执；名称和供应商 MD5 不用于推测本地身份。目录不证明审核通过、已投放或产生效果。投放操作继续使用千川现有入口。</p>
  </section>;
}
