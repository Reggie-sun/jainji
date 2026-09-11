---
id: REQ-005
type: functional
priority: Must
traces_to: [G-002, G-003]
status: complete
---

# REQ-005: 检查结果并恢复失败任务

**Priority**: Must

## Description

应用 MUST 为每条导出任务保留终态和对应证据，使用户能够定位输出成片、理解失败、仅重试失败或中断项，并在应用重启后继续处理。

## User Story

As a 批量短视频制作者, I want to 清楚看到每条结果并只重试失败项 so that 少数坏素材不会迫使我重做整个批次。

## Acceptance Criteria

- [ ] 结果列表逐条显示原始素材、状态、输出路径、耗时、尝试次数和错误摘要。
- [ ] `completed` 状态只可在输出文件存在且 `ffprobe` 能读取预期视频轨道后写入。
- [ ] 用户可播放输出成片、复制路径并在 Ubuntu 文件管理器中打开输出目录。
- [ ] 用户可选择全部失败或中断任务创建新尝试；已完成任务默认不重复执行。
- [ ] 错误至少区分输入无效、资源缺失、磁盘空间、权限、编码器缺失、FFmpeg 失败和用户取消。
- [ ] 重试 MUST 保留旧尝试记录，并产生新临时文件；不得把旧失败文件当作成功结果。

## Traces

- **Goals**: [G-002, G-003](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-003](../architecture/ADR-003-durable-export-queue.md)
- **Implemented by**: [EPIC-004](../epics/EPIC-004-results-and-resilience.md)
