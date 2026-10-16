# Qianguanjia Real Account Effects Implementation Plan

**Goal:** 在千管家原生页面中，以真实上传回执冻结的账户和计划采集完整素材效果，保存原报表快照，并精确关联本地成片。

**Scope:** 素材中心展示实际账户与供应商目录的覆盖差异；按明确选择的目标和日期调用原千川只读采集入口；读取已有快照、精确关联效果、跨目标查看并导出去重 CSV；失败、取消、身份变化及空态完整。

**Owners:** `QianguanjiaQueries` 原本地上传投影；`QianchuanIntegration.capture/history` 原报表生命周期；`QianchuanReportStore` 唯一持久 owner；`joinQianchuanEffects` 及原 CSV exporter 唯一关联与导出 owner。复用 `DesktopApi`，不建立新的网络、账本、采集队列或投放控制链。

**Invariants:** 仅有效 ACCEPTED 回执建立目标；按原 slot、advertiserId、adId 以及 platformVideoId 关联，不按名称。供应商目录缺失不能隐藏实际账户或变成隐式替代请求。账户槽位已重绑、busy、UNKNOWN 或其他原 guard 阻断不放宽。只有完整同范围快照可发布指标；没有快照、未匹配和接口未提供不填零。不会新授权供应商、上传、调整投放或重启运行任务。

**Audit Baseline (2026-10-16 20:31 CST):** 当时正常实例真实账本 7,372 条、196 条接收回执涉及 6 个账户；千管家目录只覆盖其中 1 个账户、12 条记录。最近按摩油 50 条本地字节及回执核验全部通过，但该账户不在供应商目录。当时本地历史报表快照为 0。对照组 9 条在供应商目录精确匹配，不替代最近批次验收。

## Milestones

### Actual Target And Coverage Projection

新增 `src/shared/qianguanjia-effect-targets.ts`，消费原公开上传结果、当前账户配置摘要和可选供应商目录，严格核验后按冻结原 slot/账户/计划分组。输出接收记录、唯一视频数量、目录是否包含与当前保存槽位是否可读；所有名称仅显示。通过纯函数测试证明未知目录不同于缺失、不同计划不合并、重绑不准入、READY/UNKNOWN 不晋级及冲突身份拒绝。

### Native Material Effects View

新增 `src/renderer/QianguanjiaEffects.tsx`，由素材中心传入当前已读原账本和原账户配置。展示覆盖与明确目标选择，使用原 `captureQianchuanReport`、`listQianchuanReports`、`cancelQianchuanIntegration`；串行显式操作，不自动抓取或重试。日期最多31天、每目标沿原2000条/180秒界；取消隔离迟到结果，已完成快照不回滚。按目标读取既有历史，复用原精确 join 及 CSV exporter，分页显示本地成片，未知不零填。

`QianguanjiaPanel.tsx` 只传原 `accounts` 到 `QianguanjiaMaterials.tsx`；素材中心集成 leaf 并与供应商查询共享 UI busy，切页/卸载取消原请求。原账户页指出实际覆盖核对入口，保留供应商与直读来源说明，无跨工作区隐式跳转。

### Safe Read Feasibility And Delivery

已只读核对 canonical `withAccountOperation` 的浏览器准备与保护门：普通 query 允许启动缺失浏览器。新增唯一可选强约束 `browserAccess: "existing-only"` 于 `src/shared/qianchuan-backend.ts` / `qianchuan-report.ts`，通过 `qianchuan-report-capture.ts` 与 `qianchuan-effect-read.ts` 传到每页，`qianchuan-backend-queries.ts` 在该模式仅调用原 `prepareCatalog(product,false)`；缺失立即失败，禁止 fallback/open/restart，普通默认行为保持。新增 local/remote 缺失与成功、逐页传递及无效参数测试。不得旁路 guard。真实采集选择原已核验目标，在不干扰生产且原 guard 允许时获取首份完整快照并核对接收视频；真实无法读取保留原失败与具体阻断，不用模拟数据冒充。

在共享 owner 完成 frozen gate 后应用 draft。测试 UI 的真实交互、日期和目标绑定、失败/取消/迟到结果、历史读取及导出；运行 typecheck、相关测试、适用 owned Harness 与 completion。按最终稳定源码完成必要 AOCI 维护和 native 独立审查，仅提交本任务 owned hunks 并 push 核远端。其他会话的 source、index 与 AOCI 保留，由工具直接协调写入窗口。
