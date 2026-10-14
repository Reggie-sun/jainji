# VPS Browser Performance Investigation

## Purpose

记录 2026-10-14 的单次 Chromium 性能观测，并为后续可恢复的视口实验提供官方依据。本文是调查记录，不是性能实现 spec，也不证明持续容量或平台自动化验收。

## Observed Evidence

Parent 于 2026-10-14 08:05–08:12 UTC 观测：系统 idle CPU 约 6–7%，Renderer 约 145–165% CPU；全部 CDP session 断开后该占用仍在。只有一个 Chrome 主进程和一个投放管理页面；RAM 3659 MiB、swap 4833 MiB。已认证页面资源请求为 3–254 ms，直连公共首页约 0.37–0.39 s；当前页面文档年龄约 16.7 小时。Chrome 155.0.8059.39 的 `SystemInfo` 报告 Canvas、rasterization、compositing 为 `disabled_software`。CPU profile 顶部包含 native `(program)`、`requestAnimationFrame` 以及平台 `sif-dxs-script` 回调；top sample 中未见 Jianji extension。

这些是一个短观测窗口里的相关证据，不能确定唯一根因、长期容量，也不构成实际自动化结果验收。CDP 断开后仍高占用说明外部 CDP 会话不是持续占用的必要条件，但不定位页面脚本、浏览器工作或其他来源。

## Primary-Source Findings

