# M5-B — Product Activation Boundary

## Status and Authority

2026-09-28，从 M5-A 实现 `746bb51` 与 NVENC 收口记录 `a44524b` 继续。现有 [Plan](shape-matched-cover-plan.md) 尚未定义 M5-B，本记录将下一切片具体化。状态为 `BOUNDARY_PROPOSED / PRODUCT_DISABLED`：调用链核查与合同细化已经执行，下面的目标接口及测试尚未实施，不能解释为产品已启用或获得生产 PASS。

用户要求关注哪些任务可以使用 shape、完整 admission、feature/version gating 和历史兼容。M5-A renderer、轮廓、coverage、M4 custody/publish-once/restart authority 保持原合同；Qwen 服务停止状态不属于本切片的代码或 feature gate。

## Verified Current Entry

| Surface | Current behavior / source |
| --- | --- |
| 产品请求 | `preload.ts / startAgent` → `index.ts / agent.start` → `AgentController.start` → `startInternal`，不传 shape request。 |
| 请求 schema | `shared/agent.ts / createAgentStartSchema` 是 strict object，没有 shape intent 字段；普通和 frozen request 复用它。当前加入未知 shape 字段会被拒绝。 |
| M4 接缝 | `AgentController.startShapeMatched` 显式传入 detached `ShapeCoverCandidateRequest`；仅自动覆盖、非 assisted、非 sourceStickerRefresh 可进入。CodeGraph 找到的调用者为测试 fixture；rg/源码确认无 IPC 产品调用者。 |
| 请求准备 | `ShapeCoverProduction.prepare` 核对全部制作素材、该 revision 的全部 target/segment/range、单一 preset 和共同候选；`AgentRunner.execute` 在抽模型帧及选款前调用它。 |
| 源事实 | `readAdmittedShapeCoverTarget` 核对 canonical store、精确源字节、当前 head、source-mask-only proof、目标/range/mask；当前明确拒绝 rotation 非 0。 |
| 发布 authority | `admitShapeCoverSample` 签发 module-private WeakMap handle；`ShapeCoverArtifactStore.publish` 与 `ExportQueue.publishApprovedSample` 验证绑定并同字节发布原样片。开关、版本、JSON 或已存在 PNG 都不是该 handle。 |
| 历史/重启 | renderer 按已冻结模板 strategy 解释；普通 shape enqueue/retry/replay 拒绝；B7 reconciliation 只读、authority=none，UNKNOWN never republish。 |

CodeGraph 使用完整 symbol `AgentController.startShapeMatched` 查询真实边；其短名查询返回 entity not found。`AgentController.start` 图中出现的 startInternal 反向边不能证明源码递归；具体 receiver 和 IPC 以源码核对。

## Two Gates

产品激活只允许**开始一次新的 shape 尝试**，不能在样片生成前要求已经拥有样片 admission，也不能用入口合格代替它。顺序固定为：

```text
explicit new-request intent + main-process availability
→ eligible fresh automatic-cover request
→ canonical source facts + complete intended set + bound placements/settings/assets
→ existing M4 common-candidate / freeze / original queue sample
→ independent content-safety + opaque admission handle
→ existing custody / publish-once / canonical Queue and JobStore
```

前半段不返回 `PASS`、不签发 handle、不保存“已批准”字段；最多允许尝试。后半段沿用 M4 owner，不新增第二套 renderer identity、queue、knowledge store、admission 或 production lifecycle。

## Proposed Intent and Availability

复用 `AgentStartSchema` owner，新增可选、明确版本化的 `coverStrategy: "shape-matched-static-v1"`。字段缺失继续旧解释；不复用 `opaqueBackground`，不从已有 mask、自动覆盖开关、模板或上一次运行推断用户选择了 shape。未知字符串/版本由 strict schema 拒绝，不能被丢弃后执行旧路径。

availability 由主进程启动依赖独占，默认关闭；不能接受 IPC、项目 JSON、模型响应中的 `enabled`、`approved`、`PASS` 或 rollout 参数。该依赖只允许/拒绝新的请求，不是持久 authority。现有 M4 显式测试接缝仍作为 bounded integration seam 使用，不借它绕过产品 gate；产品正常入口必须先经过 gate 才能委托该接缝。

