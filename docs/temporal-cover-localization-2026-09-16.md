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

# Cut-Aware Repair Follow-up

用户要求继续修复后，在 `main@eb571c4` 上执行单变量实验：**只将原窗口的采样限制到中心帧所在镜头，其他阈值、全屏搜索和原生连通域规则保持不变**。这是隔离候选修正，未修改生产路径。脚本和证据按续接指令继续放在 `/home/reggie/jianji-validation/20260916-temporal-repair-iCcKVC/`；本轮仍只更新这一份 repository 报告。

`superpowers:systematic-debugging` 用于把上一轮“跨切镜可能抑制新目标”的推断变成可执行对照。`temporal_ablation.py` 读取上一轮冻结脚本/帧，先验证摘要，再自动选出 6 个跨切镜窗口。原采样重放生成的全部原生候选框与保存结果逐项一致；随后仅移除镜头边界之外的样本。切镜只重置统计样本，未将任何对象判为消失。

| Center frame | Original samples / candidates | Cut-clamped samples / candidates |
| --- | --- | --- |
| 52 | 15 / 11 | 14 / 11 |
| 97 | 15 / 13 | 14 / 12 |
| 157 | 15 / 12 | 8 / 67 |
| 158 | 15 / 12 | 9 / 78 |
| 187 | 15 / 42 | 13 / 90 |
| 217 | 15 / 54 | 10 / 38 |

**局部改善与新的反证同时存在**：frame 158 的采样从 151–165 改为 157–165 后，恢复了底部候选 `[0,1239,48,1280]`、`[687,1249,720,1280]`；但顶部标签与静止背景合并为 `[0,0,720,461]`。`comparison-158.png` 并列保存原图、原候选和修正候选。候选数量上升不是召回率提升的验收结论，两处底框也未经完整像素真值验证。移除跨镜头样本改变了支持集，不能据这一个对照将效果唯一归因于样本数或切镜本身。

独立只读 `test_analyzer` 分析了边界损失，主线程复算以下诊断统计并保存于 `boundary-diagnostics.json`：

- frame 217 左下截断图案右侧诊断 ROI `[29,1240,50,1280]`，仅约 0.48% 像素同时通过颜色稳定/边缘支持，44.88% 只通过边缘支持。图案外侧在生成边界前就已被时间颜色筛选丢弃，不能靠增大矩形或 closing 推断完整前景。
- frame 158 左上标签左侧 `[0,0,8,40]`，只有 0.625% 同时通过、65.94% 只通过边缘支持。原分辨率同样丢失边缘，不能仅归因于 0.5 倍缩放。
- frame 172 背景诊断 ROI `[171,1117,259,1280]` 有约 37.81% 双条件通过；稳定背景先进入原生连通域，再因“碰到粗框即纳入”被合并。closing 扩大了合并，但不是误纳背景的唯一来源。

这些 ROI 是旧结果冻结后的诊断选区，不是贴纸真值 mask；比例是 ROI 中所有像素的统计，不能当作贴纸像素 recall 或独立因果消融。选区只出现在 `verify.py`，不被 `temporal_ablation.py` 读取。

**本轮结论仍为 FAIL**：切镜采样修正能恢复局部发现，但时间稳定 mask 缺乏“完整语义对象”的判定，截断和背景合并仍未解决。停止此参数组合，不增加 padding/固定角落框，不把旧失败 SAM 组合串成补救链。若后续另行研究，完整边界需要独立的原分辨率对象分割证据；这只是技术方向，不是已批准或已通过的接入方案。

`temporal_ablation.py` 和 `verify.py` 均在与上一轮相同的断网只读隔离下执行，exit 0。验证断言覆盖原框重放、6 个窗口的镜头内采样、frame 158 两个恢复候选及大框反例。`result.json` 明确 FAIL、无合格边界；语义为 NOT_RUN、identity 为 UNRESOLVED、此次 ablation 的 presence 为 NOT_EVALUATED。未把上一轮的 126720 条评分冒充本轮新 presence，也未声称出现/消失区间验收通过。

