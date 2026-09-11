---
id: NFR-U-001
type: non-functional
category: Usability
priority: Must
status: complete
---

# NFR-U-001: 首次使用可完成性

**Category**: Usability
**Priority**: Must

## Requirement

主界面 MUST 以“1 导入、2 编辑模板、3 导出”呈现唯一主流程。关键操作 MUST 可由键盘完成，状态和错误 MUST 同时使用文字与视觉标识表达，不能仅依赖颜色。

## Metric & Target

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| 首次两条视频批次启动时间 | ≤ 5 分钟，不含编码 | 5 名新用户可用性测试中位数 |
| 关键控件键盘可达率 | 100% | 自动化 tab-order 与人工验证 |
| 正文与控件对比度 | WCAG 2.2 AA | 对比度检查 |
| 错误恢复信息完整率 | 100% 包含原因与下一步 | 故障场景内容审核 |

## Traces

- **Goal**: G-004
- **Architecture**: [Architecture](../architecture/_index.md#quality-attributes)
