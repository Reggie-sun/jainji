# Qianchuan Independent Read-only Adapter Implementation Plan

**Goal:** 借鉴千管家的业务边界，为 JIANJI 保留独立的千川只读查询路线，并增加最小官方视频素材查询适配器。

**Scope:** 公开页面/CDP/REA 静态研究、证据分级、现有浏览器适配器复用核验、主进程官方 `video/get` 单页查询模块及隔离回归。

**Contract Surfaces:** 现有 `QianchuanBackendQuerySchema`、`QianchuanBackendQueries`、账号/浏览器/egress owner 与 IPC 不变。新增 `QianchuanOpenApiVideos.list({advertiserId,page,pageSize}, signal)` 返回账号绑定的素材元数据页；授权通过主进程回调注入，不新增凭据存储或 OAuth 生命周期。

**Invariants:** 固定 HTTPS 官方 host/path、GET、拒绝重定向；无写操作、无自动重试。查询前验证账号在授权范围内；凭据不进入 renderer、URL、结果、日志或错误。请求最多 20 秒、响应最多 2 MiB、分页不超过官方 10,000 条查询边界。视频 `id` 保持字符串；不把可能超出安全整数范围的数值 `material_id` 当作可靠标识。

**Current / Target Behavior:** JIANJI 当前已有基于已登录千川浏览器的计划详情、账户汇总、计划素材效果三种只读配方。本轮增加可由 JIANJI 自有官方授权独立调用的视频素材目录模块，不依赖 `qc-api.uliangtech.com`。本轮没有官方 OAuth 授权，因此仅验证官方文档/SDK 契约及模拟 HTTP 行为，不能标记官方真实账户接通。

**Compatibility:** 不修改既有 UI、上传队列、账户选择、浏览器登录、VPS 查询或投放参数。新增模块删除即可回退；没有数据迁移或生产持久化副作用。

**Out of Scope:** 第三方会员/权限绕过、私有凭据提取、真实素材上传、建计划、ROI/预算修改、自动投放、OAuth 注册/付费、报表仓库和自动重试。

**Acceptance Criteria:** 公开资源分析能定位到 URL/SHA/UTF-8 byte offset；静态推断与实测明确区分。官方模块只有固定只读调用；越权账号、取消、非法分页、重定向、错误数据与超大响应均失败关闭；输出没有 token/下载 URL/未经精确解析的 material_id。真实平台读取仅在正常授权会话且稳定窗口结束后执行，缺授权保持 NOT_EVALUATED。

**Verification:** `npm run typecheck`、已注册的 `tests/qianchuan-backend-adapter.test.ts`、当前 policy 路由的 owned-scope Harness/verify、官方 AOCI Verify/Check/Guide。模拟接口成功不代表官方授权或真实千川成功。

## File Ownership

| Path | Responsibility |
| --- | --- |
| `src/main/qianchuan-open-api-videos.ts` | 单一官方视频素材只读 API 适配器 |
| `tests/qianchuan-backend-adapter.test.ts` | 保留既有浏览器回归，增加独立官方适配器模拟 HTTP 边界验证 |
| `docs/qianguanjia-reverse-engineering-2026-10-13.md` | 业务/接口/依赖/可复现性结论与剩余授权条件 |
| `docs/evidence/qianguanjia-2026-10-13.json` | 无凭据的公开资源元数据、接口字面量与静态调用位置 |
| 本文件 | 实现边界、验收、风险与执行记录 |

其他线程的 backend-queries、extension、remote-runtime、共享 Harness policy 等文件不在本轮业务 ownership 中。AOCI 索引按官方 CAS 批次维护，保留其他对象。

## Major Milestones

### Milestone 1: Evidence-bound Product Mapping

实际打开目标网站；登录受正常用户操作约束。下载公开 main/login 和选定业务 lazy chunks，在临时目录执行 REA；记录资源 hash、helper method 追踪与页面字段。只读 Kimi 勘察限定既有 adapter/query/shared；父级核验关键结论，不将接口名称或子代理意见当作平台证据。

### Milestone 2: Minimal Independent Port

在主进程新增 `QianchuanOpenApiVideos`，只接受 advertiserId/page/pageSize 与取消 signal。授权回调由调用方提供已经授权的 Access-Token 与 advertiserIds，不读取浏览器 token，不实现第三方后端代理。返回 videoId/filename/signature/durationSeconds，不暴露素材下载 URL。投放效果继续由已有 `QianchuanBackendAdapter` 独占。

