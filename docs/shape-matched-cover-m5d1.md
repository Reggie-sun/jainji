# M5-D1 — Production Full-Decode Census

## Scope and Checkpoint

2026-09-28 按用户要求先将 D contract/prototype 四路径独立提交为 `ab28ea2`，fresh 151 tests 与 typecheck PASS 后开始 D1。实际 Git operation 成功取代此前 mount 诊断作为当前写能力证据；没有删除 lock、改权限或 remount。D1 与该提交分开保存，保留其他任务 staged/dirty 和用户项目文件删除。

D1 实施 canonical deterministic census，状态为 `CENSUS_IMPLEMENTED / SEMANTIC_AUTHORITY_BLOCKED / PRODUCT_DISABLED`。输出固定 `authority=none / semanticReview=NOT_EVALUATED / eligible=false`。完整 M5-D 尚未成立；不增加 C 成功 issuer、placement、产品入口接线、知识持久化、schema migration 或 FullSourceAdmissionHandle，不修改 M4 authority、M5-A renderer 或 M5-B guard。

## Canonical Owners

[source-fact-census.ts](../src/main/source-fact-census.ts) 的 `collectFullSourceCensus` 独占 source pre/post verification、命令执行、原画布 RGBA 流式 SHA 和 frozen census digest。[source-fact-census-clock.ts](../src/main/source-fact-census-clock.ts) 的 `parseFullDecodeClock` 严格验证每条 probe/packet 记录，不使用已有 SupervisorEvidence 的抽样与 malformed-record 过滤路径。纯 clock parser 不签发任何 authority。

入口仅接主进程可信 engine dependencies、sourcePath、严格 SourceIdentity 与 AbortSignal；未提供 IPC、UI、模型或 caller PASS/complete 字段。SourceIdentity/sourceKey 复用现有 knowledge owner。[paths.ts](../src/main/paths.ts) `fingerprintFile` 和 [source-sticker-knowledge-store.ts](../src/main/source-sticker-knowledge-store.ts) `identifySource` 仅增加 optional signal/maxBytes，沿用同一 SHA owner、算法、默认调用及 identity 格式。hash 等待读流 close 后才结束；取消或超额不返回部分 SHA。

## Exact Clock and Interpretation

首个 `full-decode-rgba-v1` profile 限定 FFmpeg MOV-family demuxer 的 H.264、interpretationVersion=1、rotation=0、square pixels、progressive 8-bit SDR；固定原尺寸，拒绝 decode crop、未知 display side data、HDR、动态 pixel/color interpretation 和不支持的 schema。缺失 color metadata 明确记录为 unknown，并绑定实际 engine bytes/profile，不推断语义或色彩信息。此 profile 不是所有容器/codec 的通用 census。

分别完整读取 frame 和 packet metadata，均使用 `-fflags +nofillin -err_detect explode`。每条 frame 必须有原 pts、相等的 best_effort_timestamp、明确正 duration、packet position/size；packet 必须有原 PTS/DTS/正 duration/position/size。所有 frame 与 packet 数量相等，以唯一 position、PTS、duration、size 建立一对一绑定；不按 packet 枚举顺序推断 B-frame 显示顺序，不丢弃 malformed record。

每帧 `[pts,endPts)` 精确连接下一帧；首 PTS 等于 SourceIdentity.timeOriginPts，末 endPTS 等于明确 stream start+duration。加法与时基一致性使用 BigInt，拒绝溢出、缺口、重叠、未知尾帧、重复/遗漏 packet。SourceIdentity.durationMs 仅检查既有 rounded metadata 在 ±0.5ms 内一致，不能延长任何帧或覆盖区间；不读取 nominal FPS，不估算末帧 duration，不用 best_effort_timestamp 替代缺失原 PTS。

## Full-Canvas Bytes and Binding

实际 CPU FFmpeg 使用 `-hwaccel none -noautorotate -copyts -fps_mode passthrough -enc_time_base demux`，映射经核对的视频 stream，输出原尺寸 RGBA rawvideo 到 pipe。不提供 scale/select/fps filter、帧数截断、去重、ROI、模型、mask 或 contour 分析。相同像素的不同 ordinal 仍保留为不同帧。

流式按 width×height×4 分割每帧，全部字节参与 SHA；完整帧数及 byteLength 必须与 clock 对应。少帧、余帧、残帧、非零 exit 或 `-v error` 下的任何 stderr 都拒绝，不返回 partial census。取消和 wall budget 停止子进程并等待 close，不以发出 kill 代替进程退出证据。