`integrity-manifest.json` 封存本轮 81 个文件并引用上一轮 evidence seal，SHA-256 为 `027806e0e557f37be705877a44df48ca3e110c578b205358437a2105df62e935`。本轮没有新增输入解码，复用经摘要核验的原始 240 帧；没有模型推理、服务重启、下载、凭据访问或导出。另有只读本地 Python/PyTorch 版本检查，没有安装依赖或启动模型。当前仍未获得可发布的识别修复。

本轮独立 `reviewer_high` 为 `accept with concerns`，无阻止保存失败记录的问题。复核重新核验上一轮全部 1952 个和本轮全部 81 个 sealed 文件，并确认 6 组原框重放、采样范围及反例图一致。保留的复现限制：ablation 入口只直接校验基线脚本/帧/manifest，三个输入元数据 JSON 的完整 seal 校验由本次独立复核补足；再次运行前应先核验完整 baseline seal。隔离命令和 exit 0 的原始依据在会话工具记录中，未包含于本轮 manifest；脚本中的形态学参数 literal 与本次冻结基线一致，不应据此视为通用实验工具。报告最终 diff 与 `git diff --check` 由主线程检查后，仅提交本报告。

# Batch Generalization And Module Reuse Probe

用户继续要求修复，并明确选择范围 A：本批电商视频中的屏幕贴纸，包含小动画、切镜和出现/消失。当前轮基于 `main@b094b8a`，仍是隔离实验，不修改生产链路。用户询问能否直接复用成熟模块；本轮实际复用 ComfyUI 的 `SAM3_Detect` 与 Transformers 的 `Sam2VideoModel`，自写脚本仅负责实验输入组织、证据保存及诊断，不重写分割器或传播器。

证据目录：`/home/reggie/jianji-validation/20260916-generalization-G0EX5g/`。复用现有 SAM 3.1、SAM 2.1 tiny 和本机 Qwen3-VL 权重，以独立断网 `bwrap` 进程执行；无新安装/下载、商业调用、凭据读取或桌面应用重启。ComfyUI 环境为 Python 3.12.13 / PyTorch 2.11.0+cu130；Qwen 与 SAM 2 使用原 Python 3.13.5 / PyTorch 2.9.0+cu128 环境。GPU 为 RTX 5090。脚本依然位于用户最初指定的外部证据目录；没有将未通过的实验放入生产 `scripts/` 或识别 owner。

## Corpus And Scope

`corpus.py` 对素材目录的 33 个 MP4 保存 SHA-256、ffprobe 元数据，并以 10%/50%/90% 三个时间点的感知 hash 做保守相似组划分。结果是 2 组：29 文件 development，4 文件 holdout，0 reserve。留出文件为 `(18)`、`(24)`、`(25)`、`(28)`，均属同一个相似组。本轮没有将其图像用于模型或目检调参；元数据/hash 分组不等于从未读取其媒体。

这是一个组级留出，不是四个独立内容测试。三帧 hash 不能证明语义独立；即使将来全部通过，也最多报告本批次覆盖与有限组间迁移，不能声称任意电商视频泛化。本轮定位/传播仍只检查指定原素材的首 240 帧；未通过开发片段，因此不消耗留出验收。

## Discovery And Semantic Evidence

`segment_tiles.py` 固定使用 `decorative sticker:16`、threshold 0.5、refine 0；输入全帧及均匀 384×384、stride 256 的重叠分块，遍历全画面，不使用角落先验。每帧共 16 个输入，保留所有 mask、候选框与触碰人工 tile 边缘的标记。它与之前失败的 `graphic overlay` 自动视频组合不同，但仍只是候选引擎。

先对 6 个开发帧检查尺度问题，再执行两项密集对照：

- `dense_scan.py`：原分辨率解码 240 帧，每帧单次全帧检测；已在 frame 1、8、28 等帧出现原图仍可见目标的候选空缺。
- `dense_tiles.py`：按冻结的全帧加均匀分块规则检测全部 240 帧，保存 9245 个 raw proposals。虽然恢复了多处全帧遗漏，frame 162 的右上“推荐”图案仍整件漏检。独立 QA 和主线程分别核对原图及候选 JSON，图案可见但没有相应候选。不能把未检出当作消失。

