import {expect,it} from "vitest";
import type {QianchuanUploadTaskStatus} from "../src/shared/douyin-upload";
import type {QianguanjiaMaterialPage} from "../src/shared/qianguanjia-analysis";
import {qianguanjiaMaterialLinks,qianguanjiaLocalMaterials} from "../src/shared/qianguanjia-materials";
const advertiserId = "9007199254740993";
const adId = "18446744073709551615";
const pageBatchId = "d2222222-2222-4222-8222-222222222222";
const modalSessionId = "d3333333-3333-4333-8333-333333333333";
const observedAt = "2026-10-15T02:00:00.000Z";

function task(overrides: Record<string, unknown> = {}): QianchuanUploadTaskStatus {
  const accepted = overrides.state === "ACCEPTED" || overrides.upload_outcome === "ACCEPTED";
  const ready = overrides.state === "WAITING_FOR_CONFIRMATION" || overrides.upload_outcome === "READY";
  const common = {
    project_id: "d1111111-1111-4111-8111-111111111111",
    batch_id: pageBatchId,
    export_task_id: "d4444444-4444-4444-8444-444444444444",
    upload_task_id: "a".repeat(64),
    artifact_sha256: "b".repeat(64),
    file_name: "same-name.mp4",
    accountProduct: "眼贴",
    advertiserId,
    adId,
    state: accepted ? "ACCEPTED" : ready ? "WAITING_FOR_CONFIRMATION" : "NEEDS_HUMAN",
    upload_outcome: accepted ? "ACCEPTED" : ready ? "READY" : "MAY_HAVE_UPLOADED",
    retryable: false,
    retry_count: 0,
    attempt_count: 1,
    timestamp: observedAt,
    ...(accepted ? { acceptedEvidence: {
      advertiserId,
      adId,
      fileName: "same-name.mp4",
      selectedCount: 1,
      observedAt,
      pageOwnership: { targetId: "target-1", pageBatchId, modalSessionId },
      platformVideoId: "video-1",
      attempt: 1,
      requestSha256: "c".repeat(64),
      responseSha256: "d".repeat(64),
    } } : {}),
    ...(ready ? { readyEvidence: {
      advertiserId,
      adId,
      fileName: "same-name.mp4",
      selectedCount: 1,
      observedAt,
      pageOwnership: { targetId: "target-1", pageBatchId, modalSessionId },
    } } : {}),
  };
  return { ...common, ...overrides } as QianchuanUploadTaskStatus;
}

const page=():QianguanjiaMaterialPage=>({source:'qianguanjia',scope:'supplier-platform-video-catalog',observedAt,advertiserId,page:1,limit:20,total:1,availability:'provided',rows:[{advertiserId,materialId:'1879999999999999999',videoId:'video-1',filename:'same-name.mp4',durationSeconds:12}]});
it('links only valid exact account and video evidence, never names, READY or unknown outcomes',()=>{
 const accepted=task({state:'ACCEPTED'}),ready=task({state:'WAITING_FOR_CONFIRMATION',upload_outcome:'READY'}),unknown=task(),other=task({state:'ACCEPTED',advertiserId:'123'});
 expect(qianguanjiaMaterialLinks(page(),[accepted,ready,unknown,other])[0]!.uploads).toEqual([accepted]);
 const p=page();p.rows[0]!.videoId='different';expect(qianguanjiaMaterialLinks(p,[accepted])[0]!.uploads).toEqual([]);
});
it('marks exact byte duplicates across projects but does not merge upload targets',()=>{
 const a=task({state:'ACCEPTED'}),b=task({upload_task_id:'e'.repeat(64),project_id:'d1111111-1111-4111-8111-111111111112'});
 const rows=qianguanjiaLocalMaterials([a,b]);expect(rows.map(x=>[x.accepted,x.contentCopies])).toEqual([[true,1],[false,1]]);
});
it('rejects conflicting duplicate upload identities and invalid receipt evidence',()=>{
 const a=task({state:'ACCEPTED'}),b=task({state:'ACCEPTED',artifact_sha256:'e'.repeat(64)});
 expect(()=>qianguanjiaLocalMaterials([a,b])).toThrow(/冲突/);
 expect(qianguanjiaMaterialLinks(page(),[task({state:'ACCEPTED',acceptedEvidence:undefined})])[0]!.uploads).toEqual([]);
});
it('flags receipt content conflicts without declaring a unique local identity',()=>{
 const a=task({state:'ACCEPTED'}),b=task({state:'ACCEPTED',upload_task_id:'e'.repeat(64),artifact_sha256:'f'.repeat(64)});
 expect(qianguanjiaMaterialLinks(page(),[a,b])[0]!.conflictingLocalContent).toBe(true);
 const p=page();p.rows[0]!.advertiserId='123';expect(()=>qianguanjiaMaterialLinks(p,[a])).toThrow(/账户/);
});
