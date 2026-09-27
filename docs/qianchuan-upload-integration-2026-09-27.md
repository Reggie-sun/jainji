# Scope And Checkpoint

依据 Spec 0.2 与五里程碑 plan，实现共享账号准入、v2 ledger、千川 upload-only service/browser port，以及既有制作、追加、preload 与结果页接入。M1 已提交 `49c394c`、`c4da2de`；后续代码在当前 working tree 实施，没有创建 worktree。

Spec SHA-256：`919b3791fb6e7f22ceee680bbff1afcaaf556133b7a977c569a8480bddf9dd1a`。Plan SHA-256：`bb746d5f702792e6fb15f6630d5cdfbbceb581d85e4205f14714e09a6bf44ce2`。当前用户明确授权实现；计划中的历史 docs-only 描述不作为本轮权限来源。

每批请求只允许 `enabled:true/accountProduct`。主进程通过文件对话框授权配置，预检与注册之间重读并核对 digest；冻结产品、endpoint、账户及计划。结果页只显示摘要。制作模型不消费上传选择，正式 MP4 必须来自原队列保存的 completed task 与验证产物；私有快照保留原文件名并核对 SHA-256。

v2 默认关闭；v1 原 JSON 字节写入 `legacy-v1.json`，旧 markers 原样保留，旧任务只读。文件选择前保存独占、同步的 selection fence；其后失败或未知只核查原 tab/modal，不重新选文件。ready 为 `WAITING_FOR_CONFIRMATION/READY`，包含账户、计划、文件名、列表数量、时间及页面归属；没有平台发布成功语义。

切项目、关闭上传及退出停止 automation，保留 Chrome 和 tab。本轮自动资格绑定到明确注册的 intent，停止时清空；新批次授权不能唤醒旧项目迟到完成的导出。共享账号/计划与相同字节去重；不同目标不借用证据。UI 没有发布文案或提交确认按钮，旧 caption/confirm API 只拒绝请求。

# Verification Boundaries

所有账号和上传测试使用隔离 fixture。开发 desktop smoke 的临时 esbuild bundle 只替换有限页面 contract，存放在临时目录，不进入 `dist` 或安装包。其 preload、IPC、账号对话框、制作、FFmpeg、导出完成通知、store 与上传 service 均走实际接入代码。

离线检查、Linux 打包、真实本地 Chrome 与生产千川页面的证据分别报告。Harness 的 `PASS` 只表示固定代码检查；`visualReview: NOT_EVALUATED` 不代表人工观看或商业平台验收。

# Verification Results

最终代码候选的 fresh checks（2026-09-27，Linux）：

| Evidence | Result | Boundary |
| --- | --- | --- |
| `npm run typecheck` 与 staged source 独立 TypeScript 编译 | PASS | working tree 与仅含本任务 hunks 的待提交源码分别可编译 |
| `npx vitest run tests/douyin-*.test.ts tests/qianchuan-*.test.ts tests/queue.test.ts tests/append-production-queue.test.ts` | 121/121 PASS | 账号、合同、ledger、service、UI、原导出队列与追加；含 16 个临时 Chrome fixture tests |
| code Harness `20260927T153237Z-41adedd9` | 353/353 PASS | 上传组 103；固定回归共六组，visual review 未评估 |
| `npm run build`、`npm run package:linux` | PASS | 生成 Linux AppImage/deb；包含已明确保留的其他 working-tree 修改，不等同于仅本提交的发布包 |
| 开发 desktop smoke | PASS | 实际 preload/IPC/dialog、合成 MP4 正式导出、上传 ready、独立追加选择、切项目/提交清空、重启不重选、拒绝任意路径/跨项目/旧 caption/confirm |
| Linux packaged desktop smoke | PASS | 实际 `app.asar` 与包内 Playwright attach；生产 upload 预检阻断，关闭上传后正式 FFmpeg 导出完成 |
| `npm run package:win` | BLOCKED | 当前主机不是 Windows x64；没有生成或验收 Windows 包 |
| 最终 working/staged diff whitespace check | PASS | 不包含用户原有修改的提交 hunks |