`audit_tiles.py` 仅以自动语义探针得到的四个参考 proposal 检查几何支持，保存所有 IoU≥0.5 的别名及诊断并集；不删除重叠候选，不把并集当作最终边界。960 条 target/frame 记录的 presence 全为 UNKNOWN，identity 为 UNRESOLVED。无支持帧列表不是漏检率或消失区间，须与源图分别判断。

语义实验的失败和局部改善均保留：全图加局部双图的 19 案探针把右下图案解释为字幕；局部图优先的变体在前 8 案已出现实物/字幕误判，因此中止，剩余 37 案未评估；单张局部/全局组合图仍对小图案不确定，并有一次 JSON 截断。最初分类脚本还在语义前去重、丢弃人工边缘候选，不能用作最终对象解析器。

`temporal_semantics.py` 改用一张六时刻证据板，前 8 个原始候选返回四个贴纸、四个实物类别，与主线程局部目检相符；其文字理由仍可能含不准确描述，不能据类别一致宣称身份或边界通过。`temporal_all.py` 保持同一 prompt 和图像组织，扩大到 frame 158 全部 45 个候选，不先去重/过滤，精确复用前 8 个已有输入/响应，另外调用 37 次离线推理。这仍不是全部 9245 个候选的语义验收，也没有保证覆盖字幕负例。

## Reused Video Propagation

`propagate_masks.py` 将 frame 158 四个自动发现并经局部语义分类的原始 SAM 3 mask 直接交给现有 `Sam2VideoProcessor.add_inputs_to_inference_session(input_masks=...)`，然后调用 `Sam2VideoModel.propagate_in_video_iterator`。没有使用旧 VLM 坏框、人工坐标或手工修补 mask。两次独立 session 分别正向检查 158–239（82 帧）与反向检查 158–0（159 帧），seed 帧重复，合计覆盖原片段 240 个不同帧。没有把模型 mask 是否为空直接解释为确定 presence。

| Evidence | Observation | Gate |
| --- | --- | --- |
| `mask-propagation-forward/results.json`, frame 162 / object 3 | 在检测空缺帧继续得到右上 mask，框 `[647,10,711,68]` | 局部传播恢复，不证明完整包住图案 |
| 同文件，frame 217 / object 0 | 右下对象框扩成 `[15,1251,720,1280]`，横跨底部；原图右下只是一枚小图案 | 异常远端像素造成大框，FAIL，不能任意剪掉来通过 |
| 同文件，frame 217 / object 1 | 左上对象扩成 `[4,3,79,93]`，延伸到背景 | 完整且唯一边界未确认 |
| `mask-propagation-reverse/results.json`, frame 0 / object 1 | 左上对象扩成 `[6,6,241,253]` | 反向传播也不能直接生成覆盖框 |
| 反向 frame 156→157，45→46 | 两只底部对象的空/非空变化与独立 QA 检查的这两处出现/消失边界一致 | 仅局部时间证据；不能代替全部逐帧生命周期验收 |

独立 QA 实际查看了原帧 40–50 和 150–162：底部两图案在 45→46 消失、156→157 出现，顶部两图案在所查窗口持续可见。这是 Agent 离线目检，不是用户人工验收，也没有被推理脚本读取。没有穷尽标注全部帧、全部目标轮廓，因此不提供伪精确 recall、像素完整覆盖率或时段准确率。

## Acceptance Boundary

**当前组合 FAIL；无合格最终边界、无导出、无生产接入。** 成熟模块已经复用，但单帧发现仍有漏检，传播仍有异常大框；语义类别探针不能消除这些几何失败。没有因一次 mask 空缺结束身份，也没有通过固定四角框、最大连通块裁切、无条件 padding 或调宽 gate 伪装成功。

