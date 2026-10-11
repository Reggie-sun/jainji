# Compressed Confirmation Receipt Implementation Plan

**Goal:** 修复真实千川批量确认因压缩响应缺少 `Content-Length` 而被错误阻断的问题。

**Scope:** 原回执解析器、受控错误提示、回执单元测试与九文件隔离 Chrome HTTP fixture。保留原任务、队列、确认 owner 和全部历史未知屏障。

**Contract Surfaces:** `qianchuan-confirmation-receipt.ts` 独占被动请求/响应核验；`qianchuan-page-contract.ts` 只传播解析器自有的固定安全错误。fixture helper 仅提供本地 HTTP 响应 seam。

**Invariants:** 同源同 frame、账号/计划、完整冻结文件名、唯一视频 ID、恰好一对 POST、双 HTTP 200 与数字 `status_code === 0`、取消及超时门保持。旧 UNKNOWN 不补接受、不重新选择或确认；不记录响应正文、签名链接或未知异常原文。

**Current / Target Behavior:** 真实九文件绑定响应为 Brotli，缺少长度头即被错误判为超限。长度头改为可选；存在时仍拒绝非法或超过 1 MiB 的声明，解码后正文始终核非空及 1 MiB 上限，再解析 JSON 与平台状态。此上限是正文准入限制，不宣称 Playwright 读取期间的峰值内存上限。

**Compatibility:** 不变更持久 schema、恢复资格或平台点击次数。原历史 checkpoint 保留，并追加当前合同 delta。

**Out of Scope:** 重传此前两轮未知的十八条；浏览器连接性能重构；修改其他会话拥有的 upload store/schema/spec。

**Acceptance Criteria:** 无长度的有效压缩响应能为九条完整冻结素材返回证据；超限、非法声明、平台拒绝与身份不符仍失败关闭；一轮新制作的十条真实成片全部由原自动化路径接收。若真实测试阻断，准确保留未知结果，不用 fixture 代称平台验收。

**Verification:** red/green 回执和页面测试、typecheck、owned Harness/completion；新十条真实调度测试和只读账本/文件身份核查。Linux 证据不代替 Windows 或审核、投放与人工观看验收。

## Major Milestones

1. 用真实 HTTP Brotli/chunked fixture 复现缺长度问题，补齐解码超限与非法声明拒绝测试。
2. 在原解析 owner 修复可选长度头，保留仅固定安全诊断；验证当前候选并用新成片真实测试。
3. 记录证据和风险审查决定，维护本轮 AOCI 对象，通过 owned completion 后提交推送并核远端。

## Self-Review

任务内协议兼容修正已按用户“继续解决”授权评估。缺少可选 HTTP 长度头不是平台失败证据；实际正文与原身份核验仍必须通过。新测试不消费或改变旧未知任务，方案无需新增恢复 authority 或第二确认通道。
