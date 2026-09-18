# Cover Pipeline Failure Research

## Scope

调查代码基线 `9daf177`，复盘 2026-09-18 22:13–22:28（UTC+08:00）两条滴耳康素材的真实制作。只读调查生产逻辑、抽查原图和已保存样片、运行本地诊断；本次未重新调用模型、修改配置或实现代码。使用 `research` 的独立官方资料调查与主线程代码/运行证据核对。

## Conclusion

**不是单一模型接口故障。直接终止点是样片视觉复核未通过；定框与修订没有收敛。速度问题另有确定的本地原因：样片仍串行，且每次修订全片重渲染再抽帧。**

上一轮“两个项目同时显示渲染中，因此样片渲染并行”的判断需要纠正：只有逐素材分析流程的重叠已被状态记录证明，不能据此证明底层渲染并行。

## Runtime Evidence

源文件后缀 `.354.mp4`、`.375.mp4`，时长均约 58.7 秒、720×1280。视觉 MiniMax-M3、创作 gpt-5.6-luna、主管 gpt-5.6-sol。两条均失败，正式导出 0/2，总耗时 900.95 秒。

| Item | 终止时间 | 主管最终报告 | 检查 / 有效修订 |
| --- | --- | --- | --- |
| `.354` | 22:18:35 左右，约 329 秒 | 右下白色底块过大，遮挡底部免责声明 | 3 / 2 |
| `.375` | 22:28:05 左右，约 899 秒 | 4.5 秒闪光尾迹漏盖；44.1、58.7 秒右下误遮免责声明 | 4 / 2 |

来源：本机临时证据 `/tmp/jianji-two-real-test-20260918/report.json`、`result.md`。状态每约 5 秒采样，阶段时间只能近似归因，不是 provider/FFmpeg 的精确 span。

`.375` 的阶段耗时：

| 阶段 | 约耗时 | 解释 |
| --- | --- | --- |
| 制作开始至首轮样片阶段 | 72 秒 | 身份、取帧、定框、选材、创作等合计，状态不足以继续精分 |
| 三次“正在渲染主管检查样片” | 384 秒 | 约 85 + 151 + 149 秒；包括队列等待、全片渲染、文件验证和配对取证 |
| 四次“主管检查真实样片” | 432 秒 | 约 93 + 142 + 156 + 40 秒；不能拆成网络、服务排队与推理耗时 |
| 额外补证据 | 11 秒 | 第一轮主管后额外取证 |

已查看原图 6 秒，以及 4.5、44.1、58.65 秒联系图：右上闪光尾迹较细，右下装饰紧邻底部免责声明。已查看保存样片 2/6 秒和修订 1 的 6 秒图：初版有宽白条，修订后该时刻白条消失、底部小字可见。这证明修订曾改变有效画面，不证明全片或最终修订通过。图片位于同一临时目录，可能随系统临时文件清理失效。

## Confirmed Local Findings

### 1. Preview Scheduling Is Still Serial

[`ExportQueue.renderPreview`](../src/main/queue.ts) 第 113 行在 `activeTasks.size || pendingStarts.size` 时等待；每个 preview 自己也被放入 `activeTasks`。逐源分析并发没有改变这一层的准入规则。

本地受控探针同时调用两次真实 `renderPreview` 方法，配置 `exports=6`，仅替换 compiler、FFmpeg 命令和 verifier 为可控桩：命令在途峰值仍为 **1**，第二个在第一个结束后启动。没有生成假正式输出。临时探针 `/tmp/jianji-cover-diagnostic.ts`，结果 `/tmp/jianji-cover-diagnostic-o9TIMK/result.json`。这证明调度行为，不是 GPU 性能测试。

### 2. Preview Work Is Full-Length And Expensive

[`supervised-preview.ts`](../src/main/supervised-preview.ts) 第 112–116、214 行：每次有效修订清除 preview，然后调用 render 并重新抽取检查帧。[`queue.ts`](../src/main/queue.ts) 第 108–160 行调用原 compiler；[`compiler.ts`](../src/main/compiler.ts) 输出 `-t durationSeconds`，没有仅渲染检查片段的路径。

[`SupervisorEvidence.image/inspect`](../src/main/supervisor-evidence.ts) 第 156–163、181–216 行：逐张启动 FFmpeg，以 `select(eq(n,index))` 从头解码；原图和成片顺序取图，另有完整帧时间扫描及身份核对。对 `.375` 原素材的 8 个实际检查时间单独执行 `inspect`，真实 FFmpeg 耗时 **5.775 秒**。该探针只测原图，不含样片，不能将它外推为历史每轮 150 秒的根因；它证明重复取证有成本，历史耗时仍需分段计时才能精分。

### 3. Proposal Omits The Opaque Footprint Contract

[`cover-sticker.ts`](../src/main/cover-sticker.ts) 第 104 行给新覆盖层设置 `opaqueBackground: true`；[`compiler.ts`](../src/main/compiler.ts) 的 cover 分支用白底填满矩形并等比放入图案。宽框将产生宽白底，而不只是扩大可见图案。

但 [`cover-placement-provider.ts`](../src/main/cover-placement-provider.ts) 的初始定框输入没有明确告知“整个框是不透明白底”；只提供原图、时间、反馈和 rectangleContract。主管虽看得到真实样片，但 [`supervisorLayerProjection`](../src/main/supervised-preview.ts) 第 76–80 行也未传递 opaqueBackground。**这是确定的信息缺口；是否直接诱发本轮具体大框，因原始 proposal 未保留而尚不能证明。**

