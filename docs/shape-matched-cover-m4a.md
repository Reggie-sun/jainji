---
title: Shape-Matched Cover M4-A Source Mask Admission
status: one-real-segment-published-in-isolated-store
date: 2026-09-26
spec: shape-matched-cover-spec.md
plan: shape-matched-cover-plan.md
---

# Scope

本阶段只打通一个已人工核查静态 segment 的 `creation → review → publish → SourceStickerKnowledgeStore`。它不选贴纸、不生成覆盖层、不修改 `agent-runner.ts` 或 `compiler.ts`，也不把源 mask 的通过解释成输出覆盖或内容安全通过。应用当前的自动覆盖生产路径仍是旧合同；M4-B 和 M5 尚未实施。

# Admission Contract

- `scripts/shape-cover-mask-probe.py` 产生的候选必须保留原始 `result.json`、bitset 和逐帧 `edge-contact-sheet.png`。新入口只接受 `CANDIDATE_REQUIRES_HUMAN_EDGE_REVIEW`、30–100 帧的连续 PNG 联系图、逐帧核心检查、固定算法版本及有界 1:1 mask；单帧或片段时间不明拒绝。
- 人工审阅单独写 `PASS` receipt，声明 reviewer、时间、源文件/bitset/probe/联系图 SHA-256、完整帧范围及边缘、静态性、出现时段结论。入口校验所有摘要与帧数，再重新从当前源文件解析每帧 PTS、取首末两张完整原帧、核对源字节身份和 mask 编码。缺审核、证据不符或源修订不匹配统一以 `UNSAFE` 拒绝。首版入口明确拒绝旋转素材及无法精确表示的时段，不推断它们安全。
- `SourceMaskAdmissionProof` 是源事实专用 proof，标记 `source-mask-only`；没有 `previewPassed` 或任何覆盖通过声明。原 `KnowledgePublicationProof` 和历史 revision 不改变解释。源帧、probe、联系图、人工 receipt 的原始字节与摘要一并由原知识库事务持久保存，重启加载时复核。已存在 revision、争议、坏字节、坏摘要、缺审核及损坏审阅档案均拒绝，不覆盖旧 head。

# Real-Media Run

Codex 按本次用户授权，再次查看了肥皂原片 90–93 秒的全部 90 帧联系图：右上红白旧标的尖端、描边和白色外缘仍在紫色保守边界内；所查时段目标未消失或形变。人工 receipt 存在本机 `/tmp/jianji-cover-m1-20260924/static-90-93-holdout/m4a-review-pass.json`，绑定 M1 候选。它不是自动生成的 PASS。复现命令：

```bash
./node_modules/.bin/esbuild scripts/shape-cover-admit-source-mask.ts --bundle --platform=node --format=esm --outfile=/tmp/jianji-cover-m1-20260924/shape-cover-admit-source-mask.mjs
node /tmp/jianji-cover-m1-20260924/shape-cover-admit-source-mask.mjs --source '/home/reggie/电商/肥皂/素材/竞品详情-抖音电商罗盘 (1).mp4' --probe-dir /tmp/jianji-cover-m1-20260924/static-90-93-holdout --review-receipt /tmp/jianji-cover-m1-20260924/static-90-93-holdout/m4a-review-pass.json --store-root /tmp/jianji-cover-m4a-20260924-store-v4
```

结果：`sourceKey=3e78c53a566e871b2b3d172be1d4bfd8e1103070782d85569523157040b6587f`，revision `bed00309-f0be-4d63-8f06-466ee2e1e61d`，`verification=source-mask-only`，mask SHA-256 `415c72e64d028d194f606e77f9a7519f4e1e42ac492505275c7edb2f7bc7ba53`，唯一核查时段 `[90000,93000)` 毫秒。发布使用独立 `/tmp` 知识库，没有写入正在使用的应用用户数据目录；联系图、probe、receipt 和两张原帧均在该库的 revision 证据目录中。现有其余 230 秒及同画面其他旧贴纸不因此获准。

# Verification And Limits

`tests/source-mask-admission.test.ts` 用真实 FFmpeg 生成短素材，验证源专用发布、重启读取、审阅档案持久化及篡改拒绝；测试中的合成 receipt 只验证机制，不冒充人工视觉审阅。另逐项改变源哈希、片段范围、mask 字节、收据和发布前原帧证据，断言入口返回 `UNSAFE` 且知识库没有新 revision。原知识库、session 和监督证据测试用于检查兼容性。

`74ef062` 检查点的全套测试曾为 1048 通过、2 失败、3 跳过。覆盖并发的 `resolved-cancel` 失败属于 enqueue 返回后取消信号未再次检查；`74ef062` 没修改 runner 或该测试，后续独立提交 `fce917d` 在保存 task ID 前补上检查。9 月 24 日的单文件 10/10、全套运行均通过该断言，旧测试合同仍有效，无需改断言。harness 的进程树超时断言当时在全套并发运行时失败，单独运行及后续全套运行通过；当时未定位具体调度条件，未把一次全绿当作稳定性证明。

`92b4c12` 新增负向测试后，9 月 24 日的 `npm run typecheck` 通过、`npm test` 为 1055 通过、3 跳过；这些是历史证据，不是后续 checkout 的 fresh verification。M4-A 的源事实发布目标成立；当时 harness 波动尚未收敛。生产形状匹配切换和 M4-B 均保持阻断。

# Harness Timeout Attribution — 2026-09-26

## Boundary And Reproduction

本轮从 `ecb5be0c30344435662c0bff0d0ca3bccce6d67d` 继续 bounded debugging，只修 `tests/harness.test.ts` 和本记录，不修改 `src/harness/run.ts`、compiler、renderer 或生产选款。写入前两目标文件均无 dirty changes，无其他 writer 拥有这些路径；原有未提交文件保留。独立 native `code_mapper` 仅核查源代码，运行复现与最终裁决由 parent 完成。按当前用户限制未调用产品 Agent、付费模型或 Kimi review。

