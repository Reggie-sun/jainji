# Hybrid Corner V1 Activation Record

## Status and Ownership

2026-10-06，Hybrid Corner V1 产品接线及 Linux 正式导出资格通过。源码 checkpoint：`d47430a3b2c94171b5d985b7f10ef922bf346011`。从最新 `origin/main` `d6fe1679a45bfcb89a5d55c45ca0c5cb9f07c14b` 创建独立 `feat/hybrid-corner-activation` / `jianji-hybrid-activation` worktree，merge H4 `c26e8b8513224d71ac8c66ff3dad03052b8792e1`。原 main 工作树及 batch/Qianchuan dirty/staged 工作未修改；不声明已合并或重启原 main。

`HYBRID_PRODUCT_ENABLED=true`，正式 shape intent 不再返回 `PRODUCT_DISABLED`。候选只在独立、未发布的工作树资格验证，全部 required gate 和 completion PASS 后才提交。旧 strict/proof 研究不授产品 authority。H2/H3/H4 算法、阈值、prompt、resolver、原批准 artifact 未改，关键源码与 c26 核对无 diff；未增加 H5/H6、whole-source completeness 或白矩形 fallback。

## Production Data Flow

覆盖设置保存“自动形状匹配覆盖”；仅 enabled + agent 的保存 intent 经原 `startAgent` / `AgentController.start` 进入产品路径。共享 schema 先校验手填文字、数量及请求；关闭覆盖保留模式偏好但不执行 shape。bootstrap 和 batch runtime 只接同一 routes adapter，不新增 IPC、项目生命周期、队列或上传系统。

原 `AgentRunner` 调用 `hybrid-cover-session`：H2 角落语义 → H3 冻结 mask/motion/shape/placement → H4 冻结样片 QA。`hybrid-cover-production` 只把同 source/packet/PNG/binding 的 H4 PASS 签为进程内批准层。原 `TemplateCompiler` 消费同字节 task copy，全画布0:0原尺寸叠加；原 `ExportQueue` 编码、`ArtifactVerifier` 校验、`publishWithoutReplacement` 无覆盖发布。不重选、移动、扩边或新增视觉判断。

编码前、编码后及发布前核验原批准源、实际生产路径、PNG/RGBA、完整 template seal、binding、packet 与 opaque coverage；实际编码副本写入后和编码结束清理前验 SHA。输出核完整时钟覆盖及视频/音频解码。JSON、UUID、caller verdict 或重启不恢复批准；重试保持冻结模板，失权/stale fail closed。

## Partial Corner Behavior

每角独立，H4 PASS 可以生产；unresolved/skipped 或有效的局部 H4 拒绝保持原样。零批准角明确显示“已处理0个角落”。不补普通四角贴纸，不宣称整片所有旧贴纸均已处理。source、连接、基础设施、取消、binding/freshness 错误停止该 source，不用 partial 掩盖错误，不重试 unknown outcome。保留原色及本地物化的用户手填文字。

## Real233s Formal Export

最终候选实际走 `AgentController.start → AgentRunner → TemplateCompiler → ExportQueue → ArtifactVerifier → publishWithoutReplacement`；task `dda1e26e-9291-4d1e-a326-3898289ebb99`，batch `c2dcbc39-674c-44ab-aa31-d1db00966186`。

私有证据根 `/home/reggie/.local/state/jianji-hybrid-activation-20261006`。最终目录 `real233s-product-entry-final` 保存视频 `竞品详情-抖音电商罗盘 (1)_edited.mp4`、`activation-export.json`、`queue-state.json`；另有 `real233s-entry-final-ffprobe.json`。60,658,660 bytes；H.264 720×1280、30fps、6990帧、视频233.000000秒；AAC 44100Hz stereo、233.011995秒。输出 SHA256 `28b1821a411ffe24dbd5affe42d4d70b97c270ccbe6783352c808d5d10d7228c`。

仅 TOP_RIGHT 生产，其余角落原样。内部资格导入核原 archive/QA/packet seals、同12图和原 preview，重放原 MINIMAX/SOL 结构化收据；零新模型请求、零新选款、零新视觉判断、不重新渲染 H4。内部 session 只提供批准模板，其他生命周期均为正常产品 owners；普通用户默认走正式 intent 流程。使用独立 canonical 源知识 store，未读取/恢复其他会话运行状态。

## Frozen Identity

| Field | Original H4 and final production |
| --- | --- |
| corner | TOP_RIGHT |
| PNG SHA256 | `5cf525c17c5121980caba8d34674ea0978a5b964975e3f72efd150e7d1b93896` |
| bindingDigest | `d02dfac0c2bc4b63c3f93a69476cbbe6dfd783b95543a75a3bbbbfab8f43e82d` |
| placement | x=626, y=0, width=94, height=61 |
| coverage | oldPixels=3681, uncoveredPixels=0, coverageFraction=1 |
| packetDigest | `c7d0fb196056952f924bb986768b12c40eacc07959f882f509ab8dc5b831c14d` |
| H4 preview SHA256 | `6cfe8331cab4a378fa4c9f14b336f1503c90b949e0a38e1c569fd749bf8136e7` |

原 archive/QA/packet SHA：`f99881476fe548fa94d1c05ba29bd3d74188e28efbba13907b57348d6c37885b`、`e4361c1240794cd4ce4ff17c3cfd9b4146dd1494fd22dbbf1838eb9c746b7374`、`9872eb44f4405263961c3235a2216d42304c89a554571d7c7384bf985fbe2e97`。不借同 PNG、不同 binding 的另一 H3 archive 替代。冻结 overlay 完全一致；正式视频沿原 queue 编码、音频正常转 AAC，整文件字节不等于 H4 preview 的 packet-copy 视频。