- Chromium 的历史渲染说明指出，非加速 Canvas 调用会由 Renderer 主线程的软件栅格化同步执行；软件栅格化也可能使用 compositor raster worker。故“software”标志支持 Canvas 主线程成本假设，但不能单独证明本页的具体调用或 CPU 根因。[Chromium trace-reading guide](https://new.chromium.org/developers/how-tos/trace-event-profiling-tool/trace-event-reading/#html5-canvas) 将软件 Canvas 描述为阻塞 Renderer 主线程；[GPU compositing architecture](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/) 描述软件 raster worker。
- 两篇渲染资料分别标有 Chrome 18 时代与 2014 年更新说明，且明确提示实现随时间演进。将其作为机制背景；当前设备的 `SystemInfo` 和 trace 才是本次版本证据，不能把旧线程结构直接当作 Chrome 现状。
- 当前 DevTools Protocol 定义 `Browser.getWindowForTarget` 返回目标所在浏览器窗口的 `windowId` 与 bounds；`Browser.setWindowBounds` 可设置位置/尺寸，未指定字段保持不变。`minimized`、`maximized`、`fullscreen` 状态不能与 `left`、`top`、`width`、`height` 同次组合。相关窗口命令标记为 experimental，须先确认目标 Chrome 暴露当前协议能力。[Browser domain protocol source](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Browser.pdl#L264-L301)。

## Testable Hypotheses

1. **Viewport-area pressure:** software Canvas/raster work may scale with visible pixel area. 在同一页面和可比负载下，记录原始 bounds、CSS viewport、device scale factor、Renderer CPU 与短 trace；临时缩小视口后重复，再精确恢复尺寸和窗口状态。若可见像素面积明显减少而 CPU、Canvas/raster 时间没有可重复下降，或 trace 显示主要成本来自与绘制无关的 JS 回调，则该假设被削弱。窗口尺寸还可能改变页面布局与站点行为，故须同时记录 viewport。
2. **Long-lived page activity:** 16.7 小时文档年龄可能与周期性回调或页面状态相关，但年龄本身不证明陈旧页面是原因。采集短时间 Renderer trace 并核对高 CPU 时间是否反复归属 `requestAnimationFrame` / `sif-dxs-script`、Canvas/raster 或 native 工作；若主要负载不能归到这些活动，或它们停止时 CPU 仍不降，则该假设被削弱。不得把重载或重启作为无证据的诊断动作。

## Reversible Window Procedure

先通过 `getWindowForTarget` 保存 `windowId`、bounds 与状态；只在明确的维护窗口运行一次短实验。若当前为最大化，先单独请求 `windowState: "normal"`，读取并保存实际恢复后的正常 bounds，再只调整宽、高。完成后恢复保存的正常 bounds，并按原状态恢复最大化。不要把状态与尺寸字段放在同一请求；失败或结果不确定时停止继续操作并核实实际窗口状态。所有请求均针对浏览器窗口本身，不更改站点设置、安全或指纹策略。

## Evidence Limits

本记录保存了短期 CPU profile 的函数耗时摘要，未保存完整 tracing 归因或长期负载记录。请求测量不覆盖 WebSocket/SSE 推送全部路径。`SystemInfo` 的软件路径提示和 profile 回调名称不足以证明平台脚本是唯一来源；短期 JS heap/DOM 数量稳定不能排除长期或 native 内存问题。性能缓解不代表账号授权、自动化任务成功或最终输出验收。

## Window Experiment And Current Mitigation

08:24 UTC 的同一页面、同一 Renderer、8 秒采样比较：原窗口 2560×1333 约 159% CPU，临时缩为 1600×1000 后约 49%，恢复原尺寸后约 155%。首个脚本的百分比显示公式少乘了 10，以上按该脚本的已知单位换算更正；后续采样保存 CPU seconds 与 wall milliseconds，避免再混淆单位。

第一次 1920×1080 尝试因窗口状态切换尚未完成，实际尺寸仍为 2560×1333；该次 161.7%／163.2% 不构成小窗口反例。08:35 UTC 等待 normal 状态稳定后实际确认窗口为 1920×1080、位置 (100,50)。随后两个 6 秒样本分别为 139.0%（8.34 CPU seconds／6001ms）和 83.8%（5.03 CPU seconds／6005ms），RSS 1866／1727 MiB。当前保留该窗口尺寸；桌面分辨率、noVNC 画质、登录、标签页与平台安全脚本保持原配置。

结果支持可见像素面积放大软件渲染开销，并形成短期缓解；1920 模式尚无长期稳定性结论，内存压力未彻底消除。后续候选是仅让 VPS 冷启动窗口默认使用 1920×1080，本机继续默认最大化，沿用原 Chrome profile／egress／生命周期。不得通过重启、刷新、结束历史 UNKNOWN 或屏蔽平台脚本伪造修复。

## Implementation Boundary

用户已决定“等另一会话完成，再由我接入窗口设置”。已修改独立的 `qianchuan-browser-manager.ts`，提供默认保持最大化、可选 remote 1920×1080 的启动参数；本轮未修改被占用的 `qianchuan-remote-worker.ts`。2026-10-14 09:09 UTC 核对时，另一会话仍在执行 VPS 连接诊断，不能把其子代理完成或文件短期不变当作整个会话释放 ownership。远端调用点未接入，尚未部署本轮启动默认值。

首次测试因并发缺模块而未能加载，不计作行为 RED。模块出现后，目标测试真实失败于缺少 `--window-size=1920,1080`；修改 manager 后该断言通过。随后 40 项 manager 回归通过，包含实际隔离 headless Chrome 冷启动返回 1920×1080、normal bounds；初始页为 about:blank，测试限制网络且不使用真实账号。本机旧参数、原 profile／class、初始页及既有生命周期保持原路径。headless 测试不等于 VPS XFCE 或真实平台自动化验收。

完整 owned Harness `20261014T090300Z-897602ad` 的 typecheck、41 文件 858 项上传回归及文档检查在该次执行中通过；整体结果为 FAIL：当前 manager Entry stale 导致 `owned_aoci_drift`，并发源码变化导致 `workspace-identity=NOT_EVALUATED/source_changed`。因此这些执行结果不能作为当前稳定工作树的 completion 证明。受管理源码仍变化，AOCI 维护按合同等待最终稳定状态，不截取批次或猜写其他会话的 Entry。本轮未提交、推送或发布；剩余工作是确认 ownership 释放、接入 worker、核对稳定依赖后重新运行适用验证，完成必要治理，再提交推送及安全部署。

09:06 UTC 再次仅采样原 renderer：76.8% CPU、RSS 1442 MiB，但 MemAvailable 328 MiB、swap 已用 5999 MiB。随后进程元数据发现两个不同账号 Chrome 主进程；原“一台 Chrome”的观测只对应 08:05 的窗口，不能沿用为当前状态。未关闭或干预另一会话的浏览器。缩小窗口减轻 CPU 的证据仍成立，内存压力没有解除；持续容量及账号串行资源释放仍需正式运行验证。
