# M2-C Static Geometry Verification v2

## Goal and Scope

依据 [course-correction Spec](shape-matched-cover-v1-simplification-spec.md)、[Plan](shape-matched-cover-v1-simplification-plan.md)、[M2-A](shape-matched-cover-m2a-plan.md)、[M2-B](shape-matched-cover-m2b-plan.md) 与 [Stationary record](shape-matched-cover-stationary-record.md)，只回答已确认右上目标在完整 `[0,6990)` 是否有破坏静态假设的可复算几何证据。Native Codex 控制执行；`superpowers:writing-plans` 只保存本计划。

`RGB appearance stability != screen-coordinate geometric stationarity`。新方法 `cpu-static-geometry-development/v2` 与旧 RGB sample min/max 完全分开；不修改旧源码、tolerance=24、3395px mask、历史 receipt 或 qualification。旧 FULL_RANGE_STATIC_CONTRADICTION 永久保留。

## Ownership and Contracts

新增 `scripts/shape-cover-static-geometry.py`：独立纯 CPU development verifier，复用 M2-B 的 FFmpeg ROI / 双 pipe / SHA / PTS 解码绑定，只读历史 confirmation 和原帧凭据。NumPy/OpenCV 是本机开发工具，不新增产品依赖。输入不接受 mask 作为 required pixels 或几何模板；旧 mask 只核对历史摘要。

模型是确认粗 ROI 内的持久有向灰度梯度 landmarks；代表帧中梯度方向/强度的共识仅用于建立参考。完整时域逐帧与固定参考比较，归一化梯度相关与有限亚像素平移搜索衡量位置，分块局部对齐衡量形变，梯度丢失比例与强度比衡量消失/结构变化。亮度偏置和适度增益不应成为位移证据。无纹理、空间分布不足、边界不可搜索、重复纹理/相关歧义、搜索触边及不支持的观测明确 INCOMPLETE/UNKNOWN；不以零位移 tie-break 产生通过。

receipt 保存方法/参数/依赖版本/源码摘要、source/engine/原 receipt 摘要、参考坐标/梯度、全部 ordinal/PTS/endPTS/ROI SHA、逐帧 global/local metrics、异常严格连续区间、极值及旧133异常交叉表。输出始终 `authority=none / eligible=false / independentRequiredPixelTruth=MISSING / maskCompleteness=NOT_EVALUATED / PRODUCT_DISABLED`。无几何反证只能称 DEVELOPMENT_STATIC_GEOMETRY_SUPPORTED；不是 qualified motion、mask 或发布许可。

## Milestones and Verification

1. 用受控纹理目标建立可靠独立验证 seam。覆盖整数与亚像素平移、单帧/尾帧变化、局部形变、整体/局部消失、遮挡、周期歧义、无纹理、亮度/颜色变化、确定性和非法输入；不制作真实 required-pixel truth。先跑失败测试再实现。
2. 在读取真实全范围结果前冻结参数与实际源码。流式解码同原6990帧，包含首尾，不跨帧平滑或删除瞬时异常。用 fixed-reference 搜索避免逐帧漂移；完整保留 UNKNOWN/反例，不为通过修改参数。真实诊断重复只用于确定性复算、取消或代码缺陷纠正，保留旧失败。
3. 记录实际计时/RSS/工作集/scratch、真实范围结果和所有不足；核查旧 mask/receipt/source 未变，完成相关 Python tests、`npm run typecheck`、原 static/activation tests、current verification-before-completion、AOCI 按本轮对象核对与 Verify/Check/Guide、最终 diff 和限定 commit。

## Budgets and Boundaries

代表帧≤96，ROI最长边≤512，完整帧≤20000，单 decode 进程，每次运行≤5min，工作集≤512MiB，receipt/artifacts≤64MiB；不持久完整 RGBA spool，不读 holdout，不调用产品模型。方法选择与阈值以受控 development 冻结，真实运行后参数修订为0；无法建立可靠参考或证据则停止并记录 INCOMPLETE。

不做 independent required-pixel truth、mask 修订、M3、匹配、输出 coverage、visual safety、knowledge/schema/admission/store、assembler、guard 或产品入口；manual/assisted 和历史 frozen 解释不变。未参与 landmarks 的边缘/半透明贡献、精度以内位移及无纹理变化仍有盲点，必须报告，不能以几何观测代替后续独立 truth qualification。

## Self-Review

本轮是可复算几何 development 方法，不是把旧 RGB REJECTED 重命名为 PASS。身份确认、几何信号、mask 完整性、输出覆盖与生产准入分别成立；范围不缩、历史不重写。新 verifier 有唯一独立职责，不建新的 renderer、队列或 issuer。计划涵盖实现、反例、全范围真实证据与停点，没有额外用户批准步骤。
