# Stationary Shape Cover Engineering Record

## M2-B Static Range / Anomaly Classification — 2026-10-02

依据 [M2-B plan](shape-matched-cover-m2b-plan.md)，本轮只回答M2-A的133个异常意味着什么。状态 **ANOMALIES_REPRODUCED / STATIC_GEOMETRY_OBSERVED_WITH_APPEARANCE_ANOMALIES / CAUSE_NOT_QUALIFIED / PRODUCT_DISABLED**。完整承诺仍为 `[0,6990)`；M1/M2-A源码、config、原receipt和3395px mask全部保持原字节。容差仍24，参数修订0，不缩范围、不做M3或mask qualification。

### Measurement and Exact Replay

新离线 `scripts/shape-cover-static-anomalies.py` 在本机工程环境使用NumPy/OpenCV/Pillow，不进入产品、不发行mask或authority。从原96代表帧按冻结算法重建 **2082px undilated support**、min/max与3px dilation；后者生成mask的bbox628/1/81/59、3395px及bitpack SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`逐字节一致。算法重放是诊断接缝，不是独立边缘truth或新extractor。

同应用FFmpeg（SHA `f8e3453ae7b5681ad659d880a9b58b1afe87c0952e94c5db4023cdb2a8816a2d`）CPU-only解码原ROI615/0/105/76。96建模帧与完整6990帧分别双pipe核对RGBA SHA、framehash、ordinal、PTS/endPTS与timeBase1/15360；源SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`前后不变。全部133个异常的ordinal、changedSupportPixels与worstDifference与M2-A完全相同。

异常条件为每个support像素RGB超出**代表样本**逐通道min/max后，最大通道越界量>24。它不是目标位移、遮挡或mask漏失检测器；3px dilation ring及未进入support的像素不参与该判据。下述“边界/内部”均指support的棋盘距离，不能等同独立target alpha边界。

### Temporal and Spatial Classification

| Observation | Fresh result | Meaning |
| --- | --- | --- |
| 全范围 | 6990帧；133异常 / 6857无异常 | 无异常只表示没有违反冻结RGB判据，不签static范围PASS。 |
| 严格连续异常段 | 61段；41单帧、9双帧、3三帧、2四帧、2六帧、其余9/10/11/15帧各一段 | 最长15帧即0.5s；不把分散异常合成目标失效区间。 |
| 不同异常support像素 | 78px，共506次像素越界 | 不是133个目标移动/遮挡事件，也不是506个漏覆盖像素。 |
| support边界第一层 | 72不同像素、492/506次（97.23%） | 变化主要集中在被算法纳入support的边缘位置。 |
| 边界第二/三层 | 3/2不同像素，3/2次 | 共124帧全部异常像素距support边界≤3。 |
| support第四层 | 同一个像素652/39，9帧 | `[3756,3765)` RGB恒为247/105/102；样本max222/117/96，R越界25、B越界6，只R超过24。 |
| 局部整数位移观察 | 全6990帧、401px support core；25种±2px offset均以0/0最佳 | 有限平移假设下未见整数位移反证；不能证明无subpixel位移、形变、alpha变化或完整motion qualification。 |
| 原始首尾异常 | ordinal233 / 3764 | PTS为119296 / 1927168，起点约7.7667s / 125.4667s。 |
| 最后无异常观察段 | `[3765,6990)`，3225帧 | 107.5s观察段，不自动缩原233s承诺。 |

`anomalies.json`逐帧保存全部超阈值源坐标、RGB、样本min/max、通道越界量与support距离；`ranges.json`保存全部61异常段及无异常补集，带精确PTS；每项causalClassification仍UNKNOWN。`support-traces.npz`保留2082px完整原RGB轨迹与sourceXY，`pixel-observations.json`保留78px完整min/max；这些都不作为required pixels。

ordinal710：23px全部位于support边界第一层，worst57；ordinal715：17px也全部位于第一层，worst89。715最强点656/56实际RGB224/153/83、样本min173/170/172，B越界89；另一个强点631/31的B越界85。这些点在原图白色外轮廓/底缘附近呈现暖背景相关的偏色，未伴随联系图中贴纸位置或文字图案整体改变。**这是颜色与背景同时变化的观察，不能据此独立分解压缩串色、抗锯齿、半透明或背景贡献。**

### Visual Inspection and Parent Judgment

Parent实际检查全部16张original/overlay联系图，覆盖133异常及前后1帧、首中尾，共251原ROI观察；保留原PNG，并用nearest-neighbor放大帮助定位，不拿放大图当原像素truth。各异常段的文字、轮廓和位置保持近似相同，背景颜色/画面经常改变；未观察到目标被前景遮住、闪烁消失、持续位移或持续轮廓扩张。第二次final运行的全部16联系图与已检查v1逐字节一致。

**结论：133帧直接证明冻结的稀疏RGB样本包络在完整范围内被违反；主要是固定图案边缘的局部颜色越界，加一个持续9帧的内部单像素轻微越界。当前证据不支持把它们直接分类成133帧目标移动/遮挡，也不足以全部认定为编码噪声。** 原static product定义允许编码外观变化，而这个development判据混合观察颜色与几何，不能独自决定target类别。STATIC_GEOMETRY_OBSERVED是限定观察，不是完整static资格。

不批准缩短范围：原confirmation保留完整 `[0,6990)`。61异常段和无异常补集不恢复可用mask，不自动分segment，不删除失败帧。M2-A `REJECTED / FULL_RANGE_STATIC_CONTRADICTION`和REAL_MEDIA `INCOMPLETE / INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING`保持；独立required/missed指标仍null。未观察到明显运动不证明required边缘完整，亦不解锁M3。

如果后续继续，问题应限定为独立区分几何/边缘贡献与RGB外观变化的观测合同；任何判据修订都属于后续显式development版本，保留本轮失败，不能调24→40→80使本片过关。本轮到这里停止，不实施后续版本或资格。

### Evidence, Verification and Boundaries

本机Evidence根 `~/.local/state/jianji-source-fact-qualification/m2b-anomalies-20261002-final`（R），v1保留在同级 `m2b-anomalies-20261002-v1`。final诊断18.232s，parent peak RSS144,941,056 bytes（138.23MiB）、child peak100,687,872 bytes（96.02MiB，Linux wait4高水位），support轨迹内存43,659,540 bytes，无全片RGBA持久spool；诊断artifact约17.45MB。未测Windows、低端CPU或产品运行；不调用产品模型、不读取holdout、不做真实导出。

受管Kimi deep只读核查冻结metric的语义、盲点与诊断边界；invocation `8c1cb97c-99cd-40ce-ab98-9ebb104c5005`，seal `def4d8fb903d29644da936995b050366928e3ee1446e829e18c831b7b2319c7a`、qualified route `4f2d5dc8-4234-4665-b382-e82f1ad6cc00`，PARSED、3 wire requests、277.178s、无retry。Parent核对三项observed Reads及report artifact SHA；接受“sample envelope不等于运动/遮挡”的源码结论。报告所称“diagnostic未存在”只发生在封存的3文件最小包，不能当host不存在；“static core”措辞按源码修正为undilated support（含边缘），未让其升级真实媒体因果判断。未追加最终review。

按current verification-before-completion，fresh typecheck exit0，原static/activation **2 suites / 38 tests PASS**；新增Python诊断 **6 tests PASS**，含严格24/25边界、非矩形support、半开range不跨正常帧、构造整数位移、真实FFmpeg错SHA/PTS拒绝。Linux开发媒体完整绑定及上述两轮真实诊断成立；不得提升为mask资格或产品验收。

Implementation Risk Gate **KIMI_REVIEW_NOT_REQUIRED**：无用户指定final review，无凭据/商业请求/production/durable业务写入；诊断错误受mask字节、全帧绑定和原异常逐项重放约束，不具有重大生产后果。剩余真实pixel/alpha因果缺口明确UNKNOWN，review不能替代truth；exact稳定脚本/test/doc hash随R保存。

开始已有 `.aoci/baseline.json` / `aoci.code.txt` dirty及另一task的runs，期间另一窗口增加并提交Harness plan/spec，均保留。四个本轮业务对象逐项按现有AOCI scope为observe，不需正式Entry；本轮自有runs仅加本机Git ignore并在R保留，封存仍在repo runs，不增加runtime catalog。完整Verify/Check各exit1、Guide（`--agent codex`）complete=false，唯一blocking对象为foreign `runs/20261002-agents-harness-audit/task.json` missing/unbaselined；完整机器批次包含非本轮授权对象，故不越权创作或截断该批次，不把全库治理称aligned。原共享索引字节保留，不stage/commit。

