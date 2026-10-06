# Automatic Optional Frames Implementation Plan

## Goal

默认自动安排是否使用整圈边框；用户可整批或逐素材指定必须使用，此时款式仍随机。

## Scope And Ownership

Parent 串行维护 `src/shared/frames.ts` 的草稿 schema、`src/main/decoration-frame.ts` 的逐输出决策、`src/main/agent-provider.ts` 的冻结准入、`src/renderer/App.tsx` 的新草稿默认值、`src/renderer/FrameDecorationPicker.tsx` 的选择说明、`src/renderer/DisplayTextEditor.tsx` 的示意预览及 `tests/agent-provider.test.ts`、`tests/builtin-stickers.test.ts` 的行为与准入证据。合同唯一 owner 为 [Decoration Contract](../../decoration-production-contract.md#perimeter-frames)。其他 session 的 Hybrid、队列和追加文件不修改。

## Contracts And Compatibility

新增草稿 `frame.mode=auto`；既有 `random` 表示必须随机使用，`manual` 固定指定款，`none` 禁用。新界面缺配置默认 auto，旧 API 缺字段仍 none；已保存的 random/manual/none 不重新解释。逐素材设置优先整批，恢复继承删除覆盖项。

唯一 resolver 每个新输出一次以等概率决定 auto 的使用/不使用，使用时复用平衡随机池。决策物化成既有 random 或 none，主管重建、正式导出及重试不重选。未解决 auto 不可直接物化图层。随机/auto 均在制作前校验池和文件；固定追加及历史冻结解释保持，随机追加仍只对原模板已有随机边框层换款，无框模板追加保持无框。

## Acceptance Criteria

- auto 既能产生边框也能产生无框，必须使用始终有随机边框且池循环分散款式。
- 逐素材强制/禁用覆盖默认 auto，保存重开恢复，旧设置保持。
- 中央透明、全画布映射、贴纸叠层、文字来源、原视频规格和队列生命周期保持。
- local-random 关闭覆盖仍无模型调用；冻结模板只含既有元数据，缺池或未冻结决策失败关闭。

## Major Milestones

1. 在共享 schema/resolver 完成 auto 及冻结拒绝，并提供红绿测试验证使用、跳过、强制、逐素材覆盖和重复物化稳定。
2. 更新默认草稿、界面说明和示意预览；用 Chrome MCP 与实际 Electron IPC 核查整批/逐素材/保存重开及本地导出。
3. 执行 typecheck、受影响测试、构建、owned Harness/completion，维护 AOCI；按 Risk Gate 判断 final review，仅提交本任务 files/owned formal hunks并推送核对远端。

## Self-Review

需求 A 已覆盖；50% 是本地有限选择规则，不引入额外用户参数或模型 owner。schema 与生产冻结生命周期复用原路径，auto 在 resolver 收敛为旧模式，避免修改并发 Hybrid 或队列。历史冻结与缺字段保持兼容，无新增上传、账号、媒体生成或 worktree。
