# Hybrid Corner H3 Record

## Outcome

2026-10-05开始，2026-10-06（HKT）checkpoint；基线 `8cac9c44d33a64431026df1084103197dcc94d31`。H3 development geometry 链已把 real233s TOP_RIGHT 的 H2 CONFIRMED / OVERLAY_LOGO / STABLE 转成 deterministic frozen PNG，geometry READY / completion BLOCKED（运行期间外部源码继续变化及required Harness，见下）。H3主体提交 `000f3e6251cd4e4b13d531e2cbd32dfb208b4069` 已核对在origin/main；新的验证恢复补充尚未commit/push。PRODUCT_DISABLED、authority=none、contentSafety=NOT_EVALUATED；H4 视觉 QA、MiniMax、preview render、export、UI、activation 均未执行。

## Implementation

[Hybrid Delta](shape-matched-cover-hybrid-v1-spec.md) 与 [implementation plan](superpowers/plans/2026-10-05-shape-cover-hybrid-h3.md) 定义边界。H3只消费 fresh `getConfirmedCornerTargets()`，复用 M1、原 conservative extractor、multi-component、pixel gate、alpha 和冻结发布。mask 使用既有默认96张代表帧；密集 component 必须唯一且完全包含于对应 H2-confirmed component box，否则仅该角 MASK_TARGET_AMBIGUOUS。H2 的24张帧独立供 sampled motion；逐 component 检查 mask interior：reference局部contrast≥64的点需≥8，然后做有限RGB平移匹配；明显移动/消失/变化/不可观察即跳角。任一局部 mask/shape/tool failure 不影响其他 confirmed corner；source/engine/semantic/catalog binding 或取消关闭全源。

当前161款本地 pool 固定 ID 顺序搜索，5档等比尺寸和9个小平移位置，1280栅格/11520摆放/180秒；裁全透明外围，不改资源图文，不改变部分透明像素。保留既有 radius≤8 source px、area≤1.35、span≤1.16 和 fully opaque alpha 门；无匹配 NO_SHAPE_MATCH，耗尽 HYBRID_SEARCH_LIMIT，不生成白矩形 fallback。shared raster freeze seam 供原 freeze 和 H3 复用；原 Knowledge Store / request / approval / queue owners 保持，无新知识写入或proof。

## Real233s Evidence

