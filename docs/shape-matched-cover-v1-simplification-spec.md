# Shape-Matched Cover V1 Simplification Delta Spec

## Status and Authority

2026-10-02，`COURSE_CORRECTION / DOCUMENTATION_ONLY / PRODUCT_DISABLED`。本合同根据当前用户明确的产品调整和 [source audit](shape-matched-cover-v1-simplification-audit.md) 制定；实施路线见 [revised plan](shape-matched-cover-v1-simplification-plan.md)。本轮不实施算法、不修改生产准入、不开展 D2Q、D3/D4、正式 AI qualification 或 activation。

本 Delta 覆盖旧 [V1 Spec](shape-matched-cover-spec.md)、[V1 Plan](shape-matched-cover-plan.md) 和 [automatic contour contracts](shape-matched-cover-auto-contour-spec.md) 中将 **全片穷尽目标/无贴纸证明、人类或双 AI 语义资格** 作为默认 V1 发布前置条件的部分。其余源身份、保守 mask、局部完整时域、共同候选、像素覆盖、独立画面安全、冻结和托管合同继续有效。历史 records 及其失败、未评估和授权状态不重写。新路线的 M0–M6 与旧阶段同名不意味着旧阶段重新验收。

这是一项目标合同调整，**不是当前实现已完成脱耦**。现有 assembler 和 guard 仍无条件拒绝；新入口必须完成下方 Activation Requirements 后单独接线。

## 1. Product Goal

自动遮住原视频中已检测并确认的静态旧贴纸，用本地合法贴纸和有限轮廓扩张替换，减少大块白色矩形。保持原视频顺序、时长、音频与现有等比缩放补边规则。普通 Windows / Linux CPU 可运行；renderer 只消费冻结图层，不依赖 Agent、LLM 或 GPU AI。不能可靠处理就 `UNSAFE`。

## 2. Supported Target Classes

- `static`：在确认有效时域内，旧贴纸屏幕坐标固定，可见贡献能被一个保守源像素 mask 包含；编码噪声不要求逐帧 RGB 完全相同。
- `stationary-animation`：锚点固定，轮廓、透明度或可见性变化；仅当完整有效时域的保守 union mask 与独立运动核查均成立时支持。允许 union 包含闪烁消失期间的空位，仍须画面安全检查。
- 多个已确认 target：每个独立绑定身份、时域和 mask，整轮选款必须满足全部确认目标与输出设置。

静态与固定动画分开验收。只有静态方法合格时，产品必须声明仅支持静态；固定动画不因已有 union 模块或受控 fixture 自动开放。

## 3. Unsupported Target Classes

移动贴纸、移动锚点、身份无法跨时段确定、无法界定的半透明贡献、遮挡后身份不明、未知动画外扩、输入/解码包络外素材均不支持。`delogo` 不作默认路径；不增加 AI inpainting、新素材生成或 exhaustive unknown-target proof。

未纳入确认集合的目标可以报告为未处理/不支持；不能将其描述为不存在。已经确认的目标出现上述问题时，不能悄悄从集合删除来取得成功。

## 4. Confirmed-Target-Only Contract

冻结本次确认集合 `C`：由真实候选证据和身份确认建立，包含精确 source identity/revision、targetId、有效范围及确认来源。`C` 与 mask 查找结果分开，缺失 mask 不缩小 `C`。自动高置信确认需满足版本化方法与支持包络；不确定身份允许一次用户确认 target/粗 ROI，无需用户描边。

**absence of detected target != proof that no target exists**。

**V1 success = all confirmed targets safely covered**，即非空 `C` 中每个目标在承诺有效范围内都有保守 mask、对应输出像素全覆盖、画面安全和一致冻结/发布证据；**不要求穷尽证明全部可能旧贴纸**。

未发现候选或没有确认目标返回明确的 `NO_CONFIRMED_TARGET` 结果，不签发 shape-cover success、全片 EMPTY 或无贴纸证明。该名称是待实现的产品结果，不是当前 schema literal。用户可返回正常制作流程另行选择不覆盖，系统不得自动回退后宣称覆盖成功。

确认集合外的未知 target C 不需要证明不存在。若其歧义影响某已确认目标的身份、mask、运动或安全判断，则该确认目标仍 `UNSAFE`。集合更改、目标新增或重新确认使未入队的依赖结论失效，不能复用旧集合的 PASS。

## 5. Automatic Detection Contract

采用有界 CPU discovery：temporal persistence、temporal variance、edge persistence、connected components、multi-frame consensus 与 static screen-coordinate consistency。有限代表帧用于产生候选；低分辨率 discovery 不能作为最终 mask，须回原像素核验。

低方差或持久边缘只说明稳定图像区域，不能独自证明是旧贴纸；静止背景、商品印字、字幕/UI 都是必要负例。候选记录范围、原帧/PTS、原像素与 discovery 映射、方法版本/参数、信号和拒绝原因；confidence 分数不替代身份确认和 mask 核查。

