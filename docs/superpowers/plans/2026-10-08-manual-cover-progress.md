# Manual Cover Batch Progress

## Goal

用户反馈未框选素材被要求逐项确认不覆盖，已框选后长期只显示准备。取消 manualRegionInput 的空区域确认门；让真实匹配进度可见，并缩短本地随机模式首个素材的准备等待。

## Evidence And Owners

`manualReviewInput` 的空区域异常阻止整批保存；`CoverReviewPanel` 用 busy 文案覆盖状态并排除了 `CoverReviewProgress`。实机 22 素材 / 66 版本运行中，首个版本在约九分钟后 prepared，界面仍没有数量进度。`createHumanRegionCover.round` 为首个版本先匹配所有素材，随机模式各素材独立却仍共享该屏障。

## Scope And Compatibility

- shared 手动输入 owner 将无有效框的素材投影为 no_cover，不要求额外点击。保留通用框继承、固定时段及移动轨迹拒绝；旧 assisted 的未决问题 gate 不变。
- 原 `CoverReviewProgress` 展示抽帧数量、版本数量、当前素材和停止；真实贴纸文案不冒充模型分析。准备中的中间冻结版本不可提前批准。
- 本地随机覆盖按素材缓存目标与版本匹配，保持同素材不同图案和版本轮换。真实22素材检查在第15条第二版撞到原整批512次预算；修订为随机每素材跨版本512次、每素材每版10分钟/4096组合，总匹配上限512×所选素材数。统一款模式继续整批匹配及原整批预算；coverage、binding、批准、导出及 CDP 上传保持。
- 不更改正在运行任务的冻结输入，不自动重试或提交用户生产任务。

## Verification

先复现默认空区域与跨素材预匹配阻塞；运行 focused tests、typecheck/build、隔离 Electron 多素材交互与实际导出/CDP fixture。实际界面可查看准备数量并停止，未框选素材无需确认。按 owned scope 执行 Harness/completion 与 AOCI，再提交推送核对远端。

## Self Review

用户明确要求取消逐素材不覆盖确认，覆盖声明仍只证明目标框。随机模式跨素材无选材约束，拆除整批屏障不改变候选顺序或冻结字节语义；统一款模式不拆。保留全部版本最终确认，不把源画面误称最终预览。
