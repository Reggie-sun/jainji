# Manual Cover Default No-Cover Implementation Plan

## Goal

恢复用户再次明确的行为：只有有效手动框需要覆盖，无框默认不覆盖，直接正常制作，不要求逐素材确认。用户选择 A，授权 Parent 接手相关未提交修改并保留其他覆盖修复。

## Contract Surfaces

适用 [Manual Region Input Delta](../../semi-automatic-cover-review-spec.md#manual-region-input-delta-2026-10-08)。`manualCoverRegions` 独占有效区域解析，`manualReviewInput` 生成 `cover` / `no_cover` 意图；不增加三态决定或另一持久格式。移除新正常制作入口的缺决定拒绝及三态 helper。普通 assisted 审阅、历史批准、冻结重试、源和图案 freshness、非法轨迹校验保持。

## Scope And Ownership

Parent 接手 `src/shared/manual-cover-review.ts`、`src/main/manual-cover-production.ts`、`src/renderer/CoverStickerPanel.tsx` 及对应 unit/integration 回归；仅修订 canonical contract 中缺框语义，保留整体选材/图案尺寸增量。其他脏文件和 staged 内容不归本轮，不修改或提交。有效区域继承由 Parent 依据当前 source、CodeGraph 和回归核对；后续需要委派或触发审查时只使用 Codex 原生 profile，遵守用户最新撤销 external route 的约束。主线程拥有最终判断、verification 和 commit。

## Current And Target Behavior

当前未提交增量将无框素材标为待设置并拦截制作。恢复有框/无框两态：当前无框显示“默认不覆盖”，统计无框数量，清空最后一个框立即回到默认不覆盖。显式逐素材空数组继续屏蔽通用框，缺省素材继续继承已有通用有效框。

## Acceptance Criteria

- 混合有框/未配置素材生成 `cover` / `no_cover`，不修改设置或为未配置项代填空数组。
- 全无框可正常生成意图；有通用有效框继续继承，逐素材空数组仍取消继承。
- 已保存有框/无框混合素材通过原制作队列，真实 FFmpeg 输出后验证无框没有覆盖层、旧冻结重试仍复用原字节。
- 界面不再显示“待设置”或要求确认不覆盖；增删最后一个框、素材切换和保存与实际意图一致。

## Milestones

1. 修订合同并自审；修改现有回归使错误拦截明确失败，再移除缺决定 gate/helper，界面复用有效区域解析。
2. 跑现有 `tests/cover-review-commands.test.ts`、`tests/human-region-production.integration.test.ts`、typecheck、Chrome 隔离真实组件交互及 policy 所路由的 owned Harness。
3. 在稳定状态评估 Review Risk Gate、必要 AOCI 和记录；检查最终 owned diff，只提交本任务 files/hunks，push 当前 upstream 并核验远端 SHA。

## Compatibility And Limits

不重建未知框，不改用户项目、源视频、输出或历史队列；不消费真实制作模型额度。本轮工程 fixture 不代表用户原片、Windows 或人工视听验收。恢复 no-cover 只决定不添加覆盖层，不修改普通装饰规则。

## Self-Review

用户目标与原合同一致，删除错误三态 gate 而非绕过几何/资源验证；前端和正常制作使用同一有效区域解释。全部行为由现有测试及真实组件验证，不创建另一批准或持久 owner。历史缺框拒绝记录保留并明确被本次澄清取代。
