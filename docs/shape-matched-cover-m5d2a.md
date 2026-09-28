# M5-D2A Engineering and Qualification Record

## Status and Authorization

2026-09-29 用户在收到 [AI spec](shape-matched-cover-m5d2a-spec.md) 后明确要求开始，执行 [AI implementation plan](shape-matched-cover-m5d2a-plan.md)。`c9515ca` 的 DESIGN_ONLY 为历史状态；本次并非重新设计或 next-window 交接。

当前 `ENGINEERING_CANDIDATE / QUALIFICATION_INCOMPLETE / FORMAL_RUN_NOT_STARTED / PRODUCT_DISABLED`。尚无 M5-D2A PASS、正式 AIReviewReceipt、mapping/joint receipts、truth correspondence 或资格记录。human `explicit-human-full-canvas/v1` 保持 INCOMPLETE；两模型一致、文本 HTTP 200、schema 或工程测试不证明语义资格。

全过程 `authority=none / eligible=false`；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance 均 BLOCKED。没有 source admission、FullSourceAdmissionHandle、production semantic PASS、knowledge 写入、产品 IPC/UI 或 placement/candidate/coverage/renderer 接线。

## Engineering Owners and Limits

`source-fact-ai-contract.ts` 定义 machine TARGETS/EMPTY/UNKNOWN、独立 criteria 和新 package 绑定；仅复用已有 manifest/truth 数据形状、sourceKey 与规范摘要，不转换 human session。`source-fact-ai-input.ts` 复用活跃 owned D2 evidence 及 canonical D1 census/clock；原尺寸完整 PNG 按最多8个连续 ordinal 分包，PNG→RGBA 精确往返核验，PNG 与 RGBA 摘要分开，重复像素保留不同 ordinal。

`source-fact-ai-run.ts` 是明确 ENGINEERING_ONLY 的 injectable transport。完整 packet 校验后追加不可编辑声明；一旦作者侧观察到 false EMPTY 即停止后续请求并永久 NOT_QUALIFIED，取消后的迟到输出隔离。模拟请求有 request/wall/idle/payload/response/generation 上限，记录原响应和输入绑定，不重试或切换连接。generic AbortSignal 不能证明真实进程/网络生命周期收敛；因此它不提供正式 actor/issuer，caller route/config claims 不能使其 qualified。

`source-fact-ai-compare.ts` 分别计算 A/B/joint 的所有硬门、category、identity merge/split、ordinal边界、并发目标与5%可用性；joint 必须有显式双射、category、完整活动 ordinal 集合对应。任何 actor 的错误不能被另一 actor 或 joint UNKNOWN 抵消。未评估字段 null，缺少完整 actor/分层数据不汇总为已评估零。离线 MATCH 固定 qualification INCOMPLETE，record=null。

尚未实现正式 route/probe/config/isolation 来源验证、跨 actor 整包执行与撤销、可信 AIReviewReceipt/mappingReceipt/jointReviewReceipt/correspondence 的独占持久化及资格 issuer。它们必须绑定实际受管视觉接口后继续；没有用模拟 transport 代替这些门。

## Independent Holdout Preparation

`scripts/source-fact-ai-fixtures.mjs` 使用三种结构不同的 scene：product still life、room/person、dashboard grid，不导入旧 D2Q recipes/media/diagnostic答案。作者侧随机匿名 fixture，18类每组各一片、每片12帧，目标54 clips /648 source ordinals。真值由独立构造和实际 canonical decode 绑定建立，视频解码与作者 nominal RGBA 逐通道误差≤3；PNG 往返要求实际解码 RGBA 完全相同。

`scripts/source-fact-ai-qualification.mjs` 仅提供 author-side prepare-holdout、verify-preparation 和只读 offline compare，没有正式 collect 或 successful issuer。新目录 exclusive 创建，作者文件0700/0600，dataset/truth/criteria/inputPlan/source snapshot 独占冻结，全部18类及数量不足时拒绝。

