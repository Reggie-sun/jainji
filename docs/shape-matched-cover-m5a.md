# M5-A — Frozen Layer Renderer Switch

## Scope and Decision

从 B7 提交 `1fda2b9` 后的 HEAD `bf01b95` 开始。HEAD 中三个 B7 owner、原测试、Spec、Plan 的 SHA 与 B7 Candidate Identity 一致。用户本轮明确选择 A：保留现有发布合同，补 renderer 校验与端到端 same-bytes 证据。

源码纠正了“新 shape 路径仍用白底”的前提：M4-B2 已有 `shape-matched-frozen-rgba-v1` 编译分支，B3/B5/B6 正式发布的是该分支生成并批准的原样片。本轮收敛这条现有路径，不增加准入后重编码或渲染前的新 custody 合同。M5-A SCOPED_COMPLETE；此前全局真实 NVENC gate 的环境限制已由下文冻结候选上的 fresh gate 解除。

## Source Findings

| Question | Verified owner / behavior |
| --- | --- |
| 谁设置白底 | `cover-sticker.ts / coverLayerForMedia` 为原矩形覆盖设置 `opaqueBackground: true`；`prepareAgentTemplate` 在存在 shapeCoverLayers 时跳过它。 |
| 谁生成矩形 | `compiler.ts / TemplateCompiler.compile` 的非 shape cover 分支使用白色 pad/lutrgb；shape 分支在它之前直接 overlay 最终 PNG。 |
| 版本边界 | `FrozenShapeCoverSchema.strategy=shape-matched-frozen-rgba-v1`；模板 schema 禁止该层同时使用 opaqueBackground、变更位置/透明度/轨迹或被隐藏。 |
| 样片输入 | `ExportQueue.executePreview` 调用同一个 compiler，写入其 binaryFiles，再启动 FFmpeg；编译输入是冻结 PNG 字节的任务副本，结束后清理。 |
| 冻结位置 | freeze owner 将全输出画布 PNG 无覆盖写到本次独占目录；B5 capture 随后归档全部候选、模板 layer 和已批准 sample 到主进程固定 custody root。 |
| 安全托管路径 | B5 loadManifest 核对完整资源集合、hash/大小/规范目录后，load 返回重定位 template 的 `.bin` 路径，始终 authority=none；renderer 根据内容和绑定读取，不依赖扩展名。 |
| 正式输出 | ShapeCoverProduction → ArtifactStore.publishOnce → 原 Queue.publishApprovedSample；复制托管的原样片并验证正式字节，不再次调用 compiler/FFmpeg 编码。 |
| 其他渲染入口 | 原队列普通 execute 也使用同一个 compiler，但普通 shape create/append/retry/replay 仍在 assertShapeCoverExportReady 被拒；没有添加第二 renderer。 |

CodeGraph 重新索引并查询 readFrozenShapeCover、ExportQueue.executePreview 和 ExportQueue.publishApprovedSample，结合 rg 和源码核对。图中短名 open/read/resolve 有误归到无关 uploader/account 方法的边，不能将它们当作真实 receiver 调用。结构结论以当前源码和可执行证据为准。

## Change and Identity

只修改 `shape-cover-render.ts` 的文件读取：复用 B5 `inspectArtifactFile` 的 O_NOFOLLOW/O_NONBLOCK、普通文件检查、字节上限、循环读/SHA 和读取前后大小/mtime 检查，保留原 source/settings/projection/bindingSha256/PNG fingerprint/尺寸校验。读取失败统一 UNSAFE，不回退白底、bbox、其他贴纸或 regenerate。

renderer 不读取候选 alpha，不做 dilation、morphology、candidate selection、source-mask inference 或 coverage；M4 admission 的重新核验仍由原 owner 执行。现有策略和 B5 request/key/template digest 保持唯一身份链，不加字段、不改变序列化版本、不恢复 handle。manifest、永久 intent、receipt、UNKNOWN→authority=none/never republish、canonical Queue/JobStore 均未改。

冻结生产链实际为：freeze PNG → 原 queue/compiler 样片 → 独立安全准入 → B5 custody PNG/sample → publish-once 同字节正式输出。这里“正式 renderer 消费同一图层”的证据来自正式发布原批准样片；没有宣称 final export 另有一次从 custody 重渲染。load 的重定位 layer 可被同一读取函数校验，不获得新的发布许可。

