# Qianchuan Real Integration Implementation Plan

## Goal

按 [Real Integration Spec](../specs/2026-10-15-qianchuan-real-integration.md) 实现独立千川读取、完整效果快照和受控投放接入，保留原制作、上传、账户及 UNKNOWN owner。用户本次实施指令取代规格撰写时的 `SPEC_ONLY` 授权范围；不代填真实广告写入授权。

## Scope And Baseline

- 用户明确要求 dedicated worktree：`/home/reggie/.codex/worktrees/aa7c/jianji`，分支 `feat/qianchuan-real-integration`，基线 `1d31b9196ad068a573a0f2ed18bfc214d1d65ce4`。
- 原目录已有其他任务未提交修改，全部保留，不复制或提交到本分支。所有后续编辑、测试和集成验证使用本 worktree。
- P0 为目标；F09/F10 不在首轮实现范围。真实账号写操作、上传及媒体验收需要 spec 规定的对象、金额、动作、次数和时限，未取得时逐项标 `NOT_EVALUATED`。

## Contract Surfaces And Invariants

- `DouyinUploadService` 继续拥有账户/浏览器资源准入和原上传账本。新读取及投放职责经该 owner 协调；不建立第二上传队列，不清除历史 READY/UNKNOWN 或重新发送未知请求。
- `QianchuanBackendQueries` / `QianchuanBackendAdapter` 保留固定只读配方和主进程身份核验；renderer 不提供 URL、method、HTTP body 或任意 recipe。
- 新 `qianchuan-report` 共享合同与主进程 store 仅持久化通过完整性核验的归一化报告。唯一视频关联仍为 ACCEPTED 的精确 `platformVideoId`，素材 ID 独立保留。
- 新 `qianchuan-delivery` 共享合同和主进程审计职责区分草稿、授权、意图、平台提交和回读；未验证配方不能执行。金额使用精确十进制，未知意图及预留跨重启保留，未完成授权不恢复。
- 支付、含券、净成交 ROI 明确区分；缺失为未知，查询失败不写零。统计窗口按北京时间冻结；沿用 31 天、2000 行及 180 秒边界。
- 连接与静态 endpoint 证据不授予写权限。平台请求/响应、字段与参数范围未核验时，相关动作必须提供具体阻断原因，不能用 mock 声称平台已接通。

## Major Milestones

### M0: Capability And Platform Evidence

**Files:** `docs/qianchuan-real-integration-2026-10-15.md`；共享 `src/shared/qianchuan-delivery.ts`。

REA 被动发现现有用户浏览器、采集页面和静态脚本证据；不导航、刷新或关闭原页面。记录账户/模式/动作、证据 ID、时间、覆盖限制及缺项。页面明确包含支付 ROI 和净成交 ROI，不能混名。创建、独立素材库上传、ROI/预算/启停各自准入，不能根据千管家 endpoint 名称拼千川请求。

**Acceptance:** 每个 P0 能力有实际可用证据或明确 blocker；凭据及第三方实现不进入 Git。未准入写动作的平台提交数为零。

### M1: Complete Read Snapshots And Attribution

**Files:** 新增 `src/shared/qianchuan-report.ts`、`src/main/qianchuan-report-store.ts`、`src/main/qianchuan-report-capture.ts` 及对应测试；接入 `src/main/douyin-upload-service.ts`、`src/main/index.ts`、`src/main/preload.ts`；复用 `src/shared/qianchuan-effect.ts`、原 `QianchuanBackendQueries` 和原效果采集边界。

主进程在用户手动刷新时采集并验证完整归一化报表；分页共享冻结窗口，拒绝重复素材、漏页、total/账户/计划/配置漂移、取消和超限。原子写入私有目录，失败不发布完整快照；读取历史不连接浏览器、不触发平台操作。记录实际指标口径、原始单位/未知单位、provider、账户、计划、北京时间窗口和采集时刻。

