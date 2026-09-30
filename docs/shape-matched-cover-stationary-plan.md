# Stationary Shape Cover Implementation Plan

## Goal and Scope

实现 [stationary contract](shape-matched-cover-stationary-spec.md) 的完整帧轮廓并集和真实 FFmpeg 固定遮盖验证。Native Codex 串行实施，沿用当前 working tree；mapper 只读。用户当前禁止 Kimi，工程 delegation 使用 named native profile。

## Contract Surfaces and Invariants

新增 `shape-cover-stationary-envelope.ts` 的 owned evidence 输入及非权威 receipt；逐帧来源与候选保留、私有栅格副本、完整范围和固定 anchor。复用 D1/D2、像素投影/有限轮廓扩张及 PNG API。不修改 production assembler、source schema、human session、manual、assisted、队列和 renderer。M5-D2A正式资格/生产状态不提升。

## Major Milestones

### M1: Complete Bound Envelope

Files：新增 `src/main/shape-cover-stationary-envelope.ts`、`tests/shape-cover-stationary-envelope.test.ts`。
逐帧读取 owned evidence，核对声明绑定与严格 mask，合并可见位，冻结全部来源和摘要；moving/unknown、漏帧、wrong ordinal/PTS/hash、anchor变化、无有效轮廓、超边界、取消和伪造 ownership 均拒绝。动画bbox/面积变化允许，但不能凭 union 证明 stationary 或语义完整。
Verification：TDD否定测试和真实 D1/evidence 集成；投影及原静态候选回归。

### M2: Real Local Render Evidence

Files：新增 `scripts/shape-cover-stationary-diagnostic.ts`。
只读真实视频背景，在独占私有目录构造明确标记的 static 与 stationary-animation controlled composite，保存每帧已知轮廓，并用 canonical evidence 构造并集。用已有上传静态贴纸生成同一冻结 PNG，逐帧投影+不透明像素核验；实际导出固定图层、检查全部输出PTS/帧数、音频及局部像素。移动与缺尾帧等负例拒绝。产物不得进入应用知识、队列或正式 qualification。
Acceptance：完整且不露边的局部像素证据，保留源片与成片供播放；主观自然度独立记录，不由局部 coverage 代填。

### M3: Verify and Record

Files：维护当前总计划、本plan及新增 `docs/shape-matched-cover-stationary-record.md`；AOCI共享索引经用户本次明确增量授权维护，保留且不提交既有dirty内容。
本轮回归实际发现 `tests/shape-cover-candidates.test.ts` 丢失发布返回用例错误关联并行阶段的首调用；该clean测试归本slice修复，通过强制倒序复现并按实际失败queue mediaId绑定断言，不修改任何production屏障或状态逻辑。
运行 fresh `npm run typecheck`、相关 tests、`git diff --check`；稳定候选按 SUBAGENTS Risk Gate 判断一次，必要时一个 read-only native reviewer，绑定 exact snapshot，Parent调查并裁决。AOCI官方完整批次维护与 Verify/Check/Guide。只提交本任务paths，保持其他所有dirty工作。记录真实模型 blocker 与下一步，不以工程成功称生产可用。

## Acceptance and Remaining Boundary

M1/M2/M3全部证据成立仅是 engineering candidate。实际 AI mask提取、stationarity语义审核、独立盲审资格及生产可信issuer缺失时保留 INCOMPLETE。这不是以plan或commit代替继续执行；本轮推进可独立完成的实现和验证直到真实外部gate。

## Self-Review

Spec各项映射M1/M2/M3；没有额外工作树、产品开关或新source owner；未把候选provider当qualified reviewer。来源逐帧完整和语义正确分别验证，受控合成与真实媒体分层。