首轮 `/home/reggie/.local/state/jianji-source-fact-qualification/d2a-independent-20260929-a` 在600秒本地 CPU 预算到期时 cancelled/exit124，未生成最终 package；保留为未完成工程尝试，不作为冻结 holdout 或资格证据。检查 cancellation 日志及实际进度后，在新目录 `d2a-independent-20260929-b` 启动一次900秒独立构造，没有删帧、缩样本、改标准或模型重试。最终冻结与核验事实见下一节。

所有材料为 SYNTHETIC_CONTROLLED。REAL_MEDIA_HUMAN_TRUTH 未提供、NOT_EVALUATED，synthetic 准备不证明用户真实媒体泛化。作者实例是当前 Codex Parent，两名正式 actor 尚未创建，holdout actor delivery=0；本聊天不能成为盲审 actor。

## Frozen Preparation Evidence

第二轮本地构造 exit0，候选目录 `/home/reggie/.local/state/jianji-source-fact-qualification/d2a-independent-20260929-b`，datasetVersion=`d2a-independent-dbac4dc1-77b4-4fb8-beec-b58876813b7f/v1`，freeze=`2026-09-28T17:34:11.382Z`。独立 verify-preparation exit0、preparationVerified=true；复制副本单字节改动PNG后，验证 exit1、INCOMPLETE: frozen PNG/frame binding。原冻结目录未改动。Parent只以作者身份查看三个结构组的实际静态PNG，未作为资格actor。

| Evidence | Frozen value |
| --- | --- |
| datasetDigest | `2b17511e2d1346015dbf8e847c028934728b840e0d916c78ed09959781fa591b` |
| truthDigest | `58d20af4b973c31289e0fda7609905b10d9694d100511bcd9d5b3817414d4eef` |
| criteriaDigest | `6e9fefc820cd83335844372ff543004f24ed91335059682e94fd57455cb40bbe` |
| inputPlanDigest | `86d1b93177c709a1b461916d4d03c221f7afc9862ee5bd5a16d0e66b4acbe0b6` |
| sourceSnapshotDigest | `fce2eaffc7b2494d79c17c49c79ee2aefc3a5e1499cfdd7b75e7e9d9f8652bfc` |
| Actual truth coverage | 3 groups /54 clips /648帧；609 clear、270 EMPTY、339 present、36 multi、9 single、6 cuts、6 motion、18 ambiguity anchors；18场景齐全 |

coverage minimum成立只说明真值包和输入准备。budgetDraft登记每fixture/actor 2个packet请求，整包216+1 mapping=217请求，generation4096/request、wall180s/request、idle90s/request、total wall3600s、max8 PNG/request、payload32MiB；不等于足够或已批准的正式预算。methodConfigDigest、applicabilityEnvelope、visualProbeA/B、isolationEvidence、可信 issuer 仍未成立；正式费用授权草案=0。完整 prompt、provider/runtime身份、上下文容量、整包mapping payload/generation、成本和取消收敛必须先通过真实 capability gate 再冻结，不能倒填。空审阅的真实CLI offline compare返回 INCOMPLETE/record=null，A/B/joint全部指标null，未以零填补。

## Managed Route Evidence and Blocker

本次受管 Kimi explorer 只核对既有 `source-fact-review-evidence.ts`、`source-fact-review-session.ts`、human comparator 复用边界。worker/high，sealed contract=`1233e9dbd6602374f5da97f866df1a715d0ec88a6069cae930d7e864f4549faf`；invocation=`914e4139-92cd-4f40-8296-472a8bbcc27d`，route qualification=`27ba7e0c-32b1-41a9-8210-4f49474e0a30`。canonical receipt 记录两次实际 `api.kimi.ai / k3-256k / high` HTTP200、request_max_tokens=generation_limit=4096、process exit0/109.84s、无截断，全部 required Reads/source SHA 已核对。worker report SHA=`8650ded52c99313885eddb963336d3dbf4ec9781b27aeda44584537a845063a6`。该路线是 Kimi，不是已验证的 Anthropic Claude；mapping不是视觉 probe 或 final review。

