# Hybrid Candidate Handoff Repair

## Goal

修复真实批次中 H2 与 H3 不同抽帧人口造成的候选身份交接失败、用户明确批准的画布边缘及内部 ROI mask 归属问题，并在原作品页展示冻结的部分处理结果。

## Scope And Owners

原 `hybrid-cover-session` 拥有制作适配：先准备原默认密集 discovery，再交 H2 确认，H3 消费同一 live evidence 的候选 ID。`source-fact-discovery-evidence` 校验两份证据的源、时钟、解码与 freshness；packet owner 仍只使用原小样本图片。原冻结模板 name 保存受限中文结果，ApplicationService 只向公开任务投影此摘要，普通与批量作品页消费同一字段。

## Contract And Self-Review

现合同的跨人口唯一包含推断在真实素材 4/5 上分别复现了两个包含成员和边界扩大导致的零匹配。修正仅作用于新产品分析：H2 确认密集候选，H3 按同一集合的精确 ID 交接；没有提供同人口证据的旧调用保留原规则。默认 mask 采样上限 96 帧及原 scratch 限额、24 帧语义图片/运动检查、所有算法阈值、UNKNOWN 排除、H4、coverage 与批准冻结字节保持。不同源、不同解码/时钟、失效或 JSON 伪造证据关闭全源。提供给 H3 的密集证据由调用者关闭；内部创建的仍由 H3 关闭。

候选修正后的真实源受控复现仍被 mask 阻断。用户两次选择 A，批准画布边缘与内部 ROI 归属修复，要求独立回归且保留 coverage/H4。试验的版本化边缘兼容仍被独立半透明阴影反例证伪，已撤下整个 v3 owner 与产品消费者；新旧 H3 均复用原 canonical v2 extractor。三个 proof-pinned source 文件保持原 SHA，不扩 ROI 或补画外像素。进一步归属方案必须独立证明不漏目标像素，不能靠丢弃触边组件换取成功。当前真实源仍有阻断，不以受控回归宣称修复完成。

摘要仅用于展示，不授 authority；未知历史原因不补造，旧模板不迁移。边框逐素材/版本冻结和同源批准缓存保持；原 compiler/queue/export 不变。无新模型调用、重试、型号替换、普通补角或 H5/H6。以上 delta 属于用户授权的兼容修复，已检查与产品安全边界相容。

## Boundary Investigation And Blocker

用户最新 A 授权修复 H2→H3 的源绑定边界证据，已执行版本化观察、三张原图绑定和独立 Sol 的受控试验。受管 Kimi 调查 `f70bc7d8-91f1-4c20-a6d3-eeaddf8d67f6` 五次 k3/max 请求身份验证且完整读取封存材料；它是设计调查，不是最终实现 review。Parent 独立构造 red 复现了双方一致却漏掉软阴影的接受路径，确认不能靠 extent 切割混合稳定组件。完整组件 reconciliation 的 green 保留安全拒绝，但原素材内部 ROI 仍 blocked，方案没有实际修复收益。

已撤下本轮未上线的矩形边界消费者及 v2 模型请求，保留原 H2 v1 schema/prompt/预算。实验源码、red/green、模型 route receipt 和原片受控结果保存于 repository 外本轮私有证据目录；不提交运行产物、不修改 v1/v2 proof 固定源码。Kimi 建议按坐标等于 M1 粗框判断抄袭未采纳：坐标一致不证明观察来源，不能造新的拒绝启发式。

当前软件修复范围为候选交接、逐角冻结结果展示。新增软阴影混合静态背景及画布触边负例保持 mask unresolved，原 motion/shape/coverage/H4 不变。画布边缘及内部 ROI 的目标像素归属尚无独立证据，属于真实 blocker；不将测试、受控声明或本轮 checkpoint 宣称为原素材完整修复，也不开展 H5/H6。

2026-10-07 续查在独立构造的 opaque core + 8px 半透明阴影、81/119 交替背景上复现新的接受缺陷：M1 相邻帧持久性排除了阴影，原 3px 膨胀仍漏 required pixels，而兼容分支返回可继续的 mask。red 直接比较构造真值，不从 extractor 反推。撤掉该过滤后内部反例保持 INCOMPLETE；不持久背景也不能作为像素归属证明。进一步构造左上 14×14 稳定核心、延伸至 22×22 的变化阴影，在原画布边缘 ROI (0,0,28,28) 上复现 v3 空 reasons 候选漏 5850 个 required pixels（30 帧）。因此完整撤下 v3，而不是只调整该样例或放宽 gate；保留构造负例防止重犯。第五、六轮 Harness 因上述实际语义缺陷主动中止，均不作为最终 PASS。最新千川 file chooser 修复 f42c084f 已进入 origin/main，其两组旧失败回归在当前源码上 24/24 PASS，不修改千川业务文件。

