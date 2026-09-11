---
id: REQ-006
type: functional
priority: Must
traces_to: [G-001, G-002]
status: complete
---

# REQ-006: 保存并恢复项目状态

**Priority**: Must

## Description

应用 MUST 将项目、编辑模板和导出批次状态持久化到本地，以支持重复使用和异常退出后的确定性恢复。

## User Story

As a 批量短视频制作者, I want to 保存模板和任务进度 so that 我可以下次继续，而不必重新配置全部内容。

## Acceptance Criteria

- [ ] 用户可新建、保存、另存和打开项目；未保存更改在关闭前必须得到明确提示。
- [ ] 项目保存素材路径和指纹，不复制或内嵌原始视频内容。
- [ ] 编辑模板可独立导出和导入为带 `schemaVersion` 的 JSON 文档。
- [ ] 打开项目时应用重新验证素材、字体、贴纸和输出路径，并将变更或缺失项明确标记。
- [ ] 应用异常退出后，原 `running` 任务在下次启动时转换为 `interrupted`，不得假定成功或自动覆盖输出。
- [ ] 未知的未来 schema 版本 MUST 被拒绝并保留原文件，不得静默降级解析。

## Traces

- **Goals**: [G-001, G-002](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-002](../architecture/ADR-002-canonical-template-model.md), [ADR-003](../architecture/ADR-003-durable-export-queue.md)
- **Implemented by**: [EPIC-001](../epics/EPIC-001-media-and-project-foundation.md), [EPIC-004](../epics/EPIC-004-results-and-resilience.md)
