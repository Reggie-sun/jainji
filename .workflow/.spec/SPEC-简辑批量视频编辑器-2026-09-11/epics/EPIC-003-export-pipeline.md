---
id: EPIC-003
priority: Must
mvp: true
size: L
requirements: [REQ-004, NFR-P-001, NFR-R-001, NFR-S-001]
architecture: [ADR-001, ADR-003]
dependencies: [EPIC-001, EPIC-002]
status: complete
---

# EPIC-003: 安全批量导出管线

**Priority**: Must
**MVP**: Yes
**Estimated Size**: L

## Description

把经过验证的单条最终渲染能力扩展为持久化素材批次。重点是不可变模板快照、输出路径安全、任务状态机、进度和单项失败隔离。

## Requirements

- [REQ-004](../requirements/REQ-004-batch-export-queue.md): 创建并执行批量导出队列
- [NFR-P-001](../requirements/NFR-P-001-interaction-and-export-performance.md): 交互与导出性能
- [NFR-R-001](../requirements/NFR-R-001-crash-safe-recovery.md): 崩溃安全与恢复
- [NFR-S-001](../requirements/NFR-S-001-local-data-safety.md): 本地数据与文件安全

## Architecture

- [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md): FFmpeg 与 process boundary
- [ADR-003](../architecture/ADR-003-durable-export-queue.md): Durable queue 与 atomic publish

## Dependencies

- [EPIC-001](EPIC-001-media-and-project-foundation.md) (blocking): 依赖状态 store、安全路径和 probe。
- [EPIC-002](EPIC-002-template-and-preview.md) (blocking): 依赖已验证 Template Compiler。

## Stories

### STORY-003-001: 创建不可变导出批次

**User Story**: As a 批量短视频制作者, I want to 在启动前检查并冻结本次导出配置 so that 执行中继续编辑不会改变结果。

**Acceptance Criteria**:
- [ ] 批次创建验证所有素材、图层资源、output directory、capability 和磁盘估算。
- [ ] 每个选中 `MediaItem` 创建一个 `ExportTask`，全部引用同一 immutable template snapshot。
- [ ] 输出路径与任一原始素材相同或目录不可写时必须阻止启动。

**Size**: M
**Traces to**: REQ-004, NFR-S-001

---

### STORY-003-002: 安全编译和启动 FFmpeg

**User Story**: As a 批量短视频制作者, I want to 让复杂文件名和文字也能安全导出 so that 我的本地文件不会触发错误命令或丢失内容。

**Acceptance Criteria**:
- [ ] 所有 command 通过 argv 和 `shell=false` 执行，用户文字使用受控 text file 或正确 escaping。
- [ ] 命名冲突按 deterministic increment policy 产生新名称，不覆盖现有文件。
- [ ] 每项使用目标目录中的 unique partial file，只有验证成功才能 publish。

**Size**: M
**Traces to**: REQ-004, NFR-S-001

---

### STORY-003-003: 串行调度并展示进度

**User Story**: As a 批量短视频制作者, I want to 看到当前和总体导出进度 so that 我知道任务仍在运行以及还需处理多少项。

**Acceptance Criteria**:
- [ ] 默认只有一个 running task，状态转换符合 Architecture state machine。
- [ ] FFmpeg progress 被节流后持久化并以 revisioned snapshot 推送 UI，延迟 < 2 秒。
- [ ] 用户可继续浏览素材、结果和请求取消，UI 无 >100ms 渲染阻塞。

**Size**: M
**Traces to**: REQ-004, NFR-P-001

---

### STORY-003-004: 隔离失败、取消和发布结果

**User Story**: As a 批量短视频制作者, I want to 单个失败或取消不影响整批 so that 其余视频仍能完成。

**Acceptance Criteria**:
- [ ] 单项 non-zero exit 或 verify failure 进入 `failed`，scheduler 继续下一项。
- [ ] 取消 running task 执行 SIGINT→bounded wait→SIGKILL，并清理或隔离 partial。
- [ ] 只有通过 ffprobe 的 partial 才原子重命名并创建 `OutputArtifact`。

**Size**: M
**Traces to**: REQ-004, REQ-005, NFR-R-001