manual、assisted、legacy、历史冻结任务、非 shape 的矩形/透明解释保持原分支；未改 compiler、domain、cover-sticker、Controller/runner、queue、store、admission 或 candidates。

## Executable Evidence

新增三项真实 FFmpeg fixture 测试：

- 原实现接受指向相同 PNG 的 symlink，red reproduction 失败；新读取拒绝为 UNSAFE。缺失冻结文件也明确 UNSAFE。
- canonical admitted-mask、真实冻结轮廓、明确标记为模拟的独立 reviewer，完整经过原 queue 样片和 B5/JobStore 发布。
- FFmpeg.run 启动时读取其实际 shape 输入文件，与 compiler Buffer、binding.pngSha256、archived layer fingerprint/SHA 相等；review payload 引用同一 PNG，canonical template 等于 manifest template。批准 sample、custody sample、正式输出 SHA 相等；publish 前后 compiler 与实际 shape 输入均只有一次。
- 蓝色源背景中，placement 内但 contour 外的像素仍为蓝色，覆盖目标像素变成贴纸；graph 无白底 pad/lutrgb、shape 缩放/crop/fade，排除矩形回退。托管重定位 layer 可读出同一 PNG；reconcile 返回原 completed identity 且 authority=none。

沿用既有 shape 测试的字节/源修订/设置/模板/未知版本/取消/损坏/重启/unknown 拒绝，以及旧矩形兼容测试。该 fixture 的合成源审核 receipt 与模拟内容安全只证明机制；不是用户素材、真实语义 reviewer 或人工全片验收。

## Fresh Verification

已读取并执行 `superpowers:verification-before-completion`。稳定源码结果：

| Check | Result |
| --- | --- |
| Targeted new tests | 3 PASS；真实 symlink red→green |
| `npm run typecheck` | exit 0 / PASS |
| Related shape/mask/pixel/compiler/legacy/queue/store/migration | 8 files / 169 PASS，128.59s |
| Full suite, four workers | 136 files PASS / 1 failed / 1 skipped；1287 PASS / 1 failed / 3 skipped，132.90s |
| Full-suite failure | `tests/gpu-export.integration.test.ts` 真实 NVENC 测试 30 秒 timeout；不是全套 PASS。 |
| Isolated NVENC recheck | 单 worker 同一测试再次30秒timeout，exit 1；未放宽超时或改变设备进程。 |
| Source stability | 全套前后315个src/tests/config SHA不变，HEAD不变；保留原本地随机/UI dirty 工作及两个用户删除。 |
| AOCI maintenance | 官方完整单项批次 `781ece3f37ebe7d9199e6ca4afd7d9e53ea189b7dd1539e5ed5a78e26803265e` apply 1/1，remaining=0，findings=0。 |
| AOCI final proof | Verify / Aggregate Check / Guide 均 exit 0；164 sources / 164 entries，aligned / complete=true / next_action=none。 |

NVENC timeout 时 GPU 约31.2/32.6GiB占用；后续独立检查可用显存699MiB。设备上存在本任务之外的 VLLM 进程和桌面渲染。原队列保留512MiB，单个NVENC任务至少估计768MiB，当前内存证据与等待设备资源一致；未取消这些进程、修改NVENC逻辑或放宽测试超时，不将相关shape软件FFmpeg的通过冒充真实GPU验收。日志在 `/tmp/jianji-m5a-{related,full,typecheck}.log`，源码快照为 `/tmp/jianji-m5a-verification-snapshot.json`，它们仅为本机核验材料。

## Snapshot, Review and Boundaries

| Path | SHA-256 |
| --- | --- |
| src/main/shape-cover-render.ts | 15e307dedb8698900a22d4b0db4ecfb7383a413bd4a7a08d074f4fdc35838da7 |
| tests/shape-cover-candidates.test.ts | 997def30786e2c49a6568b198a2fc8ceb960dec58d65bd841ded4a88a07732f7 |
| docs/shape-matched-cover-plan.md | aee73f27fef9fabad87fbb285a130430c6f0da69720ac79c887d9853a3427c09 |

Spec SHA 保持 B7 的 `b2bf7538f4ee54a5ab68b8cbd156c3026385f90b47cdbe7302448a35a08a26e2`。Parent 完成 plan Self-Review、源码与最终 diff 审查。

全套结束后另一任务提交 `a31e3db`，只修改 `docs/qianchuan-cdp-test.md`。最终再次核对315个源码/测试/config字节及文件集合均无变化，验证仍匹配当前实现；保留该文档提交，不接管其内容。本轮继续在current main限定提交，无worktree。

