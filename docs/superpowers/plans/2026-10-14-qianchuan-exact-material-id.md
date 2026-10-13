# Qianchuan Exact Material ID Implementation Plan

**Goal:** 为独立官方视频目录提供精确的 `materialId` 字符串，为以后关联制作回执和素材效果提供可靠标识。

**Scope:** 既有官方只读目录的解析与隔离测试；正常千川会话的计划/素材只读核验；更新千管家分析与脱敏证据。

**Contract Surfaces:** `QianchuanOpenApiVideos.list()` 结果中，每个视频新增可选 `materialId: string`。现有 `videoId`、签名、时长、分页、授权回调和错误合同保持。没有生产调用方；CodeGraph 关系核对与文本引用仅发现已有测试接缝。

**Invariants:** 固定官方 HTTPS GET、20 秒/2 MiB、授权账号范围、无重试、无下载 URL/凭据投影。不得从已舍入的 `Number` 推导标识；缺失标识不能编造。既有浏览器适配器和其他线程文件保持其 owner。

**Current / Target Behavior:** 前一阶段忽略数值 `material_id`。本轮从 JSON reviver 的原始 `context.source` 取得数字字面量，或接受平台已有字符串；验证为 1–20 位无前导零正整数后投影。缺失/null 时省略 `materialId`；小数、指数、负值、零、超长和非法类型拒绝。运行时没有原始 source 时，任何数值标识均失败关闭，不做安全整数兼容转换。

**Compatibility:** 已有字段不变，新字段可选；无凭据/数据迁移。实测 Node 22.21.0 与项目 Electron 33.2.1 的 Node 20.18.1 支持原始 source。此运行时证据不替代 Windows 实机或官方 OAuth 验证。

**Out of Scope:** OAuth 生命周期、IPC/UI、新报表 join、上传、真实投放变更、权限/会员绕过与跨账户切换。

**Acceptance Criteria:** 原始未加引号的 `1879999999999999999` 返回逐字相同字符串；非法数字表达式及缺 source 的运行时拒绝；缺失/null 不制造 ID。原有授权/传输边界回归保持。真实只读结果与空页、业务失败分别记录，不将空页称为素材效果验收。

**Verification:** 先 RED 后 GREEN 的既有 adapter 测试、`npm run typecheck`、当前 policy 的 owned-scope Harness/verify、必要的官方 AOCI Verify/Check/Guide，以及 Electron 原始 JSON ID 运行时核验。

## File Ownership

| Path | Responsibility |
| --- | --- |
| `src/main/qianchuan-open-api-videos.ts` | 唯一官方目录解析 owner |
| `tests/qianchuan-backend-adapter.test.ts` | 原始 JSON 和兼容/拒绝行为验证 |
| `docs/qianguanjia-reverse-engineering-2026-10-13.md` | 当前能力与历史证据边界 |
| `docs/evidence/qianguanjia-2026-10-13.json` | 本轮只读观察和运行时证据 |
| 本文件 | 有界实现、验证与风险裁决记录 |

共享 AOCI 仅按完整机器批次/CAS 维护，自有源对象的 Entry/leaf 单独提交，保留其他线程对象。浏览器 query/service/extension、Harness 和 package 文件不属本轮业务写入范围。

## Major Milestones

### Milestone 1: Actual Protocol And Runtime Evidence

正常浏览器当前账号校验后只读计划/素材。计划详情业务失败时保留 code/shape，不猜参数重试；空素材页仅证明固定过滤查询可用。受管 Kimi read-only mapping 检查自有目录与测试，不授修改/网络/验收权；父级持有最终判断。

### Milestone 2: Lossless ID Parsing

使用原生 JSON reviver，不新增依赖。先使用原始响应字面量证明旧模块缺少精确 ID，再实现上述可选字段和拒绝条件。取消、大小、账号绑定和通用错误保持原有行为。

### Milestone 3: Stable Verification And Delivery

冻结自有 source/test identity 后完成项目验证与 Risk Gate 判断；必要 AOCI 更新绑定新源身份。仅提交本轮文件/精确元数据 hunk，push 当前 upstream 并核对远端 SHA。记录平台授权和 Windows 验证限制。

## Self-Review

该边界解决真实大整数解析风险，不提前实现未经验证的效果 join 或第二凭据/队列 owner。可选字段保留旧响应兼容；显式无 source 拒绝使旧运行时失败可见。用户已授权必要最小实现，不新增批准步骤。

## Execution Evidence

前一阶段提交 `6b161933d00d176c423e170f29acbbeafd970d21` 保留其原始证据。2026-10-13 17:24–17:26 UTC（CST 10-14）正常账户 guard PASS，页面一条计划；当前及前一日计划素材查询严格空页。计划详情 HTTP 200 / `status_code=1001`，缺少 `adDetailInfo`；失败原因未验证，不解释为权限失败。

Kimi mapping invocation `d811d6b6-5439-4d06-9190-cd7841d1f17e` 使用 `deep` / max / 1M、Docker、只读 seal `30bf72152aed97c9b6f42e441a60da70e086ba8bcfec60edbceddd8e52d97d3f`，qualification `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`。两次 wire requests 观测 `api.kimi.ai` / `k3`，完整 Read 两 owned 文件，receipt PARSED，父级复核 frozen hash 一致后开始修改。不是 final reviewer。

