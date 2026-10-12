# Qianchuan Child Account Selector

## Scope

用户确认在上传准备区直接选择千川网页子账户，随后自动切换网页并读取对应计划。已有 60 条任务保留原冻结账户和计划，选择只用于下一批制作。用户已允许在 `src/main/index.ts` 和 `src/main/preload.ts` 保留其他自动化改动，只增加两个子账户接口。

## Behavior

子账户目录从已保存登录浏览器的唯一可见千川页面读取，展示完整名称和 ID。必须滚动至平台“没有更多了”并两次核对完整目录；搜索未清空、歧义页面或身份变化均停止。显式选择核对旧账户、目录项与原 document，只点击一次，随后核对新账户。成功清空旧计划并重新读取，用户需明确选择新计划。

沿用原 `DouyinUploadService` 控制锁、账号设置 owner 和制作准入。正在制作、上传、待确认、带文件选择屏障或结果未知的同浏览器任务阻止切换。稳定且未选文件的旧暂停任务不被恢复或改目标。VPS `remote-browser` 的跨保存账户切换仍拒绝，须先保存对应绑定；没有放宽远端文件及上传权限。

## Evidence

- 真实千川网页只打开和滚动子账户目录，观察到 20 项及末尾标记；没有在真实账号中切换账户、选择文件或确认上传。
- 隔离 Chrome 使用平台观察到的 DOM 结构，验证分页完整目录、缺失目标、guard 拒绝、精确一次切换、旧账户漂移以及其他标签页保留。
- 当前账号、服务及 UI 三个测试文件覆盖目录、显式切换和旧任务保护；服务测试核对旧 task、intent 和保存映射字节不变，带永久 fence 的未知任务在浏览器切换前被拒绝，包括已切到其他子账户的同浏览器。测试数量及最终类型检查由本轮回执持有。
- Chrome MCP 在隔离 renderer fixture 实际选择旧计划、切换子账户、核对切换期间清空选择和禁用计划、成功后读取新计划；布局说明与子账户控件间距 4px，无重叠。此证据使用真实组件和模拟 IPC，不代表真实上传验收。
- 首次完整 Harness 发现两个 Node 静态渲染用例因组件直接读取 `window` 失败。增加运行环境判断后，静态渲染、服务及交互三个文件 72/72 PASS，类型检查 exit 0；首次 FAIL 回执保留，最终重新运行完整 Harness。
- 受管 Kimi mapping invocation `48ed386c-eab7-4fba-9183-1c942fd0bd6c`，Docker qualified deep/max route，3 个请求、PARSED；Parent 核对保护条件后实现。mapping 不是 implementation review。
- AOCI 正式完整 10 项批次维护及规模字段纠正已 Apply；Verify、Check、Guide 完成。上下文刷新输出截断，未声称完整系统认知验证成功。

## Checkpoint

这是有 durable value 的产品实现及浏览器验证；已评估 session capture routing，仓库未提供专用 capture skill，使用本记录保存范围与验收边界。最终 Harness 与 Review Risk Gate 回执保存在忽略目录 `.agent/harness/runs/20261013-child-account-selector/`；交付前核对对应稳定候选和 upstream SHA。
