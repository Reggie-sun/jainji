# Sticker Cover Prior Art — 2026-09-16

## Scope And Decision

本记录研究小型、可能随镜头变化的原视频叠加贴纸，重点是“发现 → 完整边界 → 跨帧关联/重发现”的分层模式，而不是让 VLM 在相邻窗口独立重新猜测全部框。本记录不是生产设计、依赖批准或准确率声明；任何候选仍须在 Jianji 的自动覆盖失败关闭、白色不透明外扩覆盖和冻结重试约束下验证。

**事实（本仓库实测）**：SAM 2.1 在坏初始框后不能补足边界；自动 proposals 漏掉多个角落目标；视频传播中右下自第 11 帧空掩码、左上在切镜第 46 帧丢失，而原图仍可见。[`runtime-cover-validation`](runtime-cover-validation-2026-09-16.md#results)

**事实（本仓库实测）**：SAM 3.1 / ComfyUI 的 `graphic overlay:16` 在两张静帧能给出四角候选，但也检出原字幕；自动视频在第 3 帧漏掉仍可见的左下小目标，第 46 帧左上 mask 扩张为包含远处像素的异常大边界。它是未批准的候选定位引擎，不是本次推荐的已验证组合。[`runtime-cover-validation`](runtime-cover-validation-2026-09-16.md#observations)

**结论（推断）**：下一步应检验一个可审计的分层管线，而不是降低当前跨窗口 IoU 阈值、用坏框作 `matchTemplate` 种子，或把该 SAM 3.1 组合接入导出。

## Prior-Art Patterns

### Prompted Segmentation And Propagation

**事实**：SAM 2 官方 API 是先向某帧加入点/框 prompt，再把该对象的 masklet 传播到视频；其 `SAM2VideoPredictor` 保存 inference state，并支持多对象。官方 2024-12 更新还允许跟踪开始后加入新对象。它解决的是“给定目标后的分割/传播接口”，不是无提示小贴纸发现保证。[SAM 2 README](https://github.com/facebookresearch/sam2#video-prediction)

**事实**：SAM 3 官方定义为可由文本或视觉 prompt 在图像/视频中检测、分割、跟踪；短文本可穷举开放词汇概念的实例，视频 API 在任意帧加入 text prompt 并输出结果。[SAM 3 README](https://github.com/facebookresearch/sam3#basic-usage)

**推断**：SAM 3 的能力更贴合“在新片段或丢失后再次发现候选”，但 `graphic overlay` 的字幕误检、frame 3 漏检和 frame 46 边缘离群已经证明：本素材上不能以其原始候选直接生成覆盖矩形。

### Detector Plus Temporal Fusion

**事实**：Grounded SAM 2 将 Grounding DINO / Florence-2 的开放词汇检测与 SAM 2 跟踪组合；其官方 video demo 为简化只在首帧用 Grounding DINO prompt，且提供点、框、mask 三种给 SAM 2 视频预测器的输入。该项目也记录了面向高分辨率密集小物体的切片推理：重叠小块各自推理后合并检测结果。[Grounded SAM 2 README](https://github.com/IDEA-Research/Grounded-SAM-2#grounded-sam-2-video-object-tracking-demo) [切片说明](https://github.com/IDEA-Research/Grounded-SAM-2#sahi-slicing-aided-hyper-inference-with-grounding-dino-15-and-sam-2)

**事实**：DEVA 明确把任务特定的逐图像分割与任务无关的双向时序传播分开，再半在线融合来自不同帧的假设；其 README 还记录了修复无法删除未匹配 segment 的 bug，以减少长期累积的误检。[DEVA README](https://github.com/hkchengrex/Tracking-Anything-with-DEVA#abstract) [DEVA lifecycle fix](https://github.com/hkchengrex/Tracking-Anything-with-DEVA#highlights)

**事实**：XMem 把 VOS 表述为记忆问题，以不同时间尺度的感知、工作、长期 memory 处理长视频，并公开 failure cases；这不是对象发现或语义分类器。[XMem README](https://github.com/hkchengrex/XMem#introduction)

**推断**：可借鉴的不是“换一个跟踪器必然成功”，而是独立保留 discovery/re-detection、mask/box continuity、object death/scene-cut 三种决定。传播器不得在 detector 未再次支持、或边界校验失败时无限延续旧对象；同样，不得因为一次丢 mask 就自动画手工框或固定角落框。

### Editorial Trackers And Screen-Space Assets

**事实（父线程核验）**：Adobe After Effects 的 mask tracker 先由用户画出包围目标的 mask，再跟踪 transform；官方指引要求检查 clip、校正漂移后重新跟踪。[Adobe documentation](https://helpx.adobe.com/after-effects/desktop/animate-in-after-effects/track-mask/rigid-mask-tracking.html)

**事实（父线程核验）**：Mocha 的形状 spline 定义其要寻找的像素，随后以与下一帧的相似度形成 keyframe。[Mocha documentation](https://borisfx.com/documentation/mocha/mocha-vegas-quick-start-guide/)

**推断**：这些商业工具的共同模式是“目标定义”和“跟踪”分离，但它们的人工初始化、检查和漂移修正不能成为 Jianji 自动模式的 inference fallback；人工标注只可用于离线评估真值。

**事实（父线程核验）**：OpenCV `matchTemplate` 将模板与图像的重叠区域比较，返回分数图；可用 mask，多个出现位置需要阈值化而非单一最高点。[OpenCV template matching](https://docs.opencv.org/4.13.0/de/da9/tutorial_template_matching.html)

**推断**：已知固定屏幕空间贴纸可以用经本地验证的 patch/mask 与时序 presence 作廉价候选证据；分数不能证明完整边界或语义身份。本仓库左上局部模板匹配分数为 0.9784，仍只有 35 像素宽；另一个左下模板的最高分位置跑到商品区域。这是两个不同反例，均不支持把现有 VLM 坏框或单一最高分升级为自动覆盖依据。[本地反例](runtime-cover-validation-2026-09-16.md#results)

### Static Logo Detection From Multiple Frames

**事实（源码）**：`multi-delogo` 的 `average_frame` 对时间区间内采样帧求平均，`find_boxes` 锐化后逐通道处理，`find_box_in_channel` 使用形态学、阈值和轮廓得到矩形；`get_logo_transition_point` 比较相邻帧候选区域的变化，寻找时间边界。这是利用叠加图案的时间稳定性定位，不依赖语言模型逐窗报框。[OpenCVLogoFinder.cpp](https://github.com/wernerturing/multi-delogo/blob/master/src/opencv-logo-finder/OpenCVLogoFinder.cpp)

**限制（官方说明及源码）**：用户仍需设定尺寸、持续时长和搜索区间；官方列出漏检、局部框、场景误检及时间偏差，并要求检查结果，未解决的 review 区间会阻止编码。源码最终选择一个矩形，且把 `x == 0` 当作无效候选，不能原样用于本任务的多个贴边目标。代码为 GPL-3.0-or-later；本文仅借鉴思路，不复制实现或引入依赖。[使用说明](https://github.com/wernerturing/multi-delogo/blob/master/docs/en/README.md) [实现与许可](https://github.com/wernerturing/multi-delogo/blob/master/src/opencv-logo-finder/OpenCVLogoFinder.cpp)

**推断**：对本批固定屏幕位置的图案，这比直接再换一个通用跟踪模型更值得做小实验。但静止商品、字幕也可能稳定；动态贴纸会在平均中模糊，完整边界必须回原帧验证。时间稳定性只能产生候选，不能证明“是贴纸”或“已全部发现”。

## Minimal Next Experiment

1. **离线真值与片段边界。** 从同一失败素材选含出现、消失、切镜和小尺寸目标的帧；人工仅标注 evaluation 的贴纸 mask/外扩覆盖矩形、可见区间及 scene cut，不把这些框给自动推理。逐帧量化发现 recall、漏贴纸时长、字幕/商品误报、覆盖 rectangle 是否完全包住真值和过盖面积。
2. **先测固定图案定位，不重复失败组合。** 优先在同一素材 5.25 秒失败点及出现、消失、切镜附近，验证“多帧稳定区域提出候选 → 原分辨率检查完整图案边界 → 语义模型区分贴纸与字幕/商品 → 逐帧验证出现区间”。自动候选须搜索全画面，不能硬编码四角覆盖框，也不能把人工真值或现有坏框作为种子。与现有 VLM 坐标法对照，候选、边界与存在性证据分别保存。动态目标的检测加传播作为后续独立问题；本次不推荐原样再跑已失败的 SAM 3.1 组合，也不授权新增安装、下载或商业调用。
3. **边界与生命周期 gate。** 每帧检查边界完整性、面积突变、与最近有效边界的关系，再向外取整为白底矩形；异常远端像素必须触发复核或拒绝，不能任意裁掉。切镜触发重新验证、撤销场景运动假设，但屏幕叠加贴纸可能跨切镜仍存在，不能仅凭切镜终止。只有明确消失证据才能结束可见区间；未观测或不一致仍属不确定，必须失败，不得当作已消失或无限沿用旧框。
4. **验收。** 与当前 `detectCoverTrack` 的失败关闭语义对照：任何必需角落真值漏检、字幕/商品被选为源贴纸、边缘未包住、异常大框、或 identity 不唯一，均为 FAIL 且不导出。只有完整帧级证据通过后，才讨论单一定位 owner 的生产替换、FFmpeg 产物验证和人工播放验收。

## Practical Constraints And Licensing

**事实**：SAM 2 的模型 checkpoints、demo 与训练代码在官方 README 中标为 Apache-2.0；SAM 3 使用单独的 SAM License，官方使用说明还要求先取得 Hugging Face checkpoint access 并认证下载。[SAM 2 license statement](https://github.com/facebookresearch/sam2#license) [SAM 3 access and license](https://github.com/facebookresearch/sam3#getting-started) [SAM License](https://github.com/facebookresearch/sam3/blob/main/LICENSE)

**事实**：Grounded SAM 2 的可选强检测路径需要 CUDA/Deformable Attention 构建环境，且部分 GD 1.5 / DINO-X demo 需要其 API token；DEVA 的 text/automatic demo 依赖其 Grounded-Segment-Anything fork，半在线快速 integer solving 另可使用 Gurobi，未配置时回退 PuLP 且作者称其未严格测试。[Grounded SAM 2 install notes](https://github.com/IDEA-Research/Grounded-SAM-2#installation) [DEVA install notes](https://github.com/hkchengrex/Tracking-Anything-with-DEVA#installation)

**推断**：最小实验应复用已获授权、离线可用的权重和隔离环境，不引入 cloud detection、token、下载或商业调用；若以后选择多组件方案，必须逐个复核 code、weight、detector 和可选 solver 的许可及 Windows/Linux 打包现实性。

## Limitations

- 所列官方项目说明接口和研究模式，不证明对本视频、任意小贴纸、遮挡、快速闪现或复杂运动的准确率。
- 无公开资料能取代本产品的“贴纸而非字幕/商品”的语义规则、白底外扩矩形几何及失败关闭验收。
- 本文没有修改算法、连接、项目、导出模板或模型文件；没有新的模型调用、媒体导出或人工成片验收。
