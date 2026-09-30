# Stationary Shape Cover Engineering Contract

## Goal and Authorization

2026-10-01 用户明确排除移动贴纸，要求执行静态及位置固定的动画贴纸方向。当前范围是完整帧轮廓并集、固定遮盖和真实本地导出验证；不启用产品，不转移或重写 M5-D2A 资格状态。

## Current and Target Behavior

[V1](shape-matched-cover-spec.md) 的 `static-binary-v1` 仍要求静态源审核。动画变化不能直接写入该格式。本次新增非权威 `stationary-union/v1` 工程证据：目标每个原始帧的源空间二值轮廓按同一画布 OR 合并，输出一层不移动的保守轮廓。后出现、单帧扩大、闪烁及非对称变形均计入并集；不以 bbox 中心漂移代替动画锚点判断。

## Input and Evidence Contract

- 只消费 canonical D1 的活跃 owned D2 evidence；保留精确 source identity、census digest、ordinal、原 PTS/endPTS、RGBA SHA。连续 `[startFrame,endFrame)` 范围逐帧读取，没有采样、插值或跳过。
- 每帧候选严格绑定 targetId、ordinal、PTS/endPTS、pixel SHA 和相同的整数 anchor；状态只能为 VISIBLE（有效非空 bitpack）或 NOT_VISIBLE（该目标显式未出现）。UNKNOWN、漏项、错位、损坏、动态 anchor、moving/unresolved motion 一律 UNSAFE。NOT_VISIBLE 不是全画布 EMPTY 或 no-sticker 证明。
- motion 和 mask 都是 caller declaration，完整枚举仅证明消费完整，不证明语义正确。receipt 固定 `authority=none`、`eligible=false`、semantic/motion/mask review `NOT_EVALUATED`，不得生成人工 review 字段、发布知识、签发 admission 或 production PASS。
- 按现有 mask 编码和 512×512/262144 位边界计算并集；逐帧原候选及完整来源绑定保留在 receipt，digest 覆盖全部记录，不能只留 aggregate hash。receipt≤64MiB、wall≤D1的600秒，超出拒绝而非截断；这些是技术资源边界，不是付费/token预算。源或引擎变化、取消、证据关闭均拒绝。返回栅格由私有副本读取，不能靠 JSON 克隆恢复 ownership。
- `static` 候选的所有可见帧必须提供相同的有效 mask；轮廓变化须显式走 `stationary-animation`。这只校验声明内部一致，不签发静态/不移动语义资格。

## Geometry and Output Contract

并集复用 `projectSourceMask`、`evaluateShapeCover`、真实 FFmpeg alpha 和 PNG 往返校验；原有限扩张、面积、跨度、100% coverage 门槛不变。新贴纸仍为静态的有效本地素材。冻结 PNG 不随原动画移动或缩放，不回退矩形。并集过大或无安全贴纸则明确拒绝。自然度与主体安全仍需真实独立模型及成片审阅，几何结果不得代替。

## Compatibility and Exit

human collector/method/schema/receipt、旧静态 mask、manual/assisted、源身份/知识/准入/队列 owners 和已冻结任务保持原行为。不增加产品 IPC/UI 或 issuer；PRODUCT_DISABLED，M5-B/C/D3/D4/verified-no-sticker issuance BLOCKED。独立新 holdout、18类场景和 A/B/joint 硬门保持原合同；缩小产品目标不降低资格标准。

工程退出证据：否定测试、fresh typecheck/相关回归、实际完整解码与本地导出逐帧覆盖、帧时域和音频核对、Parent diff/Risk Gate、AOCI维护和 scoped commit。受控动画合成样片单列，不作为真实用户媒体或 AI 资格。实际 MiniMax 视觉 probe 的历史 NOT_QUALIFIED 与 GPT 模型权限缺口不被本工程修复冒充解决。

## Self-Review

已按当前源码 owners 核对；完整来源记录独立于 static mask 的512个 evidenceIds，不扩张知识 schema。固定 anchor 声明不能证明真正不移动，故不给语义准入；实际生产仍由原 owner 拒绝。用户的执行授权覆盖该工程增量，未授权的新生产阶段不进入。

## Real Source Diagnostic Extension — 2026-10-01

用户继续要求“真实测试”。新增诊断必须直接使用用户原始视频中的旧目标，不注入、移动或替换待遮目标。对原文件收集 canonical 完整 census，再读取已知两个片段的每一个原始 ordinal；保留原 source/PTS/RGBA 绑定。既有 temporal 候选 mask 只能作为显式未审核的静态几何输入，逐帧复用不等于逐帧语义识别、动画来源或新 holdout。真实输出使用有效上传贴纸及同一冻结 PNG，核对全部输出帧、时间和音频，生成实际播放及边缘观察材料。没有真正的 stationary-animation 原片时该层保持 NOT_EVALUATED；模型路线不能满足时真实 AI 请求保持零且报告 gate，而不是模拟模型输出。Self-Review：本次只扩展本地真实媒体诊断，原语义、知识、准入与产品禁止项不变。
