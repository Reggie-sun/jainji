# Hybrid Corner V1 Activation Record

## Scope and Ownership

从 `origin/main` d6fe1679a45bfcb89a5d55c45ca0c5cb9f07c14b 创建独立 `feat/hybrid-corner-activation` / `jianji-hybrid-activation` worktree，merge H4 c26e8b8513224d71ac8c66ff3dad03052b8792e1。共享 main 的 batch/Qianchuan dirty 状态保留。接线复用原 controller、runner、compiler、queue、ArtifactVerifier 和安全发布；H2/H3/H4 算法不改。

## Status

独立 worktree 的最终启用 candidate 正在资格验证，尚未提交或推送，不声明产品上线。当前 H3 full integration 在未调整的原120秒测试预算下1/1 PASS；typecheck、构建、正式 queue 冻结 PNG 编码/篡改拒绝回归及实际 Chrome MCP intent 保存/切换交互已通过。最终 enabled candidate 的完整 Harness、completion、real233s 正式输出及 Risk Gate 尚待最终证据；任一 required gate 失败保留关闭。早期关闭 candidate Harness 被明确 supersede，不作为 PASS 收据。

## Frozen Identity

目标为原 H4 PASS 的 real233s TOP_RIGHT。PNG SHA256 `5cf525c17c5121980caba8d34674ea0978a5b964975e3f72efd150e7d1b93896`；bindingDigest `d02dfac0c2bc4b63c3f93a69476cbbe6dfd783b95543a75a3bbbbfab8f43e82d`；placement `(626,0,94,61)`；packetDigest `c7d0fb196056952f924bb986768b12c40eacc07959f882f509ab8dc5b831c14d`；原 H4 preview SHA256 `6cfe8331cab4a378fa4c9f14b336f1503c90b949e0a38e1c569fd749bf8136e7`。不借同 PNG、不同 binding 的另一 H3 archive 替代。正式资格运行必须核对原 archive/QA/packet seals、同12图、6990帧233秒及零遗漏。

## Evidence Ownership

私有证据根 `/home/reggie/.local/state/jianji-hybrid-activation-20261006`。受管 Kimi mapping invocation `3be99912-bf58-4750-bd47-6110569ebc3b`，deep/k3[1m]/max，Docker containment、qualified route与 canonical receipt；4次 wire requests、PARSED，无截断。Parent 根据当前源码核实 compiler 零变换和 queue 前后 freshness 缺口后实施；PARSED 不授验收，不替代最终 Risk Gate。

## AOCI Recovery

主线 d6fe167 的正式 code index 与其 baseline seal 不一致：code bytes SHA `c3d328e84f1cae9c5a083f431c7638285581eab22318d5588a56729bd38cd189`，baseline 要求 `ccd2242c68676c2ebcf4648f84522f78a7bfbbc74c005a92b8772b0ae19ea627`（000f3e6 的精确字节）。这是 merge 前已存在的主线治理漂移。独立工作树使用已验证配对的 H4 formal index/baseline 作为恢复 preimage，再用官方完整机器批次对齐 current main + Activation 的源码；不伪造 hash，不改 Qianchuan 业务源码。维护最终结果待记录。

## Completion and Limitations

待最终证据。自动覆盖/解码验证不代表整片人工视觉验收或 Windows 实机资格。partial 仅声明已批准角落；未知角落原样。当前 repo 内未发现 dedicated session capture Skill；本轮有 substantive integration 和外部媒体资格触发，主动评估后用本 canonical record 保存结果，不以缺 hook 或 tracked media 为由跳过记录。

## Product Clock Regression

第一轮 real233s 原 controller/queue 在编码前明确失败 `HYBRID_OUTPUT_BINDING`：MediaCatalog 容器时长233013ms，H4冻结视频轨233000ms。不是源变化或 H3/H4错误。产品 adapter 分别核验当前容器摘要和原视频时钟；零容差、原 binding 不变，额外13ms音频不被当作未覆盖视频。双时钟 FFmpeg fixture 与 changed metadata 负例已50/50 focused PASS；完整重验及正式输出待最终记录。
