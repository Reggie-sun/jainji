---
title: Shape-Matched Cover Real Visual Diagnostic
status: bounded-real-media-diagnostic-only
date: 2026-09-30
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Outcome

针对用户“真实测试，能不能自然盖住”，重新从真实肥皂视频生成两段 720p 样片。右上角静态“国货之光”旧标在所查的 180 个输出帧中未见外露；星形轮廓比相同尺寸的白底矩形减少了大片方形白底，视觉上更像普通贴纸。白色描边仍偏厚，轮廓顶部及右端贴边截断；这里只得到“该星形在这两段能遮住、比矩形自然”的有限观察，未得到所有素材的自然度或生产验收。

# Inputs And Scope

- 原片：`/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4`，54,577,917 bytes；SHA-256 `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`。本轮 ffprobe：720×1280、30 fps。
- 贴纸：已导入上传星形 `uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e.png`；SHA-256 `ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e`。保留原图案及“惊爆价”文字。
- 时间段 `[14,17)` 秒、`[90,93)` 秒；仅测试右上角这一处目标。左上、底部原生图案及字幕不作移除。
- 复用 M1 候选 mask 生成与 M3 pixel owner；独立本地诊断合成，不经过产品制作入口、队列准入、source knowledge 或发行 owner。没有真实 AI 请求，也没有手动候选新模式的实现。
- 工程参数沿用既有版本：星形框 119×78，摆放 `[601,0]`；半径上限 8 源像素、面积比上限 1.35、宽高比上限 1.16。没有为样片改阈值。

# Fresh Evidence

本机持久诊断目录：`/home/reggie/.local/state/jianji-source-fact-qualification/real-cover-visual-20260930`（下称 `V`）。该路径是本机证据位置，其他机器需重新生成。

| Segment | Candidate / Pixel Evidence | Actual Output |
| --- | --- | --- |
| 14–17 秒 | 新生成候选 mask 3259 像素，投影后 3555；轮廓扩张 7 输出像素，未覆盖投影像素 0 | `V/segment-14-17/shape.mp4`；720×1280、30 fps、90 视频帧，视频与音频流各 3 秒 |
| 90–93 秒 | 新生成候选 mask 3371 像素，投影后 3672；同一轮廓扩张 7 输出像素，未覆盖投影像素 0 | `V/segment-90-93/shape.mp4`；相同输出规格和时长 |

两段均另外生成 `original.mp4`、`rectangle.mp4`，使用同一原片区间、贴纸、框尺寸与摆放。白底矩形与轮廓的差别仅在底板形状。全部六个 MP4 经 FFmpeg 完整解码，无解码错误；ffprobe 逐帧计数为每段 90 帧。每段三种输出的解码 PCM 摘要一致：保持原片区间音频，未静音或改变速度（AAC 重新编码）。容器时长为 3.024 秒，视频/音频流各 3.000 秒；不把编码封装余量当作素材延长。

对最终 PNG 重新解码，两段分别 3555、3672 个候选投影像素均为 alpha 255。实际输出 PTS 为 0–2966.667ms：既有 `checkOutputFrameCoverage` 对完整 `[0,3000)` 通过，对故意缩短的 `[0,2900)` 在第 87 帧拒绝。该证明依赖候选 mask，不能证明 mask 外不存在漏识别目标。

新候选 `result.json` 仍保持 `CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW`。原诊断入口含历史审阅 metadata；本轮私有副本 `V/engineering-pixel-probe.ts` 删除该历史 `creation/review/evidenceIds`，保留原像素计算，报告显式标记 `authority=none`、`eligible=false`、`humanReview=NOT_EVALUATED`、`sourceAdmission=NOT_ATTEMPTED`。没有改写仓库入口、制造真人资格或发布 source mask。输入原片、贴纸及三个相关源码的前后摘要一致，见 `inputs-before.json`、`raster-time-verification.json`。

# Visual Observation

Codex 检查两段全部 90 帧的旧标边缘联系表与成片右上角联系表，并检查配对全画面及三倍局部放大图。背景经历蓝天、手/锅、暗色画面及头发等变化，所查目标未见露出或轮廓跳变。全画面中该角落图层未遮到主要操作区域或中央字幕；这只是所查图像的观察，不是独立内容安全准入。

六个样片在隔离临时 Chrome 中以 `playbackRate=1` 播到结束，每次墙钟约 3.11–3.12 秒，720×1280、浏览器报告 dropped/corrupted frames 均为 0。自动播放 muted，用于视觉播放/解码检查，没有完成听音验收。Chrome MCP 当时因共享 profile 已占用而不能新开；未重启其他浏览器，改用现有 `playwright-core` 启动独立 headless Chrome，结束后关闭。`browser-playback.json` 和六张截图保存实际结果；首次脚本因不支持 `VideoPlaybackQuality.toJSON` 在读取计数时失败，修正为显式读取字段后完整重跑，失败不计入通过。

可观看入口及对照：

- `V/segment-14-17/shape.mp4`、`V/segment-90-93/shape.mp4`。
- 每段 `full-comparison.png`、`zoom-comparison.png`：从左到右为原片、白底矩形、星形轮廓。
- 每段 `shape-all-frames.png`、`edge-contact-sheet.png`：180 个成片帧及候选边缘的观察材料。
- `render-commands.json`、`media-verification.json`、`raster-time-verification.json`、`browser-playback.json`：实际命令、解码/流、栅格/时序/摘要、播放证据。

# Negative Cases

本轮重新计算叶子、竖向贴纸和 1080p 星形；分别残余 970、307、14 个候选投影像素，均 `UNSAFE`，未生成覆盖图层。结果分别存于 `negative-leaf.json`、`negative-vertical.json`、`negative-1080-star.json`。因此不能说任意上传贴纸或直接升到 1080p 都能遮住。

# Decision And Remaining Work

本次是既有 M1/M3 真实样例的 fresh 诊断复现，使用历史已知静态片段，不能作为新的 blinded holdout、AI 逐帧识别成功或 M5-D2A qualification。原 human qualification 与 AI qualification 保持 `INCOMPLETE`，正式语义指标未评估仍为 null / `NOT_EVALUATED`。手动框候选仍 `DESIGN_ONLY / NOT_IMPLEMENTED`。

`PRODUCT_DISABLED`，M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance 全部保持 `BLOCKED`；不修改现行手动白底行为。仍需实际两条视觉路线、独立真值盲审，以及更多尺寸/形状/目标/长片与内容安全证据。

本轮仓库只新增诊断记录与 owner 链接，没有实现代码变更；不以单元测试代替视觉样片。Implementation Review Risk Gate 不产生新的 implementation snapshot/review 请求；只读 native mapping 检查复用边界，Parent 核对真实媒体证据。用户禁止 Kimi 的当前约束继续遵守。

# Delivery Verification

完成检查按当前 `verification-before-completion` 执行。fresh `git diff --check` 通过；三份文档的本地引用存在；AOCI Verify、Check、Guide 均 exit 0、governance aligned，Guide complete=true、findings=[]。这三份文档沿现有 observe scope 核对，不新增索引条目或改写其他任务的基线。未修改应用代码，不为文档记录重跑全库 typecheck/tests；真实验证为上述 FFmpeg、实际图片检查、像素/时序与 Chrome 播放证据。没有 repository 专用 session-capture skill，本记录与 canonical M3/plan 链接保存该稳定诊断 checkpoint。