本轮没有证明 DEVA、XMem 或其他成熟模块不可行，也没有把它们的文档当作实测。它们与发现、语义身份、边界完整性及生命周期 gate 的职责不同，不能作为“直接搬来即可通过”的依据。后续若换用尚未准备好的实现/权重，须先列明本地缺口及依赖，再按用户约束取得安装/下载授权；当前失败结果不授权扩大生产实现。

## Verification And Evidence Seal

密集分块、候选诊断、45 案语义及两次传播进程均实际 exit 0。45 案最终类别计数为 6 个 `overlay_sticker`、39 个 `physical_object`，包括重复对象 proposal，不是 6 个唯一贴纸，也不是 100% 语义准确率。`execution-record.json` 保存主线程据工具完成输出记录的脚本、解释器、隔离方式与 exit；不是完整 stdout 转录，也不冒充早期所有探针的执行历史。

`finalize.py` 在断网只读隔离中 exit 0：重新校验全部 33 个源视频摘要；核对 240 张分块输入与原始帧解码像素完全一致（PNG 编码字节可以不同）；逐一核验 9245 个 mask 的尺寸、像素数和原坐标边界；核对 45 张语义输入摘要、960 条 UNKNOWN 记录、正反向完整帧号及每帧四个 propagation 对象。`result.json` 明确 FAIL、空 accepted boundaries、禁止导出，各准确率为 null。

`integrity-manifest.json` 封存 16341 个文件，清单自身 SHA-256 为 `c95f95d8ee143dc7bf188b1da5cd93a02977e3414e784a6d45e68852f48d7e9d`。此处的可复查证据包括原帧、候选/mask、模型原始响应、取消记录、逐帧未知状态和失败结论；没有有效覆盖成片。所有本轮外部脚本语法解析通过；repository 仍只修改本报告，不为文档变更运行无关 typecheck/build。

最终独立 `reviewer_high` 为 `accept with concerns`，无阻止记录当前失败结果的问题：完整复核 seal 的 16341 个文件集合及 SHA-256，确认 45 个原始候选语义输入无遗漏、无 GT 泄漏，并复核上述漏检与传播大框。其指出 frame 217 的异常大框主要由主体外的一个远端孤立像素触发；若以后使用组件过滤，必须作为新的自动规则独立验收，不能据此直接裁框通过。此 verdict 接受的是证据与 FAIL 记录，不是算法、模块或生产接入验收。

# Reuse Adapter Implementation

用户要求“复用适配”后，在 `main@afca495` 上新增隔离适配器，目录为 `/home/reggie/jianji-validation/20260916-reuse-adapter-eNbhVV/`。本次落实的是成熟模块间的薄适配和可验证接口，不是生产接入；保持用户原先的独立目录、无新依赖/权重、无付费服务、无应用重启和失败关闭约束。`systematic-debugging` 用于核对真实 API 行为，`verification-before-completion` 用于区分适配测试成功与视频验收失败。

## Reused Modules And Contract

检查本机 Transformers 4.57.1 发现：`Sam2VideoProcessor.post_process_masks` 接受 `max_sprinkle_area`，但实际 `Sam2ImageProcessorFast.post_process_masks` 的组件清理仍是 TODO，参数未执行。合成离群点测试证明默认输出和传入 16 的输出相同，不能只传参数便声称启用清理。

`mask_adapter.py` 直接 import 现有 ComfyUI `comfy.ldm.sam3.tracker.fill_holes_in_mask_scores`，在原始低分辨率 logits 上使用其现有视频路径采用的 `max_area=16`，再调用 Transformers 原分辨率后处理。不复制连通域实现、不取最大组件、不用真值调参、不改模型 memory。该 helper 同时清理前景小组件和填充小背景孔；16 的单位是低分辨率像素，不能解释为原视频只删 16 像素。

适配输入为有限浮点 N×1×H×W scores、原始尺寸及唯一 ID；输出保存 raw/candidate/removed/added 四类 mask、原始及清理后的 logits、边界和增删像素数。所有候选保持 boundary=UNVERIFIED、presence=UNKNOWN、identity=INPUT_HYPOTHESIS、export_permitted=false。单元测试专门证明：与噪点像素相同的真实小细节也可能被删，不能由清理完成自动授予导出权限。

