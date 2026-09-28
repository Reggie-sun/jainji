# M5-D — Full-Source-Fact Proof Contract

## Scope and Status

2026-09-28 用户要求定义并验证“完整源事实”，重点为 verified-no-sticker interval 和 exhaustive target set，暂不添加 M5-C 成功 issuer。本切片建立证明义务和 test-only 可执行原型，不给原有知识 revision 升级 authority。状态为 `CONTRACT_VALIDATED / SEMANTIC_AUTHORITY_BLOCKED / PRODUCT_DISABLED`；这不是完整 M5-D admission 已完成。

原型 [full-source-fact-contract.ts](../tests/helpers/full-source-fact-contract.ts) 仅供 [contract tests](../tests/source-fact-completeness.test.ts) 使用，所有结果固定 `authority=none / eligible=false / semanticReview=NOT_EVALUATED`。`CONSISTENT` 只表示给定声明与给定帧清单没有结构矛盾，绝不是 `PASS`、可信语义审阅、mask admission 或 production eligibility。无 production import、store write、proof issuer、C 成功支路或产品 activation。M4 authority、M5-A renderer、M5-B guard 与历史任务解释保持原合同。

## Current Source Findings

| Existing owner | Actual proof | Missing D obligation |
| --- | --- | --- |
| [source-sticker-knowledge.ts](../src/shared/source-sticker-knowledge.ts) `KnowledgeCandidateSchema` / `coversRanges` | 源身份、观察引用、几何及时域一致性；reviewedRanges 的区间覆盖 | 宽 range + 一帧 ABSENT 可以合法；没有逐帧穷尽语义 |
| [source-sticker-knowledge-store.ts](../src/main/source-sticker-knowledge-store.ts) `checkProof` / `readHead` / `lookup` | 已有 revision、证据字节、争议、mask 和已记录范围 | lookup hit 不证明没有未记录目标；source-mask-only 限定单 target/segment 的局部事实 |
| [supervisor-evidence.ts](../src/main/supervisor-evidence.ts) frame probe / extraction | 原 PTS、抽帧及 ROI/缩放审阅图像 | probe 过滤坏帧的 flatMap 不能复用为完整 census；抽样或缩小图像不能证明全画布无贴纸 |
| [shape-cover-production.ts](../src/main/shape-cover-production.ts) prepare | request 与当前 revision 已记录 segments 相等 | 记录集合相等不等于视频真实目标集合穷尽 |
| [shape-cover-request-assembler.ts](../src/main/shape-cover-request-assembler.ts) assemble | canonical source/head/mask 收集后固定 UNSAFE | 没有 D 和可信 placement，返回 Promise<never> |

现行 [source knowledge spec](source-sticker-knowledge-spec.md) 已区分观察点的 ABSENT 与时段缺席。本合同补充 D 的更强义务，不改变 sampled、source-mask-only、manual/assisted 或既有持久格式。文档中的 `[0,durationMs)` 是用户时域表达；精确验算须以下面的 decoded clock 为准，不能将毫秒舍入当作尾帧证明。

## Proof Layers and Ownership

D 的证明必须同时成立：**完整机器帧清单 + 可信完整语义审阅 + 全目标/全时域 mask 准入 + 当前 canonical 绑定**。四者都由已有 source-fact owner 接受和重核，不另建 completeness store。任何一项缺失就是 `UNSAFE`；空 unverifiedIntervals 只是一项必要条件。

机器可以证明“解码得到这些帧、声明引用这些字节、目录与声明相等”。机器帧清单本身无法证明“这些像素中没有旧贴纸”，也无法检测目录和逐帧声明同时漏掉一个真实目标。hash、严格 schema、遍历次数和 JSON PASS 都不能跨过该语义信任边界。最终穷尽性是绑定到明确审阅方法的 review-backed claim，不是 hash 推导出的零漏检定理；M5-E 仍需真实成片全速观看及漏检验收。

## Complete Decoded Horizon

