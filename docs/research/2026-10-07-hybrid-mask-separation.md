# Hybrid Mask Separation: Static Graphics and Translucent Shadows

## Scope And Evidence Boundary

2026-10-07 的 bounded external research；仅引用论文、官方 API 文档和项目源码。未安装依赖、运行算法实验、调用付费模型或改业务代码。本记录是候选方法研究，不是 implementation plan、独立像素真值、coverage/H4 PASS 或产品验收。

任务输入报告当前候选逻辑为 `std <= 20`、稳定像素 flood、`dilation=3`，静态背景会与贴纸连通至 ROI 边界；该描述来自 parent，本记录未重新核对业务源码。OpenCV 4.12 已在开发机安装也仅是 parent 提供的环境信息，不证明 Windows/Linux 应用具备该依赖。

## Key Findings

- **单帧 RGB 不唯一确定 alpha（HIGH）**：`I = alpha F + (1-alpha) B` 每像素只有三个观测而有七个未知量。Closed-form matting 解的是带局部颜色模型和前景/背景约束的优化问题，不能把其最优解称为原贴纸真实 alpha。[Levin et al., CVPR 2006, §1–3](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Levin06.pdf)
- **时间稳定不是贴纸归属（HIGH，数学推论）**：假定位置、F、alpha 恒定且忽略噪声，有 `Var(I_t) = (1-alpha)^2 Var(B_t)`。未知 `Var(B_t)` 时，低方差既可能来自不透明贴纸，也可能来自静态背景；弱阴影覆盖运动背景仍会变化。重复同一静态帧不增加可辨识信息。该推论使用上述 compositing equation，不是当前真实素材的实测结果。[模型来源](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Levin06.pdf)
- **硬分割不能自动保全软边（HIGH）**：原论文 Fig.1 和 §1.1 已明确指出，硬分割再 erosion 得到的 trimap 可能漏 fine/fuzzy features；窄边带 feathering 也无法处理宽软区域。因此 bbox agreement、固定膨胀和 GrabCut 二值输出均不能单独证明半透明阴影完整。[Levin et al.](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Levin06.pdf)
- **GrabCut 能利用颜色与边界分离候选（HIGH）；能否解决本样本尚未知（LOW）**：OpenCV 使用 GMM 和 graph cut；输入 hard FG/BG 不会被过程改写，rectangle 外部直接视为 sure background。若 ROI 切断阴影，这种初始化已把漏检写入约束。[OpenCV 4.12 GrabCut](https://docs.opencv.org/4.12.0/dd/dfc/tutorial_js_grabcut.html)
- **多图一致性有相关 prior art，但不能当现成视频解法（HIGH/MEDIUM）**：CVPR 2017 展示从带一致 watermark 的图像集合估计 foreground、alpha 和 backgrounds。推广到相关性很高的视频帧、静态背景和压缩阴影需要另证；摘要没有提供可直接用于本应用的依赖与许可包。[Dekel et al., CVPR 2017](https://openaccess.thecvf.com/content_cvpr_2017/html/Dekel_On_the_Effectiveness_CVPR_2017_paper.html)

## Technology And Integration Costs

| Option | Required evidence/input | Reuse and deployment | Limitation and verdict |
|---|---|---|---|
| OpenCV 4.12 `cv.grabCut` | 8-bit 3-channel image；single-channel labels；可信 FG/BG seeds 或完整包围目标的 rectangle | 官方 OpenCV.js API 可避免产品依赖 Python；需锁定实际 JS/WASM 或 native artifact，并验证 Windows/Linux 加载、内存及资源释放；本轮未核验现有产品 bundle | 输出类别 mask，不是连续 alpha；同色、弱边界、错误 seeds 会产生错误候选。**仅条件性 ADAPT 为候选 proposer**。 |
| PyMatting closed-form / KNN / large-kernel | RGB 与可信 trimap；软阴影必须处于 unknown，不可先写成 background | 已有开源实现可作 reference；仓库 `master` 当前 metadata 为 `1.1.16`，依赖 NumPy、Pillow、Numba、SciPy；GPU extras 非必需 | 无可信 trimap 时没有自动解决归属问题。**REFERENCE；不直接引入当前 TypeScript 产品**。 |
| 多图/时间 alpha estimation | 对齐的一致贴纸；有信息量的背景变化或额外背景证据；运动、色彩及压缩模型需验证 | 已找到论文；本次未确认官方可复用实现、代码许可或桌面发布组件 | 相邻视频帧不是独立背景观测。**DEFER**，不能用论文效果授权重新实现大管线。 |

API 与算法依据：[OpenCV 4.12 文档](https://docs.opencv.org/4.12.0/dd/dfc/tutorial_js_grabcut.html)；[PyMatting 项目](https://github.com/pymatting/pymatting)；[PyMatting metadata](https://github.com/pymatting/pymatting/blob/master/pyproject.toml)；[多图 matting 论文摘要](https://openaccess.thecvf.com/content_cvpr_2017/html/Dekel_On_the_Effectiveness_CVPR_2017_paper.html)。部署成本是本记录针对 TypeScript 桌面应用的工程推论，未做运行验证；版本不是安装要求，`master` 仍可漂移。

许可核查（HIGH）：OpenCV `4.12.0` 根 LICENSE 为 Apache-2.0，PyMatting 为 MIT。复用时保留对应许可与归属，实际 distribution 的第三方依赖仍需逐项核验；论文可阅读不等于关联代码获开源许可。本轮没有完成完整依赖安全审计。[OpenCV LICENSE](https://github.com/opencv/opencv/blob/4.12.0/LICENSE)；[PyMatting LICENSE](https://github.com/pymatting/pymatting/blob/master/LICENSE.md)

## Recommended Approach

**当前先保持 unresolved；只有输入证据足够时，才值得接入成熟候选分割器（MEDIUM，针对当前约束的建议）。** 单靠换优化器不能补足贴纸与同色静态背景之间缺失的证据。

1. 在现有 canonical mask owner 内区分 `sure foreground`、`sure background` 与 `unknown`。时间稳定性只作为候选特征；不能自动授予前景身份。所有不确定阴影、抗锯齿和被截断边界保留 unknown；若无法建立可信 seeds，停止该角落。
2. 若当前证据已能提供 seeds，可复用 OpenCV 的 `GC_INIT_WITH_MASK` 作为有界候选 proposer。不能把 ROI 外围一圈、GrabCut background、或同一候选的 erosion 当独立 truth。OpenCV.js 是待验证的产品部署选项，本机 Python OpenCV 不构成部署授权。
3. 对软区域仅在 trimap 约束可信、目标 runtime 可承载成熟 matting 实现时再讨论 matting；不能把阈值化 alpha 的结果当完整 support 上界。经典 matting 输出点估计，本次来源没有给出本场景每像素真值的保守置信上界。
4. 保持候选与独立验收分离。独立 known-alpha fixture 可验证算法是否漏阴影，但不证明真实视频真值；真实 source-bound 像素证据与现有 coverage/H4 gates 仍由原 owner 决定。候选之间一致、重建残差小、bbox 一致都不足以授准入。

这里提出的是可验证的窄边界，不是执行授权或已证明有效的组合。没有依据推荐把自写 graph-cut、闭式稀疏求解器或多帧 alpha 管线直接塞入 TypeScript；也没有依据降低 coverage/H4 或加入白矩形 fallback。

## Verification Needed Before Any Integration

以下仅列未来判别性验证，本轮均未执行：

- 独立 alpha fixture：稳定贴纸核心 + 动态背景上宽半透明阴影 + 与核心相接的静态背景；阴影延伸超过原膨胀半径。结果必须完整包含规定真值 support 或明确 unresolved。
- 同色/无边界、ROI 截断、物理画布裁边、无不透明核心、压缩导致软边不可辨识：验证错误 seed 不会被提升成可信像素事实；不以压缩噪声作为全部前景。
- 分别衡量漏掉真实贴纸/阴影和吞入背景/人物；不能仅按面积或 bbox 得分选择候选。指标与门槛沿用项目 owner，不在此发明新验收标准。
- 固定输入 bytes、坐标系、帧序号与候选参数；在实际 Windows/Linux runtime 验证有界资源、取消行为与 frozen artifact 一致性。研究库运行成功不代替这一步。

## Research Verification And Limits

共使用六条搜索查询；最终结论集中于七个 primary-source 文档/源码页面。官方 OpenCV `4.x` 页面会重定向到 `4.13.0`，因此另查了明确的 `4.12.0` API 页面。PyMatting 许可和依赖直接读取源码；Levin 2006 论文全文读取于 JHU 托管的原论文 PDF。作者站点 PDF 和 CVF watermark PDF 抓取失败，后者仅据官方摘要，不推断其未读的实现细节。

本记录未核验 business code、实际 mask、真实素材效果、runtime availability、性能、安全漏洞或完整部署许可。没有证据支持从任意 RGB 唯一恢复真实 alpha，也没有独立证据可将当前 unresolved 角落变为 approved。

## Parent Investigation And Candidate Qualification

以下为 research 完成后 Parent 的本机调查，与上方文献研究分开。没有引入产品依赖或改业务源码。当前源码核对确认：原 extractor 按时间稳定性做连通分量，无法分离贴纸与相接的静态背景；H3 对 extent 未解继续拒绝。既有修复计划和安全边界见 [Candidate Handoff Repair](../superpowers/plans/2026-10-06-hybrid-candidate-handoff-repair.md)。

- 原素材 4/5 的首帧 PNG SHA 相同：`646fab1cfee5d439000bbfbc77091352f6109c72a9108169520e26a69e28fd7f`。OpenCV `4.12.0`、seed=1、单线程、5 次迭代的 rectangle 候选在素材 4 上得到 TL 8038、TR 6694 个像素。这只是离线候选，矩形外的 hard background 假设未经源证据确认。
- 不用 hard background、仅以 probable labels 初始化时，TR 候选增至 9618 像素，横跨整个 230px crop 并触及内部 ROI 边界；这种结果不能直接批准。候选图像人工查看不是 H4，首帧观察也不是全时域验证。
- 对已扫描的 85 张 bundled downloaded 和 79 张 uploaded PNG 制作联系图并逐图检查，未找到与原片相同的“热卖”和“买买买”图案。未声称穷尽其他目录或证明用户没有原始资产。
- 受管 Kimi 调查 `b8bcfe56-e049-4aa0-9797-72913c15f476` 完整返回；5 次请求的 observed model 为 `k3`、effort=`max` 且身份核验通过。该调用是设计调查，不能替代实现 review 或产品准入。其建议以两个 GrabCut 初始化共同判 BG 作为部分背景证据，Parent 未采纳此准入依据：一致结果仍可能共同漏阴影。

为直接检验这个缺口，Parent 先冻结 8 个 construction cases，再执行固定参数诊断：128×96 画布、14×14 不透明核心、30×30 总 alpha support（包括 8px 宽阴影）、alpha=0.01/0.1、flat/checker/gradient/texture 四类背景。初始化 rectangle 为 `(20,10,54,54)`，完整包住全部真值及额外 12px 边距；因此失败不能归因于 rectangle 切掉阴影。每个 case 的 input/truth SHA 在调用 segmentation 之前落盘，真值来自构造 alpha，未从候选 mask 反推。

| Background | Independent required pixels | Rectangle candidate | Probable-mask candidate | Union missed required pixels |
|---|---:|---:|---:|---:|
| flat（两档 alpha） | 900 | 900 | 12288，整幅画布 | 0，但 probable 候选不可用 |
| checker（两档 alpha） | 900 | 900 | 900 | 0，仅此构造例吻合 |
| gradient（两档 alpha） | 900 | 196 | 196 | 704 |
| texture（两档 alpha） | 900 | 196 | 196 | 704 |

gradient/texture 四例的两个初始化输出完全一致，却漏掉全部 704 个阴影像素；取并集仍漏。此结果否决直接采用当前 GrabCut 候选或以双初始化一致性证明背景的方案，不证明所有未来算法都不可行。没有据此缩减真值、扩大固定 margin、调参挑例或降低 coverage/H4。superset-unknown 的方向本身不等于有可信 sure-background 判据；缺少该判据时不能把不确定像素删掉后宣称完整。

私有诊断文件保存在 repository 外 `jianji-hybrid-repair-20261006` 运行目录，未作为正式源码提交：`grabcut-independent-qualification.py`、对应 `-plan.json` 和结果 `.json`。plan SHA 为 `a502638a31d0ceb02aea2f94dac39543d9c36f0283bcc6d1071a61721f2f7ab0`，结果 SHA 为 `0b7fcf937d4449e05b89fbb9d3d753ed0777b86b4a32c6d0da363470d60bbdde`。本机命令为该目录下的 `python grabcut-independent-qualification.py`；依赖当前诊断环境中的 OpenCV/NumPy，不是产品命令或可移植 Harness。

当前结论：该候选分割修复未通过独立回归资格，不进入 H3。原素材 4/5 的 TL/TR 仍为 `MASK_UNAVAILABLE`，真实 H4、新导出和人工整片验收均未完成。源绑定的原始贴纸 alpha/制作工程或独立边界证据是可以继续验证的输入；拿到原始 PNG 也仍需核对源片中的摆放与缩放，不能直接授生产 authority。原 coverage/H4、motion、shape/placement、冻结生产和 partial corner 行为保持原代码。
