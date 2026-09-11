---
id: NFR-P-001
type: non-functional
category: Performance
priority: Must
status: complete
---

# NFR-P-001: 交互与导出性能

**Category**: Performance
**Priority**: Must

## Requirement

应用 MUST 将媒体探测、缩略图生成和 FFmpeg 渲染移出 UI 主线程。默认串行编码时，用户仍必须能够滚动列表、查看状态和请求取消。

## Metric & Target

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| 100 条素材下常用列表操作 P95 | < 200ms | 自动化 UI trace |
| 非编码阶段 UI 长任务 | 无 > 100ms 的阻塞任务 | Chromium performance trace |
| 任务进度更新延迟 | < 2s | 比较 FFmpeg progress 时间戳与 UI 展示时间 |
| 内存增长 | 导入 100 条 4K 素材后 < 500MB，不预加载完整视频 | 进程 RSS 采样 |

## Traces

- **Goals**: G-004, G-005
- **Architecture**: [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md), [ADR-003](../architecture/ADR-003-durable-export-queue.md)
