---
id: REQ-003
type: functional
priority: Must
traces_to: [G-004, G-005]
status: complete
---

# REQ-003: 预览并生成验证样片

**Priority**: Must

## Description

应用 MUST 在选中的代表性原始素材上提供可交互的近似预览，并 MUST 允许用户使用最终 FFmpeg 渲染链路生成一条验证样片。

## User Story

As a 批量短视频制作者, I want to 在整批导出前看到模板效果并验证一条真实样片 so that 我能尽早发现位置、字体或滤镜问题。

## Acceptance Criteria

- [ ] 用户可在素材批次中切换代表性原始素材，编辑模板参数保持不变。
- [ ] 用户可在画面中拖动、缩放和旋转选中图层，并可通过数值控件完成键盘操作。
- [ ] 近似预览必须持续显示“预览”标识，且不得被描述为最终输出保证。
- [ ] 用户可选择一条素材生成验证样片；该样片使用与批量导出相同的 template compiler、FFmpeg 参数规则和输出 preset。
- [ ] 验证样片失败时显示失败阶段、错误摘要和可执行恢复建议，且不会创建假成功结果。

## Traces

- **Goals**: [G-004, G-005](../product-brief.md#goals--success-metrics)
- **Architecture**: [ADR-002](../architecture/ADR-002-canonical-template-model.md)
- **Implemented by**: [EPIC-002](../epics/EPIC-002-template-and-preview.md)
