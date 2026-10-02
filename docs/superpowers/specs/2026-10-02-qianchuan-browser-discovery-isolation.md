# Qianchuan Browser Discovery Isolation

## Goal And Authorization

用户要求从软件根本修复连接能力。此前精确 profile 扫描只保护已绑定账户，本修订让首次绑定和端点发现同样隔离其他浏览器的已知连接故障。按当前任务授权完成 Parent self-review，允许实施；没有额外用户批准步骤。

## Contract Delta

`qianchuan-browser-discovery.ts` 仍独占运行进程和账户连接发现。全量扫描中，可识别到确切 profile 的浏览器若调试元数据无效或不安全，保留其进程/profile 身份及固定失败类别，不授予 endpoint。不得修权限、复制登录信息或把失败候选当成成功。精确 profile 扫描对目标异常仍失败关闭；无法归属的扫描错误及资源上限仍阻断。

常规 HTTP 候选的账户探测逐候选结算，其他候选的网络错误、重定向、超时或非法响应不能抹除目标已取得的精确官方 `aavid` 正证据。无匹配且存在探测故障时报告连接不可用；明确无匹配报告缺少目标。多个正匹配、同目标 profile 的重复进程/失败成员及同端口的相互矛盾结果均拒绝。

只有唯一、安全且明确匹配目标账户的原 profile 可由原 manager 保存绑定。其他无法读取的 profile 不获得目标归属，既有绑定不换目录；找不到明确原目标且仍有无法识别的原窗口时不另建登录目录。`connectionIssue` 是内部诊断，无路径或原始错误进入 renderer。

## Invariants And Limits

保留现有 UID、规范路径、私有目录、bounded read、no-follow、loopback、拒绝重定向、进程与端点数量、HTTP deadline 和取消边界。缺 CDP 的原 Chrome 仍须通过已有明确确认的“重启并连接”流程，不自动重启或关闭真实窗口。

复用原绑定、service/store、上传 fence 和 page contract；浏览器发现不授予上传、文件选择、确认或发布权限，不清 UNKNOWN，不更换已冻结任务地址。Windows 资格保持原边界。

## Acceptance And Self-Review

无绑定、有效目标与已知无关不安全浏览器共存时，可自动建立正确原绑定并连接；无关 HTTP 故障不阻断明确目标。目标损坏、目标重复或不存在仍正确拒绝。HTTP/WS 同端口错误不得借其他形式旁路。

Self-review：未知候选不作“已证明无目标”结论，仅无连接资格；实际文件动作仍由所选原目标的可见双 ID 和永久 fence 独立决定。失败隔离限定可归属的 browser/endpoint，不把扫描不完整或资源超限变成成功。独立审查 Risk Gate 在最终可执行验证后按实际后果及验证缺口评估。

验证使用进程/HTTP fixture、原 manager 的首次绑定接缝、真实本机只读发现、typecheck、受影响测试与 scoped Harness；真实制作和上传不在本次诊断授权内。