开发 smoke report 为 `/tmp/jianji-qianchuan-smoke-LCaxbc/report.json`，包内 smoke report 为 `/tmp/jianji-qianchuan-smoke-FQ0OBI/report.json`。二者均使用独立 userData、Chrome profile 与合成视频，`realAccountsUsed:false`、`confirmClicks:0`。临时路径可消失，本记录只持久保存上述最小结论，不以临时文件替代生产验收证据。

# Review Risk Decision

stable implementation snapshot 的 identity 为 `dc516e1fc6731d6d24af1fa28acb0fd1cc28701dd544057d3b4d1897bcceba3d`：将本 checkpoint 变更的 `src/`、`tests/`、`scripts/`、`.agent/harness/` 路径排序，逐行取 `path<TAB>Git blob ID<LF>` 后计算 SHA-256；排除文档避免自引用。此判断在上述 native verification 后作出，结果为 `KIMI_REVIEW_NOT_REQUIRED`。

三种 trigger 分别核查：用户未要求本 implementation snapshot 的 Kimi final review；生产页面合同缺失时在 CDP/file selection 前物理阻断，没有可执行的金融提交或广告修改路径，v1 原字节与旧 markers 保留，不存在已发现的关键级、难以恢复的数据或权限后果；其余实质离线语义已通过准入、故障注入、停机/重启、同目标去重、实际 Chrome 与 desktop 证据验证。生产页面缺口依赖真实页面观察，静态 adversarial review 不能提供该观察；Windows 与 AOCI 未完成也不伪装为已验收。因此当前候选不满足“重大后果 + native verification 后实质缺口 + 独立 review 增益”的联合条件。

受管 Kimi 已用于本轮两次 bounded exploration，但均为 timeout/unknown，无有效 findings 被采用；它们不构成 final-review evidence。后续填入生产页面合同会改变外部行为，须重新判断 Risk Gate，并先完成生产合同核实与适用验证。

# Production Blocker

`PRODUCTION_QIANCHUAN_CONTRACT` 仍为 `undefined`。实现 checkpoint 时只读探测六个已配置 loopback Chrome 端口，全部不可达。用户随后授权开启端口，五个 profile 已恢复并核对真实账户和计划；肥皂正在运行但无 CDP，重启决定待用户回复。空面板观察发现真实 tab、drawer、数量文案及文件选择入口与 fixture 不同，尚不能核实完整 list/ready 合同，见 [端口复验](qianchuan-cdp-test.md#chrome-port-reopen-verification)。新上传选项仍在制作或入队前拒绝；生产 adapter 不连接 Chrome 或选文件。

既有六账号人工 CDP 上传记录保留为历史证据；本轮没有新增真实视频上传，没有点击确定，没有修改广告设置。M5 的应用到真实千川 ready 验收仍未完成，需有可观察的目标 Chrome 页面及另行指定产品、正式 MP4 和上传授权。

Windows 打包入口在 Linux 主机明确拒绝执行，尚无 Windows 构建、目录同步、ACL 或实机证据；Windows 自动上传继续 fail closed。

# Ownership And Governance

用户 B 授权接管已有改动的接入 seam，并要求保留其他修改。本轮保存这些文件的 preimage，用三方合并生成仅含千川变更的 staged 版本；原 workspaceDraft、usesModel、shape-cover 等改动保留在 working tree，没有一起提交。另对 staged source 独立执行 TypeScript 编译，避免把无关未提交改动当作依赖。

AOCI Guide 返回 `authoring_required`；其完整机器批次还涉及非本任务的 `shape-cover-artifact-io.ts`、`shape-cover-artifacts.ts`、`store.ts` 及带原有修改的共享 seam。当前任务不得接管、提交这些源码，也不能人为截取 AOCI 机器批次。未写入未经核实的整批认知，不声称 Whole-Index aligned；全批次 source/baseline 同步仍待相关工作形成共同稳定 snapshot。

Repository 没有专用 session-record/capture skill，本文件作为本轮持久检查记录；未写全局 memory。
