# Hybrid Local Random Integration Plan

## Goal

用户已授权让本地随机包装与自动形状匹配同时使用。取消入口互斥，真实物化随机文字外观与独立边框设置，沿用原 Hybrid 覆盖和导出流程。

## Scope And Contract

`shape-cover-activation.ts` 独占组合准入；`hybrid-cover-session.ts` 准备同源 H4 覆盖及逐版本包装；`agent-provider.ts` 继续独占文字样式物化；`hybrid-cover-production.ts` 保持模板与批准字节绑定。前端在包装、覆盖和预览说明中明确组合效果。

当前 Hybrid 的 NO_CANDIDATE/NO_OVERLAY 不授空缺角落或主体避让证明，不能把检测未命中当作安全空位。组合中四角保留给覆盖流程，不补普通随机贴纸，未确认角落保持原样。随机包装只随机用户手填文字的外观，边框沿原独立设置逐版本解析。保留原色，不在 H4 后追加随机滤镜。此约束应可见，不将有限组合声称为完整随机四角包装。

## Invariants

- H2/H3/H4 准入不变，只有原 owner 批准的同 PNG/source/binding 进入导出；不换款、移动、缩放或用矩形兜底。
- 随机包装不调用创作模型；形状识别及独立覆盖复核仍要求原模型路线。关闭覆盖或手动覆盖的本地随机仍不调用模型。
- 文字内容只来自用户；逐素材关闭文字时不生成文字。逐版本物化一次，重复准备和导出重试复用完整冻结模板；返回副本避免 caller 污染缓存。
- 原数量、取消、队列、输出目录权限、未知结果停止不变。千川上传组合、其他输出容器仍保持现有拒绝。
- 不改当前其他会话拥有的批量上传恢复文件，不新增 provider 或生产队列。

## Milestones

1. 只读链路核查与旧行为复现；更新 Hybrid 产品合同的组合说明与前端文案。
2. 在原入口开放 random；复用文字样式选择，缓存每素材版本的最终模板，保持图层白名单和原色。测试新组合、逐版本随机与同版本稳定、关闭文字、稀疏素材池、取消/未知、H4 字节不变。
3. typecheck、相关 controller/session/FFmpeg fixture 与 owned Harness；Chrome MCP 验证可见说明。按最终 Risk Gate 决定是否另需审查，维护 AOCI 并仅提交本任务改动，推送 main 核对远端。

## Verification And Limits

使用 `tests/shape-cover-activation.test.ts`、`tests/hybrid-cover-session.test.ts`、`tests/hybrid-cover-production.integration.test.ts` 和本地随机现有回归；真实 FFmpeg fixture 验证原 compiler/queue，不以 mock QA 声称真实模型或用户素材视觉验收。没有新增真实模型消费。

## Self Review

用户期望的职责分离由既有 owner 实现。原普通角落补齐需要更强的空缺证据，本任务不伪造该证据；通过明确的组合说明交付真实可用的随机文字/边框加已批准覆盖。保持产品原 partial-processing 语义、模型要求、冻结和未知结果边界。代码无需修改原批量恢复文件。
