# Cover Entry Simplification

## Goal And Scope

按用户本轮“修改”授权，将 CoverStickerPanel 的新操作入口收敛为“手动框选”和“自动识别”。手动直接复用 human-region-v1 + manualRegionInput，框选、保存、正常制作；不加白底、不强制预览、无框素材不要求确认。批量复用已有 real-artwork 选项，统一显示名称。

## Ownership And Compatibility

主线程拥有 CoverStickerPanel、BatchProductionPanel 和相关 browser smoke。不修改其他会话的千川恢复、Harness policy、共享业务源码。旧 manual、assisted 与近似自动设置打开时保持原语义并显示旧设置说明；显式切换才修改未保存草稿，恢复按钮可撤销。普通 assisted 的已有人工区域切换时带入目标框，但不带入批准权限；多关键帧仍由现有校验拒绝，不能压平。冻结任务、旧批准、compiler、queue、coverage gates 不变。新选自动使用既有 shape-matched-static-v1，当前自动设置保持其原策略，不能自动 fallback。

## Acceptance And Verification

- 新选择只有两个按钮，不再有白底/真实贴纸二级模式；手动选择立即出现已有框选编辑器。
- 保存手动框为直接制作标志；空区域可保存，切换自动后保留手动区域草稿，关闭覆盖不清草稿。
- 旧设置不因加载被改写，旧审阅区域可显式带入，时段/多关键帧不丢失。
- 跑 typecheck、相关 Harness、cover-toggle 浏览器交互、assisted-cover-upload 接缝；Chrome MCP 查看实际 React fixture。此 UI 修改不声称新算法或原视频视觉验收。
- 最终 diff、AOCI 官方维护和 completion 后只提交 owned files，push upstream 并核对远端。

## Self-Review

两入口是呈现与显式转换，不是删除持久 enum 或放宽准入。历史能力只在已经保存的旧配置中保留，不新增隐蔽 fallback。Kimi 只读兼容核查与 parent 验证分开。CodeGraph 已刷新；对 filter/call 同名误连边以实际 import/callsite 核对，不依赖错误跨模块关系。