Repository无专用session-capture Skill；本节及R承接本轮stable checkpoint，不更新外部memory。交付只完成M2-B诊断；qualification和product依旧关闭。

## M2-A Static Target Mask Development — 2026-10-02

按 [course-correction](shape-matched-cover-v1-simplification-spec.md) 和本轮 [M2-A plan](shape-matched-cover-m2a-plan.md)，状态为 **ENGINEERING_DEVELOPMENT / REAL_STATIC_QUALIFICATION_INCOMPLETE / PRODUCT_DISABLED**。用户本轮明确确认 233 秒原片右上“国货之光”、完整0–233秒；确认只确定身份与承诺范围，不确认mask或运动。本轮没有M1阈值修订、D2Q、动画、shape matching、placement、输出coverage、visual safety或activation。

### Ownership and Evidence

M1 discovery owner原样重算候选，resultDigest仍 `c1ff778bab42c834459b5b515e1f5ef6dcfff577e139745406e6cd426ea865f4`，7 candidates / 41 components。原ROI627/3/83/61仅作候选搜索线索；用户确认冻结targetId `a766722b-d663-48a3-bd86-3d242d327a87`、精确sourceKey、discovery/result digest、确认来源和ordinals[0,6990)。不接caller mask，不把ROI填满作为mask。

新 `source-mask-static-target.ts` 复用原identity/sourceKey、严格packet/frame clock和CPU FFmpeg双pipe；在source整数网格先format=rgba再crop，目标ROI只扩大搜索12px，不是覆盖几何。每个原ordinal绑定PTS/endPTS/字节数/ROI SHA，独立framehash pipe复核真实解码PTS/duration/SHA，首尾不能遗漏。源与引擎前后freshness、单decode、取消、五分钟和512MiB预算拒绝保持；目标路径不持久spool全片RGBA，M1原96代表帧scratch仍保留其真实成本。确认和evidence只认活跃私有对象，JSON不恢复ownership。

新 `source-mask-static-extraction.ts` 采用原像素RGB temporal std≤20、连通组件≥8px及差18边缘，全部合适component进入支持，不采用旧Python最大组件mask。3px保守候选外扩是明确development假设，不能证明任意未知透明边缘；支持碰搜索边界或外扩截断拒绝。之后流式检查完整范围，每个支持像素须处在代表样本min/max加24容差内；完整验证失败不缩范围，不删除失败帧。该检查仅为static像素包络一致性观察，不是独立mask/motion资格。

新 `source-mask-static-qualification.ts` 在提取开始前冻结独立required pixels、原ROI/时钟/SHA和method digest，绑定私有chronology；逐帧独立重解码并比较真实required pixels与候选mask。construction truth来自媒体构造几何，不能从算法mask导出；零漏只为DEVELOPMENT_MATCH。REAL_MEDIA未经独立审核、缺truth均INCOMPLETE，required/missed/excess/compared指标null。原extractor/qualification仅增加exports，旧D2/fullcanvas/均匀背景方法和拒绝不改；不写knowledge/schema/admission/store，不签产品proof或source authority。

Parent用CodeGraph核对原clock/stream/extractor关系，再按imports/receiver裁决通用短成员误配。受管Kimi只做上述stream边界只读核查：deep/max，invocation `dda9597f-2817-430f-a95a-cd15b647d3ac`、seal `6507c2f17de073bdbbee80ae83d9af68b58a4cc0b82864ff2cb4c4d27e904403`；canonical receipt第三个wire请求RESPONSE_BODY CONNECTION_ERROR，OUTCOME_UNKNOWN，3 wire requests、366.884s、observed_reads为空。前两次上游身份核验不构成可用报告，部分输出未采用；不自动重试，不将其称独立像素审阅或最终review。Parent直接核验实现及媒体。

### Real Full-Range Development

Evidence根 `~/.local/state/jianji-source-fact-qualification/m2a-static-20261002-app-engine`（R）；exact method-source-freeze和执行日志在repo仅本轮忽略的 `runs/shape-cover-m2a-20261002`，交付时另存R。原视频SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，54,577,917 bytes、720×1280、6990帧；最终原字节hash不变。确认范围完整[0,6990)、PTS[0,3578880)，timeBase1/15360，全部clock binding复核一致。method源码6项及参数冻结后均未变，真实参数修订0次，没有读取holdout。

实际产生mask **3395px / bbox628/1/81/59**，SHA `fb3e2b2f1933c514bdb353e031eb946cbe309cf1570967c715a40d90346c9893`；不是历史Python3260px mask，bbox相同不能等同证据。完整6990帧检查有 **133帧STATIC_SUPPORT_CHANGED_OR_OCCLUDED**，状态INCOMPLETE / FULL_RANGE_STATIC_CONTRADICTION。最早ordinal233，一像素差26；ordinal710有23个支持像素超容差，worst57；ordinal715 worst89（17px）；最后异常3764。不得把此结论改写成目标确实移动、动画或遮挡，也不能无独立证据认定只是编码噪声。

Parent查看首中尾原ROI和mask，并对233/234/710/715/1247/3764六帧另行独立重解码，原ROI SHA逐项匹配完整range receipt，PNG/绑定存R/anomaly-inspection.json。抽看的原图目标外观相近、背景变化；这不是required-pixel truth，不能证明全部6990帧边缘保守。最终independent qualification为INCOMPLETE / INDEPENDENT_REQUIRED_PIXEL_TRUTH_MISSING，指标null，非零漏结论、非真实qualified oldStickerMask。

| CPU measurement | Actual result |
| --- | --- |
| Host | Linux / Intel Core Ultra 7 265K；未测低端CPU或Windows |
| Overall diagnostic | 45,110.406ms，包含原M196帧发现及目标准备 |
| Discovery identity / clock / sampled decode | 434.230 / 9,238.224 / 9,239.870ms |
| Target prepare / mask / full range verification | 10,450.490 / 1,012.060 / 11,261.649ms |
| Parent peak RSS | 294,158,336 bytes（280.531MiB） |
| Observed child peak | 70,377,472 bytes（67.117MiB）；25ms /proc VmHWM采样下界，不是精确全进程峰值 |
| Accounted target working set / target scratch | 3,066,240 bytes / 0；不是全流程RSS或整个M1scratch为零 |
| M1 representative scratch | 353,894,400 bytes（337.5MiB），close清理；无全片24GiB spool |
| Models / remaining product stages | modelRequests0；matching/outputCoverage/visualSafety NOT_EVALUATED，PRODUCT_DISABLED |

前两次本地CLI失败也保留：误传不存在/usr/bin引擎（4.086ms），随后误用旧conda引擎（10,213.450ms）被原discovery拒绝；都未产生确认、成功candidate或mask。最终使用应用现有引擎，SHA与M1相同；未改算法或准入以绕过旧引擎拒绝。R/../m2a-static-20261002-development和-engine-corrected保存failure JSON。

### Verification, AOCI and Stop

读取并执行current verification-before-completion。fresh typecheck、scripts单独strict tsc和esbuild均exit0；最终6 suites **87 tests PASS**：新static10、原discovery17、extraction17、qualification9、activation28、pixel6。覆盖不规则mask/细尖、已知低alpha构造边缘、独立分母、尾帧外扩遗漏、未采样闪烁与移动、全范围首尾、错源/错绑定、克隆/迟到truth、取消/源漂移/预算及旧拒绝。首次9个fixture因未声明方像素被严格clock拒绝；只补setsar=1后通过，失败日志保留，M1实现未改。

Implementation Risk Gate为 **KIMI_REVIEW_NOT_REQUIRED**：用户未指定最终Kimi review；所有新增结果无authority，无凭据/商业API/production/durable-state写路径，具体失败被限制在development拒绝与自有只读媒体证据；项目验证后未发现重大后果与残留验证缺口的组合。真实资格缺口明确保留，不靠adversarial verdict补齐。exact final source/test/script和accepted docs SHA存R/source-snapshot.json；Parent拥有最终diff及claim裁决。

开始时有千川foreign dirty；其session先后提交e491e43/d225393，本轮保留。e491e43新增本session直接AOCI维护授权，故取消此前依旧规则提出的索引归属问题并自行维护；未改其他任务业务源码。当前完整机器批次9/9应用，含本轮5个managed对象、M1遗留3项及已提交千川binding的索引漂移。完整批次/CAS按当前合同执行，没有截断；scope里的docs/script/tests为observe，不扩scope。最终Verify/Check/Guide均exit0，governance_aligned=true、findings=[]、missing/stale/unbaselined/orphan=[]，Guide complete=true/next_action=none。Apply有两项E规模档位warning（旧binding应T、discovery应S），不伪称warning为0；按成功批次不得重复写入的工具合同停止正式写入。

