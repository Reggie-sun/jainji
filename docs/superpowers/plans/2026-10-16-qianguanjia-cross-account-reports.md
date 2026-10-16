# Qianguanjia Cross Account Reports Plan

**Goal:** 在千管家历史报表统一读取全部已保存千川账户，脱离供应商目录覆盖限制，逐账户展示实际数据、缺失、失败及取消，复用原完整快照。

**Scope:** 新增历史报表来源“千川跨账户报表”，可选择全部或部分已保存账户；显式串行采集或读取历史、同身份期间比较、含缺失状态的 CSV。原供应商报表和原单账户/计划/素材查询保留，供应商目录只是覆盖对照。

**Contract Surfaces:** `captureQianchuanReport` / `listQianchuanReports` / `cancelQianchuanIntegration`，原 main account operation lease、fixed recipe、report store 和 shared schema 不分叉；采集固定 `browserAccess=existing-only`。

**Invariants:** 不启动、重启或切换浏览器及账户；不创建授权或投放写入。每次 UUID 仅发一次；单账户 180 秒；串行等待原 Promise 清理后再前进；取消阻止剩余账户且忽略迟到结果；历史 IPC 只能停止显示。失败账户独立显示，不补零、不静默重试或改走供应商。

**Data Scope:** 原 `product_roi2_promotion` 商品自选控成本报表，不代表全账户所有投放模式。金额原始单位与归因定义仍由 canonical provenance 保持 unknown，不创造金额合计或跨账户 ROI。逐账户显示实际 start/end/asOf/capturedAt；当日各账户截止不同须明示。对比只匹配相同 slot+advertiser；日期差异明示、不折算区间长度。过早 asOf 的旧日内快照不能冒充后续日期。

**Ownership:** Parent 拥有新 renderer leaf、History 接线、浏览器 fixture/UI tests、文档及 policy 自有增量；worker 仅 draft shared 纯投影与 unit tests。保留 cleanup owner 的未提交源码/测试/AOCI，正式 source freeze 期间仅忽略目录准备与独立无 Git 测试副本；收到交接后再正式应用。AOCI 必须串行完整机器批次维护，不手改 Baseline。

**Acceptance Criteria:** 不连接供应商仍列出全部已保存账户；供应商只列出一账户时仍能选择六账户。真实读取逐账户记录成功或具体阻断，不能以单账户成功宣称全覆盖。查询/历史/筛选/比较/空状态/失败/取消可执行验证，原功能 consumer 回归；非微小 UI Chrome MCP 验证，正常 app 验证与模拟独立。

## Milestones

1. 纯投影严格校验目标、完整账户快照、日期和历史范围；CSV 包含失败与缺失账户，安全转义，拒绝重复身份。
2. 原历史报表原生 source selector 接新 leaf：全账户选择、串行读取、取消排空、历史及逐账户期间比较；不增加 IPC、持久账本或队列。
3. TDD 和 browser consumer 验证后应用稳定正式源码；真实读取只用正常现存浏览器，不放宽任何身份/保护边界。按有效 owned scope 完成 typecheck/相关 Harness/completion、必要官方 AOCI、独立 review、仅本任务 commit/push 并核远端。

## Evidence Boundaries

2026-10-16 22:54 正常应用真实读取：供应商目录20账户，与本地6实际账户仅1重合；目录本页20条，其中11条精确本地回执关联。目录接口读取完整数组而非代码限制1条。当前供应商会话绑定一份 user/merchant identity；其他主体为何不在目录内尚无权限层结论，不尝试重新授权。
