# Direct Manual Cover Implementation Plan

## Goal And Scope

按用户最新要求，手动真实贴纸覆盖保存框选后直接正常制作，取消整批动态预览和逐版批准；跨模板批量制作提供同一选择。未框选素材正常制作。

## Owners And Contracts

- `CoverSticker.mediaRegions` 与 `manualReviewInput` 继续独占人工区域/时段解释；`manualRegionInput` 的真实贴纸设置走正常制作，历史 review-authored 草稿保持审阅入口。
- `AgentController` 读取已保存设置，生成无批准状态的本轮区域意图；`createHumanRegionCover` 复用几何匹配。新冻结 binding 明确标识 normal manual production，不能冒充已查看预览或 H4 批准。
- `ExportQueue` 在主进程入队前核对本轮意图和所有目标、源及冻结像素，复用原 compiler、并发、JobStore、重试和上传注册。直接入口不接收 renderer 提供的批准令牌。
- 批量设置由现有 batch entry/controller 传递，不能建立第二制作生命周期。

## Invariants And Compatibility

真实图案等比覆盖全部目标像素，无白底兜底；覆盖只证明指定区域；不证明用户框全旧贴纸。保存后不改变已冻结任务。普通 assisted、自动 Hybrid 和旧白底手动保持原准入；旧 review binding 不允许借正常入口绕过批准。保留原片、音频、顺序、时长、上传授权及 unknown outcome 行为。

## Milestones

1. 扩展人工区域冻结的来源判别，正常制作生成主进程意图并逐版入原队列，拒绝缺失或错配意图、目标删除、旧 review 冒用。
2. 单项目取消手动真实贴纸审阅重定向；跨模板提供真实贴纸选择并读取素材集已保存框选。清楚提示无框不会覆盖。
3. 验证普通启动、无框、取消、原队列导出和重试、批量选项及隔离 CDP 上传接缝；保持旧 assisted 测试。

## Verification And Self-Review

运行 typecheck、相关 integration tests、当前 owned Harness、真实 Electron UI 与 FFmpeg 导出。检查 frozen PNG/目标覆盖与无预览调用；平台真实发布与整片人工视觉验收不以测试替代。完成 AOCI 维护、Risk Gate、completion 后只提交本任务文件并推送核对远端 SHA。

自审：用户明确取消的是手动人工框的前置预览；不是取消像素验证，也不是批准自动 Hybrid 跳过 H4。无需新增用户批准步骤。Kimi 只读核对批量接缝，parent 负责实现和最终裁决。
