# Remote Browser Implementation Plan

## Goal

按 B 路线把千川 Chrome、登录目录和文件上传放到每个主体的 VPS。本地简辑继续制作及掌握原任务、授权、fence 和结果；本地关机后自主执行不在本轮范围。

## Contract

- 原 `egress` 配置新增可选 `mode: remote-browser`，缺省保持 A 的原字节语义；主体、SSH 别名、出口 IP 及分组一致性仍由共享 schema 独占。
- 远端仅经本机严格校验主机密钥的 OpenSSH 调用固定 worker；不开放公网 CDP、接收任意 shell、同步本地 Cookie 或传输私钥。远端使用独立非 root 用户与私有目录。
- 远端 Chrome 按 advertiserId 隔离，启动/关闭/重启复用原用户操作与保护锁。SSH 转发只监听 loopback；连接丢失失败关闭，不启动本地 Chrome 回退。
- 传输 owner 使用冻结快照、SHA256、长度、原文件名及账号身份。分片落私有临时文件，校验后发布；支持显式继续时复用已传字节。选文件前完成传输，失败不创建 selection fence；已有 fence 不再执行传输或选文件。
- 保持每次最多九文件、同批上传未结束可追加、平台确定按钮不自动点击。远端路径只存在于传输/浏览器 adapter 内，不改原账本快照路径或历史 UNKNOWN。
- 远端 worker 安装独立提供构建/部署入口，不在保存设置时自动安装或收费采购。实际云端吞吐、平台状态及人工登录不由本地测试替代。

## Ownership

Parent 负责共享 mode、SSH runtime、browser manager/settings、uploader integration、UI 与部署文档。可将新远端文件接收模块及专用测试交给单独 bounded worker；不修改已有清理功能或其脏测试。Kimi 对现有上传/fence 边界只读调查，最终稳定候选按 Risk Gate 独立审查。

## Milestones

1. 冻结共享协议并实现可恢复文件接收、远端 Chrome worker、严格 SSH transport；测试路径越界、错 hash、截断、取消与配置冲突。
2. 接入原设置与浏览器管理、传输前置 hook；保持本地路径兼容、未知结果屏障及不回退约束，提供 UI 模式与部署入口。
3. 跑 typecheck、上传/账号/出口回归、隔离 Chrome 集成与 UI 检查、owned Harness；完成必要审查、AOCI、本任务提交与远端 HEAD 核对。

## Acceptance And Limits

隔离 fixture 证明远端路径文件选择、分组、校验和断线拒绝；真实 VPS 尚无连接资料，不作真实平台/速度验收。人工登录通过远端桌面，已有浏览器窗口不自动关闭或迁移 Cookie。本地调度持续在线是明确运行条件。

## Self Review

只增加远端执行机制，不引入第二队列或授权账本；保留 A 兼容以解释旧冻结任务，B 不静默降级 A。带宽瓶颈由传输实现及实测证明，不承诺 200Mbps 持续速率。原大型 service 只增加 adapter hook，领域实现独立成模块。
