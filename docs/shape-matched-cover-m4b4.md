# M4-B4 Original Production Integration

## Status

2026-09-27，完成 bounded M4-B4 的进程内最小接线。沿用 [V1 Spec](shape-matched-cover-spec.md) 和 [Plan](shape-matched-cover-plan.md)，承接 `7779748` 的 M4-B3 样片准入；本窗口继续时 HEAD 已包含上传任务 `fc372d2`，验证时 HEAD 为 `f31cf93`。未创建 worktree，未启用 UI/IPC 或全片自动覆盖，未进入 M5。

## Source and Call Path

当前源码与 CodeGraph 核对的路径为：`AgentController.startShapeMatched → startInternal → AgentRunner → ShapeCoverProduction.prepare/layers/admit → admitShapeCoverSample → ExportQueue.publishApprovedSample`。CodeGraph 重新索引得到 4428 nodes / 3659 links，查询确认显式入口调用 `startInternal`、生产接缝调用 M4-B3 准入；同名短函数的图关系仍以 import 和源码核对，不作为独立 authority。

`startShapeMatched` 只接收进程内显式 request，复用原制作请求校验、取消、选款、创作和队列回调。默认 `start` 未切换形状策略。`shape-cover-production.ts` 是 run-local 协调 owner，不拥有源知识、渲染器、队列或第二套任务生命周期。

## Admission and Selection

- 必须开启 Agent 自动覆盖；拒绝 assisted 和重新识别请求。创作与独立复核连接仍须配置；该接缝消费已准入源事实，不调用视觉识别生成 mask 或近似框。
- 每个 intended target 必须精确匹配本轮素材身份，并与 canonical head 的全部 target/segment 及完整有效时段一一对应。缺素材、mask、目标或范围、重复目标、知识风险均拒绝。
- 本制作入口只有一个冻结 preset，request 必须恰有一个匹配的输出设置。底层 candidate×target×setting owner 保留多设置矩阵能力；不能借另一规格的 PASS。
- 全部 masks 核查、完整矩阵及共同集合通过后，workers 才抽取模型帧并调用选款/创作。候选须属于当前有效本地目录，资产路径与指纹匹配；上传预览延迟到整轮几何准入之后。
- 原轮换逻辑只消费共同集合子集，同轮全部素材共用选款。每轮冻结 promise 共用整轮结果，每个素材版本独立调用 M4-B3；不跨版本复用内容安全 PASS。

源 mask 与共同几何集合不证明内容安全。真实最终像素、完整输出 PTS 和 face/hands/product/subtitles 四类安全继续由 M4-B3 验证；UNKNOWN、UNSAFE、coverage 非 100%、绑定变化或发布前取消不获得发布 authority，也不回退矩形/白底或普通 enqueue。

## Template and Reviewer

冻结形状 PNG 原样加入原模板。四角补齐按 placement 加有限轮廓半径及有效时段计算占位，调用现有 `fillUncoveredCorners`；透明全画布 PNG 不被误认为占满四角，shape 图层不重新缩放或编码。

独立 `reviewerProvider.superviseShapePreview` 通过原连接发送配对原图、真实成片、全图、形状范围、当前证据 ID 与既有反馈/历史。协议要求四类均明确 SAFE，只允许 pass/inspect/stop，禁止通用 bbox 修订。主管补帧与有限预算仍归 M4-B3 owner；任何模型错误不静默重试或换连接。测试调用完全模拟，未发送真实账号请求。

## Persistence and Restart Contract

冻结模板、输出设置、任务与完成 artifact 仍由原队列/JobStore 保存，供追溯和读取已有完成结果。JSON 中 shape 的 `contentSafety: NOT_EVALUATED` 保留；保存的数据本身不恢复准入能力。

只有当前进程 M4-B3 module-private opaque handle 能把绑定的样片原字节直发。handle 不序列化、不由 JSON PASS 重建；run-local PNG 和预览缓存没有持久重放承诺。普通 shape `createBatch`、追加、恢复执行及重启重试保持 fail-closed；既有恢复测试证明拒绝时不运行 FFmpeg。启动不自动调用模型，重新编码不能借样片 PASS。持久化准入与重启重试尚未实现，后续必须先另立合法合同。

旧矩形、manual、assisted、关闭覆盖和不含 shape 策略的历史冻结任务沿原路径解释。已完成的同字节发布结果不因后续运行取消而逆向删除。

## Fresh Verification

在本切片最后一次源码变更后读取并执行 `superpowers:verification-before-completion` gate：

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS，exit 0 |
| 11 个相关测试文件，`--maxWorkers=4 --minWorkers=4` | 245 PASS，exit 0，30.08s |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 135 files PASS / 1 skipped；1184 PASS / 3 skipped，exit 0，39.59s |
| `git diff --check` | PASS |

