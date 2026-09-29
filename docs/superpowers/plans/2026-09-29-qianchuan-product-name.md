# Qianchuan Product Name Implementation Plan

## Goal And Scope

允许在作品页账号设置中更换产品显示名称，同时保留该账号原 Chrome 连接和千川计划。Native Codex Parent 串行实现，Kimi 只读检查冻结及持久化兼容；不创建 worktree。

## Contract Surfaces

依照 [Account Configuration Contract](../../douyin-auto-upload-spec.md#4-account-configuration-contract)，`product` 继续是六个稳定槽位标识；可选 `productName` 是 1–40 字符的用户显示名称。共享 schema 校验首尾空白、控制字符和六槽位有效名称唯一性；账号保存接受 strict `{ product, planUrl, productName? }`。省略名称兼容旧调用，缺少名称兼容旧配置及账本。

名称随 app-owned mapping 保存并投影到账号摘要；设置按钮、普通/追加/批量下拉框和高级摘要显示新名称，下拉框值保持原 `product`。已有冻结目标及历史任务不修改。仅改名不重新发现 Chrome，不改 `cdpEndpoint / advertiserId / adId`；改账户仍采用原唯一连接发现合同。外部导入文件不改写。

## Ownership And Boundaries

- `src/shared/qianchuan-account.ts`：名称 schema、映射唯一性、摘要及显示名称解析。
- `src/main/qianchuan-account-settings.ts`：在原串行写入及锁内保存可选名称；不新增存储或入口。
- `src/renderer/QianchuanAccountSettings.tsx`、`DouyinUploadControls.tsx`、`DouyinUploadPanel.tsx`：编辑名称及同步显示。
- `tests/qianchuan-account-settings.test.ts`、`tests/douyin-upload-ui.test.ts`、`tests/douyin-upload-store.test.ts`、`tests/douyin-upload-service.test.ts`、`scripts/qianchuan-account-settings-smoke.mjs`：行为回归、设置改名后的冻结账本/防重传恢复及隔离 Electron 交互。

不修改真实账号映射、Chrome launcher、上传动作、确认边界、已有任务或无关 dirty 文件。不扩大账号数量，不把新名称写入素材、展示文字或产品模型输入。

## Major Milestones

### Persist Names Without Rebinding

先添加失败的名称保存/恢复、非法及重复名称、冻结目标不变测试，再扩展共享 schema 和原 settings owner。仅改名时 discovery 调用必须为零；旧链接保存调用保留自定义名称；旧 digest 无法给新配置授予冻结许可。

### Edit And Select By Visible Name

设置页提供“产品名称”输入、取消和明确保存。前端及主进程共同校验；失败保留草稿。三个显示入口消费同一名称解析，下拉选择仍提交旧槽位值。隔离 smoke 检查名字修改、取消、无效名阻断、浏览器关闭时保存、重启恢复及无上传任务。

## Verification And Completion

运行 `npm run typecheck`、受影响账号/UI/上传 integration tests 和 `npm run build`；运行隔离 Electron settings smoke，并用 Chrome MCP 检查本地 fixture 中设置和下拉交互。无需真实账号或真实上传。

稳定候选后按 `/home/reggie/.codex/SUBAGENTS.md` 评估 Risk Gate，记录 snapshot 和理由。按 AOCI Guide 维护受影响代码索引，执行 Verify、Check、Guide；最终检查 diff，仅提交本任务文件。未验证 Windows 实机和真实账户上传必须明确区分。

## Self-Review

用户需求由编辑及持久化覆盖；浏览器稳定性由原同账户连接复用和零 discovery 测试覆盖；兼容性通过可选字段及稳定枚举保持。未创建第二映射 owner，未改变旧上传授权或允许自动确认。Parent 已自审并授权本任务内合同修订与实现。