产品 intent 只表达选择，不携带 source identity、revision、mask、asset path/hash 或可伪造的 candidate PASS。主进程必须依据当前项目、当前知识 head、本地合法素材目录、当前输出 preset，以及明确来源的摆放决定准备完整 request，再交给既有 M4 owner 验证。当前没有这样的产品 request assembler；未取得它的结果时明确 BLOCKED/UNSAFE，不生成默认 placement、不把人工框或近似框变成 mask。

本切片不新增 env/config 开关、全局实验框架或 UI 默认选项。可测试的主进程依赖不等于线上开关；产品默认保持关闭，真实激活必须另外满足下面的 release 条件。

## Routing and Failure Contract

| Request | Result |
| --- | --- |
| 没有 shape intent，包括普通新自动覆盖 | 既有路径与既有校验；不 opportunistically 尝试 shape。 |
| 明确 shape intent，但 availability 关闭 | BLOCKED/UNSAFE；不进入旧矩形、模型调用或队列发布。 |
| 明确 shape intent，覆盖关闭、manual、assisted、sourceStickerRefresh | UNSAFE，不静默忽略 intent。无 intent 时这些模式保持旧行为。 |
| 明确 shape intent，当前媒体不属于项目、probe 不可用、源解释/版本不支持 | UNSAFE，先于模型调用；当前 rotation 非 0 不支持，不能宣称已支持所有 V1 几何场景。 |
| 明确 shape intent，缺可信 source/range/完整性证明、缺摆放绑定或 request assembler | UNSAFE，不选款、不从 bbox 推导 mask。 |
| 共同候选为空、coverage 或独立安全未通过、frozen bytes/模板/输出绑定漂移 | 既有 M4 UNSAFE；不调用旧模式再做一次。 |
| 合格尝试，后续全部 M4 准入成立 | 只能用该次 opaque handle 发布已批准样片；availability 不放宽发布条件。 |
| historical frozen job / retry / append / restart | 保留旧解释；不能根据当前 availability 或新 intent 迁移旧模板。shape 历史发布事实继续只读 reconcile，不能复活 PASS。 |

首个受控产品版本限定正式 MP4；其他 container 的 shape intent 明确拒绝。这是拟议产品范围限制，不是声称现有 M4 仅支持 MP4。现有普通路径的格式不变。千川上传、local-random 自动覆盖的组合不在本次激活范围，明确 shape intent 与这些组合在入口拒绝；无 intent 的现有功能保持不变。

参数校验和产品 gate 应先于外部请求，包括上传 preflight；所有目标的源准入及共同候选仍先于选款/创作。取消不转换为旧行为。sourceStickerRefresh 必须另走已有源检查流程，随后发起新的 shape 尝试，不能在同次 shape 请求内刷新后借用旧绑定。

## Temporal Completeness and Release Blockers

`ShapeCoverProduction.prepare` 证明的是“intended set 等于当前 revision 已记录的 segments”。它不证明该 revision 已穷尽全片所有旧贴纸。`source-mask-only` 的 store proof 当前限定一个 target/segment、一个 reviewed range、30–100 帧核查，且没有 exclusions；`admitReviewedSourceMask` 通过 range 后的真实帧 PTS 建立半开终点。这些数据不能升级成 range 外的不存在证明。

真实产品处理整段源视频时，必须有 canonical 源证据覆盖整个制作 horizon，并穷尽其中需要覆盖的目标/时段；已核查“没有贴纸”的时段也须来自相应源事实 owner。不能通过 caller 给出的 `complete=true`、目标数组长度、短片实验或样片输出时钟来填补未知源时段。现有 source-mask-only proof 不自动满足这一条件。本切片不修改 M4 source admission 或扩大 probe 范围来制造通过；缺该能力时产品 gate 保持关闭。

此外，[Plan 的 M5](shape-matched-cover-plan.md) 与 Spec AC-04/06/07 仍要求真实留出素材、独立内容安全、原片/成片核对、长片/多素材成本证据。M5-A 的合成 fixture、模拟 reviewer 与普通 NVENC 测试不满足这些上线证据。可以先实现并验证关闭状态和拒绝边界，但不能以它们替代真实启用验收。

## Bounded Implementation Sequence

