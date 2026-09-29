# Manual Region Shape Cover Candidate

## Status and Priority

状态：`CANDIDATE / DESIGN_ONLY / NOT_IMPLEMENTED / PRODUCT_NOT_ACTIVATED`。

2026-09-29 用户说明现有覆盖主要使用手动模式，只能画矩形框，不能描复杂轮廓；要求把这个候选方向写成文档，并先继续打通之前的 AI 路线。本次仅保存设计，不修改手动模式、产品规则或渲染行为，不创建本候选的 implementation plan。当前优先任务仍为 [M5-D2A AI implementation plan](shape-matched-cover-m5d2a-plan.md)，其工程及资格状态由 [AI phase record](shape-matched-cover-m5d2a.md) 维护。

用户随后明确 AI 模型只用 MiniMax + GPT、不要 Kimi；该指令作用于优先继续的 AI 路线，不将本手动候选改成需要模型描边。

本候选需在未来独立明确实施范围、通过 Self-Review、形成 implementation plan 后才能实现；文档存在不授予产品启用或自动形状覆盖的源事实准入。

## Goal

用户只需画矩形、选择已有贴纸和生效时段，由本地程序尝试生成沿贴纸轮廓的不透明覆盖层。目标是减少现行白色矩形底板的突兀感，同时保持用户指定区域完整遮盖。用户不需要描旧贴纸轮廓，也不需要为了这个覆盖步骤调用 AI。

这条路线移除 AI 定位的责任，但不恢复被遮挡背景、不擦除原视频、不生成新贴纸或改写贴纸文字。它与自动形状匹配共享可复用的像素处理能力，输入含义和验收声明必须分开。

## Current Behavior and Evidence

当前手动路径为 [manualCoverLayers](../src/main/cover-sticker.ts) → `coverLayerForMedia`，图层带 `opaqueBackground=true`；[compiler](../src/main/compiler.ts) 等比放入图案，并用不透明白色底板填满矩形。用户看到的“白框”是编辑区域；导出中的白底来自该渲染策略。

[shape-cover-alpha](../src/main/shape-cover-alpha.ts) 已有读取指纹绑定的本地图片、实际 alpha 栅格化及 PNG 编解码能力；现有入口限制为可核验的单帧 PNG/JPEG。它不会自行识别旧贴纸，也未实现本候选的缩放/摆放搜索。

[computeCommonShapeCoverCandidates](../src/main/shape-cover-candidates.ts) 在读取候选之前，必须核对已准入的源知识修订和旧贴纸 mask。本候选不能把手动画框塞进该入口冒充源 mask。上述结构用 CodeGraph 辅助定位，并以当前源码确认。

本次讨论前，当前工作树上已运行手动相关四个 suites：`cover-sticker`、`compiler`、`local-random-cover`、`cover-track.integration`，共 45 PASS，包含实际 FFmpeg 合成媒体导出检查。该证据证明现行矩形路径的工程行为，不证明本候选已实现，也不代表用户真实素材或形状覆盖已验收。

## Input and Interaction

输入沿用手动覆盖的素材、框、贴纸及时间配置：

- 用户为每条素材画一个或多个矩形，必要时明确指定不覆盖；保留现有共用框兼容行为。
- 用户指定框的生效时段，继续保留已有关键帧草稿。本候选首个可验证切片建议只处理固定位置和大小的时段；动态关键帧支持必须另行证明，不能把单个静态结果推广到整段运动。
- 贴纸来自当前模式允许且文件校验通过的本地目录。自己设置的手动模式继续遵守上传候选、独立指定框、跟随统一款和逐轮轮换规则；本地随机模式继续使用其现有候选池及不重复规则。不借本候选扩大手动选材权限。
- 程序展示真实生成层的预览及超出框的范围。无可行结果时解释原因，让用户调框或换贴纸；不得静默切换成另一款、自动改框或宣称成功。

局部框的选择责任属于用户。程序只证明配置区域被覆盖，不能由此证明用户框住了全片全部旧贴纸、框外没有贴纸或生效时段完整。

## Region Contract

矩形被解释为 `user-required-occlusion-region`：**用户要求遮住的全部区域**。它不是 `oldStickerMask`，不是逐帧源事实，不写入源贴纸知识、human/AI review receipt 或 no-sticker 证据。

沿用现有素材身份、正向解码坐标和输出设置 owner。把用户区域保守投影到实际输出像素，使用半开边界和向外舍入。对每个支持的生效输出帧，必须满足：

`requiredRegionFinal ⊆ opaqueCoverFinal`

`opaqueCoverFinal` 只包含最终真正不透明的像素；半透明边缘、透明洞、bbox 相交或非零 alpha 都不能替代遮盖证明。任一要求像素或时段未覆盖即失败。

coverage=100% 的声明只针对用户指定区域，不得标成自动源 mask coverage、完整源语义 PASS 或 production semantic qualification。

## Local Shape Construction

读取选定贴纸的实际字节与 alpha，保留图案原内容。局部搜索采用有界的平移和等比缩放，再尝试有上限的小幅轮廓扩张；选择满足完整区域遮盖和边界限制的可行结果。不得为了通过把图案任意拉伸、无限放大或把整个矩形直接填满后称为形状匹配。

