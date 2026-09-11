---
id: REQ-004
type: functional
priority: Must
traces_to: [G-001, G-002, G-003]
status: complete
---

# REQ-004: 创建并执行批量导出队列

**Priority**: Must

## Description

应用 MUST 从选中的素材批次、冻结的编辑模板快照、输出目录和输出 preset 创建导出批次，并为每条原始素材生成一个相互隔离的导出任务。

## User Story

As a 批量短视频制作者, I want to 一次启动整批独立导出 so that 我不用逐条等待和点击导出。

## Acceptance Criteria

- [ ] 启动前显示输入数量、输出目录、命名示例、预计磁盘需求和模板校验结果。
- [ ] 每个有效输入恰好创建一个导出任务，默认串行执行并显示当前文件、总体计数和单项进度。
- [ ] 每条任务使用 H.264/AAC MP4；无音轨输入 MAY 输出不含音轨的 MP4。
- [ ] 输出先写入同一文件系统的临时文件，成功探测后才原子移动到最终路径。
- [ ] 任务失败只影响自身；队列 MUST 继续执行其他待处理任务。
- [ ] 用户可取消待处理任务和请求终止当前任务；终止后不得留下伪装成完整输出的最终文件。
- [ ] 任何输出路径不得等于任一原始素材路径；冲突时 MUST 自动生成无覆盖名称或阻止启动。

## Traces

- **Goals**: [G-001, G-002, G-003](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md), [ADR-003](../architecture/ADR-003-durable-export-queue.md)
- **Implemented by**: [EPIC-003](../epics/EPIC-003-export-pipeline.md)