用户随后对先前问题明确选择 **A：由另一窗口统一维护全部索引，本轮提交M2代码与维护交接**。该回复到达时完整批次已应用；保留已维护共享字节，不回滚或再写，也不stage/commit `aoci.code.txt` 和 `.aoci/baseline.json`，由另一窗口统一承接提交。本轮五个managed对象已逐项维护，不将提交交接混称维护未执行。source SHA及批次/校验收据随R保存。

Repository无专用session-capture skill；本节与原私有证据承接稳定checkpoint，不更新外部memory。停止在真实M2资格blocker：冻结static方法全范围不一致，且真实required-pixel边缘truth未独立审核。未调M1、未扩大模型/动画或D2Q、未改guard，未把测试、commit、抽样图片或3395px候选当作M2真实资格完成。

## M1-A Bounded CPU Stationary Discovery — 2026-10-02

依据已提交 [course-correction audit](shape-matched-cover-v1-simplification-audit.md)、[Delta Spec](shape-matched-cover-v1-simplification-spec.md)、[Plan](shape-matched-cover-v1-simplification-plan.md) 和本轮 [implementation plan](shape-matched-cover-m1a-plan.md)，实现 **CPU_DETECTOR_DEVELOPMENT / NO_TARGET_CONFIRMED / PRODUCT_DISABLED**。不继续 D2Q→D3→D4，不建 FullSourceAdmissionHandle，不执行mask qualification、source admission、视觉审阅或activation；以下历史记录保持原状态。

### Ownership and Method

从 `91ecc55` 干净工作树开始；期间另一任务提交 `6549217`（make frontend沟通规则与对应索引），本轮保留其提交。Parent实际读取clock、D2 evidence、extractor/comparator、envelope、pixel/alpha以及FFmpeg和source identity owner，使用CodeGraph核对；CodeGraph将普通 `set` / `now` 错连到其他模块时按实际receiver/import裁决，不将错误关联当模型调用。旧extractor需要caller声明/ROI，envelope需要caller mask，两者均没有自动发现职责。

新 `source-fact-discovery-evidence.ts` 复用 `source-fact-census.ts` 抽出的原严格metadata/packet clock与子进程；`parseFullDecodeClock`、`identifySource`、`sourceKey`、`fingerprintFile`不变。最多96个uniform-PTS代表ordinal，包含首尾；FFmpeg CPU-only、单解码进程，将选定原RGBA与独立framehash pipe逐一绑定PTS、duration、字节数和SHA。仅代表帧进入私有临时文件；闭合清理，不调用full census/D2全片spool，不写知识或语义session。源/引擎前后核验、读取摘要、所有权、取消与总5min期限保持拒绝。输入包络继续采用既有H.264/MP4、SDR、无旋转、精确一对一packet/clock等严格条件，不承诺任意视频格式。

新 `shape-cover-stationary-discovery.ts` 全画布最长边360格，RGB max-channel std≤20、相邻差≤30的consensus≥0.8、持久边缘差≥18；全部8连通稳定component分别处理，最小12格/4个持久边缘，过大稳定区域标背景歧义。component上限4096、候选上限128，超限整体INCOMPLETE而非截断成功。映射为整数cell origin与向外取整ROI；从每个稳定cell内部最多3×3原像素重算支持稳定率并逐帧hash原ROI。ROI、confidence与固定坐标相邻一致性都是候选信号，不是target identity、完整运动证明或保守mask。模型/预填mask/用户ROI/贴纸ID均不参与发现。

每个component保留统计、映射、拒绝及背景/字幕/商品印字歧义；候选固定 `authority=none / eligible=false`，confirmation、mask、motion、source admission、coverage、visual safety全部NOT_EVALUATED。不足3帧/1秒为INCOMPLETE；没有可用候选为NO_CONFIRMED_TARGET并保留NO_ABSENCE_CLAIM。没有返回EMPTY或confirmed集合，没有隐式传入原提取/union/生产链。

### Real Source Development

独立入口 `scripts/shape-cover-discovery-diagnostic.ts` 参数为source path、原identity JSON、新独占输出目录与应用FFmpeg/FFprobe路径；不接受ROI/mask。Evidence根：`/home/reggie/.local/state/jianji-source-fact-qualification/m1a-discovery-20261002-final`（R），前两次保存在同级 `m1a-discovery-20261002-v1`、`-v2`；repo内封存task与执行日志位于仅本轮runtime忽略目录 `runs/shape-cover-m1a-20261002`，最终日志和receipt另存R。未读取holdout，真实运行前冻结方法参数，真实运行后参数修订0次。

