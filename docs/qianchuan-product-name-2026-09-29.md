# Qianchuan Product Name Verification

## Result And Scope

账号设置新增“产品名称”编辑；设置按钮、普通/追加/批量账号选择及高级摘要同步显示已保存名称。原 `product` 保持稳定槽位，只改名称保留 Chrome/CDP 连接、广告账户和计划。已有冻结授权、任务身份及永久防重传 fence 不改写。名称去首尾空白，限制 1–40 字符，拒绝控制字符及有效名称重复；旧配置和旧调用兼容。

本次未连接真实账号、上传成片、点击确定或改广告设置。计划见 [Implementation Plan](superpowers/plans/2026-09-29-qianchuan-product-name.md)，合同见 [Account Configuration Contract](douyin-auto-upload-spec.md#4-account-configuration-contract)。

## Stable Candidate

验证基于 `main` 的 `5d5205cc2885588dd60f9e2971d6947dfa8c9eee` 和本次未提交修改；共享工作区的其他修改保留。五个业务文件的 SHA-256 如下，验证后逐一核对未变。

| Path | SHA-256 |
| --- | --- |
| `src/shared/qianchuan-account.ts` | `b320e30dec855eebe3357de48f4dde8706f844b39963844e87547d1153888d96` |
| `src/main/qianchuan-account-settings.ts` | `a1a46111c8c42b8e8a670d49021f5c4194beef2082a38f5368af26d9b20e3a9c` |
| `src/renderer/QianchuanAccountSettings.tsx` | `49cd9641206738c1d70b363c1ae03dc05a42ba3ee8e950c2881c0679424abd72` |
| `src/renderer/DouyinUploadControls.tsx` | `690ee818399d7f8d816d7b1e56a14f1be1a04cafc95a595dd17f7c1c6c0f7b03` |
| `src/renderer/DouyinUploadPanel.tsx` | `83b8e61f1c2cc9a5282a5d9c7e48250c479ce962697dac5ab492cb024390b48e` |

该表按路径排序后对紧凑 JSON 求 SHA-256，候选身份为 `aea8392204b89f9fc3c2832f4d8a8e7c155e2e5cd8447ae4394b9204222f5a6a`。测试、脚本、Spec 和 Plan 的独立字节身份位于本机 `/tmp/jianji-qianchuan-product-name-20260929/final-targets.json`。

## Executable Evidence

- 名称持久化和显示测试先出现预期失败，再通过相关账号、UI、上传及恢复测试。`npm run typecheck` 和 `npm run build` 成功。
- `npm run harness -- code` 最终回执为 `20260929T114022Z-69075649`，聚合 `PASS`；typecheck 成功，六组共 418 个断言通过，无跳过。运行前后 HEAD、tracked diff 和 source identity 相同。回执及日志在 `.agent/harness/runs/20260929T114022Z-69075649/`。前一轮 `20260929T113759Z-2b829e49` 因其他会话修改 tracked 文档而为 `NOT_EVALUATED`，不能升级其历史结果。
- `xvfb-run -a node scripts/qianchuan-account-settings-smoke.mjs` 通过真实 Electron/preload/IPC，验证 Chrome 关闭时改名仍保留目标、空名/重名阻断、取消不保存及重启恢复。隔离回执 `/tmp/jianji-account-smoke-3m8Agm/report.json`：上传、确认、广告设置修改均为零。
- Chrome MCP 在本地 React fixture 验证改名保存、普通和 compact 下拉同步显示、提交稳定槽位值，以及重名阻断和取消。该测试使用 mock 保存接口；主进程证据由上条 Electron smoke 提供。回执 `/tmp/jianji-qianchuan-product-name-20260929/chrome-mcp-evidence.json`。
- Service 集成测试 `keeps frozen authorization and fences across a settings rename, restart and same-byte new batch` 验证已有 intent/fence 后改名、重启及新批次同字节去重：旧授权、任务、intent 和 fence 原样保持，零新增浏览器上传动作。它已进入最终 Harness。
- AOCI 更新五个受影响条目和对应源码基线；Verify、Check、Guide 对齐。AOCI 仅证明索引治理，不替代上述行为证据。

## Delegation Evidence

受管 Kimi 只读 mapping invocation `c0258e5c-64fe-403b-9a23-fbd8b54bc6b8` 首个请求身份核验成功，第二请求发生 `TLS_ERROR`，总结果 `OUTCOME_UNKNOWN`，无完整报告，不用于验收。重用已消费 seal 的 invocation `4567656e-e290-4b11-a63e-b18a63b9be14` 为零请求 `CONTRACT_ALREADY_CONSUMED`；未继续调用。机械回执保存在本机 `kimi-receipt-1.json`、`kimi-receipt-2.json`。

Native `code_mapper` 只读追踪名称、冻结摘要和 fence，指出缺少“设置改名后旧账本保持”的直接集成证据。Parent 补充并运行上述 Service 集成测试解决该缺口，独立审阅最终 diff；mapping 不充当 final reviewer。

## Implementation Review Risk Gate

依据 `/home/reggie/.codex/SUBAGENTS.md`，在上述稳定候选及 project-native verification 后裁决 `KIMI_REVIEW_NOT_REQUIRED`：

1. 用户未要求此 implementation snapshot 的 Kimi review。
2. 改动没有凭据读取、授权入口、上传动作或恢复机制变更；名称只扩展既有可选元数据。同账户复用原端点，已有授权不改写；稳定槽位、冻结 digest、旧任务和永久 fence 的证据不支持关键级凭据/越权/持久状态损坏路径。
3. 普通显示和持久化风险已有共享 schema、非法/重复名称测试、真实 IPC 保存与重启，以及 fence 后改名和同字节去重集成证据。没有同时成立的重大后果和剩余实质验证缺口，因此未建立新增 adversarial reviewer 的独立增益。Windows 实机和真实商业账号仍未验证，且没有变更其既有准入门禁。

## Delivery Limits

当前源码与本地构建已更新；本次不制作或安装新的 Windows 安装包。未验证 Windows 实机、真实账号上传或平台最终接受。Harness 的 `visualReview` 仍为 `NOT_EVALUATED`；隔离 UI 测试不代表成片或商业平台验收。

已检查仓库内不存在适用的 dedicated session-record Skill；本记录保存本次稳定候选、Risk Gate 和证据，不写入全局 memory，也不扩张项目规则。
