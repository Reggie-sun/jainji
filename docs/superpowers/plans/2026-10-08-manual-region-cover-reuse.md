# Manual Region Cover Reuse

## Goal And Scope

将真实贴纸覆盖放进现有“手动设置”，复用逐素材覆盖框与时段。用户先编辑并保存，再生成冻结预览，逐版查看后明确批准导出；已选千川上传继续使用原批准入口。移除独立人工区域建稿/再次框选步骤。

## Ownership And Compatibility

`CoverSticker.mediaRegions` / `manualCoverRegions` 独占新流程输入；`manualRegionInput` 显式区分旧 review 草稿输入。`cover-review-controller` 将保存的输入复制为只读审阅快照，并绑定输入摘要；prepare/approve 校验快照与当前输入一致。原 review/queue/compiler/coverage owners 不变。

旧 manual 白底与移动轨迹保持原解释。新方式只接受固定框（零或一个关键帧），不默默压平轨迹；显式空逐素材数组表示不覆盖，未配置不表示不覆盖。旧人工草稿投影回编辑器供用户保存；旧冻结任务不迁移、不重算。旧 assisted 自动候选界面保持。

## Milestones

1. 在 shared adapter 定义输入投影、旧草稿转回手动区域与快照一致性；主进程 create 接入并拒绝对派生快照直接编辑。测试多个框、时间、显式不覆盖、默认空白、移动轨迹及保存后变更。
2. `CoverStickerPanel` 合并入口；`CoverTrackEditor` 增加固定目标框展示/编辑；`CoverReviewPanel` 直接生成预览，隐藏重复编辑器；`App` 传递保存输入与旧草稿。保留原白底 UI 行为。
3. 更新实际 Electron/CDP smoke：从手动已有框切换真实贴纸，验证几何和时段保留、无第二次建框、实际预览和导出进入上传原路径。运行 typecheck、受影响测试、owned Harness/completion、AOCI，再只提交本任务文件并核对 upstream。

## Acceptance And Boundaries

目标框与最终图案占用范围明确区分；coverage 仅证明框内被不透明像素覆盖，人工观看确认最终画面，冻结批准仅授权同一批冻结版本。没有原贴纸识别保证，不修改自动 Hybrid，不加白底 fallback，不产生付费模型请求、不确认平台上传、不修改外国 ownership 文件。

## Self-Review

用户已授权修改。规格覆盖单一输入 owner、旧草稿保存、时间与区域保留、失效与原批准/导出路径。移动轨迹和空白输入 fail closed，旧任务及源片不变。实施后必须使用新证据，旧 PASS 不构成本次验收。