Parent 以源码核对采纳 owned evidence WeakSet 不能伪造、human method/confirmation/receipt不可借用，以及原 human comparator 未校验 category 的发现。对身份对应的推断仍以当前源码为准，不让报告建立第二 evidence owner。Kimi 没有接触新 holdout/truth，也不担任 qualification actor。

实际 `/home/reggie/.local/bin/subagent` pin 到 installation `142bc8650c9c5c285cf7b12ffcf90730b29732b71a423b0271f2b28a4968ba13`。其中 `adapters/project_claude.py` 强制 `TOOLS=('Read','Glob','Grep')` 与对应 allowedTools，project_prompt 要求实际 Read 和 canonical report；CLI inspect/run 没有已验证的无文件工具 image packet actor 接口。零联网 `inspect` 加入 image_input 扩展返回 INVALID_CONTRACT（unknown task fields）。这证明当前受管 project 接口不满足本合同，不证明 Kimi 后端本身不支持图像；transport identity 检查没有一般禁止 image blocks。

静态 route audit：`/home/reggie/.local/state/jianji-source-fact-qualification/d2a-route-audit-20260929/audit.json`，SHA=`f55abd7ba82f5c468ea3d63c6bdad6f7b52f701c1bc762fba49ad3acd0460ce8`，绑定实际 wrapper/adapter/identity/contracts 字节。A/B 视觉能力 NOT_EVALUATED，正式视觉 probe requests=0，formal provider requests=0，methodConfigDigest=null，全部正式语义指标 null/NOT_EVALUATED；尚无可信记录 issuer。不使用 host claude -p、当前聊天、文件 Read 图像或静默切换 provider 绕过此阻断。

## Verification and Review Gate

执行 `verification-before-completion`，所有验证仅证明工程机制。初始15项测试通过；图像变异否定测试修复前真实失败（1 failed/39 passed），修复后40项通过，随后54项通过。final candidate补充伪造准入否定测试后，三个AI files /58 tests全部PASS（16.35s），包括真实CPU D1/D2/PNG往返与模拟transport；没有真实模型视觉调用。

首次相关13 files /341 tests：331 PASS、10个旧human review测试触发5000ms超时。构造结束后串行13 files /345 tests：12 files /334 tests PASS，human review 11 tests仍5000ms超时（181.72s，exit1）。单独digest test同样5009ms超时（exit1），没有断言结果。独立自动诊断仅运行原human工程owners且不保存真人或资格收据：32×32/6帧路径encode25ms、identify28ms、owned evidence4439ms、呈现4451ms、finish6122ms；原prepare/finish均复查完整census及引擎。CPU PSI采样avg10=27.53、avg60=40.26，只证明存在负载，不作为唯一根因。没有提高超时、改旧代码/tests、停止用户进程或把失败记为通过。初次单测worker范围冲突、临时计时脚本filename错误导致Node退出均为调用错误；修正后得到上述复现。

fresh全项目typecheck exit0，开始/结束338个TS/config文件SHA一致；两个新scripts的node --check及git diff --check exit0。101项shape regression曾PASS（308.11s），之后其他会话改了compiler/domain等owners，历史结果不冒充最终共享工作区回归。原census/human/qualification/knowledge/admission/activation/assembler/PNG codec最终diff为空。

Implementation Review Risk Gate为 `BLOCKED_NATIVE_VERIFICATION`：适用原human回归未通过，按SUBAGENTS.md不提前消耗final reviewer预算，不签发implementation completion。稳定代码/scripts/tests snapshot digest=`f09adc4c94466dec293a11101071a3a6af34850c828b61d1a9872df2d2ebb2ee`。用户未明确要求该snapshot的Kimi review；当前无生产consumer、凭据或successful issuer，正式视觉缺口必须由真实route/probe解决；这些事实不替代先通过native verification的门。Kimi mapping并非final review。

独占工程证据目录 `/home/reggie/.local/state/jianji-source-fact-qualification/d2a-engineering-20260929` 保存15份日志/快照及逐文件SHA，manifest SHA=`e36537da52c1e062c5db2bca70f0e2b077bf1f65868edbc53575b915c7c4b9b0`。空审阅offline结果SHA=`3cbc276d37230e63d9baf3243126eb76cc06862919d032516f003a97c623fe0c`，record=null。

