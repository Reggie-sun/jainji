import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Called only by the isolated Electron smoke. No user media or real providers.
export function knowledgeProviderFixture() {
  const counts = { detection: 0, recognition: 0, creative: 0, preview: 0 };
  const fixture = { counts, fail: false, hold: false, correct: false, afterCorrection: undefined, release: undefined, respond: async (input, response) => {
    const system = input.messages[0].content, content = input.messages[1].content;
    let result;
    if (system.includes("你是视频画面覆盖物追踪器")) {
      counts.detection++;
      if (fixture.hold) await new Promise(resolve => { fixture.release = resolve; });
      if (fixture.fail) { response.writeHead(503); response.end("{}"); return; }
      const times = content.flatMap(item => item.type === "text" && item.text.match(/^抽帧时间：(\d+)ms。$/) ? [Number(item.text.match(/^抽帧时间：(\d+)ms。$/)[1])] : []);
      assert.ok(times.length);
      result = { status: "ok", frames: times.map(timeMs => ({ timeMs, targets: [] })) };
    } else if (system.includes("当前阶段是原贴纸识别")) {
      counts.recognition++;
      const context = JSON.parse(content[0].text.slice("检查上下文：".length).split("。原图时间：")[0]);
      result = { action: "resolve", reason: "synthetic source reviewed", frames: context.proposal };
    } else if (system.includes("你是视频包装主管 Agent")) {
      counts.preview++; result = { action: "pass", reason: "synthetic preview reviewed" };
      if (fixture.correct) {
        fixture.correct = false;
        const context = JSON.parse(content[0].text.slice("当前样片上下文：".length)), facts = context.knowledge.facts;
        const rectangle = { x: 0.45, y: 0.45, width: 0.1, height: 0.1 };
        const track = { startMs: 0, endMs: context.trackHorizonMs, keyframes: [{ timeMs: 0, rectangle }] };
        const evidenceIds = facts.observations.map(o => o.evidenceId);
        result = { action: "revise", reason: "synthetic source correction", tracks: [{ targetId: "fixture", track }],
          sourceFacts: { ...facts, targets: [{ id: "fixture", segments: [{ id: "fixture-0", track, evidenceIds, interpolation: "linear" }] }],
            observations: evidenceIds.map(evidenceId => ({ evidenceId, targetId: "fixture", presence: "PRESENT", rectangle })) },
          issues: [{ id: "missing", scope: "source", kind: "missing_target", reason: "fixture only", ranges: facts.reviewedRanges, evidenceIds: [evidenceIds[0]] }], resolvedIssueIds: ["missing"] };
      } else if (fixture.afterCorrection) { await fixture.afterCorrection(); fixture.afterCorrection = undefined; }
    } else if (system.includes("你是视频贴纸选材师")) {
      const entries = JSON.parse(system.split("完整目录为 [编号,名称,资格]：")[1]);
      result = { candidates: [entries.find(entry => entry[1] === "爱心" && entry[2] === "允许")[0]] };
    } else {
      counts.creative++;
      result = { summary: "合成素材测试", captions: [], filter: "none", intensity: 0, priceStyle: "classic",
        stickers: ["top-left", "top-right", "bottom-left", "bottom-right"].map(corner => ({ corner, sticker: "heart", width: 0.08, rotationDeg: 0 })) };
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  } };
  return fixture;
}

export async function runKnowledgeSmoke({ evaluate, click, waitFor, send, screenshot, apiPort, directory, fixture }) {
  const state = () => evaluate("window.jianji.getState()");
  const intent = () => evaluate("document.body.innerText.includes('已安排重新检查')");
  const setup = await evaluate(`window.jianji.saveConnection({ name:'Local knowledge fixture', baseUrl:'http://127.0.0.1:${apiPort}/v1', model:'fixture', apiKey:'local-only-fixture' })`);
  const connectionId = setup.connections.profiles[0].id;
  await evaluate(`window.jianji.selectConnection(${JSON.stringify(connectionId)})`);
  await click("素材工作台");
  await click("选择本地素材");
  await waitFor("document.body.innerText.includes('测试素材.mp4')");
  await click("下一步");
  await evaluate("document.querySelector('#product-price').focus()");
  await send("Input.insertText", { text: "手动展示\n19.9元" });
  await evaluate("document.querySelector('.directory-picker').click()");
  await waitFor("document.querySelector('.directory-picker')?.textContent.includes('output') && !document.querySelector('.directory-picker').disabled");
  const beforeIntent = { ...fixture.counts };
  await click("重新检查原贴纸");
  assert.equal(await intent(), true);
  assert.deepEqual(fixture.counts, beforeIntent, "marking refresh never calls providers");
  await click("交给 Agent，制作");
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('视觉识别模型')");
  assert.equal(await intent(), true, "rejected admission retains intent");
  assert.deepEqual(fixture.counts, beforeIntent);
  await click("自己设置");
  assert.equal(await intent(), false, "mode changes clear intent");
  await click("全部交给 Agent");
  assert.equal(await intent(), false, "intent cannot resurrect when switching back");
  await click("重新检查原贴纸");
  await click("素材工作台");
  await click("取消全选");
  await click("选择全部");
  await click("下一步");
  assert.equal(await intent(), false, "selection changes clear intent");
  await evaluate(`(async () => { const selection = {connectionId:${JSON.stringify(connectionId)},model:'fixture'}; await window.jianji.selectVisionConnection(selection); await window.jianji.selectReviewerConnection(selection); })()`);
  const first = await state();
  const base = { mediaIds: first.project.mediaItems.map(item => item.id), ruleId: "clean", brief: "", outputDirectory: path.join(directory, "output"), decorations: { mode: "agent", productPrice: "手动展示\n19.9元" } };
  for (const patch of [
    { sourceStickerRefresh: { projectId: crypto.randomUUID(), mediaIds: base.mediaIds } },
    { sourceStickerRefresh: { projectId: first.project.id, mediaIds: [crypto.randomUUID()] } },
    { decorations: { ...base.decorations, mode: "manual" }, sourceStickerRefresh: { projectId: first.project.id, mediaIds: base.mediaIds } },
  ]) {
    assert.equal(await evaluate(`(async () => { try { await window.jianji.startAgent(${JSON.stringify({ ...base, ...patch })}); return false; } catch { return true; } })()`), true, "IPC independently rejects stale/out-of-scope/mode refresh");
  }
  const complete = async () => {
    await waitFor("(async () => { const s = await window.jianji.getState(); return s.agentRun?.status === 'finished'; })()");
    const current = await state();
    assert.equal(current.agentRun.items[0].status, "exporting", JSON.stringify(current.agentRun));
    await waitFor("(async () => { const s = await window.jianji.getState(); return s.queue.batches.every(b => b.batch.tasks.every(t => t.status === 'completed')); })()");
    return (await state()).agentRun.items[0].sourceKnowledge;
  };
  await click("交给 Agent，制作");
  const cold = await complete();
  assert.equal(cold.origin, "cold"); assert.equal(cold.phase, "reviewed");
  const coldCounts = { ...fixture.counts };
  assert.ok(coldCounts.detection > 0 && coldCounts.recognition > 0);
  assert.equal(coldCounts.preview, 1); assert.equal(coldCounts.creative, 1);
  await screenshot("knowledge-cold");
  await click("规则模板");
  await click("交给 Agent，制作");
  const warm = await complete();
  assert.equal(warm.origin, "warm"); assert.equal(warm.recognitionRequests, 0);
  assert.equal(fixture.counts.detection, coldCounts.detection); assert.equal(fixture.counts.recognition, coldCounts.recognition);
  assert.equal(fixture.counts.preview, 2); assert.equal(fixture.counts.creative, 2);
  await evaluate("[...document.querySelectorAll('summary')].find(e => e.textContent === '查看核查说明').click()");
  assert.equal(await evaluate("document.body.innerText.includes('抽样核查') && document.body.innerText.includes('识别 0 次')"), true);
  await screenshot("knowledge-warm");
  await click("规则模板");
  await click("重新检查原贴纸");
  await click("交给 Agent，制作");
  const refreshed = await complete();
  assert.equal(refreshed.origin, "refresh");
  assert.equal(fixture.counts.detection, coldCounts.detection * 2);
  assert.equal(fixture.counts.recognition, coldCounts.recognition * 2);
  assert.equal(fixture.counts.preview, 3); assert.equal(fixture.counts.creative, 3);
  await click("规则模板");
  assert.equal(await intent(), false, "accepted start consumes once-only refresh");
  fixture.fail = true;
  await click("重新检查原贴纸"); await click("交给 Agent，制作");
  await waitFor("(async () => (await window.jianji.getState()).agentRun?.status === 'finished')()");
  assert.equal((await state()).agentRun.items[0].status, "failed");
  assert.equal((await state()).agentRun.items[0].sourceKnowledge.phase, "blocked");
  assert.equal(fixture.counts.creative, 3, "failed refresh never silently falls back to old knowledge");
  await screenshot("knowledge-failed-refresh");
  fixture.fail = false; fixture.hold = true;
  await click("规则模板"); await click("重新检查原贴纸"); await click("交给 Agent，制作");
  for (let attempt = 0; !fixture.release && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(fixture.release, "cancel while source provider is pending");
  await click("规则模板");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '重新检查原贴纸').disabled"), true);
  assert.equal(await evaluate(`(async () => { try { await window.jianji.startAgent(${JSON.stringify(base)}); return false; } catch { return true; } })()`), true, "main process rejects competing runs");
  await click("我的作品"); await click("停止本轮任务");
  fixture.hold = false; fixture.release();
  await waitFor("(async () => (await window.jianji.getState()).agentRun?.status === 'cancelled')()");
  assert.equal(fixture.counts.creative, 3, "late response after cancellation cannot continue to creation");
  fixture.correct = true;
  fixture.afterCorrection = async () => {
    await waitFor("document.body.innerText.includes('正在修正源贴纸事实')");
    await screenshot("knowledge-correcting");
  };
  await click("规则模板"); await click("交给 Agent，制作");
  const corrected = await complete();
  assert.equal(corrected.revisions, 1); assert.equal(corrected.renders, 2); assert.equal(corrected.previewRequests, 2);
  assert.equal(corrected.phase, "reviewed");
  assert.equal(fixture.counts.creative, 4, "source correction does not request a second creative plan");
  assert.equal(fixture.counts.preview, 5);
  const risks = (await state()).sourceKnowledgeRisks;
  assert.ok(Object.values(risks).includes("disputed"), "superseded source facts still warn for frozen historical results");
  await waitFor("document.body.innerText.includes('后来发现争议')");
  await screenshot("knowledge-history-dispute");
  const outcomes = JSON.parse(await readFile(path.join(directory, "source-sticker-knowledge", "outcomes.json"), "utf8")).records;
  assert.equal(outcomes.length, 6);
  assert.deepEqual(outcomes.map(row => row.result), ["queued", "queued", "queued", "failed", "cancelled", "queued"]);
  assert.deepEqual(outcomes[1].requests, { executor: 0, recognitionSupervisor: 0, previewSupervisor: 1, creative: 2 });
  assert.ok(outcomes.every(row => row.quality === "not-evaluated"));
  await click("规则模板"); await click("重新检查原贴纸");
  await click("新建创作"); await click("选择本地素材"); await click("下一步");
  assert.equal(await intent(), false, "new project cannot inherit refresh intent");
  await evaluate("document.querySelector('[aria-label=\"原贴纸知识重新检查\"]').scrollIntoView({block:'center'})");
  await screenshot("knowledge-project-reset");
  const report = { cold, warm, refreshed, corrected, outcomes, historicalRisks: risks, calls: fixture.counts, evidence: "isolated Electron IPC + synthetic video + mock provider + real FFmpeg; not real model quality acceptance" };
  await writeFile(path.join(directory, "knowledge-smoke.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, scope: "knowledge", directory, calls: fixture.counts }));
}
