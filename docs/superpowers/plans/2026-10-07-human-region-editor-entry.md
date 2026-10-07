# Human Region Editor Entry Repair

## Goal And Evidence

用户截图选择人工区域模式后只有说明、旧素材选择和“已覆盖”，没有可见框选工具。`App` 将 `CoverReviewPanel` 挂在完整 `TemplatePanel` 之后；模式在 `CoverStickerPanel` 仍是本地未保存草稿时也不挂载。旧素材状态来自 manual regions，并非人工区域审阅状态。之前 UI smoke 通过 IPC 预设模式，未覆盖真实入口。

## Scope And Owners

保留 `CoverReviewPanel` 作为唯一框选、草稿、预览与批准界面。由 `App` 在覆盖设置卡片内组合现有面板，移除表单末尾的旧挂载位置。`CoverStickerPanel` 显式引导保存并打开框选；未保存模式不允许编辑旧审阅，assisted 不再显示无关的 manual 素材选择/“已覆盖”。`TemplatePanel` 更新位置提示。未建稿时提供原片和明确开始入口；不自动调用模型、创建正式任务或上传。

## Invariants And Compatibility

原 main 草稿 revision、修改失效、全部预览查看、明确批准、原 compiler/queue/CDP 上传均不变。已有人工/assisted 草稿继续复用，切换模式不删除草稿；旧 manual/agent 编辑保持原行为。未保存设置必须先保存，失败不能进入旧模式编辑。原音频、时长、顺序、自动掩码/H4 与平台确认边界不变。

## Implementation And Verification

1. 在上述 renderer owners 调整组合和入口，保留一个实际 editor 实例，去掉人工模式的旧覆盖完成假象。
2. 修改 `scripts/assisted-cover-upload-smoke.mjs`：从旧手动模式通过真实按钮切换和保存，断言 editor 位于覆盖卡片且在制作 footer 前；原片可见、无旧“已覆盖”；实际拖动框并核验变化，再准备预览、确认及隔离 CDP 上传。继续使用隔离 Electron、原后端、真实 FFmpeg、本地平台 fixture，不使用真实账号。
3. typecheck/build、相关 Harness、实际 UI、AOCI 和 completion 对应当前 bytes；按风险门决定 review。只提交 owned files/索引条目，push upstream 并核验远端。

## Self-Review

这是已授权人工区域能力的可达性修复，不扩展匹配策略或批准生命周期。必须检查未保存模式、已有草稿和模式切换，不以静态文本断言替代实际点击。CodeGraph 已检查 App 关系；其 JSX 组件关系不完整，挂载条件以源码与真实 DOM 为准。受管 Kimi 仅只读核查 UI 接缝，冻结期间不编辑其四个 source files。

## Execution Evidence

旧构建的实际点击在人工模式仍出现 manual “已覆盖”处失败；修复后真实入口、卡片内原片、唯一编辑器、鼠标拖动持久化、切换模式后恢复同一草稿、预览及隔离 CDP 上传通过。联调发现吸顶导航遮住自动滚动目标，为审阅入口补上同类页面的滚动留白；鼠标验证先确保目标未被导航遮挡。最终界面回执 `/tmp/jianji-cover-upload-smoke-Faog5W/report.json`，不使用真实账号。Chrome MCP 当前连接的是用户业务浏览器，实际应用交互使用已有隔离 Electron/Playwright 驱动，不操作这些真实业务页。

Kimi invocation `e3497998-aa35-43ec-b5cd-35005997b12e` 的第二个 wire response 未完整结束，`OUTCOME_UNKNOWN`，没有报告可采用。保留两次请求和 canonical receipt；不自动重试。Parent 通过源码、CodeGraph 和实际红绿验证独立定位；这次调查不替代 final review。最新 Harness、风险门、AOCI 与交付回执放在 `.agent/harness/runs/20261007-human-region-editor-entry/`。