不透明底色可以仍是白色，但只出现在经算法定义的贴纸轮廓及有限扩张内。图案内透明洞是否填充、半透明边缘如何形成不透明底板，必须在未来像素合同中明确并可验证；当前不指定未经验证的处理算法。直接删除白底或设置 `opaqueBackground=false` 会留下透明贡献，不能满足本候选。

缩放、外扩半径、面积增长、画面边界和对主体的侵入均需有限约束。具体数值须依据独立手动框样本校准并提前冻结，不能引用一次自动星形实验的参数作为手动矩形上线阈值，也不能按失败个案放宽。

## Feasibility and Visual Limits

矩形包含旧贴纸和周围背景；星形、叶形、窄长或凹形图案要完整包含这个矩形，通常比贴合真实旧贴纸 mask 更大。仅靠小幅外扩可能无解。候选允许解释失败，不能承诺所有现有贴纸都适合。

几何覆盖成功仍可能遮住人物、手、商品或重要字幕。未来手动路线至少需要配对原图/成片预览、明确人工确认及主体冲突样本验证；未经审阅不能把几何结果称为内容安全通过。具体准入和确认行为留给本候选的独立实施合同，不借用自动路线的资格或取消既有确认。

若用户要求紧贴旧贴纸的复杂边缘，仅有一个矩形无法提供那部分信息，需要另行识别/分割和核查。该需求不属于本候选，不能暗中启动 AI 来补足。

## Sticker Pool and Cost

本候选的读图、轮廓构造、像素比较和图层生成均可在本地执行，**覆盖步骤的模型 API token 成本可为 0**。这不包含另行选择的 Agent 装饰/创作，也不代表本地 CPU、内存、解码、预览及人工审阅成本为 0。

不必把整套贴纸库上传给模型。先处理用户实际选定或现有模式分配的候选；若未来允许本地推荐，需单独限定扫描数和时间。仓库资源文件数量不是经过校验且形状相容的候选数量。按文件指纹和算法/输出参数绑定的缓存可以作为后续优化，但当前未实现，不以缓存假设承诺批量性能。

M5-D2A 另有逐帧视觉审阅及预算合同。它审阅源事实，不负责本候选的描边或渲染；本候选的零 token 方向不能免除该 AI 路线的完整帧、隔离、真值、费用及资格门。

## Canonical Reuse and Compatibility

| Concern | Reuse boundary |
| --- | --- |
| 手动框、素材配置和选款 | 现有 shared decorations/agent schemas 与 `cover-sticker.ts`；不新增第二套手动草稿或贴纸选择器。 |
| 本地字节、alpha、PNG | 复用 `shape-cover-alpha.ts` 中适用的低层能力；不把用户区域转换为已准入源 mask。 |
| 几何证明 | 单独标明用户区域的证明对象；复用适用像素运算，保持 source knowledge / source admission owner 独占源事实。 |
| 冻结、样片、导出与重试 | 沿用 template/compiler/queue/artifact 生命周期；未来冻结区域、时段、贴纸指纹、输出设置、算法参数及实际图层字节，预览与导出消费一致。 |
| 历史任务 | 按既有元数据解释白底/透明行为；不得追溯改渲染、重新选款或迁移成新证明。 |

当前 [自动 V1 spec](shape-matched-cover-spec.md) 明确保持 manual/assisted 不变。本候选若未来实施，需要明确新增 opt-in 行为及规则兼容变更；不得悄悄替换现有手动路径、挪用 `FullSourceAdmissionHandle`、建立第二套 knowledge/admission owner，或绕过自动形状覆盖的 mask/全源资格门。`assisted` 的草稿、预览及批准合同继续独立。

## Future Verification Criteria

下列是未来实现的验收方向，目前均 `NOT_EVALUATED`：

1. 矩形映射、补边、向外舍入、贴边、输出规格变化和时间边界有可执行像素证据；任一漏像素明确失败。
2. 透明洞、半透明边缘、细尖、凹形、窄长、无匹配款和超限样本真实被检查；不接受降阈值、静默换款或矩形回退。
3. 支持范围内每个输出帧/栅格状态的时序覆盖成立；动态草稿、不支持素材和取消明确拒绝或停留未完成，不能借抽样宣称全帧成立。
4. 实际 FFmpeg 样片与冻结像素一致，并记录人物、商品、字幕附近的人工审阅结论；测试 fixture 不代替真实媒体观看。
5. 多素材、多框、逐轮选款、不重复、显式不覆盖、历史任务和重试回归；源视频顺序、时长、音频不变。
6. 记录本地耗时、内存、候选数与失败率；验证覆盖步骤无 API 请求，并分别报告其他 Agent 调用成本。
7. 确认没有 source knowledge 写入、伪造 human/AI review evidence、第二套生命周期或自动生产资格签发。

## Self-Review

本候选满足用户“只画矩形、程序处理轮廓”的操作方向，也明确保留矩形目标可能导致扩大遮挡或无解的代价。用户区域与客观源事实分离，现有选材/重试/历史合同未被文档改写；本地成本与 AI 审阅成本分开。没有把现有 45 项测试、白底开关、轮廓低层能力或几何包含关系当作本候选已实现/生产可用。

当前只保存候选，优先继续之前的 M5-D2A；全部自动形状生产 BLOCKED gates 保持原状。
