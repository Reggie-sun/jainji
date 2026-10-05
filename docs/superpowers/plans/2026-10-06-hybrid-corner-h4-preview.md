# Hybrid H4 Rendered Preview QA

> Native Codex；基线 `000f3e6251cd4e4b13d531e2cbd32dfb208b4069`；独立 `feat/hybrid-corner-h4`。用户已授权真实 MiniMax first review 和有条件 Sol 二审。

## Goal and Scope

使用 real233s 已冻结 TOP_RIGHT PNG 生成完整、可播放 development preview，检查残留、误遮挡、自然度和时间一致性。保留源音频、时长和帧率。不重新识别、mask、motion、选款、placement 或扩边，不触碰共享 main。PRODUCT_DISABLED，不接 UI、正式 export activation 或 proof v3。

## Contracts and Owners

H3 archive 是输入数据，不恢复 H3 live ownership 或生产 authority。H4 验证 archive binding、source、PNG/RGBA/alpha 和 projected mask coverage=0。TemplateCompiler 独占基础过滤/编码，H4 只将同字节全画布 PNG 在 0:0 接入空模板输出；临时文件验证后由既有工具无覆盖发布。

复用 decode clock / exact source frames：start、middle、end，加 H3 stationaryMatch 最低的三个不同采样位置，最多六对 full frames、十二张图片，保持原 VisionPacket budget。源与 preview 的逐帧实际 PTS 配对；只上传图片/manifest，无视频、路径或凭据。

独立 PREVIEW session：MiniMax-M3 一次 color capability probe、一次 QA；FAIL/UNKNOWN 时最多一次 `gpt-6.1-sol` 二审，精确型号不可用则 UNSAFE，不切换历史 alternate。无重试。provider/parse/timeout/stale/cancel failure 保留 receipt 并 fail closed。模型不替代 deterministic coverage。

## Milestones and Verification

1. archive/render/QA adapter：tamper、clone、coverage、pairing、provider failure 与精确型号 tests；真实 FFmpeg fixture。
2. real233s 完整 preview：同 PNG、6990 帧/233 秒、源音频 packet hash；实际模型 QA 与可观看产物。
3. fresh typecheck、H3/H4/vision tests、owned Harness/completion；AOCI role、官方 Verify/Check/Guide；真实 record、commit/push 及远端 HEAD。

## Acceptance and Self-Review

H4 READY 要求工程与 completion PASS、原 preview resolver PASS、真实 preview 技术验证 PASS、H3 不变。采样视觉 PASS 不是全片逐帧视觉证明，不授予 Activation。其他角落继续 UNRESOLVED；本轮只评价确认 TOP_RIGHT。视觉失败交付 UNSAFE，不反向修改 H3。

复用 compiler、clock、packet、router、credentials 和发布 owner；新 adapter 没有生产 authority 或第二产品生命周期。精确 Sol catalog 缺失可能阻断二审，记录该真实边界。