1. 主进程 owner 从精确原素材完整解码指定视频 stream，绑定已有 SourceIdentity 的 SHA/字节数、尺寸、rotation、timeBase、timeOriginPts、interpretationVersion，以及当前 revision/factsDigest。记录 stream、decoder build、像素格式/色彩/旋转解释和清单字节 digest。读取前后复核源身份；取消、解码失败、缺记录、预算耗尽均不得产出完整声明。
2. 原型的 `full-canvas-rgba-pts-v1` 只支持 rotation=0，逐帧原画布 RGBA，不裁剪、不缩小、不去重、不跳帧、不按 nominal FPS 补齐。每帧记录连续 `index=0..N-1`、原 `pts`、显示 `endPts`、原画布字节 SHA/大小。相同 pixel SHA 的不同 ordinal/PTS 仍是不同帧。完整 census 应验证每条 probe 记录并与 raw decode 帧数一一对齐，不能丢弃 malformed records 后再说完整。
3. 精确 horizon 为 `[firstPts, horizonEndPts)`，firstPts 必须等于 source timeOriginPts；每帧 `[pts,endPts)` 与下一帧无缝相接，末帧 endPts 与独立核实的 stream 显示终点一致。时基使用整数/rational 运算；VFR 不转固定 FPS。没有可信末帧 duration、时钟有缺口/重叠、重复 PTS 或不支持的解释时先 `UNSAFE`，不猜 duration、不默认沿用最后一帧。普通容器的 packet duration 不能不加解释地当作显示 duration：将来扩展支持须固定 decoder 的显示时序规则，不能静默修正。
4. 原型接受独立参数 inventory 用于 consistency 检查，并未从 production owner 得到可信清单，也没有独立验证其 decoder provenance。它只将整数 endPts 与 source.durationMs 做最多 1ms 的舍入一致性核对；该容差**不允许扩大覆盖区间**，完整分区仍精确覆盖所有 ordinal 和 endPts。真实 D 签发必须核验完整解码及精确终点，不能信任 caller 提供的 inventory/frameCount/endPts。

canonical 分区采用半开帧区间 `[startFrame,endFrame)`。映射到显示时间使用清单 PTS/endPts，同一规则用于 mask segment 对齐；旧 ms 边界落在帧内或无法精确对齐时不能用舍入冒充 admitted mask 覆盖。整数毫秒范围只用于展示或既有旧知识语义，不作为新的 exhaustive proof。

## Verified No-Sticker Interval

`verified-no-sticker interval` 是一个完整 decoded frame 区间，其**每一帧**都经过合格的全画布语义审阅，明确给出完整空目标集合，且没有未决争议或不确定性。它不意味着用户选择“不覆盖”，也不意味着只检查某个已知 target 不在场。连续合格空集合帧才可以合并为无贴纸区间。

审阅必须看全部原画布细节；允许原分辨率分块/放大，但 owner 必须证明 tiles 覆盖每帧全部像素，不遗漏边缘/中部/切镜。缩略 contact sheet、首尾/定时抽样、少数 representative frames、只看已选 ROI、静态 mask、两帧相同或任意 `ABSENT` 标签都不足以签发。已知 target 不出现，也不能证明另一个新 target 不存在。无法判断旧贴纸与字幕/商品图案的差异时记录 UNKNOWN，不能改成“无贴纸”让准入通过。

可以定义的确定性语义复用只有一种保守边界：完整清单中的某帧与一个**已合格审阅的完整原画布帧**逐字节相同，在相同解码/语义解释下引用其完整空集合结论。每个 ordinal/PTS 仍保留，owner 必须为每帧建立精确 full-frame 字节等同及审阅引用；只知道首尾相同不能桥接中间。近似相似、ROI 相同、静态背景、低像素差阈值都不能复用。这样可减少重复画面的人工工作，但没有合格 reference review 时全片相同仍不获得语义 authority。对于非空集合，目标身份/跨镜关联还有独立义务，不能仅靠像素相同自动合并 target/segment。本轮相同 SHA 的 VFR 测试只验证 ordinal 保留，不签发这种复用。

