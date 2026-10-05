# Jianji Repository Rules

## Authority And Routing

- 开发 Agent 修改前必须读取本文件。当前用户要求优先；与既有合同冲突时说明影响，不静默放宽。当前源码、schema 与运行证据为实现事实，历史 spec / record 不代表实现或验收。
- 简辑是 Windows / Linux 本地视频包装应用。按 concern 读取 [Contract Index](docs/agent-contract-index.md) 指向的唯一合同与 source owner；详细产品语义在 [Decoration Contract](docs/decoration-production-contract.md)，操作说明在 [README](README.md)。CLAUDE.md 只作入口指针。
- 用户使用 make frontend 时，沟通、修复和验收围绕该运行方式；仅在用户明确要求打包或发布时讨论安装包、重装或更新。

## Development Boundaries

- 所有问题都必须以软件层面的持久修复为目标，落实到既有 canonical owner 的通用行为，并以相关验证覆盖同类场景；不得仅靠临时脚本、手工环境调整、单次操作成功或当前样例通过就宣称修复完成。诊断和止血不代替产品能力交付；受外部条件或授权边界阻断时，必须明确软件已覆盖的范围和剩余阻断，不绕过既有安全约束。
- 覆盖任务围绕用户的实际覆盖效果收敛，复用已有 owner，只增加直接必要的工程与验证；测试、提交、局部样例或框架文档不代替功能交付。
- 覆盖开发调用的 GPT 型号固定为 gpt-6.1-sol 与 gpt-6-luna，未经用户变更不增加、替换或轮换；本地假服务、能力核验和真实执行同样适用，通用产品连接不因此新增型号 allowlist。
- 指定路线失败时保留实际请求和结果，报告具体阻断；不靠换型号、重复请求、固定方案或降低准入掩盖失败。

## Product Invariants