原用户233s素材SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`、54,577,917 bytes、720×1280、6990帧、timeBase1/15360、PTS0..3578880；最后重新hash原字节不变。96个原ordinal的PTS/endPTS/byteLength/RGBA SHA逐项与历史canonical D1 census相同（96/96）；历史D1这里只是独立pixel binding对照，不是本轮运行依赖，更不是语义审阅。

三次全画布运行均产生 **41 components / 7 CANDIDATE**，deterministic resultDigest均为 `c1ff778bab42c834459b5b515e1f5ef6dcfff577e139745406e6cd426ea865f4`。Parent查看原第一帧和candidate-0原像素裁图：右上“国货之光”自动ROI为x627/y3/w83/h61，130个稳定grid pixels，原支持稳定率0.8692；全片发现没有注入历史框或mask。底部持久文字形成其余6个候选，均保留字幕/印字歧义；左上贴纸所在区域原支持稳定率0.7031，明确UNKNOWN / ORIGINAL_PIXEL_STABILITY_CONTRADICTION。**有候选不表示全部旧贴纸检出或贴纸身份已确认。**

历史Python需要ROI615/0/100/90、指定14–20s或3秒段，并只取最大component/dilate后得到约81×59 mask。本轮从整233s全画布自动发现返回83×61粗ROI，不输出mask；y3不能替代历史y1边缘数据。mask边缘、漏像素、alpha、透明度/闪烁、完整目标时域及运动资格全部留M2，不能将此ROI填进mask proof。对照控制媒体的负例属于development，不是独立真实holdout。

| Final CPU measurement | Actual evidence |
| --- | --- |
| Host | Linux，Intel Core Ultra 7 265K；未测低端CPU或Windows |
| Overall diagnostic | 19,332.956ms；前两次21,243.897 / 20,567.593ms |
| Identity / clock metadata / representative decode | 301.202 / 8,685.085 / 8,337.482ms；clock包含原FFprobe frame解码，未计入detector纯计算 |
| Temporal statistics / components / original pixels | 529.835 / 12.697 / 283.497ms |
| Parent peak RSS | 249,368,576 bytes，237.816MiB，Node resourceUsage实际进程峰值 |
| Decoder/probe child observed peak | 69,148,672 bytes，65.945MiB；Linux /proc VmHWM每25ms采样，是所观测峰值/真实峰值下界，不伪称精确child峰值；其他平台null |
| Algorithm accounted working buffers / scratch | 13,444,128 / 353,894,400 bytes（337.5MiB scratch）；buffer accounting非全进程RSS；仅96原帧，无全片约24GiB spool，close清理 |
| Models / qualification / matching / preview / export | detector modelRequests0；其他阶段NOT_EVALUATED；不声称编码主要耗时或整产品性能验收 |

### Verification and Decision

读并执行current `verification-before-completion`；fresh `npm run typecheck`、diagnostic单独strict tsc与esbuild、真实FFmpeg CLI均exit0。最终8 suites **189 tests PASS**：新discovery17、原census64、D2 review28、extractor17、comparator9、stationary envelope20、pixel6、activation28；完整命令/输出保留R及repo runtime日志，101.85秒。新tests覆盖全画布较小非角落多目标、确定性复算、原像素ROI、旧full census绑定、錯source/PTS/duration/hash/timeBase/tail、无authority、fake/closed evidence、pre/live cancellation、wall/scratch/frame/候选/component限额、stable background/blank/moving/blinking/cut、字幕/印字歧义。

保留开发失败日志：首轮test仅用了PATH名称导致realpath失败，改为原discoverBinary；随后错误import修正到ffmpeg owner。原像素对照最初扩到component外邻居，错误拒绝小目标；改为cell内部支持采样，保留此前3个行为失败，不降低0.8准入。这些修复均先于真实方法冻结或仅修test/metadata绑定，非holdout调参。diagnostic不在完整freshness与取消检查前写成功result。

额外真实CLI取消对照保存同级 `m1a-discovery-20261002-cancelled`：SIGTERM在运行中取消，962.172ms返回exit2，只有input/failure JSON，没有成功result或候选产物。未重试unknown外部请求；取消只停止本地只读解码。

stable snapshot见R/source-snapshot.json（各source/test/script与accepted refs完整SHA）。Implementation Risk Gate为 **KIMI_REVIEW_NOT_REQUIRED**：仅无authority候选与自有临时证据，无凭据/产品/durable-state写路径；共享census抽取的风险由64+28及依赖回归覆盖，没有具体重大后果且残留验证缺口的触发证据。Kimi只做原源码职责核查，invocation `d0032e89-e3d2-4ce3-b2fb-3faebd21b3e8`、seal `f374218aad13697e6a44c15d6402dfb6bfb6f3fe26fd17f0797c2e88411bbc34`、deep/max、真实上游身份与Read/receipt可核验；PARSED不是implementation acceptance。Parent拒绝其泛化到输出CONFIRMED集合的建议，本轮只产candidate。

### AOCI and Remaining Boundaries

初始Overview因另一任务更新正式索引返回overview_snapshot_changed，未补答或声称完整系统认知可靠，继续source-bound工作。用户本轮明确选择 **B：本轮只提交业务代码，共享索引交对方统一维护**；故不调用Maintain/Apply、不写或提交aoci.code.txt/.aoci/baseline.json。只读核对scope与Verify/Check/当前 `index agent guide`；结构valid但governance未aligned。需要对方维护本轮三个managed对象：`src/main/source-fact-census.ts`（stale），`src/main/source-fact-discovery-evidence.ts`与`src/main/shape-cover-stationary-discovery.ts`（missing/unbaselined）；docs、scripts、tests按现有observe scope，无索引扩scope。精确source SHA和语义交接见R/source-snapshot.json及本文ownership段。旧一次错误的root guide命令日志保留，最终使用当前CLI正确入口；不把命令运行等同治理通过。

无repository专用capture skill，本节承接稳定checkpoint与真实外部媒体证据，不更新外部memory。此次仅称CPU detector development已实现；mask完整性、固定动画、motion qualification、目标确认交互、独立真实holdout、低端CPU/Windows、视觉安全与production activation仍未完成。原product guards、fullcanvas研究合同、renderer/custody、manual/assisted、queue与历史解释均未改；待维护AOCI按用户指定交接，不宣称V1已完成。

## Real Contour Method Comparison and Source Inventory — 2026-10-01

按用户要求连续执行auto-contour计划，M1先以既有收据只读追踪；固定两型号已通过native conformance，但认证目录exact0，详见 [AI record](shape-matched-cover-m5d2a.md#fixed-model-catalog-followthrough--2026-10-01)。本节记录M1阻断时独立推进的M2真实development与M3材料准备，**REAL_AUTOMATIC_CHAIN_INCOMPLETE / PRODUCT_DISABLED**。证据根 `/home/reggie/.local/state/jianji-source-fact-qualification/auto-contour-catalog-followthrough-20261001`（F），不重做预选星形导出、不伪造truth或生产准入。

复用原用户233秒原片SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，使用原canonical D1/owned D2重新完整解码6990帧；census仍 `cc01bcbc9c4c700e4fef68ab8d6faf7e6e9a5052ff20ea1d9f4a0fdaf806029e`。作者侧development范围为原ordinals420–599（14–20秒）共180帧，逐帧RGBA/PTS/endPTS绑定成立。ROI615/0/100/90仅为明确标记UNQUALIFIED_ENGINEERING_DECLARATIONS的搜索范围，不是AI识别、mask或truth。运行前冻结真实源、方法源码SHA、参数/范围；后核对8项源码SHA无漂移，owned spool按原close清理。

| Method | Actual real development result | Qualification consequence |
| --- | --- | --- |
| per-frame exterior difference | 180/180 UNKNOWN / EXTERIOR_NOT_UNIFORM，mask0、envelope0 | 均匀背景支持包络不能处理本真实原片 |
| temporal stable exterior difference | 180/180 UNKNOWN / EXTERIOR_NOT_UNIFORM，mask0、envelope0 | 此TypeScript方法仍复用均匀边界提取，不是历史temporal算法 |
| 原 `shape-cover-mask-probe.py` temporal std/component方法 | 同范围180/180逐帧采样和core检查；3260像素、81×59候选，worst core差8.224 | CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW，未审核；OpenCV probe不提供canonical逐帧RGBA provenance |

前两方法实际CLI耗时182342.65ms，进程maxRSS284456KiB；比较metrics仍null、mask/motion truth NOT_EVALUATED、selectedMethod/qualifiedExtractor=null。第三方法单独提前冻结script SHA、参数和输入，没有改阈值或用候选作truth。Parent查看其六帧edge sheet，只能观察轮廓位置，不能证明180帧无漏边、独立motion或最终SAFE/NATURAL。没有将它导入human admission或真实选款链。以上都是开发比较，不是新的正式holdout或qualified extractor。

M3作者侧实际清点 `/home/reggie/电商/肥皂/素材`：26个MP4、18个不同文件SHA，保存每项源字节摘要/长度/FFprobe元数据。不同SHA不证明独立来源；六份候选的first/mid/tail联系图中存在相同人物、场景及复用片段，source independence/静态或固定动画类别均保持NOT_EVALUATED。抽样图只为作者清点，不冒充D1原ordinal或完整motion证明，没有凑成“3静态+3真实动画”。未登记新的正式holdout，独立pixel/motion truth未补齐。

用户随后要求查看最近session；本轮按只读、有界路径核查已存在真实材料/审核，而非要求普通用户描边。Named code_mapper核对近期相关sessions `01a0f75b-45bf-70e3-b5eb-d033fcda3c9b`、`01a0f6c9-6987-7de1-87c7-16a46bbdb0e9`、`01a0f7d1-3973-7d80-9de1-caebca9899f1`、`01a0f7d4-17e4-7da3-a479-5c9263b2b4fc` 及其材料路径，Parent再次读取并核对原JSON SHA/size与关键字段，保存F/recent-session-artifact-audit.json。原real-stationary的两段共180帧仍同源，reviewedSourceFrames=0、mask/motion/semantic review均NOT_EVALUATED；已找到的两个truth-freeze均为6帧CONTROLLED_CONSTRUCTION，不是真实留出。此次有界检索未找到满足M3的独立真实pixel/motion truth或固定动画审核收据，不据此声称全盘材料绝对不存在。

没有把历史mask、controlled动画或口述认可改名为独立真实truth。M4识别→共同候选筛选→看实际摆放图选款→冻结/真实输出→独立SAFE/NATURAL/播放以及M5正式blinded A/B/raw/mapped/joint/18类truth比较仍未执行。本地工程/资料准备不满足完整任务验收；当前停止原因是固定型号目录/image与正式owner缺口，加上没有合格真实extractor和独立truth，M6保持OUTSIDE_CURRENT_AUTHORIZATION。

### Delivery Verification

本轮没有修改executable source、配置、测试或模型连接，只更新本任务原spec/plan/records；实际执行已保存的M2开发入口，没有新增renderer、选款Agent或验收框架。fresh `npm run typecheck` exit0。三个最近suite首次29 PASS/1 timeout：qualification9和extraction17通过，diagnostic一项在30000ms技术门超时；原失败日志保留于F/related-tests.log。未改源码、测试或timeout后单次复跑diagnostic完整suite，4/4 PASS（48.48s），见F/diagnostic-recheck.log。该复跑不改变真实方法UNKNOWN、目录阻断或正式资格。代码快照按冻结SHA复核；文档引用和最终diff另外检查。

本次五份owned docs逐项核对AOCI scope为observe对象，无需改managed cognition或共享baseline。最终Verify/Check/Guide均exit0，governance_aligned=true、findings=[]、missing/stale/unbaselined/orphan=[]，Guide complete=true/next_action=none；初期四项foreign stale观察另保留，未以它阻断本任务observe维护，也未修改或提交其他任务索引。结果保存于F/final-verify.json、final-check.json、final-guide.json。86项文档引用及两库owned diffcheck通过；真实原片及8项开发源码SHA无漂移。父Agent Self-Review确认修改只收窄当前型号、澄清历史及记录实际开发/缺口；没有implementation扩权，未触发新增implementation adversarial review。工程mapper不是独立truth审核或正式actor。Repository没有专用session-capture skill，以上canonical records与私有原收据作为本轮capture；未写外部memory。

## Full Execution Continuation and Review Observation Seam — 2026-10-01

用户要求完整完成自动轮廓计划，并允许选择应用账号实际 image-enabled GPT；授权和实际路线诊断由 [AI record](shape-matched-cover-m5d2a.md#account-model-selection-and-native-projection-diagnosis--2026-10-01) 承接。本节仅记录 M4 所需无 authority 复核观察接缝，不声称真实自动链完成。Evidence owner 为私有 `auto-contour-full-20261001-51kctk6d`。

原 `shape-cover-admission.ts` 提供共享严格 `parseShapeCoverReviewObservation`：四项内容安全、自然度、原因及证据 IDs 保持原 schema；inspect/stop 沿原协议，裸 pass、缺 facet、bbox revise、extra authority 等拒绝。输出深冻结并固定 authority=none/eligible=false。原真实 admission 使用同一解析器后仍核验 SAFE/NATURAL、当前成对证据、coverage/source/output/sample bytes，私有 WeakMap handle issuer 未改变。诊断观察或 JSON 副本均不能恢复正式 handle，不引入第二 reviewer/renderer/queue。

新增 11 个观察及 authority 负例；初始不存在 parser 的可靠 RED 后 GREEN。Parent 首次 fresh typecheck exit0，原 candidates 105 与新观察 11 共116 PASS（141.20s），包含真实原队列/FFmpeg回归；这些是工程证据，没有实际模型复核或真实素材自然度验收。后续 working tree 出现与本任务无关的 development-lifecycle 修改后，交付前重新验证；最终结果随本节追加。AOCI 本轮 admission 官方完整批次1/1已应用，source SHA c976dc0e13c6ff437d18687c49a79b875fcd64f646596d014d96a0e26076e227，随后 Verify/Check/Guide exit0、Guide complete=true。共享索引保留，未 stage 其他任务内容；后续全库漂移须与本轮已维护对象分开报告。

本接缝未接 AI transport、源事实 issuer 或正式发布；M1真实路线、M2真实自动分割、M3独立真实truth、M4实际选款及样片、M5正式资格均继续缺对应证据。Native worker 仅实现接缝与测试，Parent 审查完整 diff 并运行验证，不把 worker verdict 或 tests PASS 当成 acceptance。计划禁止 Kimi 保持，M6仍 OUTSIDE_CURRENT_AUTHORIZATION/PRODUCT_DISABLED。

最终 continuation verification：在已观察到的 development-lifecycle 无关改动保留状态下，再次 `npm run typecheck` exit0；上述两个 suite **116/116 PASS**，139.70s，未再修改接缝源码。fresh AOCI Verify/Check exit0、missing/stale/unbaselined/orphan=[]，Guide 加 `--agent codex` 后 exit0、complete=true/next_action=none；第一次漏 agent 的 Guide 拒绝保留而非算作通过。共享 AOCI 后续索引由其他任务更新，仍未 stage 混合文件。Parent stable Risk Gate 为 KIMI_REVIEW_NOT_REQUIRED：接缝只产生严格 schema 的不可变观察，原 issuer、private handle、内容门和持久发布屏障均未扩权；authority/JSON replay 负例及原真实队列回归覆盖具体风险，未发现 critical consequence 或重大后果加未解决验证缺口的组合。真实成片及模型缺口保持单独阻断。

本接缝及当时三份task docs已提交 `8f8fdec`。随后Astra runtime no-tools调查中，配置修正真实移除协作工具，但exec/wait/request_user_input_async仍暴露，canonical native IMAGE_NATIVE_EXECUTION_INCOMPLETE；该路线当时新HTTP目录/图片、识别、选款、样片模型及formal请求均0。历史原因、exact receipts和配置诊断见 [AI record](shape-matched-cover-m5d2a.md#current-native-no-tools-blocker)。最新固定两型号的native已通过、目录exact0，以上方Fixed Model Catalog Followthrough为准；不将1076项router offline测试或116项本地工程回归当成完整M1–M5验收。

完整计划的剩余工作仍为：固定两型号实际image及正式执行路线、真正支持目标类别的自动mask方法、真实静态/固定动画各3个独立来源及各≥100明确原帧和独立提前冻结truth、实际识别/选材/成片SAFE与NATURAL/播放，以及正式blinded A/B/joint比较。M6在当前授权之外。Astra运行时准入阻断只保留历史；当前固定型号目录及M2/M3真实缺口见本record首节，**REAL_AUTOMATIC_CHAIN_INCOMPLETE / PRODUCT_DISABLED**；不把阶段代码提交称为完整任务完成。

## Automatic Contour Development Checkpoint — 2026-10-01

用户明确要求实现 [Automatic contour plan](shape-matched-cover-auto-contour-plan.md)。本次完成该计划允许在M1阻断时推进的M2本地工程与M3比较器；结论为 **AUTO_CONTOUR_DEVELOPMENT_ONLY / REAL_AUTOMATIC_CHAIN_INCOMPLETE / PRODUCT_DISABLED**。没有将计划全部标为完成，也没有重做既有预选星形180帧样例。

Evidence owner：`/home/reggie/.local/state/jianji-source-fact-qualification/auto-contour-implementation-20261001-m6o0x_tm`（R）。本轮模型/账号请求0，不读取或更新凭据、源知识、真人collector或产品准入。用户选择保留已有改动，并授权接续必要的provider及共享AOCI文件；实际没有修改provider，其字节与本轮初始副本相同。其他制作、上传、renderer、项目删除和未跟踪工作保留，不进入本任务commit。

### Implementation and Support Envelope

`source-mask-auto-extraction.ts` 从canonical owned D2读取每个原ordinal，核对source/census、ordinal、PTS/endPTS、RGBA字节数及SHA，并消费完整绑定的原AI declaration schema。声明明确标为UNQUALIFIED_ENGINEERING_DECLARATIONS，不是实际AI结果；调用者不能传mask。搜索ROI保持原1:1整数坐标，bbox不直接成为mask。源码生成最小半开bbox和LSB bitmap，原声明、逐帧候选、配置、输入及receipt摘要分别保留。漏首中末、错绑定、moving声明、身份或搜索原点变化、UNKNOWN、静态变化、源变化、取消和技术预算耗尽明确拒绝或INCOMPLETE；活跃原对象以WeakMap绑定，JSON不恢复ownership。完整候选复用原stationary-envelope owner，不复制并集算法或source admission。

方法只支持 `controlled-uniform-exterior-development/v1`：ROI边界必须精确同色，内部与边界不同的解码RGBA贡献全部计入，阈值0保留低对比细尖。非均匀边界、无法分离目标返回UNKNOWN。**这不是一般视频背景分割、遮挡/半透明边界或真实motion资格**；与背景同色的贡献无法由该方法识别，固定搜索原点也不能证明不移动。真实自动mask能力仍不足，不能把receipt CANDIDATE称为合格方法。

第二方法 `temporal-stable-exterior-difference/v1` 使用同一逐帧提取，至少3帧且轮廓/可见性完全稳定才保留候选；变化时全部置UNKNOWN。这是新的零变化开发对照，未复现或认证历史Python temporal算法，也不是对历史方法优劣的正式结论。尚未冻结唯一qualified extractor，没有新增分割依赖。

`source-mask-auto-qualification.ts` 在提取开始前冻结truth、criteria、方法配置及范围，独立truth只能进入比较器。私有时间顺序、owned evidence、exact source/census/config/frame binding均核查；结果绑定truth、freeze、candidate及criteria摘要。控制构造中的已知像素/有效帧/identity遗漏、moving误接纳和category错误为NOT_QUALIFIED；过度覆盖单独统计，不能签SAFE/NATURAL。未知像素truth或候选使像素指标null，未知motion保留INCOMPLETE；未经独立审核的REAL_MEDIA truth全部NOT_EVALUATED，不产生硬语义结论。两个作者字符串仅是开发包元数据，不能证明正式actor隔离或独立审阅资格。

`scripts/shape-cover-auto-contour-diagnostic.ts` 严格接收作者侧manifest，在新独占0700目录以0600/wx保存输入、原census、两方法预冻结truth、候选、比较、并集及最终报告。独立truth在两方法提取前冻结；无truth则比较未评估。硬比较失败后不生成envelope。无贴纸ID、预填mask、qualified/verdict、mock知识head、Provider callback或production handle接缝；不做选材、渲染替换层或发布，故它只是M2/M3开发工具，尚未实现M4真实链。失败保存INCOMPLETE，取消不签成功结果，owned临时spool由原evidence.close清理。

### Controlled Execution Evidence

实际执行本地CLI，使用提前编写的32×32/6fps、6帧lossless H264受控源，两个独立目标，共11个可见target/frame贡献、33个所需像素贡献。动画目标含低对比细尖、frame2闪烁缺席及最后frame5新增两个像素；静态目标在全部6帧可见。truth由构造recipe生成，不读取候选mask；这些开发材料已经暴露，不能进入never-exposed正式holdout，不满足真实来源数量要求。

| Development method | Candidate / comparison | Known omitted pixels / frames | Unknown candidate frames | Usable envelopes |
| --- | --- | --- | ---: | ---: |
| per-frame exterior difference | CANDIDATE / DEVELOPMENT_MATCH | 0 / 0 | 0 | 2 |
| temporal stable exterior difference | INCOMPLETE / INCOMPLETE | null / null | 6 | 0 |

逐帧动画并集7像素，静态并集1像素；保留所有原PTS/endPTS及RGBA SHA，不渲染真实替换成片。实际diagnostic wall7942.565ms，Node进程maxRSS107044KiB（进程峰值，非分离阶段内存）；modelRequests0、selectedMethod=null、qualifiedExtractor=null。全部AI识别、选款、独立样片、真实mask及真实固定动画为NOT_EVALUATED；formalQualification=INCOMPLETE。CLI首次从私有目录执行因外部zod依赖解析失败、尚未产生fixture；保留cli-0.log，给私有bundle使用现有仓库node_modules链接后独立执行成功，无新依赖安装，见cli-corrected-*及development-run/result.json。

### Verification and Ownership

已读取current `verification-before-completion`，最终源码摘要在final-source-snapshot.json，fresh `npm run typecheck` exit0；六个suite共**84 tests PASS**：新extractor17、comparator9、diagnostic4；原envelope20、pixel6、full-canvas review28。文件串行执行只为避免测试进程争资源，未更改产品并发；final-related-tests.log保留完整命令结果，90.80秒。新增extractor先因模块缺失可靠RED；本轮移动负例实际证明比较NOT_QUALIFIED后仍发两份envelope，修复脚本后进入最终完整GREEN，未放宽moving断言。独立CLI使用相同稳定源码，完成真实canonical FFmpeg解码而不是模拟像素输入；该证据不等于替换视频导出、商业模型或人工播放。

Native `code_mapper` `/root/visual_route_dependencies` 仅只读定位路线；`bounded_worker` `/root/contour_pixel_motion_comparator` 只写comparator及其test，Parent接收后独立检查完整实现、修正无用变量和诊断硬失败出口，运行上述fresh验证。两者均不是blind actor或正式reviewer；遵守本计划禁止Kimi。Parent在稳定验证后判断KIMI_REVIEW_NOT_REQUIRED：该变更没有生产消费者、持久源知识、credential或可发布authority路径，结果误差被固定非权威字段与原产品拒绝隔离，未出现重大后果加未解决工程验证缺口的组合。最终diff及commit scope仍由Parent负责，不以worker verdict作为验收。

AOCI逐项核对两个新managed模块，extraction当前基线已对齐；本轮官方机器批次仅comparator1项，完整Apply1/1、remaining0，source SHA `ea42ee47df856e1dbeb7844f8449c75fbbc8aa1adc5352dac884ca852697e19a`。源码、tests/helper、script和两份文档分别按managed/observe策略处理，不扩scope；随后Verify、Check均exit0、missing/stale/unbaselined=[]，Guide complete=true/next_action=none。已有混合dirty aoci.code.txt及baseline保留在working tree，不stage其他任务索引内容。本轮维护已完成，不把旧全库失败当当前blocker。AOCI上下文刷新完整交付193条/4块，严格Challenge10/10；治理结论仍以维护后的fresh JSON为准。没有repository专用session capture skill，本节承接稳定checkpoint，不写外部memory。

### Actual Blockers and Remaining Milestones

Parent核查现存canonical MiniMax probe receipt `response-optimization-20261001/unset-live-result.json`：probe `5dcf462d-7485-4911-b512-b865423fef2d`、invocation `44871911-cab4-4d5a-a349-2f732c81ad31`、MiniMax-M3、NOT_QUALIFIED / VISUAL_PROBE_MISMATCH，旧失败保持。当前GPT目录receipt `ea337c8c-084b-4c90-9cf0-cfed66948c09`仍精确gpt-6.1-sol匹配0，未发新catalog/probe请求，不能说永久无视觉。Parent结合router当前`require_live_admission`核对正式原片入口仍IMAGE_FORMAL_EXECUTION_UNAVAILABLE；随机probe不是原片执行owner。router由其repo合同独占且本计划不修改它，本轮没有证据足以归因MiniMax错误并授权一次有依据的修复probe，不盲重试或换模型。

因此M1未就绪；M2只有受控本地工程，没有合格真实分割方法；M3真实静态/固定动画各3个独立来源、各≥100明确原帧及独立审核truth缺失。M4实际识别→共同筛选→看摆放图选款→冻结→独立SAFE/NATURAL样片尚未执行，M5正式actor delivery/requests0，A/B/joint和真实层指标null/NOT_EVALUATED。不能用84个工程测试或一个受控源补齐AC-01–06。M6仍OUTSIDE_CURRENT_AUTHORIZATION；所有既有生产BLOCKED门、authority=none/eligible=false、PRODUCT_DISABLED、human及manual/assisted合同保持。

## Original User Source Diagnostic — 2026-10-01

用户继续要求“真实测试”，执行 [Spec extension](shape-matched-cover-stationary-spec.md#real-source-diagnostic-extension--2026-10-01) / [M4 plan](shape-matched-cover-stationary-plan.md#m4-original-user-source-diagnostic--2026-10-01)，结论为 **REAL_MEDIA_GEOMETRY_DIAGNOSTIC / AI_LIVE_ACCEPTANCE_INCOMPLETE / PRODUCT_DISABLED**。本节直接检查真实原片右上“国货之光”静态旧标；下方原controlled composite记录保留，真实固定动画尚未核实。

Evidence owner：`/home/reggie/.local/state/jianji-source-fact-qualification/real-stationary-20261001`（R），入口 `scripts/shape-cover-real-stationary-diagnostic.ts`。原片SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`，54,577,917 bytes、720×1280/30fps、视频233秒；没有注入或移动旧目标。替换仍为现有有效上传星形 `uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e`，保留自带文字，摆放601/0、119×78。只导出两个3秒原时段节选，未导出或验收完整233秒覆盖片。

