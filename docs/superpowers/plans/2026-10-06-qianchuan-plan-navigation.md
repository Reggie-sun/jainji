# Qianchuan Initial Plan Navigation

## Goal And Scope

修复首次上传专用 tab 的 deep link 被平台清空 `adId` 后停在计划列表的问题。仅 `DouyinCdpUploader.open` 新建且未选文件的 tab 可调用 `QianchuanPageSession.openInitialPlan`。既有 `guard` 仍独占进入上传、文件递送和 READY 的双 ID/归属核验；不改变恢复、账本、九条分组或确认行为。

## Contract And Self-Review

作为 [Upload Contract](../../douyin-auto-upload-spec.md#6-browser-and-batch-contract) 的有限首次导航补充：同源同路由、唯一冻结账户；平台仅移除或清空 `adId`，不能接受另一个非空计划。无详情和上传弹窗时，只点击唯一精确计划 ID 所属 `.oc-promotion-product-adinfo` 的唯一“素材”入口。一次点击后在既有 navigation 期限内等待，再运行原完整 `guard`；找不到、歧义、身份变化、取消或超时停止。不得在已选文件或只读恢复路径导航。

这一步只打开已有冻结计划的详情，不修改投放设置、不点击确定、不选择或重传文件。旧深链成功路径保持；共享 Schema、持久格式和 IPC 不变。范围已由本轮“测试修复”授权，Parent self-review 完成，无额外用户批准步骤。

## Implementation And Acceptance

- 修改 `src/main/qianchuan-page-contract.ts`、`src/main/douyin-cdp-uploader.ts`；新增 `tests/qianchuan-upload-navigation.test.ts`，加入既有上传 Harness 必需检查及路径路由。
- 用独立 production-DOM Chrome fixture 复现清空 deep-link、无详情、准确计划仍在列表的失败，然后验证打开正确计划且完成既有 prepare。
- 验证错误账户/URL计划、重复或缺失目标、错误详情、重复入口、取消，以及已有 selected/modal 不获首次导航权限；文件动作/确认均为零。
- 相关测试与 typecheck、owned scope Harness、AOCI Verify/Check/Guide；真实账号只核验打开详情，不以 fixture PASS 宣称真实视频上传通过。

## Boundaries

历史 98 条 UNKNOWN 已由用户确认并清空原上传列表，本修复不生成缺失的历史 READY 证据，不改其 fence 或继续未选任务。共享工作树已有无关文件保留。Kimi 仅独立只读检查已有 fixture/test seam，冻结集合与本轮 writers 不相交；最终 Review Risk Gate 在 native/Harness 验证后判断。