## Interface Repairs And Verification

首轮真实重放因对象 ID 列表不匹配被拦下。原因是原生 processor 把传入 list 保存为待处理状态，model forward 又对其逐项 remove；若调用侧复用同一 list，自己的身份映射也被修改。`seed_session` 现在保留不可变 tuple，并传独立 list 副本；没有重排或猜测对象身份。失败输入目录和初版脚本保留在 `forward-failed-id-alias/`、`failed-id-alias-*.py`。

独立 review 还指出 `assert` 不能承担完整性 gate。本次已改为显式异常，并绑定源视频、帧、模型、全部 seed proposal 的内容/顺序及 mask 摘要；`python -O` 下的拒绝测试通过。10 项测试实际 exit 0，覆盖无效维度/非有限 scores、重复 ID、空 mask 不判消失、多对象/非方形输出、增删像素、保留较大断开组件和 native ID 别名问题。早期测试另有 dtype fixture 错误，已修正为原生 `torch.float32`；执行记录区分测试夹具失败与模型失败。

最终正向 82 帧、反向 159 帧均 exit 0，seed 帧重复，实际仍是 240 个不同源帧。`audit_adapter.py` 核验 964 个对象帧的原始 mask 与上一轮逐像素一致；272 个对象帧因输出清理发生变化，合计删除 725、增加 1428 个原生像素，964 条 presence 均为 UNKNOWN。计数包含重复 seed，不是 964 个唯一时刻或准确率。本轮没有重跑发现/语义，复用经 seal 核验的自动 seeds；没有消耗 holdout。

## Outcome And Remaining Blocker

局部改善可复现：forward frame 217 右下原框 `[15,1251,720,1280]` 变为 `[688,1251,720,1280]`，删除 1 个、增加 47 个原生像素；左上从 `[4,3,79,93]` 变为 `[4,3,79,38]`。这证明现成清理模块消除了这些离群像素造成的异常范围，不证明完整目标边界通过。

**真实片段仍 FAIL**：reverse frame 45 的喇叭 candidate/raw 框均为 `[8,1247,32,1273]`，右侧黄色放射线在框外。主线程和独立 QA 分别查看 `audit/reverse-f045-zoom.png`，确认只包住核心、未包住整件图案。原始传播已经遗漏的细节不能由去噪适配补回。因此适配代码与接口验证已落地，但完整边界、唯一身份、逐帧生命周期及批次泛化尚未通过；不生成导出、不修改生产识别。

`runtime-provenance.json` 补录实际 HF session/model 源码、模型/processor 配置摘要及 OpenCV 4.12.0 backend；明确为运行后对未修改本地环境的记录。Comfy 导入的 CUDA130 建议警告保留：实际清理走 CPU OpenCV/Torch，SAM 2 推理仍用原 Transformers CUDA128 环境，没有安装或升级。当前 runner 对本开发片段固定路由，校验失败可能留下输出目录；它不是已打包的通用生产组件。repository 仍仅更新本任务报告，无关 untracked 文件保留。

`seal.py` 实际 exit 0，核验运行实现/配置摘要、失败 attempt 的代码快照、964 个 raw 对照计数和反例框，封存 5086 个文件。`integrity-manifest.json` SHA-256 为 `565ad76f4c18a7642fae28c6543c8ed06538f8fa509986b8ad0c3bc48607935e`。`executions.json` 是按工具结果记录的退出状态，不是完整日志；本地 README 说明独立目录复现方式。外部 Python 适配器运行其 10 项测试及真实重放，repository 文档修改只检查 diff/引用，不运行无关应用 typecheck/build。

最终独立 `reviewer_high` 为 `accept with concerns`，无阻止交付隔离适配器和 FAIL 记录的问题。其指出 audit 本身没有逐项验证旧比较文件的 seal；主线程随后额外只读核验所比较的 964 个旧 mask 与 2 个旧结果 JSON，966 个摘要全部匹配已固定的 baseline seal。此验证支持本次精确重放结论，但未来重跑仍应先补足同样校验。运行后 provenance 与固定开发片段路由的限制继续保留；review 不批准生产或泛化。