**Entry policy:** 在独立 `shape-cover-activation.ts` owner 固定版本和 routing/rejection decision；由 `AgentController.start` 调用，在任何外部请求前执行。policy 不加载/推导 mask，不生成图层、不签发或验证 admission；实际 source/binding 检查继续由既有 owner 完成。`shared/agent.ts` 只定义 intent 类型与 strict parsing，`FrozenAgentStartSchema` 对缺字段历史数据保持兼容；保存 intent 只是下一次 fresh request 的用户选择，不能恢复执行或 authority。

**Trusted request integration:** 只有主进程取得具有明确 owner 的完整 request 和源 horizon 证明，才允许正常产品入口委托 `startShapeMatched`。availability 默认关闭，缺 assembler 或完整性证据必须产生准确阻断原因。M5-B 不实施新的摆放算法、自动 mask 生成、default-on UI 或 restart replay；缺这些条件不是允许增加 bypass 的理由。

**Verification:** 新增 `tests/shape-cover-activation.test.ts`，覆盖缺 intent 的 legacy routing、主进程关闭而 caller 请求开启、未知版本、覆盖关闭/manual/assisted/refresh、格式及组合限制、缺 request、部分 horizon、当前 source/asset/settings 变化和取消。controller 集成必须观察模型/上传/队列调用次数为 0 的拒绝；条件满足的受控 fixture 委托原 M4 路径，仍观察独立安全和 same-bytes/publish-once。不能伪造全片生产 PASS 来满足正例；尚无真实 canonical 全片 fixture 时报告 activation 正例未验收，并保持默认关闭。历史矩形回归、序列化缺字段兼容、shape restart authority=none 保留。

实施后运行 typecheck、受影响 activation/agent/controller/shape/queue/store 测试，按实际 IPC/UI 改动补集成证据；不为本次纯文档调查重跑媒体或全套。正式打开 availability 仍需单独执行 M5 的真实媒体验收。关闭 availability 只阻止新的尝试，不把已签发、已托管或已发布的事实改写成 legacy，也不自动取消正在运行的任务。

## Ownership and Handoff

本轮允许写入的文件为本记录及现有 Plan。源码调查时 `agent-controller.ts`、`agent-runner.ts`、`shared/agent.ts`、`index.ts`、`preload.ts`、`domain.ts` 等已有不属于本任务的未提交工作；其中 controller/runner/shared 的 usesModel 改动已读出并保留。按 global Working-Tree Safety，任何同文件实现写入前必须由用户明确决定 ownership/执行顺序。不能因改动行不同自行接管。

M5-B 的自然停止点是具体、可评审的激活边界与该 ownership 决定；不是 renderer 再次切换。后续实现从本合同出发，保留 M5-A SHA 和未相关 dirty 文件。Self-Review：区分 attempt/publish、disabled/legacy/UNSAFE、局部/全片证据；与 Spec REQ-01–10 和 M5 总阶段保持一致，没有授权 default-on 或绕过 M4。session-record 评估使用本 milestone 记录，不新建第二阶段 owner。

## Investigation Evidence

按 global standing route 使用 [external-subagent](/home/reggie/.agents/skills/external-subagent/SKILL.md) 做 read-only explorer 调查，profile=deep；只读范围为现有 clean M4 owner 和既有 Spec/Plan，不委托产品入口接线、不要求 Spec/Plan independent review。Doctor 的 Docker containment/native tools 检查通过，canonical qualification `9c489879-bf37-4f39-9437-367f10b8ec68`，seal `f6ef1a98578b5dda6885c707966a9eedd7bfa665998eeff076e4350bab5267c3`，invocation `7de3fb0d-b9f8-49c5-b443-4c462917d39c`。

预算 180s wall / 120s idle / 5 requests / 8MiB output；receipt 为 `OUTCOME_UNKNOWN`，process reason=timeout，实际2次 wire requests。observed_reads 记录 production/candidates/admission 三份完整源码，已完成 observation 记录 K3/max 身份；没有终态报告，不采纳 partial findings、不宣称独立核查完成、不自动重试。它不是 required implementation reviewer。Parent 已直接核对本记录的关键源码结论。

本次只编写 proposed boundary/plan，不改变行为；按 repository `verification-before-completion` 读取并执行文档 gate，检查本任务 Markdown 链接、引用 symbol、Spec/Plan 合同、diff，以及 M5-A renderer/shape 测试 SHA。不把既有 tests 当作本切片实施证据；未运行产品模型、媒体导出、Windows 或人工观看。
