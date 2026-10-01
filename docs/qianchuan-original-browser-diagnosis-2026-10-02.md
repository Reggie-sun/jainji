# Qianchuan Original Browser Diagnosis

## Outcome

本轮响应“为什么不用原来的六个账号窗口 / 排查下”，只读核对原 Chrome、用户 MCP 配置、启动器和软件浏览器 owner。确认两处独立原因：原窗口使用需要 Chrome 授权的调试入口；当前软件的生产准备只接受应用私有 profile，因此原窗口即使已通过 MCP 连接，也不会进入软件的新制作上传路径。本轮没有修改运行软件、账号配置或桌面启动器，没有关闭账号窗口、重传文件或点击平台确定。

## Evidence

原六个 Chrome 主进程均仍在运行，独立的 `--user-data-dir` 与用户 `.codex/config.toml` 的六个 `--userDataDir` 对应。Chrome 为 `149.0.7827.53`。进程没有 `--remote-debugging-port` 启动参数；只读 `DevToolsActivePort` 能取得 WS 地址，六个端口的 `/json/version` 和 `/json/list` 均返回 404。404 不能作为账号退出登录或 Chrome 未运行的证据。

| MCP | Original profile | Port | 本轮只读结果 |
| --- | --- | --- | --- |
| chrome-devtools | cp-acfd83ab25d8 | 37555 | `list_pages` 返回肥皂账号 1876414814643802 |
| feige-02 | cp-cd057bf702ed | 9222 | `list_pages` 返回热敷贴账号 1876956000684231 |
| feige-03 | cp-5edde22d254f | 37195 | `list_pages` 返回晚安油账号 1876294500004864 |
| feige-04 | cp-6b970cb99ac4 | 38939 | MCP 初始化完成，浏览器连接在 20 秒诊断预算内未返回 |
| feige-05 | cp-ef7f88d75759 | 38517 | 一轮初始化超时；直接运行本地同版入口后 402 ms 初始化，3.513 秒取得氨糖膏账号 1876036793517065 |
| feige-06 | cp-f05a3c16be1e | 41389 | MCP 初始化完成，浏览器连接未返回；原 WS 握手 35 秒超时，实际窗口出现 Chrome“要允许远程调试吗？”提示 |

四个成功结果分别核对官方千川 URL 的 `aavid`；它们是先后读取页面的证据，诊断结束已断开客户端，不是持续连接、可见双 ID 准入或上传成功证明。诊断 MCP 的初始化和工具期限均为 20 秒，原用户配置分别为 60/120 秒；不能把较短探针期限当成原配置必然失败。没有采用超时后的迟到结果。

首个原 WS 探针中肥皂完成 101 握手并返回 `Target.getTargets`，另五个在 7 秒握手期限内未返回。后续 MCP 的成功结果保留，不能继续把初次“五个超时”当成最终 inventory。蝴蝶贴的授权弹窗已由真实窗口截图证明；一条根的超时尚未由其自身弹窗取证，不能完全套用蝴蝶贴的归因。氨糖膏首次超时发生在 MCP 初始化阶段，尚未证明其具体延时原因。

已安装的 MCP `1.10.1` 在 `BrowserManager.#connect` 读取对应 profile 的 `DevToolsActivePort`，使用 WS 连接。日志可区分“Server connected / list_pages request”与“Connected Puppeteer”；一条根和蝴蝶贴停在后者之前。旧 `--experimentalPageIdRouting` 会打印 unknown-argument 提示，但使用该参数的三个账号成功取得页面，因此它没有解释全部连接超时。直接入口诊断只在子进程参数中去掉该提示，不改用户配置。

