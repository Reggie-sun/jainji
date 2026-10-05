# Hybrid H1 Development Record

## Scope and Architecture

2026-10-05，执行 [Hybrid V1 Delta](shape-matched-cover-hybrid-v1-spec.md) 的H1；[H1–H4 plan](superpowers/plans/2026-10-05-shape-cover-hybrid-v1.md)。CV只提候选；VLM负责overlay分类/grouping与预览语义；算法独占mask、时间边界、fully opaque 100% coverage和renderer。H1没有target publication或自动导出接线。

旧confirmed-target-static v1/v2、geometry v1/v2和HC2–HC5记录保留为HIGH_ASSURANCE_RESEARCH / NOT_HYBRID_V1_CRITICAL_PATH。未实现geometry/proof v3，未改旧M3 strict consumer、activation或guard，PRODUCT_DISABLED。未读取210 holdout。

## Provider Audit and User Correction

当前应用ChatGPT catalog中的gpt-5.6-luna、gpt-5.6-sol均声明text/image；最初要求的gpt-6-luna/gpt-6.1-sol未在catalog出现。用户根据UI与audit明确授权Hybrid使用当前5.6两条路线，未自动替换。两者后续同包真实调用成功，连接可用与exact model可用分别记录。

H2核查补充：原始会话 `01a10b87-61f2-7da2-ab53-4b51c798e728` 的user message（原rollout第1131行）对exact GPT路线问题明确答复“使用当前可用的 gpt-5.6-luna / gpt-5.6-sol”。这是实际授权证据，不是从catalog推定。H2再次只读catalog仍缺原指定GPT6型号，详见[H2 record](shape-matched-cover-hybrid-h2-record.md)。

MiniMax来自当前应用ConnectionStore，exact model MiniMax-M3，official api.minimaxi.com，Responses协议。官方模型说明确认native multimodality：[MiniMax M3](https://www.minimax.io/models/text/m3)。catalog只有model ID而没有image modalities，不能以catalog或文字连接测试冒充图片能力；实际三色PNG探测返回red/green/blue，随后真实candidate packet成功。

复用AgentProvider、ModelConnections.reviewProvider、现有ChatGPT schema与API transport/scheduler；未复制HTTP client、key store或模型catalog。临时role providers不修改用户持久模型选择。受管Kimi deep只读审计已核对12个provider/image/request owners，canonical invocation 10d8e1ca-e506-4964-aac0-3d87f45d921d，3个engineering wire requests。Parent拒绝将其JPEG-only猜测应用于实际可用PNG codec，也未按建议切换已验证的Responses协议。

## Contracts

每packet最多3个components、12张PNG、8MiB/image、32MiB总图片；candidate必须有context及各component首中尾crop。真实builder读取16–32个M1观察点（短片全部），实际M1重放校验ID，PNG与原RGBA/crop/ordinal/PTS/sourceKey绑定。无local path/filename/account/key进入模型消息；metadata和图片字符串脱离caller mutable buffers，前后复核源。

candidate严格JSON为packetDigest、逐ID decision/class/temporalState/riskFlags/shortReason、groups与undetectedOverlaySuspected。group只允许已提供且CONFIRM的ID，一一覆盖；false/UNCERTAIN分组仍不获自动处理资格。preview严格回答oldOverlayResidual、unintendedOcclusion、unnaturalPlacement、temporalMismatch四项PASS/FAIL/UNKNOWN。confidence可记录但不授安全，未知字段、编造ID、遗漏/重复分组、错误packet与free-form输出拒绝。

Luna batch first pass；UNKNOWN、风险或复杂分组升Sol；明确motion/额外未检测overlay不能被后续投票抹去。MiniMax独立preview，FAIL/UNKNOWN最多一次Sol二审；高风险明确FAIL不能被Sol PASS覆盖。每source session Luna1/Sol2/MiniMax1共享计数；错误不fallback、不自动semantic retry，取消/timeout消耗已发调用。receipt保存provider/model、image SHA、packet、prompt/version、structured output、安全failure code与timestamp；当前transport未公开provider request ID，记录null。

## Development Diagnostic

授权233s源，24观察点，发送1个CANDIDATE、6张首中尾context/crop，packetDigest e75dede308e306a6034b3a41a2778eee0371cb425168d3bcb8c244620594f90b。H2复核发现原record把“发送1个”误写成“M1只有1个”；原development-diagnostic.json实际记录8个CANDIDATE，原脚本按stablePixels选最大组件。H2同sourceKey重放为8个CANDIDATE、36个UNKNOWN；历史请求仍仅单候选，不能证明完整candidate-set语义。

| Route | Exact Model | Structured Result |
| --- | --- | --- |
| Luna | gpt-5.6-luna | CONFIRM / OVERLAY_LOGO / STABLE；singleton group |
| Sol | gpt-5.6-sol | CONFIRM / OVERLAY_LOGO / STABLE；singleton group；undetectedOverlaySuspected=true |
| MiniMax | MiniMax-M3 | CONFIRM / OVERLAY_LOGO / STABLE；singleton group |

这只是相同candidate packet的小规模开发comparison，不是三票准入，也未运行rendered preview QA。Sol额外疑似overlay必须fail closed；不能让模型凭空创建mask。单例未证明复杂grouping、商品字/字幕false-cover或最终自然度，留H2–H4验证；不能据此声称Sol hard-case提升或MiniMax最终QA效果已验收。

本H1实际visual provider调用6次：3次candidate comparison（每route一次）及3次MiniMax capability probes。初始化排查时重复了两次probe，计数保留，停止后复用成功的能力证据；无semantic response retry。最初real discovery使用不同FFprobe缺少strict clock字段，复用HC3已验证engine后成功，未改extractor/clock规则。engineering Kimi请求另计3次，不混作产品vision请求。

## Verification and Boundaries

focused suite 142/142 PASS，含strict parsing、UNKNOWN、ID/group、unavailable、escalation、preview conflict、图片budget/无path、取消/timeout/stale，以及现有provider/router regressions。真实FFmpeg controlled M1 packet测试校验解码crop逐像素一致、确定性digest、未知ID、取消和source generation drift。typecheck PASS。

Harness按本轮owned paths运行，receipt为最终交付证据，不沿用旧HC4已中断receipt。AOCI本轮6个indexed对象通过完整机器批次维护；Verify/Check/Guide与owned controls分别核验。foreign Qianchuan/renderer改动保留，不计作本slice实现。strict旧代码、proof/store、mask extractor、queue及产品关闭边界不变。下一slice只做H2 candidate semantic confirmation/grouping。