## Acceptance And Verification

### Continued Mask Repair Contract

2026-10-07 继续执行，自审纠正此前“独立证明”表述的过度解释：独立 construction-alpha 回归是 mask 方法的资格证据；当前源字节/时钟/候选身份是 provenance；coverage 证明冻结 mask 被完全不透明覆盖；H4 检查实际配对画面。真实用户视频不新增原始 PNG、工程文件、strict REAL_MEDIA truth 或数学唯一解前置。用户已确认没有原资产，不能继续要求提供，也不能仅因一个候选失败就结束整个修复。已验证的阴影漏检仍必须修复或在运行时明确拒绝，不能交给 H4 抹去。

后续实现只在 `shape-cover-hybrid-h3.ts` 的提取接缝接入一种通过方法回归的版本化 Hybrid mask owner；不串接多层 fallback，不修改三个 proof-pinned v2 文件。先用既有独立阴影、四个画布角、内部 ROI、无关字幕/背景与失效绑定用例检验方法，再用原素材 4/5 确认实际 H3；只有候选和运行时拒绝条件都成立，才继续原 H4/compiler/queue/export。实际产品 runtime 必须能在 Windows/Linux 装载、有界执行及取消，不将开发机 Python/Conda 当成产品依赖。原图库、shape/placement、coverage 和 H4 规则不变。

最低验证为新方法的独立正/负例、H3 接缝及 stale/clone/cancel 回归、typecheck、按最终 owned scope 路由的 Harness 与 completion、AOCI，以及原片实际结果。保存每次失败；构造 PASS 不称真实视觉验收，研究记录及文档 PASS 不称修复完成。此边界修订属于已授权的 mask 兼容修复，没有新增产品功能或放宽原 gate，继续由 Native Codex 执行。

可执行回归先证明旧 packet 无法消费密集候选；修复后 H2 的 candidate digest 与 H3 mask 集合一致，图片仍源自小样本。旧路径保持确定性；错源、伪造、关闭证据不能进入批准。原真实素材以受控 H2 fixture 重跑，分列后续 mask/motion/shape gate，不能当作真实模型验收。零/部分结果与原因在普通及批量页面可见并跨重开保留；失败文案优先。

最新 main 的内置边框已改为细线电商款，最终 Harness 在 `decoration-display.integration` 的横竖屏两例复现旧黄色固定像素断言失败。该编译渲染接缝改用提取前独立构造的四色不对称透明边框：严格逐通道核四边、贴纸上层、中央原画面、首尾时段、音轨和时长；不绑定可变款式，也不降低像素 gate。实际内置资源仍由既有资源回归覆盖。本轮只维护此测试兼容性，不修改边框业务代码；旧失败回执不作最终 PASS。

第二轮还发现 Activation 接缝的旧边框色值断言，改用独立整圈透明 fixture 并增加逐通道检查，原批准 PNG、binding、篡改拒绝和 queue 发布断言不变。H3 新增密集场景的 120 帧 fixture 令两例合计超过原 180 秒 Harness 预算，缩为 36 帧并显式断言密集人口大于 24 帧语义人口；同 ID 交接、双冻结确定性、错人口及 clone/source 篡改拒绝完整保留，不增加时间预算或改生产算法。补充 opt-in 在线素材旧测试缺少 `productPrice` 却期待字体缓存，源码和该测试均与 main 一致，单列为本轮范围外既有失败；Windows 两例在 Linux 未评估，不能宣称全量跨平台 PASS。

第三轮完整扩展回归发现 `material-collection` 的历史任务投影 fixture 没有冻结模板，新增摘要读取抛异常。ApplicationService 将冻结摘要读取改为可选，缺证据沿旧展示，不补造原因；原重开和本轮成员筛选回归作为 red/green 证据。另一会话在该轮验收期间提交千川 drag 前置页面修复 `3e99c1a` 并维护共享 AOCI，第三轮源码/治理身份失效；必须保留该提交并重新冻结最终 scope，不复用该轮为最终 PASS。

## Milestones

1. 候选交接：packet、corner semantic、H3、session 及对应 FFmpeg/单元回归；先 red 后 green。
2. 结果展示：原模板摘要与 public task 投影，普通/批量页面测试和 Chrome 交互验证。
3. mask 边界验证：保留四角物理触边、变化半透明阴影与内部 ROI 触边负例；撤下缺少像素归属证明的 v3 兼容，不改旧 v2 源码、proof 新签发及归档。真实源重新分列其余 gates；未分离的背景明确 blocked，不降低门槛。
4. 稳定收尾：typecheck、受影响测试、owned Harness、风险判断、官方 AOCI 与 completion；只提交本任务文件，push 并核对远端 SHA。真实模型或视觉验收不足时明确剩余限制。