相关测试：`shape-cover-candidates`、`agent-provider`、`agent-controller`、`agent-runner`、`four-corner-coverage`、`shape-cover-pixel-gate`、`source-mask-admission`、`compiler`、`domain`、`queue`、`supervised-preview`。

新增集成 fixture 使用两个真实源、已准入 mask、透明候选和真实 FFmpeg：共同集合只留下同时可覆盖两个目标的一款；两轮四个素材版本各自独立复核，四个不同 handle，通过原队列完成四个文件，并逐个验证正式文件与批准样片字节完全相同。手动展示文字与冻结轮次保持一致。另验证缺目标/mask、空集合、设置/范围/资产不符在模型调用前拒绝，以及集合外选款、源漂移、hands UNKNOWN 和取消均不发布；四角测试只裁掉实际占位角落的有效时段。

最初集成 fixture 使用 `clean` 不允许的 filter/intensity 导致 4 个失败，修正 fixture 为当前 rule 的合法值后重新执行上述完整验证；不把该中间结果算作通过。

## AOCI Incremental Maintenance

fresh Guide 首先报告 authoring_required，没有假定上一窗口 aligned。官方 `aoci_maintain` 签发完整 12 项（11 update / 1 create），经当前 Meta 字典和源码逐项作者化，由 `aoci_update_entry` 一次完整应用，remaining=0；未手截批次、手改索引或盲目 baseline。

随后依次运行官方 Verify、Aggregate Check、Guide，均 exit 0：158 sources / 158 entries，missing/orphan/stale/unbaselined/line-ending-only 及 Volume mismatch 为 0，无 Recovery 或第三方正式字节冲突，Guide 为 `aligned / complete=true / next_action=none`。正式变更只有 `aoci.code.txt` 和 `.aoci/baseline.json`；运行缓存/日志不提交。

此次维护对应当前已知 working tree，包括用户要求保留的本地随机模式未提交源码，因此完整机器批次也包含这些源码的 cognition。业务源码和测试只提交本切片；controller/runner 中其他任务的 `usesModel` hunks 留在 working tree。**AOCI aligned 与测试统计属于该工作树状态，不能声称独立检出本提交后仍与这些未提交源码完全一致。** 外部任务提交或恢复其源码后，须重新核对 Guide；不得用本记录替代 fresh 验证。

Overview 首次严格 Challenge 为 partial；上下文压缩后遵循合同重新完整交付并单次 attestation，157/157、3 块、Challenge 10/10，但该旧索引当时仍有源码 drift。索引交付、严格认知、正式治理对齐与产品验收分别记录，不互相代替。

维护完成 composite identity：`1724a47e6082e817daca19ad3ea4a5351e54d25f3bb30e4427da002f864de240`；Code Volume：`ce599a6ec791016874b0df31b21aa84229278f8f8a4fc043a5546266e674e038`。

## Parent Review and Ownership

稳定源码候选基于 `f31cf93`；新 owner SHA-256 为 `c1f5cf034e043e308220c8ea495465b6b99e6557af25bba262e92b530204a3c4`，完整受管业务源码快照由官方 Verify 的 `business_source_sha256=03e7479999f6bdb98c8ce20bd168e1810559ea105780794aadcdaad86a344dda` 绑定。

Parent 核查合同、最终 diff 和执行证据，Risk Gate 为 `KIMI_REVIEW_NOT_REQUIRED`：用户明确禁止 Kimi review；本切片没有引入凭据/跨项目 authority 或持久状态关键级损坏路径；共同集合、绑定、取消、样片内容协议、同字节发布及拒绝重放已有本地可执行证据。仍未验证的真实 reviewer 语义与人类观看需要真实服务/人工证据，代码 adversarial review 不能替代。未调用产品 Agent、付费模型、Kimi 或 native reviewer。

并发任务曾触及 controller/runner，先停写；用户明确表示已停止并授权继续后恢复本切片。其他任务的 application/domain/index/preload/renderer/shared/相关测试及 smoke 脚本保留，不覆盖或提交。`氨糖膏.jianji-project.json` 和 `.bak` 的用户删除保持未暂存。没有同文件 active writer 的已知冲突。

## Remaining Boundary and Next One Thing

当前无已知 M4-B4 接线 blocker，停在本切片稳定检查点。证据仅为 schema/unit、模拟服务集成和真实 FFmpeg fixture；真实 reviewer、用户素材人工全片、Electron 产品入口和 Windows 未验收。

下一步先定义并评审持久化准入/重启重试合同，或继续保留显式进程内入口与 fail-closed；不自动进入 M5，不激活全片覆盖，不以测试 PASS 授权真实模型或产品 UI 上线。
