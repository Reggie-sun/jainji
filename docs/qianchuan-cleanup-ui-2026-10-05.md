# Scope

根据用户截图将千川清理界面整理为手动素材清理与每日自动清理两张卡片。改动仅在 renderer 展示与调用现有 API，未执行真实删除或修改真实定时配置。

# Behavior

- [手动清理](../src/renderer/QianchuanVideoLibraryActions.tsx)：账号多选，默认全部可用账号；计划三类默认选中，全视频库默认未选。空账号或空范围不能执行，确认显示冻结目标、范围和影响；取消不调用删除。三种范围分别映射原三种 confirmation。
- [每日任务](../src/renderer/QianchuanVideoLibrarySchedule.tsx)：首屏展示保存状态、24 小时时间、清理范围与绑定数量。设置、运行条件、ID 与详情按需展开。保存仍显式启用当前目标，关闭保留原绑定。旧任务的删除范围不扩大。
- [执行结果](../src/renderer/QianchuanCleanupResults.tsx)：先显示完成与未完成数量，未完成账号始终提示，详细原因与原消息可展开。未新增自动重试。
- [局部样式](../src/renderer/qianchuan-cleanup.css)：复用现有设计变量，单一操作按钮，最终删除确认用独立危险色。

# Verification

- 类型检查与现有上传 UI、清理共享合同、每日任务共 29 项测试通过。
- Chrome MCP 加载实际 React 组件和实际样式，使用独立测试 DesktopApi；核对默认范围、空选择禁用、取消零调用、部分账号选择、三种 confirmation 及 expectedAdId、每日显式保存与关闭绑定。真实后台不在该 fixture 验证范围内。
- 1280 与 800 像素桌面宽度检查；800 像素无横向溢出。应用现有最小宽度为 760 像素，未变更。

# Independent Investigation

受管 Kimi 只读旧 UI 与设计 brief：invocation 70f77c94-fd16-4a72-aa0e-e99928a36198；seal 0fb207f60fd411c2b7b01915441a4fc1d9723b67bdde15777f1eccf22bd9b606。两次 authenticated k3/max 请求、Docker 与四个完整 Read、report SHA 核验；不视为最终实现或运行验收。

Parent 采纳明确危险确认色、双范围分别说明后果。定时另加确认步骤的建议不采纳：本轮保留已有显式保存合同，当前目标与既有绑定可展开核对，后端 expected ID 不匹配仍拒绝执行。后端保护未放宽。

# Review Risk Gate

本轮未改变主进程删除、目标准入、持久状态或 unknown 恢复规则。浏览器交互已核对三种授权 payload、取消、空选择与原定时 scope；未发现 verification 后仍需 independent adversarial review 的重大语义缺口，判定 KIMI_REVIEW_NOT_REQUIRED。Parent 保留最终 diff、交互与 completion 裁决。