第一个可评估的语义方法候选是 **原画布逐帧显式人工枚举审阅**：source-fact owner 创建只读、源/帧清单绑定的 review session；审阅端不能更换源/输入 digest 或补未看帧；最终明确确认任务范围是“所有可见旧贴纸”，逐帧写完整目标集合或 UNKNOWN，并记录审阅方法/版本/身份/时间、实际呈现帧及全部图像证据绑定。点击已看记录不能证明人的注意力或零漏检，因此该方法仍须资格验证和 E 的独立真实媒体验收。当前没有该 session、UI、合格语义方法或签发入口；本轮不把构造 receipt 当作合格审阅。

将来若用模型协助，候选识别与完整性批准须分开，批准者必须审查全画布/全部帧并承担完整空集合判断；识别器的空返回、超时、采样模型 PASS 不等于无贴纸。未经明确方法 qualification 和完整证据链，不增加自动 absence issuer。本轮未调用模型。

## Exhaustive Target Set

令每帧可信审阅得到 `T(f)`，范围是**该原画布帧所有可见旧贴纸**，不是角落、已选择覆盖的框、当前 mask 或支持 static V1 的子集。明确空集属于已审阅，UNKNOWN 属于未核实。全局 `knownStickerTargets = union(T(f))`；每个 target 的活动帧集合必须与其所有 segments 的无重叠并集精确相等。任一完整帧出现未列入目录的 target、目录存在无证据 target、segment 穿越已确认缺席区间、漏首尾帧或只记录一个同时目标都应拒绝。

同一 target 消失再出现应拆 segment，不能靠线性插值桥接缺席；多个同时 target 全部入集合。目标身份不确定、切镜后的关联未知或审阅冲突时保留 UNKNOWN/争议。moving、animated、低置信度或无法生成合法静态 mask 的旧贴纸仍须入集合并阻断当前 V1 eligibility，禁止先从目录排除它们以制造“全部 eligible”。person/product/subtitle 等语义排除必须有同样完整且源绑定的审阅依据，不能靠 caller exclusion 或模型文本把旧贴纸藏起来。

所有实际目标的每段活动帧都需要已核验 mask，绑定 source/revision/target/segment/mask SHA 和精确 frame horizon；从局部 mask review 不能外推到同 target 的其余时段。源时段完整性与 mask 可信度分别证明。现行 single-segment source-mask-only proof 不能自动聚合成 D：全片 census、语义审阅、统一 canonical revision、多目标 mask 接受及其证据组合规则仍缺 production owner 支持。零目标素材免于 mask 要求，仍不免于全片 absence proof。

## Complement and Freshness

`coveredIntervals` 是语义完整的逐帧集合（包含有贴纸与无贴纸）；不是 mask ranges 的并集。`unverifiedIntervals` 由 source-fact owner 计算全 horizon 的 complement：缺审阅记录、UNKNOWN、证据失败、冲突以及未完成工作全部落入该集合，不能由请求字段传 `[]`。合格 no-sticker intervals 是 coveredIntervals 的一个子集；有贴纸帧只在全部目标/时段的 mask 准入成立后满足 eligibility。

签发前及消费时必须通过既有 canonical store 检查精确 source、head revision/factsDigest、证据完整性和所有未决 disputes。proof 的 source/clock/census、semantic session、完整逐帧集合与目录、mask 集合须同一个绑定；不同源、修订、片段或方法的 PASS 不可拼接。任何变化使旧 proof 不可用。最终 placement、candidate、output setting、coverage、独立 content safety 仍属于 M4/C 后续合同，D 不提前填这些 PASS。

持久证据只可在已有 knowledge owner 的明确新版本 proof 中保存，所有 JSON 永远 `authority=none`；恢复时重核源、当前修订、证据和方法支持状态，不能从 serialized PASS 恢复 opaque capability。将来的运行期 D reference 必须由 owner 私有签发、不可伪造，且 consumer 再核 freshness。当前不新增 schema、迁移、CAP handle 或第二套生命周期。

## Executable Evidence

`tests/source-fact-completeness.test.ts` 验证首/中/尾遗漏与 UNKNOWN complement、VFR/相同像素不同 ordinal、原 PTS/字节/源/修订/解释绑定、完整目录与逐帧集合精确相等、同时目标和消失重现，以及 caller `complete=true` / `unverifiedIntervals=[]` 等注入拒绝。现行 KnowledgeCandidateSchema 合法接受“1000ms reviewedRange + 一帧 ABSENT”的反例，原型不将其升级为完整证明。

