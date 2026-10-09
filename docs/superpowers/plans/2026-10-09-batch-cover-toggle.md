# Batch Cover Toggle

## Goal And Contract

用户要求去掉批量制作的覆盖方式选择。依据 [Manual Region Input Delta](../../semi-automatic-cover-review-spec.md#manual-region-input-delta-2026-10-08)，页面只保留覆盖开关；新请求显式使用 `real-artwork`，开启读取保存框，无框不覆盖，关闭不覆盖。旧 API、原模板及历史冻结任务保持原解释。

## Scope And Verification

修改 `BatchProductionPanel.tsx` 的行初始化和控件，并收窄 `batch-production.css` 的覆盖列。复用主进程已有制作准入，不新增覆盖 owner。`tests/batch-production.test.ts` 验证旧 saved/agent 模板、刷新、开启及关闭的真实浏览器提交参数；Chrome MCP 检查真实组件布局与交互。完成 typecheck、owned-scope Harness、AOCI 维护和 completion 后提交推送。

## Self-Review

关闭仍由 `coverEnabled` 控制；前端始终声明本轮选择，主进程继续核验框、源和冻结层。去掉下拉框不会把旧自动设置或审阅批准当作人工覆盖依据。独立 Kimi 调查只读取 backend 边界；parent 验证并裁决结果。
