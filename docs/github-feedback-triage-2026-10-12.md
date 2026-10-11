# GitHub Feedback Triage

## Scope

本轮核对 [Reggie-sun/jainji](https://github.com/Reggie-sun/jainji) 的全部五条 open Issues，读取当前代码、既有回归与 Issue #10 原截图。没有调用用户的制作模型、使用真实平台账号或改动生产数据。记录不代表 Windows 实机或成片视觉验收；信息不足的反馈保留 open，不自动认定已经修复。

## Findings

| Issue | Current evidence | Disposition |
| --- | --- | --- |
| [#1](https://github.com/Reggie-sun/jainji/issues/1) 版本效果相似 | `AgentRunner` 逐素材版本独立调用方案；`AgentProvider` 以 run seed、输出位置及批内使用次数重新排序目录与花字。现有测试覆盖目录分散及使用计数。本地随机另有四角不同款及滤镜随机。 | 早期固定方案前提已经变化；独立调用不能保证主观风格不相似。无原片/成片，不能宣布视觉问题解决。 |
| [#7](https://github.com/Reggie-sun/jainji/issues/7) 空 candidates | 当前初筛已提供有效非空编号示例、整数范围、唯一性约束；仍拒绝空数组、重复编号与越界编号。 | 旧请求提示已有改进，但 #10 的新截图证明无效响应仍可能发生。保留模型输出问题，不放宽校验、不自动重试或换模型。 |
| [#8](https://github.com/Reggie-sun/jainji/issues/8) 泛化准备失败 | `AgentRunner` 原 catch 把全部非 `ProviderError` 故障压成同一条提示，丢掉已知权限、磁盘和资源分类；普通 enqueue 也未更新审计阶段。 | 修复已知错误分类及安全阶段提示，保留取消和模型错误行为。原 Windows 故障缺详细上下文，根因仍未确认。 |
| [#9](https://github.com/Reggie-sun/jainji/issues/9) Windows EPERM copyfile | 原 `classifyError` 只匹配 permission/eacces 文本，没有读取 errno code；标准 EPERM 文本落入 ffmpeg_failed 并显示底层路径。硬链接不支持时的独占复制回退已经存在。 | 修复 EPERM/EACCES/ENOSPC 的分类及恢复建议；测试核验复制失败不完成、不授重试、不公开路径。实际 Windows 文件权限或锁定原因未验证。 |
| [#10](https://github.com/Reggie-sun/jainji/issues/10) 人工覆盖后的 MiniMax 返回 | 原截图列出空候选、重复候选、候选目录外 ID，以及四角贴纸总面积超过 3%。这些都对应当前本地校验规则；截图没有显示覆盖成片。 | 反馈仍有效，属于创作模型响应不满足合同。缺原始响应、冻结输入及复现素材，不能定位特定模型响应原因或评价人工覆盖画面；继续保持失败关闭。 |

## Implementation

错误分类和提示由既有 [errors.ts](../src/main/errors.ts) 独占，制作 runner 复用它；不创建第二套恢复、模型请求或队列生命周期。errno 分类使用结构化 code，并兼容标准错误文本。准备阶段只输出本地固定描述，不输出 raw OS message、路径或 Key。

无效模型响应继续按 [Decoration Contract P15](decoration-production-contract.md#p15) 停止。拒绝 Kimi 调查建议的自动文件复制重试及 best-effort 发布清理：没有证据证明此次 EPERM 是瞬时占用，`retryable` 也不表示授权自动重复文件操作；本轮不改变发布合同。

## Verification

- Red：两组回归产生 7 个预期失败，覆盖错误归类、路径泄露和丢失阶段。
- Green：`agent-provider`、`agent-runner`、`queue-output-directory` 共 139 项通过，包含既有模型拒绝与输出保护测试。
- 类型检查及 owned scope Harness/completion 以本轮实际回执为准；receipt 保存于本地 `.agent/harness/runs/`，不把运行状态提交为源码。
- Linux 测试使用真实临时文件与合成权限故障；Windows ACL、杀毒/同步软件占用及 MiniMax 真实响应未验证。

## Delegation And Review

受管 Kimi read-only 调查仅核对 `paths.ts`、`queue.ts`、`errors.ts` 和输出目录测试，封存读取范围与 route receipt；invocation `f03897a2-60df-497c-898d-c852128cf8b6`，deep/k3/max，2 次上游请求，完整报告无截断。Parent 独立核验并只采纳错误分类缺陷，不将调查建议当作验收或授权。

最终 implementation review 风险判断：本轮只改变错误分类、提示及既有阶段记录，不改变文件操作、重试、credentials、production authority 或 durable-state 格式；可执行回归覆盖主要行为。没有关键损坏后果或仍需独立语义审查的重大缺口，`KIMI_REVIEW_NOT_REQUIRED`。exact source hashes 绑定本轮 Harness scope；Parent 负责最终 diff 与 completion。
