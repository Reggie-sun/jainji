import {expect,it} from 'vitest';
import type {QianchuanUploadTaskStatus} from '../src/shared/douyin-upload';
import type {QianchuanAccountSummary} from '../src/shared/qianchuan-account';
import type {QianguanjiaAccountDirectory} from '../src/shared/qianguanjia';
import {qianguanjiaEffectTargets} from '../src/shared/qianguanjia-effect-targets';
const account='9007199254740993',plan='18446744073709551615';
const configured:QianchuanAccountSummary[]=[{product:'眼贴',productName:'实际产品',advertiserId:account,adId:plan,available:true}];
const task=(extra:Partial<QianchuanUploadTaskStatus>={}):QianchuanUploadTaskStatus=>({project_id:'d1111111-1111-4111-8111-111111111111',batch_id:'d2222222-2222-4222-8222-222222222222',export_task_id:'d4444444-4444-4444-8444-444444444444',upload_task_id:'a'.repeat(64),artifact_sha256:'b'.repeat(64),file_name:'same.mp4',accountProduct:'眼贴',advertiserId:account,adId:plan,state:'ACCEPTED',upload_outcome:'ACCEPTED',retryable:false,retry_count:0,attempt_count:1,timestamp:'2026-10-16T01:00:00.000Z',acceptedEvidence:{advertiserId:account,adId:plan,fileName:'same.mp4',selectedCount:1,observedAt:'2026-10-16T01:00:00.000Z',pageOwnership:{targetId:'target-1',pageBatchId:'d2222222-2222-4222-8222-222222222222',modalSessionId:'d3333333-3333-4333-8333-333333333333'},platformVideoId:'video-1',attempt:1,requestSha256:'c'.repeat(64),responseSha256:'d'.repeat(64)},...extra});
const directory=(ids:string[]):QianguanjiaAccountDirectory=>({source:'qianguanjia',observedAt:'2026-10-16T01:00:00.000Z',accounts:ids.map(advertiserId=>({advertiserId,name:'同名',authStatus:0,authStatusDesc:'授权正常'}))});
it('keeps real receipt targets readable even when missing from supplier and distinguishes unread directory',()=>{
 expect(qianguanjiaEffectTargets([task()],configured)[0]).toMatchObject({advertiserId:account,adId:plan,readable:true,supplierListed:undefined,acceptedCount:1,uniqueVideos:1});
 expect(qianguanjiaEffectTargets([task()],configured,directory([]))[0]).toMatchObject({supplierListed:false,readable:true});
 expect(qianguanjiaEffectTargets([task()],configured,directory([account]))[0]).toMatchObject({supplierListed:true,label:'实际产品'});
});
it('preserves separate frozen plans, accounts and slots instead of matching same names or numeric conversions',()=>{
 const one=task(),other=task({upload_task_id:'e'.repeat(64),adId:'123',acceptedEvidence:{...one.acceptedEvidence!,adId:'123'}});
 const targets=qianguanjiaEffectTargets([one,other],configured,directory(['9007199254740992']));
 expect(targets).toHaveLength(2);expect(targets.every(t=>!t.supplierListed&&t.readable)).toBe(true);expect(new Set(targets.map(t=>t.key)).size).toBe(2);
});
it('blocks changed or unavailable saved slots and never retargets by name',()=>{
 expect(qianguanjiaEffectTargets([task()],[{...configured[0]!,advertiserId:'123'}])[0]).toMatchObject({readable:false,readBlock:'slot-changed'});
 expect(qianguanjiaEffectTargets([task()],[{...configured[0]!,available:false}])[0]).toMatchObject({readable:false,readBlock:'slot-unavailable'});
 expect(qianguanjiaEffectTargets([task()],[])[0]).toMatchObject({readable:false,readBlock:'slot-unavailable'});
});
it('does not promote READY or unknown to accepted targets and rejects malformed acceptance',()=>{
 const unknown=task({state:'NEEDS_HUMAN',upload_outcome:'MAY_HAVE_UPLOADED',acceptedEvidence:undefined});
 const accepted=task(),ready=task({upload_task_id:'e'.repeat(64),state:'WAITING_FOR_CONFIRMATION',upload_outcome:'READY',acceptedEvidence:undefined,readyEvidence:{advertiserId:account,adId:plan,fileName:accepted.file_name,selectedCount:1,observedAt:accepted.timestamp,pageOwnership:accepted.acceptedEvidence!.pageOwnership}});
 expect(qianguanjiaEffectTargets([unknown,ready],configured)).toEqual([]);
 expect(()=>qianguanjiaEffectTargets([task({acceptedEvidence:undefined})],configured)).toThrow();
});
it('deduplicates exact aliases, rejects conflicting record IDs and excludes ambiguous video bytes',()=>{
 const a=task(),same=task(),conflict=task({upload_task_id:'e'.repeat(64),artifact_sha256:'f'.repeat(64)});
 expect(qianguanjiaEffectTargets([a,same],configured)[0]!.acceptedCount).toBe(1);
 expect(()=>qianguanjiaEffectTargets([a,task({artifact_sha256:'f'.repeat(64)})],configured)).toThrow(/冲突/);
 const result=qianguanjiaEffectTargets([a,conflict],configured)[0]!;expect(result.conflictingVideoIds).toEqual(['video-1']);expect(result.attributableTasks).toEqual([]);expect(result.uniqueVideos).toBe(1);
});
it('reports all projects but never counts one platform video as two unique videos',()=>{
 const a=task(),b=task({upload_task_id:'e'.repeat(64),project_id:'d1111111-1111-4111-8111-111111111112'});
 expect(qianguanjiaEffectTargets([a,b],configured)[0]).toMatchObject({acceptedCount:2,uniqueVideos:1,projectCount:2,conflictingVideoIds:[]});
});
it('keeps account-video byte conflicts visible across different plans',()=>{
 const a=task(),b=task({upload_task_id:'e'.repeat(64),artifact_sha256:'f'.repeat(64),adId:'123',acceptedEvidence:{...a.acceptedEvidence!,adId:'123'}});
 const targets=qianguanjiaEffectTargets([a,b],configured);expect(targets).toHaveLength(2);expect(targets.every(t=>t.attributableTasks.length===0&&t.conflictingVideoIds[0]==='video-1')).toBe(true);
});
it('uses the bound Chrome profile label only for the exact frozen advertiser identity',()=>{
 const saved={...configured[0]!,browserProfileName:'当前Chrome档案'};
 expect(qianguanjiaEffectTargets([task()],[saved])[0]).toMatchObject({label:'当前Chrome档案',product:'眼贴',advertiserId:account,adId:plan,readable:true});
 const changed=qianguanjiaEffectTargets([task()],[{...saved,advertiserId:'123'}])[0]!;
 expect(changed.label).not.toBe('当前Chrome档案');expect(changed).toMatchObject({readable:false,readBlock:'slot-changed',advertiserId:account,adId:plan});
});