## AOCI and Shared Working Tree

完整Whole-Index三块交付已确认；最新严格model attestation未提交ordinal答案，fail/uncertain，不声称完整系统认知已验证，仅继续source-bound工程。官方Maintain首批因另一任务改BatchProductionPanel导致source binding变化stopped，formal_writes_started=false；核对fresh源码后官方8项Apply、追加1项Apply成功，包含四个AI条目及同批已核对的批量/上传条目。没有修改或stage这些业务源码。

其他会话继续维护正式索引/baseline，二者SHA已从本任务已核对的状态变化，成为混合归属文件。未有shared-file ownership决定，本任务停止写入/stage/commit二者，不手工拆分或回退。当前四个AI entries/baseline SHA与源码一致。checkpoint `aoci verify/check` exit1，Guide complete=false，三个上传owner stale；随后其他会话维护完成，最终delivery `aoci verify --json`、`aoci check --json`、Guide全部exit0，governance_aligned=true、stale=[]、Guide complete=true。三个delivery JSON独占保存到工程证据目录，证明当前索引与源码对齐；混合归属正式资产仍dirty且不纳入本任务commit。误用 `aoci index verify/check` 只打印帮助、exit0，不算核验；上述结论来自correct commands实际JSON。治理对齐不证明完整系统认知或行为资格。

共享HEAD从85c97f7被其他任务推进，全部无关dirty保留。checkpoint只提交本任务13个明确所属路径，不stage混合归属AOCI资产、业务代码、项目删除或其他tests。commit只封存未验收candidate及阻断事实，不证明工程或资格完成。substantial record owner为本文件及plan；未发现适用repository session-capture skill，不写外部memory。

## Historical Checkpoint Stop and Remaining Work

停止原因是受管路线缺少可验证的隔离及无文件工具视觉actor接口，另有原human回归超时和共享AOCI资产commit ownership阻断。正式qualification INCOMPLETE，工程completion/review gate未通过，不能声明M5-D2A PASS。剩余需真实受管A/B route、独立非holdout probe、身份/隔离/有限成本证据，随后冻结methodConfig/inputPlan/budgets，实现可信formal execution/receipt/correspondence/issuer，再运行一次blinded qualification；还需解决原回归超时、判断final Review Risk Gate并由明确owner提交已对齐的正式AOCI资产。可验证false EMPTY或其他硬错误立即NOT_QUALIFIED并停止后续正式请求，历史结果保留。D2 Production Qualified Review超出本次自动授权。

## Blocker Repair Authorization and Current Evidence

2026-09-29 用户追加“修复blocker”，并明确选择“包含 router 扩展，保留 sealed contract、Docker 和资格门”。此次允许处理独立 `/home/reggie/vscode_folder/agent-subagent-router` 的 image route extension/installation；不是 source admission、产品启用、无限调用或正式预算批准。该仓库 accepted architecture Spec V3 要求 semantic revision 的新 exact SHA 批准后才可实施。独立扩展合同已写好并 Self-Review：`docs/superpowers/specs/2026-09-29-image-only-route-design.md`，SHA=`c1169a61ba8573a2c4ce442b321683a65b800230d3e8620e069e388a6d97c0f1`，`EXACT_SHA_APPROVAL_PENDING`；不伪称范围批准已接受这份新 bytes。批准问题已提交，等待期间继续独立修复及验证。

旧 human suite 原样 fresh baseline 28 tests PASS（21.40s），完整13 files/345 tests baseline PASS（58.38s）；说明历史超时不是本次每次都失败，不改写旧失败。仅将 `tests/source-fact-review.test.ts` 的完整解码/evidence suite timeout 从Vitest默认5000ms调整到已有real-media tests采用的30000ms。全部断言保持；未改变human method/schema/presentation/acknowledge/receipt/digest/拒绝行为或D1/D2实现，没有把真人资格标为完成。修改后同13 files/345 tests全部PASS（80.50s），另shape candidate/pixel gate 2 files/107 tests PASS（198.23s），fresh typecheck exit0、scripts node --check和git diff --check exit0。