canonical D1完整解码原片**6990帧**，census `cc01bcbc9c4c700e4fef68ab8d6faf7e6e9a5052ff20ea1d9f4a0fdaf806029e`、clock0..3578880、timeBase1/15360；owned D2按原ordinal读取 [420,510)、[2700,2790)。新envelope保存全部180条原PTS/endPTS/RGBA SHA。Parent逐条与完整census核对来源/摘要一致，9个source/script/contract快照前后相同；约24GiB临时spool由原evidence.close清理，没有操作其他spool/collector。

**Semantic limitation:** 各片段复用历史 temporal raw候选mask，原状态仍CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW；provider明确为historical-temporal-candidate-unreviewed-not-ai。逐帧复用只证明完整消费和几何声明，不证明AI逐帧提取或合格静态/边缘审核。envelope authority=none、eligible=false、semantic/mask/motion review=NOT_EVALUATED；reviewedSourceFrames=0，6990帧census不等于6990帧语义审阅。

| Segment | Original ordinals | Raw / projected pixels | Actual output | Conditional gaps |
| --- | --- | --- | --- | ---: |
| 14–17秒 | 420–509 | 3259 / 3555 | 720×1280、30fps、90帧、3秒 | 0 |
| 90–93秒 | 2700–2789 | 3371 / 3672 | 同上 | 0 |

