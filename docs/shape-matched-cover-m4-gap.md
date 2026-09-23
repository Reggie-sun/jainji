---
title: Shape-Matched Cover M4 Admission Gap
status: production-switch-blocked
date: 2026-09-24
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Decision

M1 已对肥皂原片的 14–17 秒及 90–93 秒分别建立并目视核查源像素 mask；M3 已在 90–93 秒的 720×1280 实验样片验证一款星形贴纸的有界输出像素 coverage。这些是短时段、同源证据。原片其余时段和同画面其他旧贴纸尚无可信 mask；1080×1920 的已试合法星形框仍有 14 个目标像素未覆盖。按 [V1 Spec](shape-matched-cover-spec.md) 的 REQ-04、REQ-07–10，此时不能把正式自动覆盖切换为轮廓渲染，也不能对未验证时段使用白底回退并声称 V1 通过。

# Current Production Seam

- `source-sticker-recognition.ts` 的识别结果只构造矩形 `track`、观察和抽帧证据，不生成或人工核查 `segment.mask`。M2 的 schema/store 可以校验并保存 mask，但应用生产路径没有可信 mask 的创建入口。实验脚本输出的 `CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW` 不会自动发布到知识库。
- `agent-controller.ts` 只在关闭覆盖、保留原贴纸的路径创建 `SourceStickerKnowledgeSession`；开启自动覆盖时创建的是 `CoverPlacementSession`。后者的近似框按合同只是渲染决定，不能作为源像素事实。该近似路径只读取知识库的争议和完整性阻断，不提供 mask。
- `agent-runner.ts` 当前由第一条合格素材触发同轮选款，没有在选款前取得本轮所有目标的源 mask、逐候选实际 alpha 和共同安全集合。即使只给第一个素材找到合格星形，也无法证明另一素材同样安全。
- `cover-sticker.ts` 的自动覆盖层仍设置 `opaqueBackground: true`，`compiler.ts` 据此生成白色不透明矩形。M3 的轮廓 PNG 属于独立实验输出，当前模板、预览和正式队列没有冻结并消费同一图层字节。

# Reproducible Evidence

按 [M1 记录](shape-matched-cover-m1.md) 的命令重建两个已核查短时段、无贴纸、形变、单帧及移动爱心拒绝样本；`static-full` 对 6990 帧作了算法检查，但只目视抽查 10 个间隔时点，不能将 `[0,233s)` 登记为可信源事实。按 [M3 记录](shape-matched-cover-m3.md) 重算 720p 星形 `PASS`、叶子/竖向和所试 1080p 星形 `UNSAFE`。源码复查可用：

```bash
rg -n 'SourcePixelMask|mask:|decodeSourceMask|evaluateShapeCover' src/main src/shared
rg -n 'const knowledge =|const placement =|selectCoverSticker:' src/main/agent-controller.ts
rg -n 'coverForVersion|opaqueBackground|color=white' src/main/agent-runner.ts src/main/cover-sticker.ts src/main/compiler.ts
```

# Required To Resume M4

1. 在既有 `SourceStickerKnowledgeSession` 内为**每个拟覆盖的静态 segment**取得与精确源身份绑定的原帧 mask 和出现时段证据，并把细尖、描边、半透明边缘及同画面其他旧贴纸交给可核查的人工/主管流程；未知、变化或矛盾时明确 `UNSAFE`。本次用户允许 Codex 担任实验样本的人工检查，但该授权本身不把未看过的 233 秒变成已核查源事实。
2. 对一轮全部素材和全部目标先求共同候选，使用实际 FFmpeg alpha、每种输出设置、逐帧时序和 M3 的固定上限；选款后仍按冻结模板重验。无 mask、坏 mask、无共同候选、内容安全未确认均不能调用旧矩形作为替代。
3. 冻结版本化轮廓、源修订、资产指纹、输出设置及检查结果，使原队列样片与正式导出读取同一图层；再完成独立内容安全和全片配对核查。保留手动、`assisted` 与旧冻结任务的解释。

本记录只报告 M4 的生产准入缺口；没有调用产品 Agent、付费模型或 `delogo`，没有修改正式 renderer、制作入口或现行产品规则。`AGENTS.md` 的其他未提交改动未被接管或覆盖。
