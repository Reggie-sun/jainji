# Qianchuan Console UI Implementation Plan

## Goal
根据用户截图反馈，自主重做「千川 → 计划与数据」的业务界面，替换无层次的原生表单与技术验收清单。

## Scope And Ownership
Parent 在既有 worktree 串行负责 `QianchuanBackendPanel.tsx`、`QianchuanIntegrationPanel.tsx`、`QianchuanDeliveryPanel.tsx` 的展示层、新增独立 `qianchuan-console.css` 与相关 UI tests/fixture。三个组件共享选择范围及布局，拆给多个 writer 没有收益。主目录其他会话的计划选择、启动、账号目录改动不在本轮范围。

## Contract
沿用 [原 Spec](../specs/2026-10-15-qianchuan-real-integration.md) 的 User Experience、F06/F08：原查询、完整快照、预检、单次确认与取消 owner 保持；不增加 API、权限、额度默认值、自动读取或真实提交。账户与目标计划、时间范围、历史属性和 UNKNOWN 不可重发继续明确展示。技术证据仅折叠，不虚报功能可用。

## Target Behavior
原有六入口不变。使用深绿标题栏、浅灰工作区、白色卡片、统一输入框与按钮。查询范围置顶；查询结果或真实空态在独立卡片；完整报表与历史记录成区；预算/ROI 的调整表单通过明确展开进入，能力矩阵与配方证据收进详情。未读取不伪造指标，未开放的创建/启停以简短说明呈现。桌面双列与窄屏单列，表格局部滚动。

## Milestones
1. 替换三组件 JSX 展示及局部样式，保留全部请求和安全状态逻辑；预检结果以修改前/修改后展示，不把原始 JSON 作为默认业务 UI。
2. 浏览器测试验证折叠、范围编辑、完整采集与历史导出、取消迟到、一次确认及 UNKNOWN；在 360/820/1440px 检查布局与焦点。
3. typecheck、受影响测试和 owned Harness；Chrome DevTools 隔离 UI 交互与截图。提交推送后在主目录运行入口核对样式与组件，真实金融操作不属于 UI 验证。

## Self-Review
本轮仅兑现截图要求的 UI 重做，不借 UI 放开未准入能力。不新建账户或队列 owner；不自动查询、填金额或恢复授权。集成测试使用隔离 fixture，不能代替真实平台验收。按最终差异评估 AOCI 展示语义等价性和 Review Risk Gate。