源文件在前后通过既有 identifySource 完整 SHA 重核；全操作绑定 dev/ino/size/mtimeNs/ctimeNs，恢复原字节但 generation 改变也拒绝。FFmpeg/FFprobe 普通文件 SHA 在前后重核并进入 digest。返回 source、decode/profile/engine SHA、horizon、逐帧 ordinal/PTS/endPTS/byteLength/pixelSha256 和 censusDigest，全部 deeply frozen，不保存本地路径或可恢复许可。

固定 budgets：source 16GiB、单 engine 512MiB、frame/packet metadata 合计 64MiB、最多 100,000 帧、单 RGBA 帧 64MiB、总 raw bytes 512GiB、全操作 10 分钟；每边不超过 8192px。metadata/hash/raw decode 都有取消与相应限额。超额、工具缺失或 profile 不支持均 UNSAFE，不抽样降级。固定限额是第一版支持边界，尚无真实长片成本/批量性能验收。

本层只保留 census hashes，不托管逐帧图像或签发审阅 receipt。D2 必须重新获得并核对相同 census/profile 的原画布证据后审阅；只有 SHA 不能宣称审阅端已经显示该帧，更不能生成 verified-no-sticker interval。

## Executable Evidence

[source-fact-census.test.ts](../tests/source-fact-census.test.ts) 共 64 项：纯 clock 的缺首/中/尾、坏记录、原 PTS 缺失/推算、duration 冲突、gap/overlap/未知尾、source/interpretation/HDR/crop/SAR/interlace、packet 关系、overflow/quotas；真实 CPU lossless CFR 6帧、VFR 3帧，以及实际 H.264 B-frame fixture。逐帧 SHA 与另一次完整 raw decode 比对，重复像素仍保留 ordinal，重跑 digest 一致，返回结果冻结。VFR 精确 duration 为 2000/3000/1000 ticks，不按平均 FPS 补齐。

负例验证初始源漂移、末端源漂移、恢复相同字节但 generation 改变、末端 engine SHA 漂移、损坏媒体、缺引擎、非普通 engine 文件、取消、probe quota、raw 短/长/残帧、stderr 和非零 exit。模拟失败进程均在 reject 前 close；真实解码和模拟故障分别标注，不将模拟 fixture 当作真实 OS 超时/设备故障验收。既有 hash 无参数调用仍返回同一 SHA；新 optional byte budget、非法 budget 与 in-flight hash cancellation 有独立测试。

新增 hash budget 测试曾在原 owner 未实现 options 时两项失败（`/tmp/jianji-m5d1-hash-red.log`），实现后通过；最初缺新模块造成 suite load fail 不称为 production regression。使用 tests/setup-ffmpeg.ts 选定的应用 engine `n8.1.2-52-g5a03dfa0f6-20260912`，不把 PATH 的旧版本当作同一解释。

最终相关回归、typecheck、snapshot 与 completion gate 见下节；合成短片不是用户真实媒体、人工完整语义审阅、整片遮盖效果、Windows 或 M5-E 验收。

## Verification and Governance

直接相关回归 fresh exit0：12 files /261 tests PASS、0 failed /0 skipped，包含新增 D1 64 tests、D prototype、knowledge/store/实际 FFmpeg knowledge integration、mask、C/B/controller、queue/compiler/store。完整命令为 `npm run test -- tests/source-fact-census.test.ts tests/source-fact-completeness.test.ts tests/source-sticker-knowledge.test.ts tests/source-sticker-knowledge-store.test.ts tests/source-sticker-knowledge.integration.test.ts tests/source-mask-admission.test.ts tests/shape-cover-request-assembler.test.ts tests/shape-cover-activation.test.ts tests/agent-controller.test.ts tests/queue.test.ts tests/compiler.test.ts tests/store.test.ts --maxWorkers=4 --minWorkers=1`（外层 120s timeout），日志 `/tmp/jianji-m5d1-verified-related.log`。这是受影响范围验证，不是 full suite。

较宽回归包含 shape-cover-candidates 时卡在既有 fixture 的同步 rawvideo→PNG 命令，最终中断；独立该测试的有界运行 exit124。临时 trace 显示 source SHA 已完成、尚未进入 freeze；不加载任何 D1 code 的独立 Node spawnSync 使用同一 app FFmpeg/raw RGBA/单 PNG 命令也得到 ETIMEDOUT，添加 nostdin 或单线程不能解决。复制到独立临时目录的既有 fixture 在普通 Node 下调用当前 compute/freeze 均 PASS；这区分了 source hash 行为与 fixture 命令阻塞，但不替代未完成的整个 shape regression。记录 `/tmp/jianji-m5d1-shape-diagnosis2.log`、`/tmp/jianji-m5d1-trace.log`、`/tmp/jianji-m5d1-debug.log`；仅有界诊断，不修改 frozen shape test/renderer，也不将失败的临时 engine wrapper 算作通过。