### 4. Revision Checks Change, Not Improvement

近似覆盖主管被要求返回全部 tracks，历史问题通过 reason/history 保留；该流程没有结构化的目标轮廓、字幕保护区或局部修补合同。[`cover-placement-provider.ts`](../src/main/cover-placement-provider.ts) 第 4 行；[`supervised-preview.ts`](../src/main/supervised-preview.ts) 第 188–214 行。

本地能验证 schema、时序、边界、用户文字不被改写、画面确有变化，然后重新请主管看图；不能据此证明漏盖/误遮比上一版减少。现有 `no-visible-change` 防护不是质量评分。全量轨迹重写允许无关目标同时变化，存在修一处坏另一处的风险，但没有本轮逐版轨迹，不能声称已经定位到某个具体坐标回归。

### 5. Evidence Is Sparse And Extra Checkpoints Are Not Replayed Automatically

[`cover-placement-proposal.ts`](../src/main/cover-placement-proposal.ts) 初始全片只取 12 帧，该片相邻约 5.34 秒；主管默认取 8 对帧。`.375` 第一轮主管实际请求了补证据，指出 21.366–26.7 秒、32.033–37.4 秒缺实际画面、后段顶部贴纸移动，说明默认证据不足不是纯假设。

有效修订后 evidence 清空，下一轮重新使用固定 sampleTimes，不自动重放此前 inspect 的时间/crop。历史文字仍在，旧样片不能复用是正确的，但已发现问题对应的新样片证据需要重新请求。这会增加检查成本和遗漏风险。最终报告的 4.5/44.1/58.7 秒本来就在默认检查时间附近，故**不能把本轮最终失败全部归因于未采到失败帧**。

## External Research

- OpenAI 官方文档列出精确空间定位、小文字和图像缩放方面的视觉限制。它支持“看见问题不等于能准确输出修复框”，不能证明本轮任一具体模型能力不合格。[Images and vision — Limitations](https://developers.openai.com/api/docs/guides/images-vision#limitations)
- Google 官方视频文档提示固定 1 FPS 对快速动作可能丢细节。本项目约 5.34 秒的初始间隔更应验证短时尾迹，但不能从不同模型文档直接推算错误率或得出换模型结论。[Video understanding — Technical details](https://ai.google.dev/gemini-api/docs/video-understanding#technical-details)
- 一项 VLM bounding-box 自修正研究发现，其受测方法的“过程中出现更好框”并不代表无真值停止规则能选中它。这只是该研究的实验，不是多 Agent 必然失败的定理；不应默认增加轮数就会收敛。[Iterative Visual Thinking and the Self-Correction Mirage in VLM Grounding, v2](https://arxiv.org/abs/2606.13156v2)
- 专用定位/传播存在成熟先例，但透明粒子和贴纸/字幕分离仍需样本验证，不能据此立即增加依赖或宣称替换可用。[Grounding DINO](https://arxiv.org/abs/2303.05499)、[SAM 2](https://github.com/facebookresearch/sam2)

## Unresolved Attribution

ChatGPT 请求是 ephemeral，协议流不记日志；失败 placement 的 review 结果不会返回完整 history/tracks，预览和证据在 finally 清理。来源：[`chatgpt-session.ts`](../src/main/chatgpt-session.ts) 第 178 行、[`codex-rpc.ts`](../src/main/codex-rpc.ts) 第 13 行、[`cover-placement-session.ts`](../src/main/cover-placement-session.ts)、[`agent-controller.ts`](../src/main/agent-controller.ts) 第 225–234 行。

因此本轮不能逐数值比较初版与两次修订，不能核验最后一版在全部失败时刻是否被主管正确拒绝，也不能判定“主管过严”“MiniMax 不行”“FFmpeg 把正确框渲错”。现有证据足够确认前述本地机制及一次真实未收敛结果，不足以给所有错误下单一根因结论。

## Recommended Next Step

1. 优先补齐受限诊断证据：每轮 tracks、模板几何、检查时间/裁剪、脱敏 verdict，以及排队/渲染/抽帧/provider 分段计时。无需保存账户、路径提示或凭据，也不等于建立源知识库。
2. 用失败时刻检查矩形可行性：需盖区域为 T、必须保留文字为 P，是否存在矩形 R 同时满足 T 被包含且 R 不碰 P。当前只确认区域相邻，未证明无解；若无解，不能靠持续放大缩小解决，须明确产品取舍。
3. 在同一批失败检查帧离线评估：明确白底作用范围、固定未受影响目标、保留补充检查点，对比修订前后漏盖/误遮。再决定是否需要更专门的定位工具；不先加次数、放宽门禁或换模型。
4. 性能单独处理：在原 queue owner 内按资源预算调度 preview；研究只渲染必要验证片段/帧与复用源取证。必须保持源/成片时间绑定、实际 renderer 一致性，不能用不等价静态合成冒充正式效果。

## Verification

- `npm test -- tests/cover-review-preview.integration.test.ts tests/cover-placement-concurrency.test.ts`：2 files、8 tests passed。前者验证真实 FFmpeg preview 路径，后者验证 runner 并发；不代表视觉质量通过。
- 受控调度探针：两 preview、exports=6，在途峰值 1。
- 真实源素材 8 帧取证：5.775 秒；无新增模型调用。
- 已实际查看原图联系帧与前一轮保存的样片截图。最终修订样片已清理，未假装复查。
- 本次只新增研究文档，不改实现或生产配置；临时诊断产物不进入项目历史或正式导出。
