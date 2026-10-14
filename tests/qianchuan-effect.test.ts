import { describe, expect, it } from "vitest";
import type { QianchuanQueryMetrics } from "../src/shared/qianchuan-backend";
import type { QianchuanUploadTaskStatus } from "../src/shared/douyin-upload";
import { joinQianchuanEffects } from "../src/shared/qianchuan-effect";

const metrics: QianchuanQueryMetrics = {
  stat_cost_for_roi2: { value: "12.34", display: "12.34" },
  total_pay_order_count_for_roi2: { value: "2", display: "2" },
  total_pay_order_gmv_include_coupon_for_roi2: { value: "56.78", display: "56.78" },
  total_prepay_and_pay_order_roi2: { value: "4.6", display: "4.6" },
};

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

function row(materialId: string, videoId?: string, name = "same-name.mp4") {
  return { materialId, ...(videoId === undefined ? {} : { videoId }), name, metrics };
}

function snapshot(rows: ReturnType<typeof row>[], advertiser = advertiserId, ad = adId) {
  return { advertiserId: advertiser, adId: ad, rows };
}

describe("joinQianchuanEffects", () => {
  it("matches only exact platform video IDs and keeps IDs as strings", () => {
    const accepted = task({ state: "ACCEPTED", acceptedEvidence: {
      ...task({ state: "ACCEPTED" }).acceptedEvidence!,
      platformVideoId: "9007199254740993",
    } });
    const exact = row("18446744073709551615", "9007199254740993");
    const sameNameButDifferentVideo = row("12", "other-video");

    expect(joinQianchuanEffects([accepted], snapshot([sameNameButDifferentVideo, exact]))).toEqual([
      { task: accepted, status: "matched", materials: [exact] },
    ]);
  });

  it("keeps account and plan targets frozen and excludes tasks from other targets", () => {
    const selected = task({ state: "ACCEPTED" });
    const otherAdvertiser = task({ state: "ACCEPTED", advertiserId: "9007199254740994" });
    const otherPlan = task({ state: "ACCEPTED", adId: "18446744073709551614" });

    expect(joinQianchuanEffects([selected, otherAdvertiser, otherPlan], snapshot([row("1", "video-1")]))).toEqual([
      { task: selected, status: "matched", materials: [row("1", "video-1")] },
    ]);
  });

  it("retains READY and MAY_HAVE_UPLOADED tasks without treating them as accepted", () => {
    const ready = task({ state: "WAITING_FOR_CONFIRMATION", upload_outcome: "READY" });
    const unknown = task({ state: "NEEDS_HUMAN", upload_outcome: "MAY_HAVE_UPLOADED" });

    expect(joinQianchuanEffects([ready, unknown], snapshot([row("1", "video-1")]))).toEqual([
      { task: ready, status: "not-accepted", materials: [] },
      { task: unknown, status: "not-accepted", materials: [] },
    ]);
  });

  it("reports malformed task evidence instead of associating its video", () => {
    const invalid = task({ state: "ACCEPTED", acceptedEvidence: undefined });

    expect(joinQianchuanEffects([invalid], snapshot([row("1", "video-1")]))).toEqual([
      { task: invalid, status: "invalid-evidence", materials: [] },
    ]);
  });

  it("keeps every material row belonging to one accepted video", () => {
    const accepted = task({ state: "ACCEPTED" });
    const first = row("1", "video-1", "first display name");
    const second = row("2", "video-1", "second display name");

    expect(joinQianchuanEffects([accepted], snapshot([first, second]))).toEqual([
      { task: accepted, status: "matched", materials: [first, second] },
    ]);
  });

  it("marks an accepted upload absent from the selected snapshot as not observed", () => {
    const accepted = task({ state: "ACCEPTED" });

    expect(joinQianchuanEffects([accepted], snapshot([row("1", "different-video")]))).toEqual([
      { task: accepted, status: "not-observed", materials: [] },
    ]);
  });

  it("rejects an entire snapshot with duplicate material IDs or invalid IDs", () => {
    const accepted = task({ state: "ACCEPTED" });
    const duplicateMaterialIds = [row("1", "video-1"), row("1", "video-1")];
    const invalidMaterialId = [row("01", "video-1")];
    const invalidVideoId = [row("1", "video with spaces")];

    const invalidSnapshots = [
      snapshot(duplicateMaterialIds),
      snapshot(invalidMaterialId),
      snapshot(invalidVideoId),
      snapshot([row("1", "video-1")], "0", adId),
    ];
    for (const invalidSnapshot of invalidSnapshots) {
      expect(() => joinQianchuanEffects([accepted], invalidSnapshot)).toThrow("千川素材快照无效，已拒绝本次效果查询。");
    }
  });

  it("strips only live rowReady before validating the persisted result contract", () => {
    const acceptedWithLiveRow = task({ state: "ACCEPTED", rowReady: true });
    const acceptedWithUnexpectedField = task({ state: "ACCEPTED", injected: true });

    expect(joinQianchuanEffects([acceptedWithLiveRow], snapshot([row("1", "video-1")]))[0]).toMatchObject({
      task: acceptedWithLiveRow,
      status: "matched",
    });
    expect(joinQianchuanEffects([acceptedWithUnexpectedField], snapshot([row("1", "video-1")]))).toEqual([
      { task: acceptedWithUnexpectedField, status: "invalid-evidence", materials: [] },
    ]);
  });
});