最后typecheck/shape回归开始和结束343个TS/TSX/config paths的SHA完全相同，snapshot digest=`832593a77beccd8b1517b85be2b88c4d233abe1e163366c4b05f33d386be30b7`。原9个AI工程文件与上一checkpoint字节相同；加入本次human test budget后的10-file snapshot SHA=`1b3e4511103b98ab981de8cbfa0f806d1dbcccae8f1c930f5b5d2edbb39280da`。原census/human production/qualification/tool owners diff为空。现有human collector只读进程核对未见运行实例；未提交语义选择、重启或挪用它。

本次受管 Kimi mapping只读router `contracts.py`、`adapters/project_claude.py`、`cli.py`，seal=`6d6918d940146296cf663c3cf72484993de481d3c8cfdac3ddd61bed2d2c50f8`、invocation=`5208fa9e-fdb5-4c2f-bd84-aabf15bf8cb7`、qualified route=`27ba7e0c-32b1-41a9-8210-4f49474e0a30`。Parent已机械核验全部Read/SHA、artifact SHA/size、Docker qualification、两个实际`api.kimi.ai / k3-256k / high` HTTP200、generation4096、exit0/55.72s、无截断。report SHA=`91b06ed5ca427028420bd23d91d0944cc8c221f3e9334a2d8805a68d24c0aa27`。这不是视觉probe或implementation review，不接触holdout/truth。另native code_mapper只读核对现有Codex图片RPC/环境限制及router缺失Codexbroker，未调用账号或模型，未改文件；Parent核对实际调用边界后据此准备独立合同。

新发现的router原有FINAL_REPORT工具拒绝测试在未改源码baseline中真实失败：2 failed/313 passed/20 skipped；缩小复现2 failed，JSON和SSE的tool_use都被错误HTTP200交付。源码的诊断`phase`覆盖预算phase，`allow_tools=phase != 'FINAL_REPORT'`永远为true。独立现有合同修复读取owned observation的`budget_phase`，不修改新image协议或旧报告schema；同全部offline tests随后315 PASS/20 conformance显式skip。实际native/containment验证与安装状态由router record独占，本记录不提前宣称其完成。

Jianji stable engineering candidate按SUBAGENTS.md判断 `KIMI_REVIEW_NOT_REQUIRED`：用户没有要求review这个snapshot；本次仅测试time budget，AI工程仍无产品consumer/credential/semantic authority/成功issuer；媒体字节/拒绝行为全部断言及真实CPU回归已通过，没有会导致关键凭据泄露、跨项目authority或难恢复生产状态损坏的具体failure path。尚缺真实视觉语义证据是正式qualification gate，不能由review替代。此判断只解除此前BLOCKED_NATIVE_VERIFICATION，不签发M5-D2A或生产资格。

执行AOCI Verify/Check/Guide后，当前shared governance未对齐：11 findings均属于其他上传任务的missing/stale/unbaselined owners，本次test/docs属于既有observe scope，四个AI managed source未改。完整索引三块交付已host-confirmed，strictattestation fail/uncertain且治理stale，仅做source-bound工程；不声称完整系统认知。正式`aoci.code.txt`/`.aoci/baseline.json`混合归属保持，未有ownership决定，不写/stage/commit，也不处理其他业务路径。现阶段不能宣称全仓AOCI对齐；需其实际owner完成维护。

独占证据目录 `/home/reggie/.local/state/jianji-source-fact-qualification/d2a-blocker-repair-20260929` 保存14份日志/快照/receipt与manifest，manifest SHA=`01ba1891e3796357db9bf5cfecfbc0a982f54e4637d16a6489e328c7841bcbbf`。原frozen holdout/criteria/truth/inputPlan及历史失败保持原字节，正式视觉probe=0、formal requests=0，所有语义指标仍null/NOT_EVALUATED。当前剩余为批准并实施真实router视觉扩展、资格/有限预算/config/inputPlan freeze、可信receipt/correspondence/issuer，以及正式盲审；全过程PRODUCT_DISABLED与全部生产BLOCKED guards保持。