## Product Regression Closure

第一轮 real233s 编码前明确失败 `HYBRID_OUTPUT_BINDING`：MediaCatalog 容器233013ms，H4视频轨233000ms。adapter 现在分别核容器摘要和精确视频轨，零容差、原 source/binding 不变，不把尾部音频当未覆盖视频。双时钟 fixture及 changed metadata 负例通过；修复后三个成功正式导出 SHA 相同。最终入口修正后额外一轮资格预算为1，前次结果均已知，不是 unknown 重试。

源知识同时查原容器及视频轨，任一争议/不可用关闭，不把新解释的 miss 当无争议；该负例有 red-green。实际编码副本篡改拒绝 completed，亦有 red-green。schema 先于保存 intent 读取，修复本轮六个手填文字准入回归；关闭覆盖不继承旧 shape intent，负例先失败后通过。实际 Chrome MCP 与 smoke 验证 shape 保存、关闭、manual/assisted 切换、保留草稿和无旧白底说明；构建及 typecheck 通过。

## Full Verification and Completion

44路径 owned scope，base d6fe167。完整 Harness `20261005T215207Z-d04cb1cc`：20/20 required PASS，0 required skip，含默认12项、Hybrid vision、H3 full/focused、H4、Activation、extended、documents、owned-aoci。不降低 required 或预算准入。

H3 full 1/1 PASS，fixture40.9秒，沿原120秒测试上限；H3 focused8/8、H4 1/1、Activation8/8；extended998/998。Harness2512断言 PASS。另补3文件后，全部205文件在当前候选有执行记录：2526 PASS、0 FAIL、3原条件 skip（Windows2项、opt-in在线资源1项）；这些 skip 不计 required PASS。

receipt SHA256 `af3ad6b9f0389803f16305c71f9fee6a462248ad2ff32ea20ee3a004d9374f1c`；scope SHA256 `3d63bea717a2637b51b9092781be745387d908f31785650a2c289217a0982e1b`；source identity `sha256:69198740c43488fa98bd86552634853b7ec993fac42189eb118d95a2e0943be7`。source completion `20261005T221247Z-e294713b` PASS，对应上述源码 checkpoint。早期关闭候选或被中断 Harness 均 superseded，不作完成证据。

此后仅本记录补结果，沿既有 docs-only documents/owned-aoci 路由独立收尾，不改变已验证源码、policy 或 plan；最终文档 completion 结果保存到私有 `activation-record-completion.txt`。

## Review Risk Gate

所有 native gate PASS 后，对上述 exact source/scope/receipt snapshot 一次判定 `KIMI_REVIEW_NOT_REQUIRED`。用户未要求该 snapshot 的 Kimi review；无新凭据存储/曝光、上传/删除 authority、durable-state migration 或源片改写，原独占发布保持，85 credential-boundary tests PASS。source/PNG/task-copy/template/settings/争议/双时钟拒绝证据和真实冻结导出闭合了本轮实质验证缺口；无关键级不可恢复后果，亦无同时满足“重大后果+剩余缺口+独立增益”的证据。Parent 完成 diff、ownership、freshness 和 completion 裁决。

受管 Kimi mapping invocation `3be99912-bf58-4750-bd47-6110569ebc3b`，deep/k3[1m]/max，Docker containment、qualified route及 canonical receipt；4次 wire、PARSED、无截断。它是只读接线调查，不是最终 reviewer；PARSED 不授验收。详细判定保存于 `final-review-risk-gate.json`。

## AOCI and Record Closure

main d6 的 code index 与 baseline seal 在 merge 前已不一致：code SHA `c3d328e84f1cae9c5a083f431c7638285581eab22318d5588a56729bd38cd189`，baseline 要求 `ccd2242c68676c2ebcf4648f84522f78a7bfbbc74c005a92b8772b0ae19ea627`。独立工作树恢复已验证配对的 H4 formal preimage，再用官方完整机器批次、CAS/原子写入维护 current main 与本轮对象；未伪造 hash、改 foreign 业务源码或扩大 scope。

官方 Verify 结构合法/governance aligned，Check ok/next_action=none，Guide complete/next_action=none；44 owned disposition 经 Harness 核验。indexed 已维护，observe/exclude 按原角色处理。最新 Overview4块传输已确认，但严格 Challenge6/10 partial，禁止完整系统认知声明；与机器治理对齐分开，按合同 source-bound 继续，不循环补答。私有 `aoci-completion-attestation.json`、`final-aoci-verify/check/guide.json` 保存实际状态。

substantive integration 与外部媒体资格触发 proactive record 评估；仓库无 dedicated session capture Skill，使用本 canonical record，不因缺 hook/capture_request_id/tracked media 跳过。

## Remaining Boundaries

Windows 实机、新 live-provider 全流程及整片人工播放未由本轮评估；不把 H4 QA、解码/时钟验证当这些验收。额外开启 `JIANJI_LIVE_ASSETS=1` 曾发现旧 main fixture 失败：未传手填文字却假设指定 library font 预加载。`asset-library.ts` 和 fixture 与 d6 无 diff，当前 owner 仅有手填文字时选择默认字体；属于独立旧 fixture，未修、未降低 required gate、不宣称该 opt-in 通过。Hybrid 与 random/千川上传组合仍拒绝；分支完成不代表原 main 已切换运行。
