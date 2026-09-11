---
id: EPIC-002
priority: Must
mvp: true
size: L
requirements: [REQ-002, REQ-003, NFR-P-001, NFR-U-001]
architecture: [ADR-001, ADR-002]
dependencies: [EPIC-001]
status: complete
---

# EPIC-002: 编辑模板与验证样片

**Priority**: Must
**MVP**: Yes
**Estimated Size**: L

## Description

提供无时间线的多图层编辑体验，并证明 canonical 编辑模板可通过同一 compiler 生成真实验证样片。此 Epic 的收敛标准是最终媒体证据，不只是 UI 看起来正确。

## Requirements

- [REQ-002](../requirements/REQ-002-reusable-edit-template.md): 创建并复用编辑模板
- [REQ-003](../requirements/REQ-003-preview-and-proof-render.md): 预览并生成验证样片
- [NFR-U-001](../requirements/NFR-U-001-first-run-usability.md): 首次使用可完成性

## Architecture

- [ADR-002](../architecture/ADR-002-canonical-template-model.md): Canonical model 与 adapter 边界
- [ADR-001](../architecture/ADR-001-local-desktop-and-ffmpeg.md): FFmpeg final-render owner

## Dependencies

- [EPIC-001](EPIC-001-media-and-project-foundation.md) (blocking): 需要 schemas、MediaItem probe 和安全 IPC。

## Stories

### STORY-002-001: 构建三步 Workflow UI 和图层面板

**User Story**: As a 批量短视频制作者, I want to 按导入、编辑模板、导出的顺序完成工作 so that 我无需理解专业时间线。

**Acceptance Criteria**:
- [ ] 主界面只有一个明确 primary action，随当前 readiness 推进。
- [ ] 图层新增、排序、显隐、删除和属性编辑支持鼠标与键盘。
- [ ] 错误和状态不只依赖颜色，关键控件具有可见 focus 和 accessible name。

**Size**: M
**Traces to**: REQ-002, NFR-U-001

---

### STORY-002-002: 实现 canonical 图层编辑与模板复用

**User Story**: As a 批量短视频制作者, I want to 编辑并保存多个文字和贴纸图层 so that 我可以稳定复用品牌包装。

**Acceptance Criteria**:
- [ ] 所有 UI 变更只更新 canonical `EditTemplate`，无隐藏 adapter state。
- [ ] 归一化位置、relative font size、z-order、opacity 和 filter intensity 通过 schema 校验。
- [ ] 模板独立导入/导出后 semantic round-trip 相等，缺失资源 fail closed。

**Size**: M
**Traces to**: REQ-002, REQ-006

---

### STORY-002-003: 在代表性素材上提供近似预览

**User Story**: As a 批量短视频制作者, I want to 拖动图层并快速看到近似结果 so that 我可以高效调整模板。

**Acceptance Criteria**:
- [ ] 切换横/竖屏代表性素材不改变编辑模板，只重新投影 normalized layout。
- [ ] 视频解码、代理生成和图层操作不阻塞 UI 主线程。
- [ ] 预览持续标记为近似结果，filter adapter 的映射由 registry 测试覆盖。

**Size**: M
**Traces to**: REQ-003, NFR-P-001

---

### STORY-002-004: 编译并检查一条验证样片

**User Story**: As a 批量短视频制作者, I want to 用最终渲染链路先导出一条样片 so that 我能在整批执行前发现问题。

**Acceptance Criteria**:
- [ ] 验证样片和批量导出调用同一个 Template Compiler 和 FFmpeg Adapter。
- [ ] 横屏、竖屏、Unicode 文字、透明贴纸和每个 filter preset 均有 golden fixture。
- [ ] FFmpeg exit 0 后仍必须通过 Artifact Verifier 才呈现为成功。

**Size**: L
**Traces to**: REQ-003, REQ-004
