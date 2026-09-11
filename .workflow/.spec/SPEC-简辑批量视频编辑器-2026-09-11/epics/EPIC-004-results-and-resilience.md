---
id: EPIC-004
priority: Must
mvp: true
size: M
requirements: [REQ-005, REQ-006, NFR-R-001, NFR-U-001]
architecture: [ADR-003]
dependencies: [EPIC-001, EPIC-003]
status: complete
---

# EPIC-004: 结果与恢复

**Priority**: Must
**MVP**: Yes
**Estimated Size**: M

## Description

让用户明确拿到输出成片，并让失败、取消、崩溃和重启成为可解释、可恢复的正常状态，而不是模糊异常。

## Requirements

- [REQ-005](../requirements/REQ-005-result-and-recovery.md): 检查结果并恢复失败任务
- [REQ-006](../requirements/REQ-006-project-persistence.md): 保存并恢复项目状态
- [NFR-R-001](../requirements/NFR-R-001-crash-safe-recovery.md): 崩溃安全与恢复

## Architecture

- [ADR-003](../architecture/ADR-003-durable-export-queue.md): Durable state and recovery
- Component: Result UI, Artifact Verifier, Project and Job Store

## Dependencies

- [EPIC-001](EPIC-001-media-and-project-foundation.md) (blocking): 依赖项目/queue store。
- [EPIC-003](EPIC-003-export-pipeline.md) (blocking): 依赖真实任务终态和 artifacts。

## Stories

### STORY-004-001: 展示逐项结果和恢复建议

**User Story**: As a 批量短视频制作者, I want to 清楚区分成功、失败、取消和中断 so that 我知道哪些视频可用以及下一步做什么。

**Acceptance Criteria**:
- [ ] 每项显示原始素材 basename、状态、进度/耗时、尝试次数、输出或 error summary。
- [ ] 每类错误包含原因、受影响对象和至少一个可执行恢复建议。
- [ ] 状态使用文字与图形，不只依赖颜色，并通过 screen reader announcement 更新。

**Size**: S
**Traces to**: REQ-005, NFR-U-001

---

### STORY-004-002: 打开成片并仅重试失败项

**User Story**: As a 批量短视频制作者, I want to 播放或定位成片并批量重试失败项 so that 我能快速交付有效结果。

**Acceptance Criteria**:
- [ ] completed 项可用系统播放器打开并在文件管理器中 reveal。
- [ ] retry failed/interrupted 创建新 attempt，保留旧记录且默认跳过 completed 项。
- [ ] 外部移动的输出在操作前重新验证并显示 `artifact_missing`，不得假成功。

**Size**: M
**Traces to**: REQ-005

---

### STORY-004-003: 重启恢复与 fault-injection gate

**User Story**: As a 批量短视频制作者, I want to 在异常退出后恢复真实任务状态 so that 长批次不因应用关闭而全部重做。

**Acceptance Criteria**:
- [ ] 启动时 non-terminal execution states 转为 `interrupted`，已验证 completed 保持不变。
- [ ] queue JSON 损坏时加载最近有效 backup，隔离损坏文件并提示用户。
- [ ] kill process、disk full、permission denied 和 missing source fault-injection tests 均通过，零 partial 假成功。

**Size**: M
**Traces to**: REQ-005, REQ-006, NFR-R-001