**Acceptance:** 独立于千管家的原读取仍可执行；完整快照可重启读取，部分/迟到/错误身份结果不可保存；按素材键去重导出，保留视频的一对多素材关系；制作效果页复用 main capture/store，按本地批次筛选并沿原 `openArtifact` 打开成片，本地别名仅作引用不重复统计。已有生产及上传流程不变。

**Verification:** typecheck；snapshot/schema/store/capture 测试；原 backend/effect/upload/account 相关回归；真实读取与平台页面比对单独记录。

### M2: Controlled Delivery Boundary

**Files:** 新增 `src/shared/qianchuan-delivery.ts`、`src/main/qianchuan-delivery-store.ts`、`src/main/qianchuan-delivery.ts` 及对应测试；原账户/浏览器准入和 trusted IPC 仅作必要接线。

固定草稿绑定 provider、账户、模式、商品/素材/计划与当前值；授权绑定摘要、金额上限、累计预算增加、次数和过期时间。持久意图先于提交；一次执行后独立回读，未知锁存并按实际资源阻断后续写入，不自动切 provider、重试、回滚或释放预留。重启使未完成授权失效，但保留意图及 UNKNOWN。本地停止只停止后续本地动作。

实际执行必须由 M0 已核验的固定 recipe 提供，并且有真实受控验收。没有完整真实写配方/对象授权时，产品准入明确拒绝而不实现猜测 HTTP 请求；隔离测试验证金额、并发、持久化及未知恢复的工程合同，不能冒充 F04/F05 真实验收。

**Acceptance:** 未准入/未授权/超限/过期/前值漂移/已有未知时零提交；持久化失败零提交；提交后超时/停止/重启不重发，未知预留不释放；真实创建及每种调整分别保留回读证据或 blocker。

### M3: Product Entry And Completion

**Files:** 原 `QianchuanWorkspace`、新增聚焦的 report/delivery panel、必要样式与 Chrome 集成 fixture；`.agent/harness/policy.json`、正式 AOCI Entry/baseline（适用时）、实施证据报告。

复用现有六入口，展示当前值/草稿/历史快照/准入状态；账户切换、隐藏、取消和迟到结果隔离。报告历史与 CSV 只输出白名单字段；店铺未知明确展示，不把 advertiser 当 shop。写入口在准入和用户授权满足前显示原因，不提供误导性重试。

**Verification:** focused tests 与 typecheck 先通过；Chrome MCP 集成核对实际窄/宽窗口交互；按 policy 执行 owned Harness scope 和 completion。必要 AOCI 维护按官方 Guide 执行。稳定 candidate 按 `/home/reggie/.codex/SUBAGENTS.md` 判断 financial/persistence 风险；触发时只用一个原生 read-only adversarial reviewer，最多三轮。审查阻断或真实能力缺项如实保留。

## Ownership And Execution

Parent 负责 REA、live evidence、架构裁决、跨 owner 接线、UI、最终验证与交付。可独立划界的 snapshot/schema/store 或 audit 实现才按精确 allowed paths 委派原生 bounded worker；不委派真实广告写入。只读 mapper 负责现有调用链，避免 Parent 重复扫描。无 Kimi/其他外部 subagent。

## Acceptance And Delivery Limits

逐项对照 spec A01–A11：工程测试只证明隔离软件行为；A02–A04/A07/A08 的真实素材、账户/店铺及投放验证另外记录。未提供明确写入授权或真实配方未准入时，M2/M3 的真实投放验收为 blocked/NOT_EVALUATED，不称“真实投放接入完成”。代码、测试、文档仅提交本分支所有路径；验证后 push 并核对远端 SHA，不合并原目录未提交工作。

## Self-review

覆盖 F01–F08 的目标、原 owner 复用、写能力准入和真实验收限制；F09/F10 明确排除。金额、持久化、未知及资源互斥是工程必需项，不因没有真实写入授权省略；也不以实现这些防护当作平台闭环已完成。基线 typecheck 与 backend/effect 的 29 项测试已通过；后续变更需重新验证。
