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

## Directory Failure Follow-up

用户随后报告所有子账户控件显示读取失败。真实应用 IPC 复现了三个原因：只读目录错误复用切换保护，因旧 UNKNOWN/fence 任务拒绝观察；多个已挂载控件与计划读取互相被判为繁忙；网页悬停菜单延迟渲染，或保留目录视图直接出现，程序却只等待“切换账户”按钮。

读取目录现在只合并相同代际、保存账号及锚点的在途请求，返回独立副本，不缓存已完成结果。允许只读计划与目录同时读取；真实制作、上传、账号修改、关闭和停止仍持续阻断观察或使在途结果失效。显式账户切换继续使用原同浏览器任务及永久屏障保护，没有修改旧 task、intent、目标或保存映射。悬停后等待目录或切换按钮实际出现，完整目录、空搜索、双快照、当前网页身份和单次精确切换检查保持原合同。界面显示安全的业务失败原因，原始端点/调用日志仍使用通用提示，刷新由用户明确触发。

多窗口菜单互相干扰曾是调查假设；最终 DOM 证据定位到菜单视图保留，未保留该假设产生的全局目录串行队列。隔离 Chrome 的即时/延迟直接目录用例在修复前均 FAIL，修复后与按钮布局、分页和单次切换用例共同通过。三个受影响测试文件最终 77/77 PASS，当前工作树类型检查 exit 0。

实际运行应用公开 IPC 对氨糖膏、肥皂、滴耳康和热敷贴各发出三个同时读取请求，四组均成功且同组结果一致，各包含 20 项；当前 reggie 子账户为 `1876039035222536`，未错用保存锚点 `1876036793517065`。读取前后公开上传状态完全一致。未在真实账号执行切换、文件选择、确认或删除。未连接的两个 VPS 浏览器仍需对应连接可用，没有自动重连或本机回退。

受管 Kimi mapping invocation `b5f9de24-d7e6-4aad-81ca-629177684b0f` 使用 qualified Docker deep/max route，3 次请求，PARSED。Parent 接受在途合并与业务错误展示建议；按真实 fence 和跨账号连接证据拒绝等待全部计划完成、自动重试及放宽切换保护的方案。该输出为调查证据，最终 implementation Risk Gate 另按稳定快照和 project-native 验证裁决。

本次补充仍有 durable value；继续使用当前记录，验证和只读运行旁证保存于忽略目录 `.agent/harness/runs/20261013-child-directory-failure/`，最终 Harness、AOCI 和远端 SHA 以本次稳定候选为准。

## Membership Recovery Follow-up

用户再次报告全部计划失败、子账户等待网页核对。实时证据发现会员已恢复 `allowed/grant`，公开计划 IPC 对氨糖膏成功返回当前子账户 `1876039035222536` 和一项计划，但页面仍有 14 条旧的会员核验错误。`MembershipGate` 在网络故障期间保留工作区；计划组件未订阅权限恢复，因此其错误和空账户一直保留。

`QianchuanPlanSelect` 现在只在观察到 `unavailable -> allowed` 时通过原 revision 和请求租约重新读取目录；重复 allowed 通知不重复读取，忙碌或切换中延后到空闲，新的非 allowed 状态撤销待刷新。读取仍经 main 在线会员准入，恢复不会选择计划、切换网页、启动制作、继续上传或改写旧冻结目标。保留原取消和迟到响应隔离。

新增两项真实组件浏览器用例先 FAIL、修复后 PASS，覆盖恢复、重复通知、忙碌延后、子账户目录恢复和无自动选择/切换。会员准入原测试保持通过。Chrome MCP 隔离页面观察到读取次数从 1 到 2、子账户目录从 0 到 1，随后明确选择计划并重复发送 allowed，读取仍为 2；此模拟 IPC 证据不代表真实平台上传。

受管 Kimi mapping invocation `c91155f9-7a71-427a-8b58-b67f7662c4dd` 使用 qualified Docker deep/max route，2 次请求，PARSED；Parent 核验 canonical receipt、实际源码读取与工件 SHA。采纳源绑定的恢复边沿和循环风险分析，沿用既有请求租约及测试 seam，没有增加第二读取 owner。它是调查而非最终 implementation review。

运行期间会员服务再次不可用，应用显式只读核验仍返回 unavailable；公开 `/v1/membership` 请求曾返回 HTTP 403、Cloudflare `error code: 1034`，而 `/health` 随后的请求为 200。当前证据只证明核验路径有外部阻断，不断言 DNS、代理或服务端配置中的具体归因，也未绕过准入。只读刷新前后上传公开状态一致；目录实际恢复仍依赖核验请求成功。

本次达到有 durable value 的修复及验证 checkpoint，仓库没有专用 session capture skill，继续使用本记录；回执在忽略目录 `.agent/harness/runs/20261013-membership-plan-block/`。最终 Harness、AOCI、Risk Gate 与 upstream SHA 以稳定 owned 候选为准。