默认无人工 ROI；歧义时允许一次确认候选/粗 ROI。仍无法可靠分离则停止，不升级为普通用户逐帧填写 `T(f)`。同一确认目标的后续完整时域使用 deterministic verification，不能反复问 LLM，也不自动重试服务错误或换连接。

## 6. Conservative Mask Contract

继续复用现有 SourceIdentity、sourceKey、修订及证据 owner。源坐标 mask 必须包含确认目标全部可见贡献，细尖、描边、抗锯齿与半透明不确定边缘向外纳入；不能为形状匹配裁掉不利像素。保留整数半开 bbox、原像素编码/摘要、mask provenance、算法与参数、核查范围和引擎解释。

首次建 mask 后，按目标 ROI 对整个承诺时域流式核验运动、边缘和异常，不要求逐帧语义枚举整个画布。静态 mask / 固定动画 union 必须保守界定其完整有效范围；代表帧没有反例不证明未观察时域安全。无法处理的切镜、遮挡、闪烁或外扩明确失败，或仅对有证据的范围重新确认；禁止在不告知用户的情况下缩短承诺范围。

mask 无漏失的测试分母是独立核查的 required pixels；运行时须有适用方法和完整目标范围核查，不能把“mask 被覆盖100%”当作“mask 本身完整”。独立开发/holdout 评估属于必要质量工作，逐帧像素 truth 可用于离线工程验收，不能成为普通用户操作步骤。

当前 `source-mask-only-v1` 仅支持单 target/segment、30–100 帧 probe 人工凭据；当前 `stationary-union/v1` 仅是无 authority 的几何候选。后续在原 knowledge/schema/admission owners 中增加**目标范围明确**的版本化 proof，禁止将这些旧凭据改名为新证明或复用研究 receipt 签发许可。源争议、store/evidence integrity 未知和 freshness 检查保留；这里的完整性指字节/记录/确认目标证据完整，不重引入全画布目标穷尽义务。不得解除其他功能原有知识阻断。

## 7. Shape Matching Contract

复用 `shape-cover-candidates.ts`、实际候选 alpha、`shape-cover-pixel-gate.ts` 与原合法素材目录。整轮共同候选为 `candidate × confirmed target/segment × output setting` 的交集；保留同轮统一款、轮换和冻结重试规则。

在版本化半径、面积和跨度上限内从小到大寻找最小合格轮廓；标签与 bbox 只能加速，不能替代实际 alpha。当前数值是工程起点，需要真实留出确认，不是普适安全结论。完全不相容、空交集或超限就失败，不以白底矩形救场。现有有限白色轮廓可以保留，但必须通过 NATURAL，不把“不是矩形”当作自然度通过。

## 8. Pixel Coverage Contract

每个确认目标与每个输出设置分别证明：`requiredOldMaskFinal ⊆ opaqueFrozenLayerFinal`，`uncoveredPixels = 0`，coverage = 100%。只有实际 alpha=255 的覆盖像素成立；非零 alpha、相交 bbox、其他输出设置/segment 的 PASS 都不成立。

保留 FFmpeg 实际 scale/pad、保守投影、输出空间边距、像素舍入和半开启停。相同固定栅格可缓存，仍须检查每个实际输出 PTS 的有效时段。PNG 解码往返核对真实 RGBA；编码后边缘还须真实导出检查，不能宣称有损 RGB 与源外观严格无差异。

## 9. Visual Safety Contract

**coverage PASS != visual safety PASS**。使用实际冻结层的摆放全图/局部图、几何边界、已知保护区域侵入规则及快速动态预览，检查脸、手、商品主体、重要字幕与白边、比例、截断和风格。面积阈值不能独自签 SAFE。

V1 允许必要的人类快速预览作为画面判定，记录其绑定的样片、设置、层摘要、范围和明确决定；不是 D2Q 人类方法资格，不要求逐帧 `T(f)`。快速预览不能替代保守 mask 或运动证明。自动视觉检查只在已配置、实际可用的允许连接上执行；不以双方一致签发全视频语义 authority。

SAFE/NATURAL/UNKNOWN 和四类内容保护沿原 admission owner 收敛。最多对一个素材版本更换两次共同合格候选并重新核验样片；这是未来本地修订上限，不授权当前商业请求。服务调用错误不重试。仍有冲突/不确定、候选不足或预算耗尽则 `UNSAFE`。不新建无限资格链，也不把 JSON verdict 当发布许可。

## 10. Performance / Cross-Platform Contract

discovery 代表帧上限96；原像素确认/验证采用有界 ROI、有限目标数和流式内存，不将整片 RGB/RGBA 持久 spool 作为 V1 默认条件。完整目标范围的便宜 deterministic decode/verification 可以保留；其成本与全画布逐帧语义推理分开报告。