| Item | Result |
| --- | --- |
| Semantic | TOP_RIGHT / OVERLAY_LOGO / LUNA / STABLE；logicalTargetId `c69df5aa6597df7407084e21efb34186d50ead9510bca6e297d40601734340ab` |
| Old conservative mask | 3395px；bbox `628,1,81,59`；SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893` |
| Mask population | 默认96张代表帧；原3395px mask复现；133条 full-range RGB anomalies 保留，仅diagnostic |
| Motion | STATIC_SUPPORTED；24 samples；2027个可追踪reference pixels；最小 stationary match `0.8214109521460287`；match阈值0.65 / contrast≥64 |
| Sticker | `local-limited-seckill-go`；原资产 SHA `sha256:77d956dd13e7ce05fe88bbe60c91cbd1d3cad1c44986467b308351a0498e36fc` |
| Transparent trim | `184,368,1704,1115`；trim SHA `65140694745a9207261227df18479917c033debaceae80952af006660fef1d6f` |
| Placement | output pixels `x=626,y=0,width=94,height=61`；finite opaque contour radius=6 |
| Search | 161 catalog assets；651尺寸栅格；1118摆放；4款不满足静态解码/非空可见像素准入而排除 |
| Coverage | projected oldMask 3681px；uncoveredPixels=0；coverageFraction=1；最终解码alpha全部255 |
| Independent alpha recheck | 应用FFmpeg再次解码：原3395 mask pixels的uncoveredPixels=0 |
| Frozen PNG | 720×1280 RGBA；16802 bytes；SHA `5cf525c17c5121980caba8d34674ea0978a5b964975e3f72efd150e7d1b93896` |
| Frozen RGBA | SHA `bf1fe9e7e9986b10eeb273a05c02800729593c6264e92ce646ec4f3304e70bf3` |
| Final binding | `d02dfac0c2bc4b63c3f93a69476cbbe6dfd783b95543a75a3bbbbfab8f43e82d` |

H2 partial 保持：TOP_LEFT NO_CANDIDATE，BOTTOM_LEFT/BOTTOM_RIGHT UNRESOLVED / UNDETECTED_CORNER_OVERLAY_SUSPECTED。H3 READY只指已确认目标集合，不升级这些角。

本轮消费已接受H2的既有历史结果（real233s三份历史回执标记gpt-5.6-luna）；不重新调用该旧型号，也不把旧回执称为gpt-6验证。diagnostic/test的fixture或historical-receipt-replay route只在内存返回归档JSON，model字段是角色标签，不是GPT/HTTP假服务调用；不存在新增可选模型或Provider请求。

首轮误用H2的24张mask总体时得到3368px/bbox628,2,79,58/SHA bf0b6f…，已明确拒作最终real case，完整保留初始结果。原因是代表帧不同，不是调mask参数；之后复用原默认96帧并加原mask数/bbox/SHA assertion。dense与首个稳定源码两轮的mask、motion、选款、placement、coverage、PNG完全一致。最终Parent自检复现大块纯色overlay移动12px而共同mask内RGB仍相同的误报；先建立可靠red regression，再增加固定contrast≥64的轻量可观察性过滤。无可追踪信号仅该角UNOBSERVABLE。更新后real233s仍STATIC_SUPPORTED，mask、选款、placement、coverage及PNG原字节保持，motion metric/config及绑定如上；不是依据real233s调参。独立H2 replay事件的timestamp不同，使semantic receipt/binding digest不同；同一个H2 semantic对象重复H3的integration test证明PNG及binding digest一致，未删除审计字段取得一致。

## Artifact and H4 Handoff

私有证据根：`/home/reggie/.local/state/jianji-source-fact-qualification/hybrid-h3-20261005`。最终 `real233s-observable/result.json`、其 `input-freeze.json`、`real233s-observable-independent-alpha.json` 与 `real233s-determinism.json` 保存绑定与实测。`real233s-final`和第一轮Harness PASS保留为修复前历史；最终completion不得引用其旧source snapshot。

冻结PNG：`/home/reggie/.local/state/jianji-source-fact-qualification/hybrid-h3-20261005/real233s-observable/frozen/ef1812e9-9c97-401e-a5e8-5a2eca079c31/shape-5cf525c17c5121980caba8d34674ea0978a5b964975e3f72efd150e7d1b93896.png`。

PNG已在目标720×1280画布栅格化，后续H4应同尺寸在0:0叠加，使用冻结range/settings与同字节SHA；不得重新选择/摆放/生长。H3提供 active-owned `readHybridFrozenOverlay()`，重核source、catalog、PNG/RGBA与100% alpha，clone不能恢复live对象。独立进程留下的JSON/PNG是H4输入数据，不是正式生产准入；H4仍须绑定源并接其development渲染消费接缝。现有strict生产compiler/queue入口没有被放宽。

## Delegation and Parent Decision

受管Kimi deep只读mapping invocation `810db656-decd-4894-a1a6-f29466443d71`，sealed contract `e5df82d7-0d2f-4515-9be3-1863f2014801`，seal `322d8d03f17b77cb8ce14f55cf6bb2d5084988bd38c59caf1b6cf3e34ffdf15c`。qualified deep route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，Docker containment，PARSED/exit0，3个工程wire requests，未写源码。Parent核对复用alpha/pixel/freeze建议；没有采用把旧RGB异常保留为Hybrid motion blocker的建议，因为当前用户已明确授权sampled motion路线。Kimi不是H3验收或最终review；real H2重放新增Provider请求=0，与工程Kimi请求分列。

## Remaining Limits

sampled motion不能证明每个未采样帧；100% coverage仅证明原mask与最终PNG关系，不证明mask独立真值、未确认角落、自然度、脸/商品/字幕避让或贴纸图文安全。H4必须评价选中贴纸自带内容和有限白色轮廓、边缘/遮挡及真实观看。Windows未评估。没有NO_SHAPE_MATCH blocker，真实pool已有几何匹配。

## Session Record Evaluation

仓库没有dedicated session-capture Skill；本轮为substantial implementation/real geometry checkpoint，本record保存durable结果，不将无hook或无capture_request_id作为跳过理由。原H2及strict FAIL/NOT_EVALUATED不改，PRODUCT_DISABLED不变。其他会话22个业务/测试/脚本dirty paths的diff逐字保留；共享AOCI仅提交本轮owned entries/baseline投影。

## Initial Blocker Checkpoint

2026-10-06（HKT）达到 geometry-ready / completion-blocked checkpoint。本轮12个native验证对象的snapshot `e85e9cacbd024f10e95225502dba80a3e1839560ad474284b81d472e3061aef0` 未改变；正式commit/push尚未执行。待外部会话关闭其batch-plan改动和测试阻断后，必须取得fresh完整owned Harness PASS、重新判断Implementation Review Risk Gate并完成completion核验；不能把以下逐检查PASS当成Harness completion PASS。

- 当前H3源码的typecheck与diagnostic单独TypeScript检查PASS；H3专项9 tests PASS（含纯色移动反例的red→green）；原shape/pixel专项111 tests PASS。
- `.agent/harness/runs/20261005T153624Z-7f803738/receipt.json` 的17 required checks均PASS，2429 tests PASS，0skip/0failure；最终整体为NOT_EVALUATED，因为运行期间外部会话修改 `tests/batch-production.test.ts`，全库source identity变化。ownedSha256、documentSha256、policySha256及scopeSha256均未变。保留原始回执，未升级为PASS。
- 重跑 `.agent/harness/runs/20261005T155440Z-de0b0cbf/receipt.json` 又遇到外部 `src/renderer/BatchProductionPanel.tsx` 和test变化，Parent经精确PID/ancestry核对，通过Harness canonical SIGINT/AbortController停止本次已失去source identity的运行，未杀其他进程或修改业务。该回执保留FAIL：新增batch plan选值断言失败、旧batch-upload读取行为测试超时；中断的shape-boundaries/未执行required checks保持NOT_EVALUATED。
- 最新定向检查 `tests/batch-production.test.ts` + `tests/batch-upload.test.ts`：71 tests，69PASS/2FAIL；两个计划读取/重选测试超时，期间外部源码继续变化。精确报告在私有 `foreign-batch-current-tests.json`，不修改其owned files，不以skip/宽松timeout掩盖。当前completion blocker是这些外部改动及required Harness证据，不是H3 mask/shape/coverage。
- 修复前source snapshot的第一轮完整PASS及旧Risk Gate保留history；motion语义修复后不能引用旧gate作为当前结论。当前Risk Gate为PENDING_NATIVE_VERIFICATION，未调用/声称最终Kimi reviewer，mapping不替代review。
- 本轮AOCI六项机器批次及motion修订维护已完成；此前官方Verify/Check治理对齐，Guide complete=true/next_action=none。最新官方Verify/Check发现外部 `src/renderer/BatchProductionPanel.tsx` stale，Guide为authoring_required，该session负责维护；本轮fresh `control owned-aoci` 仍PASS，12个owned dispositions匹配当前官方snapshot（六项index、六项observe；另H3 record为observe）。共享stage projection只包含本轮六项entries/baseline，保留foreign内容。
- blocker checkpoint最新typecheck PASS，H3 record的documents/owned-aoci二项Harness PASS；这些比例适当的局部证据不授整轮completion。当前15个task paths已按owned对象刷新stage，未commit/push，原外部22路径diff逐字保留，后续外部batch-plan files没有修改或stage。

PNG已经可供H4development接线及Preview QA使用，但HYBRID_CORNER_H3_READY不能无条件作为本轮完成状态交付；H3 geometry READY与completion BLOCKED分别保留。PRODUCT_DISABLED、内容安全/自然度NOT_EVALUATED不变。

## Verification Recovery Checkpoint

用户于2026-10-06要求继续验证、commit/push。已核对本地HEAD及远端main均为 `000f3e6251cd4e4b13d531e2cbd32dfb208b4069`，原H3主体15个paths已提交；原blocked历史不升级为PASS。本轮仅补充干净的旧 `tests/batch-upload.test.ts`、implementation plan和本record，不修改外部dirty业务文件。

旧测试等勾选后自动读取，而外部未提交界面要求显式点击“读取上传计划”。测试仅在按钮存在时核对尚未请求并点击，已提交旧界面沿用原读取；账号绑定、取消、已选计划复用和timeout保持。修正前70PASS/1FAIL；修正后当前两文件71PASS/0FAIL。另用git archive生成私有测试fixture，绑定000f3e6已提交界面及其依赖，读取/取消定向测试1PASS，其他10项未选择；该证据不冒充完整clean-HEAD Harness。当前测试兼容两种已有界面，提交不依赖外部未提交UI。

- `.agent/harness/runs/20261005T161340Z-19db77c1/receipt.json`：外部batch读取按钮grid样式改变source SHA，NOT_EVALUATED；通过精确pidfd/ancestry核对后只中断本轮Harness。
- `.agent/harness/runs/20261005T161928Z-32686f47/receipt.json`：14项已完成检查PASS、1430 tests PASS；外部 `src/main/qianchuan-page-contract.ts` 和 `tests/qianchuan-page-contract.test.ts` 在运行中改变，整体NOT_EVALUATED。原回执保留，未升级PASS。
- 两次源码观察间隔144秒无变化后启动下一候选；发现测试提交依赖未提交UI，停止 `20261005T163809Z-f903ebac` 并完成上述已提交界面兼容验证。这次own语义修订重新冻结scope和有限预算，不沿用旧测试SHA。
- 最终候选 `.agent/harness/runs/20261005T164022Z-25ad4288/receipt.json`：14项已完成检查PASS、1439 tests PASS、0FAIL；运行中外部 `src/renderer/BatchProductionPanel.tsx` 新增制作错误及startReasons，SHA从 `9d97545f0cf31fca1ff191e60fa8504436e2744c3ddb7413fcb801cf383796d3` 变为 `036f72019a564372b99f240bb98eebac7fbc22fce17a8e90e29a05012072a8c8`，随后继续变为 `5b3d78cfaebf6ec3b777f4024d491bdb4c86d97a670c5ed7b5cd55be1621d81c`。再次只中断本轮canonical Harness，整体NOT_EVALUATED；未完成required checks保持NOT_EVALUATED。
- 最终13个owned验证对象无字节漂移，ownedSha256 `bebc4f06b4552cb74f1123baaf8400beeb27cbd91b69d32fafe712ce999cf3b3`；H3六项indexed源码等于已提交主体，PNG及独立原3395px零漏复核保持。私有 `resume-final-source-blocker.json`、`resume-final-foreign-batch-diff.patch` 保存确切新漂移；外部26个tracked paths未由本轮修改/stage。

最新官方AOCI Verify/Check均governance_aligned=true，Guide complete=true/next_action=none；外部旧stale已由共享治理更新关闭。fresh `control owned-aoci` 对本轮13对象PASS（六项index、七项observe）。本record的documents/owned-aoci及其completion单独PASS，只证明该文档checkpoint，不授整轮H3完成。外部批量制作会话的 `20261005T164823Z-af955aae` 验证scope只拥有BatchProductionPanel和batch smoke脚本，与本轮H3验收分列；未终止或接管其进程。

当前停止条件是反复发生的外部源码写入，不是H3 mask、motion、shape或coverage失败。完整required Harness及completion尚不可证明；Risk Gate仍为PENDING_NATIVE_VERIFICATION，无最终Kimi reviewer声明。原Provider请求=0、PRODUCT_DISABLED及H4边界保持。必须等其他写入会话真正停止，再取得完整fresh owned Harness/completion；本轮不新增补充commit，也不将已有主体commit解释为最终验收。
