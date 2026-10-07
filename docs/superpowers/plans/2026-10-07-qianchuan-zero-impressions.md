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