父级采用“原始词素解析、字符串兼容、缺 source 拒绝、原始 JSON 测试”的建议。缺 source 通过端口级模拟旧 JSON.parse 验证，不增加只供测试的公开 reviver。关于 duplicate JSON key 的泛化意见没有参与实现，也没有据此声明特殊处理能力。

RED：39 项中 18 FAIL / 21 PASS；GREEN：39/39 PASS，typecheck exit 0。Node 22.21.0 和项目 Electron 33.2.1 / Node 20.18.1 都保留原始 `1879999999999999999` 文本。官方目录依然只经过模拟响应验证；没有新增 OAuth 或真实广告变更。

本轮 AOCI 全卷 6 块交付并确认 355 条已收到，但 Challenge 交互因回答字段 schema 拒绝（一次格式修正也拒绝）未完成严格 attestation；不继续猜字段或声称完整系统认知。本任务沿已核验源码边界执行，索引维护与 Verify/Check/Guide 另以机器证据判断。

后续上下文压缩刷新 event `qianguanjia-material-id-20261014-compaction-2` 的 1–5/6 块正常交付，第 6 块返回 `overview_snapshot_changed`；按当前合同停止该认知链，没有用源码或旧索引补答。不能据此声明完整系统认知已校验；本轮继续限于直接核验的源对象，不作 Root/Meta 或全局架构决策。

首个增量完整 Harness `20261013T174950Z-7758086d`：4 项 required 检查均 PASS，41 文件 / 834 测试 / 零 skip，但总状态 `NOT_EVALUATED`。执行期间另一任务的 `hybrid-cover-session.ts`、`source-fact-discovery-evidence.ts` 及两项相关测试身份改变；自有源码/测试保持上述 SHA。保留该结果，不把分项成功改标为整体完成；稳定后重新生成回执。

第二次当前树 Harness `20261013T180453Z-932a7480` 同样 4 项 required / 834 测试全 PASS，但另一任务的 `membership-desktop.ts` 和其测试发生身份漂移，总状态仍 `NOT_EVALUATED`。不继续盲目重复当前全树验证；下一次采用完整冻结验证副本、只读 Git 桥和原 policy 的所有 required 检查。副本不含 `.git`，不注册 Git worktree，不改正式索引 Header；保留全部 source/tests/scripts/resources 和必要配置，包括 ignored `resources/membership.json`。回执在副本内 completion 核验，另核实际 owned 字节和参与源码等价，不把副本 PASS 泛化为其他会话的完成。

最终冻结副本基于 `90f08bb59f4cc660147387f65c099f962d552ad5`，复制 4377 个文件、绑定 4063 个参与源码。Harness `20261013T182234Z-9c524e3d` 的 typecheck、41 文件 / 834 测试 / 零 skip、documents 与 owned-AOCI 全 PASS；completion `20261013T182912Z-7b92196d` PASS。副本与实际源码对比仅发现另一任务的扩展 `background.js` 和 `qianchuan-extension-browser.test.ts` 改变；本模块、测试及直接依赖/配置逐项匹配。另在实际工作树完成新的 typecheck exit 0 和 39/39 adapter 测试，证明本轮字节在当前相关运行环境可用，不宣称扩展或整个当前工作树已通过全量验收。

AOCI 本轮 indexed 对象维护为完整单候选批次，applied=1、remaining=0、findings=0；source/leaf 为 `20f0b82b5e9a8215656bd85b6ebbb3c24d8cc621b6fca989a0a3121c5cf246b7`。官方 Verify/Check/Guide 及最终 owned-AOCI 核验覆盖本对象；其他 owner 的正式资产/全库状态独立处理，不改标为本轮验收。

## Implementation Review Risk Gate

判断时机：上述项目验证与当前树相关验证均通过后，针对稳定自有 source `20f0b82b5e9a8215656bd85b6ebbb3c24d8cc621b6fca989a0a3121c5cf246b7` / test `b008fdd4306a53a5dc08f15bbdc44dfe73d9751a7671bebf22c934f3ab7f9138`，绑定上述冻结/完成回执；本计划为 accepted scope，独立 written spec 不适用。

1. 用户未要求该 implementation snapshot 的 Kimi final review；前面的 Kimi 是只读 mapping，不当作 final reviewer。
2. 改动只增加可选元数据及严格词素校验，现有主进程授权范围、固定 GET、错误脱敏与传输上限不变；无生产调用方、凭据存储、投放写入或持久状态迁移。未发现可造成关键级泄露、越权或难恢复损坏的具体失败路径。
3. 原始大整数/歧义数字/缺 source 用例及实际 Electron 已覆盖本轮解析风险；当前源的 typecheck/39 测试与冻结完整回归提供可执行证据。官方 OAuth 与 Windows 尚未验证，且均不启用为生产能力，不构成该只读解析增量的重大后果与残余语义缺口组合。

结果：`KIMI_REVIEW_NOT_REQUIRED`。Codex Parent 已裁决建议、复核最终 diff 和平台证据边界，继续按 owned scope 交付，不追加重复 reviewer。
