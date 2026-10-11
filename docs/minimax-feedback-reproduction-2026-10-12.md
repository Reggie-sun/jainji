# MiniMax Feedback Reproduction

## Scope

处理 [GitHub #7](https://github.com/Reggie-sun/jainji/issues/7) 和 [GitHub #10](https://github.com/Reggie-sun/jainji/issues/10)。用户明确要求直接使用 MiniMax 复现。本轮使用应用现有 `minimax` 连接、`MiniMax-M3`、官方 `/v1/responses`；没有切换模型、修改保存的连接或提交制作队列。

复用已保存人工覆盖批次 `605859b6-ee71-4f30-b9a6-47a460a3c1e9` 中的真实失败素材、原生抽帧、166 项本地候选目录和实际候选图片。创作入口为 [AgentProvider.shortlist / plan](../src/main/agent-provider.ts)，传输 owner 为 [completeApi](../src/main/api-transport.ts)。每个独立请求只提交一次，验证代码变更时建立新的有限请求批次；服务错误或未知结果不重试。

旧批次的并发使用计数没有持久化，复现时计数为空；本轮不是原请求的字节级重放。素材、项目、凭据和图片仅留在本机，不提交到仓库。

## Reproduction Results

共 26 次真实请求：原代码 10 次、仅加强提示 8 次、开启推理 2 次、最终适配后其余三组 6 次。全部取得 HTTP 200；原始请求体（无认证头）、响应和逐请求哈希保存在本机临时证据目录。

| Historical case | Output index / version | Original code | Prompt-only change | Final evidence |
| --- | --- | --- | --- | --- |
| 空候选 | 12 / 5 | 初筛与方案通过，面积 2.56% | 通过，2.11% | 新真实调用通过，1.96% |
| 面积超限 | 19 / 4 | **复现：3.07%，本地拒绝** | **仍失败：3.24%** | 开启推理返回 2.13%；外层 JSON 围栏导致旧解析失败，最终代码重放该真实响应通过 |
| 重复候选 | 24 / 1 | 初筛与方案通过，2.26% | 通过，1.70% | 新真实调用通过，2.56% |
| 目录外 ID | 42 / 3 | 初筛与方案通过，2.56% | 通过，2.56% | 新真实调用通过，2.56% |

旧批次另两条空候选失败（index 101 / version 6、index 149 / version 6）各做一次原代码初筛，也均通过。**本轮 14 次初筛全部非空；没有新复现 #7、重复候选或目录外 ID，不能判为过时，也不能宣称已消除偶发返回。** 历史记录中的错误仍真实存在，但没有当时的原始响应，无法进一步区分 `[]`、缺字段或其他数组结构错误。

关键响应 SHA-256：

- 原代码面积超限：`09d51959aded299d782175ea746156c98282fd10510b81a6e419e6ef4c873b21`；width 为 `[0.09,0.09,0.08,0.09]`，平方和 `0.0307`。
- 仅加强提示仍超限：`298956c85a68e7b4d9ab9393266ebba1d9d94578d99581f4f472ce3b6d669f6e`；四项 width 均 `0.09`，平方和 `0.0324`。
- 开启推理的真实方案：`055daa90ac990380f0f438bb7be1c45fe391fe1c5a8b100924355ee3221fbbf2`；width 为 `[0.07,0.08,0.06,0.08]`，平方和 `0.0213`。捕获后通过最终原生传输与方案校验重放，零网络请求，没有改写任何业务值。

## Persistent Changes

1. 候选和方案复用原 `chatgptOutputSchema`，同时把它作为文本输出契约交给 API 模型；补充非空、编号去重、候选 ID 和面积平方和自检。明确重复限制针对 `corner`，同款 `sticker` 仍可复用。
2. 仅已验证的官方 `MiniMax-M3` Responses 结构化任务，在未指定档位时发送 `reasoning.effort=high`。用户显式档位（包括 `none`）优先，其他连接和非结构化任务仍保留原默认行为。
3. 同一适配范围只剥离完整响应最外层的 JSON / 无语言代码围栏，再交给原 JSON 解析和 schema / 本地规则校验。前后说明文字不提取，数值、ID、候选不修补；仍不合格则明确失败，不重试、不换模型。

四角面积门和单项 width 上限保持原值，允许合法的非等宽方案。不会靠固定款式、自动缩小、强取首项或放宽校验伪装模型成功。形状覆盖的显式停止和原生产生命周期保持原解释。

## Primary API Evidence

官方 [Responses 文档](https://platform.minimax.cn/docs/api-reference/responses-create) 和 [OpenAPI](https://platform.minimax.cn/docs/api-reference/text/api/openapi-responses.json) 声明：MiniMax-M3 的 Responses 默认关闭推理；非 `none` effort 开启推理，但不调节其深度。`text.format.type` 当前只记录 `text`，不能把 OpenAI 的 `json_schema` / `json_object` 当作该接口已有能力。

独立只读研究核对远端 OpenAPI HTTP 200，与本机下载字节一致，SHA-256 为 `7f1a88dcc6a5765cc5876f82150673f7f73e24f0b0c41403de013243156d013d`。真实开启推理响应也回报 `effort=high`。这支持接口适配选择，不能独立证明所有模型输出都合规；开启推理的请求输出 token 明显增加。

## Verification And Review

- Red-green：输出契约传输、默认推理和围栏适配的新断言先在旧实现失败，再在对应修复后通过。
- `tests/agent-provider.test.ts` 和 `tests/api-transport.test.ts`：112 tests PASS；覆盖 Responses 路径、真实不合格宽度模式、围栏内越界 ID / 面积继续拒绝、显式档位优先和其他连接保持默认。
- `npm run typecheck`：PASS。
- Scoped Harness 和只读 completion receipt 位于本机 `.agent/harness/runs/minimax-feedback-20261012/`，以实际 receipt 为准。
- AOCI 两个实现对象经官方完整批次维护，Verify / Check 对齐、Guide `complete=true / next_action=none`；测试和本记录为 observe。认知完整重载因宿主输出截断停止，本轮继续源码绑定调查，不声明完整系统认知通过。

受管 Kimi 只读审计 invocation `85dc7124-027f-46e9-8c13-afcd14a33680`，sealed `deep` route、3 次上游请求、实际读取五个限定文件，canonical receipt 为 `PARSED`，parent 独立裁决：F1 的 prompt-only 能力事实采纳，直接套用强制 JSON Schema 的建议由官方契约否决；F3 真实数学失败采纳，统一降低 width 上限的建议否决（合法非等宽方案仍允许）；F6 补齐 Responses 测试。F2 的未完成响应诊断、F4 的形状停止文案、F5 的潜在目录预览不一致均无本轮复现证据，未扩大修复范围。

Stable candidate：base commit `707655946f36039849578d4622d513f4315893f2`；provider SHA-256 `1565e2cefd58849a6ac869f076ce19946d1c74d742d8a818b9666d5f36a853ab`，transport SHA-256 `543ef524ad1aefb6d859268be66bf80fa9042dc3180cf79b9d9ddfb7e8d40800`。Written Spec / Plan：not applicable，本轮是原 owner 的有界 bug 修复。

Implementation Review Risk Gate：`KIMI_REVIEW_NOT_REQUIRED`。用户未要求该 snapshot 的独立审查；变更不增加凭据暴露、跨项目权限或持久状态写入路径；不合格输出仍失败关闭。剩余风险是模型随机不服从和有限样本的覆盖范围，已通过原生拒绝测试、真实调用和真实响应重放检查；该后果不达到 critical consequence，也没有同时满足重大后果与可由额外 reviewer 消除的验证缺口。调查报告不冒充 final review。

## Acceptance Limits

本轮验证创作请求、真实返回和方案准入；没有重新导出用户视频、改变原人工覆盖图层、提交平台上传或做 Windows 实机验证。没有逐片播放，因此不声明整片覆盖效果、音频或人工视觉验收。#7 保留未复现状态；#10 的面积与新发现的围栏解析问题已有直接证据及软件适配，有限成功样本不保证未来每次返回合格。没有向 GitHub 评论或关闭 issue。