真实 CPU FFmpeg 生成 lossless H.264 MP4（64×64、30帧、1秒、timeBase=1/30000），第15帧在中部同时闪现两块独立图案，其余帧黑色。ffprobe 全量 PTS/duration 与 raw RGBA 帧数/SHA 一一对齐；首尾相同仍会漏掉两个目标。测试用合成坐标作为已知真值，**不将像素差异检测称为旧贴纸语义识别**。

删除第15帧审阅会留下 complement；只列一个目标与两目标观察矛盾时拒绝。更关键的反例：将两目标从目录和全部逐帧声明一起删掉、保留真实图像 SHA，仍然 `CONSISTENT` 且 claimed complement 为空；结果依然 eligible=false / semanticReview=NOT_EVALUATED。该反例直接证明结构一致性无法证明 exhaustive semantic truth。

最终 verification 数量、环境能力和 frozen 文件核对记录在下一节。FFmpeg 合成短片不是用户真实媒体、人工语义审阅、实际整片遮盖、Windows、CPU-only 产品批量性能或 M5-E 验收。

## Remaining Admission Gate

下一项 D 实施只能先在现有 source-fact owner 建立 full-decode census 与合格语义 review session/acceptance，验证零目标、所有同时目标、切镜/运动/漏审阅的 fail-closed 行为，再定义版本化多目标 mask proof 接受、CAS/dispute/freshness 和私有 capability consumer。没有合格语义方法时应停在 `SEMANTIC_AUTHORITY_BLOCKED`，不能用本原型、假 reviewer 或新 boolean 继续签发。C 的完整 issuer 尚需 D 与可信 placement；D 成立也不能自行打开 M5-B，E 仍是独立产品门。

## Verified Definition Checkpoint

最终候选的 helper SHA=`45b923ef8614db9cf3a5dac43f5e10a8f43b98c825afe24da1f2e8e0335f1980`，tests SHA=`67a68e376b3be43d52fb8075866f699324473f7b6f27346847d76bb9a024f82e`。`npm run typecheck` exit 0；`npx vitest run tests/source-fact-completeness.test.ts tests/source-sticker-knowledge.test.ts tests/source-sticker-knowledge-store.test.ts tests/shape-cover-request-assembler.test.ts tests/shape-cover-activation.test.ts tests/agent-controller.test.ts --maxWorkers=2 --minWorkers=1`：6 files /151 tests PASS，0 failed /0 skipped，其中新增 D 41 tests 包含真实 CPU decode。日志 `/tmp/jianji-m5d-related.log`、`/tmp/jianji-m5d-typecheck.log`。

初次新增 suite 因 helper 尚未建立而 load fail，不是 production bug 复现。首次媒体检查在 Node 默认 stdin pipe 下出现 EPERM，改为明确 ignore stdin 后正常；保留 error/status 断言。按现有 tests/setup-ffmpeg.ts 使用应用 engine `n8.1.2-52-g5a03dfa0f6-20260912`，probe 的新 `duration` 字段与旧 `pkt_duration` 均只接受显式值，不估算缺失 duration。新增 rotation negative 曾污染共享 fixture source 对象，已让每个 fixture 独立复制 source，最终完整回归在修正后重跑。

冻结文件核对：M5-C assembler SHA=`9d0f0f1ce7384e90d572d98a58b413cfd65e9ed33468f4e58d790a8517b881bd`；M5-B guard SHA=`c9376550656efc78da113de420d8e76530c703fc40d15ef950777d87fe094cb6`；M5-A renderer SHA=`15e307dedb8698900a22d4b0db4ecfb7383a413bd4a7a08d074f4fdc35838da7`；M4 fixture SHA=`997def30786e2c49a6568b198a2fc8ceb960dec58d65bd841ded4a88a07732f7`，均与 C checkpoint 相同。原 prototype 只由测试引用，不进入 production。无受管理 src 修改，不触发 AOCI Maintain；已有索引/staged、无关 dirty 和用户项目文件删除保持原状。