全项目 typecheck 最初在本轮源候选上 exit0，后因其他 writer 新增的 `src/main/batch-production-runtime.ts:62` 的 BatchProjectOption.mode optional 类型失配出现 exit2；最终再次 `npm run typecheck` 仍 exit2。该文件不属于本轮，不接管修复。D1 owned source/tests 及其 transitive dependencies 的临时 scoped tsc 配置 exit0（`node_modules/.bin/tsc --noEmit -p /tmp/jianji-m5d1-tsconfig.json`，日志 `/tmp/jianji-m5d1-scoped-typecheck.log`）。全项目日志 `/tmp/jianji-m5d1-typecheck-final.log` 的失败不能用早期或 scoped PASS 覆盖。当前仅保存候选，完整 gate 仍受全项目 typecheck、旧 shape fixture 回归及 AOCI 维护阻断。

稳定源码 SHA：

| Path | SHA256 |
| --- | --- |
| src/main/source-fact-census.ts | 4c590e47ca0697e3aabffc8a9770f91985d60c0a904a8f1fd217fb571c694609 |
| src/main/source-fact-census-clock.ts | edac94e80e4fde83202e8af9f85d6deec76a4c503125bdb6c5f70a294f77cfca |
| src/main/paths.ts | f054b91f584dee44c6199e30581abc2bd37663f9d0c1d65e17bef668ff3488f3 |
| src/main/source-sticker-knowledge-store.ts | 35d60b2f45cb65acf344ab9f9caf987f5f7710a7c01cb0c178a9cb3924958900 |
| tests/source-fact-census.test.ts | d0c0b9ae3b2d3e1afbb364b60164378dc412702324dc433f49c71e24a9db7596 |

Parent final diff 对照 Spec/既有 Plan/D contract、逐帧时钟/全部字节/源 pre-post identity、取消、兼容及 scope，按上述 exact source/test SHA 判断 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求此 snapshot 独立 reviewer；新增 owner 没有 production consumer、语义成功、私有 handle、知识写或发布权限，不存在严重跨项目越权/不可恢复持久损坏路径。hash 的 optional bounds 不改变原 digest/default caller 合同，并有 legacy SHA、knowledge/mask/queue 回归。完整语义及产品准入缺口始终 blocked，旧 fixture 阻塞尚未解决但独立无 D1 code 命令可复现，不以 reviewer 代替运行问题；没有具体重大后果与 Kimi 可填补实质语义缺口的组合证据。不叠加 native reviewer，最终 gate 限制如实保留。

冻结文件 SHA 与进入本轮前相同：C assembler=`9d0f0f1ce7384e90d572d98a58b413cfd65e9ed33468f4e58d790a8517b881bd`、B guard=`c9376550656efc78da113de420d8e76530c703fc40d15ef950777d87fe094cb6`、A renderer=`15e307dedb8698900a22d4b0db4ecfb7383a413bd4a7a08d074f4fdc35838da7`、M4 shape fixture=`997def30786e2c49a6568b198a2fc8ceb960dec58d65bd841ded4a88a07732f7`。

CodeGraph relationship 与 AOCI rules/maintain 实际返回 `MCP tool call requires approval, but approval policy is never`，未得到 fresh graph 或官方索引批次，不宣称索引 aligned，不旁路调用或混入其他任务 staged 索引。AOCI 增量维护是剩余治理 blocker。

按 standing route 读取 external-subagent skill/SUBAGENTS 后，managed Kimi doctor 在 `/tmp/jianji-m5d1-subagent` exit2 /BLOCKED_CAPABILITY；containment qualified=false、project_access=false、adversarial_containment_not_qualified，Docker SANDBOX_IMAGE_UNAVAILABLE。没有 upstream 请求、没有外部调查或 reviewer 结果，不直连 provider 或换 route。

Session-record 评估：本轮有 substantive production source 与真实 decode 证据，使用本 milestone 及既有 Plan 保存 record；没有 repository 专用 capture skill，不另建生命周期 owner。D1 source checkpoint 可以单独提交；因索引维护能力仍被拒绝，不宣称本阶段所有治理 gate 收口。

