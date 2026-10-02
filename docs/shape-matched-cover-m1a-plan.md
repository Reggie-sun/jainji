# M1-A Stationary Discovery Implementation Plan

## Goal and Scope

从当前 HEAD `91ecc55` 开始，执行 [course-correction M1-A](shape-matched-cover-v1-simplification-plan.md#the-only-next-implementation-slice--m1-a)。全画布 CPU temporal/edge/component discovery，不输入 ROI、贴纸 ID 或 mask；所有输出 `authority=none / eligible=false`，身份等待确认。未发现不证明不存在。

## Owners and Contracts

- `source-fact-census.ts`：共享现有严格 FFprobe clock/packet 解读和受限子进程，不改变 full-census 结果或旧 D2 行为。
- 新 `source-fact-discovery-evidence.ts`：独立 bounded representative RGBA 模式，复用 `parseFullDecodeClock`、`identifySource`、`sourceKey` 和 engine fingerprint；最多96帧、一个同时运行的解码进程、512MiB scratch、5min总期限；只保存抽样原像素，私有临时证据关闭即清理。
- 新 `shape-cover-stationary-discovery.ts`：流式低分辨率 RGB 方差、持久边缘与相邻帧一致性；所有8连通分量分别记录、原像素 ROI复算；固定坐标信号不证明贴纸身份，不生成 mask，不签 stationary motion proof。
- 新 diagnostic CLI：接原 source identity JSON、源路径、已有FFmpeg工具与新输出目录，不接用户框或mask。保存结果、资源和失败证据，可输出供检查的候选原图。
- tests：真实FFmpeg绑定与拒绝、可控多目标和稳定背景/字幕/印字/运动/闪烁/切镜负例；Stationary record 保存真实233s源development与性能。

## Invariants and Compatibility

不接 production、assembler、Controller、IPC、queue/compiler、knowledge 或 admission；保留产品 guard、旧 frozen 和 D2研究合同。源码、帧 PTS/endPTS、RGBA摘要、映射、方法参数绑定可复算；失败/取消/错源/错帧/超限不返回可消费候选。代表帧不足以支持未采样时域的完整性声明。算法开发最多两次参数修订，保留失败，不看holdout。

## Acceptance and Verification

全画布候选无需人工描边；多分量不只取最大；所有候选标注语义歧义、无mask authority。原像素映射向外取整，但ROI不作为保守mask。可执行测试覆盖源/PTS/像素绑定、fake/closed evidence、取消、预算及负例。对已知233s原片复现temporal候选并报告与历史ROI先验的差异，分列解码/发现/原像素统计、父子RSS和scratch。

`npm run typecheck`、新测试及受影响 census/review/envelope/extractor/pixel suites；维护本轮managed AOCI对象，保留foreign edits，最终diff与risk gate由Parent裁决，specific-file commit。没有repository专用capture skill，原Stationary record是本轮证据owner。

## Self-Review

方法只产生候选；固定背景与商品印字可能同样稳定，故不能自动确认。严格clock来自原owner；全片metadata/decode可用于准确取帧，但不建立fullcanvas语义session，不spool全片。真实结果不外推mask资格、Windows或V1产品可用性。共享索引存在外部writer时等待用户指定的写入顺序，不覆盖其改动。