Implementation Review Risk Gate 对上述稳定 SHA 判为 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求此 snapshot 的独立 review；测试原型没有 production 调用、成功 eligibility、handle、持久写或执行权限，因此没有严重越权/持久损坏路径。可信语义审阅缺口已由可执行双边漏目标反例明确保留为 blocked，没有把它包装成已实现的安全逻辑。Self-Review 对照 scope、证明层、时间/集合/语义界限、历史兼容和 C 无签发要求完成；不默认叠加 reviewer。

按 standing route 读取 SUBAGENTS.md 和 external-subagent skill 后，用 `/tmp/jianji-m5d-subagent` 做 managed Kimi doctor；exit 2 /`BLOCKED_CAPABILITY`，bubblewrap containment `qualified=false /project_access=false`，`adversarial_containment_not_qualified`，Docker `SANDBOX_IMAGE_UNAVAILABLE`。未调用 upstream、未获取外部调查/review 结果，不绕过封存/qualification 或换 provider。CodeGraph MCP 实际返回“requires approval, but approval policy is never”，本轮结构核查使用 rg 和实际 owner 源码，不能声称 fresh CodeGraph 查询成功。

Session-record 评估：本轮有 durable 合同/可执行反例，记录在本 milestone 和既有 Plan，未发现 repository 专用 capture skill，不创建第二套 record owner。收口范围仅为证明定义与合同验证；完整 D authority、C 成功 issuer、E 和产品激活继续 blocked。

Git completion blocker：本轮四路径已 specific-path staged，随后 `git commit --only -m 'test: define full-source fact proof obligations' -- <four paths>` 被 `.git/index.lock: Read-only file system` 拒绝，HEAD 仍为 `65c4bd7`。未将其他 staged 工作混入提交、未修改权限或尝试旁路；本段 blocker 记录留在 working tree，未再次写 index。验证成功不等于 Git checkpoint 已提交。

## Git Mount Diagnosis and Next Gate

用户随后要求先解决 Git checkpoint，再实施 D1。fresh 只读核查：show-toplevel=`/home/reggie/vscode_folder/jianji`，git-dir=`.git`，index 为 reggie:reggie 的 664 regular file；`index.lock` 不存在。findmnt 显示 repository 为 ext4 `rw,nosuid,nodev,relatime`，但 `.git` 是独立目录挂载 `ro,nosuid,nodev,relatime`；`/proc/self/mountinfo` 的 `.git` 行为 VFS `ro`、底层 superblock `rw`。这是当前执行环境的局部只读挂载，与本会话 `.git` read-only permission profile 一致，不是残留 lock，也没有整块 ext4 被 remount ro 的证据。chmod、删 lock、磁盘 repair 或强行 remount 都不适用；需由执行环境恢复 `.git` 写权限，当前 approval=never 不允许在本会话申请绕过。

本轮未重新写 index、未再尝试注定失败的 commit、未触碰无关 staged/dirty；只将诊断与顺序补入原四路径中的 milestone/Plan。相应文档更新留在 working tree。Kimi doctor 在 `/tmp/jianji-m5d-git-doctor` 仍 exit 2 /BLOCKED_CAPABILITY、qualified=false、project_access=false、SANDBOX_IMAGE_UNAVAILABLE，无 upstream 请求；不借 subagent 绕过 Git 权限。

顺序固定为：恢复授权 Git 写能力 → 四个 D contract/prototype 路径独立提交 → D1 Production Full-Decode Census → D2 Semantic Review Session + Acceptance → D3 Multi-target/Multi-segment Mask Proof → D4 Opaque FullSourceAdmissionHandle → 才回到 C。D1 只产出全解码 census/digest，不签发语义、mask 或全源准入 authority；D2 每帧审阅所有可见旧贴纸的完整 T(f) 或 UNKNOWN；D3 不支持 static V1 的目标仍留在穷尽集合并导致 V1 UNSAFE；D4 才在全部证明和 freshness/dispute 通过后提供私有 capability。Git 前置门未解决前，D1 production 不开工。placement、C 成功 issuer、B activation 和 renderer 均不修改。