两段消费同一PNG、共同半径7输出像素，PNG往返RGBA一致，SHA `9cc30e49af02ed63f50b2d2497e769cc147415e3d65c855924776a4e2666664d`。全部输出PTS与原相对PTS一致；FFmpeg完整解码无错误；候选投影像素全部alpha255。覆盖版与同原时段、同编码对照版的解码PCM相同（AAC重新编码），未听音验收。coverage依赖未审核mask，不能证明mask外无漏目标。

成片SHA：14–17秒 `682d12709abc4c0c1888d520bdcae3477e966527ee3ede0bd163fd4369a2af83`；90–93秒 `17357784d84f24f7dbc45df7abc18b93fe698c358a31cd4b4d28c49efc6088da`。每段保存original.mp4、covered.mp4、comparison.mp4（左原片/右覆盖）、comparison.png、original/covered-all-frames.png、envelope.json、verification.json；root保存完整census、inputs、commands、源码快照及Parent完整性证据。

Parent实际查看两段原/成片全部90格边缘联系表及配对全画面：所查右上旧标未见外露，图层固定、无矩形白底；白边仍偏厚，顶部/右侧贴边。两幅全画面中主要操作区域及中央字幕仍可见。这是局部真实观察，不是独立自然度或内容安全资格，不涉及其他角落原图案。