- 保留原视频顺序、时长、音频；默认按方向 720p、原帧率、等比补边而不裁剪。未获范围授权不加入拼接、转写、配音或新素材生成；重试沿用冻结设置。
- 展示文字可关闭。任一本轮素材开启时必须整批共用用户手填内容，由本地程序按逐素材开关/位置生成；Agent 不生成、提取、推测或改写。全关闭不要求文字、不生成文字层；共享 schema 在前端和制作入口独占校验，缺内容在模型调用前拒绝，旧模板保留原行为。
- 用户主动上传且已通过本地校验的贴纸自带图文是新增文字限制的明确例外，Agent 可原样选用而不能改写或代填展示文字。普通四角只允许安全贴纸，不借贴纸编造商品、品牌、价格或功效；覆盖专用选材例外及时段详见 Decoration Contract。
- 覆盖开关独立，单项目默认关闭、跨模板默认开启且可逐项关闭；自动模式忽略手动位置草稿。识别、近似覆盖方案、源事实与创作选款分开；有限主管修正和原队列真实样片仍不确定时失败，不回退手动框、固定方案或创作连接。
- local-random 在关闭覆盖或使用手动覆盖时不要求模型、不调用 API、不提取模型帧；同版本覆盖图案不同，池不足在导出前拒绝，冻结后重试不重选。四角各不相同的要求须核查实际冻结模板与真实样片。
- 四角覆盖优先占位、普通贴纸只补空缺角落/时段；中部覆盖不替代四角。文字时序、贴纸全程、旧透明/白底、旧 3 秒/新 5 秒与版本轮换解释由 Decoration Contract 独占，冻结任务不重算。
- 每素材版本独立导出；单项目条数按素材数向上取整，跨模板严格按 requestedCount 分配，历史导出不占本次容量。保留原队列并发；重试复用冻结方案/快照，不重新识别、换款、改轨迹或改文字。
- assisted 算法候选与人工决定分开，编辑作废旧预览/批准；全部版本冻结、动态预览并获明确用户确认后才幂等入原队列。独立复核只报告问题，退出保留草稿而不自动请求/提交；详见 [Assisted Contract](docs/semi-automatic-cover-review-spec.md)。
- shape 产品按 [Hybrid Activation Delta](docs/shape-matched-cover-hybrid-v1-spec.md#activation-accepted-product-delta) 处理四角静态贴纸：仅 H4 PASS 的同 frozen bytes/binding 角落沿原生产路径导出，unresolved/skipped 保持原样，不声明整片所有旧贴纸已处理。源、PNG、binding 与 coverage freshness 失效为 UNSAFE，无白矩形 fallback；完整 Activation gates 才授产品启用。旧 [Shape V1](docs/shape-matched-cover-spec.md) strict/proof 研究保持 PRODUCT_DISABLED，source-mask-only 不授输出准入；manual/assisted 与旧冻结解释保持原合同。

## Canonical Ownership And Safety

- 复用 Contract Index 的 canonical owners：共享 schema 准入、原制作生命周期、源知识 store、模板 compiler、原导出 queue 与 ArtifactVerifier；不建立第二套文字来源、模型选择器、队列、批准或任务生命周期。前端状态不代替主进程校验，预览与导出遵守同一冻结模板。
- 原视频不擦除改写；输出先写临时文件并验证，再无覆盖发布。不得覆盖源片/已有输出，失败产物不得标 completed。
- 模型只接收约定抽帧与创作上下文，不发送原视频、本地路径或凭据。Key 不进 renderer、项目、浏览器存储、日志或错误；ChatGPT 使用应用独立目录，不读写全局 Codex 登录。CC Switch 只读，OAuth token 不当 API Key，不回写外部库。
- 产品 Agent 只返回方案，不执行其工具、命令或权限请求；保持禁用工具及隔离会话。升级 Codex runtime 必须核验真实工具暴露；运行中不切换连接，取消/退出停止对应请求，重启不自动恢复未完成分析。测试不得擅用真实账号或额度。
- 已知源知识争议、完整性未知、非法/无效主管修订和 unknown outcome 均失败关闭；显式重新检查不清争议、不变 manual/assisted 草稿或绕过模型准入。[Source Knowledge](docs/source-sticker-knowledge-spec.md) 独占源事实复用合同。

## Verification And Completion

- 每次完成有仓库变更的任务，必须先完成相关验证，再 commit 本任务变更并 push 到当前分支的 upstream，核对远端 HEAD 后交付；无变更不制造空提交，遇到真实阻断须明确报告。
- 声称完成/修复/通过、commit 或 PR 前必须读取并执行 current runtime 的 verification-before-completion；证据须对应当前工作树/运行状态。行为变更做相关可执行验证，代码变更跑 typecheck 与受影响测试；非微小 UI 验证实际交互，构建/集成跑对应检查。
- [Harness Contract](docs/video-validation-harness-spec.md) 与 [policy](.agent/harness/policy.json) 独占检查路由、命令及回执。使用 owned scope 与对应 receipt 做 completion；unknown/unmapped、缺/旧证据、必需 skip 或 required=false 不能 PASS，声明 scope 不证明作者归属。验证器只读，不自动维护、请求模型或提交生产任务。
- 区分 schema/unit、假服务、真实模型、FFmpeg fixture、Windows 实机、平台行为及人工观看。自动帧/音轨/文件验证不证明整片 coverage、音频内容或视觉验收；“完成”只证明输出文件验证，最终画面与文案仍需播放确认。缺环境明确未评估。
- 交付检查最终 diff，保留其他会话改动，仅 stage/commit 本任务文件或对应 owned hunks，并报告内容、实际证据和限制；纯文档检查引用与语义，不制造无关测试/运行记录。

<!-- aoci:begin -->
## AOCI Cognition

- aoci.txt / aoci.meta.txt / aoci.code.txt 只是语义索引，不建立规则 owner。关系用 CodeGraph 核对，认知冲突时调查刷新，不静默用旧索引。
- 每次代码、测试、配置、文档或规则变更稳定后，产生变更的 session 必须逐项核对 AOCI role，直接维护 indexed 对象的 Entry / baseline；observe/exclude 按当前 scope 处理，不扩大索引。再次改动则重新维护，不能推给用户或其他 session，已对齐不重复写。
- 对应共享索引/基线维护已授权，按当前官方 Guide、完整机器批次、CAS、原子写入及有界恢复保留其他会话结果；不得截断批次或越权改业务文件。本轮对象逐项证明与全库治理分别报告，无关 drift 不免本轮维护；未知版本、恢复/冲突、工具不可用或真实 ownership 阻断须列明未维护对象和剩余工作，不假称对齐。
- 提交/交付/交接前完成官方 Verify、Check、Guide。正式索引及必要配置/基线可随对应源码提交，运行状态、缓存、日志和机器 MCP 配置不提交。
<!-- aoci:end -->
