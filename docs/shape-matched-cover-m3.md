---
title: Shape-Matched Cover M3 Pixel Evidence
status: m3-bounded-core-converged-production-gate-closed
date: 2026-09-24
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope

本记录验证静态旧贴纸的独立输出像素门槛。`shape-cover-pixel-gate.ts` 解码有界源 bitset、保守投影 FFmpeg 缩放/补边后的源像素、对真实 FFmpeg 贴纸 alpha 执行有限圆形轮廓扩张，并逐输出 PTS 检查覆盖时序。它还没有接入模板、正式 renderer、选款、预览或队列；现行白底矩形行为未切换。以下 `PASS` 仅代表该实验门槛的几何结果，不代表整轮、内容安全或成片验收。

# Reproduction

以下使用 M1 的原片和源 mask，贴纸为当前本机已导入的真实素材。先构建实验入口，再运行相同像素门槛；`--overlay-png` 只在合格时输出可视化图层，已有文件不会被覆盖。

```bash
./node_modules/.bin/esbuild scripts/shape-cover-final-pixel-probe.ts --bundle --platform=node --format=esm --outfile=/tmp/jianji-cover-m1-20260924/shape-cover-final-pixel-probe.mjs
node /tmp/jianji-cover-m1-20260924/shape-cover-final-pixel-probe.mjs --mask-dir /tmp/jianji-cover-m1-20260924/static-90-93-holdout --asset '/home/reggie/.config/jianji/uploaded-stickers/uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e.png' --output-size 720,1280 --panel-size 119,78 --overlay-png /tmp/jianji-cover-m1-20260924/static-90-93-holdout/overlay-repro-new.png --output /tmp/jianji-cover-m1-20260924/star720-repro-new.json
node /tmp/jianji-cover-m1-20260924/shape-cover-final-pixel-probe.mjs --mask-dir /tmp/jianji-cover-m1-20260924/static-90-93-holdout --asset '/home/reggie/.config/jianji/asset-library/2b4fd3a429e01fb094ac8cd397b3fc65ff9c2394.png' --output-size 720,1280 --panel-size 119,78
node /tmp/jianji-cover-m1-20260924/shape-cover-final-pixel-probe.mjs --mask-dir /tmp/jianji-cover-m1-20260924/static-90-93-holdout --asset '/home/reggie/.config/jianji/uploaded-stickers/uploaded-0ddbc401f050110ad85410a0eb75d321aaca126a82c60d37215351501da626de.png' --output-size 720,1280 --panel-size 119,78
node /tmp/jianji-cover-m1-20260924/shape-cover-final-pixel-probe.mjs --mask-dir /tmp/jianji-cover-m1-20260924/static-90-93-holdout --asset '/home/reggie/.config/jianji/uploaded-stickers/uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e.png' --output-size 1080,1920 --panel-size 178,110
```

实验入口只支持与原片同宽高比的输出；带补边的输出由像素核心及 FFmpeg fixture 测试，不把本入口误用于带补边的实际视频。`--panel-size` 是完全位于输出画面内的贴纸矩形，入口将它固定在右上角。源身份仍由 M2 的 `SourceIdentity` 负责；此入口不发布源知识。

重建 3 秒可观看样片的命令如下，图层来自上述入口输出：

```bash
ffmpeg -hide_banner -loglevel error -nostdin -y -ss 90 -t 3 -i '/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4' -loop 1 -i /tmp/jianji-cover-m1-20260924/static-90-93-holdout/overlay-repro-new.png -filter_complex '[0:v]setpts=PTS-STARTPTS,format=yuv420p[base];[base][1:v]overlay=0:0:format=auto:shortest=1,format=yuv420p[out]' -map '[out]' -map '0:a?' -c:v libx264 -preset veryfast -crf 18 -c:a copy -t 3 /tmp/jianji-cover-m1-20260924/static-90-93-holdout/preview-repro-new.mp4
```

# Results

| Sample | Output pixel result | Review |
| --- | --- | --- |
| 肥皂同源 90–93 秒留出 mask `415c72e6…a2253838`，星形 `ad676bcd…786e`，720×1280、合法贴纸框 `[601,0,720,78)` | 源 mask 投影后 3672 像素，FFmpeg alpha 摘要 `fc409b69…0e18921f`。圆形扩张 7 输出像素后残余 0，面积比 `1.344956`，宽比 `1.122642`，高比 `1.138889`，均未超过 M1 固定上限。开发段 14–17 秒同一框同样通过。 | 生成的 PNG 经 FFmpeg 重新解码，3672 个目标像素均为 alpha 255；3 秒 H.264 样片 720×1280、90 帧。Codex 配对观看首、中、末帧及右上角放大图，所查帧未见该旧标外露，也未见人物、手或字幕被右上角图层遮住。原片左上及底部另有原生贴纸，本样片没有处理它们。 |
| 叶子 `d3067e96…13e9f92`、竖向贴纸 `0ddbc401…dde`，同一 720p 贴纸框 | `UNSAFE`；最少仍有 970、307 个投影像素未被扩张轮廓包含。 | 与 M1 的形状不相容结论一致。 |
| 同一星形、1080×1920、合法框 `[902,0,1080,110)` | `UNSAFE`，至少 14 个目标像素未覆盖。额外枚举了 148 个右上贴边的合法宽高组合，未发现通过者；没有因此放宽上限。 | 这是所试尺寸和摆放家族的拒绝，不能推出所有可能贴纸或位置都失败。 |

FFmpeg 的 alpha 栅格与 PIL 缩图不同：同一 119×78 星形，FFmpeg 有 4592 个 alpha 255 像素和 5105 个 alpha 非零像素，PIL 产生 4316 和 5431 个。因此 M3 实验用 FFmpeg 栅格，不借 PIL 的试验 PASS 代替渲染判定。单白像素经 FFmpeg bicubic 放大 1.5 倍后，非零值延伸到原先 1px 投影余量之外；当前投影在不缩放时留 1 输出像素，缩放时按每轴 `ceil(2 × scale)` 留余量。真实 FFmpeg 单像素测试覆盖 1.5 倍、奇数尺寸补边、90° 正向解码坐标、中央与贴边像素。实际 90 帧输出 PTS 为 0–2966.667ms，完整 `[0,3000)` 覆盖时序通过；把覆盖缩到 `[0,2900)` 会在第 87 帧拒绝。实验报告固定算法版本、半径/面积/宽高上限、源与贴纸摘要、输出尺寸、贴纸框、alpha 摘要和 coverage 结果，供 M4 绑定模板。

# M3 Decision

**M3 对该静态旧标与 720p 星形候选的像素核心有界收敛，可进入 M4 集成。** 1080p 当前所试候选被明确拒绝，没有按输出设置放宽上限。生产模板尚未冻结算法、贴纸资产指纹、输出设置与 coverage 结果；正式 FFmpeg 编译器未消费同一个轮廓栅格；内容安全邻近样本、长片多素材成本和原队列样片尚未验证。继续保持现行白底路径。M4 写入前必须核对目标文件的当前 ownership；如发生同文件占用，由用户决定写入顺序。
