# Result

**FAIL，停止本组合实验，不导出，不接入生产。** 在 `main@9ceac69` 上，按 [prior-art 的下一实验](sticker-cover-prior-art-2026-09-16.md#minimal-next-experiment) 对指定素材前 8 秒执行全画面多帧稳定候选实验。候选阶段在 5.25 秒附近漏掉可见的小图案，原分辨率连通区域还出现局部边界和背景合并，未形成完整、唯一的贴纸对象。

这是一个固定参数组合的失败证据，不证明所有多帧方法都不可行。没有以坏 VLM 框、人工真值或四角位置初始化；没有重复 SAM 3.1 组合。生产代码、桌面应用、连接、项目和现有未跟踪文件均未修改。

# Input And Environment

- 输入：`/home/reggie/电商/马油膏布/素材/竞品详情-抖音电商罗盘.mp4`。
- SHA-256：`c61168beeb5a42e4476c3276f76a8369bcae1dc8b6a0b311708e087cf57e8c9e`，与 [Luna 复测](live-cover-retest-2026-09-16.md#input-and-isolation) 相同。
- ffprobe：720×1280、30 fps、1045 个视频帧，容器时长 34.854 秒。实验提取前 240 帧，PTS 为 0–7.966667 秒；帧号在 JSON/CSV 中从 0 开始，PNG 文件名从 1 开始。
- 5.25 秒位于源帧 157（5.233333 秒）和 158（5.266667 秒）之间；本实验保留两帧及周围原始帧，不把 5.25 当成存在的源帧 PTS。
- 复用 Python 3.13.5、OpenCV 4.12.0、NumPy 2.2.6、现有 FFmpeg `9c33b2f`，无新依赖/权重下载、无 API/商业模型请求、无凭据读取。
- 独立 `bwrap --unshare-net` 进程；`/` 只读挂载，仅本次新目录可写。未启动、停止或重启桌面应用。

证据目录：`/home/reggie/jianji-validation/20260916-temporal-localization-R6eQt9/`，约 344 MiB。`probe.py` 是唯一候选生成 owner，`evaluate.py` 只在候选和 manifest 冻结后生成验收诊断图；不存在生产替换路径。本次保持所有生产识别、失败关闭和冻结重试契约。

# Frozen Method

1. FFmpeg 无损提取原分辨率 PNG，不做覆盖合成；ffprobe 保存逐帧 PTS。
2. 全画面缩到 360×640，以 15 帧窗口、15 帧步长计算逐像素颜色中位数、颜色偏差第 90 百分位和边缘出现比例；额外检查源帧 157/158 的中心窗口，共 17 个窗口。阈值固定为颜色偏差 ≤18、边缘比例 ≥0.6，Canny 为 40/100。
3. 稳定边缘经统一 5×5 closing 得到连通候选，保留面积 ≥12 个低分辨率像素的全部组件；不按角落筛选、不选最高分、不使用模板匹配。该面积/时间阈值会限制小目标和短暂目标召回，不是完备发现保证。
4. 原分辨率重新计算相同统计和 9×9 closing，收集与自动粗候选相交的完整连通组件，求并集矩形。它仅是待验证边界，不能把稳定边缘组件等同于完整前景 mask。空原生组件明确保留为无边界；未按人工观察修补矩形。
5. 对每个有原生边界的候选，在全部 240 帧、该自动发现的屏幕位置，统计稳定支持像素与参考中位数的颜色一致比例。距离 ≤24、比例 ≥0.8 只标记候选 `SUPPORTED`；否则 `UNSUPPORTED`。二者都不是已确认贴纸存在/消失，`verified_sticker_presence` 全部保持 `UNKNOWN`。
6. 相邻低分辨率帧平均绝对差 >35 仅生成切镜复核提示，不终止任何候选。未实施跨窗身份融合；候选仍按窗口独立编号。

固定参数在运行前写入脚本，本轮没有根据验收图调参后重跑。几何阶段已有反例，因此按停止条件不进入模型语义阶段；没有寻找新服务或安装语义依赖。

# Evidence And Findings

| Evidence | Observation | Acceptance impact |
| --- | --- | --- |
| `windows/w-158-candidates.png`、`frames/frame-0159.png`、`evaluation/frame-158-zoom.png` | 5.266667 秒窗口有 12 个候选，所有原生边界的下缘均 ≤1017；原图两个底部小图案仍可见 | 当前窗口发现失败。不能由此声称其他窗口候选的全库召回率为零 |
| `w158-c000` `[8,0,79,38]` | 稳定标签主体能产生候选，但原图左缘和下方蓝色笔画未完整纳入 | 回原分辨率仍不能自动证明完整边界 |
| `w217-c052` `[6,1247,29,1274]`、`evaluation/frame-217-zoom.png` | 左下图案只形成局部框，右侧声波延伸超出候选右缘 | 稳定支持不等于整个图案外轮廓 |
| `w172-c047` `[0,1117,271,1280]`、`windows/w-172-candidates.png` | 左下图案附近连通支持与大块背景合并 | 不能把大框直接作为唯一贴纸边界，也不能人工裁回四角 |
| `w158-c011` `[228,980,490,1017]`、`w158-c006` `[321,306,349,322]` | 分别为字幕和商品包装马图细节 | 时间稳定不是贴纸语义。这里只是非贴纸候选，未发生模型语义误判或导出误盖 |
| `evaluation/frame-{045,046,156,157}-zoom.png` | 45→46 底部图案从可见变为不可见，顶部标签继续可见；156→157 底部重新出现 | 这是主线程对相邻源帧的目检证据；切镜不能统一终止全部贴纸，也不代表整段 presence 已验收 |
| `evaluation/presence-excerpt.csv` | 同样仍可见的左下图案在 frame 45 对 `w007-c063` 仅有 0.306213，右下 `w007-c064` 为 0.990196 | 单一支持阈值不足以确认可见性；把 UNSUPPORTED 当成消失会出错 |

坐标为源分辨率 `[x0,y0,x1,y1)`。验收放大图中的四角 ROI 是**推理完成后**主线程为了展示反例选择的诊断裁切，只被 `evaluate.py` 使用；不进入 `probe.py`，也不是人工真值 mask。上述视觉判断来自 Agent 目检，未冒充用户人工验收。

**机制推断**：5.25 秒邻近切镜/重新出现，15 帧窗口的稳定性统计会抑制新出现图案；原生边缘连通既可能断裂，也可能沿稳定背景扩张。这与本轮漏候选、局部框、大框相符，但未通过消融证明各参数的独立因果作用。未据此放宽阈值、永久延长候选或补固定角落框。

# Metrics And Acceptance Limits

实际保存 240 张输入帧、17 个窗口、606 个粗候选、528 个非空原生候选、126720 条逐帧候选评分。检测出 5 个画面变化提示（frame 46、104、157、182、220），它们仅用于复核。

最终合格边界数为 0，`final-boundaries.json` 明确 `NOT_ACCEPTED`。`semantic-responses.json` 为 `NOT_RUN`、空响应；没有模型语义成功结论。`presence.csv` 保存全部候选评分，但唯一贴纸身份及精确出现/消失区间未确认。

没有逐帧、逐像素的独立人工真值，因此 discovery recall、semantic false-positive rate、完整边界率、漏检时长及过盖面积均未给出伪精确数值。局部可见反例已足以拒绝此参数组合；按用户停止条件，不继续制作全片人工标注或推进未通过的后续阶段。

# Reproduction And Verification

`manifest.json` 保存素材和 240 张输入 PNG 的 SHA-256、逐帧 PTS、软件版本、参数及生成脚本摘要：`4fd4032549014cade7116e17c182969717a6515c6decfb250cca1c27b1b47219`。`input-probe.json` 保留源帧时间信息；`media-processing.json` 保留完整 FFmpeg 命令、exit 0 和空 stderr。

`windows/` 保存中位图、稳定支持、分组掩码、原生支持、统计 NPZ 和候选叠图；`candidates/` 保存无标记原图裁切、支持掩码与中位参考；`candidates.json` 保存每个候选的窗口、粗框、原生框和未验证状态。

实际执行：

```bash
bwrap --unshare-net --die-with-parent --ro-bind / / --dev /dev --proc /proc \
  --bind /home/reggie/jianji-validation/20260916-temporal-localization-R6eQt9 /home/reggie/jianji-validation/20260916-temporal-localization-R6eQt9 \
  --setenv PYTHONDONTWRITEBYTECODE 1 \
  /home/reggie/miniconda3/bin/python3 -u /home/reggie/jianji-validation/20260916-temporal-localization-R6eQt9/probe.py
```

`probe.py` exit 0；同一隔离命令执行 `evaluate.py` 也 exit 0，断言脚本摘要匹配、126720 条评分齐全且全部 verified presence 为 UNKNOWN。数值处理成功不等于识别通过。复现实验应将 `probe.py` 复制到另一个新建证据目录运行；原目录 manifest 存在时脚本拒绝覆盖。重跑 `evaluate.py` 仅重建诊断文件。

独立 `reviewer_high` 只读检查脚本、帧时间、候选、评分和反例图，结论为 `accept with concerns`，无阻止保存失败记录的问题，不批准生产接入。其指出验收诊断未纳入初始 manifest，已由 `seal.py` 补齐：复验源视频、全部 240 帧和推理脚本摘要，并检查 528 个候选分别恰有 240 个不重复帧号、时间一致。实际 exit 0，`integrity-manifest.json` 为 1952 个既有证据文件保存大小及 SHA-256，包含验收脚本、结果、放大图和 seal 脚本。清单自身 SHA-256：`7d94211cec26165d73ddcc9d7b4d9683b1df82e6229c6f29cb7bc94a774a387b`。修改诊断文件会使此 seal 失效。

另一条非阻塞限制保留：脚本按已核验的 720×1280 输入固定缩放至 360×640，坐标乘 2；不应直接用于其他分辨率。本轮未为通用化扩展脚本。

# Completion

本轮仅新增本报告作为 repository 记录，实验脚本和媒体证据留在上述独立目录；没有应用代码变更，不运行无关 typecheck/build。已评估记录要求：repository 未声明专用 session-record skill，本报告承载本次 durable 实验证据。

交付检查：仅本报告进入提交，相关 Markdown 链接目标存在，`git diff --check` 通过；原有 `docs/video-sticker-alternatives.md`、项目 JSON/bak/tmp 等 untracked 文件继续保留。

结论停在 **FAIL / 不接入 / 不导出**。语义分类、全目标完整边界、唯一身份、逐帧生命周期均未达到通过标准，不提出生产接入 patch；原 Luna 失败仍未解决。
