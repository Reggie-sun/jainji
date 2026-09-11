---
id: ADR-002
status: complete
decision_status: Accepted
traces_to: [REQ-002, REQ-003, REQ-006]
date: 2026-09-11T23:18:21+08:00
---

# ADR-002: Canonical 编辑模板与归一化布局

## Context

同一编辑模板必须应用到不同分辨率和宽高比的原始素材。React 预览与 FFmpeg 输出使用不同渲染技术，如果各自保存或解释独立参数，会产生双 owner 和不可预测漂移。

## Decision

定义 versioned、runtime-validated 的 canonical `EditTemplate` scene model。所有图层基于自动旋转后的显示画面使用 0–1 归一化坐标、相对字号和明确 z-order。Preview Adapter 和 Template Compiler 都只读取该 model；它们不得持有独立模板字段。批次创建时保存不可变模板快照。

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| Canonical normalized scene model（chosen） | 一份参数驱动两种 adapter；跨分辨率复用；易版本化与测试 | 预览仍可能有字体和滤镜像素差异，需要验证样片 |
| 固定像素坐标 | 实现最直接，单分辨率结果易理解 | 横竖屏和不同分辨率会错位，违背批量模板目标 |
| 为每种宽高比保存独立模板 | 每类素材可精细调整 | 增加配置次数和同步问题，弱化“一次编辑”价值 |
| 以浏览器 Canvas 作为最终渲染 | 预览/输出理论共用绘制逻辑 | codec、音频、长视频和性能风险高，削弱 FFmpeg 优势 |

## Consequences

- **Positive**: 模板成为唯一参数 owner；可确定迁移、审计和生成 FFmpeg argv。
- **Negative**: 必须定义 clipping、字体度量和滤镜强度映射；验证样片仍不可省略。
- **Risks**: 若 adapter 私自加入未写入 schema 的默认值，会重新产生语义漂移。

## Traces

- **Requirements**: [REQ-002](../requirements/REQ-002-reusable-edit-template.md), [REQ-003](../requirements/REQ-003-preview-and-proof-render.md), [REQ-006](../requirements/REQ-006-project-persistence.md)
- **Implemented by**: [EPIC-002](../epics/EPIC-002-template-and-preview.md)
