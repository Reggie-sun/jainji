# M5-D2 — Full-Canvas Semantic Review Candidate

## Scope and Status

2026-09-28 用户授权推进 D2，要求每帧完整 T(f) 或 UNKNOWN。依据 [D contract](shape-matched-cover-m5d.md#verified-no-sticker-interval) 与 [active plan](shape-matched-cover-plan.md#active-implementation--d2-full-canvas-manual-review)，本轮建立原画布证据 owner、显式人工声明 session 和独立本地审阅工具。状态为 `D2_ENGINEERING_CANDIDATE_VERIFIED / METHOD_QUALIFICATION_BLOCKED / SEMANTIC_AUTHORITY_BLOCKED / PRODUCT_DISABLED`，不是 `M5-D2 PASS`。

D1 的完整解码 owner、clock、paths、source store 和测试保持冻结；M5-A renderer、M5-B guard、M5-C assembler 也没有修改。没有知识库 schema/migration、placement、candidate selection、mask proof、FullSourceAdmissionHandle、成功 issuer 或产品接线。D2 的真实人工 qualification 未完成，D3/D4/C/E/Activation 仍待后续分别验收。

## Owners and Evidence Binding

[source-fact-review-evidence.ts](../src/main/source-fact-review-evidence.ts) 调用既有 `collectFullSourceCensus`，使用相同支持 profile 将完整原尺寸 RGBA decode 写入独占临时 spool。不是第二个 census issuer。每一帧验证 ordinal 对应字节数和 SHA，准备完成前再次调用 D1 核对 censusDigest；freeze 前也复核 D1 和全部 spool 帧。所有 decode 使用原 PTS passthrough，不采样、缩小、去重或补 FPS。源和两只引擎的 dev/ino/size/mtimeNs/ctimeNs 前后及读取时检查；只承认 WeakSet 中的活跃原对象，复制对象和 caller-created evidence 拒绝。

独占存储上限为 32GiB，超预算直接 UNSAFE，不截取、压缩降级或返回 partial evidence。D1 的每次调用以及 spool decode 各有现有 10 分钟 wall budget；多次核验累计耗时不是总计 10 分钟保证。首版需要完整 spool 和重复完整 decode，不能据此宣称实际批量性能合格。D1 支持的视频可能因 D2 存储预算而不被本工具支持。

[source-fact-review-session.ts](../src/main/source-fact-review-session.ts) 从 owned evidence 取得全部事实，调用者不能提供 source、census、PTS、complete、qualification 或 receipt。session 绑定 SourceIdentity、censusDigest、固定 `explicit-human-full-canvas/v1`、frame count、reviewerId、创建时间和唯一 evidenceId。每个 presentation 绑定 ordinal、PTS/endPTS、pixelSha256、byteLength；当前 token 经尺寸和像素摘要 acknowledge 后才可 record。token 不可借给另一 session，修订同一 ordinal 需要新 presentation。

| Explicit result | Required declaration |
| --- | --- |
| TARGETS | 非空、无重复目标；明确确认完整原画布所有可见旧贴纸已经枚举。目标包括 static、moving、animated、unresolved；跨帧同一 UUID 的描述和类别须一致。 |
| EMPTY | 专用命令，逐字确认“这一帧完整画布不存在任何旧贴纸。”；没有选目标不是 EMPTY。 |
| UNKNOWN | 非空原因；不解释为空，不签发 no-sticker interval。 |

缺任一 ordinal、借用 token、错误 SHA/尺寸、未 acknowledge、未知字段或伪造 qualified=true 均拒绝。所有 frame 都有明确结果才允许 freeze，receipt 深冻结并以 receiptDigest 绑定完整 body，包含 qualification、frozen session 状态及全部逐帧结果。声明目标目录是逐帧 TARGETS 的并集，名称为 declaredTargets；它尚不是可信 exhaustive target set，也不计算 D3 segments/masks。

## Semantic Authority Remains Blocked

浏览器 Canvas readback SHA 只证明这条测试 transport 的实际画布字节与 census 一致；主进程收到的 acknowledge 固定记为 `CLIENT_REPORTED_FULL_CANVAS`。reviewerId 是声明身份，不是独立认证。请求 token、哈希和明确确认文字不能证明人的注意力、全画布确实可见或语义完整性。工具没有资格签发方法 qualification。

所有 receipt 固定 `authority=none / eligible=false / semanticReview=RECORDED_NOT_QUALIFIED / methodQualification=NOT_EVALUATED`。即使所有帧均为 EMPTY 或完整 TARGETS，canonical `unverifiedIntervals` 仍为整个 horizon。UNKNOWN 的连续区间单独记为 `unknownIntervals`，只作诊断；不能把记录齐全的 complement 当成可信完整性。没有生成 verified-no-sticker intervals、knowledge proof 或可消费的全源 admission。保存 JSON 也不恢复 capability；本轮没有 receipt import/恢复或后端 qualification 分支。

后续留在 D2 的人工方法验收至少应建立：可信呈现与 reviewer 身份/方法版本；独立真值的无贴纸、同时目标、中部单帧闪现、快速切镜、移动/动画、消失再现及身份不明素材；人类逐 ordinal 完整原画布显式判断；与独立真值比较全体目标而非仅比较两份可能同时漏目标的声明。需要区分人类验收与本轮机械点击。原尺寸画布无法完整显示时仍拒绝 EMPTY/TARGETS；若将来支持 tiles/放大，必须另证逐帧像素覆盖，不能静默降级。

## Manual Tool

[source-fact-review.mjs](../scripts/source-fact-review.mjs) 将真实 canonical owners 打包到本次临时目录，读取源解释，经 D1 严格校验后提供随机 session URL 的 loopback 页面。Host/Origin 检查、no-store 和 CSP 限制访问；只写用户明确指定且不存在的记录路径，不覆盖源片或既有记录。失败不自动重试或切换引擎。没有 Electron IPC、模型调用或 production consumer。

```bash
JIANJI_FFMPEG_PATH=/path/to/supported/ffmpeg \
JIANJI_FFPROBE_PATH=/path/to/supported/ffprobe \
node scripts/source-fact-review.mjs /absolute/source.mp4 reviewer-id /absolute/new-review.json
```

使用当前已验证、满足 D1 profile 的引擎绝对路径。打开 stdout 返回的本地 URL，逐帧选择 TARGETS/EMPTY/UNKNOWN，所有 ordinal 记录后冻结。原尺寸 Canvas 必须完整处于 viewport 内并明确勾选全画布 scope 才允许 TARGETS/EMPTY；UNKNOWN 不声明完整性。Canvas readback 不一致时没有 acknowledge。freeze 后记录文件写入成功才在页面显示已保存；Ctrl-C 关闭服务并清理本次临时证据。保存失败时不会覆盖或另造成功记录；首版不提供跨进程 session 恢复。

## Fresh Executable Evidence

在共享 working tree 的 HEAD `47245515e6d8c0fcf6c666af05b7aa5a73a97cf7` 和下列冻结 candidate bytes 上运行，退出码均为 0：

```bash
npm run typecheck
npm run test -- tests/source-fact-review.test.ts tests/source-fact-census.test.ts tests/source-fact-completeness.test.ts tests/source-sticker-knowledge.test.ts tests/source-sticker-knowledge-store.test.ts tests/source-mask-admission.test.ts tests/shape-cover-request-assembler.test.ts tests/shape-cover-activation.test.ts --maxWorkers=2 --minWorkers=1
git diff --check
```

相关 8 files /244 tests PASS，其中新增 D2 28 tests。真实 CPU FFmpeg fixture 使用 CFR 六帧和 VFR 三帧 lossless H.264，完整 RGBA 与 D1 ordinal/原时钟一一对应，同帧同时两图案、重复像素仍单独审阅。测试声明中保留 animated target，不把合成图案/自动输入解释成真实人工语义识别。独立 mock 子进程负例覆盖 short/extra/corrupt/stderr/nonzero/cancel 和 close 收敛。首中尾漏帧、复制/关闭 evidence、恢复原字节但 generation 改变、spool 损坏、token/尺寸/SHA 失配、伪造 qualification 和全 EMPTY 的全 horizon 阻断均有断言。

实际 red→green 发现并修正：frozen 字段未进入最终状态、receiptDigest 未覆盖完整 body、缺引擎错误未归为 UNSAFE，以及未 qualification 时 complement 错误为空。最终相关测试在这些修正后重新执行，49.41 秒；日志 `/tmp/jianji-d2-related-final.log` 与 `/tmp/jianji-d2-typecheck-final.log` 为本机临时证据，不提交运行资产。

Chrome MCP 新页面创建因共享 profile 正在占用失败，未终止该浏览器。改用本次独占的系统 Chrome headless context 运行实际 loopback 工具及页面。三帧 64×64 真实 fixture 的 censusDigest 为 `2042baa7bd4b9f9b336cc92a5863e69f808e74c943ea48e2774b9bc0b209b204`；全部收到的 RGBA 字节、Canvas readback SHA 和 frozen result binding 相等。viewport 缩小后 EMPTY/TARGETS 禁用，零选择不自动记录 EMPTY；机械记录 EMPTY、同时两个目标（包含 animated）、UNKNOWN 后 freeze 成功，canonical unverifiedIntervals 仍覆盖全部三帧。receiptDigest 为 `96b74c537f3093a346e43e511d7c94e3899411d24204513dff5c7088a3c30e58`。页面、截图和结构结果在 `/tmp/jianji-d2-browser/`，服务已通过精确 PID 身份检查后关闭并完成 cleanup。

这是 transport/UI 自动化与真实 CPU decode 证据，人工语义 acceptance 为 NOT_EVALUATED。没有运行全项目 suite、Windows 实机、真实视频人工全片审阅、E 性能/成片验收或模型 completeness；既有 shape regression 101 tests 属 D1 checkpoint，本轮没有重新声称该项 fresh PASS。

## Candidate Identity and Review Gate

| Path | SHA256 |
| --- | --- |
| src/main/source-fact-review-evidence.ts | 2ec3ab9f4cb1ce7ad5694d0ce91b873ad43c25c3dc79d4bd3ad8287cf08751fa |
| src/main/source-fact-review-session.ts | f201e87ba1abc5b6f6a9a80dd006a6e3482144fb0b97673db2ef55bc97106dfd |
| scripts/source-fact-review.mjs | 67e6648d5100a2005780b3718a23b82c25e83b782134102225c869bdb5aa495c |
| scripts/source-fact-review.html | ea6558225763049ded2791bdb2e4e07e31ed9105c17e14439b3d8c95675b20e4 |
| tests/source-fact-review.test.ts | 35c6db04935cd233670e96ef5a33a088099ee34eb3b7267a9b892e272a7e0309 |

D1 五个 source/test SHA 与 [D1 frozen checkpoint](shape-matched-cover-m5d1.md) 相同；A/B/C 和 shape candidates fixture 也逐字节核对不变。Parent 在 fresh verification 后对该 exact snapshot 按 SUBAGENTS Implementation Review Risk Gate 判断一次：`KIMI_REVIEW_NOT_REQUIRED`。用户未要求此 snapshot 的 adversarial review；独立 record/tool 不具有 production、knowledge、跨项目或发布 authority，没有关键持久状态修改入口。尚存的人类 semantic qualification 缺口全部阻断，未以 code/tests 升级为许可；Kimi code review 不能替代人类方法 qualification。因此没有“重大后果 + verification 后实质缺口 + adversarial 增益”同时成立的放行路径。Parent 保留最终 diff、绑定及门禁裁决。

standing Kimi route 已执行独立 bounded read-only mapping：封存 D contract 与 assisted session，task seal `824e10ff8dd0c7195f3a3018b1a04cf5c0313026f0a3100f2b1165dba572186d`，invocation `20d75efa-9593-4499-af47-acf8dcb522c3`，route `27ba7e0c-32b1-41a9-8210-4f49474e0a30`。canonical receipt 证明 qualified Docker、api.kimi.ai /k3-256k/high、两次请求、完整读取、PARSED/exit 0、94.74 秒；报告 SHA `93aca193786d978bc7275cb29012bfa69655e9a48025c06423b40508b358db33`。Parent 源码裁决：assisted no_cover、accept_uncertainty 与 click-seen 不能复用为 exhaustive semantics；raw receipt 不授予资格；本轮不复用其持久化 owner 或制造 fake qualification。这是 mapping，不是 final candidate review。CodeGraph 对 census 和 assisted edit 的真实关系查询成功；具体关系仍以源码核对为准。

## Governance and Checkpoint

用户此前授权其他索引 owner 完成后 Parent 串行维护完整官方批次。本轮 AOCI 原子 Apply 完整 7 项（两项 D2、五项共享源码索引），remaining=0；只维护索引，不修改五项共享源码。Verify/Check/Guide 均 exit 0，governance_aligned=true，Guide complete=true /next_action=none；missing/stale/orphan/unbaselined 和 findings 均为空。Code volume 174 entries，SHA `896b8d1eca681946d6dd2a521b4d6a44c77110159cb33500c9efd76b93e00d7f`，composite `13198be1c64568f65d28b23d0d81746af044e79bd5ef185a98b7991f7e1f31ce`。Apply audit 有 session 文件 94 行而 E 标 S 的非阻断规模提示；未将 aligned 结果描述为零 warnings，也未反复 Maintain。治理结果绑定含他人 staged/dirty 源码的共享树，不证明独立 checkout 的全部源码已提交。

仅提交本轮两个 owners、测试、独立工具/page、Plan、本 milestone、正式 Code index 与 baseline；运行缓存/收据和其他 writer 的源码、staged 内容及用户项目删除不进入本提交。Session-record 已评估：本轮有 durable implementation/live proof，沿用现有 milestone + Plan 的 record owner；未发现 repository 专用 capture skill，不增加第二套记录生命周期。

下一步仍在 D2：完成合格人工方法与实际人类审阅验收。此前不接受语义完整性、no-sticker proof 或 D3/D4 authority，C 成功 issuer 和 B activation 继续阻断。