[Chrome 官方配置](https://developer.chrome.com/docs/devtools/agents/get-started/configuration)说明 `--autoConnect` 会要求用户允许当前调试会话，并提供从启动参数启用端口的另一种连接方式。实际弹窗与这一行为一致。仅加长超时不能实现免许可连接。

## Canonical Owners

[账号设置](../src/main/qianchuan-account-settings.ts)默认把 `discoverBrowser` 委托给 `QianchuanBrowserManager.prepare`。[浏览器管理](../src/main/qianchuan-browser-manager.ts)只匹配 `<root>/account-browsers/<advertiserId>` 的精确 profile，随后仅对这一个 endpoint 调用 discovery；原六个 profile 位于 `/home/reggie/.config/chrome-profiles/`，不符合这个匹配。用户写入 Codex MCP 的连接配置不会被软件读取。

[浏览器发现](../src/main/qianchuan-browser-discovery.ts)本身已能识别原 Chrome 的 WS 元数据，并按官方 URL 和唯一 `aavid` 匹配；它在当前 manager 路径中没有获得原六个候选。故障原因是生产准备的选择策略，不是整个发现模块完全不支持原窗口。

六个图标的 `.desktop` 实际调用 `/home/reggie/.local/share/chrome-profile-grouping/manager.py launch <profile>`。该启动器的 `launch_argv` 保留 profile、`profile-directory`、窗口 class 和首次运行选项，但没有调试端口参数；它还拒绝以 URL 参数传入浏览器 flags。直接在 `.desktop` 的 URL 部分追加 flag 不会修正这一入口。

## Repair Boundaries

若要同时满足“复用原账号登录”与“以后无需点远程调试允许”，修复需覆盖两个 owner：原启动器以相同 profile 和 `profile-directory` 从进程启动时启用 loopback CDP；软件的新制作准备优先选择已经运行且唯一匹配账号的合格连接。不读取或复制 cookie、密码或登录数据库，不按窗口图标/显示名称推断账号，原可见账号/计划核验与文件 fence 继续负责上传准入。

启动参数不能追加到已经运行的 Chrome 主进程；要使新启动方式生效，需要正常结束并重新启动对应原窗口。当前窗口可能有尚未确定的上传弹窗，不能为诊断擅自关闭。任意软件选择策略修复还应覆盖账号错配、重复匹配、不可连接候选及原冻结任务不变的回归证据。本轮只交付诊断，不把这些待实施项写成已经修复。

完整原账号批量上传仍未验收：软件尚未复用这些原窗口，一条根和蝴蝶贴的连接也未取得完整结果。本轮没有产生新平台文件动作。

## Verification And Governance

证据目录为 `.agent/harness/runs/20261001-original-chrome-diagnosis/`，包含原 WS 探针、分阶段 MCP 日志与结果、蝴蝶贴 35 秒握手结果、授权弹窗取证、源字节 hash 和 `verified-diagnosis.json`。汇总核对四个成功账号 URL、六个实时 HTTP 元数据状态，并保留此前超时记录；诊断脚本和运行资产不提交。

受管 Kimi 只读 mapping invocation `1fe69e3f-37a8-4c64-a8a2-5d73c935b0a9` 使用 deep / max 路由，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。canonical receipt 为 PARSED，两次 wire request，四个必需输入均实际完整读取，未截断。输入是封存的三个 owner 副本与初始诊断说明；其报告确认 profile-only 调用链，并指出握手原因需要真实取证。Parent 核对副本与当前源码 SHA 相同、调查实际弹窗并独立裁决；该 mapping 不作为实现 review 或平台验收。

本轮只有此记录属于提交范围，按现有 AOCI `docs` observe scope 核对，不写正式索引或 baseline。全库 Verify 结构有效但 `governance_aligned=false`，Check exit=1，Guide `complete=false`：三个命令均定位其他任务 `runs/shape-cover-course-correction-20261002/task.json` 缺索引/基线；该对象不属于本轮，不代为维护或提交，也不把全库治理说成通过。仓库没有专用 session-record Skill，复用本记录保存稳定诊断与剩余边界。文档结论逐项对照新鲜证据和源码核验，引用与副本/当前源码 SHA 检查通过；没有代码行为变更，不制造无关测试通过声明。
