---
title: Shape-Matched Cover M4-A Source Mask Admission
status: one-real-segment-published-in-isolated-store
date: 2026-09-24
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope

本阶段只打通一个已人工核查静态 segment 的 `creation → review → publish → SourceStickerKnowledgeStore`。它不选贴纸、不生成覆盖层、不修改 `agent-runner.ts` 或 `compiler.ts`，也不把源 mask 的通过解释成输出覆盖或内容安全通过。应用当前的自动覆盖生产路径仍是旧合同；M4-B 和 M5 尚未实施。

# Admission Contract

- `scripts/shape-cover-mask-probe.py` 产生的候选必须保留原始 `result.json`、bitset 和逐帧 `edge-contact-sheet.png`。新入口只接受 `CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW`、30–100 帧的连续 PNG 联系图、逐帧核心检查、固定算法版本及有界 1:1 mask；单帧或片段时间不明拒绝。
- 人工审阅单独写 `PASS` receipt，声明 reviewer、时间、源文件/bitset/probe/联系图 SHA-256、完整帧范围及边缘、静态性、出现时段结论。入口校验所有摘要与帧数，再重新从当前源文件解析每帧 PTS、取首末两张完整原帧、核对源字节身份和 mask 编码。缺审核、证据不符或源修订不匹配统一以 `UNSAFE` 拒绝。首版入口明确拒绝旋转素材及无法精确表示的时段，不推断它们安全。
- `SourceMaskAdmissionProof` 是源事实专用 proof，标记 `source-mask-only`；没有 `previewPassed` 或任何覆盖通过声明。原 `KnowledgePublicationProof` 和历史 revision 不改变解释。源帧、probe、联系图、人工 receipt 的原始字节与摘要一并由原知识库事务持久保存，重启加载时复核。已存在 revision、争议、坏字节、坏摘要、缺审核及损坏审阅档案均拒绝，不覆盖旧 head。

# Real-Media Run

Codex 按本次用户授权，再次查看了肥皂原片 90–93 秒的全部 90 帧联系图：右上红白旧标的尖端、描边和白色外缘仍在紫色保守边界内；所查时段目标未消失或形变。人工 receipt 存在本机 `/tmp/jianji-cover-m1-20260924/static-90-93-holdout/m4a-review-pass.json`，绑定 M1 候选。它不是自动生成的 PASS。复现命令：

```bash
./node_modules/.bin/esbuild scripts/shape-cover-admit-source-mask.ts --bundle --platform=node --format=esm --outfile=/tmp/jianji-cover-m1-20260924/shape-cover-admit-source-mask.mjs
node /tmp/jianji-cover-m1-20260924/shape-cover-admit-source-mask.mjs --source '/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4' --probe-dir /tmp/jianji-cover-m1-20260924/static-90-93-holdout --review-receipt /tmp/jianji-cover-m1-20260924/static-90-93-holdout/m4a-review-pass.json --store-root /tmp/jianji-cover-m4a-20260924-store-v4
```

结果：`sourceKey=3e78c53a566e871b2b3d172be1d4bfd8e1103070782d85569523157040b6587f`，revision `bed00309-f0be-4d63-8f06-466ee2e1e61d`，`verification=source-mask-only`，mask SHA-256 `415c72e64d028d194f606e77f9a7519f4e1e42ac492505275c7edb2f7bc7ba53`，唯一核查时段 `[90000,93000)` 毫秒。发布使用独立 `/tmp` 知识库，没有写入正在使用的应用用户数据目录；联系图、probe、receipt 和两张原帧均在该库的 revision 证据目录中。现有其余 230 秒及同画面其他旧贴纸不因此获准。

# Verification And Limits

`tests/source-mask-admission.test.ts` 用真实 FFmpeg 生成短素材，验证源专用发布、重启读取、审阅档案持久化及篡改拒绝；测试中的合成 receipt 只验证机制，不冒充人工视觉审阅。原知识库、session 和监督证据测试用于检查兼容性。全套 `npm test` 为 1048 通过、2 失败、3 跳过。`tests/cover-placement-concurrency.test.ts` 的 `resolved-cancel` 情况实际为 `exporting`，期望 `cancelled`，单独复跑仍失败；`tests/harness.test.ts` 的进程树超时断言在全套并发运行时失败，单独复跑 7 项均通过。两者均未触及 M4-A 代码路径，不能宣称全套测试通过。

下一步 M4-B 必须按每个 source revision、输出设置、摆放和轮廓版本独立计算整轮共同候选，预览和正式队列消费同一冻结图层字节；缺 mask、源修订不匹配、coverage 非 100% 或内容安全未通过一律 `UNSAFE`。本阶段没有执行这些门槛，也没有调用产品 Agent、付费模型、Kimi 或 `delogo`。
