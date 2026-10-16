# Jianji Repository Rules

## Authority And Routing

- 修改前读取本文件，按 [Contract Index](docs/agent-contract-index.md) 查阅相关唯一合同与 source owner；当前用户要求优先，合同冲突须说明，事实以当前源码、schema 与运行证据为准。
- 简辑是 Windows / Linux 本地视频包装应用；使用 `make frontend` 时围绕该运行方式修复与验收，打包发布仅按用户要求执行，操作说明归 [README](README.md)。

## Development Boundaries

- 围绕用户实际效果，在既有 owner 实现可验证的通用、持久修复；临时止血、样例成功、测试或文档不能代替产品交付，外部阻断须如实说明。
- 覆盖开发仅使用 `gpt-6.1-sol` 与 `gpt-6-luna`，假服务、能力核验与真实执行同样适用；未经用户变更不得换型或轮换，也不据此限制通用产品连接。
- 指定路线失败须保留请求与结果，不用盲目重试、替代方案或降低准入掩盖失败。

## Product Invariants

- 保留原视频顺序、时长和音频，不擅自扩展创作范围；展示文字由用户提供，Agent 不代填或改写，已校验的用户贴纸可原样使用；参数、分配、时序及兼容规则由 [Decoration Contract](docs/decoration-production-contract.md) 独占。
- 识别事实、创作方案与人工决定分离；准入由共享 schema 和主进程落实，预览与导出消费同一冻结模板，重试复用冻结方案与素材快照。
- 自动覆盖不确定时失败关闭；人工辅助及手动输入遵守 [Assisted Contract](docs/semi-automatic-cover-review-spec.md)，不得伪造批准或绕过确认。
- shape 启用与输出按 [Hybrid Activation Delta](docs/shape-matched-cover-hybrid-v1-spec.md#activation-accepted-product-delta) 的完整 gates 执行，仅导出同 frozen bytes/binding 的 H4 PASS 角落；未解决角落保持原样，旧 [Shape V1](docs/shape-matched-cover-spec.md) 研究不授产品准入，禁止白矩形 fallback。

## Canonical Ownership And Safety

- 复用原有 schema、制作生命周期、源知识、模板 compiler、导出 queue 与 ArtifactVerifier，不建立第二套状态或控制链；原片与已有输出不可覆盖，临时输出验证后才发布，失败不得标 completed。
- 模型仅接收约定抽帧与创作上下文，不发送原视频、本地路径或凭据；Key 不进入 renderer、项目、浏览器存储或日志，ChatGPT 使用应用独立登录目录，CC Switch 只读且 OAuth token 不作 API Key。
- 产品 Agent 仅返回方案，保持工具禁用与会话隔离，runtime 升级须核验实际工具暴露；运行中不切换连接，取消停止请求，重启不自动恢复分析，测试不擅用真实账号或额度。
- 源知识争议、完整性未知、无效修订及 unknown outcome 均失败关闭；重新检查不得清除争议或绕过准入，源事实复用遵守 [Source Knowledge](docs/source-sticker-knowledge-spec.md)。

## Verification And Completion

- 声称完成或提交前执行 `verification-before-completion`：代码变更运行 typecheck 与相关测试，非微小 UI 验证实际交互，纯文档检查引用与语义；证据必须对应当前源码及运行状态。
- 检查路由与回执由 [Harness Contract](docs/video-validation-harness-spec.md) 和 [policy](.agent/harness/policy.json) 独占，使用 owned scope 与有效 receipt；未知、缺失、过期或跳过必需检查均不能 PASS，验证器不得自动维护或提交生产任务。
- 区分模拟、真实模型、媒体验证、实机、平台与人工验收；文件或测试通过不证明整片视觉、音频及覆盖效果，未评估项和阻断明确报告。
- 验证后检查最终 diff，仅 commit 本任务路径或 owned hunks，push 当前分支 upstream 并核对远端 HEAD；保留其他会话改动，无变更不制造提交。

<!-- aoci:begin -->
## AOCI Cognition

- AOCI 只是语义索引，关系由 CodeGraph 核对，合同与源码仍归原 owner；发现认知冲突须调查。
- 仅在 indexed 语义或身份变化、索引过期或明确治理时维护，按当前官方 Guide 完整批次、CAS、原子写入及有界恢复执行，保留其他会话结果，不扩大范围；纯文档、测试与样式不默认维护。
- 必要维护后完成官方 Verify、Check、Guide，在 owned Harness scope 声明原因与对象；policy 要求的检查不可关闭，本轮与全库结果分别报告，未完成或工具阻断不得宣称对齐，运行状态与缓存不提交。
<!-- aoci:end -->
