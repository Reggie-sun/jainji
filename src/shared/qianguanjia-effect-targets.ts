import {QianchuanUploadResultSchema,type QianchuanUploadTaskStatus} from './douyin-upload.js';
import {qianchuanAccountName,type QianchuanAccountSummary,type QianchuanProduct} from './qianchuan-account.js';
import type {QianguanjiaAccountDirectory} from './qianguanjia.js';

export interface QianguanjiaEffectTarget {
 key:string;product:QianchuanProduct;advertiserId:string;adId:string;label:string;
 tasks:QianchuanUploadTaskStatus[];attributableTasks:QianchuanUploadTaskStatus[];
 acceptedCount:number;uniqueVideos:number;projectCount:number;latestAcceptedAt:string;
 supplierListed:boolean|undefined;readable:boolean;readBlock:'slot-unavailable'|'slot-changed'|undefined;
 conflictingVideoIds:string[];
}

/** Frozen receipt scope, not a source of browser or platform authority. */
export function qianguanjiaEffectTargets(tasks:QianchuanUploadTaskStatus[],accounts:QianchuanAccountSummary[],directory?:QianguanjiaAccountDirectory):QianguanjiaEffectTarget[]{
 if(tasks.length>10000)throw new Error('本地上传记录超过本次读取上限。');
 const records=new Map<string,QianchuanUploadTaskStatus>();
 for(const task of tasks){
  const {rowReady:_rowReady,...value}=task;
  const parsed=QianchuanUploadResultSchema.safeParse(value);
  if(!parsed.success)throw new Error('本地上传记录无法核对，未生成效果目标。');
  const previous=records.get(parsed.data.upload_task_id);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(parsed.data))throw new Error('上传记录包含冲突身份。');
  records.set(parsed.data.upload_task_id,parsed.data);
 }
 const groups=new Map<string,QianchuanUploadTaskStatus[]>(),videoBytes=new Map<string,Set<string>>();
 for(const task of records.values()){
  if(task.state!=='ACCEPTED'||task.upload_outcome!=='ACCEPTED'||!task.acceptedEvidence)continue;
  const key=JSON.stringify([task.accountProduct,task.advertiserId,task.adId]);
  const group=groups.get(key)??[];group.push(task);groups.set(key,group);
  const video=JSON.stringify([task.advertiserId,task.acceptedEvidence.platformVideoId]);
  const bytes=videoBytes.get(video)??new Set<string>();bytes.add(task.artifact_sha256);videoBytes.set(video,bytes);
 }
 return [...groups].map(([key,members])=>{
  const first=members[0]!,saved=accounts.filter(a=>a.product===first.accountProduct);
  const binding=saved.length===1?saved[0]:undefined;
  const readBlock=!binding?.available?'slot-unavailable' as const:binding.advertiserId!==first.advertiserId?'slot-changed' as const:undefined;
  const videos=[...new Set(members.map(t=>t.acceptedEvidence!.platformVideoId))];
  const conflictingVideoIds=videos.filter(video=>(videoBytes.get(JSON.stringify([first.advertiserId,video]))?.size??0)>1);
  return {key,product:first.accountProduct,advertiserId:first.advertiserId,adId:first.adId,label:binding?.advertiserId===first.advertiserId?qianchuanAccountName(binding):`账户 ${first.advertiserId}`,
   tasks:members,attributableTasks:members.filter(t=>!conflictingVideoIds.includes(t.acceptedEvidence!.platformVideoId)),
   acceptedCount:members.length,uniqueVideos:videos.length,projectCount:new Set(members.map(t=>t.project_id)).size,
   latestAcceptedAt:members.reduce((latest,t)=>Date.parse(t.acceptedEvidence!.observedAt)>Date.parse(latest)?t.acceptedEvidence!.observedAt:latest,first.acceptedEvidence!.observedAt),
   supplierListed:directory?directory.accounts.some(a=>a.advertiserId===first.advertiserId):undefined,
   readable:readBlock===undefined,readBlock,conflictingVideoIds};
 }).sort((a,b)=>Date.parse(b.latestAcceptedAt)-Date.parse(a.latestAcceptedAt)||a.key.localeCompare(b.key));
}
