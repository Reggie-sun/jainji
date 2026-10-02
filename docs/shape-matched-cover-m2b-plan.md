# M2-B Static Range / Anomaly Classification Plan

## Goal and Scope

依据 [course-correction](shape-matched-cover-v1-simplification-spec.md)、[M2-A plan](shape-matched-cover-m2a-plan.md) 和 [Stationary record](shape-matched-cover-stationary-record.md)，解释完整 `[0,6990)` 中133个异常帧。Native Codex负责执行和裁决；`superpowers:writing-plans`仅保存本计划，不接管lifecycle。

冻结M1/M2-A源码、配置和原receipt。`originalPixelTolerance=24`及其他参数不变；不改mask，不删除异常，不自动缩承诺范围，不推进M3、mask qualification或产品入口。既有INCOMPLETE、缺独立required-pixel truth及PRODUCT_DISABLED保持。

## Ownership and Contracts

新增 `scripts/shape-cover-static-anomalies.py`：仅离线只读诊断，复现冻结support/min-max和mask字节，核对原6990帧ROI SHA与PTS，输出逐异常源坐标/通道/差值、时间连续段、前后帧联系图、空间热图及解释性观察。Python/OpenCV仅本机工程工具，不引入产品依赖或第二mask issuer；任何复现失配使本次分析失败。

新增 `tests/shape-cover-static-anomalies.test.py`：受控像素场景验证support复现、异常坐标、连续范围半开端点及未改变阈值；不将构造truth充当真实truth。更新原Stationary record保存实际观察、证据位置和限制。其他源码与共享dirty工作保留。

输入为既有M1源identity、M2-A evidence/confirmation/candidate/method freeze、同应用FFmpeg；JSON仅用于独立诊断的历史绑定校验，不恢复owner/许可。输出固定authority=none、eligible=false；区间仅为观察区间，不能称有效static范围或资格PASS。

## Major Milestones

1. 核对source SHA、引擎和冻结源码；流式解码原ROI，96代表帧重建support；生成mask bitpack与原候选逐字节相同，逐异常计数/worstDifference与原receipt相同。完整原帧hash及独立framehash pipe核对，包含首尾，不使用名义FPS补绑定。
2. 对所有异常输出每个超阈值像素、空间频率和原RGB轨迹，分组严格连续异常段及无异常补集。保存全部异常及前后至少1帧、原首中尾、support/mask/差分叠加联系图；检查最早、最强、最多像素和最后异常及全部异常段。区分直接观察与编码/背景/遮挡/位移/动画的因果假设，证据不足保留UNKNOWN。
3. 报告目标是否存在持续位置/形状变化的证据、异常是否集中边缘/内部、是否短暂恢复及原判据的可解释局限。无法独立确定alpha/required边缘时明确记录；不为全PASS调参或用分析结论覆盖旧REJECTED。

## Budgets and Verification

CPU-only，单次解码进程1，每次分析总时限5min，ROI最长边512、工作集512MiB、两次ROI流式解码，不持久全片RGBA；诊断输出上限256MiB。重复运行只用于fresh复现或诊断代码修复，不重新训练阈值；不读holdout、不调用产品模型。

运行Python受控tests、`npm run typecheck`及原static/activation相关tests，真实233秒全6990帧复现、全异常定位、联系图人工技术检查。冻结源码/源片/原receipt前后SHA核对；current verification-before-completion、AOCI逐对象scope及Verify/Check/Guide、最终diff与specific-files commit。

## Acceptance and Self-Review

133个异常逐帧可追溯、精确复现且有具体空间/时间证据；结论不超过像素观察， unresolved因果保留UNKNOWN。不给静态资格或范围许可，不修改原目标承诺；M2-B诊断可以完成而M2 qualification继续INCOMPLETE。所列文件与tests限定诊断职责，原source/extractor/qualification/production ownership保持。
