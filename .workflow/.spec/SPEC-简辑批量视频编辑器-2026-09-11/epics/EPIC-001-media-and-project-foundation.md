---
id: EPIC-001
priority: Must
mvp: true
size: L
requirements: [REQ-001, REQ-006, NFR-S-001]
architecture: [ADR-001, ADR-002, ADR-003]
dependencies: []
status: complete
---

# EPIC-001: 素材与项目基础

**Priority**: Must
**MVP**: Yes
**Estimated Size**: L

## Description

建立简辑的 domain schema、Ubuntu 桌面安全边界、素材探测和 versioned 项目持久化。该 Epic 不实现批量编码，但必须形成其余模块可依赖的真实 input/state contract。

## Requirements

- [REQ-001](../requirements/REQ-001-batch-media-import.md): 批量导入与检查原始素材
- [REQ-006](../requirements/REQ-006-project-persistence.md): 保存并恢复项目状态
- [NFR-S-001](../requirements/NFR-S-001-local-data-safety.md): 本地数据与文件安全

## Architecture

- [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md): Electron 与 system FFmpeg boundary
- [ADR-002](../architecture/ADR-002-canonical-template-model.md): Canonical schema base
- [ADR-003](../architecture/ADR-003-durable-export-queue.md): Atomic JSON primitives

## Dependencies

None. This is the foundation Epic.

## Stories

### STORY-001-001: 定义 versioned domain schemas

**User Story**: As a 开发者, I want to 为 Project、MediaItem、EditTemplate、ExportBatch 和 ExportTask 建立 runtime-validated schemas so that 所有模块共享明确 contract。

**Acceptance Criteria**:
- [ ] 每个 entity 的字段、约束、默认值和 schemaVersion 与 PRD 一致。
- [ ] unknown future schema 被拒绝，已知旧 schema 只通过显式 migration 加载。
- [ ] invalid fixtures 覆盖路径、范围、enum、缺字段和 unknown field。

**Size**: M
**Traces to**: REQ-006

---

### STORY-001-002: 批量选择并独立探测原始素材

**User Story**: As a 批量短视频制作者, I want to 一次导入并检查多个视频 so that 坏文件不会阻断有效素材。

**Acceptance Criteria**:
- [ ] Native dialog 与拖放均产生相同 `MediaItem` probe 流程。
- [ ] 每项返回时长、显示尺寸、旋转和明确错误；完整路径不暴露给 renderer。
- [ ] hostile filenames 通过 argv 进入 ffprobe，未调用 shell。

**Size**: M
**Traces to**: REQ-001, NFR-S-001

---

### STORY-001-003: 原子保存与加载项目

**User Story**: As a 批量短视频制作者, I want to 保存和再次打开项目 so that 我能反复使用同一工作状态。

**Acceptance Criteria**:
- [ ] 保存使用 temp + fsync + atomic replace，并保留最近有效 `.bak`。
- [ ] 加载重新校验 schema 和外部路径，原文件损坏时不被覆盖。
- [ ] 项目仅引用原始素材，不复制或删除用户视频。

**Size**: M
**Traces to**: REQ-006, NFR-R-001

---

### STORY-001-004: 启动 capability check 与 setup state

**User Story**: As a 批量短视频制作者, I want to 在开始工作前知道本机是否具备导出能力 so that 我不会到最后一步才发现环境缺失。

**Acceptance Criteria**:
- [ ] 启动检查 ffmpeg、ffprobe、必需 filters、H.264/AAC encoder、app data 与字体解析。
- [ ] 缺失 Must capability 时导出入口 blocked，并提供具体修复指引。
- [ ] capability result 可供日志和集成测试读取，但不含敏感完整路径。

**Size**: S
**Traces to**: REQ-001, REQ-004, NFR-U-001
