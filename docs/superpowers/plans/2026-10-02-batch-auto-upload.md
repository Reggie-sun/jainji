# Batch Auto Upload Implementation Plan

## Goal And Scope

落实 [Batch Auto Upload Amendment](../../batch-auto-upload-spec.md)，批量行默认开启并自动绑定已保存商品账号，保留原上传 service、队列与冻结协议。

## Ownership And Contracts

新增 `src/shared/batch-upload.ts` 独占名称匹配；`BatchProductionPanel.tsx` 维护每行开启草稿并展示匹配结果；`batch-production-controller.ts` 在读入真实项目后检查槽位，`batch-production-runtime.ts` 提供原 upload service 的账号摘要。不修改并行 session 拥有的账号、浏览器或 upload service 文件。request/schema、账号私有配置、历史冻结任务不变。

## Milestones

### 1. Matching And Admission

新增匹配单测；调整 batch controller 测试验证正确绑定及伪造目标在 preflight 前被拒绝。匹配只使用当前显示名，唯一且可用；关闭上传仍可本地制作。

### 2. Automatic UI And Integration

批量 UI 改为开启复选框和绑定结果，保持紧凑一排。刷新/下一轮保留默认开启与显式关闭，账号更新重新计算。通过本修订说明入口变更，并更新隔离 `batch-qianchuan-upload-smoke.mjs` 验证不选账号即可上传正确目标。

### 3. Verification And Completion

执行 `npm run typecheck`、受影响测试、Chrome MCP 实际组件交互和隔离 Electron/FFmpeg/upload fixture；稳定后判断 Risk Gate，完成对应 AOCI 维护并只提交本轮文件。全库并行漂移与本轮维护分别报告。

## Parent Self-Review

客户端展示与服务端准入消费同一匹配函数；默认上传不改变全局开关或历史恢复。缺匹配不能自动变成不上传；用户明确关闭才可跳过。计划覆盖 Spec 全部 AC，无真实上传、浏览器关闭或账号配置编辑。
