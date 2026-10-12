# VPS Native URI Compatibility Record

## Scope

2026-10-12，用户报告千川网页在南京 VPS 反复出现 `Failed to open URI / Operation not supported / bytedance://dispatch_message/`。本次只修复专用 Linux 网页桌面的原生客户端唤起兼容；沿用 [远端浏览器 owner](qianchuan-remote-browser.md)，不改变上传、确认、账号串行、出口或账本的权限。

## Evidence And Resolution

Chrome 已允许千川来源打开 `bytedance` 协议，而系统没有可用默认 handler。修复前，现场 `gio open bytedance://dispatch_message/` 返回 exit 2 和 `Operation not supported`；XFCE 的 `exo-open` 同样产生截图中的错误窗口。

新增 `RemoteDesktopProtocols`，桌面同步自动调用它，另提供固定 `--desktop-repair` 入口处理已打开的浏览器。专用用户只在没有其他默认应用时注册自有隐藏 desktop entry，固定 `Exec=/usr/bin/true %u` 将 URI 作为无副作用程序的参数忽略。现有真实客户端默认关联保持原样；链接、外来 entry 内容、不安全目录/文件权限、残锁或登记验证失败均拒绝。

初版使用 `xdg-mime query` 判断登记结果，现场发现它会返回声明支持该 MIME 的条目，却没有使 GLib 获得可启动的默认关联。该结果不能作为成功证据。最终改用 GIO 查询、设置并复验有效默认应用，XFCE 实测通过。`%u` 是 GLib 识别 URI 支持所需的占位参数，直接交给 `/usr/bin/true`，不经过 shell。

## Live Verification

- 部署前确认简辑自动化空闲；只更新 worker 并运行桌面修复入口，没有重新选择素材、平台点击、导航或重启 Chrome。
- 最终 worker 本机与 VPS 的 SHA-256 一致：`5afe443d2e04b4c56e8056a3cc3fc0d0bba44997043d7bee2bee3810be32d776`。旧 worker 另存备份。
- 修复后，`gio open` 和 `exo-open` 打开同一 URI 均 exit 0；窗口清单无协议错误弹窗。`exo-open` 的 AT-SPI bus warning 不影响返回结果。
- 原 Chrome PID `2304429`、窗口 `0x02200003` 保留。后续用户另开的窗口保持原样。
- 简辑只读复核本轮 30 条均为 `WAITING_FOR_CONFIRMATION / READY`；原上传账本修复前后 SHA-256 相同：`176b78819dde739ae39379fc12f66425b6ec39b89a529ed6b9dca84e738a63cf`。
- 现场只收紧专用用户已核实目录和 MIME 文件的组/其他用户写权限，没有改动浏览器资料或登录凭据。

## Software Verification

`npm run typecheck` 与 `npm run build:qianchuan-remote` 通过。`qianchuan-remote-desktop`、`qianchuan-remote-runtime`、`qianchuan-remote-desktop-panel` 共 18 项测试通过。覆盖新增账号/重复同步、保留已有客户端、外来 entry 冲突、链接配置/父目录、登记后复验失败及原 RPC/桌面行为。

集成 seam 的 red 证据为桌面同步尚未调用协议 owner 时，预期四次 `ensure`、实际零次；修复后通过。真实系统 red 为修复前 GIO exit 2；最终 green 为 GIO 与 XFCE exit 0。类型检查发现环境对象推断丢失索引签名，补明确 `NodeJS.ProcessEnv` 后重新通过；构建字节保持一致。

## Independent Analysis

受管只读 Kimi 分析 invocation `9c73d6d8-4b6b-44bd-8c0e-ebe4e9f75041`，sealed contract `c869a9d7-0687-4b47-aab0-18696ae21f48`，仅包含冻结源码，不含登录数据或私有账本。其缺失 OS handler、保留 Chrome、拒绝外来关联建议由现场与源码核实。其“不传 `%u`”建议未采纳：GLib 的 URI 支持及现场成功结果证明必须保留该参数。没有另写 MIME 配置解析器，使用 GIO 的既有登记机制。

这是诊断分析回执，不是最终 implementation review，也不证明平台上传被接受。最终 Risk Gate 在项目验证后单独判断。

## Limits And References

此网页专用处理忽略所有 `bytedance` 原生客户端链接，不能提供对应客户端功能。若以后安装客户端，需选择其默认关联。它不影响 HTTPS 网页或 VPS 出口；本次未执行新的真实上传，也未改变已有 READY 记录为 ACCEPTED。

协议关联依据 [Desktop Entry Specification](https://specifications.freedesktop.org/desktop-entry/latest-single/) 和 [MIME Applications Specification](https://specifications.freedesktop.org/mime-apps/latest/)。现场 GIO/XFCE 结果而非条目声明决定本次兼容验证结论。