CPU-only、无 CUDA 可完成 detection、mask、匹配和 overlay；renderer 使用原 compiler/queue，只消费冻结 PNG，不识别、不分割、不再扩张。视频编码应仍是主要耗时之一；以同机软件编码与整流程计时实证，未测就不声称。

M1先记录 discovery/mask/decode/匹配/preview/export 的分项时间、峰值 RSS 和 scratch bytes；开发样本定标后、holdout 前冻结普通CPU基线与时延/RSS上限。初始内存目标为 mask 工作集≤512MiB，不能隐藏子进程或依赖全片几十GiB spool。Windows / Linux 包装、取消、临时文件与 custody 的真实检查属于 activation 条件；Linux PASS 不替代 Windows。96帧/512MiB 是新路线设计限额，并非已测性能。

## 11. Fail-Closed Rules

确认目标身份不明、运动/锚点不明、mask 缺失/不保守、范围未验证、源/修订/证据改变、解码不支持、无共同候选、超限扩张、输出 coverage 非100%、SAFE/NATURAL 未通过、冻结字节/输出时钟失配，全部 `UNSAFE`。取消、超时、迟到和发布结果未知不恢复许可、不盲目重试。

确认集合外未检出目标不构成新的存在性证明义务。报告必须写清确认/未处理范围；不得以弱化 mask 检查、移除失败目标或增加矩形 fallback 实现“简化”。

## 12. Legacy Compatibility

保留 manual、assisted、本地随机、关闭覆盖、已有价格/文字约束、旧矩形/透明策略与历史重试解释。新 shape 请求不接千川自动上传或 local-random 组合；既有组合不受影响。旧 frozen 任务不重新识别、不换款、不改轨迹或轮廓。

复用 `ShapeCoverAdmission` 的私有进程内发布许可、`ShapeCoverArtifactStore`、原 queue、publish-once 与重启只读 reconciliation。新目标范围 proof 不能反向修改旧知识凭据；JSON、复制对象、重启记录不恢复发行 capability。

## 13. Research Features Removed From Critical Path

FullSourceFact exhaustive proof、全片 no-sticker proof、逐帧手工 T(f)、D2Q、人类资格 issuer、dual-AI A/B/joint blinded semantic qualification、D3 全宇宙目标 proof、D4 FullSourceAdmissionHandle，均为 `RESEARCH / FUTURE HIGH-ASSURANCE MODE`。保留源码、tests、records、失败和未评估值，不物理删除，不继续作为 V1 activation blocker。

D1 的源字节/帧时钟/解码拒绝工程仍可复用，full-canvas census 与多轮 re-decode/spool 不是产品默认前置。D3 中逐目标 mask/多时段的有用约束保留到原 owners，撤掉“未知 target C 必须不存在”的义务。画面复核与创作选款不等同于上述研究资格；其实际可用性仍需验证。

## 14. Activation Requirements

按新 [M0–M6 plan](shape-matched-cover-v1-simplification-plan.md) 完成以下条件后，才可另行实施 activation：

1. 真实静态 detector 和 target confirmation 可用，独立留出证明声明支持范围内 required pixels 零漏失，失败类别明确；固定动画单独合格才开放。
2. 原 knowledge/admission/store 支持版本化 confirmed-target proof，确认集合冻结、集合完整消费、争议/freshness、取消及防 JSON 伪造验证成立。
3. 原 assembler 提供可信 placement 和 prepared request，原生产链消费全部确认目标，不提前制造 coverage/SAFE 或出版许可。
4. 每个输出规格真实覆盖100%，实际摆放样片 SAFE/NATURAL；同 PNG 字节进入 compiler，批准样片经 custody 同字节发布且 publish-once 不变。
5. 多个真实来源/失败案例、CPU-only、Windows/Linux、性能/内存和 legacy 回归完成；未验收类别保持拒绝。若启用 Agent 选款/复核，验证实际允许连接，缺能力就使用已实现的人类确认路线或拒绝，不能 mock 成功。
6. 最后独立修改产品入口并做真实交互/安装验证。本轮 guard 继续关闭，没有环境开关、fake issuer 或 bypass。

不需要 D2Q→D3→D4→旧 C issuer，也不需要零目标素材的全片无贴纸证明。新的可信 request 准备责任仍保留于原 assembler；撤掉 exhaustive 前提不等于可把 raw M4 fixture request 直接开放给 IPC。

## Self-Review

范围缩小为非空确认集合；目标完整时域、保守 mask、输出 coverage、画面安全和发行 authority 五种证据保持分离。一次人类确认解决候选身份，不能替代像素核查。固定动画单独验收；无目标不产生真空成功。历史结果、原生产关闭和旧任务解释保留；只修改文档且不自动执行后续计划。