按本轮 global standing route 使用 [external-subagent](../../../.agents/skills/external-subagent/SKILL.md) 受管 Kimi deep 只读核查，invocation `7a007c6f-2439-41a9-985f-4eb6899bdc7a`。Doctor 的 Docker/native containment 通过；canonical qualification `9c489879-bf37-4f39-9437-367f10b8ec68`，5次请求 mechanically observed K3/max。但调用期间 Parent 修改了已封存的 plan/源码，receipt 为 SOURCE_CHANGED、observed_reads=[]，报告不被采用，不宣称独立核查成功，不自动重试。它不是产品 reviewer 或 admission authority。

相关project-native gate后，Parent对上述稳定候选判定 `KIMI_REVIEW_NOT_REQUIRED`：用户未要求该snapshot的Kimi review；只复用只读IO并增加证据，没有凭据、跨项目许可或durable-state修改/恢复/发布语义的关键级破坏路径。hash、symlink、真实合成/托管/发布链已有执行证据；全局NVENC设备资源缺口不会被adversarial源码review解决，因此不触发“重大后果+实质验证缺口+独立增益”的组合条件。无required review blocker；不把失败的Kimi报告算作验收。

已评估session-record要求；本仓未声明独立capture skill，本milestone保存实际证据与限制。未接IPC/UI、未激活默认自动覆盖、未设计新contour/coverage、未做真实产品模型/内容安全、全片mask、Windows、掉电或人工观看验收。只提交本轮renderer owner、测试、plan、本记录及官方两个AOCI文件；旧任务和无关dirty不接管。此前遗留的全局NVENC gate已补验，见下文。

## Frozen Candidate NVENC Closure

用户明确要求冻结 M5-A candidate、不再修改 shape 代码，授权清出 GPU 资源后补最后一个 NVENC fresh gate。实现候选保持提交 `746bb51`；上表 renderer、shape 测试与 Plan SHA，以及 Spec SHA 均未改变。本次只更新本记录，不修改源码、测试、超时或 GPU 准入逻辑。

核对 GPU 进程的 PID、父进程和 cgroup 后，确认约 25 GiB 占用来自用户级 `jianji-qwen3-vl.service`；服务监听 localhost:8000，检查时未发现活动 TCP 连接。通过 `systemctl --user stop jianji-qwen3-vl.service` 正常停止，核验 inactive/dead、MainPID=0。可用显存从 1009 MiB 增至 26254 MiB；保留桌面及其他 FFmpeg 进程。服务保持停止，可由用户通过 `systemctl --user start jianji-qwen3-vl.service` 恢复。

重新读取并执行 `superpowers:verification-before-completion`，运行：

```bash
npm test -- tests/gpu-export.integration.test.ts --maxWorkers=1 --minWorkers=1
```

2026-09-28 本地 00:32:44 开始，exit 0；1 file / 1 test PASS，0 skipped，测试 10.00s、总计 10.86s。真实 `h264_nvenc` 完成 6 个队列导出，验证各正式文件唯一、completed、无错误，H.264 / 640×360、音轨存在、时长至少 1900ms。不是硬件能力不足后的 skip，也不是软件编码替代。

日志为 `/tmp/jianji-m5a-nvenc-fresh.log`，测试前快照为 `/tmp/jianji-m5a-nvenc-fresh-snapshot.json`。fresh gate 前后 315 个源码/测试/config SHA 全部一致，HEAD 仍为 `746bb51`。相比上一轮全套快照，另一任务已修改 `tests/helpers/douyin-cdp-fixture.ts` 和 `tests/qianchuan-page-contract.test.ts`，本次未修改或接管；它们不参与本 gate。没有重跑或宣称当前所有无关工作上的 full suite PASS；此前全套唯一失败项在冻结 M5-A 实现上现已单独通过。

M5-A 的相关 shape gate、typecheck、same-bytes 证据和最后一个 NVENC gate 均已满足，限定阶段可以收口。该 NVENC 测试证明原队列真实 GPU 导出，不另行声称 shape fixture 使用了 NVENC；也不代表整个 Shape-Matched Cover V1、Windows、真实语义模型或人工播放验收完成。本次属于冻结候选上的资源释放与现有 gate 执行，没有新增独立 implementation/review scope；原风险判定不变。session-record 评估沿用本 milestone owner。