## Remaining Gates

D2 逐帧审阅所有可见旧贴纸的完整 T(f) 或 UNKNOWN，必须建立合格原画布 session/acceptance；未审阅与不确定不能写空集合。连续明确空集合帧才能形成 verified-no-sticker interval。D3 验证统一 revision 下全目标/全活动 segments/masks；moving/animated/无法静态 mask/身份不确定目标必须保留，导致 V1 UNSAFE。D4 才在全部事实、方法、mask 与 freshness/disputes 成立后私有签发 FullSourceAdmissionHandle。未通过这些门不回 C 签发，不改 B 默认关闭；E 仍独立验收真实批量效果、平台与性能。

## Checkpoint Recovery — Fixture Input EOF

用户要求先清理工程 blockers，不进入 D2，也不改 D1。候选 `d2f80db` 中上表五个 source/test SHA 全部保持不变。此次只修复既有 shape fixture 的 raw RGBA 输入交付和记录实际 fresh gates，不能自动提升 semanticReview/eligibility、生成 no-sticker interval 或给 C 增加 issuer。

根因调查采用当前 Node v22.21.0 /libuv 1.51.0 和同一 app FFmpeg，不加载 D1 code。单进程串行对比，所有案例独立临时文件，原始 RGBA 均为 32×32×4=4096 bytes；捕获 stdout/stderr，分别比较 input pipe/file、spawnSync/异步 spawn、output file/image2pipe。结果：

| Launch and input | PNG file output | PNG pipe output |
| --- | --- | --- |
| spawnSync + Buffer stdin | 2500ms ETIMEDOUT，PNG 已写出 | 2500ms ETIMEDOUT，PNG 已读出 |
| spawnSync + finite RGBA file | 13ms exit0 | 11ms exit0 |
| async spawn + stdin.end(Buffer) | 15ms exit0 | 10ms exit0 |
| async spawn + finite RGBA file | 10ms exit0 | 12ms exit0 |

同一种输出方式下，超时产出的完整 PNG 与正常退出 PNG 的 SHA 相同：file=`c57ed0cbf436eee7503df524c77146766a266e765116742f7dc4f4a7cf52fd0c`、image2pipe=`d89e921ae123a8ab6e3ff1eaf6ff4183e9d01e6a23feb90e65ae5f63f1baea15`。因此超时不是画面生成失败，也不是 stdout/stderr backpressure：file output 仍超时，pipe output 已被读出且量很小。fixture 临时路径及输出句柄不是区分条件；每个串行案例的资源与输入尺寸相同，没有并发/GPU 前提。此前添加 nostdin、input/filter threads 都未解决；不能以这些参数猜测修复。

独立 Node `spawnSync('/bin/cat', [], {input: Buffer.alloc(4096), timeout: 1000, killSignal: 'SIGKILL'})` 已输出全部4096 bytes，但仍 ETIMEDOUT；wc 同样等不到 stdin EOF。更直接的有限诊断让 Python child 将 fd0 设为 nonblocking 后读取250ms：同步 child 已读4096 bytes，却 `eof=false /wouldBlock=25`；异步 stdin.end child 为 `eof=true /wouldBlock=0`。这将稳定归因收敛到**当前 runtime/sandbox 下同步 stdin 的 EOF 交付边界**，不是 Vitest worker 或 shape 函数。FFmpeg 已完成编码/写出，但其输入生命周期未正常结束，不能把磁盘 PNG 存在当作 child 成功。

strace 被 PTRACE_TRACEME EPERM 拒绝，直接 AF_UNIX socketpair 也被环境拒绝。尚不能区分 Node/libuv 内部实现与当前 containment 的具体 syscall 原因；不声称所有 Node v22 环境都有该问题，不旁路 ptrace/网络权限。上游 host/runtime 修复不是当前 scope。可重复本地证据保存在 `/tmp/jianji-png-matrix.mjs`、`/tmp/jianji-png-matrix.log`、`/tmp/jianji-stdin-eof.py`、`/tmp/jianji-stdin-eof.mjs`；这些是诊断 artifact，不进入 production 或 Git。

最小修复在 `tests/shape-cover-candidates.test.ts` 两处 PNG fixture：将原 pixels 先完整 writeFile 到 fixture root 的 `.rgba` 文件，再让真实 FFmpeg 按相同尺寸/格式读取有限文件；stdin 显式 ignore，保留原 encoder/PNG 输出，不改变形状算法、mask、选款、admission、compiler、queue 或 renderer。command 加10s timeout/SIGKILL，并断言无 spawn error 及 exit0，防止成功写文件但 child 未退出仍算通过。RGBA 文件归原 root 所有，由现有 afterEach 清理，不新增用户素材或跨 fixture 共享句柄。