Chrome MCP因共享profile占用拒绝启动，未停止其浏览器；改用独立临时headless Chrome。首次六片顺序播放记录5次正常结束（含两个covered.mp4），均90帧、playbackRate1、dropped/corrupted0；最后90–93秒comparison guard失败且未记录该次quality，保留playback.log/first-playback-observation.json，不算通过、不猜原因。仅对该对比片在独立单video页做一次定向诊断，实际3304.7ms播放至3秒结束、90帧、dropped/corrupted0，见comparison-playback.json/截图；不覆盖首次失败。全部播放muted、listeningReview=NOT_EVALUATED。

### Fresh Route Observation

只读named native code_mapper `/root/unmetered_route_mapping` 定位当前入口，非blind actor，遵守用户禁止Kimi。Parent复用external-subagent的sealed image contract、官方program SHA `3998a1676c9f8ff378e628713696cc80c49aba1115e94b28a86584de17342317`、Docker/native conformance、canonical receipt；没有修改router源码或安装。

初次prepare遗漏显式image sandbox配置，IMAGE_RUNTIME_CONFIG_REQUIRED、零provider requests；保留preflight/state，核对官方当前codex.json后更正配置。新owned probe `db114c11-d328-4d79-92dd-2aa6a1ec116d`、conformance `5d97b72b-a996-45b8-8b81-c1e79d6fb7e5` 为ENGINEERING_CONFORMANCE_COMPLETE、商业generation0。随后仅一次observe-image-subscription --verify-model：应用独立认证reference、固定catalog GET，不登录/refresh token/读global Codex auth/查quota。

真实canonical receipt `ea337c8c-084b-4c90-9cf0-cfed66948c09`：2026-09-30T23:11:56.365765Z，authenticated=true、catalog_model_count7、精确gpt-6.1-sol matched_model_count0、input_modalities=[]、image_input_supported=false、INCOMPLETE；account_queries1、provider_requests0、actual_cost_usd=null。仅说明当前账号/时间/目录条件，不宣称模型永久无视觉能力；未换别名或模型。MiniMax旧八图probe NOT_QUALIFIED（位置7/8错误）保留，未追加商业请求。

Parent按当前image_run.py::require_live_admission及CLI核对：unrestricted正式原片请求无admitted execution owner，IMAGE_FORMAL_EXECUTION_UNAVAILABLE；随机probe不能挪用发原片。实际AI识别、AI选款、独立样片复核请求均0，选款/自然度/安全NOT_EVALUATED。停止AI单元是当前GPT图像条件、MiniMax已证明probe错误和formal owner gate；不是额度、Key或用户未回复继续。

### Verification and Decision

执行current verification-before-completion：fresh typecheck exit0；envelope/pixel/full-canvas review共3 suites、54 tests PASS（230.57秒）；真实原片/PNG/时钟/音频/播放证据如上。新CLI由实际本地执行验证，未新增重复实现细节的单测；其他任务并行dirty变化保留。

Parent在stable candidate判断Risk Gate：没有当前用户要求Kimi review；独立diagnostic无production consumer、源知识写入或credential实现变更，失败后果为隔离诊断错误，不能造成重大authority/credential或不可恢复state损坏；完整来源/几何/真实渲染已验证，语义缺口固定NOT_EVALUATED且原生产门隔离。因此KIMI_REVIEW_NOT_REQUIRED，不新增重复reviewer。各新增/修改script/docs按当前AOCI observe范围核对，没有managed源码增量，不写/提交共享索引；最后fresh typecheck/diff及Verify/Check/Guide在Delivery Verification保存。

当前没有专用session capture skill，本节与原phase/plan保存checkpoint，不写外部memory。正式M5-D2A仍INCOMPLETE，formal requests0，A/B/joint null/NOT_EVALUATED；真实固定动画、合格mask/motion、双路线选款/复核及生产资格仍缺。PRODUCT_DISABLED；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance全部BLOCKED，authority=none/eligible=false。原人工认可效果与现行manual/assisted不变。

### Delivery Verification

恢复中断后先核对当前HEAD `50ed06b27c48adf30c0753e76ddd06539920cd1c`、现有dirty/owned paths、真实MP4摘要、6990帧census和已完成目录/播放收据，未重发已执行请求或导出。再次fresh typecheck exit0（resumed-typecheck-result.json），git diff --check通过，本轮5份文档的本地引用存在；脚本SHA `2f2ae33121cab370cf1a24b0aed3c19cafac4a1ad84715553eb36631348bc526` 与实际运行快照一致，原相关owner源码未变。

AOCI逐项核实本轮6个对象全部为observed_new，没有本轮未维护的managed对象，不扩大scope或改写共享索引。初始Guide complete=true；末检Verify/Check exit1、Guide complete=false，structure_valid=true但全库治理未对齐，5个foreign stale为src/main/batch-production-runtime.ts、src/main/douyin-upload-service.ts、src/renderer/BatchProductionDetails.tsx、src/renderer/DouyinUploadPanel.tsx、src/shared/batch-production.ts。本轮对象不在missing/stale/unbaselined中。保留所属任务的进行中改动，不调用或截断包含foreign对象的完整Maintain batch；这是全库治理的真实剩余工作，本checkpoint不宣称其完成。末检原JSON与实际命令状态保留在R，scope仅本slice的script/spec/plan/record/phase/总plan；其他dirty/staged/删除/未跟踪工作不stage/commit。

**Post-commit refresh:** 其他owner随后自行完成并提交 `f212a76`；本slice工程checkpoint `c1ee3ef7bb2cbfebaac998dbbc0e8c9465ae515e` 精确只含上述6个owned文件，没有共享索引或业务文件。Parent核对9个实际执行源码/合同摘要均未变、foreign文件字节无变化。再次Verify/Check/Guide全部exit0、governance_aligned=true、stale=[]、Guide complete=true/next_action=none，保留postcommit-*.json；此前5项漂移失败仍保留为历史，不继续当作当前blocker。剩余阻碍是上方真实AI/动画条件与正式资格，生产状态不因AOCI恢复而提升。

## Scope and Result

2026-10-01 用户要求执行“静态贴纸 + 不移动的动画贴纸”，moving 暂不支持。依据 [Spec](shape-matched-cover-stationary-spec.md) 和 [Plan](shape-matched-cover-stationary-plan.md)，实现完整帧绑定的 `stationary-union/v1` geometry candidate 与真实本地 FFmpeg 验证。结果无 source/semantic/production authority；未接产品入口、未安装启用新功能，既有 manual/assisted 与已认可效果不变。

## Implementation

`shape-cover-stationary-envelope.ts` 只消费原 owned D2 evidence，读取请求连续范围的每个 D1 ordinal，核对 target/PTS/endPTS/RGBA SHA/固定 anchor 与 mask 字节。静态声明的可见 mask 变化、moving/unresolved、UNKNOWN、漏项、错帧、越界、取消或伪造 evidence 均 UNSAFE。动画轮廓逐帧 OR，原候选、来源、source/census 和完整 digest 保留；NOT_VISIBLE 仅是该目标声明，不是全画布 EMPTY。静态格式及知识审核 owner 不变，没有 human session 操作或虚构 review 字段。private raster 只返回副本，克隆 receipt 不恢复 ownership；64MiB receipt、D1 wall 和512×512 bitmap技术边界不限制账号费用或 token。

## Render Evidence

最终渲染证据目录：`/home/reggie/.local/state/jianji-source-fact-qualification/stationary-cover-20261001-v4`；verification、red/green和AOCI日志保留在 `stationary-cover-20261001-v3` 及同一state树的stationary-final-tests-20261001.log。CLI为 `scripts/shape-cover-stationary-diagnostic.ts`，esbuild bundle保存于同一私有state树；参数为真实背景源、现有上传目录/候选ID、新独占输出目录和应用 FFmpeg/FFprobe。v4另外保存原owner完整census.json，包含引擎指纹、解码解释和完整帧绑定，不另签census。

