# Bound Profile Connection Repair

## Incident

氨糖膏单独制作在 `agent.start` 的账号预检中报告“无法完整连接千川浏览器”。主进程堆栈停在 `runningChromeBrowsers → QianchuanBrowserManager.endpoint`，尚未进入制作或文件选择。

本机复现发现扫描失败来自另一个项目的 Chrome PID `619894`：其调试目录权限为 `0775`，不能通过原有安全校验。氨糖膏已绑定的原 Chrome PID `953628`、`Profile 11` 正常运行，HTTP `/json/version` 返回 200，千川页 `aavid=1876036793517065` 匹配。

## Repair

`runningChromeBrowsers` 增加可选精确 profile 过滤，在读取调试元数据前排除其他目录。原 browser manager 对已有绑定的连接、启动轮询与控制复用这一过滤；未建立绑定时仍保留原全量发现与歧义拒绝。目标权限、元数据、窗口身份、重复进程及上传屏障校验保持原语义。

新增回归先复现两项失败，再验证无关不安全目录不阻断已绑定账户、目标损坏仍拒绝、同目录重复进程仍保留，以及 manager 的实际过滤传递。用户授权保留已有测试改动，只修正两项真实 Chrome 测试的目录扫描。

## Evidence And Limits

`npm run typecheck` 成功；三项浏览器测试文件共 59 个测试通过，含隔离 Chrome 的连接与正常退出/重启。修复代码在本机执行原 manager 的 `prepare`，成功返回氨糖膏原端点 `http://127.0.0.1:34587`。开发进程已自动重建并正常重启 Electron，原账户 Chrome 未重启。

没有选择文件、点击确定、修改广告设置或清除未知上传结果；上述连接证据不代表制作、上传或平台验收。未绑定账户仍可能因全量发现中不安全的浏览器元数据失败关闭。

受管 Kimi 只读调查 invocation `7c1d2a9e-82d6-436a-bc30-81866b86fa38` 在第二个上游请求发生 `CONNECTION_ERROR / RESPONSE_HEADERS`，canonical receipt 为 `OUTCOME_UNKNOWN`，未采用部分输出、未重试。Parent 独立核查实际根因、最终 diff 和回归证据。最终审查 Risk Gate 不触发：过滤缩小既有绑定的扫描范围，没有修改文件选择/退出授权或持久生命周期，目标身份与安全失败路径由相关测试覆盖。没有把该调查声称为独立审查通过。

已评估 session capture：仓库未提供专用 capture skill，本文件按现有事件记录目录保存本次可复现故障及证据。源码两项为 AOCI index；测试和此记录按既有 observe role 处理，不扩大索引。

## Software Discovery Capability Delta

用户随后要求从软件根本修复。按 [Discovery Isolation Spec](superpowers/specs/2026-10-02-qianchuan-browser-discovery-isolation.md) 与 [Implementation Plan](superpowers/plans/2026-10-02-qianchuan-browser-discovery-isolation.md)，全量扫描保留可归属 profile 的故障记录，逐端点结算账户探测，唯一明确目标不再被无关元数据、网络或重定向故障否决。目标自身异常、同 profile 重复进程、同端口矛盾、无法归属错误及资源超限仍拒绝；没有目标正证据时不把故障原窗口当成不存在。

新增回归先得到 10 项失败，修复后 typecheck 及四个相关测试文件共 118 项通过，包含首次绑定原 profile、损坏目标不启动/不退出、真实 loopback 重定向隔离和原隔离 Chrome 行为。再次只读检查本机全量 10 个浏览器，PID `619894` 单独标记 `METADATA_UNAVAILABLE`；全部 6 个账户均精确匹配其原 profile，原 manager `prepare` 成功。氨糖膏仍为 PID `953628`、端点 `http://127.0.0.1:34587`。真实账户启动、文件动作和确定次数均为 0；开发进程自动重建并在空闲后加载新代码。

受管 Kimi invocation `f84c97e7-4453-4fdb-945a-0b7cd5406496` 完整读取三项源码/测试后返回调查报告，2 次上游请求均身份验证为 `k3 / max`，无自动重试。Parent 采纳故障记录及独立探测建议；未采纳“无法归属 cmdline 错误也直接跳过”，该路径仍拒绝。调查不是最终独立审查或平台验收。

本轮再次评估 session capture，继续使用本事件记录。两项源码维护正式 AOCI Entry/baseline；测试、Spec、Plan 与事件记录沿既有 observe role。完整机器批次同时出现另一个会话的三个已受管快照，按官方完整批次原子维护其认知，不改快照业务内容；本任务提交仅选自己的源码及对应索引 hunks。AOCI 全量认知传输曾被宿主长度截断，没有宣称完整系统认知；文件治理证明单独核验。
