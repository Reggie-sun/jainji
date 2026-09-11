---
id: NFR-R-001
type: non-functional
category: Reliability
priority: Must
status: complete
---

# NFR-R-001: 崩溃安全与恢复

**Category**: Reliability
**Priority**: Must

## Requirement

项目和导出队列状态 MUST 通过原子写入持久化。进程崩溃、系统重启或强制退出后，应用 MUST 能区分已完成、失败、取消、待处理和中断任务。

## Metric & Target

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| 强制终止后已完成结果保留率 | 100% | 在随机任务边界 kill 进程并重启 |
| `running` 状态误报成功 | 0 | 崩溃恢复集成测试 |
| 损坏临时文件成为最终输出 | 0 | 编码中断和磁盘满故障注入 |
| 队列状态写入 | 原子替换且保留一个最近备份 | 文件系统故障测试 |

## Traces

- **Goal**: G-002
- **Architecture**: [ADR-003](../architecture/ADR-003-durable-export-queue.md)