原首个 symlink 测试 fresh red 为15s有界 timeout/exit124；修复后同一测试1项 PASS（其余100项按 filter skipped），fixture约466ms，整个run1.48s；这只证明原卡点恢复，不能冒充整个 regression PASS。证据 `/tmp/jianji-checkpoint-fixture-red.log`、`/tmp/jianji-checkpoint-fixture-green.log`。整体 gate 以实际完整回归终态为准。

首次整个 shape 回归100项 PASS，另1项 restart child JSON 为空，仍为 suite FAIL（`/tmp/jianji-checkpoint-shape-regression.log`）。没有修改生产 reconcile；独立 Node child 用 writeFile marker 证明已经执行，比较 sync/async × stdout pipe/file：两种 launch 的 pipe stdout 均为空、file stdout 均得到 `child-result`，全部 exit0。直接 fd write 可被 pipe 捕获，JS stream/console 则未被捕获，故不是“reconciliation 没跑”或任意 JSON/authority failure 的证据；stdio 输送异常不能被 exit0 隐藏。尚无权限检查 syscall 路径，因此只记录当前 runtime 的可复现 transport 边界，不推定全平台 Node 缺陷。

restart fixture 只将 stdout/stderr 接入普通文件，10s有界 spawnSync 后关闭两只 FileHandle，再校验 spawn error、exit0 和完整结果 JSON。观察文件保存在单独 `shape-restart-observation-*` 临时 root，归 harness 所有并由现有 afterEach 清理；它不在 artifact/canonical JobStore/输出/custody tree 内，不是 publication receipt。原 `fileSnapshot(value.root)` 前后相等、无 receipt 写入、authority=none、never republish、零 render/reviewer 二次调用全部保留。独立 Node/esbuild 重启仍真实执行，没有 mock reconciliation 或将 UNKNOWN 改 PASS。该测试单独 fresh1项 PASS（约1.99s）；证据 `/tmp/jianji-restart-diagnosis.log`、`/tmp/jianji-restart-green.log`。此次执行的 child script 与原实现相同，临时 timer/trace 调查代码已移除。

本轮重新按 standing route 使用 external-subagent skill 检查 managed Kimi；`/tmp/jianji-d1-checkpoint-subagent` doctor 仍 exit2 /BLOCKED_CAPABILITY，未发 upstream request。CodeGraph/AOCI rules、Maintain 实际仍返回 requires approval /policy never；不能获取后续 Verify/Check/Guide 的合格结果，不使用 CLI 旁路，不改其他任务 staged 索引。治理 gate 保持 blocked，不能正式标 M5-D1 PASS。

## Fresh Recovery Gates

共享树其他 writer 已提交 batch 工作 `845f914`；本轮 source freeze 与测试范围在该检查点上核对。D1 source/test 五个 SHA 与 `d2f80db` 及上表一致；A renderer、B guard、C assembler SHA 也未改变。仅 shape fixture 的测试文件 SHA 更新为 `8e4fe433811e7b39911991679c0b5dac98e89585f45741bae20d579317d4ae0d`，对应 PNG 输入与 child stdio 的 harness 修复，没有 production source 修改。

| Gate | Fresh result and evidence |
| --- | --- |
| npm run typecheck | exit0，`/tmp/jianji-checkpoint-typecheck-final.log`；此前其他 writer 的类型错误已消失，本轮未接管该文件 |
| D1 related tests | 12 files /261 tests PASS，0 failed/0 skipped，15.98s；`/tmp/jianji-checkpoint-d1-related-final.log`，同上述 related 文件列表，maxWorkers=2/minWorkers=1 |
| shape-cover-candidates regression | 1 file /101 tests PASS，0 failed/0 skipped，160.64s；`/tmp/jianji-checkpoint-shape-final.log`，maxWorkers=1/minWorkers=1，外层300s有界，不放宽单项测试 timeout |
| git diff --check | 全共享树 exit0；只提交本轮三路径，其余 staged/dirty/用户删除保留 |
| full suite | 未运行；当前 AGENTS/Plan 的 D1 与本次 test-only recovery 合同要求 typecheck、受影响测试及相关制作/导出集成，已执行上述362 tests。历史 M4/M5-A 的全套要求不自动升级本次 scope；不声称 full-suite PASS |
| AOCI Maintain / Verify / Check / Guide | BLOCKED：rules/Maintain 调用被 approval policy=never 拒绝，没有合格后续 evidence，也不宣称 governance aligned |

