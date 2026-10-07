# Qianchuan Zero Impressions Cleanup

## Goal And Scope

在现有简辑素材清理入口增加独立规则：所选计划中，最近七个完整自然日（Asia/Shanghai，与用户链接的 2026-09-30 至 2026-10-06 一致）整体展示次数严格为 0，且首次加入计划满 48 小时的素材。用户已明确选择此口径并授权程序自动翻页、逐批核对及确认，不要求用户逐页批准。

## Contracts And Owners

- `src/shared/qianchuan-video-library.ts` 独占请求准入；新增显式规则，旧三类审核清理与定时清理保持原语义。新规则不能和全库清空混用。
- `QianchuanVideoLibraryActions` 复用账号与多计划选择，操作前显示统计窗口和保护规则；一次启动授权冻结的账号/计划，程序确认每批。
- `DouyinUploadService.clearVideoLibraries` 与 `clearQianchuanAccountPlans` 保持唯一控制和多计划执行 owner。
- `QianchuanPlanMaterials.clear` 保持账号锁、pending intent、audit、取消与未知结果保护。新规则支持部分候选页、无候选页及末页；删除后回第一页重扫避免列表位移遗漏。不把列表为空作为唯一成功条件。
- `QianchuanPlanMaterialPage` 继续独占身份、DOM/响应一致性与平台删除；纯规则模块处理窗口、严格指标/时间解析与候选谓词。不得另建队列或直接调用平台删除 API。
- 每次运行冻结统计起止日与 48h 截止点；字段缺失、`-`、非法日期、错账号/计划、请求条件或日期变化均拒绝。展示次数不是播放次数，UI 不作此等同声明。
- 每批只勾选候选 ID；提交前再次读取并核对相同证据。持久化意图在确认之前；新响应总数必须恰好减少该批数量，删除 ID 不再出现在当前页，否则保留 pending 并停止。旧 pending 跨模式阻断，不自动重试。额外标题删除确认仍停止。
- 上限沿用每计划 20000 条、1000 次扫描/删除循环、30 分钟；超限明确 BLOCKED，不能宣称全部完成。

## Evidence

2026-10-07 只读核验账户 `1876131703522649`、计划 `1877582409449488`：`list-required` 的 `product_show_count_for_roi2` 对应响应 `productShowCountForRoi2` 与 UI “整体展示次数”；`roi2MaterialUploadTime` 对应“创建时间”，tooltip 明确为首次加入计划的时间。当前日期范围 09-30 至 10-06；响应日期到秒，时区按平台中国时区解析。自定义列没有独立播放量。用户随后明确选 A。

Kimi read-only mapping receipt `ded47bfd-b52c-4926-8831-a118dc884704`（deep / k3 / max，Docker route，PARSED）指出现有 Offset=0、全页勾选、total 清零循环不适用于部分候选分页。Parent 已核对这些源码事实；该调查不是实现验收。

## Milestones And Verification

1. 规则与共享准入：边界测试覆盖 48h 前后、跨月七天窗口、零/缺失/非法指标及日期。扩展原 schema 的兼容性测试。
2. 原 owner 集成：浏览器 fixture 覆盖混合页、空候选页、分页与删除位移、错日期/指标、外来选择、额外确认、取消及未知 pending。复用原 owner 测试，新增 focused fixture 必须纳入 Harness policy。
3. 产品入口及只读真实核验：真实账号只观察候选，不借开发验证删除；本次实现授权来自用户，实际删除由用户启动软件功能。UI 交互检查规则透传及一次启动行为。
4. `npm run typecheck`、相关 Vitest 与 owned-scope Harness；AOCI 逐对象维护及 Verify/Check/Guide。最终 destructive consequence 触发 Kimi read-only adversarial review，Parent 裁决 findings，必要时修复并重验。最后只提交本 worktree owned files，push feature branch 并核对远端 SHA。

## Self-Review

无新凭据读取、无模型/素材生成、无新定时删除任务、无跨账号自动扩展、无全库删除授权。旧审核清理保留；新度量清理是明确独立规则。请求/响应/DOM 三方校验和严格缺失值处理保护真实删除边界；fixture PASS 不宣称真实平台删除成功。

## Accepted Multi-Select Delta

