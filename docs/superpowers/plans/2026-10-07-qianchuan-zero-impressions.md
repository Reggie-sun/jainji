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

## Accepted Thirty-Day Delta

2026-10-08 用户明确选择 A：最近30天整体展示次数为0的投放中素材均删除，取消48小时保护。此修订取代所有前文7天/48小时选择规则。统计窗口为北京时间最近30个完整自然日（不含今天），与截图2026-09-08至2026-10-07一致；不按素材创建/上传年龄筛选，也不要求创建时间列。审核规则和账号视频库范围保持独立。

共享请求改用 `ZERO_IMPRESSIONS_30D` / `AUDIT_AND_ZERO_IMPRESSIONS_30D`，旧7天token拒绝，不静默扩展旧页面授权。窗口只含startTime/endTime；旧pending中的createdBefore仅保留只读兼容，所有pending继续阻断，不迁移或删除。CDP通过原日期hash设置窗口，并继续校验DOM日期、请求日期、素材ID、展示次数及投放中状态；100条分页、仅候选勾选、重扫、逐批核对、取消和未知结果停止不变。

### Milestones And Verification

1. 规则/schema/UI及原owner更新：30天跨月/跨年窗口，最新上传及缺失创建时间不影响零展示资格，非零或缺失指标仍拒绝/保留；旧token拒绝，旧pending不重试。
2. 原CDP适配器删除创建时间依赖；fixture覆盖稀疏100条分页、最新零展示、无创建列、日期漂移、不同于30天的请求、未知结果和分页位移。真实页面仅只读查看日期，无真实删除验证。
3. typecheck、相关tests及owned Harness，实际UI请求检查，AOCI逐对象维护；稳定候选按Risk Gate判断受管Kimi只读复核，保留其他会话变更，提交推送main。若共享工作树验证因其他写入失效，保留证据并重验，不把旧回执当PASS。

### Self-Review

原窗口、parser、CDP page、plan owner、共享schema和renderer继续各自独占职责；不新增队列、删除API或恢复路径。移除年龄是用户明确授权的新语义，以新token隔离旧请求；显示“整体展示次数”而非“播放量”。删除不可恢复，需验证30天绑定及新素材资格，开发测试不操作真实素材。

## Accepted Fifteen-Day Delta

2026-10-08 用户要求将素材删除统计周期改为最近15天。本节取代前文30天周期：北京时间最近15个完整自然日，不含今天；例如10月8日执行时，统计9月23日至10月7日。继续使用整体展示次数为0、仅投放中、不限制上传年龄的规则；审核规则可同时选择，视频库保持独立范围。

共享请求使用 `ZERO_IMPRESSIONS_15D` / `AUDIT_AND_ZERO_IMPRESSIONS_15D`，旧7天和30天token均拒绝，避免旧界面授权被重新解释。窗口仍由 `createZeroImpressionsWindow` 独占，原CDP日期hash、DOM和请求核对原样消费该窗口。已有pending记录逐字保留并继续阻断，100条分页、自动逐批确认、取消和未知结果停止不变。

### Implementation And Verification

1. 在原window、schema、plan owner和renderer同步15天语义；不新增日期选择器或第二删除路径。
2. 验证跨月、跨年、闰日的15天窗口，拒绝旧30天请求，覆盖旧pending不重试、稀疏分页和组合规则；浏览器fixture仅模拟删除，不操作真实账号素材。
3. 运行typecheck、相关回归及owned Harness，按Risk Gate完成受管只读审查；维护4个源码对象AOCI，提交并推送main，核对远端。

### Self-Review

缩短统计周期可能增加零展示候选，用户已明确授权该变化；用新token限定新请求。保持冻结账号/计划、投放状态、指标和日期多重绑定以及删除未知停止，不把15天理解为素材上传年龄，不改变审核或视频库范围。

## Accepted Seventy-Two-Hour Protection Delta

用户再次明确选择整体展示次数，并指定计划素材页上传完成后的时间作为保护起点。本节取代前文“不限制上传年龄”：零展示删除须同时满足最近15个完整北京时间自然日整体展示次数为0、投放中、计划页创建时间（接口 `roi2MaterialUploadTime`，首次加入该计划）已满72小时。冻结本次开始时刻减72小时的 `createdBefore`，恰好等于截止点允许，晚于截止点保留；翻页和删除前复核均消费同一截止点。此保护仅属于零展示规则，审核清理与显式全视频库清空保持独立，并在UI说明。

### Owners And Compatibility

纯规则owner `qianchuan-zero-impressions.ts` 负责冻结窗口、严格北京时间秒级日期解析及资格；原 `QianchuanPlanMaterialPage` 核对请求包含时间维度、响应时间和DOM创建时间列，缺失/非法/不一致均停止，不以素材ID或本地文件时间推测。旧不校验年龄的谓词由新AND谓词替代；沿用现有15天请求token是收紧准入，不扩大旧授权。原plan owner自动持久化含截止点的window，旧pending保持原字节，不迁移、不处置、不重试。

### Milestones And Verification

1. parser测试先复现新素材被删；实现72小时边界（前一秒、相等、后一秒）、跨月/年/闰日、时间缺失和不合法、未来时间及非零保护。
2. CDP浏览器fixture验证混合页、空候选页、100条分页、创建列和时间维度缺失、DOM/API时间漂移、删除确认前漂移及unknown保留；UI说明保护范围。运行typecheck与相关tests，再运行owned Harness。
3. 稳定候选经受管Kimi只读审查，父级裁决；维护本轮AOCI、Verify/Check/Guide、commit/push main并核对远端。真实账号只读观察不等于真实删除验收。

### Self-Review

该收紧防止新加入计划的素材因尚无展示被删除，不依赖前端资格判断，也不改变原账号/计划/投放状态、日期、分页、确认、取消与未知结果保护。原有plan恢复及其他会话diagnostics文件不属于本轮修改范围。当前Chrome连接打开用户指定账号被重定向到账户选择页，因此不声称本轮已在该账号核实时间列；沿用已有只读平台字段证据，严格校验缺失时停止。