Parent final diff /Implementation Review Risk Gate 对此 exact fixture SHA 与 unchanged D1 SHA 判定 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求独立 reviewer；仅 test harness stdio/临时文件改变，无 publication/knowledge/production authority 或不可恢复状态写；真实同字节发布、独立进程只读、UNKNOWN/never republish 与全部原 assertion 均有完整 regression PASS。没有具体重大 consequence 与 reviewer 可补实质缺口的组合；runtime 最底层 syscall 原因与治理能力限制如实记录，不由 reviewer 投票替代。

Session-record 本次仍使用既有 milestone/Plan，保存复现、单变量矩阵、首轮失败、新暴露的 child transport 问题、修复及 final gates，不创建第二 owner。scope 仅工程恢复；状态为 `ENGINEERING_VERIFIED / GOVERNANCE_BLOCKED / SEMANTIC_AUTHORITY_BLOCKED / PRODUCT_DISABLED`。AOCI 合同恢复并完成官方维护/校验前，不正式标 M5-D1 PASS，也不开始 D2。D1 只证明全像素枚举，未生成任何 no-sticker interval 或 exhaustive semantic acceptance。

## AOCI Capability Diagnosis — 2026-09-28

用户要求修复 AOCI。本轮只调查调用能力，不改冻结 D1、renderer、B guard、C issuer 或他人 staged/dirty 索引。五个 D1 source/test SHA 与上表逐字节相同；没有重新运行或扩大 production gate。

当前 `/home/reggie/.local/bin/aoci` 为 `0.1.0-rc14`、commit `92c78bc48a3e431ff8ae67fabb05270cc7129fe7`。CLI Doctor exit0，配置加载成功，索引解析为166条目、0警告，baseline 与 Codex 注册存在；`capabilities --json` exit0，声明 volumes-v1 与9个 MCP tools。这只是安装/配置/解析证据，不证明 active MCP 调用、freshness 或 governance aligned。该版本 `status --deep --json` exit3，报兼容路径不支持 Volumes v1；不把此命令当作 Verify/Check/Guide，也不因此重建索引。

真实 `aoci_rules` 与 CodeGraph `list_file_entities` 均返回 `MCP tool call requires approval, but approval policy is never`。两个不同服务在相同宿主审批层被拒绝，未取得服务器执行结果；这不是已证明的 AOCI 索引损坏。项目 `.codex/config.toml` 的 AOCI command/args 正确，项目信任为 trusted，没有显式 server/tool approval override。本地 Codex 源码 `codex-rs/core/src/mcp_tool_call.rs` 的 request approval 分支在 `AskForApproval::Never` 时返回同一错误；该源码 checkout 只是分支解释线索，不冒充当前 daemon 的 exact build/annotation 证明。

当前 runtime 强制 approval policy=never，并将项目 `.codex` 与全局配置路径设为只读；没有可用的会话策略修改/重连工具。修改 `.aoci/config.json` 的 managed-scope approval 不会修复这层宿主拒绝。本轮未将工具改成自动批准，未通过直接 stdio/CLI 调用被拒绝的 rules/Maintain/update 操作，也未启动绕过当前权限的另一个 Codex。外部 Kimi 调查 preflight `/tmp/jianji-aoci-repair-subagent` doctor exit2，containment 未合格、Docker image unavailable、零 upstream request；Parent 保留诊断与裁决。

恢复需由宿主端允许正常审批，再恢复此会话。CLI `codex resume --help` 已确认可用的形式是 `codex -C /home/reggie/vscode_folder/jianji -s workspace-write -a on-request resume`，从 picker 选择此任务；此命令是用户在宿主执行的下一步，本轮没有运行，也没有证明 launcher 是否还会覆盖策略。桌面宿主应使用对应的会话权限设置。保持 sandbox，不关闭审批；若 managed host 继续覆盖为 never，必须由该 host 的 policy owner 处理。

恢复后的验收仍需真实官方 `aoci_rules` 成功、稳定源码快照及索引 ownership 核对、完整 Maintain 批次、Verify/Check/Guide 与 scoped commit；不能用 Doctor 的 PASS 替代。当前只完成诊断，AOCI 修复与 D1 formal PASS 仍 blocked。Session-record 使用本 milestone；documentation-only 风险不触发额外 implementation review，未改任何 production authority。
