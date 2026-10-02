# M2-A Static Conservative Mask Qualification

## Goal and Scope

依据已提交 [course-correction audit](shape-matched-cover-v1-simplification-audit.md)、[Delta Spec](shape-matched-cover-v1-simplification-spec.md)、[Plan](shape-matched-cover-v1-simplification-plan.md) 与 [Stationary record](shape-matched-cover-stationary-record.md)，只实现 candidate → 明确确认的 static target → 原像素保守 mask candidate → 完整承诺范围 deterministic verification → 独立 required-pixel comparison。Native Codex 拥有实施与裁决。

本轮用户明确确认 233 秒开发原片右上“国货之光”，完整 0–233 秒；该确认不证明 mask 或静态运动。M1 方法、阈值及原组件结果不调整。没有独立 required-pixel truth 时，真实 mask qualification 必须 INCOMPLETE，分母与漏失不得填零。

## Contracts and Boundaries

M1 ROI 是搜索线索，不是 mask。确认绑定 sourceKey、M1 evidence/result digest、candidateId、targetId、用户确认来源和精确半开 ordinal/PTS 范围；只认本进程生成对象，JSON 不恢复 ownership。候选身份通过原 discovery owner 重算，不引入新的 detector。

扩展搜索 ROI 只为核查边缘，原像素 temporal statistics 生成非矩形支持与有限外扩；细尖、孔洞、抗锯齿及未界定透明贡献需独立证据。代表帧只建候选，完整范围原像素流验证保留每个 ordinal/PTS/endPTS/hash，包含首尾；异常不缩范围、不过滤失败帧。支持声明仅 static development；动画不开放。

不写 knowledge/admission/store，不提供 source proof 或产品许可；本 slice 在原 extractor/qualification 暴露独立 development 接缝。shape matching、placement、output coverage、visual safety、production/IPC/guard、D2Q 均不实施。

## File Responsibilities

- `source-mask-static-target.ts`：候选确认与原 source clock/FFmpeg owner 上的完整目标 ROI 流；CPU-only、精确绑定、取消/freshness、私有 ownership，无全片 RGBA spool。
- `source-mask-static-extraction.ts`：原像素 temporal 支持、保守候选、完整范围 static anomaly verification；由 `source-mask-auto-extraction.ts` 导出。
- `source-mask-static-qualification.ts`：提前冻结独立 required-pixel truth、原范围绑定、逐帧零漏比较与明确未知；由 `source-mask-auto-qualification.ts` 导出。
- `tests/source-mask-static.test.ts`：受控原媒体和独立 construction truth、尾帧/尖角/移动/闪烁/错源/缺范围/克隆/取消/预算负例。
- `scripts/shape-cover-static-diagnostic.ts`：真实 CPU 开发入口、原像素联系证据、mask、完整范围 receipt/metrics，缺独立 truth 明确 INCOMPLETE。
- 原 Stationary record：真实运行、失败、支持限制、Review Risk Gate 和 AOCI 结果。

## Major Milestones

1. 确认及 ROI-only 完整范围 streaming，复用 source identity、clock、FFmpeg 双 pipe framehash；不修改 M1 或 D1/D2 合同。
2. 提前冻结方法后建保守 mask candidate；以同一源同一 ROI 对完整目标范围逐帧核验静态像素支持。有限预算：ROI 最长边512、padding12px、96建模代表帧、单decode进程、总5min、工作集512MiB、receipt16MiB；不落全片RGBA。误差参数是 development 包络，不是通用真实性证明。
3. 独立像素 comparator 和真实诊断；construction truth 必须由媒体生成几何提前冻结，禁止从算法 mask 导出 truth。真实缺 truth 保留独立像素指标null及qualification INCOMPLETE；不以 development MATCH 声称三个独立来源或 holdout 通过。

## Verification and Completion

fresh `npm run typecheck`、新 static suite 和受影响 discovery/extraction/qualification/activation/pixel tests；真实233秒全6990帧 CPU 诊断，记录source/hash、范围、首尾、decode/mask/verification用时、父子RSS、scratch和失败。严格检查源未变和guard仍关闭。scripts单独tsc/esbuild。

按稳定对象清单维护 AOCI；运行中提交的 AGENTS amendment `e491e43` 明确本 session 必要共享索引更新已授权，按完整机器批次与CAS处理，不修改其他任务业务文件。维护完成后用户明确选择A，由另一窗口统一承接共享索引提交；本轮只提交业务代码、测试、脚本、plan和record，保留已维护索引字节。记录真实验收缺口。

## Self-Review

确认、候选mask、全范围deterministic观察与独立pixel qualification四种证据分离。完整原像素时域不签发贴纸语义或独立边缘真值。真实范围失败保持完整范围；不把粗ROI填满作为oldStickerMask，不用冻结候选证明自身完整性。未知明确阻断；产品保持关闭。