背景为既有真实720×1280视频的[14,17)秒，原SHA `a18f7e4e5fc02e5db977d9074be35ce82a296d247194205e9cf88e1ac76fc0bf`。仅为 controlled composite 构造360×640/12fps fixture，不把该降采样称为对原视频全时域识别。替换贴纸来自原 `UploadedStickers.load` 有效目录，`uploaded-ad676bcdf2e3e23e253fd918209a5fb778916a74b6ba00a75e410d6abf7b786e`，自带“惊爆价”内容原样使用；摆放x282/y12/w75/h54，不生成或改写文字。

| Controlled case | Frames | Union pixels | Uncovered pixels | Target-free reference diff | Audio |
| --- | ---: | ---: | ---: | ---: | --- |
| static | 36 | 922 | 0 | 0 | PCM identical |
| stationary-animation | 36 | 1162 | 0 | 0 | PCM identical |

动画三个已知轮廓为513/922/1162像素，frame5/17/29闪烁不出现，最大轮廓仅在frame35出现；相对首相位新增649像素。所有原始帧通过 canonical D1、owned evidence；两例共72帧，输出帧数与全部PTS相等，PNG往返RGBA完全一致，所需投影像素全部opaque。参考片使用相同颜色转换和overlay链，仅明确移除受控旧目标；两个成片的全部解码RGBA逐帧与参考一致。冻结PNG SHA `15d9a69c015c691dac14b7b5148634456004118a0894e4c1692453febf4e16c9`，两个covered.mp4 SHA均 `f148bd4a1f5563078e5f18d57c6c2a8848ce064dcb2f8bcdfd80c4800d4480ad`。覆盖层始终固定，不生成白底矩形。

static source SHA `0d4cfb26df5f513892c03541af03488546dbd316b9230b5d6e2cb554ee903760`，census `7dce8e305396deb6038bbbc0727bd142d314d18c9bb022e36c869584b232902c`，receipt `03ff59daa2409da3c405d6df607b13bd459e6d93923e0162112345d7a34abe27`。animation source SHA `119f0e84dd9ec29135e5ea02254ccbde5c9cb50e9a70420863bf27f328b24802`，census `10dd9bbc4a14c4df8ef4d1f086f4a3104dfe9d021a1178449efde7521b655084`，receipt `b5666e51adaeac6bbff0d046ce44efa1c4b2a6fc35e6bd4edb457b7f6e2f78f3`。完整原候选/时钟/掩码/配对图/PCM摘要见各case的envelope.json和pixel-check.json。

首轮目录 `stationary-cover-20261001` 保留：phase1/2实际轮廓相同，且参考链少一次颜色转换，出现263个不同像素，不能作为完整验收。纠正fixture与参考后v2通过；final code增加静态变化拒绝与receipt资源边界后再次真实执行v3，加入完整census留存后v4再次执行，上述摘要与结果均复现。旧结果未重写。Parent实际查看frame35原图/成片配对：受控cyan目标消失，上传星形无白矩形且人物仍可见；这是局部spot-check，**不是完整人工观看、独立自然度或原背景全部贴纸都已覆盖**。背景原有图案仍作为背景保留，fixture仅验证注入目标。

## Verification and Governance

新增测试先因缺模块失败；另静态变化负例在修复前实际resolve导致失败，修复后纳入全回归。初轮6 suite有204PASS/1既有FFmpeg时序测试5秒timeout，保留失败。串行文件/30秒技术wall重跑后时序用例通过，6 suites/207 tests中206PASS，另1个丢失发布返回用例失败；新增20项及其余5 suites全部通过。该用例错误把production首调用对应queue首调用，在双素材并发下可能选到成功素材。用可控Promise强制两阶段顺序相反，原断言仍实际失败（publication-order-red.log），随后只改测试关联为实际丢失返回的queue mediaId，重跑该用例及5个邻近production回归，6PASS/99因name filter未运行（publication-order-green.log）；99项不被本次过滤调用重新计PASS。实际错误素材仍无receipt、reentry拒绝、无新输出/queue调用，其他已成功素材仍保留幂等完成。没有修改production owner或放宽断言。最后fresh typecheck exit0，日志分别保存于私有证据树。

AOCI官方完整批次仅新增本模块：source SHA `90eb6df69f20304299fec38c4f601a93b4dde995f0a1993669ce5a1603acd2c6`；Apply1/1、remaining0，Verify/Check结构及治理aligned，Guide complete=true/next_action=none。此前191条索引内容和全部已有business source baseline条目逐项保持；机器仅新增本模块、更新aoci.code.txt自身绑定和updated_at。共享索引增量写入经用户本次明确授权，**不提交**这两个混合dirty文件。其余本轮docs/tests/script按observe范围核对，不扩大索引scope。AOCI Overview交付确认成功；Challenge字段schema未成功提交，严格完整认知未成立，仅依源码绑定执行，不宣称完整系统认知可靠。

交付末检期间另一个任务新增batch实现改动：Verify/Check exit1，Guide complete=false，四个stale对象为 `src/main/batch-production-controller.ts`、`src/main/batch-production-runtime.ts`、`src/renderer/BatchProductionPanel.tsx`、`src/shared/batch-production.ts`。本轮新模块不在missing/stale/unbaselined中，源码与已Apply基线仍一致，逐项维护已完成；全库治理此刻未对齐。保留其active工作，不领取并截断包含foreign对象的新机器批次、不越权维护它们。本轮稳定checkpoint不是全库治理完成，末检原JSON保存为delivery-verify/check/guide.json；待所属owner稳定并完成维护后才可声明全库aligned。

## Risk Gate and Ownership

Parent在上述project-native verification结束后对stable candidate判断一次：`KIMI_REVIEW_NOT_REQUIRED`。没有用户要求本snapshot的Kimi review（当前明确禁止）；新增实现没有production consumer或持久state写入路径、private诊断拒绝覆盖旧输出，故不具备重大凭据/authority/不可恢复state损坏后果。mask/motion语义未验证由固定NOT_EVALUATED和原production拒绝隔离；回归发现的测试竞态已用强制倒序red/green及相邻路径证据裁决，无重大后果加剩余工程验证缺口的组合，不再叠加native reviewer。Parent检查最终diff、来源/schema/兼容边界及实际导出证据。只读mapper为 `/root/stationary_animation_mapping`、named `code_mapper`（工程用途，非blind actor），遵守当前禁止Kimi及禁止嵌套/写入边界；actual provider/model execution identity不推断。无新provider请求，费用/token0。

稳定source SHA `90eb6df6…cd2c6`；新test `4ee0d33b…b4d6a`；既有publication-test修正 `6cc26704…be3f`；diagnostic `153e6485…fad5`；Spec `d23bbe44…6acb`；Plan `ca058057…f01a`。完整SHA、当前Git HEAD/changed paths、命令与final diff绑定在私有snapshot-manifest.json；record自身不递归声明自己的hash。只读进程核对当前human collector数量0，未启动、重启或自动填写任何human语义。

Current tree 开始于ec20c30；另一任务期间提交了Qianchuan/capacity工作，未合并或改写其历史。所有既有dirty业务路径、项目删除和未跟踪脚本均保留。只提交本slice代码/test/script/spec/plan/record及原phase/总plan的pointer；不stage共享索引或其他工作。无 dedicated worktree、reset/stash/覆盖源文件。

## Remaining Boundary

该candidate已能在**完整且正确的逐帧输入mask条件下**生成静态遮盖；没有实现合格模型从真实用户动画素材提取这些mask，也没有证明actor能判断固定位置。受控目标的mask来自已知fixture recipe，不是AI输出或新的独立holdout，不外推真实动画媒体。现有MiniMax-M3实际视觉probe NOT_QUALIFIED（位置7/8错误），GPT精确gpt-6.1-sol应用账号image条件仍缺；本轮不盲目重试、不改标准/模型、不要求OpenAI Key或额外预算材料。

M5-D2A仍INCOMPLETE，formal requests0，A/B/joint指标null/NOT_EVALUATED，authority=none/eligible=false。PRODUCT_DISABLED；M5-B activation、M5-C issuer、M5-D3、M5-D4、verified-no-sticker production issuance BLOCKED。下一实际工作是有依据地修复视觉输入/能力并通过原资格门，随后合格mask/motion语义来源及另行授权的生产阶段；当前本地工程结果不授权这些阶段。