### Milestone 3: Verification And Bounded Delivery

在稳定候选上跑类型检查、相关回归、owned-scope Harness、AOCI 与最终 diff 审查。按 `SUBAGENTS.md` 评估 implementation Review Risk Gate。仅提交本轮文件并 push 当前 upstream，核对远端 SHA。报告分别列出静态事实、模拟证据、真实只读证据和登录/官方授权阻断。

## Self-Review

本计划覆盖用户要求中环境允许的实际研究与最小实现；完整上传/写投放和数据中台属于后续授权/平台验证阶段。新增 API 是主进程库接缝，并未接入 renderer；不把该库的模拟测试等同产品 OAuth 完成。原 browser adapter 的注释只约束该 adapter，没有禁止整个产品使用独立官方 API；受管 Kimi 提出的“增加官方 API 本身构成合同冲突”由父级驳回，凭据隔离及 canonical owner 约束仍保留。

## Execution Evidence

受管 Kimi mapping invocation `f8fa0159-71fe-4f9f-a108-a7ac4a25b242`，seal `e5aa6f1ba34d4f6f5e62aa64535e21965fb7d0fd045254e26d58fbe03e0ba28b`，route qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`；Docker containment verified，观测 provider `api.kimi.ai`、response model `k3`，三次 wire requests，receipt PARSED，parent acceptance 独立裁决。该调用是只读 mapping，不是 implementation reviewer。

## Risk Gate

本轮新增模块没有 production activation、凭据存储、IPC 或投放写入路径；最严重的业务失败为授权/结构不符导致只读查询失败。固定官方 HTTPS host、拒绝 redirect、账号范围校验及通用错误已由隔离测试覆盖。当前无具体证据说明仍存在会造成重大财务/破坏性后果的实现缺口；官方真实 OAuth 未验证明确保留为平台接入 blocker，不以审查意见填补。因此候选范围裁决为 `KIMI_REVIEW_NOT_REQUIRED`，最终仍须稳定源码 identity、项目验证、父级 diff 审查及 AOCI；mapping receipt 不替代这些证据。stable final hashes 随 Harness scope/receipt 记录。

## Stable Candidate

业务候选：`src/main/qianchuan-open-api-videos.ts` SHA-256 `ebcadcf8cc0b3a55ff85b59c231e9c1a89f3bc62e141b1a56011b6832f53a8cc`；相关测试 SHA-256 `4127db549c6f155673c57c655886004c12430fa8d37b93766640600622372116`。类型检查 exit 0、21/21 相关测试 PASS；2026-10-13 15:26:11 UTC 正常千川账户汇总独立实测成功，仅四指标读取。官方 HTTP 仍是 fixture 证据；随后千管家正常登录完成，但广告账户未授权、首页为示例数据，写投放操作为零。

官方 AOCI 当前完整2对象批次已原子 applied（我的新模块及另一 owner 当前 backend-queries）；共同索引保留其他条目，提交按对象拥有 hunk 分开。该 metadata 合作不转移业务 ownership。测试及文档 role 为 observe，不人为扩展 indexed scope。

2026-10-13 16:18:32 UTC 登录后只读观察：广告主/授权账户 HTTP 200/code=0/空数组；素材页分页字段 null；首页汇总、趋势、账户榜 HTTP 200/code=0，UI 明确标明示例数据。正式证据只保留结构，不保存账户财务值或秘密凭据。真实账户与会员业务验证仍由正常授权边界约束。

## Verification Recovery

第一份 scope 使用错误字段 `changeType`，输入拒绝且未执行检查；更正为官方 `change` 后保留原记录。首次完整 scoped run `20261013T154052Z-3511e4ea` 为 FAIL：相关千川组 800 PASS / 3 timeout / 0 skip，共享 Harness source/policy 在执行期间由另一已授权任务变更，AOCI control 按新路由拒绝，source identity 不一致。没有把该回执改成 PASS。

3 个超时场景含参数化共 5 条，隔离诊断全部通过（1.32秒，无源码/环境变更），112 条未选只作诊断，不满足 completion。新 current Harness Contract 使用显式 `scope.aoci` 对 indexed 对象追加 required 证明；本任务将声明 `indexed-identity`、路径 `src/main/qianchuan-open-api-videos.ts`。维护与投放权限边界不变。新稳定 candidate 上仍按实际 policy 完整执行 required 检查；不靠过滤测试、改名逃避 route 或提高超时阈值掩盖失败。
