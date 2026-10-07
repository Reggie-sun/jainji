# Random Packaging Without Template Grid

## Goal

主流程直接进入包装设置，不再展示整屏风格模板；本地随机不受隐藏的旧 ruleId 限制。

## Scope And Ownership

用户已选择 A，授权本 session 接手 `App.tsx`、`TemplatePanel.tsx`、`agent-controller.ts` 并保留现有人工覆盖修改。按任务前快照提取 owned hunks，其他改动不纳入本任务提交。不创建 worktree。

原 `agent-provider.ts` 继续拥有方案验证与物化，controller 只调用本地随机方案生成；renderer 只管理草稿。调查参考受管 Kimi invocation `4cc84d6d-52d6-4e7a-9e64-144510e86077`，已由 Parent 核查 controller 的实际随机范围及物化几何。

## Behavior And Compatibility

- 新项目无 workspace 时默认 random；明确保存的 manual/agent/random 模式原样恢复，不迁移用户数据。
- 包装页移除模板卡片网格。manual 仍可展开旧模板兼容下拉，保留既有手动贴纸/滤镜语义；random/agent 不显示旧模板入口。
- random 从 `FilterPresetSchema` 全集选择滤镜、强度在 0–1 范围随机；仍由严格 PlanSchema 校验，不绕过文字、数值、未知字段检查。manual 与模型方案验证保持原合同。
- random 普通四角贴纸使用统一安全几何（宽度 0.08、旋转 0），不读取旧 rule 的大小和角度。选款和价格花字仍随机；四角不同、缺池拒绝、覆盖优先和原队列不变。
- random 草稿预览只说明选款待冻结，不显示隐藏模板或旧手动贴纸，不提供无效角落编辑；手动文字可正常拖动，边框示意保留。
- 重试消费原冻结模板；旧项目、API RuleId、跨模板批量制作与历史冻结数据保持可读。此次不改覆盖识别、批准、上传或发布权限。

## Milestones

1. 在现有 provider、local-random、workspace 测试中先增加回归：跨旧 rule 同一随机序列结果一致、可选完整滤镜范围、非法方案仍拒绝、原 controller 零模型/抽帧入队、UI 无卡片且手动兼容可用。
2. 修改原 controller/provider 与 App/TemplatePanel/TemplatePreview；更新 Decoration Contract 的新制作语义。
3. typecheck、相关测试、Chrome MCP 实际页面模式切换与文字交互、owned Harness、AOCI Verify/Check/Guide；核对 owned diff 后 commit/push 并核远端 HEAD。

## Verification And Risk Gate

定向命令：`npx vitest run tests/agent-provider.test.ts tests/local-random-cover.test.ts tests/workspace-flow.test.ts`；完整要求依 `.agent/harness/policy.json` 对 owned scope 路由，不另建检查 owner。UI 使用隔离测试页面/fixture，不修改真实用户项目或调用真实模型。自动检查不代替用户成片视觉验收。

无凭据或发布权限变化；完成 project-native verification 后判断 Implementation Review Risk Gate。之前的 Kimi 调查不是 implementation review，若稳定候选存在重大后果与实质验证缺口则按现有 gate 补独立审查。

## Self-Review

目标、随机范围、默认值、手动兼容、冻结重试及旧项目恢复均已有明确 owner 与验证；不删除 RuleId 或重建生产管线。未引入额外用户审批步骤。