# Frozen Real Retest On Another Development Video

## Scope And Method

用户要求“继续真实测试”后，在 `main@602bf77` 使用新证据目录 `/home/reggie/jianji-validation/20260916-real-retest-gqNRAB/`，不修改生产代码。根据冻结 corpus 的 `development && !previously_exposed` 条目，按 `(width,height,SHA256)` 排序选择素材，不按画面挑选通过样例：`竞品详情-抖音电商罗盘 (31).mp4`，SHA-256 `54d8f2624c850c81051ecc9103660da70bafa0148c00a168fcc8b2ff18333dc2`，540×960、30fps。实际测试为原生首 240 帧，时间戳 0–7.966667 秒；它仍属于原 development 分组，不是独立 holdout，也不是全批泛化验收。旧 corpus 的未暴露标记是历史快照，本轮后该素材已暴露。

直接复用已封存的 SAM 3.1 detector，参数仍为 `decorative sticker:16`、threshold 0.5、tile 384、stride 256、refine 0；全画面加均匀铺满的 tiles，每帧 9 个输入。没有固定四角种子、人工坐标或旧 VLM 框。240 帧模型推理 exit 0，保存 **2,160 个检测输入、4,928 个 raw proposal**，其中 2,245 个触及人工 tile 边界；保留全部候选，不以最高分或预先去重代替判断。

本地 Qwen 沿用上轮时间证据 prompt、六格布局和 greedy generation 参数，证据帧预先均匀确定为 `[0,48,96,143,191,239]`。仅适配原生尺寸裁切和源 PTS 标签，不沿用旧 720×1280 的裁切常数。计划逐一分类首帧全部 32 个候选，并只将语义正例作为传播假设；没有把模型响应当真值。

## Concrete Failure And Stop

**语义 seed gate FAIL**：首帧 `t01-m01=[5,4,23,24]`、304 像素，是左上橙色表情图案唯一 raw proposal。模型原始响应为 `physical_object`，理由是“真实人物面部”。`semantics/04-input.png` 显示该卡通脸图案在 0/48/191/239 帧出现，96/143 帧不显示；主线程与独立 Agent 分别目检，确认该响应为语义假阴性，而非拍摄人物。该候选会被当前 semantic-positive-only seed 策略排除，不能用人工改分类后继续声称自动成功。

确认反例后主动终止本次 Qwen 实验进程（exit 143），不重试或调参。实际取得 **13/32 条响应**（3 个 `overlay_sticker`、10 个 `physical_object`），14 张输入板包含 1 张未获得响应的在途输入。原始 manifest 的 RUNNING 状态保留，`executions.json` 明确覆盖为主动中断，不伪装全量分类完成。未运行 SAM2 传播；这不是 SAM2 本轮实测失败，也不证明将来的重发现或反向恢复不可行。

另有 discovery-stage 反例：frame 239 / 7.966667s 的右上橙粉小图案可见，但全部 raw proposal 均未与离线验收区 `[500,0,540,50]` 相交。该区域只用于运行后的反例核对，不是推理 seed，也不是精确人工轮廓。此证据只证明检测阶段漏检，不能单独推断已有 tracker 无法补全。

## Verification And Boundary

`validate.py` exit 0：核验源视频摘要、240 张输入、2,160 个实际 tile 像素、4,928 个 mask 的原坐标边界/尺寸/像素数、13 条语义候选顺序与输入摘要、上述唯一候选和漏检反例。240 条 presence 均 UNKNOWN，accepted boundaries 为空，所有准确率为 null。没有穷尽轮廓及生命周期标注，不能把目检或模型响应当用户人工验收。独立 QA 的坐标/判断未被推理脚本读取。

