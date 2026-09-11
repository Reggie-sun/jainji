---
id: REQ-002
type: functional
priority: Must
traces_to: [G-001, G-005]
status: complete
---

# REQ-002: 创建并复用编辑模板

**Priority**: Must

## Description

应用 MUST 提供无时间线的图层编辑器，允许用户创建多个文字图层、多个贴纸图层和一个全局滤镜，并将其保存为可复用编辑模板。

## User Story

As a 批量短视频制作者, I want to 只配置一次通用视觉模板 so that 同一批以及后续批次都能获得一致效果。

## Acceptance Criteria

- [ ] 用户可新增、选择、编辑、排序、显隐和删除文字图层与贴纸图层。
- [ ] 文字图层支持内容、系统字体、相对字号、颜色、描边、透明度和归一化位置。
- [ ] 贴纸图层支持 PNG/JPEG/WebP、本地资源引用、归一化位置与宽度、旋转和透明度。
- [ ] 用户可选择 `none` 或一个预设全局滤镜并调整 0–1 强度。
- [ ] 横屏和竖屏素材使用同一编辑模板时，图层相对位置以自动旋转后的显示画面为基准且被限制在画面内。
- [ ] 缺失字体或贴纸资源时，应用 MUST 阻止创建导出批次并明确列出缺失项。

## Traces

- **Goals**: [G-001, G-005](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-002](../architecture/ADR-002-canonical-template-model.md)
- **Implemented by**: [EPIC-002](../epics/EPIC-002-template-and-preview.md)
