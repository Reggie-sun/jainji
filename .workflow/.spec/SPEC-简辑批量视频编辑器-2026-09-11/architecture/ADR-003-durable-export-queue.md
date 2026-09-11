---
id: ADR-003
status: complete
decision_status: Accepted
traces_to: [REQ-004, REQ-005, REQ-006, NFR-R-001]
date: 2026-09-11T23:18:21+08:00
---

# ADR-003: 持久化串行导出队列

## Context

视频编码持续时间长，可能遇到坏素材、磁盘不足、应用崩溃或用户取消。批次中的单项必须隔离，并且重启后不能把运行中任务误认为成功。MVP 数据规模小，但可靠性要求高。

## Decision

使用显式 `ExportTask` 状态机、默认并发 1、versioned JSON queue state 和 atomic replace。每条任务写入独立 partial file，FFmpeg 成功退出后由 ffprobe 验证，再原子重命名并创建 `OutputArtifact`。每次状态转换先持久化 monotonic revision，再通知 UI；启动时所有非终态执行状态转为 `interrupted`。

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Atomic JSON + serial queue（chosen） | 依赖少、状态可读、足够覆盖百级单用户任务；并发资源风险最低 | 查询和超大队列能力有限；必须自己实现原子写与迁移 |
| SQLite durable queue | 事务和查询能力强，适合大量记录 | Electron native module 打包和 ABI 成本较高，对 MVP 数据量过度 |
| In-memory queue | 实现最少 | 崩溃即丢失，无法满足恢复和证据要求 |
| 多进程并行 queue | 吞吐更高 | 容易耗尽 CPU、内存和磁盘带宽；取消与恢复复杂度显著增加 |

## Consequences

- **Positive**: 单项失败隔离、状态可解释、重启可恢复、输出发布具有完整性门槛。
- **Negative**: 默认吞吐低于并行编码；JSON store 需要严格 revision、fsync 和备份策略。
- **Risks**: NFS 或非原子重命名文件系统不在 MVP 支持范围；输出目录跨文件系统时必须在目标目录创建 partial。

## Traces

- **Requirements**: [REQ-004](../requirements/REQ-004-batch-export-queue.md), [REQ-005](../requirements/REQ-005-result-and-recovery.md), [NFR-R-001](../requirements/NFR-R-001-crash-safe-recovery.md)
- **Implemented by**: [EPIC-003](../epics/EPIC-003-export-pipeline.md), [EPIC-004](../epics/EPIC-004-results-and-resilience.md)