本轮在语义失败处停止：**无合格最终边界、无导出、无生产接入、未使用 holdout**。只复用了已有本地模型和依赖，所有媒体/模型进程断网隔离，未启停桌面应用、未访问 API Key。`systematic-debugging` 和 `verification-before-completion` 分别用于冻结参数反例验证与实际证据检查，没有借测试扩大实现范围。repo 仍仅更新本报告，无关 untracked 文件不动。

`seal.py` exit 0，封存 8,080 个文件；`integrity-manifest.json` SHA-256 为 `97b82b61c1250fdf47863aa87fea952a1ea2db818b8111b8ccef4701ffd9ae9d`。本地 Qwen 文件摘要是运行后 provenance，不冒充加载前校验。所有已完成模型/媒体实验进程均已退出，唯一主动终止的是本轮语义 Python 进程。

最终独立 `reviewer_high` 为 `accept`，无 blocking issue：分别查看语义反例和 frame 239 原图/候选，复算计数，核对未执行传播、UNKNOWN presence、空 accepted boundaries 和无 GT 泄漏；只接受本轮 FAIL 记录。主线程另已逐项核验全部 8,080 个文件摘要与完整文件集合，零不匹配，并通过 5 个外部脚本语法检查和 `git diff --check`。没有因纯报告更新运行无关应用 build/typecheck。

# MiniMax Single-Case API Comparison

用户要求调用 MiniMax，并明确允许既有连接模块在进程内使用已保存 Key 认证后，在 `/home/reggie/jianji-validation/20260916-minimax-semantic-IkW9AA/` 执行一次隔离 Node 请求。复用生产 `ConnectionStore` 与 `completeApi`，不启动 Electron、不改连接或生产代码、不复制凭据；bwrap 将 host 只读挂载，仅证据目录持久可写。模型为现有 `MiniMax-M3` / Responses，锁定官方 `https://api.minimaxi.com/v1`；最多一次请求、禁止 redirect、无重试。调用前 `reviewer_xhigh` 指出 endpoint 未完全冻结，修复并绑定实际执行 bundle 摘要后复审 accept。

使用上一轮 `semantics/04-input.png` 的完全相同 PNG 字节与 prompt，不附正确答案。图片 SHA-256 `2f730626fd6e2ac9b3635a97cecd4a08f3703bc8040622dd7fa3d26680a8db6e`，prompt SHA-256 `dec98691628a133c0fd5003cce93a0025b62487d4e2ae1186526d8de0ec2487b`。输出上限 1024 tokens，保留已保存推理档位；它与 Qwen 的 192-token greedy 设置不同，因此仅为同图同 prompt 的单例对照，不是严格同设置 benchmark，也没有使用 holdout。

**真实 API 接通，单例语义仍 FAIL**：唯一请求 HTTP 200，Responses status=completed，耗时 4243ms；服务返回 3336 input / 51 output / 3387 total tokens。JSON 合法，但分类仍为 `physical_object`，理由描述背景产品包装，而不是红框中的左上橙色贴图。原响应保存在 `result.json`，运行后的 Agent 验收另存 `evaluation.json`；不是用户人工验收，也不是整个模型准确率。该响应提示可能存在目标指向或小目标理解问题，但单次结果不能隔离根因，不能直接断言换模型无效或 MiniMax 不支持视觉。

没有追加请求、传播、媒体导出或生产接入。原封存输入/源数据未修改，API Key 未向 Agent 展示或写入证据；预检编译、Node syntax check 和断网 inspect 通过，实际 API 进程 exit 0。仍保持整体 FAIL 与 exportPermitted=false。

`seal.mjs` 离线校验输入、prompt、源码、实际 bundle、单次完成响应后封存 8 个文件，seal SHA-256 为 `9af58b13cb8f90167ef785690a2eee1fba0f6f89e52d55a348ce6b688032c861`。主线程再独立复核完整文件集合及 8 个摘要，全部一致；只提交本报告，保留无关文件。

调用后独立 `reviewer_xhigh` 为 `accept`，复核输入图片、模型原文、单例 FAIL 归因边界及全部 8 个摘要，无 blocking issue；不是生产或泛化验收通过。
