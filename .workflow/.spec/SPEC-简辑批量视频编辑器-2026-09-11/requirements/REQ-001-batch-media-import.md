---
id: REQ-001
type: functional
priority: Must
traces_to: [G-001, G-003]
status: complete
---

# REQ-001: 批量导入与检查原始素材

**Priority**: Must

## Description

应用 MUST 允许用户一次选择或拖入多个原始素材，独立探测每个文件并形成素材批次。导入只登记路径和元数据，MUST NOT 修改、移动或重新编码原始素材。

## User Story

As a 批量短视频制作者, I want to 一次导入并检查一批原始素材 so that 我不必逐个建立剪辑项目。

## Acceptance Criteria

- [ ] 用户可在单次文件选择或拖放中加入多个 MP4、MOV、MKV、WebM 文件。
- [ ] 每个有效素材显示文件名、时长、自动旋转后的分辨率、文件大小和就绪状态。
- [ ] 无效、缺失视频轨道或 codec 不支持的文件被单独标记，其他有效文件仍成功加入。
- [ ] 同名但路径或指纹不同的文件可同时存在，并具有不同 `MediaItem.id`。
- [ ] 用户可从素材批次移除条目，而磁盘上的原始素材保持不变。

## Traces

- **Goals**: [G-001, G-003](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md)
- **Implemented by**: [EPIC-001](../epics/EPIC-001-media-and-project-foundation.md)
