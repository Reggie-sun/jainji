# Random Per-Media Frames Implementation Plan

## Goal And Scope

整圈边框按用户最新要求默认随机，仍可手动指定或关闭；每条素材可独立覆盖整批设置，如展示文字的逐素材开关。内置及有效上传边框共用随机池，普通贴纸保持上层。

## Contract And Compatibility

共享 `FrameSettingsSchema` 表达 random / manual / none，`DecorationOptions.frame` 为整批设置、`framesByMedia` 为 UUID 逐素材设置。旧 `frameId` 仅继续读取为固定选择；新界面写新设置并清旧字段。新界面未配置边框的草稿默认 random，旧 API 请求缺新字段保留无边框解释；旧冻结模板不迁移。

随机只由本地素材 owner 选取，不调用模型；每素材每新版本选一次，主管 rebuild、冻结预览、retry 保持同一资产。普通与 Hybrid 模板准备共同消费同一选择规则；新随机追加可换随机边框，手动边框保持，原 queue 独占任务生命周期。随机池为空、指定素材不存在或指纹改变在模型/入队前拒绝。

## Owners And Milestones

Parent 单 writer。在 `frames.ts` / `decorations.ts` 建立共享设置，在 `decoration-frame.ts` 复用已有随机 picker 和指纹准入；`agent-runner.ts`、`agent-template-preparation.ts`、`hybrid-cover-session.ts` 将选择绑定到素材/版本及 rebuild。`domain.ts` 与原 append 接口保持冻结语义，仅随机来源的新版本换边框。

`FrameDecorationPicker.tsx` 复用 `MediaSelector`，整批/逐素材范围、继承整批、随机/关闭/指定、保存及当前素材预览；`CornerDecorationPicker` / `App` 传递素材和保存回调，项目原 workspace 保存合同承载设置。上传只加入随机池，不自动把随机设置改为固定。

显式重新打开同一项目时也完整恢复已保存 workspace，丢弃未保存的边框覆盖；普通导出状态通知只更新状态，不重置当前草稿。实际浏览器复现已保存关闭而界面保留未保存指定款的问题后，修复原 `App.apply` 的显式恢复判定，并重新核验。

受管 Kimi 只读核对模板准备、Hybrid 缓存及重建路径；Parent 保留实施与最终裁决。sealed 的四份核心源码在 receipt 核验前不修改；schema/UI 位于冻结集合外。

## Verification

使用已注册 tests 验证 settings schema/项目保存、逐素材 manual/none/random、随机池隔离/轮换、空池与指纹、主管重建不重选、随机追加与旧固定兼容。运行 typecheck/build、相关 Vitest、Chrome MCP 实际交互及短片实际导出；按当前 policy 路由运行 owned scope Harness。AOCI 按完整机器批次维护并 Verify / Check / Guide；仅提交本任务文件，push 并核对远端。

## Self-Review

用户三点要求分别由默认随机、manual 及 UUID override 约束；生产前冻结避免随机预览被误当成最终批准。沿用原素材存储、队列、文字内容和覆盖 owner，不新增生命周期或模型连接。仅新随机版本重新选款，重试和旧冻结文件保持原解释。
