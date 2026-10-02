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
