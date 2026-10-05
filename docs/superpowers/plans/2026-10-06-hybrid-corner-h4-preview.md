# Hybrid H4 Rendered Preview QA

> Native Codex；基线 `000f3e6251cd4e4b13d531e2cbd32dfb208b4069`；独立 `feat/hybrid-corner-h4`。用户已授权真实 MiniMax first review 和有条件 Sol 二审。

## Goal and Scope

使用 real233s 已冻结 TOP_RIGHT PNG 生成完整、可播放 development preview，检查残留、误遮挡、自然度和时间一致性。保留源音频、时长和帧率。不重新识别、mask、motion、选款、placement 或扩边，不触碰共享 main。PRODUCT_DISABLED，不接 UI、正式 export activation 或 proof v3。

## Contracts and Owners

H3 archive 是输入数据，不恢复 H3 live ownership 或生产 authority。H4 验证 archive binding、source、PNG/RGBA/alpha 和 projected mask coverage=0。TemplateCompiler 独占基础过滤/编码，H4 只将同字节全画布 PNG 在 0:0 接入空模板输出；临时文件验证后由既有工具无覆盖发布。

复用 decode clock / exact source frames：start、middle、end，加 H3 stationaryMatch 最低的三个不同采样位置，最多六对 full frames、十二张图片，保持原 VisionPacket budget。源与 preview 的逐帧实际 PTS 配对；只上传图片/manifest，无视频、路径或凭据。

独立 PREVIEW session：MiniMax-M3 一次 color capability probe、一次 QA；有效 PASS 直接通过；有效 FAIL/UNKNOWN 时按既有 resolver 最多 Sol 二审一次，高风险视觉矛盾不被覆盖。schema/JSON 无效属于无有效第一审，允许 Sol 独立一次，其有效四项 PASS 且无风险才可通过；packet mismatch、provider/timeout/stale/cancel failure 继续关闭。Sol 复用 canonical Hybrid routes，优先 `gpt-6.1-sol`，当前不可用才用已授权 `gpt-5.6-sol`，不增加模型或重试。

## Milestones and Verification

1. archive/render/QA adapter：tamper、clone、coverage、pairing、provider failure 与精确型号 tests；真实 FFmpeg fixture。
2. real233s 完整 preview：同 PNG、6990 帧/233 秒、源音频 packet hash；实际模型 QA 与可观看产物。
3. fresh typecheck、H3/H4/vision tests、owned Harness/completion；AOCI role、官方 Verify/Check/Guide；真实 record、commit/push 及远端 HEAD。

## Acceptance and Self-Review

H4 READY 要求工程与 completion PASS、原 preview resolver PASS、真实 preview 技术验证 PASS、H3 不变。采样视觉 PASS 不是全片逐帧视觉证明，不授予 Activation。其他角落继续 UNRESOLVED；本轮只评价确认 TOP_RIGHT。视觉失败交付 UNSAFE，不反向修改 H3。

复用 compiler、clock、packet、router、credentials 和发布 owner；新 adapter 没有生产 authority 或第二产品生命周期。Sol 两个授权型号均不可用才阻断二审。

## QA Closure Amendment

2026-10-06 用户授权的固定基线 `f4158d136cbed6816190ad8367367df70b7b6a0f`。仅修改 H4 QA adapter、preview 输出契约/安全诊断、诊断入口、Harness ownership 和相关 tests/docs/AOCI；renderer、H3 geometry 与 guard 完全不变。

1. 先核对历史无效首答证据；历史只留 hash/bytes，不能猜测坏字段。对当前请求保持 strict schema，输出契约补齐现有 parser 的字符串/数组边界，receipt 只保留安全的字段路径和错误 code。MiniMax 真实原文只在私有诊断目录存储。
2. 回归覆盖有效 PASS、UNKNOWN 二审、无效首答/Sol PASS、Sol 失败/无效/不可用、packet mismatch/stale/取消/transport 以及原高风险冲突。禁止伪造 MiniMax verdict 或放宽视觉条件。
3. `--qa-only` 消费同 real233s preview 与原12张 PNG；核对源/H3/preview/图片 hash 与原 packet binding，仅去除假 detector signals 并明确 TOP_RIGHT reviewScope，不重新渲染或改几何。MiniMax first，必要时 Sol once。
4. Harness 将官方 governance 声明的正式资产与 business sources 分开；正式资产绑定一致 Verify/Check/Guide 的 path/hash 和磁盘字节，要求治理对齐、无恢复/冲突；普通 owned source 仍必须在 manifest 且具备 baseline。required 不变。
5. 稳定后做 typecheck、affected tests、owned Harness/completion、官方 AOCI 收尾、Risk Gate、record、commit/push 与远端 HEAD 核对。

Self-Review：九项交付要求和固定 QA 请求上限已覆盖；不恢复 archive authority、不清历史失败、不启动 Activation。视觉结论仅为该 confirmed replacement 的固定采样 QA，不宣称未确认角落或整片逐帧视觉验收。