对未修改的 `runProcess` 执行三轮探针，每轮 24 次、最多 4 路并发，交替使用后代 `stdio=inherit/ignore`。第一轮普通负载、第二轮单核 affinity、第三轮单核加 4 个最长 20 秒的 CPU 负载进程。记录 spawn PID、实际 `/proc/<pid>/stat` 的 PID/PPID/PGID/state、`SIGINT/SIGKILL`、根进程 `exit/close` 和最终进程组成员。第三轮一次在输出后代 PID 前被 timeout 终止：

| Event | Observed evidence |
| --- | --- |
| spawn | PID/PGID `510273`，探针时间 `6807ms` |
| SIGINT | `6915ms`，组内只有根进程，state `R` |
| exit / close | `7061ms` / `7167ms`，`code=null, signal=SIGINT`，组内为空 |
| force / result | `7950ms`，`SIGKILL` 返回 `ESRCH`；stdout 为空、`timedOut=true`、duration `1160ms` |
| old assertion | `Number("") === 0` 且 `Number.isInteger(0) === true`；`process.kill(0, 0)` 查调用者进程组，错误报告仍存活 |

这复现了旧断言的失败机制，属于测试启动竞争和 PID 判断错误。另用 100ms 延迟输出的 fixture 重放旧判断，确定得到 `pid=0, alive=true` 和原 `alive=false` 断言失败（exit 1）。三轮共 72 次探针的最终进程组均为空；状态采样未见 `Z`，不代表从未有瞬时 zombie。后代忽略 `SIGINT` 时，根进程先退出、后代留在原 PGID，再被 `SIGKILL` 终止；`stdio=ignore` 下根进程 `close` 可以先发生，不能单独证明树已清理。强杀发送后 Promise 返回时仍可能瞬时看到后代 PID，最终清理另行检查；本轮没有观察到持续泄漏，也没有证据要求修改实现 owner。

本机诊断材料位于 `/tmp/jianji-harness-timeout-20260926-{run,probe,load}.mjs`、`/tmp/jianji-harness-timeout-20260926-trace.jsonl` 和 `...-legacy-red.log`，不提交 Git，不作为可移植验收材料。仓库内的回归测试保留可重放机制。

## Correction And Verification

进程树测试现在故意延迟启动 100ms，并通过后代 IPC `ready` 与根进程 ready 文件确认 PID 和 signal handler 已建立，再推进仅控制 harness `setTimeout/clearTimeout` 的假时钟。真实 OS 调度与文件读取仍用真实计时。timeout 仍为 50ms，强杀仍推进原有 1000ms grace；实现中的等待、3500ms settle 上限和最终最多约 1000ms 的清理轮询均未放宽。Linux 核对根/后代属于同一 PGID，确认 graceful signal 已到达且后代仍需强杀；根与后代 PID 最终必须都不存在，`Z` 仍视作残留并使测试失败。失败消息保留前后 `/proc` 状态和命令结果。Windows 异步 `taskkill` 先完成并安装 escalation timer 后才推进测试时钟；本轮没有 Windows 实机证据。

已执行当前 `verification-before-completion` skill。最终测试候选为上述 HEAD 加本轮测试 diff，`tests/harness.test.ts` SHA-256 为 `153ca519862ac53f16aeaeef100d6211a758a85c74de5964dbbda16771e4192f`。本轮最终验证均在该测试字节上执行：

| Command / condition | Fresh result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test -- tests/harness.test.ts tests/harness-media.integration.test.ts tests/source-mask-admission.test.ts` | 3 文件、26 PASS，exit 0 |
| `npm test -- --maxWorkers=4 --minWorkers=4` | 126 文件 PASS、1 文件 skipped；1072 PASS、3 skipped，exit 0 |
| 单核 affinity + 4 个有界 CPU 负载进程，harness 单文件 | 8 PASS，exit 0；两种管道均无根/后代 PID 残留 |
| `git diff --check` | exit 0 |

收敛期间另一次默认并发 `npm test` 为 1072 PASS、3 skipped；它在最后加入等待异步 `taskkill` 安装 escalation timer 的测试断言前运行，不替代上表最终候选证据。验证输入包含预先存在、未提交的 `tests/tmp-repro-sticker-size.test.ts`；该文件不属于本任务，不修改或提交。全套通过/跳过数因此不能直接与 9 月 24 日比较。本机日志为 `/tmp/jianji-harness-timeout-20260926-{typecheck,focused,final-suite,final-loaded}.log`。

本轮为测试 owner 修正，无生产逻辑或 durable state 变更；本机复现、真实进程测试及全套验证覆盖具体失败路径，未发现重大后果加实质验证缺口的 review trigger，`KIMI_REVIEW_NOT_REQUIRED`。仓库没有专用 session-record/capture skill owner，本记录承载本次 checkpoint，不另建 phase ledger。结论限于已复现的 Linux 启动竞争；不宣称任意负载、Windows 进程清理或成片质量均已验收。

本轮已归因并收敛所复现的 harness 测试波动，停在 M4-A 验证 checkpoint。下一步按既有 spec/plan 单独处理 M4-B；本轮不进入该阶段，生产形状匹配仍未启用。

下一步 M4-B 必须按每个 source revision、输出设置、摆放和轮廓版本独立计算整轮共同候选，预览和正式队列消费同一冻结图层字节；缺 mask、源修订不匹配、coverage 非 100% 或内容安全未通过一律 `UNSAFE`。本阶段没有执行这些门槛，也没有调用产品 Agent、付费模型、Kimi 或 `delogo`。