用户在首版合并后明确要求两类都删或多选。本修订优先于首版互斥 UI 描述：两个独立勾选项默认都选中，可只选审核、只选零展示或都选；全不选时不得启动计划清理。审核类按状态清理，48小时保护仅属于零展示谓词，界面明确解释为所选规则并集。

共享请求保留旧单模式，新增明确组合值；原 `QianchuanPlanMaterials` 串行执行审核再零展示，第二阶段重新读取剩余列表，合计已确认数量；首阶段 BLOCKED 不执行第二阶段，后阶段失败保留此前进度。组合共用30分钟取消上限，所有原pending/身份/逐批核对继续生效，不新增平台API或定时语义。Parent self-review已完成，本次只修订选择和组合编排，不改页面删除适配器。

验证：schema两类/全库拒绝；owner顺序、重叠素材仅删一次、首阶段未知阻断及第二阶段失败保留计数；UI默认双选、任意取消、全空禁用、单次双规则请求。运行typecheck及owned Harness，按destructive consequence做一次针对增量的受管Kimi只读复核，再按已有授权合并main。

## Accepted Delivery And Page Size Delta

用户进一步明确两类计划清理都只处理“投放中”，并要求100条/页。本修订收紧所有计划清理入口（包括复用该owner的定时审核清理），不改变全库清空。原页面owner先清空筛选并显式选择“投放中”，取得绑定响应；有素材时切换100条/页。每次筛选后的列表请求必须含 `roi2_material_status=["1"]`，非空删除及后续翻页要求 `Limit=100`，响应行 `roi2MaterialStatus.value` 必须为字符串 `"1"`。缺失、其他状态、分页或筛选漂移均停止，不退回全状态或小分页删除。已核实的空列表不要求分页控件，允许初始10条分页的只读响应确认空计划；最后一批删除后控件隐藏不构成异常。零展示仍仅勾选候选ID，100条分页不授权整页删除。

只读真实证据：2026-10-07在独立临时页观察原生筛选和分页控件，确认上述字段值；未勾选或删除素材。Parent self-review完成：复用唯一CDP owner，维持身份、pending、数量和取消边界。验证涵盖100条稀疏候选分页/重扫、错误状态请求及响应、缺失控件、分页漂移；执行typecheck、owned Harness及本任务第三轮针对新增删除边界的受管只读复核，随后按既有授权合并main。

空表修正验证中观察到确认后偶发超时且pending保留；弹窗轮询原先先读数量再等可见弹窗文字，存在消失竞态。改为一次DOM读取数量和文字，仍拒绝额外标题删除确认；不把超时视为可自动重试。空表缺陷用隐藏分页控件的fixture先复现失败，再验证修正。第三轮后按已记录的具体缺陷有界扩展最多两轮复核，不重置历史调用。

## Accepted Independent Video Library Delta

用户指出视频库和计划素材属于不同页面，取消首版人为设置的互斥。本修订替代上文“新规则不能和全库清空混用”：三个勾选项独立，视频库仍默认不选；切换计划规则不得取消视频库选择。计划规则仅作用于所选计划，视频库仍清空所选账号的完整视频库。包含视频库时保留原有一次范围确认，分别显示实际勾选的计划规则及全库范围；平台逐批核对自动完成。

复用 `QianchuanVideoLibraryActions` 和共享 schema 作为改动 owner，移除禁用/自动取消与组合请求拒绝，保留仅全库请求拒绝计划规则及计划身份准入。既有 service/cleanup-plans 按计划串行执行后清理库一次，不新增执行路径；计划 BLOCKED 或取消时停止后续库清理，保留分段计数和原因。零候选正常扫描完成返回 CLEARED，仍可进入库阶段。

Parent self-review：保留显式全库选择和范围确认；无凭据、账号范围、删除适配器、pending 恢复或定时语义变更。验证覆盖单/双计划规则加视频库的 schema、UI 勾选持久性、准确范围确认和单次请求，以及 service 规则仅传给计划、库执行一次与计划 BLOCKED 阻断。Chrome MCP 使用真实组件和假桥接请求验证，不实际删除账号视频。运行 typecheck、受影响测试与 owned Harness，再对稳定候选按当前 SUBAGENTS Risk Gate 判断并记录。
